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
 *   POST   /v1/mail/config          {dry_run: true|false|null} — owner override
 *
 * Cron: every 30 min (wrangler.toml) → runPipeline. Emails whose send time
 * falls within MAIL_LOOKAHEAD_HOURS (default 26) are created as scheduled
 * MailerCloud campaigns, so delivery happens at the AI-chosen minute even
 * if cron is delayed.
 *
 * State (tasks, locks, analytics cache) lives in Workers KV when the
 * binding exists, otherwise directly in Firestore — see state.js. Either
 * way the mailer needs NO manual KV setup anymore.
 *
 * The ONLY things the mailer still needs to actually send:
 *   secrets: SARVAM_API_KEY, MAILERCLOUD_API_KEY, MAILERCLOUD_SENDER_EMAIL,
 *            FIREBASE_SERVICE_ACCOUNT (all pushed by the deploy workflow).
 * DRY_RUN defaults to true and can be overridden any time by the owner via
 * POST /v1/mail/config {dry_run:false} (the app exposes this toggle).
 */

import { MailerCloud } from './mailercloud.js';
import { fetchCrmContacts, getUserRole, canManageCampaigns, upsertCampaignDoc, logActivity } from './firestore.js';
import { buildBusinessBrief, planTask } from './planner.js';
import { writeEmail, renderHtml, saveTemplate } from './copywriter.js';
import { collectAnalytics, getLatestAnalytics, analyticsDue, markAnalyticsPulled } from './analytics.js';
import { putTask, getTask, listTasks, deleteTask, newTask, touch } from './tasks.js';
import { createStore, stateBackendName } from './state.js';

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

const DRY_OVERRIDE_KEY = 'mail:dry_run_override';

/** Effective dry-run: owner override (state) → env MAIL_DRY_RUN → true. */
async function dryRunEffective(env, store) {
  const override = store ? await store.get(DRY_OVERRIDE_KEY) : null;
  if (override === 'true') return { dryRun: true, source: 'owner-override' };
  if (override === 'false') return { dryRun: false, source: 'owner-override' };
  return { dryRun: (env.MAIL_DRY_RUN ?? 'true') !== 'false', source: 'env' };
}

/** What the mailer still needs to send; reports exactly what is missing. */
export async function mailConfigState(env, store = null) {
  const missing = [];
  if (!env.SARVAM_API_KEY) missing.push('SARVAM_API_KEY');
  if (!env.MAILERCLOUD_API_KEY) missing.push('MAILERCLOUD_API_KEY');
  if (!env.MAILERCLOUD_SENDER_EMAIL) missing.push('MAILERCLOUD_SENDER_EMAIL');
  if (!env.FIREBASE_SERVICE_ACCOUNT) missing.push('FIREBASE_SERVICE_ACCOUNT');

  const st = store || (stateBackendName(env) !== 'none' ? createStore(env) : null);
  const dry = await dryRunEffective(env, st);

  return {
    configured: missing.length === 0,
    missing,
    dryRun: dry.dryRun,
    dryRunSource: dry.source,
    state_backend: stateBackendName(env),
  };
}

/* ══════════════════════ HTTP router ══════════════════════ */

