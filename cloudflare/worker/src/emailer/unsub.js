/**
 * One-click unsubscribe — the full suppression chain, in one place.
 *
 * A recipient taps "Unsubscribe" in an email footer → the Worker's public
 * route (/v1/t/u, see index.js) calls applyUnsub() here, which:
 *
 *   1. records the unsubscribe on the campaign (metrics.unsubscribes++,
 *      deduped per recipient token — track.js recordUnsub);
 *   2. resolves the recipient's EMAIL from the per-campaign token map
 *      (no PII ever travels in the URL);
 *   3. adds the address to the mailer's suppression list
 *      (state key `mail:suppressions` — the SAME list the pipeline
 *      filters every audience through);
 *   4. opts the CONTACT out in the CRM (emailOptOut: true + tag), so the
 *      address is excluded even if it is re-imported via CSV later;
 *   5. resolves the business brand so the landing page renders as THE
 *      OWNER'S business, not the CRM's.
 *
 * Every step is idempotent — clicking the link twice changes nothing.
 */

import { recordUnsub } from './track.js';
import { createStore, stateBackendName } from './state.js';
import { getBusinessProfile, brandFor } from './business.js';

const SUPPRESSION_KEY = 'mail:suppressions';

/** Append an address to the suppression list (same shape as pipeline.js). */
async function addSuppression(env, email, code) {
  const store = stateBackendName(env) === 'none' ? null : createStore(env);
  if (!store) return false;
  try {
    let list = [];
    try {
      const raw = await store.get(SUPPRESSION_KEY);
      list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) list = [];
    } catch { list = []; }
    if (list.some((s) => s && s.email === email)) return false;
    list.push({ email, code: code || 'unsub', at: new Date().toISOString() });
    await store.put(SUPPRESSION_KEY, JSON.stringify(list.slice(-5000)));
    return true;
  } catch (e) {
    console.warn(`[unsub] suppression write failed: ${e?.message || e}`);
    return false;
  }
}

/** Mark every matching contact doc opted-out (idempotent, capped). */
async function optOutContacts(env, email) {
  if (!env.DB || !email) return 0;
  try {
    const { results } = await env.DB
      .prepare(
        "SELECT id, json FROM docs WHERE col = 'contacts' AND json_extract(json, '$.email') = ? LIMIT 20"
      )
      .bind(email)
      .all();
    let n = 0;
    for (const row of results || []) {
      let data;
      try { data = JSON.parse(row.json); } catch { continue; }
      if (data.emailOptOut === true && Array.isArray(data.tags) && data.tags.includes('unsubscribed')) continue;
      const tags = Array.isArray(data.tags) ? [...new Set([...data.tags.map(String), 'unsubscribed'])].slice(0, 12) : ['unsubscribed'];
      data.emailOptOut = true;
      data.tags = tags;
      data.unsubscribedAt = new Date().toISOString();
      data.updatedAt = data.unsubscribedAt;
      await env.DB
        .prepare("UPDATE docs SET json = ?, updated_at = ? WHERE col = 'contacts' AND id = ?")
        .bind(JSON.stringify(data), Date.now(), row.id)
        .run();
      n++;
    }
    return n;
  } catch (e) {
    console.warn(`[unsub] contact opt-out failed: ${e?.message || e}`);
    return 0;
  }
}

/**
 * Apply an unsubscribe click.
 * Returns { brandName, color, email, already, fresh } — safe to call with
 * empty/unknown parameters (returns defaults, changes nothing).
 */
export async function applyUnsub(env, { campaignId, token }) {
  const out = { brandName: 'The business', color: '#6C8CFF', email: '', already: false, fresh: false };
  try {
    // Brand for the landing page — resolve even when the token is junk.
    const store = stateBackendName(env) === 'none' ? null : createStore(env);
    const profile = await getBusinessProfile(store);
    const brand = brandFor(env, profile);
    if (brand.branded) {
      out.brandName = brand.name;
      out.color = brand.color || out.color;
    }

    if (!campaignId || !token) {
      out.already = true;
      return out;
    }

    const res = await recordUnsub(env, campaignId, token);
    out.email = res.email || '';
    if (!res.ok) {
      // Unknown campaign / bad token — show the calm page, change nothing.
      out.already = true;
      return out;
    }
    if (!res.unique) {
      out.already = true;
      return out;
    }

    out.fresh = true;
    if (out.email) {
      await addSuppression(env, out.email, 'unsub');
      await optOutContacts(env, out.email);
      console.log(`[unsub] ${out.email} suppressed + opted out (campaign ${campaignId})`);
    }
    return out;
  } catch (e) {
    console.warn('[unsub] applyUnsub failed:', e?.message || e);
    return out;
  }
}
