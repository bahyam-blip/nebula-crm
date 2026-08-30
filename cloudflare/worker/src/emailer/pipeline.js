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
 *                   up to MAIL_TRANSACTIONAL_MAX (default 1000) in auto mode,
 *                   and ALWAYS for /v1/mail/test.
 *   campaign      — Marketing API scheduled campaign on a DEDICATED
 *                   per-campaign list (right tool for 1000s+).
 *
 * SCALE MODEL (Cloudflare Workers cap subrequests per invocation — 50 on
 * the free plan): nothing large sends inline any more. runPipeline only
 * PLANS + PREPARES (AI copy, audience, tracked HTML). Each email is then
 * delivered by a CHAIN of short worker invocations, each with a fresh
 * subrequest budget: POST /v1/mail/deliver (HMAC-signed self-call) sends
 * the next ≤MAIL_SEND_CHUNK private 1:1 emails, persists the sent-ledger
 * + live progress, and re-invokes itself until done. A killed chain
 * resumes from the ledger (never double-sends); the 5-min cron and the
 * app's task polling both re-kick stalled chains.
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
 * Cron: every 5 min (wrangler.toml) → runPipeline. Emails whose send time
 * falls within MAIL_LOOKAHEAD_MINUTES (default 10) are prepared and their
 * delivery chain kicked: small audiences via the Email API (private 1:1,
 * chunked), large ones as scheduled MailerCloud campaigns on a dedicated
 * list.
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
import { getBusinessProfile, saveBusinessProfile, brandFor, profileToFacts, mergeProfilePatch, normalizeStyle, TEMPLATE_STYLES } from './business.js';
import { openToken, saveTokenMap } from './track.js';

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
  const n = parseInt(env.MAIL_TRANSACTIONAL_MAX || '1000', 10);
  return Number.isFinite(n) && n > 0 ? n : 1000;
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
  const profile = await getBusinessProfile(store);
  const sender = resolveSender(env, brandFor(env, profile));
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
    brand: { name: brandFor(env, profile).name, branded: brandFor(env, profile).branded },
    delivery_mode: deliveryMode(env),
    transactional_max: transactionalMax(env),
    email_api: EMAIL_API_BASE,
  };
}

/* ── Suppression list (auto-learned from provider outcomes + unsubs) ── */

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

/** Full suppression list rows (email + why + when) for the app UI. */
async function listSuppressions(store) {
  if (!store) return [];
  const list = safeParse(await store.get(SUPPRESSION_KEY), []);
  return Array.isArray(list) ? list.slice(-5000) : [];
}

/* ── Send log (frequency capping — never spam the same person) ──────
 * Every successful individual send appends {email, at}. Audiences are
 * filtered against entries newer than MAIL_FREQ_HOURS (default 20) so a
 * contact who just got yesterday's campaign is not hit again today —
 * unless the owner explicitly named them. */

const SENTLOG_KEY = 'mail:sentlog';
const SENTLOG_CAP = 20000;

async function loadRecentSends(store, hours) {
  if (!store) return new Map();
  const log = safeParse(await store.get(SENTLOG_KEY), []);
  const cutoff = Date.now() - hours * 3600 * 1000;
  const recent = new Map();
  for (const row of log) {
    const t = Date.parse(row.at || '');
    if (Number.isFinite(t) && t >= cutoff) recent.set(row.email, t);
  }
  return recent;
}

