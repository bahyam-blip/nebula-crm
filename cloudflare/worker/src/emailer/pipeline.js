/**
 * Mailer pipeline + HTTP routes.
 *
 * Owner flow:  POST /v1/mail/tasks {instruction} — plain language, e.g.
 *   "Send 3 emails this week to 500 leads about our monsoon sale"
 * The AI (Sarvam) plans count/timing/audience, writes each template, syncs
 * the CRM contacts to MailerCloud, schedules the campaign — and writes the
 * campaign into Firestore `campaigns/` so it appears natively in the app.
 *
 * Routes (all require a Firebase ID token; mutations + reads require a
 * campaign-manager role: superAdmin | admin | manager — mirroring the
 * app's canManageCampaigns):
 *   POST   /v1/mail/tasks           {instruction, source?}
 *   GET    /v1/mail/tasks
 *   DELETE /v1/mail/tasks/:id
 *   POST   /v1/mail/run?force=1     run the pipeline now
 *   POST   /v1/mail/sync            CRM → MailerCloud contact sync only
 *   GET    /v1/mail/analytics?refresh=1
 *   GET    /v1/mail/preview?task=…  AI writes a sample — sends nothing
 *   GET    /v1/mail/status          config & health
 *
 * Cron: every 30 min (wrangler.toml) → runPipeline. Emails whose send time
 * falls within MAIL_LOOKAHEAD_HOURS (default 26) are created as scheduled
 * MailerCloud campaigns, so delivery happens at the AI-chosen minute even
 * if cron is delayed. DRY_RUN defaults to true: nothing sends until the
 * owner explicitly flips it.
 */

import { MailerCloud } from './mailercloud.js';
import { fetchCrmContacts, getUserRole, canManageCampaigns, upsertCampaignDoc, logActivity } from './firestore.js';
import { buildBusinessBrief, planTask } from './planner.js';
import { writeEmail, renderHtml, saveTemplate } from './copywriter.js';
import { collectAnalytics, getLatestAnalytics, analyticsDue, markAnalyticsPulled } from './analytics.js';
import { putTask, getTask, listTasks, deleteTask, newTask, touch } from './tasks.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

/** The mailer needs these to do anything; reports exactly what is missing. */
export function mailConfigState(env) {
  const missing = [];
  if (!env.SARVAM_API_KEY) missing.push('SARVAM_API_KEY');
  if (!env.MAILERCLOUD_API_KEY) missing.push('MAILERCLOUD_API_KEY');
  if (!env.MAILERCLOUD_SENDER_EMAIL) missing.push('MAILERCLOUD_SENDER_EMAIL');
  if (!env.FIREBASE_SERVICE_ACCOUNT) missing.push('FIREBASE_SERVICE_ACCOUNT');
  if (!env.NEBULA_EMAIL_KV) missing.push('NEBULA_EMAIL_KV (KV binding — see SETUP_INSTRUCTIONS)');
  return { configured: missing.length === 0, missing, dryRun: (env.MAIL_DRY_RUN ?? 'true') !== 'false' };
}

/* ══════════════════════ HTTP router ══════════════════════ */

