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

/** Validate a recipient row for explicit delivery. */
export function validEmails(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => EMAIL_RE.test(e)))];
}