export async function handleMail(request, env, { url, uid, ctx = { waitUntil: () => {} } }) {
  const store = stateBackendName(env) !== 'none' ? createStore(env) : null;

  // Role gate — everything under /v1/mail is campaign management.
  const role = await getUserRole(env, uid);
  if (!canManageCampaigns(role)) {
    return json({ error: `role "${role ?? 'unknown'}" cannot manage campaigns (superAdmin/admin/manager only)` }, 403);
  }

  const state = await mailConfigState(env, store);

  const path = url.pathname; // e.g. /v1/mail/tasks
  const sub = path.slice('/v1/mail'.length) || '/';

  // ── Status works even when unconfigured (shows what is missing) ──
  if (sub === '/status' && request.method === 'GET') {
    const last = store ? JSON.parse((await store.get('mail:last_run')) || 'null') : null;
    const brief = store ? JSON.parse((await store.get('biz:brief')) || 'null') : null;
    return json({
      ...state,
      ai_model: env.SARVAM_MODEL || 'sarvam-105b',
      timezone: env.MAIL_TIMEZONE || 'Asia/Calcutta',
      business_understood: brief
        ? { type: brief.business_type, tone: brief.tone, from: brief.source || 'ai' }
        : false,
      last_run: last,
    });
  }

  // ── Owner config (dry-run toggle) works even when unconfigured ──
  if (sub === '/config' && request.method === 'POST') {
    if (!store) return json({ error: 'no state backend (KV or Firestore unavailable)' }, 503);
    const body = await request.json().catch(() => ({}));
    if (!('dry_run' in body)) return json({ error: 'dry_run (true|false|null) is required' }, 400);
    if (body.dry_run === null) {
      await store.delete(DRY_OVERRIDE_KEY);
      return json({ ok: true, reset: true, ...(await mailConfigState(env, store)) });
    }
    await store.put(DRY_OVERRIDE_KEY, body.dry_run ? 'true' : 'false');
    return json({ ok: true, ...(await mailConfigState(env, store)) });
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
      await putTask(store, task);
      // Plan/execute in the background — the task object tracks progress
      // (poll GET /v1/mail/tasks). kept alive by waitUntil after the reply.
      ctx.waitUntil(runPipeline(env, { trigger: 'task', onlyTaskId: task.id }).catch((e) => console.error('[mailer]', e)));
      return json({ ok: true, task }, 201);
    }

    case sub === '/tasks' && request.method === 'GET': {
      const tasks = await listTasks(store);
      return json({ count: tasks.length, tasks });
    }

    case sub.startsWith('/tasks/') && request.method === 'DELETE': {
      const id = sub.split('/')[2];
      const t = await getTask(store, id);
      if (!t) return json({ error: 'task not found' }, 404);
      await deleteTask(store, id);
      return json({ ok: true, deleted: id });
    }

    case sub === '/run' && request.method === 'POST': {
      const result = await runPipeline(env, { trigger: 'manual', force: url.searchParams.get('force') === '1' });
      return json(result);
    }

    case sub === '/sync' && request.method === 'POST': {
      const listId = await mc.ensureList(store);
      const contacts = await fetchCrmContacts(env, { max: parseInt(env.MAIL_MAX_SYNC || '5000', 10) });
      const synced = state.dryRun ? contacts.length : await mc.upsertContacts(listId, contacts);
      return json({ ok: true, listId, crmContacts: contacts.length, syncedOrWouldSync: synced, dryRun: state.dryRun });
    }

    case sub === '/analytics' && request.method === 'GET': {
      if (url.searchParams.get('refresh') === '1') {
        const fresh = await collectAnalytics(mc, env, store);
        await markAnalyticsPulled(store);
        return json(fresh);
      }
      return json((await getLatestAnalytics(store)) ?? { message: 'No analytics yet — call with ?refresh=1 or wait for cron.' });
    }

    case sub === '/preview' && request.method === 'GET': {
      const instruction = url.searchParams.get('task') || 'Write one engaging introduction email about our business.';
      const contacts = await fetchCrmContacts(env, { max: parseInt(env.MAIL_MAX_SYNC || '5000', 10) }).catch(() => []);
      const stats = contactStats(contacts);
      const brief = await buildBusinessBrief(env, store, { crmStats: stats });
      const learnings = (await getLatestAnalytics(store))?.learnings ?? null;
      const pseudoTask = { id: 'preview', instruction, plan: null };
      const planEmail = { seq: 1, sendAt: new Date().toISOString(), goal: instruction.slice(0, 200), angle: 'highest-open-rate hook for this audience', tone: brief.tone || 'friendly', template_style: 'newsletter' };
      const copy = await writeEmail(env, pseudoTask, planEmail, brief, learnings);
      return json({ preview: true, dryRun: true, copy, html: renderHtml(env, copy) });
    }

    default:
      return json({ error: 'not found', routes: ['POST/GET /v1/mail/tasks', 'DELETE /v1/mail/tasks/:id', 'POST /v1/mail/run', 'POST /v1/mail/sync', 'GET /v1/mail/analytics', 'GET /v1/mail/preview?task=', 'GET /v1/mail/status', 'POST /v1/mail/config'] }, 404);
  }
}

/* ══════════════════════ Pipeline ══════════════════════ */