export async function handleMail(request, env, { url, uid, ctx = { waitUntil: () => {} } }) {
  const state = mailConfigState(env);
  const kv = env.NEBULA_EMAIL_KV;

  // Role gate — everything under /v1/mail is campaign management.
  const role = await getUserRole(env, uid);
  if (!canManageCampaigns(role)) {
    return json({ error: `role "${role ?? 'unknown'}" cannot manage campaigns (superAdmin/admin/manager only)` }, 403);
  }

  const path = url.pathname; // e.g. /v1/mail/tasks
  const sub = path.slice('/v1/mail'.length) || '/';

  // ── Status works even when unconfigured (shows what is missing) ──
  if (sub === '/status' && request.method === 'GET') {
    const last = kv ? JSON.parse((await kv.get('mail:last_run')) || 'null') : null;
    const brief = kv ? JSON.parse((await kv.get('biz:brief')) || 'null') : null;
    return json({
      ...state,
      ai_model: env.SARVAM_MODEL || 'sarvam-105b',
      timezone: env.MAIL_TIMEZONE || 'Asia/Calcutta',
      business_understood: brief ? { type: brief.business_type, tone: brief.tone } : false,
      last_run: last,
    });
  }

  if (!state.configured) {
    return json({ error: 'mailer not configured', ...state }, 503);
  }

  const mc = new MailerCloud(env);

  switch (true) {
    case sub === '/tasks' && request.method === 'POST': {
      const body = await request.json().catch(() => ({}));
      const instruction = body.instruction || body.task || '';
      if (!instruction.trim()) return json({ error: 'instruction is required' }, 400);
      const task = newTask(instruction, body.source || 'api', uid);
      await putTask(kv, task);
      // Plan/execute in the background — the task object tracks progress
      // (poll GET /v1/mail/tasks). kept alive by waitUntil after the reply.
      ctx.waitUntil(runPipeline(env, { trigger: 'task', onlyTaskId: task.id }).catch((e) => console.error('[mailer]', e)));
      return json({ ok: true, task }, 201);
    }

    case sub === '/tasks' && request.method === 'GET': {
      const tasks = await listTasks(kv);
      return json({ count: tasks.length, tasks });
    }

    case sub.startsWith('/tasks/') && request.method === 'DELETE': {
      const id = sub.split('/')[2];
      const t = await getTask(kv, id);
      if (!t) return json({ error: 'task not found' }, 404);
      await deleteTask(kv, id);
      return json({ ok: true, deleted: id });
    }

    case sub === '/run' && request.method === 'POST': {
      const result = await runPipeline(env, { trigger: 'manual', force: url.searchParams.get('force') === '1' });
      return json(result);
    }

    case sub === '/sync' && request.method === 'POST': {
      const listId = await mc.ensureList(kv);
      const contacts = await fetchCrmContacts(env, { max: parseInt(env.MAIL_MAX_SYNC || '5000', 10) });
      const synced = state.dryRun ? contacts.length : await mc.upsertContacts(listId, contacts);
      return json({ ok: true, listId, crmContacts: contacts.length, syncedOrWouldSync: synced, dryRun: state.dryRun });
    }

    case sub === '/analytics' && request.method === 'GET': {
      if (url.searchParams.get('refresh') === '1') {
        const fresh = await collectAnalytics(mc, env, kv);
        await markAnalyticsPulled(kv);
        return json(fresh);
      }
      return json((await getLatestAnalytics(kv)) ?? { message: 'No analytics yet — call with ?refresh=1 or wait for cron.' });
    }

    case sub === '/preview' && request.method === 'GET': {
      const instruction = url.searchParams.get('task') || 'Write one engaging introduction email about our business.';
      const brief = await buildBusinessBrief(env, kv);
      const learnings = (await getLatestAnalytics(kv))?.learnings ?? null;
      const pseudoTask = { id: 'preview', instruction, plan: null };
      const planEmail = { seq: 1, sendAt: new Date().toISOString(), goal: instruction.slice(0, 200), angle: 'highest-open-rate hook for this audience', tone: brief.tone || 'friendly', template_style: 'newsletter' };
      const copy = await writeEmail(env, pseudoTask, planEmail, brief, learnings);
      return json({ preview: true, dryRun: true, copy, html: renderHtml(env, copy) });
    }

    default:
      return json({ error: 'not found', routes: ['POST/GET /v1/mail/tasks', 'DELETE /v1/mail/tasks/:id', 'POST /v1/mail/run', 'POST /v1/mail/sync', 'GET /v1/mail/analytics', 'GET /v1/mail/preview?task=', 'GET /v1/mail/status'] }, 404);
  }
}

/* ══════════════════════ Pipeline ══════════════════════ */

/** Cron entry — called from the worker's scheduled() handler. */
export async function runMailCron(env) {
  if (!env.NEBULA_EMAIL_KV) return; // not configured yet — stay silent & cheap
  const state = mailConfigState(env);
  if (!state.configured) return;
  await runPipeline(env, { trigger: 'cron' }).catch((e) => console.error('[mailer:cron]', e));
}

