/**
 * Cloudflare D1 document store — the Firestore replacement.
 *
 * The whole CRM database moved off Firestore onto D1 (SQLite at the edge),
 * so the only Firebase left in the stack is Google Sign-In (+ FCM push,
 * which rides the same Firebase project).
 *
 * Shape: one `docs` table keyed (col, id). `col` is the FULL collection
 * path — flat collections ("contacts") and subcollections
 * ("chat_threads/{tid}/messages") are both just paths. Payloads are JSON
 * with typed markers so rich values survive the trip:
 *
 *   stored:  { "__type": "ts", "v": "2026-08-01T10:00:00.000Z" }  Timestamp
 *   write-in sentinels (resolved here, never stored):
 *            { "__type": "svts" }                                  serverTimestamp
 *            { "__type": "inc",   "n": 1 }                         increment
 *            { "__type": "aunion",  "v": [..] }                    arrayUnion
 *            { "__type": "aremove", "v": [..] }                    arrayRemove
 *
 * The Flutter codec (lib/core/services/remote/data_codec.dart) mirrors this
 * exactly: Dart sends sentinels, hydrates "ts" markers back into real
 * cloud_firestore Timestamp objects — the existing model parsers keep
 * working unmodified.
 */

const MAX_LIMIT = 500;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const ID_RE = /^[A-Za-z0-9_\-=+]{1,128}$/;
const COL_RE = /^[A-Za-z0-9_]+(\/[A-Za-z0-9_\-=+]+)*$/;

/* ── Value helpers ──────────────────────────────────────────────── */

export function isMarker(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.__type === 'string';
}

export function nowIso() {
  return new Date().toISOString();
}

/** Recursively resolve write-time sentinels against an existing doc. */
function applySentinels(data, existing) {
  const out = {};
  for (const [k, raw] of Object.entries(data)) {
    if (isMarker(raw)) {
      switch (raw.__type) {
        case 'svts':
          out[k] = nowIso();
          continue;
        case 'ts':
          out[k] = { __type: 'ts', v: raw.v };
          continue;
        case 'inc': {
          const cur = Number(existing?.[k] ?? 0);
          out[k] = cur + Number(raw.n ?? 0);
          continue;
        }
        case 'aunion': {
          const cur = Array.isArray(existing?.[k]) ? [...existing[k]] : [];
          for (const item of raw.v || []) if (!cur.some((x) => JSON.stringify(x) === JSON.stringify(item))) cur.push(item);
          out[k] = cur;
          continue;
        }
        case 'aremove': {
          const cur = Array.isArray(existing?.[k]) ? [...existing[k]] : [];
          const rm = new Set((raw.v || []).map((x) => JSON.stringify(x)));
          out[k] = cur.filter((x) => !rm.has(JSON.stringify(x)));
          continue;
        }
        default:
          throw Object.assign(new Error(`unknown value marker __type:${raw.__type}`), { status: 400 });
      }
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      out[k] = applySentinels(raw, existing?.[k] && typeof existing[k] === 'object' ? existing[k] : {});
      continue;
    }
    if (Array.isArray(raw)) {
      out[k] = raw.map((v) => (isMarker(v) ? applySentinels({ v }, {}) : v));
      // markers inside arrays other than plain values are not supported
      out[k] = out[k].map((v) => (v && typeof v === 'object' && '__type' in v && 'v' in v && Object.keys(v).length === 2 ? v : v));
      continue;
    }
    out[k] = raw;
  }
  return out;
}

/* ── Doc store ──────────────────────────────────────────────────── */

