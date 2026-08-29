/**
 * Mailer pipeline + HTTP routes.
 *
 * Owner flow:  POST /v1/mail/tasks {instruction} — plain language, e.g.
 *   "Send 3 emails this week to 500 leads about our monsoon sale"
 * The AI (Sarvam) plans count/timing/audience, writes each template, syncs
 * the CRM contacts to MailerCloud, delivers the email — and writes the
 * campaign into Firestore `campaigns/` so it appears natively in the app.
 *
 * Delivery engine (MAIL_DELIVERY_MODE, default "auto"):
 *   transactional — MailerCloud Email API (email-api.mailercloud.com),
 *                   personalized per recipient ({{first_name}} mail merge),
 *                   immediate + per-recipient outcomes. Used for audiences
 *                   up to MAIL_TRANSACTIONAL_MAX (default 250) in auto mode,
 *                   and ALWAYS for /v1/mail/test.
 *   campaign      — Marketing API scheduled campaign (right tool for the
 *                   full list: opens/clicks/unsubs tracking at scale).
 *
 * Routes (all require a Firebase ID token — every signed-in teammate may use
 * the mailer; the AI mailer is a product feature, not an admin panel):
 *   POST   /v1/mail/tasks           {instruction, source?}
 *   GET    /v1/mail/tasks           (each task carries progress + events[])
 *   DELETE /v1/mail/tasks/:id
 *   POST   /v1/mail/tasks/:id/cancel  stop a live task — nothing more sends
 *   POST   /v1/mail/run?force=1     run the pipeline now
 *   POST   /v1/mail/sync            CRM → MailerCloud contact sync only
 *   POST   /v1/mail/test            {to} — send ONE real email now (go-live check)
 *   GET    /v1/mail/analytics?refresh=1
 *   GET    /v1/mail/preview?task=…  AI writes a sample — sends nothing
 *   GET    /v1/mail/status          config & health
 *   POST   /v1/mail/config          {dry_run: true|false|null} — owner override
 *   GET    /v1/mail/memory          what the AI knows about the business
 *   POST   /v1/mail/memory          teach it {facts:{...}, note:"free text"}
 *   POST   /v1/mail/memory/reset    wipe the memory
 *
 * Cron: every 30 min (wrangler.toml) → runPipeline. Emails whose send time
 * falls within MAIL_LOOKAHEAD_HOURS (default 26) are delivered: small
 * audiences immediately via the Email API (at the AI-chosen minute ± cron
 * drift), large ones as scheduled MailerCloud campaigns.
 *
 * State (tasks, locks, analytics cache) lives in Workers KV when the
 * binding exists, otherwise directly in Firestore — see state.js. Either
 * way the mailer needs NO manual KV setup anymore.
 *
 * What the mailer needs to send:
 *   MAILERCLOUD_API_KEY (secret) — without it nothing can send.
 *   MAILERCLOUD_SENDER_EMAIL (secret, optional) — falls back to the
 *     MAIL_SENDER_EMAIL var, then the verified account sender das@aidraft.bond.
 *   SARVAM_API_KEY + FIREBASE_SERVICE_ACCOUNT — for the AI pipeline,
 *     CRM audiences and write-back; NOT needed for /test.
 */

import { MailerCloud } from './mailercloud.js';
import {
  EMAIL_API_BASE,
  resolveSender,
  sendEmail,
  sendPersonalizedBatch,
  hintFor,
} from './emailapi.js';
import { fetchCrmContacts, upsertCampaignDoc, logActivity } from './firestore.js';
import { buildBusinessBrief, planTask } from './planner.js';
import { writeEmail, renderHtml, saveTemplate } from './copywriter.js';
import { collectAnalytics, getLatestAnalytics, analyticsDue, markAnalyticsPulled } from './analytics.js';
import { putTask, getTask, listTasks, deleteTask, newTask, touch, addEvent, cancelTaskState, retryTaskState, progressOf } from './tasks.js';
import { createStore, stateBackendName, safeParse } from './state.js';
import { getMemory, saveMemory, resetMemory, teach, learnFromResults, memoryContext, syncBriefToMemory } from './memory.js';
import { openToken } from './track.js';

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
const SUPPRESSION_KEY = 'mail:suppressions';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Effective dry-run: owner override (state) → env MAIL_DRY_RUN → true. */
async function dryRunEffective(env, store) {
  const override = store ? await store.get(DRY_OVERRIDE_KEY) : null;
  if (override === 'true') return { dryRun: true, source: 'owner-override' };
  if (override === 'false') return { dryRun: false, source: 'owner-override' };
  return { dryRun: (env.MAIL_DRY_RUN ?? 'true') !== 'false', source: 'env' };
}