export async function runPipeline(env, { trigger = 'cron', onlyTaskId = null, force = false } = {}) {
  const started = Date.now();
  const mc = new MailerCloud(env);
  const kv = env.NEBULA_EMAIL_KV;
  const dryRun = (env.MAIL_DRY_RUN ?? 'true') !== 'false';
  const log = [];

  if (!force) {
    const lock = await kv.get('mail:lock');
    if (lock && Date.now() - Number(lock) < 10 * 60 * 1000) {
      return { skipped: true, reason: 'another run is in progress', lockedAt: new Date(Number(lock)).toISOString() };
    }
  }
  await kv.put('mail:lock', String(Date.now()), { expirationTtl: 660 });

  try {
    const timezone = env.MAIL_TIMEZONE || 'Asia/Calcutta';
    const lookahead = parseInt(env.MAIL_LOOKAHEAD_HOURS || '26', 10) * 3600 * 1000;
    const maxSync = parseInt(env.MAIL_MAX_SYNC || '5000', 10);

    // 1) Refresh analytics + AI learnings when due
    if (await analyticsDue(kv, parseInt(env.MAIL_ANALYTICS_INTERVAL_HOURS || '20', 10))) {
      log.push('analytics: pulling campaign performance…');
      const snap = await collectAnalytics(mc, env, kv);
      await markAnalyticsPulled(kv);
      log.push(`analytics: ${snap.campaigns?.length ?? 0} campaign(s) analysed, metrics written to CRM`);
    }
    const learnings = (await getLatestAnalytics(kv))?.learnings ?? null;

    // 2) Understand the business (KV-cached ~7 days)
    const brief = await buildBusinessBrief(env, kv);
    log.push(`brief: ${brief.business_type || 'ready'}`);

    // 3) Audience — the CRM contacts collection IS the email list
    const contacts = await fetchCrmContacts(env, { max: maxSync });
    log.push(`crm: ${contacts.length} emailable contact(s) loaded`);
    const stats = contactStats(contacts);

    // 4) Plan pending tasks
    const tasks = (await listTasks(kv)).filter((t) => !onlyTaskId || t.id === onlyTaskId);
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'planning') {
        try {
          await putTask(kv, touch(task, { status: 'planning' }));
          const plan = await planTask(env, kv, task, brief, learnings, stats);
          task.plan = plan;
          task.emails = plan.emails.map((e) => ({
            seq: e.seq, sendAt: e.sendAt, subject: null, campaignId: null,
            crmCampaignId: null, status: 'planned', templateId: null,
          }));
          await putTask(kv, touch(task, { status: 'active' }));
          log.push(`task ${task.id}: planned ${plan.emails.length} email(s) → ≤${plan.audience.max_recipients} recipients (segment: ${plan.audience.segment ?? 'all'})`);
        } catch (e) {
          await putTask(kv, touch(task, { status: 'failed', error: e.message }));
          log.push(`task ${task.id}: PLAN FAILED — ${e.message}`);
        }
      }
    }

    // 5) Execute due emails (create scheduled MailerCloud campaigns + CRM docs)
    const nowMs = Date.now();
    for (const task of tasks) {
      if (task.status !== 'active' || !task.plan) continue;

      for (const mail of task.emails) {
        if (mail.status !== 'planned') continue;
        const sendMs = Date.parse(mail.sendAt);
        if (!Number.isFinite(sendMs)) { mail.status = 'failed'; mail.error = 'bad sendAt'; continue; }
        if (sendMs - nowMs > lookahead) continue; // not due yet

        try {
          const planEmail = task.plan.emails.find((e) => e.seq === mail.seq);
          const audience = pickAudience(contacts, task.plan.audience);
          if (audience.length === 0) throw new Error('audience is empty');

          const copy = await writeEmail(env, task, planEmail, brief, learnings);
          const html = renderHtml(env, copy);
          const crmCampaignId = `ai_${task.id}_${mail.seq}`;

          if (dryRun) {
            mail.status = 'dry_run';
            mail.subject = copy.subject;
            mail.crmCampaignId = crmCampaignId;
            log.push(`task ${task.id} email ${mail.seq}: DRY RUN — would send "${copy.subject}" to ${audience.length} at ${mail.sendAt}`);
            continue;
          }

          const listId = await mc.ensureList(kv);
          const synced = await mc.upsertContacts(listId, audience);
          log.push(`task ${task.id} email ${mail.seq}: synced ${synced} recipient(s) to MailerCloud list ${listId}`);

          const tpl = await saveTemplate(mc, env, copy, html, `${task.id.slice(-4)} #${mail.seq}`);
          mail.templateId = tpl?.id ?? tpl?.data?.id ?? null;

          const campaign = await mc.createAndPublishCampaign({
            name: `Nebula AI | ${task.id} #${mail.seq} | ${copy.subject.slice(0, 60)}`,
            subject: copy.subject,
            html,
            preheader: copy.preheader,
            listId,
            scheduledAt: isoToAccountTime(mail.sendAt, timezone),
          });
          mail.campaignId = campaign?.id ?? campaign?.data?.id ?? null;
          mail.subject = copy.subject;
          mail.status = mail.campaignId ? 'scheduled' : 'created';

          // ── Make it visible in the app: write the campaign doc ──
          await upsertCampaignDoc(env, {
            id: crmCampaignId,
            fields: {
              name: `AI | ${task.id} #${mail.seq} | ${copy.subject.slice(0, 60)}`,
              channel: 'email',
              status: 'scheduled',
              ownerId: task.createdBy || 'ai-mailer',
              teamId: env.MAIL_TEAM_ID || null,
              audienceCount: audience.length,
              subject: copy.subject,
              previewText: copy.preheader,
              bodyHtml: html,
              bodyPlainText: plainOf(html),
              ctaLabel: copy.cta_text,
              ctaUrl: env.MAIL_CTA_URL || env.MAIL_WEBSITE_URL || '',
              scheduleType: 'once',
              scheduledAt: mail.sendAt,
              metrics: { sent: 0, delivered: 0, opens: 0, clicks: 0, conversions: 0, bounces: 0, unsubscribes: 0, revenue: 0 },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              // mailer-specific extras (Dart parser ignores unknown fields)
              source: 'ai-mailer',
              aiTaskId: task.id,
              mailercloudCampaignId: mail.campaignId,
              mailercloudTemplateId: mail.templateId,
              mailercloudListId: listId,
              aiPlan: { goal: planEmail.goal, angle: planEmail.angle, tone: planEmail.tone, reasoning: String(task.plan.reasoning || '').slice(0, 500) },
            },
          });
          await logActivity(env, {
            title: `AI email scheduled: ${copy.subject}`,
            description: `Email ${mail.seq} of task ${task.id} → ${audience.length} recipients at ${mail.sendAt} (${task.instruction.slice(0, 120)})`,
            campaignId: crmCampaignId,
            metadata: { mailercloudCampaignId: mail.campaignId, audience: audience.length },
          });

          log.push(`task ${task.id} email ${mail.seq}: campaign ${mail.campaignId} "${copy.subject}" → ${mail.status} for ${mail.sendAt} (CRM: campaigns/${crmCampaignId})`);
        } catch (e) {
          mail.status = 'failed';
          mail.error = e.message;
          log.push(`task ${task.id} email ${mail.seq}: SEND FAILED — ${e.message}`);
        }
      }

      const remaining = task.emails.filter((m) => m.status === 'planned');
      const failed = task.emails.filter((m) => m.status === 'failed');
      if (remaining.length === 0) {
        await putTask(kv, touch(task, { status: failed.length === task.emails.length ? 'failed' : 'done' }));
      } else {
        await putTask(kv, task);
      }
    }

    await kv.put('mail:last_run', JSON.stringify({ at: new Date().toISOString(), trigger, dryRun, log }));
    return { ok: true, trigger, dryRun, durationMs: Date.now() - started, log };
  } finally {
    await kv.delete('mail:lock');
  }
}

