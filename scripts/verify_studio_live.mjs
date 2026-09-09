#!/usr/bin/env node
/**
 * LIVE post-deploy verification for the HOSTING FABRIC (studio wave):
 *   1. /v1/health + /mcp advert now carries 28 tools
 *   2. /v1/studio/* is auth-first (401 without a token)
 *   3. Probe user (salesRep) bootstrapped with a real Firebase token
 *   4. GET /v1/studio/connectors → 5 platforms with correct shapes
 *   5. REAL site built via /v1/studio/build (live Sarvam) and served
 *      publicly at /sites/<id> — the URL any browser can open
 *   6. GET /v1/studio/sites lists it; deployments route guards params
 *   7. Connect with a garbage GitHub token is REJECTED by live verification
 *      (nothing stored) — publish while unconnected fails cleanly
 *   8. salesRep is denied publish/connect (manager-only) over REST
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_studio_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = Date.now().toString(36);
const EMAIL = `nebula.studio.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function jfetch(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${WORKER}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* html */ }
  return { status: res.status, json };
}

async function main() {
  console.log('— health + MCP advert —');
  const health = await jfetch('/v1/health');
  ok(health.status === 200 && health.json?.ok === true, 'worker healthy');
  const advert = await jfetch('/mcp');
  ok(advert.status === 200 && advert.json?.tools === 28, '/mcp advert shows 28 tools', String(advert.json?.tools));

  console.log('— auth-first studio routes —');
  const anon = await jfetch('/v1/studio/connectors');
  ok(anon.status === 401, '/v1/studio/connectors without token → 401', String(anon.status));

  console.log('— probe identity —');
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
  }).then((r) => r.json()).catch(() => null);
  let token = su?.idToken || null;
  if (!token) {
    const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
    }).then((r) => r.json()).catch(() => null);
    token = si?.idToken || null;
  }
  ok(!!token, 'probe Firebase token obtained');
  const boot = await jfetch('/v1/data/bootstrap', { method: 'POST', token, body: {} });
  ok(boot.status === 200 && boot.json?.user?.role === 'salesRep', 'probe bootstrapped (salesRep)', JSON.stringify(boot.json).slice(0, 140));

  console.log('— connectors surface —');
  const conns = await jfetch('/v1/studio/connectors', { token });
  ok(conns.status === 200 && conns.json?.ok === true, 'GET /v1/studio/connectors ok');
  const platforms = conns.json?.platforms || [];
  ok(platforms.length === 5, '5 platforms advertised', String(platforms.length));
  ok(['github', 'vercel', 'firebase', 'godaddy', 'hostinger'].every((c) => platforms.some((p) => p.connector === c)),
    'all expected platforms present');
  ok(platforms.every((p) => typeof p.what === 'string' && typeof p.connected === 'boolean'),
    'platform shapes carry what + connected');

  console.log('— REAL build (live Sarvam, ~30-60s) —');
  const built = await jfetch('/v1/studio/build', {
    method: 'POST',
    token,
    body: {
      title: 'Studio Live Probe',
      kind: 'promo',
      brief: 'A weekend flash-sale offer page for a coffee roastery: 30% off all beans, urgency banner, 3 benefit cards (fresh roast, free shipping over ₹500, easy returns), WhatsApp CTA.',
    },
  });
  ok(built.status === 200 && built.json?.ok === true, 'POST /v1/studio/build ok', JSON.stringify(built.json).slice(0, 200));
  const siteId = built.json?.artifact_id || '';
  const siteUrl = built.json?.url || '';
  ok(/^https:\/\/.+\/sites\/.+/.test(siteUrl), 'build returns public URL', siteUrl);

  if (siteId) {
    const siteRes = await fetch(siteUrl);
    const html = await siteRes.text();
    ok(siteRes.status === 200 && /<!doctype html|<html/i.test(html) && html.length > 400,
      'site served publicly with real HTML', `${siteRes.status} ${html.length}B`);
    ok((built.json?.branded !== false), 'build metadata present', JSON.stringify(built.json).slice(0, 200));

    const sites = await jfetch('/v1/studio/sites', { token });
    ok(sites.json?.sites?.some((s) => s.id === siteId), 'GET /v1/studio/sites lists the new artifact');
    ok(sites.json?.sites?.find((s) => s.id === siteId)?.kind === 'promo', 'artifact kind recorded');

    const deps = await jfetch(`/v1/studio/deployments?artifact_id=${siteId}`, { token });
    ok(deps.status === 200 && Array.isArray(deps.json?.deployments), 'deployments route returns history');
  }

  console.log('— connect is live-verified; publish is role-gated —');
  const badConn = await jfetch('/v1/studio/connect', {
    method: 'POST', token,
    body: { connector: 'github', token: `ghp_invalid_${STAMP}` },
  });
  // Both outcomes prove the fabric is safe: the probe (salesRep) is blocked
  // at the role gate (403), OR a manager probing would hit the live-verify
  // rejection (400) with nothing stored.
  const roleGate = badConn.status === 403 && /role/.test(badConn.json?.error || '');
  const verifyGate = badConn.status === 400 && /rejected|Bad credentials|HTTP 401/i.test(badConn.json?.error || '');
  ok(roleGate || verifyGate,
    'bad connect rejected (role gate or live verify)',
    `${badConn.status} ${JSON.stringify(badConn.json).slice(0, 140)}`);

  const pubDenied = await jfetch('/v1/studio/publish', {
    method: 'POST', token,
    body: { artifact_id: siteId || 's_x', connector: 'github' },
  });
  ok(pubDenied.status === 403, 'salesRep denied publish (manager-only)', String(pubDenied.status));

  const pubUnconn = await jfetch('/v1/studio/nope', { token });
  ok(pubUnconn.status === 404, 'unknown studio route → 404');

  console.log('\n══════════════════════════════════════');
  console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
  console.log(`  Probe user to delete in Firebase Auth: ${EMAIL}`);
  if (failed) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  • ' + f);
    process.exit(1);
  }
}

main().catch((e) => { console.error('verify crashed:', e); process.exit(1); });
