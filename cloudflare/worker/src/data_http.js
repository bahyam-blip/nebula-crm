/**
 * Authenticated document API — the app's single database interface.
 *
 * Every route is POST with a JSON body (a private API behind a verified
 * Firebase ID token; uniform POSTs dodge URL-encoding pitfalls for
 * subcollection paths like chat_threads/{tid}/messages).
 *
 *   POST /v1/data/query   {col, where?, limit?, orderByIdDesc?} → {docs:[{id,data}]}
 *   POST /v1/data/get     {col, id}                             → {doc} | {doc:null}
 *   POST /v1/data/set     {col, id?, data, merge?}              → {id}
 *   POST /v1/data/delete  {col, id}                             → {ok:true}
 *   POST /v1/data/batch   {ops:[{op:'set'|'update'|'delete',col,id?,data?,merge?}]} → {ok, applied}
 *   POST /v1/data/bootstrap                                     → {user, flags}
 *   POST /v1/admin/migrate-from-firestore                       → per-collection counts
 */

import {
  getDoc, putDoc, deleteDoc, queryDocs, toStorage,
  canRead, canWrite, canDelete, scopeFor, loadUser,
  isSuperAdmin, isManagerUp,
} from './data.js';
import { bootstrapUser, migrateFromFirestore } from './bootstrap.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

/** Per-request cache so one request = one users/{uid} read. */
function memoUser(db, uid) {
  let p = null;
  return () => (p ??= loadUser(db, uid));
}

export async function handleDataRequest(request, env, { path, claims }) {
  // Same guard as the mailer: the app needs JSON errors, never a bare 1101.
  try {
    return await handleDataRequestInner(request, env, { path, claims });
  } catch (e) {
    console.error(`[data] unhandled error on ${path}:`, e?.stack || e);
    return json({ error: `data error: ${e?.message || e}` }, e?.status || 500);
  }
}

