/**
 * Unified state store for the AI mailer.
 *
 * History: the mailer originally required a Workers KV namespace
 * (NEBULA_EMAIL_KV). That was a manual setup step nobody completed, and the
 * whole mailer stayed inert because of it. This module removes that blocker:
 *
 *   - If the KV binding exists, it is used (fastest path).
 *   - Otherwise the store transparently falls back to Firestore
 *     (`mail_state/{key}` documents) through the service account the Worker
 *     already holds. No extra setup, no extra secrets.
 *
 * The exported object mimics the tiny slice of the KV API the mailer uses:
 *   get(key)                     → string | null
 *   put(key, value, {ttl})       → void   (ttl in seconds, best-effort)
 *   delete(key)                  → void
 *
 * Keys may contain [A-Za-z0-9:_-]; they become Firestore document ids with
 * percent-encoding (Firestore forbids "/" and leading "__").
 */

import { getAccessToken } from '../push.js';
import { fetchWithBackoff } from './http.js';

const COLLECTION = 'mail_state';

function docId(key) {
  return encodeURIComponent(String(key));
}

/* ── Firestore backend ──────────────────────────────────────────── */

function fsBase(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`;
}

async function fsCall(env, path, { method = 'GET', body } = {}) {
  const token = await getAccessToken(env);
  const res = await fetchWithBackoff(
    `${fsBase(env)}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    2
  );
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    // A missing document on a read is normal — surface as null, not throw.
    if (res.status === 404 && method === 'GET') return null;
    throw new Error(`mail_state ${res.status} ${path.split('?')[0]} → ${json?.error?.message || text.slice(0, 200)}`);
  }
  return json;
}

function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return v.integerValue;
  if ('booleanValue' in v) return v.booleanValue;
  return null;
}

function toFields(value, ttlSeconds) {
  const fields = { value: { stringValue: String(value) } };
  if (ttlSeconds && Number.isFinite(ttlSeconds)) {
    fields.expireAt = {
      timestampValue: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }
  return fields;
}

function readDoc(json) {
  const value = fromValue(json?.fields?.value);
  if (value === null) return null;
  const exp = json?.fields?.expireAt?.timestampValue;
  if (exp && Date.parse(exp) < Date.now()) return null; // soft TTL
  return value;
}

const firestoreStore = {
  name: 'firestore',
  async get(env, key) {
    const json = await fsCall(env, `/documents/${COLLECTION}/${docId(key)}`);
    return json ? readDoc(json) : null;
  },
  async put(env, key, value, opts = {}) {
    await fsCall(env, `/documents/${COLLECTION}/${docId(key)}`, {
      method: 'PATCH',
      body: { fields: toFields(value, opts.expirationTtl) },
    });
  },
  async delete(env, key) {
    await fsCall(env, `/documents/${COLLECTION}/${docId(key)}`, { method: 'DELETE' });
  },
};

/* ── KV backend (used when the optional binding exists) ─────────── */

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

/** True when the Worker has what the Firestore fallback needs. */
export function stateBackendName(env) {
  if (env.NEBULA_EMAIL_KV) return 'kv';
  if (env.FIREBASE_SERVICE_ACCOUNT && env.FIREBASE_PROJECT_ID) return 'firestore';
  return 'none';
}

export function createStore(env) {
  const backend = env.NEBULA_EMAIL_KV ? kvStore : firestoreStore;
  return {
    backend: backend.name,
    get: (key) => backend.get(env, key),
    put: (key, value, opts) => backend.put(env, key, value, opts),
    delete: (key) => backend.delete(env, key),
  };
}
