#!/usr/bin/env node
/**
 * Zero-dependency end-to-end test for the D1 data layer
 * (the Firestore → Cloudflare D1 migration).
 *
 * Uses Node's built-in SQLite (node:sqlite) as a stand-in for D1 — the
 * schema.sql and every SQL statement the Worker emits are executed for real,
 * so schema drift breaks the tests instead of production.
 *
 *   node scripts/test_data_api.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const here = dirname(fileURLToPath(import.meta.url));

/* ── Minimal D1 shim over node:sqlite ───────────────────────────── */

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(here, '../cloudflare/worker/schema.sql'), 'utf8'));

  const d1 = {
    __sqlite: sqlite,
    prepare(sql) {
      let args = [];
      const builder = {
        bind(...a) { args = a; return builder; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() {
          const info = sqlite.prepare(sql).run(...args);
          return { meta: { changes: Number(info.changes) } };
        },
        __exec: () => sqlite.prepare(sql).run(...args),
      };
      return builder;
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) results.push(s.__exec ? s.__exec() : await s.run());
      return { results };
    },
  };
  return d1;
}

/* ── Module under test ──────────────────────────────────────────── */

const { handleDataRequest } = await import('../cloudflare/worker/src/data_http.js');

const env = {
  DB: null, // set per-test
  FIREBASE_PROJECT_ID: 'nebula-crm-70f58',
  DEFAULT_TEAM_ID: 'default-team',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'x', private_key: 'y' }),
};

function req(body, uid = 'u_owner') {
  return new Request('https://worker.test' + (body.__path || '/v1/data/query'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function call(env, body, uid = 'u_owner') {
  const res = await handleDataRequest(req(body), env, {
    path: body.__path || '/v1/data/query',
    claims: { sub: uid, email: `${uid}@example.com`, name: uid, picture: '' },
  });
  return { status: res.status, json: await res.json() };
}

/* ── Tests ──────────────────────────────────────────────────────── */

console.log('\n— 1. Bootstrap: first user claims superAdmin, second does not —');
{
  env.DB = makeD1();
  const first = await call(env, { __path: '/v1/data/bootstrap' });
  ok(first.status === 200 && first.json.user?.role === 'superAdmin', 'first signup becomes superAdmin', JSON.stringify(first.json).slice(0, 120));
  ok(first.json.flags?.isFirstUser === true, 'bootstrap flag reports first user');

  const second = await call(env, { __path: '/v1/data/bootstrap' }, 'u_two');
  ok(second.json.user?.role === 'salesRep', 'second signup lands as salesRep', second.json.user?.role);
  ok(second.json.user?.teamId === 'default-team', 'second signup joins the default team');
  ok(Array.isArray(second.json.user?.capabilities) && second.json.user.capabilities.includes('contacts.view'), 'capabilities seeded for role');

  const again = await call(env, { __path: '/v1/data/bootstrap' }, 'u_two');
  ok(again.json.flags?.existing === true, 're-bootstrap of an existing user is idempotent');
}

console.log('\n— 2. Team scoping: queries only return the caller\u2019s team —');
{
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner'); // superAdmin, default-team
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_rep');   // salesRep, default-team

  // Owner seeds a contact in default-team and one in another team.
  await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'c1',
    data: { name: 'Asha', teamId: 'default-team', ownerId: 'u_owner' },
  });
  await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'c2',
    data: { name: 'Other Team Person', teamId: 'team-other', ownerId: 'u_owner' },
  });

  const repList = await call(env, { __path: '/v1/data/query', col: 'contacts', limit: 50 }, 'u_rep');
  ok(repList.json.docs.length === 1 && repList.json.docs[0].id === 'c1',
    'salesRep sees only their team\u2019s contacts', JSON.stringify(repList.json.docs));

  const ownerList = await call(env, { __path: '/v1/data/query', col: 'contacts', limit: 50 }, 'u_owner');
  ok(ownerList.json.docs.length === 2, 'superAdmin (unscoped) sees both teams\u2019 contacts');

  // Cross-team write is refused even for the owner of the workspace.
  const xwrite = await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'c3',
    data: { name: 'X', teamId: 'team-other' },
  }, 'u_rep');
  ok(xwrite.status === 403, 'salesRep cannot write into another team', String(xwrite.status));
}

