/**
 * CREDENTIAL VAULT — the "no API tokens" backbone of the hosting fabric.
 *
 * The user NEVER holds or pastes a token at tool-time. They connect a
 * platform ONCE (Studio → Connect → paste GitHub/Vercel/GoDaddy/… secret),
 * the Worker encrypts it with AES-GCM and stores it server-side in the
 * state store, and every later publish/domain action pulls it invisibly.
 * Secrets are never logged, never returned by any tool, and never leave
 * the Worker unencrypted.
 *
 * Storage: state store key  vault:<uid>:<connector>  →
 *   { iv, ct, label, meta, createdAt, verifiedAt }   (iv/ct are base64)
 *
 * Key: PBKDF2-SHA256 (100k iters) over env.VAULT_KEY (falling back to
 * MAILERCLOUD_API_KEY so the fabric works before a dedicated secret is
 * set; VAULT_KEY is the recommended production secret).
 */

import { stateBackendName } from './state.js';

const KEY_PREFIX = 'vault:';
const PBKDF2_ITERATIONS = 100_000;
const SALT = 'nebula-vault-v1';

/* ── crypto helpers ───────────────────────────────────────────────── */

const keyCache = new WeakMap(); // env → CryptoKey (derive once per isolate)

function b64encode(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str) {
  const s = atob(str);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function vaultPassword(env) {
  return String(env.VAULT_KEY || env.MAILERCLOUD_API_KEY || 'nebula-dev-vault');
}

async function vaultKey(env) {
  const cached = keyCache.get(env);
  if (cached) return cached;
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(vaultPassword(env)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  keyCache.set(env, key);
  return key;
}

export async function sealString(env, plaintext) {
  const key = await vaultKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { iv: b64encode(iv), ct: b64encode(ct) };
}

export async function openString(env, sealed) {
  if (!sealed || !sealed.iv || !sealed.ct) throw new Error('vault record is malformed');
  const key = await vaultKey(env);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(sealed.iv) },
    key,
    b64decode(sealed.ct)
  );
  return new TextDecoder().decode(pt);
}

/* ── connection records ───────────────────────────────────────────── */

export function vaultAvailable(env) {
  return stateBackendName(env) !== 'none';
}

function vaultKeyFor(uid, connector) {
  return `${KEY_PREFIX}${uid}:${connector}`;
}

/** Store credentials for one platform (encrypts in place of any old value). */
export async function storeConnection(env, store, uid, connector, credentials, label) {
  if (!store) throw new Error('no state backend configured');
  const sealed = await sealString(env, JSON.stringify(credentials));
  const rec = {
    connector,
    label: String(label || connector).slice(0, 80),
    ...sealed,
    createdAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
  };
  await store.put(vaultKeyFor(uid, connector), JSON.stringify(rec));
  return rec;
}

/** Read + decrypt credentials; null when not connected. Never logs the secret. */
export async function readConnection(env, store, uid, connector) {
  if (!store) return null;
  const raw = await store.get(vaultKeyFor(uid, connector));
  if (!raw) return null;
  let rec = null;
  try { rec = JSON.parse(raw); } catch { return null; }
  try {
    const credentials = JSON.parse(await openString(env, rec));
    return {
      label: rec.label || connector,
      credentials,
      createdAt: rec.createdAt || null,
      verifiedAt: rec.verifiedAt || null,
    };
  } catch (e) {
    // Wrong vault key (rotated secret) or corrupt record — treat as not connected.
    console.warn('[vault] decrypt failed for', connector, '— reconnect required');
    return null;
  }
}

export async function deleteConnection(store, uid, connector) {
  if (!store) return false;
  await store.delete(vaultKeyFor(uid, connector));
  return true;
}

/** Meta-only listing (no secrets ever leave the vault). */
export async function listConnectionMetas(env, store, uid) {
  if (!store || !env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare("SELECT id, json FROM docs WHERE col = 'mail_state' AND id LIKE ?")
      .bind(`${KEY_PREFIX}${uid}:%`)
      .all();
    return (results || [])
      .map((r) => {
        try {
          const rec = JSON.parse(JSON.parse(r.json)?.value || r.json);
          return {
            connector: rec.connector || r.id.split(':')[2],
            label: rec.label || '',
            createdAt: rec.createdAt || null,
            verifiedAt: rec.verifiedAt || null,
          };
        } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