async function appendSentLog(store, emails) {
  if (!store || !emails?.length) return;
  const log = safeParse(await store.get(SENTLOG_KEY), []);
  const at = new Date().toISOString();
  for (const email of emails) log.push({ email, at });
  await store.put(SENTLOG_KEY, JSON.stringify(log.slice(-SENTLOG_CAP)));
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
    const bp = await getBusinessProfile(store);
    const bpBrand = brandFor(env, bp);
    return json({
      ...state,
      state_error: store?.lastError || null,
      ai_model: env.SARVAM_MODEL || 'sarvam-105b',
      timezone: env.MAIL_TIMEZONE || 'Asia/Calcutta',
      business_understood: mem.facts.business_type || brief
        ? { type: mem.facts.business_type || brief?.business_type, tone: mem.facts.tone || brief?.tone, from: mem.facts.business_type ? 'memory' : (brief?.source || 'ai') }
        : false,
      memory: { facts_known: Object.values(mem.facts).filter((v) => (Array.isArray(v) ? v.length : v)).length, insights: mem.insights.length },
      business_profile: {
        business_name: bpBrand.name,
        branded: bpBrand.branded,
      },
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

  // ── Business Profile — the brand every email is sent with ──────
  // Available even when the pipeline is unconfigured: the owner sets the
  // brand first, campaigns come later. POST also teaches the AI memory
  // (owner authority) and drops the cached AI brief so the next plan
  // immediately speaks as the new brand.
  if (sub === '/business' && request.method === 'GET') {
    const profile = await getBusinessProfile(store);
    const brand = brandFor(env, profile);
    return json({
      profile,
      brand: { name: brand.name, color: brand.color, fromName: brand.fromName, signature: brand.signature, website: brand.website, branded: brand.branded, defaultStyle: brand.defaultStyle },
      template_styles: TEMPLATE_STYLES,
    });
  }

  if (sub === '/business' && request.method === 'POST') {
    if (!store) return json({ error: 'no state backend (KV or Firestore unavailable)' }, 503);
    const body = await request.json().catch(() => ({}));
    const patch = body?.profile && typeof body.profile === 'object' ? body.profile : body;
    if (!patch || typeof patch !== 'object' || Object.keys(patch).length === 0) {
      return json({ error: 'send business profile fields to save, e.g. {"business_name":"…"}' }, 400);
    }
    if (patch.default_style !== undefined && !normalizeStyle(patch.default_style) && String(patch.default_style).trim() !== '') {
      return json({ error: `default_style must be one of: ${TEMPLATE_STYLES.join(', ')}` }, 400);
    }
    let profile;
    try {
      profile = await saveBusinessProfile(store, patch);
    } catch (e) {
      return json({ error: e?.message || 'Could not save the business profile.', state_error: store?.lastError || null }, 503);
    }
    // Sync the AI: owner-authority facts + rebuild the marketing brief.
    const facts = profileToFacts(patch);
    let taught = false;
    if (Object.keys(facts).length) {
      try {
        await teach(env, store, { facts, origin: 'owner' });
        taught = true;
      } catch (e) {
        console.warn(`[mailer] business profile → memory teach failed: ${e.message}`);
      }
    }
    const brand = brandFor(env, profile);
    return json({ ok: true, profile, taught, brand: { name: brand.name, fromName: brand.fromName, signature: brand.signature, branded: brand.branded } });
  }

  // ── TEST SEND — the go-live check. Sends ONE real email right now via
  //    the transactional Email API. Needs only MAILERCLOUD_API_KEY; works
  //    regardless of dry-run (it is explicit and owner-triggered).
  if (sub === '/test' && request.method === 'POST') {
    if (!state.canSend) return json({ error: 'MAILERCLOUD_API_KEY is not configured', ...state }, 503);
    const body = await request.json().catch(() => ({}));
    const to = String(body.to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return json({ error: 'a valid "to" email address is required, e.g. {"to":"you@example.com"}' }, 400);

    const profile = await getBusinessProfile(store);
    const brand = brandFor(env, profile);
    const sender = resolveSender(env, brand);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    const bizName = brand.name;
    const copy = {
      subject: String(body.subject || '').trim() || `${bizName} test email — ${stamp}`,
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
      cta_text: brand.website ? 'Visit us' : 'Open Nebula CRM',
      closing: 'Happy sending,',
      ps: 'Re-run this test any time from the AI Email screen — it never touches your contact lists.',
    };
    const html = renderHtml(env, copy, { brand });

    const res = await sendEmail(env, {
      to: [{ name: String(body.name || '').slice(0, 100), email: to }],
      subject: copy.subject,
      html,
      brand,
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
        subject: copy.subject,
        branded: brand.branded,
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

  // ── Suppression list — who will NEVER be emailed again ─────────
  // Fed by one-click unsubscribes, provider bounces/spam reports and
  // (optionally) manual entries. Every audience is filtered through this
  // before a single email is composed.
  if (sub === '/suppressions' && request.method === 'GET') {
    const rows = await listSuppressions(store);
    return json({ ok: true, count: rows.length, suppressions: rows.slice(-500).reverse() });
  }

  if (sub === '/suppressions' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: 'a valid "email" is required' }, 400);
    await addSuppressions(store, [{ email, code: body.reason || 'manual', at: new Date().toISOString() }]);
    return json({ ok: true, suppressed: email });
  }

  if (sub === '/suppressions/remove' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: 'a valid "email" is required' }, 400);
    if (store) {
      const list = safeParse(await store.get(SUPPRESSION_KEY), []);
      const kept = list.filter((s) => s.email !== email);
      await store.put(SUPPRESSION_KEY, JSON.stringify(kept));
    }
    return json({ ok: true, removed: email });
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
      // Opportunistic resume: while the app is open and polling, a due
      // email whose delivery chain died (device closed mid-blast, worker
      // eviction) gets a fresh chain kicked — no waiting for the cron.
      // Throttled to one attempt per 45s and skipped while the planning
      // lock is held; chunk chains themselves carry their own locks.
      try {
        const lookahead = lookaheadMs(env);
        const due = tasks.some((t) => t.status === 'active' && (t.emails || []).some((m) =>
          (m.status === 'planned' || m.status === 'sending') &&
          Date.parse(m.sendAt) - Date.now() <= lookahead));
        if (due) {
          const last = safeParse(await store.get('mail:last_run'), null);
          const idle = !last || Date.now() - Date.parse(last.at || 0) > 45 * 1000;
          const lock = await store.get('mail:lock');
          const lockFree = !lock || Date.now() - Number(lock) > 4 * 60 * 1000;
          if (idle && lockFree && ctx?.waitUntil) {
            ctx.waitUntil(runWhenFree(env, null, 1).catch(() => {}));
          }
        }
      } catch { /* resume is best-effort */ }
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
        const fresh = await collectAnalytics(mc, env, store, {
          onUnsubscribers: (emails) => addSuppressions(store, emails.map((email) => ({ email, code: 'unsub', at: new Date().toISOString() }))),
        });
        await markAnalyticsPulled(store);
        return json(fresh);
      }
      return json((await getLatestAnalytics(store)) ?? { message: 'No analytics yet — call with ?refresh=1 or wait for cron.' });
    }

    case sub === '/preview' && request.method === 'GET': {
      const instruction = url.searchParams.get('task') || 'Write one engaging introduction email about our business.';
      const style = normalizeStyle(url.searchParams.get('style') || '');
      const contacts = await fetchCrmContacts(env, { max: parseInt(env.MAIL_MAX_SYNC || '5000', 10) }).catch(() => []);
      const stats = contactStats(contacts);
      const profile = await getBusinessProfile(store);
      const brief = await buildBusinessBrief(env, store, { crmStats: stats, profile });
      const learnings = (await getLatestAnalytics(store))?.learnings ?? null;
      const pseudoTask = { id: 'preview', instruction, plan: null };
      const planEmail = { seq: 1, sendAt: new Date().toISOString(), goal: instruction.slice(0, 200), angle: 'highest-open-rate hook for this audience', tone: brief.tone || 'friendly', template_style: style || profile?.default_style || 'modern' };
      const mem = await getMemory(store);
      syncBriefToMemory(mem, brief);
      const copy = await writeEmail(env, pseudoTask, planEmail, brief, learnings, mem);
      return json({ preview: true, dryRun: true, copy, html: renderHtml(env, copy, { brand: brandFor(env, profile), style: style || planEmail.template_style }) });
    }

    default:
      return json({ error: 'not found', routes: ['POST/GET /v1/mail/tasks', 'POST /v1/mail/tasks/:id/cancel', 'POST /v1/mail/tasks/:id/retry', 'DELETE /v1/mail/tasks/:id', 'POST /v1/mail/run', 'POST /v1/mail/sync', 'POST /v1/mail/test {to}', 'GET /v1/mail/analytics', 'GET /v1/mail/preview?task=&style=', 'GET /v1/mail/status', 'POST /v1/mail/config', 'GET/POST /v1/mail/business', 'GET/POST /v1/mail/memory', 'POST /v1/mail/memory/reset', 'GET/POST /v1/mail/suppressions', 'POST /v1/mail/suppressions/remove'] }, 404);
  }
}

/* ══════════════════════ Pipeline ══════════════════════ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the pipeline as soon as the run-lock frees. A brand-new task should
 * start planning within seconds, not wait for the next cron tick — but if
 * another run is mid-flight we retry politely instead of force-stealing
 * the lock (overlapping runs could double-plan). Planning runs are short
 * now (delivery happens in separate chunk invocations), so 8 × 12s is
 * ample; the 5-min cron is the safety net.
 */
/** True when an error is a provider rate/quota wall — retrying only adds pressure. */
function isQuotaError(e) {
  const m = String(e?.message || e || '');
  return /429|RESOURCE_EXHAUSTED|Quota exceeded|rate limit/i.test(m);
}

export async function runWhenFree(env, onlyTaskId, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    const r = await runPipeline(env, { trigger: 'task', onlyTaskId }).catch((e) => {
      console.error('[mailer] background run failed:', e.message);
      return { error: e.message };
    });
    // A quota/rate wall means the provider is actively throttling the project:
    // hammering it again in 12s turns one outage into a longer one. Bail out
    // and let the next cron tick (or the owner's manual run) take over.
    if (r?.error && isQuotaError({ message: r.error })) {
      console.warn('[mailer] background run aborted — provider quota/rate wall:', r.error);
      return { skipped: true, reason: `aborted on quota: ${r.error}` };
    }
    if (!r?.skipped) {
      // The kick fetches were started inside runPipeline; hold them so a
      // returning HTTP response can't cancel the first delivery chunk.
      await Promise.allSettled((r.kicks || []).filter(Boolean));
      return r;
    }
    await sleep(parseInt(env.MAIL_RUN_RETRY_MS || '12000', 10)); // lock held — retry
  }
  return { skipped: true, reason: 'pipeline stayed busy; the cron will pick this task up' };
}