console.log('\n— 3. Codec semantics: sentinels, increments, arrays, timestamps —');
{
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner');

  await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'c1',
    data: { name: 'Asha', teamId: 'default-team', callAttempts: 0, tags: ['a'] },
  });
  await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'c1', merge: true,
    data: {
      callAttempts: { __type: 'inc', n: 2 },
      tags: { __type: 'aunion', v: ['b'] },
      lastCallAt: { __type: 'svts' },
    },
  });
  const got = await call(env, { __path: '/v1/data/get', col: 'contacts', id: 'c1' }, 'u_owner');
  const d = got.json.doc.data;
  ok(d.callAttempts === 2, 'increment applies server-side', String(d.callAttempts));
  ok(JSON.stringify(d.tags) === JSON.stringify(['a', 'b']), 'arrayUnion applies server-side', JSON.stringify(d.tags));
  ok(typeof d.lastCallAt === 'string' && !Number.isNaN(Date.parse(d.lastCallAt)), 'serverTimestamp stamps an ISO time', String(d.lastCallAt));
  ok(typeof d.updatedAt === 'string' && typeof d.createdAt === 'string', 'server stamps createdAt/updatedAt');

  // Timestamp round-trip via marker
  await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'c1', merge: true,
    data: { followUpAt: { __type: 'ts', v: '2026-09-01T10:00:00.000Z' } },
  });
  const got2 = await call(env, { __path: '/v1/data/get', col: 'contacts', id: 'c1' }, 'u_owner');
  ok(got2.json.doc.data.followUpAt?.__type === 'ts' && got2.json.doc.data.followUpAt?.v === '2026-09-01T10:00:00.000Z',
    'Timestamp marker round-trips intact');
}

console.log('\n— 4. Equality queries + subcollection paths —');
{
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner');
  await call(env, { __path: '/v1/data/set', col: 'tasks', id: 't1', data: { title: 'A', teamId: 'default-team', relatedContactId: 'c1', userId: 'u_owner' } });
  await call(env, { __path: '/v1/data/set', col: 'tasks', id: 't2', data: { title: 'B', teamId: 'default-team', relatedContactId: 'c2', userId: 'u_owner' } });

  const q = await call(env, { __path: '/v1/data/query', col: 'tasks', where: [{ field: 'relatedContactId', value: 'c1' }] }, 'u_owner');
  ok(q.json.docs.length === 1 && q.json.docs[0].data.title === 'A', 'equality filter works');

  const msgPath = 'chat_threads/th1/messages';
  await call(env, { __path: '/v1/data/set', col: msgPath, id: 'm1', data: { role: 'user', content: 'hi', userId: 'u_owner' } });
  await call(env, { __path: '/v1/data/set', col: msgPath, id: 'm2', data: { role: 'assistant', content: 'hello', userId: 'u_owner' } });
  const msgs = await call(env, { __path: '/v1/data/query', col: msgPath }, 'u_owner');
  ok(msgs.json.docs.length === 2, 'subcollection path stores + queries', String(msgs.json.docs.length));

  const badField = await call(env, { __path: '/v1/data/query', col: 'tasks', where: [{ field: "x'; DROP TABLE docs;--", value: 1 }] }, 'u_owner');
  ok(badField.status === 400, 'injection-shaped field names rejected');
  const table = env.DB.__sqlite.prepare("SELECT COUNT(*) AS n FROM docs").get();
  ok(table.n > 0, 'docs table still intact after injection attempt');
}