async function handleDataRequestInner(request, env, { path, claims }) {
  const db = env.DB;
  if (!db) return json({ error: 'D1 database not bound on this worker' }, 503);
  const url = new URL(request.url);
  const uid = claims.sub;
  const me = memoUser(db, uid);
  const b = await body(request);

  const deny = (msg, status = 403) => json({ error: msg }, status);

  // ── Bootstrap: everyone may call it (it IS the profile creator) ──
  if (path === '/v1/data/bootstrap' && request.method === 'POST') {
    return json(await bootstrapUser(env, db, { claims, body: b }));
  }

  // ── Migration (must run BEFORE profiles exist) ──────────────────
  // Allowed in bootstrap mode (users table empty) or by a superAdmin once
  // migrated. Skips itself once the 'migrated_at' marker exists.
  if (path === '/v1/admin/migrate-from-firestore' && request.method === 'POST') {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM docs WHERE col = ?').bind('users').first();
    const emptyStart = (count?.n ?? 0) === 0;
    const marker = await db.prepare('SELECT v FROM meta WHERE k = ?').bind('migrated_at').first();
    const force = url.searchParams.get('force') === '1' || b.force === true;
    if (!emptyStart && marker && !force) {
      return json({ ok: true, skipped: true, reason: 'already migrated — pass force=1 to re-run', migratedAt: marker.v });
    }
    const user0 = await me();
    if (!emptyStart && !(user0 && isSuperAdmin(user0))) return deny('migration needs a superAdmin');
    const result = await migrateFromFirestore(env, db).catch((e) => ({ error: e.message }));
    if (result.error) return json({ ok: false, error: result.error }, 500);
    const at = new Date().toISOString();
    await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
      .bind('migrated_at', at).run();
    return json({ ok: true, migratedAt: at, ...result });
  }

  // From here on the caller needs a profile (created by bootstrap).
  const user = await me();
  if (!user) return json({ error: 'profile missing — call /v1/data/bootstrap first' }, 409);
  if (b.teamId && b.teamId !== user.teamId && !isSuperAdmin(user)) {
    return deny('cross-team request');
  }

  switch (path) {
    // ── Query ──
    case '/v1/data/query': {
      const col = String(b.col || '');
      if (!col) return json({ error: 'col required' }, 400);
      const scope = scopeFor(user, col);
      if (scope === null) return deny(`no access to ${col}`);
      const where = [...scope, ...(Array.isArray(b.where) ? b.where : [])];
      const docs = await queryDocs(db, {
        col,
        where,
        limit: b.limit,
        orderByIdDesc: !!b.orderByIdDesc,
      });
      const visible = docs.filter((d) => canRead(user, col, { ...d.data, id: d.id }));
      return json({ docs: visible.map((d) => ({ id: d.id, data: d.data })) });
    }

    // ── Read one ──
    case '/v1/data/get': {
      const { col, id } = b;
      if (!col || !id) return json({ error: 'col and id required' }, 400);
      const doc = await getDoc(db, col, id);
      if (!doc || !canRead(user, col, { ...doc.data, id })) return json({ doc: null });
      return json({ doc: { id: doc.id, data: doc.data } });
    }

    // ── Write (create-or-merge) ──
    case '/v1/data/set': {
      const { col, id, data, merge } = b;
      if (!col || typeof data !== 'object' || data === null) return json({ error: 'col and data required' }, 400);
      const docId = id || crypto.randomUUID();
      const existing = await getDoc(db, col, docId);
      const merged = merge ? { ...(existing?.data || {}), ...toStorage(data) } : toStorage(data);
      if (!canWrite(user, col, existing?.data || null, merged)) return deny('write denied by policy');
      const stored = await putDoc(db, col, docId, merged, { merge: true, actor: user });
      // putDoc stamps teamId/ownerId from the actor so the writer can always
      // read their own write back.
      return json({ id: stored.id, updatedAt: stored.data.updatedAt });
    }

    // ── Delete ──
    case '/v1/data/delete': {
      const { col, id } = b;
      if (!col || !id) return json({ error: 'col and id required' }, 400);
      const existing = await getDoc(db, col, id);
      if (!existing) return json({ ok: true, absent: true });
      if (!canDelete(user, col, existing.data)) return deny('delete denied by policy');
      await deleteDoc(db, col, id);
      return json({ ok: true });
    }

    // ── Batch (telecalling rebalance, CSV import) ──
    case '/v1/data/batch': {
      const ops = Array.isArray(b.ops) ? b.ops : [];
      if (!ops.length) return json({ error: 'ops required' }, 400);
      if (ops.length > 500) return json({ error: 'max 500 ops per batch' }, 400);
      let applied = 0;
      try {
        for (const op of ops) {
          if (!op || !op.col) throw Object.assign(new Error('bad op'), { status: 400 });
          if (op.op === 'delete') {
            const existing = await getDoc(db, op.col, op.id);
            if (existing && canDelete(user, op.col, existing.data)) {
              await deleteDoc(db, op.col, op.id);
              applied++;
            }
            continue;
          }
          if (typeof op.data !== 'object' || op.data === null) throw Object.assign(new Error('bad op data'), { status: 400 });
          const docId = op.id || crypto.randomUUID();
          const existing = await getDoc(db, op.col, docId);
          const merged = op.merge === false ? toStorage(op.data) : { ...(existing?.data || {}), ...toStorage(op.data) };
          if (!canWrite(user, op.col, existing?.data || null, merged)) {
            throw Object.assign(new Error(`write denied for ${op.col}/${docId}`), { status: 403 });
          }
          await putDoc(db, op.col, docId, merged, { merge: true, actor: user });
          applied++;
        }
      } catch (e) {
        return json({ ok: false, applied, error: e.message }, e.status || 500);
      }
      return json({ ok: true, applied });
    }

    default:
      return json({ error: 'not found', routes: ['query', 'get', 'set', 'delete', 'batch', 'bootstrap', '/v1/admin/migrate-from-firestore'] }, 404);
  }
}

export { isManagerUp };
