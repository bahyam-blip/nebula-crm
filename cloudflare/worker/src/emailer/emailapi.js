/**
 * MailerCloud Email API client — transactional + personalized sending.
 *
 * This is the endpoint that ACTUALLY delivers a message to an inbox, as
 * opposed to the Marketing campaign API (cloudapi.mailercloud.com) which
 * schedules bulk campaigns. Both are used by Nebula:
 *
 *   POST https://email-api.mailercloud.com/email       Send Email
 *   POST https://email-api.mailercloud.com/email-api   Send Personalized Email (mail merge)
 *
 * Contract (https://apidoc.mailercloud.com/api-reference/email/send-email):
 *   Auth     : `Authorization: <api-key>` — PLAIN text, NO "Bearer" prefix.
 *   Body     : { version: "1.0", email: { from, fromName, replyTo[], subject,
 *              html, text, recipients: { to: [{ name, email, merge_vars? }] } },
 *              metadata: { campaignType, timestamp, messageId, custom } }
 *   Success  : 200 { status: "SUCCESS", statusCode: 1000, message: "NA" }
 *   Failure  : { status: "ERROR", statusCode: <code>, message: "..." }
 *
 * ⚠️ ALWAYS check `statusCode`, not the HTTP status — some delivery outcomes
 * (hard bounce 9007, spam 9008, quota 9002, …) arrive with HTTP 200.
 *
 * `from`/`replyTo` MUST belong to a verified sender on the MailerCloud
 * account and must be domain-based (e.g. das@aidraft.bond), never Gmail/Yahoo.
 */

import { fetchWithBackoff } from './http.js';

export const EMAIL_API_BASE = 'https://email-api.mailercloud.com';

/** How many single-recipient requests run in parallel (rate-limit friendly).
 *  MailerCloud allows 50 req/s per IP; 12-way keeps a 1000-recipient blast
 *  under ~2 minutes while staying far below the ceiling. Override with the
 *  MAIL_SEND_CONCURRENCY env var (1-32). */
export const SEND_CONCURRENCY = 12;

function concurrencyFor(env) {
  const n = parseInt(env?.MAIL_SEND_CONCURRENCY || String(SEND_CONCURRENCY), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(n, 32)) : SEND_CONCURRENCY;
}

/** Kept for backwards compatibility — the batch endpoint no longer puts
 *  multiple recipients in one request (privacy bug: every recipient could
 *  see all the others in the To: header). */
export const RECIPIENTS_PER_REQUEST = 50;

/* ── Internal status-code table (apidoc.mailercloud.com/errors) ────── */

const CODE_HINTS = {
  1000: 'sent',
  9001: 'throttled — retry with backoff',
  9002: 'sending quota exhausted — top up the MailerCloud plan',
  9003: 'authentication failed — check MAILERCLOUD_API_KEY',
  9004: 'recipient address missing',
  9005: 'from address missing',
  9006: 'soft bounce — temporarily deferred by the receiving server',
  9007: 'hard bounce — remove this address from the list',
  9008: 'reported as spam',
  9009: 'recipient previously unsubscribed',
  9010: 'address is on the suppression list',
  9011: 'sender address not verified — verify it in MailerCloud → Settings → Senders',
  9012: 'ESP rejected the message',
  9013: 'request to ESP expired — safe to retry',
  9014: 'ESP unavailable — retry with backoff',
  9015: 'IP not whitelisted with ESP',
  9016: 'subject empty',
  9017: 'invalid sender address',
  9018: 'invalid email address',
  9019: 'recipient mailbox full — retry later',
  9021: 'mailbox not found on the recipient server',
  9022: 'unsupported version — use "1.0"',
  9024: 'authorization failure',
  9452: 'message overloading — retry with backoff',
  9512: 'host email server not found',
  9999: 'unknown provider error',
};

/** Codes worth an automatic retry (with backoff). */
const RETRYABLE = new Set([9001, 9013, 9014, 9452, 9999]);
/** Soft outcomes: not delivered now, but the address is not bad. */
export const DEFERRED = new Set([9006, 9019]);
/** Outcomes meaning "never send to this address again". */
export const SUPPRESS = new Set([9007, 9008, 9009, 9010, 9021]);
/** Codes that point at one bad recipient inside a batch → retry singly. */
const PER_RECIPIENT = new Set([9004, 9007, 9008, 9009, 9010, 9018, 9019, 9021, 9512]);

export function classify(code) {
  if (code === 1000) return 'sent';
  if (RETRYABLE.has(code)) return 'retryable';
  if (DEFERRED.has(code)) return 'deferred';
  return 'fatal';
}

export function hintFor(code) {
  return CODE_HINTS[code] || `provider status ${code}`;
}

/* ── Sender identity ────────────────────────────────────────────────── */

/**
 * Resolve the verified sending identity. Priority:
 *   MAILERCLOUD_SENDER_EMAIL (Worker secret, pushed by CI)
 *   → MAIL_SENDER_EMAIL      (plain var in wrangler.toml)
 *   → das@aidraft.bond       (the account's verified domain sender)
 */