function parseRow(row) {
  if (!row) return null;
  let data;
  try { data = JSON.parse(row.json); } catch { data = {}; }
  return { id: row.id, data, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getDoc(db, col, id) {
  const row = await db
    .prepare('SELECT col, id, json, created_at, updated_at FROM docs WHERE col = ? AND id = ?')
    .bind(col, id)
    .first();
  return parseRow(row);
}

export async function putDoc(db, col, id, data, { merge = false, touchOnly = false, actor = null } = {}) {
  if (!COL_RE.test(col)) throw Object.assign(new Error('bad collection path'), { status: 400 });
  if (!ID_RE.test(id)) throw Object.assign(new Error('bad document id'), { status: 400 });

  const existingRow = await getDoc(db, col, id);
  const existing = existingRow?.data || null;

  let payload = merge && existing ? { ...existing, ...data } : { ...data };
  payload = applySentinels(payload, existing || {});

  // Server-side stamps (the "keep denormalized team readable by the writer"
  // contract): whatever client path wrote the doc — app screen, CSV import,
  // AI action, server cron — the doc always ends up with a teamId, and a
  // newly created team doc ends up owned by its creator. Without this, a
  // client that forgets ownerId/ teamId creates records it can never read
  // back or edit (the write succeeds, everything after 403s).
  if (actor) {
    if (!payload.teamId && actor.teamId) payload.teamId = actor.teamId;
    if (!existing && AUTO_OWNER_COLS.has(col) && !payload.ownerId && actor.uid) {
      payload.ownerId = actor.uid;
    }
  }

  const now = Date.now();
  const createdAt = existingRow?.createdAt ?? now;
  // Server stamps: every doc gets updatedAt; createdAt survives merges.
  payload.updatedAt = nowIso();
  if (!payload.createdAt && !existing?.createdAt) payload.createdAt = nowIso();

  const teamId = typeof payload.teamId === 'string' ? payload.teamId : null;
  const json = JSON.stringify(payload);

  await db
    .prepare(
      `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(col, id) DO UPDATE SET team_id = excluded.team_id, json = excluded.json, updated_at = excluded.updated_at`
    )
    .bind(col, id, teamId, json, createdAt, now)
    .run();
  return { id, data: payload, createdAt, updatedAt: now };
}

export async function deleteDoc(db, col, id) {
  await db.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(col, id).run();
}

/**
 * Equality query over JSON fields — the only operator the app ever used
 * (Firestore `isEqualTo`). Values must be plain JSON (Timestamps are passed
 * as the same ISO string the storage marker carries; normalize on the
 * caller side with tsToIso()).
 */
export async function queryDocs(db, { col, where = [], limit = 100, orderByIdDesc = false }) {
  if (!COL_RE.test(col)) throw Object.assign(new Error('bad collection path'), { status: 400 });
  const clauses = ['col = ?'];
  const args = [col];
  for (const w of where) {
    // Malformed where entries (raw arrays, missing field) must be a clean
    // 400 — they used to slip through as json_extract '$.undefined' and
    // blow up inside D1 as a 500.
    if (!w || typeof w !== 'object' || Array.isArray(w) || typeof w.field !== 'string') {
      throw Object.assign(new Error('bad query field'), { status: 400 });
    }
    if (!FIELD_RE.test(w.field)) throw Object.assign(new Error('bad query field'), { status: 400 });
    if (w.op && w.op !== '==' && w.op !== '!=') throw Object.assign(new Error('only == / != supported'), { status: 400 });
    const val = w.value && typeof w.value === 'object' ? JSON.stringify(w.value) : w.value;
    const expr = `json_extract(json, '$.${w.field}')`;
    clauses.push(w.op === '!=' ? `${expr} IS NOT ?` : `${expr} IS ?`);
    args.push(val);
  }
  const n = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || 100));
  const sql =
    `SELECT col, id, json, created_at, updated_at FROM docs WHERE ${clauses.join(' AND ')}` +
    (orderByIdDesc ? ' ORDER BY id DESC' : ' ORDER BY created_at ASC, id ASC') +
    ` LIMIT ${n}`;
  const { results } = await db.prepare(sql).bind(...args).all();
  return (results || []).map(parseRow).filter(Boolean);
}

/** Plain value → storage form (Timestamps become markers). */
export function toStorage(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return { __type: 'ts', v: v.toISOString() };
  if (Array.isArray(v)) return v.map(toStorage);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toStorage(val);
    return out;
  }
  return v;
}

/** Firestore REST value → storage form (used by the migration). */
export function fsRestToStorage(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return { __type: 'ts', v: new Date(v.timestampValue).toISOString() };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsRestToStorage);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) out[k] = fsRestToStorage(val);
    return out;
  }
  if ('geoPointValue' in v) return { __type: 'geo', lat: v.geoPointValue.latitude, lng: v.geoPointValue.longitude };
  if ('referenceValue' in v) return { __type: 'ref', v: v.referenceValue };
  return null;
}

/* ── Permissions ──────────────────────────────────────────────────
 * Mirrors the spirit of firestore.rules: team-scoped collaboration data,
 * owner-scoped personal data, role-gated administration.
 */

const TEAM_COLLECTIONS = new Set([
  'contacts', 'deals', 'activities', 'campaigns', 'tickets', 'articles',
  'companies', 'call_logs', 'audit_logs', 'commissions', 'settings', 'invites', 'teams',
]);
const OWNER_COLLECTIONS = new Set(['notes', 'tasks', 'insights']);
const PUBLIC_READ_COLLECTIONS = new Set(['articles']);

/** Team collections where the creator becomes the (co-)owner on create.
 * Mirrors the legacy rules ("isOwner can update/delete") — without a
 * server-side stamp, a rep who creates a record without ownerId could
 * never edit it again. settings/invites/teams/audit_logs are excluded:
 * they are manager/system territory, not personal records. */
const AUTO_OWNER_COLS = new Set([
  'contacts', 'deals', 'activities', 'campaigns', 'tickets', 'articles',
  'companies', 'commissions', 'call_logs',
]);

export function isSuperAdmin(user) {
  return user?.role === 'superAdmin';
}
export function isManagerUp(user) {
  return ['superAdmin', 'admin', 'manager'].includes(user?.role);
}

function ownerFieldFor(col) {
  if (OWNER_COLLECTIONS.has(col)) return 'userId';
  return null;
}

