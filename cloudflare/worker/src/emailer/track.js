/**
 * Email open tracking.
 *
 * MailerCloud's Email (transactional) API reports ACCEPTANCE (statusCode
 * 1000), not engagement — opens were invisible for every AI campaign sent
 * per-recipient. A 1x1 tracking pixel closes that gap for ALL sends:
 *
 *   HTML carries  <img src="{BASE}/v1/t/o.png?c=<campaignId>&u=<token>" />
 *   token         deterministic per (campaign, recipient) — djb2 hex, no
 *                 PII in the URL, not guessable-enough to matter for
 *                 aggregate counts
 *   recordOpen    increments campaigns/{id}.metrics.opens and keeps the
 *                 unique-token set in mail_state track:<id> (capped)
 *
 * The pixel route is intentionally UNAUTHENTICATED (mail clients cannot
 * send Authorization headers); it can only mutate campaign metrics, and
 * only for campaign ids that already exist.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Minimal valid 1x1 transparent PNG (67 bytes). */
export const PNG_1X1 = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
), (ch) => ch.charCodeAt(0));

/** Deterministic short token for (campaignId, email). No PII in URLs. */
export function openToken(campaignId, email) {
  const s = `${campaignId}|${String(email).toLowerCase()}`;
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = (h2 * 31 + c) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

const TRACK_PREFIX = 'track:';
const MAX_UNIQUE = 5000;

/** Record an open. Returns { ok, unique } — failures are logged, never thrown. */
export async function recordOpen(env, campaignId, token) {
  const out = { ok: false, unique: false };
  try {
    if (!env.DB || !campaignId || !/^[A-Za-z0-9_\-]{1,128}$/.test(campaignId)) return out;
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'campaigns' AND id = ?")
      .bind(campaignId)
      .first();
    if (!row) return out; // unknown campaign — ignore (also blocks spam writes)

    let data = {};
    try { data = JSON.parse(row.json); } catch { /* start fresh */ }
    const metrics = { ...(data.metrics || {}) };

    // Unique openers: append the token if new (cap the list).
    // ⚠ `await db.first()?.json` would optional-chain the PROMISE (always
    // undefined) — await the row first, then read .json. This bug used to
    // make the dedupe set read back empty forever, inflating open counts.
    const key = TRACK_PREFIX + campaignId;
    let uniques = [];
    try {
      const stateRow = await env.DB
        .prepare("SELECT json FROM docs WHERE col = 'mail_state' AND id = ?")
        .bind(key)
        .first();
      uniques = stateRow ? (JSON.parse(stateRow.json) || []) : [];
    } catch { uniques = []; }
    const before = uniques.length;
    if (!uniques.includes(token) && uniques.length < MAX_UNIQUE) uniques.push(token);
    out.unique = uniques.length > before;

    // "Opens" = UNIQUE PEOPLE who opened (owners ask "how many people
    // opened", not "how many reloads happened"). Bump only on first open
    // so the counter can never run away from the unique set.
    if (out.unique) metrics.opens = (Number(metrics.opens) || 0) + 1;

    const now = Date.now();
    await env.DB
      .prepare(
        `UPDATE docs SET json = ?, updated_at = ? WHERE col = 'campaigns' AND id = ?`
      )
      .bind(JSON.stringify({ ...data, metrics, updatedAt: new Date(now).toISOString() }), now, campaignId)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES ('mail_state', ?, NULL, ?, ?, ?)
         ON CONFLICT(col, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      )
      .bind(key, JSON.stringify(uniques), now, now)
      .run();
    out.ok = true;
    return out;
  } catch (e) {
    console.warn(`[track] open record failed (${campaignId}): ${e?.message || e}`);
    return out;
  }
}

/** { opens, uniqueOpeners } for a campaign — best-effort, 0s on any failure. */
export async function openStats(env, campaignId) {
  try {
    if (!env.DB) return { opens: 0, uniqueOpeners: 0 };
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'mail_state' AND id = ?")
      .bind(TRACK_PREFIX + campaignId)
      .first();
    const uniques = row ? (JSON.parse(row.json) || []) : [];
    return { opens: uniques.length, uniqueOpeners: uniques.length };
  } catch {
    return { opens: 0, uniqueOpeners: 0 };
  }
}

/* ── Click tracking ──────────────────────────────────────────────────
 * Every CTA / website link in a tracked email is rewritten to
 *   {BASE}/v1/t/c?c=<campaignId>&u=<token>&to=<urlencoded target>
 * The redirect counts ONE click per unique (campaign, recipient) token —
 * the same identity the open pixel uses — then 302s to the real URL.
 * Bot prefetchers (Gmail, Outlook scanners) hit links without the
 * recipient's token, or repeatedly with it; the unique-set keeps the
 * number honest ("how many PEOPLE clicked"). */

const CLICK_PREFIX = 'click:';

/** Record a click. Returns { ok, unique } — failures never throw. */
export async function recordClick(env, campaignId, token) {
  const out = { ok: false, unique: false };
  try {
    if (!env.DB || !campaignId || !/^[A-Za-z0-9_\-]{1,128}$/.test(campaignId)) return out;
    if (!token || token.length > 64 || /[^A-Za-z0-9_\-]/.test(token)) return out;
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'campaigns' AND id = ?")
      .bind(campaignId)
      .first();
    if (!row) return out; // unknown campaign — never count spam writes

    let data = {};
    try { data = JSON.parse(row.json); } catch { /* start fresh */ }
    const metrics = { ...(data.metrics || {}) };

    const key = CLICK_PREFIX + campaignId;
    let uniques = [];
    try {
      const stateRow = await env.DB
        .prepare("SELECT json FROM docs WHERE col = 'mail_state' AND id = ?")
        .bind(key)
        .first();
      uniques = stateRow ? (JSON.parse(stateRow.json) || []) : [];
    } catch { uniques = []; }
    const before = uniques.length;
    if (!uniques.includes(token) && uniques.length < MAX_UNIQUE) uniques.push(token);
    out.unique = uniques.length > before;

    if (out.unique) metrics.clicks = (Number(metrics.clicks) || 0) + 1;

    const now = Date.now();
    await env.DB
      .prepare(`UPDATE docs SET json = ?, updated_at = ? WHERE col = 'campaigns' AND id = ?`)
      .bind(JSON.stringify({ ...data, metrics, updatedAt: new Date(now).toISOString() }), now, campaignId)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES ('mail_state', ?, NULL, ?, ?, ?)
         ON CONFLICT(col, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      )
      .bind(key, JSON.stringify(uniques), now, now)
      .run();
    out.ok = true;
    return out;
  } catch (e) {
    console.warn(`[track] click record failed (${campaignId}): ${e?.message || e}`);
    return out;
  }
}

/** { clicks, uniqueClickers } for a campaign — best-effort. */
export async function clickStats(env, campaignId) {
  try {
    if (!env.DB) return { clicks: 0, uniqueClickers: 0 };
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'mail_state' AND id = ?")
      .bind(CLICK_PREFIX + campaignId)
      .first();
    const uniques = row ? (JSON.parse(row.json) || []) : [];
    return { clicks: uniques.length, uniqueClickers: uniques.length };
  } catch {
    return { clicks: 0, uniqueClickers: 0 };
  }
}

/* ── One-click unsubscribe ───────────────────────────────────────────
 * The footer of every personalized email carries
 *   {BASE}/v1/t/u?c=<campaignId>&u=<token>
 * The route renders a small branded "You're unsubscribed" page and calls
 * recordUnsub: it bumps campaigns/{id}.metrics.unsubscribes (unique per
 * token) and returns the recipient's identity chain so the pipeline can
 * add the address to the suppression list and opt the CONTACT out.
 *
 * How does a token become an email? The token set for each campaign maps
 * token → email, recorded at SEND time (tokenFor map in mail_state
 * `tokens:<campaignId>`), so the public route can suppress the right
 * person WITHOUT putting any PII in the URL. */

const UNSUB_PREFIX = 'unsub:';
const TOKENS_PREFIX = 'tokens:';

/** Store the token→email map for a campaign (called once per send). */
export async function saveTokenMap(env, campaignId, map) {
  try {
    if (!env.DB || !campaignId || !map || typeof map !== 'object') return false;
    const entries = Object.entries(map).slice(0, MAX_UNIQUE);
    if (!entries.length) return false;
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES ('mail_state', ?, NULL, ?, ?, ?)
         ON CONFLICT(col, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      )
      .bind(TOKENS_PREFIX + campaignId, JSON.stringify(Object.fromEntries(entries)), Date.now(), Date.now())
      .run();
    return true;
  } catch (e) {
    console.warn(`[track] token map save failed (${campaignId}): ${e?.message || e}`);
    return false;
  }
}

/** token → email for a campaign (best-effort). */
export async function emailForToken(env, campaignId, token) {
  try {
    if (!env.DB || !campaignId || !token) return '';
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'mail_state' AND id = ?")
      .bind(TOKENS_PREFIX + campaignId)
      .first();
    if (!row) return '';
    const map = JSON.parse(row.json) || {};
    return String(map[token] || '');
  } catch {
    return '';
  }
}

/**
 * Record an unsubscribe. Returns { ok, unique, email } — the email (when
 * resolvable from the token map) so the caller can suppress it.
 */
export async function recordUnsub(env, campaignId, token) {
  const out = { ok: false, unique: false, email: '' };
  try {
    if (!env.DB || !campaignId || !/^[A-Za-z0-9_\-]{1,128}$/.test(campaignId)) return out;
    if (!token || token.length > 64 || /[^A-Za-z0-9_\-]/.test(token)) return out;
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'campaigns' AND id = ?")
      .bind(campaignId)
      .first();
    if (!row) return out;

    let data = {};
    try { data = JSON.parse(row.json); } catch { /* start fresh */ }
    const metrics = { ...(data.metrics || {}) };

    const key = UNSUB_PREFIX + campaignId;
    let uniques = [];
    try {
      const stateRow = await env.DB
        .prepare("SELECT json FROM docs WHERE col = 'mail_state' AND id = ?")
        .bind(key)
        .first();
      uniques = stateRow ? (JSON.parse(stateRow.json) || []) : [];
    } catch { uniques = []; }
    const before = uniques.length;
    if (!uniques.includes(token) && uniques.length < MAX_UNIQUE) uniques.push(token);
    out.unique = uniques.length > before;
    if (out.unique) metrics.unsubscribes = (Number(metrics.unsubscribes) || 0) + 1;

    const now = Date.now();
    await env.DB
      .prepare(`UPDATE docs SET json = ?, updated_at = ? WHERE col = 'campaigns' AND id = ?`)
      .bind(JSON.stringify({ ...data, metrics, updatedAt: new Date(now).toISOString() }), now, campaignId)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES ('mail_state', ?, NULL, ?, ?, ?)
         ON CONFLICT(col, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      )
      .bind(key, JSON.stringify(uniques), now, now)
      .run();
    out.ok = true;
    out.email = await emailForToken(env, campaignId, token);
    return out;
  } catch (e) {
    console.warn(`[track] unsub record failed (${campaignId}): ${e?.message || e}`);
    return out;
  }
}

/** Validate a recipient row for explicit delivery. */
export function validEmails(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e)))];
}
