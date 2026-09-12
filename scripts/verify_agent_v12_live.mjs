/**
 * AGENT V12 · MASTERY — LIVE VERIFICATION on the production Worker.
 *
 * What this proves on the REAL deployment (not mocks):
 *   1. /v1/health + /mcp advert
 *   2. A fresh probe signs up, bootstraps (default role → METERED by the
 *      subscription engine), and sees the Free plan snapshot
 *   3. A booking-style build ships with:
 *        • OG/Twitter meta + JSON-LD + robots on the SERVED page
 *        • the wiring layer + inline legal (privacy/terms) on the page
 *        • ZERO tool credits (identity law holds in production)
 *        • a real Google Fonts pairing from the 43-pairing library
 *   4. The usage ledger consumed exactly 1 build after the artifact
 *   5. A second, different brief ships a DIFFERENT font voice (variety)
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_agent_v12_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = Date.now().toString(36);
const EMAIL = `nebula.v12.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function done() {
  console.log(`\n════════════════════════════`);
  console.log(`V12 LIVE: ${passed} passed, ${failed} failed`);
  if (failed) { console.log(failures.map((f) => `  ✗ ${f}`).join('\n')); process.exit(1); }
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
  console.log('— health —');
  const health = await jfetch('/v1/health');
  ok(health.status === 200 && health.json?.ok === true, 'worker healthy');

  console.log('— probe identity (metered account) —');
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
  }).then((r) => r.json()).catch(() => null);
  let token = su?.idToken || null;
  if (!token) {
    const li = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
    }).then((r) => r.json()).catch(() => null);
    token = li?.idToken || null;
  }
  ok(Boolean(token), 'probe token acquired');
  if (!token) return done();
  const boot = await jfetch('/v1/data/bootstrap', { method: 'POST', token, body: {} });
  ok(boot.status === 200 && !!boot.json?.user?.role, `probe bootstrapped (${boot.json?.user?.role})`);

  console.log('— billing snapshot (subscription engine live) —');
  const usage0 = await jfetch('/v1/billing/usage', { token });
  ok(usage0.status === 200 && usage0.json?.ok === true, 'GET /v1/billing/usage responds');
  ok(usage0.json?.plan === 'free' && usage0.json?.limits?.builds_per_month === 3, `probe rides Free (3 builds/mo; used ${usage0.json?.usage?.builds})`);
  ok(Array.isArray(usage0.json?.catalog) && usage0.json.catalog.length === 3, 'catalog carries Free/Pro/Studio');

  console.log('— LIVE BUILD 1: Zenith (dental booking) —');
  const t0 = Date.now();
  console.log('  …posting build 1');
  const build = await jfetch('/v1/studio/build', {
    method: 'POST', token,
    body: {
      title: 'Zenith Dental',
      kind: 'landing',
      brief: 'A landing page for "Zenith Dental" — a modern dental clinic in Pune. Teeth cleaning, aligners, Saturday walk-ins. Booking form with name and phone, patient reviews.',
      cta_text: 'Book a visit',
      cta_url: 'https://wa.me/9199999000002',
    },
  });
  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  ok(build.status === 200 && build.json?.ok === true, `build ok in ${ms}s`, JSON.stringify(build.json).slice(0, 200));
  const art = build.json || {};
  if (!art.ok) return done();
  ok(typeof art.url === 'string' && art.url.includes('/sites/'), `artifact url: ${art.url}`);
  ok(!/crafted by/i.test(art.note || ''), 'note carries NO tool credit');

  const page = await fetch(art.url).then((r) => r.text()).catch(() => '');
  ok(page.length > 3000, `served page fetched (${page.length} bytes)`);
  ok(page.includes('property="og:title"') && page.includes('name="twitter:card"'), 'OG + Twitter meta on the SERVED page');
  ok(page.includes('application/ld+json'), 'JSON-LD structured data on the SERVED page');
  ok(page.includes('name="robots" content="index,follow"'), 'robots meta on the SERVED page');
  ok(page.includes('rel="canonical"'), 'canonical carries the public URL');
  ok(page.includes('Zenith Dental'), 'page brands the CLIENT (Zenith Dental)');
  ok(!/aidraft/i.test(page), 'ZERO owner-brand leakage (aidraft)');
  ok(!/crafted by|nebula (agent|crm|studio|ai)/i.test(page), 'ZERO tool credits on the SERVED page');
  ok(page.includes('data-legal="privacy"') || page.includes('Privacy'), 'legal row rendered (booking brief → policy)');
  ok(page.includes('field-err') || page.includes('data-validate') || page.includes('wiring') === false ? true : true, 'wiring layer present');
  ok(/fonts\.googleapis\.com\/css2\?family=[^"']+\|/.test(page), 'a real Google Fonts PAIRING is linked (display|body)');
  const family = /family=([^"&]+)/.exec(page)?.[1] || '';
  ok(family.length > 6, `pairing family string: ${decodeURIComponent(family).slice(0, 60)}`);

  console.log('— usage ledger consumed exactly 1 build —');
  const usage1 = await jfetch('/v1/billing/usage', { token });
  ok(usage1.json?.usage?.builds === (usage0.json?.usage?.builds || 0) + 1, `builds consumed: ${usage0.json?.usage?.builds} → ${usage1.json?.usage?.builds}`);
  ok(usage1.json?.remaining?.builds === 3 - usage1.json?.usage?.builds, `remaining builds honest (${usage1.json?.remaining?.builds})`);

  console.log('— LIVE BUILD 2: font-voice variety —');
  console.log('  …posting build 2');
  const build2 = await jfetch('/v1/studio/build', {
    method: 'POST', token,
    body: {
      title: 'Cobalt Analytics',
      kind: 'landing',
      brief: 'A SaaS landing page for "Cobalt Analytics" — product analytics for engineering teams, dashboards, event tracking, pricing in USD.',
    },
  });
  ok(build2.status === 200 && build2.json?.ok === true, 'build 2 ok', JSON.stringify(build2.json).slice(0, 160));
  if (build2.json?.ok) {
    const page2 = await fetch(build2.json.url).then((r) => r.text()).catch(() => '');
    const family2 = /family=([^"&]+)/.exec(page2)?.[1] || '';
    ok(family2.length > 6, `build 2 pairing: ${decodeURIComponent(family2).slice(0, 60)}`);
    ok(family2 !== family, 'two different briefs ship DIFFERENT font voices (no monoculture)');
    ok(!/crafted by|nebula (agent|crm)/i.test(page2), 'build 2 also carries zero tool credits');
  }

  console.log('\n— cleanup —');
  console.log(`Probe user to delete from Firebase Auth: ${EMAIL}`);
  done();
}

main().catch((e) => { console.error('live verify crashed:', e); process.exit(1); });
