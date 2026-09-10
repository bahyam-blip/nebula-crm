/**
 * GUARD — safety rails for extreme capability.
 *
 * "Extreme capabilities, secure at the same time" — this module is the
 * secure half:
 *
 *   • RATE LIMITS — fixed-window counters per (uid, bucket) in the state
 *     store. Expensive tools (builds, publishes, live web, SQL, mass
 *     email) can never be driven hot by a loop or an external MCP client.
 *   • INTEGRITY — SHA-256 content digests for served artifacts, recorded
 *     per version and exposed via header + /sites/<id>/meta, so anyone
 *     can verify the bytes they serve are the bytes the agent wrote.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1h fixed window

export const LIMITS = {
  build_website: { perHour: 12 },
  refine_site: { perHour: 30 },
  publish_site: { perHour: 10 },
  web_search: { perHour: 60 },
  web_fetch: { perHour: 60 },
  supabase_sql: { perHour: 30 },
  create_email_task: { perHour: 8 },
  learn_skill: { perHour: 20 },
};

/**
 * Consume one unit from (uid, tool)'s hourly window.
 * Returns { ok, remaining } or { ok:false, retryAfterMin }.
 * Missing store → open (tests without storage still pass).
 */
export async function rateLimit(store, uid, tool) {
  const limit = LIMITS[tool];
  if (!limit || !store) return { ok: true, remaining: Infinity };
  const win = Math.floor(Date.now() / WINDOW_MS);
  const key = `rl:${uid || 'anon'}:${tool}:${win}`;
  const cur = Number((await store.get(key)) || 0);
  if (cur >= limit.perHour) {
    const resetMin = Math.max(1, Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 60000));
    return { ok: false, limit: limit.perHour, retryAfterMin: resetMin, error: `hourly limit of ${limit.perHour} for ${tool} reached — try again in ~${resetMin} min` };
  }
  await store.put(key, String(cur + 1));
  return { ok: true, remaining: Math.max(0, limit.perHour - cur - 1) };
}

/** SHA-256 hex digest of a string (Workers WebCrypto). */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