console.log('\n— 5. Ownership rules: a rep edits their own doc, not others\u2019 —');
{
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner');
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_rep');

  await call(env, { __path: '/v1/data/set', col: 'contacts', id: 'mine', data: { name: 'Mine', teamId: 'default-team', ownerId: 'u_rep' } });
  await call(env, { __path: '/v1/data/set', col: 'contacts', id: 'boss', data: { name: 'Boss', teamId: 'default-team', ownerId: 'u_owner' } });

  const selfEdit = await call(env, { __path: '/v1/data/set', col: 'contacts', id: 'mine', merge: true, data: { phone: '123' } }, 'u_rep');
  ok(selfEdit.status === 200, 'rep edits their own contact');
  const otherEdit = await call(env, { __path: '/v1/data/set', col: 'contacts', id: 'boss', merge: true, data: { phone: '123' } }, 'u_rep');
  ok(otherEdit.status === 403, 'rep cannot edit a colleague\u2019s contact', String(otherEdit.status));

  const roleGrab = await call(env, { __path: '/v1/data/set', col: 'users', id: 'u_rep', merge: true, data: { role: 'superAdmin' } }, 'u_rep');
  ok(roleGrab.status === 403, 'rep cannot self-promote to superAdmin', String(roleGrab.status));
}

console.log('\n— 6. Batch: all-or-nothing semantics on denial —');
{
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner');
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_rep');
  await call(env, { __path: '/v1/data/set', col: 'contacts', id: 'boss', data: { name: 'Boss', teamId: 'default-team', ownerId: 'u_owner' } });

  const r = await call(env, {
    __path: '/v1/data/batch',
    ops: [
      { op: 'set', col: 'contacts', id: 'ok1', data: { name: 'OK', teamId: 'default-team', ownerId: 'u_rep' } },
      { op: 'update', col: 'contacts', id: 'boss', data: { phone: '9' } },
    ],
  }, 'u_rep');
  ok(r.status === 403 && r.json.applied === 1, 'batch reports partial application on denial', JSON.stringify(r.json));
}

console.log('\n— 7. Server-side stamps: a rep can always read/edit what they created —');
{
  // The field incident: a client path (CSV import, AI action, raw probe)
  // creates a contact WITHOUT teamId/ownerId. The write succeeds, but the
  // doc used to come back unreadable and un-editable for its own creator
  // (403 on get/update/delete). The Worker must stamp teamId + ownerId
  // itself — "keep denormalized team readable by the writer".
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner');
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_rep');

  const created = await call(env, {
    __path: '/v1/data/set', col: 'contacts', id: 'bare',
    data: { name: 'Bare Import', email: 'bare@x.dev', status: 'lead' }, // no teamId, no ownerId
  }, 'u_rep');
  ok(created.status === 200, 'rep creates a contact with no teamId/ownerId', String(created.status));

  const back = await call(env, { __path: '/v1/data/get', col: 'contacts', id: 'bare' }, 'u_rep');
  ok(back.status === 200 && back.json.doc?.data?.name === 'Bare Import', 'creator reads their own write back', JSON.stringify(back.json).slice(0, 100));
  ok(back.json.doc?.data?.teamId === 'default-team', 'server stamped teamId', back.json.doc?.data?.teamId);
  ok(back.json.doc?.data?.ownerId === 'u_rep', 'server stamped ownerId = creator', back.json.doc?.data?.ownerId);

  const edit = await call(env, { __path: '/v1/data/set', col: 'contacts', id: 'bare', merge: true, data: { status: 'customer' } }, 'u_rep');
  ok(edit.status === 200, 'creator can update their auto-stamped contact', String(edit.status));
  const del = await call(env, { __path: '/v1/data/delete', col: 'contacts', id: 'bare' }, 'u_rep');
  ok(del.status === 200, 'creator can delete their auto-stamped contact', String(del.status));

  // Malformed where entries must be a 400, never a 500 from inside D1.
  const badWhere = await call(env, { __path: '/v1/data/query', col: 'contacts', where: [['email', '==', 'x']] }, 'u_rep');
  ok(badWhere.status === 400, 'malformed where clause → clean 400', String(badWhere.status));
}