/** Can [user] read docs of [col] with teamId [docTeam] and payload [data]? */
export function canRead(user, col, data) {
  if (isSuperAdmin(user)) return true;
  if (PUBLIC_READ_COLLECTIONS.has(col)) return true;
  if (col === 'users') {
    // Own profile always; team roster for managers; membership needed for others.
    if (data.id === user.uid) return true;
    if (isManagerUp(user)) return true;
    return data.teamId && data.teamId === user.teamId;
  }
  if (col === 'chat_threads' || col.startsWith('chat_threads/')) {
    const parts = Array.isArray(data.participants) ? data.participants : [];
    return parts.includes(user.uid);
  }
  if (TEAM_COLLECTIONS.has(col)) return data.teamId === user.teamId;
  if (OWNER_COLLECTIONS.has(col)) return data.userId === user.uid;
  if (col === 'chat_threads' || col.includes('/messages')) return true;
  return false;
}

/** Can [user] write (create/update) a doc of [col]? Validated pre-write. */
export function canWrite(user, col, existingData, newData) {
  if (isSuperAdmin(user)) return true;
  const ownCol = col === 'users';
  const ownerField = ownerFieldFor(col);

  if (ownCol) {
    // Profile: self-edit always; role/capabilities/team changes need admin.
    if (existingData && existingData.id !== user.uid && existingData.id !== undefined) {
      if (!isManagerUp(user)) return false;
      if (existingData.teamId !== user.teamId && !isSuperAdmin(user)) return false;
    }
    const privileged = ['role', 'capabilities', 'teamId'];
    const touchingPrivileged = privileged.some((k) => k in newData);
    if (touchingPrivileged && !isManagerUp(user)) return false;
    if (newData.role === 'superAdmin' && !isSuperAdmin(user)) return false;
    if (touchingPrivileged && existingData && existingData.role === 'superAdmin' && !isSuperAdmin(user)) return false;
    return true;
  }

  if (col === 'teams') return false; // only superAdmin (handled above)
  if (col === 'system' || col.startsWith('system/')) return false;
  if (col === 'audit_logs') return false; // server-written
  if (col === 'invites') return isManagerUp(user) && (!existingData || existingData.teamId === user.teamId);

  if (OWNER_COLLECTIONS.has(col)) {
    if (ownerField && existingData && existingData[ownerField] !== user.uid) return false;
    return true;
  }

  if (col.startsWith('chat_threads')) {
    const parts = Array.isArray(existingData?.participants) ? existingData.participants : [];
    return existingData ? parts.includes(user.uid) || isManagerUp(user) : true;
  }

  if (TEAM_COLLECTIONS.has(col)) {
    if (existingData && existingData.teamId !== user.teamId) return false;
    if (!existingData) {
      // Creates must carry the caller's team (or a team the caller leads).
      const t = newData.teamId ?? user.teamId;
      if (t !== user.teamId && !isSuperAdmin(user)) return false;
      return true;
    }
    // Team data: managers edit anything; reps edit what they own.
    if (isManagerUp(user)) return true;
    const owner = existingData.ownerId ?? existingData.assigneeId;
    return owner === user.uid;
  }
  return false;
}

export function canDelete(user, col, data) {
  if (isSuperAdmin(user)) return true;
  if (TEAM_COLLECTIONS.has(col)) {
    if (data.teamId !== user.teamId) return false;
    if (isManagerUp(user)) return true;
    const owner = data.ownerId ?? data.assigneeId;
    return owner === user.uid;
  }
  if (OWNER_COLLECTIONS.has(col)) return data.userId === user.uid;
  if (col === 'users') return isSuperAdmin(user);
  if (col === 'invites') return isManagerUp(user) && data.teamId === user.teamId;
  if (col.startsWith('chat_threads')) {
    const parts = Array.isArray(data.participants) ? data.participants : [];
    return parts.includes(user.uid);
  }
  return false;
}

/** The where-clause that scopes any list to what the caller may see. */
export function scopeFor(user, col) {
  if (isSuperAdmin(user)) return [];
  if (col === 'users') return isManagerUp(user) ? [{ field: 'teamId', value: user.teamId }] : [{ field: 'id', value: user.uid }];
  if (OWNER_COLLECTIONS.has(col)) return [{ field: 'userId', value: user.uid }];
  if (col === 'invites') return isManagerUp(user) ? [{ field: 'teamId', value: user.teamId }] : null; // null = denied
  if (TEAM_COLLECTIONS.has(col)) return [{ field: 'teamId', value: user.teamId }];
  return [];
}

/** Load the caller's profile from D1 (role, teamId, capabilities). */
export async function loadUser(db, uid) {
  const doc = await getDoc(db, 'users', uid);
  if (!doc) return null;
  return {
    uid,
    id: uid,
    email: doc.data.email ?? '',
    role: doc.data.role ?? 'salesRep',
    teamId: doc.data.teamId ?? '',
    capabilities: Array.isArray(doc.data.capabilities) ? doc.data.capabilities : [],
    displayName: doc.data.displayName ?? '',
  };
}