/**
 * brand (optional) — resolved Business Profile branding (business.js).
 * The From display name becomes the OWNER'S business ("Aidraft Legal"),
 * never the CRM's own name, and reply-to honours profile.contact_email.
 */
export function resolveSender(env, brand = null) {
  const from = String(env.MAILERCLOUD_SENDER_EMAIL || env.MAIL_SENDER_EMAIL || 'das@aidraft.bond').trim();
  const fromName = String(
    brand?.fromName || env.MAILERCLOUD_SENDER_NAME || env.MAIL_FROM_NAME || env.MAIL_BUSINESS_NAME || 'Nebula CRM'
  ).trim();
  const replyTo = String(brand?.contactEmail || env.MAILERCLOUD_REPLY_EMAIL || env.MAIL_REPLY_EMAIL || '').trim();
  return { from, fromName, replyTo: replyTo || null };
}

/* ── Low-level request with statusCode-aware retries ────────────────── */

async function emailApiReq(env, path, body, retries = 3) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchWithBackoff(
      `${EMAIL_API_BASE}${path}`,
      {
        method: 'POST',
        headers: {
          Authorization: env.MAILERCLOUD_API_KEY, // plain key — no Bearer
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      1 // HTTP-level retry for 429/5xx transport; statusCode retries live here
    );

    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }

    const code = typeof json?.statusCode === 'number' ? json.statusCode : null;
    if (res.ok && json?.status === 'SUCCESS' && code === 1000) {
      return { ok: true, statusCode: 1000, http: res.status, raw: json };
    }

    last = {
      ok: false,
      statusCode: code ?? res.status,
      message: String(json?.message || text.slice(0, 300) || `HTTP ${res.status}`),
      http: res.status,
      raw: json ?? text.slice(0, 400),
    };

    const kind = classify(last.statusCode);
    if ((kind === 'retryable' || last.statusCode === 429 || last.http >= 500) && attempt < retries) {
      const delay = Math.min(30000, 1500 * 2 ** attempt) + Math.floor(Math.random() * 400);
      console.warn(`[emailapi] ${path} statusCode ${last.statusCode} — retry ${attempt + 1}/${retries} in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return last;
  }
  return last; // unreachable, but keeps the shape honest
}

/* ── Public API ─────────────────────────────────────────────────────── */

/**
 * Send one email to one recipient (or a small explicit list) via /email.
 * Returns { ok, statusCode, message?, raw }.
 */
export async function sendEmail(env, { to, cc, bcc, subject, html, text, replyTo, metadata, brand = null }) {
  const sender = resolveSender(env, brand);
  const norm = (list) =>
    (list || [])
      .map((r) => (typeof r === 'string' ? { email: r } : r))
      .filter((r) => r?.email)
      .map((r) => ({ ...(r.name ? { name: r.name } : {}), email: r.email }));

  const recipients = { to: norm(to) };
  if (cc?.length) recipients.cc = norm(cc);
  if (bcc?.length) recipients.bcc = norm(bcc);

  const body = {
    version: '1.0',
    email: {
      from: sender.from,
      fromName: sender.fromName,
      subject: String(subject || '').slice(0, 200),
      html: String(html || ''),
      text: String(text || htmlToPlain(html)),
      recipients,
      ...(sender.replyTo || replyTo ? { replyTo: [replyTo || sender.replyTo] } : {}),
    },
    metadata: {
      campaignType: 'transactional',
      timestamp: new Date().toISOString(),
      ...(metadata?.messageId ? { messageId: String(metadata.messageId).slice(0, 100) } : {}),
      ...(metadata?.custom ? { custom: metadata.custom } : {}),
    },
  };

  if (!body.email.recipients.to.length) return { ok: false, statusCode: 9004, message: hintFor(9004), raw: null };
  if (!body.email.subject.trim()) return { ok: false, statusCode: 9016, message: hintFor(9016), raw: null };

  return emailApiReq(env, '/email', body, 3);
}

/**
 * Send personalized email via /email-api (mail merge) — ONE MESSAGE PER
 * RECIPIENT. Every recipient gets their own private copy with only their
 * own address in To: — nobody can ever see who else received it (the old
 * multi-recipient batch put every address in one To: header, leaking the
 * whole audience to everyone). Merge vars ({{first_name}} …) are resolved
 * per recipient by MailerCloud.
 *
 * Scale features:
 *   worker-pool concurrency — N workers pull recipients from a shared queue,
 *     so one slow request NEVER stalls the whole batch (the old chunked
 *     Promise.all waited for the slowest of every 8 sends between chunks).
 *   onProgress(partialOut, sentEmails) — serialized + throttled (~1.5s),
 *     awaited so the caller can persist live counters (the app shows the
 *     send moving).
 *   shouldStop() — re-checked (time-gated ~2s) while the pool runs; a
 *     cancelled task stops cleanly and the caller resumes the remainder.
 *   out.sentEmails — every address that was ACCEPTED, in order; the caller
 *     persists it so a retry only ever sends the unsent remainder.
 *
 * recipients: [{ name, email, merge_vars: {first_name, company, …} }]
 * Returns { sent, deferred, failed, failures[], suppressions[], sentEmails[], stopped }.
 */
export async function sendPersonalizedBatch(env, { subject, html, text, recipients, metadata, brand = null, onProgress = null, shouldStop = null }) {
  const sender = resolveSender(env, brand);
  const out = { sent: 0, deferred: 0, failed: 0, failures: [], suppressions: [], sentEmails: [], stopped: false };

  const rows = (recipients || [])
    .map((r) => ({
      name: String(r.name || '').slice(0, 100),
      email: String(r.email || '').trim().toLowerCase(),
      merge_vars: r.merge_vars && typeof r.merge_vars === 'object' ? r.merge_vars : {},
    }))
    .filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
  if (!rows.length) return { ...out, failed: recipients?.length || 0, failures: [{ email: '*', statusCode: 9004, message: 'no valid recipients' }] };

  const safeSubject = String(subject || '').slice(0, 200);
  const safeHtml = String(html || '');
  const safeText = String(text || htmlToPlain(html));

  const sendOne = async (r, i) => {
    const body = {
      version: '1.0',
      email: {
        from: sender.from,
        fromName: sender.fromName,
        subject: safeSubject,
        html: safeHtml,
        text: safeText,
        ...(sender.replyTo ? { replyTo: [sender.replyTo] } : {}),
        recipients: {
          // Exactly ONE recipient per request — a true 1:1 email.
          to: [{ name: r.name, email: r.email, ...(Object.keys(r.merge_vars).length ? { merge_vars: r.merge_vars } : {}) }],
        },
      },
      metadata: {
        campaignType: 'promotional',
        timestamp: new Date().toISOString(),
        messageId: metadata?.messageId
          ? `${metadata.messageId}-r${i}`.slice(0, 100)
          : `nebula-${Date.now().toString(36)}-${i}`,
        ...(metadata?.custom ? { custom: metadata.custom } : {}),
      },
    };
    return emailApiReq(env, '/email-api', body, 3);
  };

  // ── Worker pool ─────────────────────────────────────────────────
  // Shared cursor; each worker grabs the next index. A 9001-throttled
  // request retries with backoff INSIDE its own worker while the other
  // workers keep sending — throughput no longer depends on the slowest
  // request in the batch.
  const conc = Math.min(concurrencyFor(env), rows.length);
  let next = 0;
  let lastProgressAt = 0;
  let progressChain = Promise.resolve();

  const emitProgress = () => {
    // Serialized + throttled: onProgress persists task state; concurrent
    // writes could land out of order and show stale counters.
    const now = Date.now();
    if (!onProgress || now - lastProgressAt < 1500) return;
    lastProgressAt = now;
    progressChain = progressChain
      .then(() => onProgress({ sent: out.sent, deferred: out.deferred, failed: out.failed }, [...out.sentEmails]))
      .catch((e) => console.warn(`[emailapi] onProgress callback failed (non-fatal): ${e?.message || e}`));
  };

  // One SHARED stop-check per window (default ~2s): the whole pool costs ONE
  // state read per window (not one per worker), yet still stops within
  // seconds of the owner's cancel tap. MAIL_STOP_CHECK_MS overrides it.
  const stopWindowMs = Math.max(0, parseInt(env?.MAIL_STOP_CHECK_MS || '2000', 10));
  let stopCheckAt = -Infinity;
  let stopCheckP = null;
  const checkStop = () => {
    if (!shouldStop) return Promise.resolve(false);
    const now = Date.now();
    if (now - stopCheckAt > stopWindowMs || !stopCheckP) {
      stopCheckAt = now;
      stopCheckP = Promise.resolve()
        .then(() => shouldStop())
        .catch(() => false);
    }
    return stopCheckP;
  };

  const worker = async () => {
    while (true) {
      if (await checkStop()) { out.stopped = true; return; }
      const i = next;
      if (i >= rows.length) return;
      next += 1;
      const res = await sendOne(rows[i], i);
      record(out, rows[i].email, res);
      emitProgress();
    }
  };

  await Promise.all(Array.from({ length: conc }, () => worker()));
  if (progressChain !== Promise.resolve()) await progressChain.catch(() => {});

  return out;
}

function record(out, email, res) {
  const kind = classify(res.statusCode);
  if (kind === 'sent') {
    out.sent++;
    out.sentEmails.push(email);
  } else if (kind === 'deferred') {
    out.deferred++;
  } else {
    out.failed++;
    out.failures.push({ email, statusCode: res.statusCode, message: res.message || hintFor(res.statusCode) });
    if (SUPPRESS.has(res.statusCode)) out.suppressions.push({ email, code: res.statusCode, at: new Date().toISOString() });
  }
}

function htmlToPlain(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ')
    .trim();
}