console.log('\n— 8. Profile self-edit: unchanged privileged fields ride along safely —');
{
  // The reported bug: editing your own profile sent the MERGED document
  // (existing + patch), which always still contains role/teamId. Treating
  // presence as change made every self-edit 403 ("write denied by policy"),
  // so the profile screen never updated and the avatar URL never saved.
  env.DB = makeD1();
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_owner');
  await call(env, { __path: '/v1/data/bootstrap' }, 'u_rep');

  // Simulate the app: read the doc, then write back existing + patch.
  const before = await call(env, { __path: '/v1/data/get', col: 'users', id: 'u_rep' }, 'u_rep');
  const merged = { ...(before.json.doc?.data || {}), displayName: 'Ravi Rep', phone: '98765', photoUrl: 'https://worker.test/v1/file/avatars/u_rep/1.jpg' };
  const selfEdit = await call(env, { __path: '/v1/data/set', col: 'users', id: 'u_rep', merge: true, data: merged }, 'u_rep');
  ok(selfEdit.status === 200, 'rep self-edit with unchanged role/teamId in payload → 200 (was 403)', String(selfEdit.status));

  const after = await call(env, { __path: '/v1/data/get', col: 'users', id: 'u_rep' }, 'u_rep');
  ok(after.json.doc?.data?.displayName === 'Ravi Rep' && after.json.doc?.data?.phone === '98765', 'profile patch actually persisted', JSON.stringify(after.json.doc?.data || {}).slice(0, 120));
  ok(String(after.json.doc?.data?.photoUrl || '').includes('/v1/file/'), 'avatar URL saved on the user doc');
  ok(after.json.doc?.data?.role === 'salesRep', 'role untouched by the self-edit');

  // A REAL change to a privileged field must still be denied.
  const promote = await call(env, { __path: '/v1/data/set', col: 'users', id: 'u_rep', merge: true, data: { ...merged, role: 'admin' } }, 'u_rep');
  ok(promote.status === 403, 'rep changing their own role is still 403', String(promote.status));
  const move = await call(env, { __path: '/v1/data/set', col: 'users', id: 'u_rep', merge: true, data: { ...merged, teamId: 'other-team' } }, 'u_rep');
  ok(move.status === 403, 'rep changing their own teamId is still 403', String(move.status));
}

console.log('\n— 9. Firestore backfill merge: fill profile gaps, never clobber —');
{
  // coalesceUserDoc: D1 (newer, often bootstrap-created and half empty) wins
  // for anything non-empty; legacy Firestore only FILLS the gaps. An R2
  // avatar upload outranks a provider photo.
  const { coalesceUserDoc } = await import('../cloudflare/worker/src/bootstrap.js');

  const d1Row = { email: 'o@x.dev', displayName: '', phone: null, title: undefined, photoUrl: 'https://lh3.googleusercontent.com/a/xyz', role: 'superAdmin', tags: [] };
  const fsRow = { displayName: 'Nebula Owner', phone: '9876500000', title: 'Founder', photoUrl: 'https://worker.test/v1/file/avatars/uid9/1750000000.jpg', role: 'salesRep', tags: ['legacy'] };

  const merged = coalesceUserDoc(d1Row, fsRow);
  ok(merged.displayName === 'Nebula Owner', 'empty D1 name filled from Firestore', merged.displayName);
  ok(merged.phone === '9876500000', 'missing phone filled');
  ok(merged.title === 'Founder', 'missing title filled');
  ok(merged.role === 'superAdmin', 'non-empty D1 role NOT clobbered by legacy role');
  ok(merged.photoUrl.includes('/v1/file/'), 'uploaded R2 avatar outranks provider photo', merged.photoUrl);
  ok(!Array.isArray(merged.tags) || merged.tags.length === 0, 'empty D1 array not replaced by legacy array (no accidental data resurrection)');

  // D1 already has real data → Firestore changes nothing.
  const full = coalesceUserDoc({ displayName: 'Live Edit', phone: '111' }, { displayName: 'Old Name', phone: '222' });
  ok(full.displayName === 'Live Edit' && full.phone === '111', 'live D1 values win everywhere');

  // Null/undefined Firestore values are ignored entirely.
  const nulls = coalesceUserDoc({ displayName: 'A' }, { displayName: null, title: undefined, phone: '5' });
  ok(nulls.displayName === 'A' && nulls.title === undefined && nulls.phone === '5', 'null Firestore fields skipped, real ones fill');
}

console.log(`\n══════════════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('ALL GREEN');