/** Cron entry — called from the worker's scheduled() handler (every 5 min). */
export async function runMailCron(env, ctx = null) {
  if (stateBackendName(env) === 'none') return; // no KV, no D1 — stay silent & cheap
  // Owner kill-switch: MAIL_CRON_ENABLED=false stops ALL autonomous runs
  // (database pressure, sends) while keeping the app's manual controls.
  if (String(env.MAIL_CRON_ENABLED ?? 'true').toLowerCase() === 'false') return;
  const state = await mailConfigState(env);
  if (!state.ready) return;
  try {
    const r = await runPipeline(env, { trigger: 'cron' });
    if (r?.preparesDeferred) {
      // The analytics pull ate this run's subrequest budget — run once more
      // immediately so preparing the owner's emails isn't delayed 5 min.
      const r2 = await runPipeline(env, { trigger: 'cron-2' });
      holdKicks(ctx, r2?.kicks);
      return;
    }
    holdKicks(ctx, r?.kicks);
  } catch (e) {
    console.error('[mailer:cron]', e);
  }
}

/** Live (non-terminal) tasks in ONE D1 query. listTasks() reads every task
 *  doc individually — fine for the app's list route, fatal for the
 *  pipeline's subrequest budget as the index grows. The D1 rows wrap the
 *  task JSON in {value, expireAt} (see state.js) — unwrapped here. KV
 *  deployments fall back to the per-key reads (legacy, small volumes). */
async function listLiveTasks(env, store) {
  if (env.DB) {
    try {
      const { results } = await env.DB
        .prepare(
          `SELECT id, json FROM docs
           WHERE col = 'mail_state' AND id LIKE 'mail:task:%'
           ORDER BY updated_at DESC LIMIT 60`
        )
        .all();
      const now = Date.now();
      const out = [];
      for (const row of results || []) {
        try {
          const doc = JSON.parse(row.json);
          if (doc.expireAt && Date.parse(doc.expireAt) < now) continue; // soft TTL
          const inner = typeof doc.value === 'string' ? JSON.parse(doc.value) : doc.value;
          if (inner && ['pending', 'planning', 'active'].includes(inner.status)) out.push(inner);
        } catch { /* skip malformed */ }
      }
      return out.slice(0, 40);
    } catch (e) {
      console.warn(`[mailer] listLiveTasks D1 query failed (${e?.message || e}) — falling back`);
    }
  }
  const all = await listTasks(store);
  return all.filter((t) => ['pending', 'planning', 'active'].includes(t.status)).slice(0, 40);
}

/** Keep self-invocation fetches alive past the current response. */
function holdKicks(ctx, kicks) {
  const list = (kicks || []).filter(Boolean);
  if (!ctx?.waitUntil || !list.length) return;
  ctx.waitUntil(Promise.allSettled(list).then(() => {}));
}

export async function runPipeline(env, { trigger = 'cron', onlyTaskId = null, force = false } = {}) {
  const started = Date.now();
  const mc = new MailerCloud(env);
  const store = createStore(env);
  const { dryRun } = await dryRunEffective(env, store);
  const log = [];
  const kicks = [];

  if (!force) {
    const lock = await store.get('mail:lock');
    if (lock && Date.now() - Number(lock) < 4 * 60 * 1000) {
      return { skipped: true, reason: 'another run is in progress', lockedAt: new Date(Number(lock)).toISOString() };
    }
  }
  await store.put('mail:lock', String(Date.now()), { expirationTtl: 300 });

  try {
    const timezone = env.MAIL_TIMEZONE || 'Asia/Calcutta';
    const lookahead = lookaheadMs(env);
    const maxSync = parseInt(env.MAIL_MAX_SYNC || '5000', 10);

    // 1) Refresh analytics + AI learnings when due
    let analyticsPulled = false;
    if (await analyticsDue(store, parseInt(env.MAIL_ANALYTICS_INTERVAL_HOURS || '20', 10))) {
      analyticsPulled = true;
      log.push('analytics: pulling campaign performance…');
      const snap = await collectAnalytics(mc, env, store, {
        // Provider-reported unsubscribes (campaign mode) join the suppression
        // list — same as one-click unsubs from transactional sends.
        onUnsubscribers: (emails) => addSuppressions(store, emails.map((email) => ({ email, code: 'unsub', at: new Date().toISOString() }))),
      });
      await markAnalyticsPulled(store);
      if (snap.learnings) await learnFromResults(store, snap.learnings, snap.campaigns || []);
      log.push(`analytics: ${snap.campaigns?.length ?? 0} campaign(s) analysed, metrics written to CRM, memory updated`);
    }
    const learnings = (await getLatestAnalytics(store))?.learnings ?? null;

    // 2) LIVE tasks in one query — the 5-min cron must stay a cheap no-op
    //    when there is nothing to plan or deliver.
    let tasks = await listLiveTasks(env, store);
    if (onlyTaskId) tasks = tasks.filter((t) => t.id === onlyTaskId);
    if (!tasks.length) {
      await store.put('mail:last_run', JSON.stringify({ at: new Date().toISOString(), trigger, dryRun, log: ['idle — no live tasks'] }));
      return { ok: true, trigger, dryRun, durationMs: Date.now() - started, log, kicks };
    }

    // 3) Audience stats for the planner — the CRM contacts collection IS
    //    the email list.
    const contacts = await fetchCrmContacts(env, { max: maxSync });
    log.push(`crm: ${contacts.length} emailable contact(s) loaded`);
    const stats = contactStats(contacts);

    // 4) Understand the business (state-cached ~7 days) — learns from the
    //    owner profile, the CRM data itself, and past task instructions.
    const profile = await getBusinessProfile(store);
    const brand = brandFor(env, profile);
    const recentInstructions = tasks
      .slice(0, 5)
      .map((t) => t.instruction)
      .filter(Boolean);
    const brief = await buildBusinessBrief(env, store, { crmStats: stats, recentInstructions, profile });
    const memory = await getMemory(store);
    syncBriefToMemory(memory, brief); // AI-inferred facts fill memory gaps (owner facts always win)
    if (memory.facts.business_type) await saveMemory(store, memory);

    // 5) Plan pending tasks
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

    // 6) PREPARE + DELIVER — each phase runs in ITS OWN worker invocation.
    //
    // Why: Cloudflare Workers cap subrequests per invocation (50 on the
    // free plan). A planning run that ALSO pulled contacts, wrote AI copy
    // and kicked a chain blew the cap at request ~50 — the kick died and
    // every large campaign with it. So this run only PLANS and KICKS:
    //   plan run (here)      → analytics + live tasks + contact stats + plan
    //   prepare invocation   → AI copy + audience + tracked HTML (fresh budget)
    //   chunk invocations    → ≤25 private 1:1 sends each (fresh budget)
    // A killed chain resumes from the sent-ledger; never double-sends.
    const nowMs = Date.now();
    let prepareKicks = 0;
    for (const task of tasks) {
      if (task.status !== 'active' || !task.plan) continue;

      for (const mail of task.emails) {
        if (mail.status !== 'planned' && mail.status !== 'sending') continue;
        // Re-read the task: the owner may have cancelled or deleted it,
        // and concurrent chains advance it while this loop runs.
        const fresh = await getTask(store, task.id);
        if (!fresh || fresh.status === 'cancelled') {
          task.status = 'cancelled';
          log.push(`task ${task.id}: cancelled/deleted mid-run — stopping`);
          break;
        }
        const fm = (fresh.emails || []).find((m) => m.seq === mail.seq) || mail;
        const sendMs = Date.parse(fm.sendAt || mail.sendAt);
        if (!Number.isFinite(sendMs)) {
          // Write through the FRESH read — never from a stale copy.
          fm.status = 'failed';
          fm.error = 'bad sendAt';
          await putTask(store, touch(fresh, {}));
          continue;
        }
        if (sendMs - nowMs > lookahead) continue; // not due yet

        if (fm.exec) {
          // Already prepared (copy written, audience resolved): make sure a
          // chain is running — the app's task polling lands here often.
          if (!(await chainAlive(store, task.id, mail.seq))) {
            kicks.push(kickChain(env, {
              action: 'chunk', taskId: task.id, seq: mail.seq,
              from: fm.exec.mode === 'campaign' ? (fm.exec.cursor || 0) : (Array.isArray(fm.sentEmails) ? fm.sentEmails.length : 0),
            }));
            log.push(`task ${task.id} email ${mail.seq}: chain resumed at ${fm.exec.mode === 'campaign' ? `sync cursor ${fm.exec.cursor || 0}` : `${(fm.sentEmails || []).length} sent`}`);
          }
          continue;
        }

        // Not prepared yet: hand it to a dedicated PREPARE invocation with
        // its own subrequest budget (AI copy + audience + render + kick).
        if (prepareKicks < 5) {
          kicks.push(kickChain(env, { action: 'prepare', taskId: task.id, seq: mail.seq }));
          prepareKicks++;
          log.push(`task ${task.id} email ${mail.seq}: queued for preparation (AI copy + audience)`);
        } else {
          log.push(`task ${task.id} email ${mail.seq}: prepare deferred — budget for this run is used; the next tick continues`);
        }
      }

      if (task.status === 'cancelled') continue; // owner cancelled mid-run — do not overwrite
      await finalizeTaskIfComplete(store, task);
    }

    await store.put('mail:last_run', JSON.stringify({ at: new Date().toISOString(), trigger, dryRun, log }));
    return { ok: true, trigger, dryRun, durationMs: Date.now() - started, log, kicks };
  } finally {
    await store.delete('mail:lock');
  }
}

