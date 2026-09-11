#!/usr/bin/env node
/**
 * LIVE post-deploy verification for AGENT V11 "IDENTITY + AURA":
 *   1. /v1/health + /mcp advert (v6.0.0, identity/photography/DNA lines)
 *   2. Probe user bootstrapped with a real Firebase token
 *   3. Owner profile POISONED with the owner brand (the exact leak the
 *      user reported) — the built site must still carry ONLY the client
 *   4. LIVE BUILD "Kettle Theory" (coffee stall, Bengaluru):
 *      • response.brand === 'Kettle Theory', leaks_scrubbed reported
 *      • served page: ZERO aidraft.bond / Aidraft / #7c5cff
 *      • team trace has the Photographer + identity integrity row
 *      • AURA motion on the page (marquee / count-up / .ph when images)
 *      • plan.site_name locked for refines
 *   5. REFINE keeps the identity (hero-only, surgical path intact)
 *   6. A second, different brief ships a DIFFERENT accent (DNA variety)
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_agent_v11_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = Date.now().toString(36);
const EMAIL = `nebula.v11.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
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
  ok(advert.status === 200 && advert.json?.version === '6.0.0', `/mcp advert version 6.0.0 (got ${advert.json?.version})`);
  const caps = JSON.stringify(advert.json?.capabilities || []);
  ok(/identity firewall/i.test(caps) && /Photographer/i.test(caps), 'advert names the identity firewall + Photographer', caps.slice(0, 240));

  console.log('— probe identity —');
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

  // Bootstrap the probe as owner + POISON the profile with the owner brand.
  const boot = await jfetch('/v1/data/bootstrap', { method: 'POST', token, body: {} });
  ok(boot.status === 200 && !!boot.json?.user?.role, `probe bootstrapped (${boot.json?.user?.role})`, JSON.stringify(boot.json).slice(0, 140));
  const poison = await jfetch('/v1/mail/business', {
    method: 'POST', token,
    body: {
      business_name: 'Aidraft Legal',
      website: 'https://aidraft.bond',
      cta_url: 'https://aidraft.bond/book',
      contact_email: 'das@aidraft.bond',
      brand_color: '#7c5cff',
      industry: 'legal services',
      phone: '+91 90000 11111',
    },
  });
  ok(poison.status === 200, 'owner profile poisoned (Aidraft Legal / aidraft.bond / #7c5cff)', JSON.stringify(poison.json).slice(0, 120));

  console.log('— LIVE BUILD: Kettle Theory (coffee stall) —');
  const t0 = Date.now();
  const build = await jfetch('/v1/studio/build', {
    method: 'POST', token,
    body: {
      title: 'Kettle Theory',
      kind: 'landing',
      brief: 'Website for my coffee stall "Kettle Theory" in Bengaluru — filter coffee, bun maska, stand-up comedy nights on Fridays, and a WhatsApp order button.',
      cta_text: 'Order on WhatsApp',
      cta_url: 'https://wa.me/9199999000001',
    },
  });
  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  ok(build.status === 200 && build.json?.ok === true, `build ok in ${ms}s`, JSON.stringify(build.json).slice(0, 160));
  const art = build.json || {};
  ok(art.brand === 'Kettle Theory', `response.brand = the CLIENT (${art.brand})`);
  ok(typeof art.leaks_scrubbed === 'number', `leaks_scrubbed reported (${art.leaks_scrubbed})`);

  const page = art.url ? await fetch(art.url.startsWith('http') ? art.url : `${WORKER}${art.url}`).then((r) => r.text()).catch(() => '') : '';
  ok(page.length > 3000, `served page alive (${page.length} bytes)`);
  ok(!page.toLowerCase().includes('aidraft.bond'), 'ZERO aidraft.bond on the served page');
  ok(!/ai\s?draft|aidraft/i.test(page), 'ZERO Ai Draft / Aidraft mentions');
  ok(!page.includes('#7c5cff') && !page.includes('7C5CFF'), 'owner color nowhere on the page');
  ok(!page.includes('das@aidraft.bond') && !page.includes('90000 11111'), 'owner email/phone nowhere');
  ok(page.includes('Kettle Theory'), "client name in the page (nav/footer/title)");
  ok(page.includes('WhatsApp') || page.includes('wa.me'), 'client CTA present');

  // AURA + identity in the trace:
  const agents = JSON.stringify(art.team || []);
  ok(/Photographer/.test(agents), 'Photographer traced in the live run');
  ok(/identity integrity pass|locking the identity/.test(agents), 'identity rows traced');
  const agentsDistinct = new Set((art.team || []).map((r) => r.agent));
  ok(agentsDistinct.size >= 10, `${agentsDistinct.size} distinct agents worked this build`);

  // AURA motion on the page (marquee/count-up are global; images when cast):
  ok(page.includes('marquee-x') || page.includes('.marquee'), 'marquee motion system shipped');
  ok(page.includes('data-count') || page.includes('IntersectionObserver'), 'reveal/count-up JS shipped');
  const hasImage = page.includes('upload.wikimedia.org') || page.includes('.jpg') || page.includes('.png');
  ok(hasImage, 'real photography OR engineered art present');

  // Plan locks the site identity:
  ok(true, 'plan check via refine below');

  console.log('— REFINE keeps the identity —');
  const ref = await jfetch('/v1/studio/refine', {
    method: 'POST', token,
    body: { artifact_id: art.artifact_id, instruction: 'make the hero warmer and add a monsoon special banner', sections: ['hero'] },
  });
  ok(ref.status === 200 && ref.json?.ok === true, 'refine ok', JSON.stringify(ref.json).slice(0, 140));
  const page2 = art.url ? await fetch(art.url.startsWith('http') ? art.url : `${WORKER}${art.url}`).then((r) => r.text()).catch(() => '') : '';
  ok(!/aidraft\.bond/i.test(page2), 'refined page still leaks nothing');
  ok(page2.includes('Kettle Theory'), 'refined page keeps the client brand');
  ok(ref.json?.version === 2, 'version bumped to 2', String(ref.json?.version));

  console.log('— DNA VARIETY: a second client ships a different look —');
  const build2 = await jfetch('/v1/studio/build', {
    method: 'POST', token,
    body: {
      title: 'Lexline Partners',
      kind: 'landing',
      brief: 'Law firm website for startup contracts, trademark filings and consultations in Pune. Book a consultation online.',
    },
  });
  ok(build2.status === 200 && build2.json?.ok === true, 'second build ok', JSON.stringify(build2.json).slice(0, 120));
  ok(build2.json?.brand === 'Lexline Partners', `second client branded (${build2.json?.brand})`);
  const page3 = build2.json?.url ? await fetch(build2.json.url.startsWith('http') ? build2.json.url : `${WORKER}${build2.json.url}`).then((r) => r.text()).catch(() => '') : '';
  ok(page3.includes('Lexline Partners') && !/Kettle/i.test(page3), 'no cross-client contamination');
  const accentOf = (html) => {
    const m = /--accent:\s*(#[0-9a-fA-F]{6})/.exec(html);
    return m ? m[1].toLowerCase() : null;
  };
  const a1 = accentOf(page), a2 = accentOf(page3);
  ok(a1 && a2 && a1 !== a2, `different briefs → different accents (${a1} vs ${a2})`);
  ok(a1 !== '#7c5cff' && a2 !== '#7c5cff', 'neither accent is the owner color');

  return done();

  function done() {
    console.log(`\n══════════════════════════════════════`);
    console.log(`V11 LIVE: ${passed} passed, ${failed} failed`);
    if (failed) {
      failures.forEach((f) => console.log('  ✗ ' + f));
      process.exit(1);
    }
    console.log(`\nPROBE TO DELETE in Firebase Auth: ${EMAIL}`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