function deliveryMode(env) {
  const m = String(env.MAIL_DELIVERY_MODE || 'auto').toLowerCase();
  return ['auto', 'transactional', 'campaign'].includes(m) ? m : 'auto';
}

function transactionalMax(env) {
  const n = parseInt(env.MAIL_TRANSACTIONAL_MAX || '250', 10);
  return Number.isFinite(n) && n > 0 ? n : 250;
}

/** Which engine delivers a given email? ("auto" decides by audience size) */
function pickDeliveryMode(env, audienceSize) {
  const mode = deliveryMode(env);
  if (mode !== 'auto') return mode;
  return audienceSize <= transactionalMax(env) ? 'transactional' : 'campaign';
}

/** What the mailer still needs; reports exactly what is missing. */
export async function mailConfigState(env, store = null) {
  const missing = [];
  if (!env.SARVAM_API_KEY) missing.push('SARVAM_API_KEY');
  if (!env.MAILERCLOUD_API_KEY) missing.push('MAILERCLOUD_API_KEY');
  if (!env.FIREBASE_SERVICE_ACCOUNT) missing.push('FIREBASE_SERVICE_ACCOUNT');
  // MAILERCLOUD_SENDER_EMAIL is optional — resolveSender() has two fallbacks,
  // ending at the verified account sender (das@aidraft.bond).

  const canSend = !!env.MAILERCLOUD_API_KEY;
  const sender = resolveSender(env);
  const warnings = [];
  if (!env.MAILERCLOUD_SENDER_EMAIL && !env.MAIL_SENDER_EMAIL) {
    warnings.push(`MAILERCLOUD_SENDER_EMAIL not set — using built-in default ${sender.from}. Make sure it is a VERIFIED sender in MailerCloud.`);
  }

  const st = store || (stateBackendName(env) !== 'none' ? createStore(env) : null);
  const dry = await dryRunEffective(env, st);

  return {
    configured: canSend,          // sending capability (test + pipeline delivery)
    ready: canSend && missing.length === 0, // full AI pipeline
    canSend,
    missing,                      // still missing for the FULL pipeline
    warnings,
    dryRun: dry.dryRun,
    dryRunSource: dry.source,
    state_backend: stateBackendName(env),
    sender: { from: sender.from, fromName: sender.fromName, replyTo: sender.replyTo },
    delivery_mode: deliveryMode(env),
    transactional_max: transactionalMax(env),
    email_api: EMAIL_API_BASE,
  };
}

/* ── Suppression list (auto-learned from provider outcomes) ─────────── */

async function loadSuppressions(store) {
  if (!store) return new Set();
  const raw = await store.get(SUPPRESSION_KEY);
  const list = safeParse(raw, []);
  return new Set(list.map((s) => s.email));
}

async function addSuppressions(store, entries) {
  if (!store || !entries?.length) return;
  const list = safeParse(await store.get(SUPPRESSION_KEY), []);
  const seen = new Set(list.map((s) => s.email));
  for (const e of entries) {
    if (!seen.has(e.email)) {
      seen.add(e.email);
      list.push(e);
    }
  }
  await store.put(SUPPRESSION_KEY, JSON.stringify(list.slice(-5000)));
}

/* ══════════════════════ HTTP router ══════════════════════ */

export async function handleMail(request, env, { url, uid, ctx = { waitUntil: () => {} } }) {
  // Top-level guard: the app depends on these routes answering with JSON.
  // An uncaught throw here becomes Cloudflare error 1101 (HTML, no status
  // payload) and the whole Email tab breaks with no clue why. Any unexpected
  // exception now comes back as a structured 500 the app and the owner can
  // actually read.
  try {
    return await handleMailInner(request, env, { url, uid, ctx });
  } catch (e) {
    console.error(`[mailer] unhandled error on ${url.pathname}:`, e?.stack || e);
    return json({ ok: false, error: `mailer error: ${e?.message || e}` }, 500);
  }
}

