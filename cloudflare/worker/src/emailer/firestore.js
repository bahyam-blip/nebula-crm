/**
 * Firestore REST access for the mailer.
 *
 * Reuses the service-account access token from push.js (its scope already
 * includes https://www.googleapis.com/auth/datastore). The email list lives
 * HERE — the contacts collection is the single source of truth; MailerCloud
 * is only a sending relay, synced from this data.
 *
 * Reads  : contacts (keyset-paginated), users/{uid} role
 * Writes : campaigns/{id}  — the SAME collection the Flutter marketing
 *          module reads, so every AI campaign shows up natively in the app.
 *          The Dart parser ignores unknown fields, so mailer-specific keys
 *          (mailercloudCampaignId, aiTaskId, …) are safe additions.
 *        : activities/{id} — one timeline entry per campaign.
 */

import { getAccessToken } from '../push.js';
import { fetchWithBackoff } from './http.js';

/* ── Firestore Value helpers (JS → REST wire format) ───────────── */

export function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') {
    // ISO timestamps → timestampValue so the app reads them as Timestamps.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return { timestampValue: v };
    return { stringValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(fsValue) } };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = fsValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fromFsValue(val);
    return out;
  }
  return null;
}

/** Flatten a REST document into plain JS (what the Dart models would see). */
export function fsDoc(doc) {
  const out = { __id: doc.name?.split('/').pop(), __name: doc.name };
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
  return out;
}

function base(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`;
}

async function call(env, path, { method = 'GET', body, mask } = {}) {
  const token = await getAccessToken(env);
  const url = new URL(`${base(env)}${path}`);
  for (const m of mask || []) url.searchParams.append('updateMask.fieldPaths', m);
  const res = await fetchWithBackoff(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 250);
    const err = new Error(`Firestore ${res.status} ${path.split('?')[0]} → ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/* ── Contacts (the CRM email list) ──────────────────────────────── */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Stream the whole contacts collection, newest id last (keyset pagination on
 * __name__ needs no composite index). Returns MailerCloud-ready rows:
 *   { email, first_name, last_name, company_name, phone, tags[], _segment, _created }
 * Only contacts with a valid email are returned. teamId filter optional.
 */
export async function fetchCrmContacts(env, { max = 5000 } = {}) {
  const docs = [];
  let after = null;

  while (docs.length < max) {
    const sq = {
      structuredQuery: {
        from: [{ collectionId: 'contacts' }],
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
        limit: 300,
      },
    };
    if (after) sq.structuredQuery.startAt = { values: [{ referenceValue: after }] };

    const rows = await call(env, '/documents:runQuery', { method: 'POST', body: sq });
    const batch = rows.filter((r) => r.document);
    if (batch.length === 0) break;
    for (const r of batch) docs.push(r.document);
    after = batch[batch.length - 1].document.name;
    if (batch.length < 300) break;
  }

  const teamFilter = env.MAIL_TEAM_ID || '';
  const out = [];
  const seen = new Set();

  for (const d of docs) {
    const c = fsDoc(d);
    const email = String(c.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    if (teamFilter && String(c.teamId || '') !== teamFilter) continue;

    const name = String(c.name || '');
    const tags = [
      ...(Array.isArray(c.tags) ? c.tags : []),
      ...(Array.isArray(c.segments) ? c.segments : []),
    ].map(String).filter(Boolean).slice(0, 5);

    out.push({
      email,
      first_name: name.split(' ')[0] || '',
      last_name: name.includes(' ') ? name.split(' ').slice(1).join(' ') : '',
      company_name: String(c.company || ''),
      phone: String(c.phone || ''),
      tags,
      _segment: String(c.status || 'lead').toLowerCase(),
      _created: c.createdAt || '',
      _leadScore: typeof c.leadScore === 'number' ? c.leadScore : null,
    });
    seen.add(email);
  }
  return out;
}

/* ── Users / roles ──────────────────────────────────────────────── */

/** Role of a user, for canManageCampaigns-style permission checks. */
export async function getUserRole(env, uid) {
  try {
    const doc = await call(env, `/documents/users/${encodeURIComponent(uid)}`);
    return fsDoc(doc).role || 'viewer';
  } catch (e) {
    console.warn(`[mailer:fs] role lookup failed for ${uid}: ${e.message}`);
    return null;
  }
}

export function canManageCampaigns(role) {
  return ['superAdmin', 'admin', 'manager'].includes(role);
}

/* ── Campaign write-back (app-visible!) ─────────────────────────── */

/**
 * Create the campaign document the Flutter marketing module renders.
 * Document id is deterministic so a retried pipeline run overwrites rather
 * than duplicates: campaigns/ai_{taskId}_{seq}.
 */
export async function upsertCampaignDoc(env, { id, fields }) {
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = fsValue(v);
  try {
    // PATCH on a specific name = create-or-replace.
    return await call(env, `/documents/campaigns/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
    });
  } catch (e) {
    console.warn(`[mailer:fs] campaign doc write failed (non-fatal): ${e.message}`);
    return null;
  }
}

/** Update just metrics/status on a campaign doc after an analytics pull. */
export async function updateCampaignMetrics(env, id, { metrics, status }) {
  const fields = {};
  if (metrics) fields.metrics = metrics;
  if (status) fields.status = status;
  const body = { fields: {} };
  for (const [k, v] of Object.entries(fields)) body.fields[k] = fsValue(v);
  try {
    await call(env, `/documents/campaigns/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body,
      mask: Object.keys(fields),
    });
    return true;
  } catch (e) {
    console.warn(`[mailer:fs] metrics update failed for ${id}: ${e.message}`);
    return false;
  }
}

/** Timeline entry so the 360° view shows the send. */
export async function logActivity(env, { title, description, campaignId, metadata }) {
  const body = {
    fields: fsValue({
      type: 'email',
      ownerId: 'ai-mailer',
      campaignId: campaignId || null,
      title: title || 'AI email campaign',
      description: description || '',
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    }).mapValue.fields,
  };
  try {
    await call(env, '/documents/activities', { method: 'POST', body });
  } catch (e) {
    console.warn(`[mailer:fs] activity log failed (non-fatal): ${e.message}`);
  }
}

/** Find campaign docs previously created by the mailer (metrics write-back). */
export async function findMailerCampaigns(env, { withinDays = 30 } = {}) {
  const sq = {
    structuredQuery: {
      from: [{ collectionId: 'campaigns' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'source' },
          op: 'EQUAL',
          value: { stringValue: 'ai-mailer' },
        },
      },
      limit: 100,
    },
  };
  const rows = await call(env, '/documents:runQuery', { method: 'POST', body: sq }).catch(() => []);
  const cutoff = Date.now() - withinDays * 86400000;
  return rows
    .filter((r) => r.document)
    .map((r) => fsDoc(r.document))
    .filter((c) => {
      const t = Date.parse(c.createdAt || c.updatedAt || '');
      return !Number.isFinite(t) || t >= cutoff;
    });
}