/* ══════════════════ Delivery chain (subrequest-safe) ══════════════════
 *
 * prepareEmail   — one due email: resolve the audience (suppression is
 *                  absolute; the frequency cap yields to an explicit owner
 *                  count), write the copy ONCE, render the personalized
 *                  tracked HTML, persist the audience in slices, and kick
 *                  the chain.
 * deliverInternal— the HMAC-protected self-invocation target. action
 *                  "chunk" runs ONE batch of private 1:1 sends (≤25) and
 *                  re-invokes itself until the audience is exhausted, then
 *                  finalizes; action "prepare" plans/prepare the task's
 *                  next due email (sequence advance).
 * Each invocation owns a fresh subrequest budget, so audiences of
 * hundreds/thousands complete in minutes — not die at #45.
 */

const AUD_SLICE = 400; // rows per state row (~35KB JSON — under D1's 100KB statement limit)

function lookaheadMs(env) {
  const min = parseInt(env.MAIL_LOOKAHEAD_MINUTES ?? '', 10);
  if (Number.isFinite(min) && min > 0) return min * 60 * 1000;
  const hrs = parseInt(env.MAIL_LOOKAHEAD_HOURS ?? '10', 10);
  return (Number.isFinite(hrs) && hrs > 0 ? hrs : 10) * 3600 * 1000;
}