async function handleMailInner(request, env, { url, uid, ctx = { waitUntil: () => {} } }) {
  const store = stateBackendName(env) !== 'none' ? createStore(env) : null;

  // EVERY signed-in teammate can use the AI mailer. The token was already
  // verified by the caller (index.js) — uid is used for audit/attribution
  // only. Role lookups remain available to other modules but no longer gate
  // this feature: blocking the whole team behind users/{uid}.role caused
  // hard 403s whenever the doc was missing or the role value drifted.
  const state = await mailConfigState(env, store);

  const path = url.pathname; // e.g. /v1/mail/tasks
  const sub = path.slice('/v1/mail'.length) || '/';

  // ── Status works even when unconfigured (shows what is missing) ──
  if (sub === '/status' && request.method === 'GET') {
    const last = store ? safeParse(await store.get('mail:last_run'), null) : null;
    const brief = store ? safeParse(await store.get('biz:brief'), null) : null;
    const mem = await getMemory(store);
    const suppressions = store ? (await loadSuppressions(store)).size : 0;
    return json({
      ...state,
      state_error: store?.lastError || null,
      ai_model: env.SARVAM_MODEL || 'sarvam-105b',
      timezone: env.MAIL_TIMEZONE || 'Asia/Calcutta',
      business_understood: mem.facts.business_type || brief
        ? { type: mem.facts.business_type || brief?.business_type, tone: mem.facts.tone || brief?.tone, from: mem.facts.business_type ? 'memory' : (brief?.source || 'ai') }
        : false,
      memory: { facts_known: Object.values(mem.facts).filter((v) => (Array.isArray(v) ? v.length : v)).length, insights: mem.insights.length },
      last_run: last,
      suppressions,
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

  // ── TEST SEND — the go-live check. Sends ONE real email right now via
  //    the transactional Email API. Needs only MAILERCLOUD_API_KEY; works
  //    regardless of dry-run (it is explicit and owner-triggered).
  if (sub === '/test' && request.method === 'POST') {
    if (!state.canSend) return json({ error: 'MAILERCLOUD_API_KEY is not configured', ...state }, 503);
    const body = await request.json().catch(() => ({}));
    const to = String(body.to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return json({ error: 'a valid "to" email address is required, e.g. {"to":"you@example.com"}' }, 400);

    const sender = resolveSender(env);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const bizName = env.MAIL_BUSINESS_NAME || 'Nebula CRM';
    const copy = {
      subject: String(body.subject || '').trim() || `Nebula CRM test email — ${stamp}`,
      preheader: 'If this lands in your inbox, the CRM → MailerCloud connection works end to end.',
      headline: 'Your email system works',
      intro: `This is a live test email sent directly from ${bizName} through the MailerCloud Email API at ${EMAIL_API_BASE}/email — the transactional endpoint your CRM uses.`,
      sections: [
        {
          title: 'What this proves',
          body: `Your MailerCloud API key authenticated successfully, and the message was sent from the verified sender ${sender.from} (${sender.fromName}). The request used version 1.0 of the send-email contract with both HTML and plain-text parts for the best inbox placement.`,
        },
        {
          title: 'One last thing to confirm',
          body: 'Open your MailerCloud account and go to Logs — this message should appear there within a minute. Once you see it, every AI-planned campaign from the CRM will deliver through the same verified identity.',
        },
      ],
      cta_text: 'Open Nebula CRM',
      closing: 'Happy sending,',
      ps: 'Re-run this test any time from the AI Email screen — it never touches your contact lists.',
    };
    const html = renderHtml(env, copy);

    const res = await sendEmail(env, {
      to: [{ name: String(body.name || '').slice(0, 100), email: to }],
      subject: copy.subject,
      html,
      metadata: {
        messageId: `nebula-test-${Date.now().toString(36)}`,
        custom: { campaign_id: 'nebula-test-send', source: 'nebula-ai-mailer' },
      },
    });

    if (res.ok) {
      return json({
        ok: true,
        sent_to: to,
        from: `${sender.fromName} <${sender.from}>`,
        endpoint: `${EMAIL_API_BASE}/email`,
        provider: res.raw,
        next_step: 'Open MailerCloud → Logs and confirm this message appears there. If it does, the integration is fully connected.',
      });
    }
    // Surface the EXACT provider reply — support can identify a 400 instantly.
    return json(
      {
        ok: false,
        sent_to: to,
        from: `${sender.fromName} <${sender.from}>`,
        endpoint: `${EMAIL_API_BASE}/email`,
        provider_status: res.statusCode,
        provider: res.raw,
        error: hintFor(res.statusCode),
        message: res.message,
      },
      502
    );
  }

  // ── Business memory — view / teach / reset ──────────────────────
  // Available even when the pipeline is not fully configured: the owner can
  // start teaching the AI before every secret is in place.
  if (sub === '/memory' && request.method === 'GET') {
    const mem = await getMemory(store);
    // A failed state read is NOT the same as "the AI knows nothing". If the
    // store just errored and the memory looks empty, say so — otherwise the
    // owner concludes their teaching was lost and re-teaches in panic.
    if (store && store.lastError && !memoryContext(mem)) {
      return json({ error: 'Business memory is temporarily unreadable (state store error). Your saved memory is almost certainly intact — retry in a moment.', state_error: store.lastError }, 503);
    }
    return json({ memory: mem, context_preview: memoryContext(mem) });
  }

  if (sub === '/memory' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const hasFacts = body.facts && typeof body.facts === 'object';
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!hasFacts && !note) return json({ error: 'send facts:{business_type,industry,products,audience,tone,offers} and/or a note:"…" to teach the AI' }, 400);
    try {
      const mem = await teach(env, store, { facts: body.facts || {}, note, origin: 'owner' });
      return json({ ok: true, memory: mem });
    } catch (e) {
      return json(
        { error: e?.message || 'Could not save the business memory.', state_error: store?.lastError || null },
        503
      );
    }
  }

  if (sub === '/memory/reset' && request.method === 'POST') {
    const mem = await resetMemory(store);
    return json({ ok: true, memory: mem });
  }

  // ── Everything below needs the full AI pipeline ──
  if (!state.ready) {
    return json({ error: 'mailer not fully configured', ...state }, 503);
  }

  const mc = new MailerCloud(env);

  switch (true) {
    case sub === '/tasks' && request.method === 'POST': {
      const body = await request.json().catch(() => ({}));
      const instruction = body.instruction || body.task || '';
      if (!instruction.trim()) return json({ error: 'instruction is required' }, 400);
      const task = newTask(instruction, body.source || 'api', uid);
      addEvent(task, 'Task created — queued for the AI.', 'info');
      await putTask(store, task);
      // Plan/execute in the background — the task object tracks progress
      // (poll GET /v1/mail/tasks). kept alive by waitUntil after the reply.
      // Plan/execute in the background. If another pipeline run holds the
      // lock, retry instead of waiting up to 30 min for the next cron.
      ctx.waitUntil(runWhenFree(env, task.id));
      return json({ ok: true, task: { ...task, progress: progressOf(task) } }, 201);
    }

    case sub === '/tasks' && request.method === 'GET': {
      const tasks = await listTasks(store);
      return json({ count: tasks.length, tasks: tasks.map((t) => ({ ...t, progress: progressOf(t) })) });
    }

    case sub.startsWith('/tasks/') && sub.endsWith('/cancel') && request.method === 'POST': {
      const id = sub.split('/')[2];
      const t = await getTask(store, id);
      if (!t) return json({ error: 'task not found' }, 404);
      const changed = !!cancelTaskState(t);
      if (changed) await putTask(store, t);
      return json({ ok: true, cancelled: changed, task: { ...t, progress: progressOf(t) } });
    }

    case sub.startsWith('/tasks/') && sub.endsWith('/retry') && request.method === 'POST': {
      const id = sub.split('/')[2];
      const t = await getTask(store, id);
      if (!t) return json({ error: 'task not found' }, 404);
      const reset = retryTaskState(t);
      if (!reset) {
        return json({ error: `task is ${t.status} — only failed tasks can be retried` }, 409);
      }
      await putTask(store, reset);
      ctx.waitUntil(runWhenFree(env, id));
      return json({ ok: true, task: { ...reset, progress: progressOf(reset) } });
    }

    case sub.startsWith('/tasks/') && request.method === 'DELETE': {
      const id = sub.split('/')[2];
      const t = await getTask(store, id);
      if (!t) return json({ error: 'task not found' }, 404);
      await deleteTask(store, id);
      return json({ ok: true, deleted: id });
    }

    case sub === '/run' && request.method === 'POST': {
      try {
        const result = await runPipeline(env, { trigger: 'manual', force: url.searchParams.get('force') === '1' });
        return json(result);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    case sub === '/sync' && request.method === 'POST': {
      const listId = await mc.ensureList(store);
      const contacts = await fetchCrmContacts(env, { max: parseInt(env.MAIL_MAX_SYNC || '5000', 10) });
      const suppressed = await loadSuppressions(store);
      const clean = contacts.filter((c) => !suppressed.has(c.email));
      const synced = state.dryRun ? clean.length : await mc.upsertContacts(listId, clean);
      return json({
        ok: true,
        listId,
        crmContacts: contacts.length,
        suppressed: contacts.length - clean.length,
        syncedOrWouldSync: synced,
        dryRun: state.dryRun,
      });
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
      const mem = await getMemory(store);
      syncBriefToMemory(mem, brief);
      const copy = await writeEmail(env, pseudoTask, planEmail, brief, learnings, mem);
      return json({ preview: true, dryRun: true, copy, html: renderHtml(env, copy) });
    }

    default:
      return json({ error: 'not found', routes: ['POST/GET /v1/mail/tasks', 'POST /v1/mail/tasks/:id/cancel', 'POST /v1/mail/tasks/:id/retry', 'DELETE /v1/mail/tasks/:id', 'POST /v1/mail/run', 'POST /v1/mail/sync', 'POST /v1/mail/test {to}', 'GET /v1/mail/analytics', 'GET /v1/mail/preview?task=', 'GET /v1/mail/status', 'POST /v1/mail/config', 'GET/POST /v1/mail/memory', 'POST /v1/mail/memory/reset'] }, 404);
  }
}

/* ══════════════════════ Pipeline ══════════════════════ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the pipeline as soon as the run-lock frees. A brand-new task should
 * start planning within seconds, not wait for the next cron tick — but if
 * another run is mid-flight we retry politely instead of force-stealing
 * the lock (overlapping runs could double-send).
 */
/** True when an error is a provider rate/quota wall — retrying only adds pressure. */
function isQuotaError(e) {
  const m = String(e?.message || e || '');
  return /429|RESOURCE_EXHAUSTED|Quota exceeded|rate limit/i.test(m);
}

async function runWhenFree(env, onlyTaskId, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const r = await runPipeline(env, { trigger: 'task', onlyTaskId }).catch((e) => {
      console.error('[mailer] background run failed:', e.message);
      return { error: e.message };
    });
    // A quota/rate wall means Google is actively throttling the project:
    // hammering it again in 12s turns one outage into a longer one. Bail out
    // and let the next cron tick (or the owner's manual run) take over.
    if (r?.error && isQuotaError({ message: r.error })) {
      console.warn('[mailer] background run aborted — provider quota/rate wall:', r.error);
      return { skipped: true, reason: `aborted on quota: ${r.error}` };
    }
    if (!r?.skipped) return r;
    await sleep(parseInt(env.MAIL_RUN_RETRY_MS || '12000', 10)); // lock held — retry
  }
  return { skipped: true, reason: 'pipeline stayed busy; the cron will pick this task up' };
}

/** Cron entry — called from the worker's scheduled() handler. */
export async function runMailCron(env) {
  if (stateBackendName(env) === 'none') return; // no KV, no Firestore — stay silent & cheap
  // Owner kill-switch: MAIL_CRON_ENABLED=false stops ALL autonomous runs
  // (Firestore pressure, sends) while keeping the app's manual controls.
  if (String(env.MAIL_CRON_ENABLED ?? 'true').toLowerCase() === 'false') return;
  const state = await mailConfigState(env);
  if (!state.ready) return;
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
      if (snap.learnings) await learnFromResults(store, snap.learnings, snap.campaigns || []);
      log.push(`analytics: ${snap.campaigns?.length ?? 0} campaign(s) analysed, metrics written to CRM, memory updated`);
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
    const memory = await getMemory(store);
    syncBriefToMemory(memory, brief); // AI-inferred facts fill memory gaps (owner facts always win)
    if (memory.facts.business_type) await saveMemory(store, memory);

    // 4) Plan pending tasks
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'planning') {
        try {
          await putTask(store, touch(task, { status: 'planning' }));
          const plan = await planTask(env, store, task, brief, learnings, stats, memory);
          task.plan = plan;
          task.emails = plan.emails.map((e) => ({
            seq: e.seq, sendAt: e.sendAt, subject: null, campaignId: null,
            crmCampaignId: null, status: 'planned', templateId: null,
          }));
          addEvent(task, `Plan ready: ${plan.emails.length} email(s) → up to ${plan.audience.max_recipients} recipients (segment: ${plan.audience.segment ?? 'all'})`, 'plan');
          // Remember what the owner markets about — future copy stays fresh.
          memory.notes.unshift(`[campaign] ${task.instruction.slice(0, 240)}`);
          memory.notes = memory.notes.slice(0, 20);
          await saveMemory(store, memory);
          await putTask(store, touch(task, { status: 'active' }));
          log.push(`task ${task.id}: planned ${plan.emails.length} email(s) → ≤${plan.audience.max_recipients} recipients (segment: ${plan.audience.segment ?? 'all'})`);
        } catch (e) {
          addEvent(task, `Planning failed: ${e.message}`, 'error');
          await putTask(store, touch(task, { status: 'failed', error: e.message }));
          log.push(`task ${task.id}: PLAN FAILED — ${e.message}`);
        }
      }
    }

    // 5) Execute due emails
    const nowMs = Date.now();
    for (const task of tasks) {
      if (task.status !== 'active' || !task.plan) continue;

      for (const mail of task.emails) {
        if (mail.status !== 'planned') continue;
        // Re-read the task: the owner may have cancelled or deleted it
        // while this run was in flight. Never resurrect either.
        const fresh = await getTask(store, task.id);
        if (!fresh || fresh.status === 'cancelled') {
          task.status = 'cancelled';
          log.push(`task ${task.id}: cancelled/deleted mid-run — stopping`);
          break;
        }
        const sendMs = Date.parse(mail.sendAt);
        if (!Number.isFinite(sendMs)) { mail.status = 'failed'; mail.error = 'bad sendAt'; continue; }
        if (sendMs - nowMs > lookahead) continue; // not due yet

        try {
          const planEmail = task.plan.emails.find((e) => e.seq === mail.seq);
          // Explicit recipients named in the instruction ("send to x@y.com")
          // WIN over segment selection — the owner named a person, not a
          // filter. Without this the AI's segment pick silently sent the
          // email to whatever the CRM segment happened to contain.
          const audience = pickAudience(contacts, task.plan.audience, task.plan.explicit_recipients);
          if (audience.length === 0) throw new Error('audience is empty');

          const copy = await writeEmail(env, task, planEmail, brief, learnings, memory);
          const crmCampaignId = `ai_${task.id}_${mail.seq}`;
          // personalize → the HTML carries {{first_name}} which MailerCloud
          // replaces per recipient (inactive on non-merge endpoints).
          const personalize = pickDeliveryMode(env, audience.length) === 'transactional';
          const html = renderHtml(env, copy, {
            personalize,
            // Transactional sends carry the per-recipient {{open_uid}} merge
            // var; campaign-mode opens come from MailerCloud's own reports.
            track: personalize ? { campaignId: crmCampaignId } : null,
          });

          if (dryRun) {
            mail.status = 'dry_run';
            mail.subject = copy.subject;
            mail.crmCampaignId = crmCampaignId;
            log.push(`task ${task.id} email ${mail.seq}: DRY RUN — would send "${copy.subject}" to ${audience.length} at ${mail.sendAt}`);
            continue;
          }

          // Sync recipients to the MailerCloud list first (tracking, segments,
          // and campaign-mode delivery all rely on the list existing).
          const listId = await mc.ensureList(store);
          const synced = await mc.upsertContacts(listId, audience);
          log.push(`task ${task.id} email ${mail.seq}: synced ${synced} recipient(s) to MailerCloud list ${listId}`);

          const tpl = await saveTemplate(mc, env, copy, html, `${task.id.slice(-4)} #${mail.seq}`);
          mail.templateId = tpl?.id ?? tpl?.data?.id ?? null;

          const mode = pickDeliveryMode(env, audience.length);
          let delivery;
          if (mode === 'transactional') {
            delivery = await deliverTransactional(env, store, { copy, html, audience, crmCampaignId, mail });
          } else {
            delivery = await deliverCampaign(env, mc, { copy, html, listId, mail, timezone, crmCampaignId });
          }

          mail.campaignId = delivery.campaignId ?? null;
          mail.subject = copy.subject;
          mail.status = delivery.status;
          mail.delivery = { mode, ...(delivery.summary || {}) };
          mail.recipients = audience.map((c) => c.email);
          addEvent(
            task,
            `"${copy.subject}" → ${mode} ${delivery.status}: ${delivery.summary?.sent ?? 0} delivered, ${delivery.summary?.failed ?? 0} failed, ${delivery.summary?.deferred ?? 0} deferred → ${describeRecipients(audience)}`,
            'send'
          );

          // ── Make it visible in the app: write the campaign doc ──
          const sentCount = delivery.summary?.sent ?? audience.length;
          const bounceCount = (delivery.summary?.failed ?? 0) + (delivery.summary?.deferred ?? 0);
          await upsertCampaignDoc(env, {
            id: crmCampaignId,
            fields: {
              name: `AI | ${task.id} #${mail.seq} | ${copy.subject.slice(0, 60)}`,
              channel: 'email',
              status: delivery.status === 'sent' ? 'sent' : delivery.status === 'partial' ? 'sent' : delivery.status,
              ownerId: task.createdBy || 'ai-mailer',
              teamId: env.MAIL_TEAM_ID || null,
              audienceCount: audience.length,
              subject: copy.subject,
              previewText: copy.preheader,
              // Actual recipient addresses (capped) — the owner can see WHO
              // got an email without cross-referencing MailerCloud.
              recipientsSample: audience.slice(0, 25).map((c) => c.email),
              // Send-time provider truth (accepted/failed/deferred) — the
              // analytics pull reads this as the delivery floor.
              delivery: { mode, ...(delivery.summary || {}) },
              bodyHtml: html,
              bodyPlainText: plainOf(html),
              ctaLabel: copy.cta_text,
              ctaUrl: env.MAIL_CTA_URL || env.MAIL_WEBSITE_URL || '',
              scheduleType: 'once',
              scheduledAt: mail.sendAt,
              metrics: {
                sent: sentCount,
                delivered: sentCount,
                opens: 0, clicks: 0, conversions: 0,
                bounces: bounceCount,
                unsubscribes: 0, revenue: 0,
                failed: delivery.summary?.failed ?? 0,
                deferred: delivery.summary?.deferred ?? 0,
              },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              // mailer-specific extras (Dart parser ignores unknown fields)
              source: 'ai-mailer',
              aiTaskId: task.id,
              mailercloudCampaignId: mail.campaignId,
              mailercloudTemplateId: mail.templateId,
              mailercloudListId: listId,
              deliveryMode: mode,
              delivery: delivery.summary || null,
              aiPlan: { goal: planEmail.goal, angle: planEmail.angle, tone: planEmail.tone, reasoning: String(task.plan.reasoning || '').slice(0, 500) },
            },
          });
          await logActivity(env, {
            title: `AI email ${delivery.status === 'scheduled' ? 'scheduled' : 'sent'}: ${copy.subject}`,
            description: describeDelivery(delivery, { mode, audience: audience.length, sendAt: mail.sendAt, taskId: task.id, instruction: task.instruction }),
            campaignId: crmCampaignId,
            metadata: {
              mailercloudCampaignId: mail.campaignId,
              audience: audience.length,
              mode,
              sent: delivery.summary?.sent ?? null,
              failed: delivery.summary?.failed ?? null,
            },
          });

          log.push(`task ${task.id} email ${mail.seq}: ${mode} → ${delivery.status} "${copy.subject}" (${describeDelivery(delivery, { audience: audience.length })})`);
        } catch (e) {
          mail.status = 'failed';
          mail.error = e.message;
          addEvent(task, `Email ${mail.seq} failed: ${e.message}`, 'error');
          log.push(`task ${task.id} email ${mail.seq}: SEND FAILED — ${e.message}`);
        }
      }

      if (task.status === 'cancelled') continue; // owner cancelled mid-run — do not overwrite
      const remaining = task.emails.filter((m) => m.status === 'planned');
      const failed = task.emails.filter((m) => m.status === 'failed');
      if (remaining.length === 0) {
        const finalStatus = failed.length === task.emails.length ? 'failed' : 'done';
        addEvent(task, finalStatus === 'done' ? 'All emails processed. Campaigns visible in the app.' : 'Every email failed — see email errors.', finalStatus === 'done' ? 'info' : 'error');
        await putTask(store, touch(task, { status: finalStatus }));
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

/* ══════════════════════ Delivery engines ══════════════════════ */

/**
 * Transactional engine — MailerCloud Email API, personalized mail merge,
 * 50 recipients per request, per-recipient outcome tracking, auto-
 * suppression of hard bounces/unsubs/spam reports.
 */
async function deliverTransactional(env, store, { copy, html, audience, crmCampaignId, mail }) {
  const suppressed = await loadSuppressions(store);
  const recipients = audience
    .filter((c) => !suppressed.has(c.email))
    .map((c) => ({
      name: [c.first_name, c.last_name].filter(Boolean).join(' ').slice(0, 100),
      email: c.email,
      merge_vars: {
        first_name: c.first_name || 'there',
        company: c.company_name || '',
        // Per-recipient open-tracking token, rendered into the pixel URL.
        open_uid: openToken(crmCampaignId, c.email),
      },
    }));

  const result = await sendPersonalizedBatch(env, {
    subject: copy.subject,
    html,
    text: plainOf(html),
    recipients,
    metadata: {
      messageId: `${crmCampaignId}-${mail.seq}`.slice(0, 100),
      custom: { campaign_id: crmCampaignId, source: 'nebula-ai-mailer' },
    },
  });

  if (result.suppressions.length) {
    await addSuppressions(store, result.suppressions);
    console.warn(`[mailer] suppressed ${result.suppressions.length} address(es) after provider outcomes`);
  }

  const status = result.sent === 0 && result.failed > 0
    ? 'failed'
    : result.failed > 0 || result.deferred > 0
      ? 'partial'
      : 'sent';

  return {
    status,
    campaignId: null, // Email API sends are tracked by metadata.custom.campaign_id
    summary: {
      sent: result.sent,
      deferred: result.deferred,
      failed: result.failed,
      accepted_rate: recipients.length ? +((result.sent / recipients.length) * 100).toFixed(1) : 0,
      failures: result.failures.slice(0, 25),
      endpoint: `${EMAIL_API_BASE}/email-api`,
    },
  };
}

/**
 * Campaign engine — Marketing API scheduled campaign (large audiences):
 * delivery at the AI-chosen minute, opens/clicks/unsubs tracked per campaign.
 */
async function deliverCampaign(env, mc, { copy, html, listId, mail, timezone, crmCampaignId }) {
  const campaign = await mc.createAndPublishCampaign({
    name: `Nebula AI | ${crmCampaignId} | ${copy.subject.slice(0, 60)}`,
    subject: copy.subject,
    html,
    preheader: copy.preheader,
    listId,
    scheduledAt: isoToAccountTime(mail.sendAt, timezone),
  });
  const campaignId = campaign?.id ?? campaign?.data?.id ?? null;
  if (!campaignId) throw new Error('MailerCloud campaign creation returned no id');
  return { status: 'scheduled', campaignId, summary: { mailercloud_campaign: String(campaignId), scheduled_for: mail.sendAt } };
}

function describeDelivery(delivery, { mode, audience, sendAt, taskId, instruction } = {}) {
  const s = delivery.summary || {};
  if (mode === 'transactional') {
    return [
      `Email ${sendAt ? `planned for ${sendAt}` : ''} of task ${taskId || ''}`,
      `${s.sent ?? 0} accepted, ${s.failed ?? 0} failed, ${s.deferred ?? 0} deferred of ${audience ?? '?'} recipients`,
      instruction ? `(${String(instruction).slice(0, 120)})` : '',
    ].filter(Boolean).join(' → ');
  }
  return `Campaign ${s.mailercloud_campaign || ''} scheduled for ${s.scheduled_for || sendAt} to ${audience ?? '?'} recipients`;
}

/* ══════════════════════ Helpers ══════════════════════ */

function describeRecipients(audience) {
  const emails = audience.map((c) => c.email);
  if (emails.length <= 3) return emails.join(', ');
  return `${emails.slice(0, 3).join(', ')} +${emails.length - 3} more`;
}

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
function pickAudience(contacts, audience, explicitRecipients = null) {
  // "Send an email to x@y.com" — the owner NAMED the recipient. Build the
  // audience from exactly those addresses, enriched with CRM data when the
  // address exists there (names/merge vars), so the email reaches the person
  // the owner actually named instead of whoever the segment matched.
  if (Array.isArray(explicitRecipients) && explicitRecipients.length) {
    const wanted = [...new Set(explicitRecipients.map((e) => String(e).toLowerCase()))];
    return wanted.map((email) => {
      const match = contacts.find((c) => String(c.email || '').toLowerCase() === email);
      return match || {
        email,
        first_name: '', last_name: '', company_name: '', phone: '',
        tags: [], _segment: 'explicit', _created: '', _leadScore: null,
      };
    });
  }
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