/** Cron entry — called from the worker's scheduled() handler. */
export async function runMailCron(env) {
  if (stateBackendName(env) === 'none') return; // no KV, no Firestore — stay silent & cheap
  const state = await mailConfigState(env);
  if (!state.configured) return;
  await runPipeline(env, { trigger: 'cron' }).catch((e) => console.error('[mailer:cron]', e));
}

export async function runPipeline(env, { trigger = 'cron', onlyTaskId = null, force = false } = {}) {
  const started = Date.now();
  const mc = new MailerCloud(env);
  const store = createStore(env);
  const { dryRun } = await dryRunEffective(env, store);
  const log = [];

  if (!force) {
    const lock = await store.get('mail:lock');
    if (lock && Date.now() - Number(lock) < 10 * 60 * 1000) {
      return { skipped: true, reason: 'another run is in progress', lockedAt: new Date(Number(lock)).toISOString() };
    }
  }
  await store.put('mail:lock', String(Date.now()), { expirationTtl: 660 });

  try {
    const timezone = env.MAIL_TIMEZONE || 'Asia/Calcutta';
    const lookahead = parseInt(env.MAIL_LOOKAHEAD_HOURS || '26', 10) * 3600 * 1000;
    const maxSync = parseInt(env.MAIL_MAX_SYNC || '5000', 10);

    // 1) Refresh analytics + AI learnings when due
    if (await analyticsDue(store, parseInt(env.MAIL_ANALYTICS_INTERVAL_HOURS || '20', 10))) {
      log.push('analytics: pulling campaign performance…');
      const snap = await collectAnalytics(mc, env, store);
      await markAnalyticsPulled(store);
      log.push(`analytics: ${snap.campaigns?.length ?? 0} campaign(s) analysed, metrics written to CRM`);
    }
    const learnings = (await getLatestAnalytics(store))?.learnings ?? null;

    // 2) Audience — the CRM contacts collection IS the email list
    const contacts = await fetchCrmContacts(env, { max: maxSync });
    log.push(`crm: ${contacts.length} emailable contact(s) loaded`);
    const stats = contactStats(contacts);

    // 3) Understand the business (state-cached ~7 days) — learns from the
    //    owner profile, the CRM data itself, and past task instructions.
    const tasks = (await listTasks(store)).filter((t) => !onlyTaskId || t.id === onlyTaskId);
    const recentInstructions = tasks
      .slice(0, 5)
      .map((t) => t.instruction)
      .filter(Boolean);
    const brief = await buildBusinessBrief(env, store, { crmStats: stats, recentInstructions });

    // 4) Plan pending tasks
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'planning') {
        try {
          await putTask(store, touch(task, { status: 'planning' }));
          const plan = await planTask(env, store, task, brief, learnings, stats);
          task.plan = plan;
          task.emails = plan.emails.map((e) => ({
            seq: e.seq, sendAt: e.sendAt, subject: null, campaignId: null,
            crmCampaignId: null, status: 'planned', templateId: null,
          }));
          await putTask(store, touch(task, { status: 'active' }));
          log.push(`task ${task.id}: planned ${plan.emails.length} email(s) → ≤${plan.audience.max_recipients} recipients (segment: ${plan.audience.segment ?? 'all'})`);
        } catch (e) {
          await putTask(store, touch(task, { status: 'failed', error: e.message }));
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

          const listId = await mc.ensureList(store);
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
        await putTask(store, touch(task, { status: failed.length === task.emails.length ? 'failed' : 'done' }));
      } else {
        await putTask(store, task);
      }
    }

    await store.put('mail:last_run', JSON.stringify({ at: new Date().toISOString(), trigger, dryRun, log }));
    return { ok: true, trigger, dryRun, durationMs: Date.now() - started, log };
  } finally {
    await store.delete('mail:lock');
  }
}

/* ══════════════════════ Helpers ══════════════════════ */

function contactStats(contacts) {
  const segs = {};
  for (const c of contacts) segs[c._segment] = (segs[c._segment] || 0) + 1;
  const tagCounts = {};
  for (const c of contacts) for (const t of c.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const companyCounts = {};
  for (const c of contacts) {
    const co = String(c.company_name || '').trim();
    if (co) companyCounts[co] = (companyCounts[co] || 0) + 1;
  }
  return {
    total: contacts.length,
    segments: segs,
    top_tags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count })),
    top_companies: Object.entries(companyCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([company, count]) => ({ company, count })),
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