function sendChunkSize(env) {
  const n = parseInt(env.MAIL_SEND_CHUNK || '25', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 25;
}

function chainKeyOf(taskId, seq) {
  return `mail:chain:ai_${taskId}_${seq}`;
}

/** Chain heartbeat: written at PREPARE time and renewed by every chunk
 *  (and mid-chunk via send progress), so the pipeline never mistakes a
 *  running chain for a dead one. Stale (>100s) = the runner died. */
async function renewChain(store, taskId, seq, from) {
  await store.put(chainKeyOf(taskId, seq), JSON.stringify({ at: Date.now(), from }), { expirationTtl: 300 });
}

async function chainAlive(store, taskId, seq) {
  const raw = await store.get(chainKeyOf(taskId, seq));
  if (!raw) return false;
  const v = safeParse(raw, null);
  const at = v && typeof v === 'object' ? Number(v.at) : Number(raw);
  return Number.isFinite(at) && Date.now() - at < 100 * 1000;
}

async function saveAudience(store, crmCampaignId, rows) {
  const slices = Math.max(1, Math.ceil(rows.length / AUD_SLICE));
  await store.put(`mail:aud:${crmCampaignId}`, JSON.stringify({ count: rows.length, slices }));
  for (let i = 0; i < slices; i++) {
    await store.put(`mail:aud:${crmCampaignId}:${i}`, JSON.stringify(rows.slice(i * AUD_SLICE, (i + 1) * AUD_SLICE)));
  }
}

async function loadAudience(store, crmCampaignId) {
  const head = safeParse(await store.get(`mail:aud:${crmCampaignId}`), null);
  if (!head || !head.slices) return [];
  const rows = [];
  for (let i = 0; i < head.slices; i++) {
    rows.push(...safeParse(await store.get(`mail:aud:${crmCampaignId}:${i}`), []));
  }
  return rows;
}

async function clearAudience(store, crmCampaignId) {
  const head = safeParse(await store.get(`mail:aud:${crmCampaignId}`), null);
  await store.delete(`mail:aud:${crmCampaignId}`);
  if (head) for (let i = 0; i < head.slices; i++) await store.delete(`mail:aud:${crmCampaignId}:${i}`);
}

/* ── HMAC for the self-invocation endpoint ───────────────────────────
 * The chain talks to the worker's own /v1/mail/deliver route. The proof
 * is HMAC(taskId|seq|action, MAILERCLOUD_API_KEY) — the key never leaves
 * the worker, so nobody outside can forge a kick, and a replayed one is
 * harmless (the send ledger makes every chunk idempotent). */

async function runSig(env, s) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(env.MAILERCLOUD_API_KEY || 'nebula-unconfigured')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(s)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyRunSig(env, s, sig) {
  if (!env.MAILERCLOUD_API_KEY || !sig) return false;
  const want = await runSig(env, s);
  const a = new TextEncoder().encode(want);
  const b = new TextEncoder().encode(String(sig));
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function kickChain(env, { action, taskId, seq = '', from = null }) {
  const base = String(env.MAIL_SELF_URL || '').replace(/\/+$/, '');
  if (!base) {
    console.warn('[mailer] MAIL_SELF_URL not set — the delivery chain cannot self-continue; the cron will resume this task');
    return null;
  }
  return (async () => {
    try {
      const sig = await runSig(env, `${action}|${taskId}|${seq}`);
      const res = await fetch(`${base}/v1/mail/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-nebula-deliver': sig },
        body: JSON.stringify({ action, taskId, seq, from }),
      });
      return res.status;
    } catch (e) {
      console.warn(`[mailer] chain kick ${action} ${taskId}/${seq} failed: ${e?.message || e}`);
      return null;
    }
  })();
}

/** Resolve the audience for one planned email.
 *  Suppression (unsubscribed/bounced) is ABSOLUTE — never bypassed.
 *  The recent-send frequency cap is advisory: when the owner asked for a
 *  count the fresh pool can't reach, recently-emailed contacts top it up. */
async function resolveAudience({ contacts, plan, explicit, suppressed, env, store }) {
  if (Array.isArray(explicit) && explicit.length) {
    const rows = pickAudience(contacts, plan.audience, explicit);
    const clean = rows.filter((c) => !suppressed.has(c.email));
    return { audience: clean, heldBack: rows.length - clean.length, toppedUp: 0 };
  }
  const asked = Math.max(1, parseInt(plan.audience?.max_recipients, 10) || contacts.length || 0);
  // Uncapped-ish pool so a top-up can reach past the cap (freshest first).
  const pool = pickAudience(
    contacts,
    { segment: plan.audience?.segment ?? null, max_recipients: Math.min(asked * 3 + 100, contacts.length || 1) },
    null
  );
  const clean = pool.filter((c) => !suppressed.has(c.email));
  const freqHours = parseInt(env.MAIL_FREQ_HOURS || '20', 10);
  const recent = await loadRecentSends(store, freqHours);
  const fresh = clean.filter((c) => !recent.has(c.email));
  const audience = fresh.slice(0, asked);
  let toppedUp = 0;
  // Top-up ONLY when the owner's own words asked for a count ("send to 200
  // contacts", "email everyone") the fresh pool can't reach. Default tasks
  // keep the cap: never re-blast last night's audience by accident.
  if (plan.audience?.owner_specified && audience.length < Math.min(asked, clean.length)) {
    const top = clean.filter((c) => recent.has(c.email)).slice(0, Math.min(asked, clean.length) - audience.length);
    toppedUp = top.length;
    audience.push(...top);
  }
  return { audience, heldBack: clean.length ? pool.length - clean.length : 0, toppedUp };
}

/** Prepare one due email for delivery; returns the chain kick (or null). */
async function prepareEmail(env, store, mc, { task, mail, contacts, brief, memory, learnings, brand, dryRun }) {
  const planEmail = task.plan.emails.find((e) => e.seq === mail.seq) || {};
  const suppressed = await loadSuppressions(store);
  const explicit = Array.isArray(task.plan.explicit_recipients) && task.plan.explicit_recipients.length
    ? task.plan.explicit_recipients
    : null;
  const { audience, heldBack, toppedUp } = await resolveAudience({ contacts, plan: task.plan, explicit, suppressed, env, store });

  if (!audience.length) {
    throw new Error(heldBack > 0
      ? `all ${heldBack} matching contact(s) are unsubscribed or bounced — remove them from the suppression list to email them again`
      : 'audience is empty — no contact matches this task');
  }
  if (heldBack > 0) addEvent(task, `${heldBack} contact(s) skipped: unsubscribed or bounced. They will never be emailed.`, 'info');

  const crmCampaignId = `ai_${task.id}_${mail.seq}`;
  const mode = pickDeliveryMode(env, audience.length);

  // ── Copy (written ONCE per email, stored on the task doc) ──
  if (!mail.subject || !mail.html) {
    const copy = await writeEmail(env, task, planEmail, brief, learnings, memory);
    const personalize = mode === 'transactional';
    const html = renderHtml(env, copy, {
      personalize,
      track: personalize ? { campaignId: crmCampaignId, wrap: true, unsub: true } : null,
      brand,
      style: planEmail.template_style,
    });
    mail.subject = copy.subject;
    mail.copy = copy;
    mail.html = html;
    if (!dryRun && String(env.MC_CREATE_TEMPLATES ?? 'true') !== 'false') {
      try {
        const tpl = await saveTemplate(mc, env, copy, html, `${task.id.slice(-4)} #${mail.seq}`);
        mail.templateId = tpl?.id ?? tpl?.data?.id ?? null;
      } catch (e) {
        console.warn(`[mailer] template save failed (non-fatal): ${e.message}`);
      }
    }
  }

  if (dryRun) {
    mail.status = 'dry_run';
    mail.exec = { mode, phase: 'done', audienceCount: audience.length };
    addEvent(task, `DRY RUN — would send "${mail.subject}" to ${audience.length} recipient(s) at ${mail.sendAt}.`, 'info');
    await putTask(store, touch(task, {})); // persist — nothing else writes this state
    return null;
  }

  // Persist the resolved audience (compact rows, sliced for D1 limits).
  await saveAudience(store, crmCampaignId, audience.map(toAudienceRow));

  if (mode === 'campaign') {
    // Very large audiences: a dedicated MailerCloud list is filled across
    // several sync invocations, then the campaign is scheduled on it.
    mail.exec = { mode, phase: 'sync', cursor: 0, audienceCount: audience.length, startedAt: new Date().toISOString() };
    mail.delivery = { mode, sent: 0, failed: 0, deferred: 0, synced: 0 };
  } else {
    mail.exec = { mode: 'transactional', phase: 'send', audienceCount: audience.length, startedAt: new Date().toISOString() };
    mail.delivery = { mode: 'transactional', sent: 0, failed: 0, deferred: 0 };
  }
  mail.status = 'sending';
  addEvent(task, `Prepared "${mail.subject}" → ${audience.length} recipient(s) via ${mail.exec.mode}${toppedUp ? ` (${toppedUp} recently-emailed included to reach your count — unsubs are always excluded)` : ''}. Sending in batches…`, 'send');
  // Chain heartbeat starts NOW (from = -1 sentinel: no real chunk runs at
  // cursor −1, so the first chunk takes over cleanly) — before this run
  // finishes, so the run's own finalization can't mistake the just-kicked
  // chain for a dead one.
  await renewChain(store, task.id, mail.seq, -1);
  await putTask(store, touch(task, {}));
  // The kick names the CURRENT ledger count — a resumed (crashed) task's
  // ledger is already non-zero, and a from=0 kick would fence itself out.
  const from = Array.isArray(mail.sentEmails) ? mail.sentEmails.length : 0;
  return kickChain(env, { action: 'chunk', taskId: task.id, seq: mail.seq, from });
}

function toAudienceRow(c) {
  return {
    email: c.email,
    name: [c.first_name, c.last_name].filter(Boolean).join(' ').slice(0, 100),
    first_name: (c.first_name || '').trim() || 'there',
    last_name: c.last_name || '',
    company: c.company_name || '',
  };
}

/** HMAC-verified self-invocation target (routed before auth in index.js). */
export async function deliverInternal(env, payload, ctx = { waitUntil: () => {} }) {
  const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
  if (!store) return json({ error: 'no state backend' }, 503);
  const action = String(payload?.action || 'chunk');
  const taskId = String(payload?.taskId || '');
  const seq = parseInt(payload?.seq, 10) || 0;
  const from = Number.isFinite(Number(payload?.from)) ? Number(payload.from) : null;
  try {
    if (!taskId) return json({ error: 'taskId required' }, 400);
    if (action === 'prepare') {
      if (seq > 0) {
        // Dedicated PREPARE invocation: AI copy + audience + tracked HTML
        // with its OWN subrequest budget, then the first chunk kick.
        const r = await runPrepare(env, store, taskId, seq);
        holdKicks(ctx, r?.kick ? [r.kick] : []);
        return json({ ok: true, ...r, kick: undefined });
      }
      // Task-level advance (legacy/compat): plan the next due email.
      const r = await runPipeline(env, { trigger: 'chain', onlyTaskId: taskId });
      holdKicks(ctx, r?.kicks);
      return json({ ok: true, ...(r.skipped ? { skipped: r.reason } : { log: r.log }) });
    }
    const r = await runChunkDelivery(env, store, { taskId, seq, from, ctx });
    return json({ ok: true, ...r });
  } catch (e) {
    console.error(`[mailer:deliver] ${action} ${taskId}/${seq} failed:`, e?.stack || e);
    // Never leave an email stuck in 'sending' — mark it failed so the
    // owner can retry (the sent-ledger guarantees no double-sends).
    try {
      const task = await getTask(store, taskId);
      const mail = task && (task.emails || []).find((m) => m.seq === seq);
      if (mail && mail.status === 'sending') {
        mail.status = 'failed';
        mail.error = String(e?.message || e).slice(0, 300);
        if (task.status === 'active') {
          addEvent(task, `Delivery chain error: ${e?.message || e}`, 'error');
          await putTask(store, touch(task, {}));
          await finalizeTaskIfComplete(store, task);
        }
      }
    } catch { /* best effort */ }
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

/** Dedicated PREPARE invocation (own subrequest budget): load context,
 *  resolve the audience, write the AI copy once, persist the audience and
 *  hand off to the first delivery chunk. */
async function runPrepare(env, store, taskId, seq) {
  const task = await getTask(store, taskId);
  if (!task || task.status === 'cancelled') return { skipped: 'task gone or cancelled' };
  const mail = (task.emails || []).find((m) => m.seq === seq);
  if (!mail || !['planned', 'sending'].includes(mail.status)) return { skipped: 'nothing to prepare' };
  if (mail.exec) return { skipped: 'already prepared' };

  const mc = new MailerCloud(env);
  const { dryRun } = await dryRunEffective(env, store);
  const maxSync = parseInt(env.MAIL_MAX_SYNC || '5000', 10);
  const contacts = await fetchCrmContacts(env, { max: maxSync });
  const brief = await buildBusinessBrief(env, store, { crmStats: contactStats(contacts), recentInstructions: [task.instruction] });
  const memory = await getMemory(store);
  const learnings = (await getLatestAnalytics(store))?.learnings ?? null;
  const profile = await getBusinessProfile(store);
  const brand = brandFor(env, profile);
  try {
    const kick = await prepareEmail(env, store, mc, { task, mail, contacts, brief, memory, learnings, brand, dryRun });
    return { prepared: true, kick };
  } catch (e) {
    // Persist the failure through the fresh task object we hold.
    mail.status = 'failed';
    mail.error = String(e?.message || e).slice(0, 300);
    addEvent(task, `Email ${seq} failed: ${e?.message || e}`, 'error');
    await putTask(store, touch(task, {}));
    await finalizeTaskIfComplete(store, task);
    return { failed: String(e?.message || e) };
  }
}

async function runChunkDelivery(env, store, { taskId, seq, from, ctx }) {
  const task = await getTask(store, taskId);
  if (!task || task.status === 'cancelled') return { skipped: 'task gone or cancelled' };
  const mail = (task.emails || []).find((m) => m.seq === seq);
  // 'planned' with a live exec = prepared and mid-chain (a racing writer
  // may have re-labelled it) — still deliverable; the heartbeat decides.
  if (!mail || !mail.exec || mail.exec.phase === 'done' || !['sending', 'planned'].includes(mail.status)) {
    return { skipped: 'nothing to deliver' };
  }
  const crmCampaignId = `ai_${taskId}_${seq}`;
  // Cursor idempotence: the kick names the sent-count (or sync cursor) it
  // expects. If the ledger already advanced past it, this kick is a stale
  // duplicate — skip (this is what makes a kicked-twice chain never
  // double-send). A same-cursor CONCURRENT chunk is fenced by the lock.
  const current = mail.exec.mode === 'campaign'
    ? (mail.exec.cursor || 0)
    : (Array.isArray(mail.sentEmails) ? mail.sentEmails.length : 0);
  if (from !== null && from !== current) return { skipped: `stale kick (cursor ${from} ≠ ${current})` };
  const lockRaw = await store.get(chainKeyOf(taskId, seq));
  const lock = safeParse(lockRaw, null);
  const lockFrom = lock && typeof lock === 'object' ? Number(lock.from) : NaN;
  const lockAt = lock && typeof lock === 'object' ? Number(lock.at) : Number(lockRaw);
  const lockFresh = Number.isFinite(lockAt) && Date.now() - lockAt < 100 * 1000;
  if (lockFresh && lockFrom === current) return { skipped: 'another chunk is mid-flight at this cursor' };
  await renewChain(store, taskId, seq, current);

  const mc = new MailerCloud(env);
  if (mail.exec.mode === 'campaign') {
    return campaignChunk(env, store, mc, { task, mail, ctx, crmCampaignId });
  }
  return transactionalChunk(env, store, mc, { task, mail, ctx, crmCampaignId });
}

/* ── Transactional chunk: ≤N private 1:1 sends per invocation ────── */
async function transactionalChunk(env, store, mc, { task, mail, ctx, crmCampaignId }) {
  const suppressed = await loadSuppressions(store);
  const already = new Set(Array.isArray(mail.sentEmails) ? mail.sentEmails : []);
  const rows = await loadAudience(store, crmCampaignId);
  const pending = rows.filter((r) => !suppressed.has(r.email) && !already.has(r.email));
  if (!pending.length) {
    return finishTransactional(env, store, { task, mail, crmCampaignId, ctx });
  }

  const slice = pending.slice(0, sendChunkSize(env));
  const tokenMap = {};
  const recipients = slice.map((r) => {
    const token = openToken(crmCampaignId, r.email);
    tokenMap[token] = r.email;
    return {
      name: r.name || '',
      email: r.email,
      merge_vars: {
        first_name: r.first_name || 'there',
        last_name: r.last_name || '',
        company: r.company || '',
        open_uid: token,
      },
    };
  });
  // MERGES — earlier batches' unsubscribe attribution survives.
  await saveTokenMap(env, crmCampaignId, tokenMap);

  const brand = brandFor(env, await getBusinessProfile(store));
  const result = await sendPersonalizedBatch(env, {
    subject: mail.subject,
    html: mail.html,
    text: plainOf(mail.html || ''),
    recipients,
    brand,
    metadata: {
      messageId: crmCampaignId.slice(0, 100),
      custom: { campaign_id: crmCampaignId, source: 'nebula-ai-mailer' },
    },
    // Keep the chain heartbeat fresh while sends run — a slow provider
    // (retries with 30s backoffs) must never look like a dead chain.
    // already.size IS this chunk's cursor (the ledger at chunk start).
    onProgress: async () => {
      await renewChain(store, task.id, mail.seq, already.size);
    },
  });

  if (result.suppressions.length) {
    await addSuppressions(store, result.suppressions);
  }

  const ledger = new Set([...already, ...result.sentEmails]);
  mail.sentEmails = [...ledger];
  mail.delivery.sent = ledger.size;
  mail.delivery.failed = (mail.delivery.failed || 0) + result.failed;
  mail.delivery.deferred = (mail.delivery.deferred || 0) + result.deferred;
  addEvent(
    task,
    `Batch: +${result.sent} delivered — total ${mail.delivery.sent}/${mail.exec.audienceCount}${result.failed ? `, ${result.failed} failed` : ''}.`,
    'send'
  );
  await appendSentLog(store, result.sentEmails);
  await putTask(store, touch(task, {}));

  if (pending.length > slice.length) {
    // Next chunk takes the lock over by cursor — no delete-gap, so a
    // concurrent pipeline run can never see a heartbeat-less chain.
    holdKicks(ctx, [kickChain(env, { action: 'chunk', taskId: task.id, seq: mail.seq, from: ledger.size })]);
    return { sent: result.sent, remaining: pending.length - slice.length };
  }
  return finishTransactional(env, store, { task, mail, crmCampaignId, ctx });
}

async function finishTransactional(env, store, { task, mail, crmCampaignId, ctx }) {
  const sentCount = (mail.sentEmails || []).length;
  const failedCount = mail.delivery.failed || 0;
  const deferredCount = mail.delivery.deferred || 0;
  mail.status = sentCount === 0 && failedCount > 0 ? 'failed' : failedCount + deferredCount > 0 ? 'partial' : 'sent';
  mail.exec.phase = 'done';
  mail.campaignId = null; // Email API sends are tracked by metadata.custom.campaign_id
  mail.delivery.accepted_rate = sentCount + failedCount + deferredCount
    ? +((sentCount / (sentCount + failedCount + deferredCount)) * 100).toFixed(1)
    : 0;
  addEvent(task, `"${mail.subject}" complete: ${sentCount} delivered, ${failedCount} failed, ${deferredCount} deferred of ${mail.exec.audienceCount}.`, 'send');
  // Persist the terminal state EXPLICITLY — finalizeTaskIfComplete below
  // only writes when the task completes or a dead chain is requeued, and
  // an unpersisted 'sent' gets re-prepared by the next tick.
  await putTask(store, touch(task, {}));

  await writeCampaignDoc(env, store, { task, mail, crmCampaignId, mode: 'transactional', audienceCount: mail.exec.audienceCount, listId: null });
  await clearAudience(store, crmCampaignId);
  await store.delete(chainKeyOf(task.id, mail.seq));
  await finalizeTaskIfComplete(store, task);
  // Advance the sequence: the NEXT due, not-yet-prepared email gets its
  // own prepare invocation (no-op when nothing is due — the cron covers it).
  const nextDue = (task.emails || []).find((m) => m.status === 'planned' && !m.exec
    && Number.isFinite(Date.parse(m.sendAt)) && Date.parse(m.sendAt) - Date.now() <= lookaheadMs(env));
  holdKicks(ctx, nextDue ? [kickChain(env, { action: 'prepare', taskId: task.id, seq: nextDue.seq })] : []);
  return { done: true, sent: sentCount, failed: failedCount, deferred: deferredCount };
}

/* ── Campaign chunk: sync the dedicated list, then schedule ──────── */
async function campaignChunk(env, store, mc, { task, mail, ctx, crmCampaignId }) {
  const cacheKey = `mc:clist:${crmCampaignId}`;
  let listId = await store.get(cacheKey);
  if (!listId) {
    const created = await mc.createList(`AI ${crmCampaignId} (${mail.exec.audienceCount})`.slice(0, 78));
    listId = String(created?.id ?? created?.data?.id ?? '');
    if (!listId) throw new Error('MailerCloud list creation returned no id');
    await store.put(cacheKey, listId, { expirationTtl: 60 * 60 * 24 * 7 });
    console.log(`[mailer] dedicated list ${listId} for ${crmCampaignId} (${mail.exec.audienceCount} recipients)`);
  }

  const timezone = env.MAIL_TIMEZONE || 'Asia/Calcutta';
  if (mail.exec.phase === 'sync') {
    // Re-derive the exact audience (fresh contacts, same deterministic
    // order + guards) and upload the next slice to the dedicated list.
    const contacts = await fetchCrmContacts(env, { max: parseInt(env.MAIL_MAX_SYNC || '5000', 10) });
    const suppressed = await loadSuppressions(store);
    const explicit = Array.isArray(task.plan.explicit_recipients) && task.plan.explicit_recipients.length
      ? task.plan.explicit_recipients
      : null;
    const { audience } = await resolveAudience({ contacts, plan: task.plan, explicit, suppressed, env, store });
    const rows = audience.map(toAudienceRow);
    const syncRows = Math.max(200, parseInt(env.MAIL_SYNC_ROWS || '1000', 10));
    const slice = rows.slice(mail.exec.cursor, mail.exec.cursor + syncRows);
    if (slice.length) {
      await mc.upsertContacts(listId, slice);
      mail.exec.cursor += slice.length;
      mail.delivery.synced = mail.exec.cursor;
      addEvent(task, `Audience sync: ${mail.exec.cursor}/${mail.exec.audienceCount} uploaded to the campaign list.`, 'send');
      await putTask(store, touch(task, {}));
    }
    if (mail.exec.cursor < Math.min(rows.length, mail.exec.audienceCount)) {
      await renewChain(store, task.id, mail.seq, mail.exec.cursor);
      holdKicks(ctx, [kickChain(env, { action: 'chunk', taskId: task.id, seq: mail.seq, from: mail.exec.cursor })]);
      return { synced: mail.exec.cursor, remaining: Math.min(rows.length, mail.exec.audienceCount) - mail.exec.cursor };
    }
    mail.exec.phase = 'campaign';
    await putTask(store, touch(task, {}));
  }

  if (mail.exec.phase === 'campaign') {
    const sendMs = Date.parse(mail.sendAt);
    // MailerCloud rejects past timestamps: once the chosen minute slipped
    // by during the sync, publish immediately instead.
    const scheduledAt = Number.isFinite(sendMs) && sendMs - Date.now() > 3 * 60 * 1000
      ? isoToAccountTime(mail.sendAt, timezone)
      : null;
    const brand = brandFor(env, await getBusinessProfile(store));
    const campaign = await mc.createAndPublishCampaign({
      name: `AI | ${crmCampaignId} | ${String(mail.subject).slice(0, 60)}`,
      subject: mail.subject,
      html: mail.html,
      preheader: mail.copy?.preheader,
      listId,
      scheduledAt,
      brand,
    });
    const campaignId = campaign?.id ?? campaign?.data?.id ?? null;
    if (!campaignId) throw new Error('MailerCloud campaign creation returned no id');
    mail.campaignId = campaignId;
    mail.status = 'scheduled';
    mail.exec.phase = 'done';
    mail.delivery = { mode: 'campaign', mailercloud_campaign: String(campaignId), scheduled_for: mail.sendAt, list: listId, synced: mail.exec.audienceCount };
    addEvent(task, `MailerCloud campaign ${campaignId} ${scheduledAt ? `scheduled for ${mail.sendAt}` : 'publishing now'} → ${mail.exec.audienceCount} recipient(s). Opens/clicks/unsubs flow back via analytics.`, 'send');
    // Persist the terminal state explicitly (same reason as transactional).
    await putTask(store, touch(task, {}));

    await writeCampaignDoc(env, store, { task, mail, crmCampaignId, mode: 'campaign', audienceCount: mail.exec.audienceCount, listId });
    await clearAudience(store, crmCampaignId);
    await store.delete(chainKeyOf(task.id, mail.seq));
    await finalizeTaskIfComplete(store, task);
    const nextDue = (task.emails || []).find((m) => m.status === 'planned' && !m.exec
      && Number.isFinite(Date.parse(m.sendAt)) && Date.parse(m.sendAt) - Date.now() <= lookaheadMs(env));
    holdKicks(ctx, nextDue ? [kickChain(env, { action: 'prepare', taskId: task.id, seq: nextDue.seq })] : []);
    return { scheduled: true, campaignId: String(campaignId) };
  }
  return { skipped: 'unknown campaign phase' };
}

/** The campaign doc + activity entry that make a finished email visible in the app. */
async function writeCampaignDoc(env, store, { task, mail, crmCampaignId, mode, audienceCount, listId }) {
  try {
    const sentCount = mode === 'campaign' ? audienceCount : (mail.sentEmails || []).length;
    const bounceCount = (mail.delivery.failed || 0) + (mail.delivery.deferred || 0);
    const status = mail.status === 'sent' || mail.status === 'scheduled' ? 'sent' : mail.status === 'partial' ? 'sent' : mail.status;
    const html = mail.html || '';
    const copy = mail.copy || {};
    const planEmail = task.plan?.emails?.find((e) => e.seq === mail.seq) || {};
    const brand = brandFor(env, await getBusinessProfile(store));
    const audienceRows = await loadAudience(store, crmCampaignId);
    await upsertCampaignDoc(env, {
      id: crmCampaignId,
      fields: {
        name: `AI | ${task.id} #${mail.seq} | ${String(mail.subject).slice(0, 60)}`,
        channel: 'email',
        status,
        ownerId: task.createdBy || 'ai-mailer',
        teamId: env.MAIL_TEAM_ID || null,
        audienceCount,
        subject: mail.subject,
        previewText: copy.preheader || '',
        recipientsSample: audienceRows.slice(0, 25).map((r) => r.email),
        delivery: {
          mode,
          sent: sentCount,
          failed: mail.delivery.failed || 0,
          deferred: mail.delivery.deferred || 0,
          ...(mode === 'campaign' ? { mailercloud_campaign: String(mail.campaignId || ''), scheduled_for: mail.sendAt, list: listId } : {}),
        },
        bodyHtml: html,
        bodyPlainText: plainOf(html),
        ctaLabel: copy.cta_text || '',
        ctaUrl: (copy.cta_url && /^https?:\/\//i.test(copy.cta_url) ? copy.cta_url : brand.ctaUrl) || env.MAIL_CTA_URL || env.MAIL_WEBSITE_URL || '',
        scheduleType: 'once',
        scheduledAt: mail.sendAt,
        metrics: {
          sent: sentCount,
          delivered: sentCount,
          opens: 0, clicks: 0, conversions: 0,
          bounces: bounceCount,
          unsubscribes: 0, revenue: 0,
          failed: mail.delivery.failed || 0,
          deferred: mail.delivery.deferred || 0,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: 'ai-mailer',
        aiTaskId: task.id,
        mailercloudCampaignId: mail.campaignId,
        mailercloudTemplateId: mail.templateId,
        mailercloudListId: listId,
        deliveryMode: mode,
        templateStyle: planEmail.template_style,
        aiPlan: { goal: planEmail.goal, angle: planEmail.angle, tone: planEmail.tone, reasoning: String(task.plan?.reasoning || '').slice(0, 500) },
      },
    });
    await logActivity(env, {
      title: `AI email ${mail.status === 'scheduled' ? 'scheduled' : 'sent'}: ${mail.subject}`,
      description: mode === 'campaign'
        ? `Campaign scheduled for ${mail.sendAt} → ${audienceCount} recipients (task ${task.id})`
        : `${sentCount} accepted, ${mail.delivery.failed || 0} failed, ${mail.delivery.deferred || 0} deferred of ${audienceCount} recipients (task ${task.id}: ${String(task.instruction).slice(0, 120)})`,
      campaignId: crmCampaignId,
      metadata: { mailercloudCampaignId: mail.campaignId, audience: audienceCount, mode, sent: sentCount, failed: mail.delivery.failed || 0 },
    });
  } catch (e) {
    console.warn(`[mailer] campaign doc write failed (non-fatal): ${e?.message || e}`);
  }
}

/** Mark the task done/failed when nothing is left; requeue dead chains.
 *  ALWAYS re-reads the task first: the delivery chain advances the
 *  persisted state concurrently (it may even finish while this run is
 *  still in its loop) — writing from a stale in-memory copy would
 *  resurrect finished emails and clobber the sent-ledger. */
async function finalizeTaskIfComplete(store, task) {
  const fresh = (await getTask(store, task.id)) || task;
  const emails = fresh.emails || [];
  const remaining = emails.filter((m) => m.status === 'planned' || m.status === 'sending');
  if (remaining.length) {
    let dirty = false;
    for (const m of remaining) {
      if (m.status !== 'sending') continue;
      // A 'sending' email whose chain lock is stale means the runner died
      // mid-batch — requeue it (the ledger resumes exactly where it stopped).
      if (!(await chainAlive(store, fresh.id, m.seq))) {
        m.status = 'planned';
        m.sendAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        dirty = true;
      }
    }
    if (dirty) await putTask(store, touch(fresh, {}));
    // Mirror authoritative status onto the caller's copy (log/UI only).
    task.status = fresh.status;
    return false;
  }
  const failed = emails.filter((m) => m.status === 'failed');
  const finalStatus = failed.length === emails.length && emails.length > 0 ? 'failed' : 'done';
  if (fresh.status !== finalStatus) {
    addEvent(
      fresh,
      finalStatus === 'done'
        ? 'All emails processed. Campaigns are visible in the app.'
        : 'Every email failed — see the email errors. You can retry from the task card.',
      finalStatus === 'done' ? 'info' : 'error'
    );
    await putTask(store, touch(fresh, { status: finalStatus }));
  }
  task.status = fresh.status;
  return true;
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
  // Real people the AI can speak to by name — the planner/copywriter see a
  // small sample so campaigns feel personally written, never blasted.
  const sample = contacts
    .filter((c) => c.first_name || c.company_name)
    .slice(0, 12)
    .map((c) => ({
      name: [c.first_name, c.last_name].filter(Boolean).join(' '),
      email: c.email,
      company: c.company_name || '',
      status: c._segment,
    }));
  return {
    total: contacts.length,
    segments: segs,
    top_tags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count })),
    top_companies: Object.entries(companyCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([company, count]) => ({ company, count })),
    sample_contacts: sample,
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
