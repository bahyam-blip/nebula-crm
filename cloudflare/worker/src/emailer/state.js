/**
 * Unified state store for the AI mailer.
 *
 *   - D1 (env.DB) is the primary backend: mail state lives in the same
 *     database as the rest of the CRM (col = 'mail_state'). No extra setup,
 *     no external quota, no rate walls.
 *   - Workers KV (NEBULA_EMAIL_KV) remains supported for parity with old
 *     deployments that bound it.
 *   - If neither binding exists the mailer stays inert (backend 'none').
 *
 * The exported object mimics the tiny slice of the KV API the mailer uses:
 *   get(key)                     → string | null
 *   put(key, value, {ttl})       → void   (ttl in seconds, best-effort)
 *   delete(key)                  → void
 *
 * Every call is fail-soft (see createStore): a transient database error
 * degrades to null / a logged skip instead of crashing mail routes.
 */

/* ── D1 backend (primary) ───────────────────────────────────────── */

const STATE_COL = 'mail_state';

const d1Store = {
  name: 'd1',
  async get(env, key) {
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = ? AND id = ?")
      .bind(STATE_COL, key)
      .first();
    if (!row) return null;
    try {
      const doc = JSON.parse(row.json);
      // Soft TTL mirrors the old expireAt behaviour.
      if (doc.expireAt && Date.parse(doc.expireAt) < Date.now()) return null;
      return typeof doc.value === 'string' ? doc.value : JSON.stringify(doc.value);
    } catch {
      return null;
    }
  },
  async put(env, key, value, opts = {}) {
    const now = Date.now();
    const doc = { value: String(value) };
    if (opts.expirationTtl && Number.isFinite(opts.expirationTtl)) {
      doc.expireAt = new Date(now + opts.expirationTtl * 1000).toISOString();
    }
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?)
         ON CONFLICT(col, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
      )
      .bind(STATE_COL, key, JSON.stringify(doc), now, now)
      .run();
  },
  async delete(env, key) {
    await env.DB.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(STATE_COL, key).run();
  },
};

/* ── KV backend (optional) ──────────────────────────────────────── */

const kvStore = {
  name: 'kv',
  async get(env, key) {
    return env.NEBULA_EMAIL_KV.get(String(key));
  },
  async put(env, key, value, opts = {}) {
    await env.NEBULA_EMAIL_KV.put(String(key), String(value), opts);
  },
  async delete(env, key) {
    await env.NEBULA_EMAIL_KV.delete(String(key));
  },
};

/* ── Factory ────────────────────────────────────────────────────── */

/** Which backend would be used right now? */
export function stateBackendName(env) {
  if (env.DB) return 'd1';
  if (env.NEBULA_EMAIL_KV) return 'kv';
  return 'none';
}

/** JSON.parse that never throws — corrupt/half-written state reads as fallback. */
export function safeParse(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[mailer:state] corrupt JSON in state read — using fallback');
    return fallback;
  }
}

/**
 * Fail-soft store.
 *
 * The state layer is ADVISORY: tasks, memory, locks, analytics cache. A
 * transient database failure used to propagate and crash every /v1/mail/*
 * route with Cloudflare error 1101 — the whole email system went down
 * because one read sneezed. The store now degrades instead:
 *
 *   get    → error is logged and returned as null (caller sees "no state")
 *   put/delete → best-effort, error logged, flow continues
 *
 * The last error is kept on `store.lastError` so /v1/mail/status can surface
 * it for diagnosis instead of leaving a blind 500. Hard failures that must
 * stop a send (e.g. the send request itself) do NOT go through this store.
 */
export function createStore(env) {
  const backend = env.DB ? d1Store : kvStore;
  const store = {
    backend: backend.name,
    lastError: null,
    get: async (key) => {
      try {
        return await backend.get(env, key);
      } catch (e) {
        store.lastError = `${backend.name}.get(${key}) → ${e?.message || e}`;
        console.warn(`[mailer:state] ${store.lastError} — degrading to null`);
        return null;
      }
    },
    put: async (key, value, opts) => {
      try {
        await backend.put(env, key, value, opts);
      } catch (e) {
        store.lastError = `${backend.name}.put(${key}) → ${e?.message || e}`;
        console.warn(`[mailer:state] ${store.lastError} — write skipped`);
      }
    },
    delete: async (key) => {
      try {
        await backend.delete(env, key);
      } catch (e) {
        store.lastError = `${backend.name}.delete(${key}) → ${e?.message || e}`;
        console.warn(`[mailer:state] ${store.lastError} — delete skipped`);
      }
    },
  };
  return store;
}