/* ══════════════════════ Helpers ══════════════════════ */

function contactStats(contacts) {
  const segs = {};
  for (const c of contacts) segs[c._segment] = (segs[c._segment] || 0) + 1;
  const tagCounts = {};
  for (const c of contacts) for (const t of c.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  return {
    total: contacts.length,
    segments: segs,
    top_tags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count })),
  };
}

/** Filter to the AI-chosen status segment, capped to max_recipients (freshest first). */
function pickAudience(contacts, audience) {
  let pool = contacts;
  if (audience?.segment) {
    const seg = String(audience.segment).toLowerCase();
    const matched = pool.filter((c) => c._segment === seg || (c.tags || []).some((t) => t.toLowerCase().includes(seg)));
    if (matched.length > 0) pool = matched;
    else console.warn(`[mailer] segment "${seg}" matched none of ${pool.length} — using full list`);
  }
  const sorted = [...pool].sort((a, b) => String(b._created || '').localeCompare(String(a._created || '')));
  const n = Math.max(1, Math.min(parseInt(audience?.max_recipients, 10) || sorted.length, sorted.length));
  return sorted.slice(0, n);
}

/** ISO string → "YYYY-MM-DD HH:MM:SS" in the MailerCloud account timezone. */
function isoToAccountTime(iso, timeZone) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

function plainOf(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
}
