#!/usr/bin/env node
/** Live re-verify of profile + data parse-critical paths on the deployed worker. */
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const API_KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = `nebula.app.probe${Date.now() % 100000}.${STAMP}@gmail.com`;
const PW = 'Probe!23456789';
let passed = 0, failed = 0;
const ok = (c, n, x = '') => { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${x}`); } };

const sr = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }) });
const sj = await sr.json();
const idToken = sj.idToken || '';
ok(!!idToken, 'probe token', JSON.stringify(sj).slice(0, 120));
const AH = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
const boot = await (await fetch(`${WORKER}/v1/data/bootstrap`, { method: 'POST', headers: AH, body: '{}' })).json();
const uid = boot?.user?.id || sj.localId;

// Profile self-edit with role/teamId ride-along (the old 403 bug)
{
  const get0 = await (await fetch(`${WORKER}/v1/data/get`, { method: 'POST', headers: AH, body: JSON.stringify({ col: 'users', id: uid }) })).json();
  const user = get0?.doc?.data || {};
  const set = await fetch(`${WORKER}/v1/data/set`, { method: 'POST', headers: AH,
    body: JSON.stringify({ col: 'users', id: uid, merge: true,
      data: { displayName: 'E2E Probe', phone: '+91 90000 00000', title: 'Founder',
              role: user.role || 'owner', teamId: user.teamId || '' } }) });
  ok(set.status === 200, 'profile self-edit 200 (was 403)', String(set.status));
  const get = await (await fetch(`${WORKER}/v1/data/get`, { method: 'POST', headers: AH, body: JSON.stringify({ col: 'users', id: uid }) })).json();
  const d = get?.doc?.data || {};
  ok(d.displayName === 'E2E Probe' && d.title === 'Founder', 'profile edits persist', JSON.stringify(d).slice(0, 120));
  ok(d.updatedAt?.__type === 'ts' && !Number.isNaN(Date.parse(d.updatedAt.v)), 'server stamps are ts markers (app-safe)', JSON.stringify(d.updatedAt));
}

// Contact with serverTimestamp sentinel + list query (the contacts-crash path)
{
  await fetch(`${WORKER}/v1/data/set`, { method: 'POST', headers: AH,
    body: JSON.stringify({ col: 'contacts', id: 'c_e2e_1', data: { name: 'Asha', email: 'asha@x.com', status: 'lead',
      teamId: 'default-team', tags: ['vip'], lastActivityAt: { __type: 'svts' } } }) });
  const get = await (await fetch(`${WORKER}/v1/data/get`, { method: 'POST', headers: AH, body: JSON.stringify({ col: 'contacts', id: 'c_e2e_1' }) })).json();
  const d = get?.doc?.data || {};
  ok(d.lastActivityAt?.__type === 'ts', 'serverTimestamp resolves to ts marker', JSON.stringify(d.lastActivityAt));
  const q = await fetch(`${WORKER}/v1/data/query`, { method: 'POST', headers: AH,
    body: JSON.stringify({ col: 'contacts', limit: 10 }) });
  ok(q.status === 200, 'contacts query 200 (app list loads)', String(q.status));
}

// Avatar upload → public read
{
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(`${WORKER}/v1/upload?path=avatars/${uid}/e2e.png`,
    { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'image/png' }, body: png });
  const uj = await up.json().catch(() => ({}));
  ok(up.status === 200 && !!uj.url, 'avatar upload', JSON.stringify(uj).slice(0, 120));
  if (uj.url) {
    const dl = await fetch(uj.url);
    ok(dl.status === 200 && (dl.headers.get('content-type') || '').startsWith('image/'), 'avatar public read-back', `${dl.status}`);
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
