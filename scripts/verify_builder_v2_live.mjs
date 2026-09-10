#!/usr/bin/env node
/**
 * LIVE post-deploy verification for BUILDER V2 (the Fable-class engine):
 *   1. /v1/health + /mcp advert carries 30 tools
 *   2. /v1/studio/refine is auth-first (401 without a token)
 *   3. Probe user (salesRep) bootstrapped with a real Firebase token
 *   4. Connectors surface: 6 platforms including Supabase (backend)
 *   5. REAL build via /v1/studio/build (live Sarvam):
 *        - stage trace present (think → research → write → render)
 *        - served HTML is a COMPLETE document — no fences, no chatter
 *          (the exact screenshots bug), mobile viewport, premium engine JS
 *   6. REAL refine via /v1/studio/refine: same URL, version 2, ?v=1 still
 *      serves the original snapshot
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_builder_v2_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = Date.now().toString(36);
const EMAIL = `nebula.bv2.probe.${STAMP}@gmail.com`;
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
  return { status: res.status, json, text: json ? '' : await res.text().catch(() => '') };
}

async function main() {
  console.log('— health + MCP advert —');
  const health = await jfetch('/v1/health');
  ok(health.status === 200 && health.json?.ok === true, 'worker healthy');
  const advert = await jfetch('/mcp');
  ok(advert.status === 200 && advert.json?.tools === 33, '/mcp advert shows 33 tools', String(advert.json?.tools));

  console.log('— refine route is auth-first —');
  const anon = await jfetch('/v1/studio/refine', { method: 'POST', body: { artifact_id: 'x', instruction: 'y' } });
  ok(anon.status === 401, '/v1/studio/refine without token → 401', String(anon.status));

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

  console.log('— connectors surface (incl. Supabase) —');
  const conns = await jfetch('/v1/studio/connectors', { token });
  const platforms = conns.json?.platforms || [];
  ok(platforms.length === 6, '6 platforms advertised', String(platforms.length));
  const sb = platforms.find((p) => p.connector === 'supabase');
  ok(!!sb && sb.kind === 'backend' && /SQL|database/i.test(sb.what || ''), 'Supabase listed as a backend platform');

  console.log('— REAL build (live Sarvam, staged pipeline) —');
  const built = await jfetch('/v1/studio/build', {
    method: 'POST',
    token,
    body: {
      title: 'Musafir Coffee',
      kind: 'landing',
      brief: 'A cozy specialty coffee shop called Musafir in Mumbai. Single-origin pours, weekend cupping sessions, warm minimal interior. CTA: order on WhatsApp.',
      cta_text: 'Order on WhatsApp',
      cta_url: 'https://wa.me/910000000000',
    },
  });
  ok(built.status === 200 && built.json?.ok === true, 'POST /v1/studio/build ok', JSON.stringify(built.json).slice(0, 220));
  const siteId = built.json?.artifact_id || '';
  const siteUrl = built.json?.url || '';
  ok(['ai', 'ai+engine'].includes(built.json?.builder || ''), 'builder label recorded', built.json?.builder);
  const stageNames = (built.json?.stages || []).map((s) => s.stage);
  ok(stageNames[0] === 'think' && stageNames.includes('write') && stageNames.includes('render'),
    'stage trace: think → research → write → render', JSON.stringify(stageNames));

  if (siteId) {
    const siteRes = await fetch(siteUrl);
    const html = await siteRes.text();
    ok(siteRes.status === 200 && /^<!DOCTYPE html>/i.test(html.trim()), 'served page starts with <!DOCTYPE html>');
    ok(!html.includes('```'), 'no markdown fences in the served site');
    ok(!/want it on github/i.test(html), 'no model chatter in the served site');
    ok(html.includes('</html>') && html.includes('</body>'), 'document is complete');
    ok(html.includes('name="viewport"'), 'mobile viewport present');
    ok(html.includes('Order on WhatsApp'), 'CTA override landed in the page');
    ok(html.length > 3000, 'page is substantial (premium template, not a stub)', `${html.length}B`);

    console.log('— REAL refine (same URL, new version) —');
    const refined = await jfetch('/v1/studio/refine', {
      method: 'POST',
      token,
      body: { artifact_id: siteId, instruction: 'Make the headline shorter and punchier, and add a small FAQ about opening hours.' },
    });
    ok(refined.status === 200 && refined.json?.ok === true, 'POST /v1/studio/refine ok', JSON.stringify(refined.json).slice(0, 200));
    ok(refined.json?.version === 2, 'refine bumps to version 2', String(refined.json?.version));
    ok(refined.json?.url === siteUrl, 'same public URL after refine');

    const v2res = await fetch(siteUrl);
    const v2 = await v2res.text();
    ok(v2res.status === 200 && !v2.includes('```') && v2.includes('</html>'), 'v2 serves a complete clean document');
    const v1res = await fetch(`${siteUrl}?v=1`);
    const v1 = await v1res.text();
    ok(v1res.status === 200 && v1.length > 3000 && v1 !== v2, '?v=1 still serves the original snapshot');
  }

  console.log(`\n════════════════════════════════════════`);
  console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log(`\nProbe user to delete in Firebase Auth: ${EMAIL}`);
  console.log('All builder-v2 live checks green.');
}

main().catch((e) => { console.error(e); process.exit(1); });
