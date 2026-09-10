#!/usr/bin/env node
/**
 * inspect_codegen_quality.mjs — build a REAL site through the live codegen
 * pipeline and save the hand-written HTML for quality inspection.
 */
const BASE = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const EMAIL = `nebula.qa.codegen.${Date.now().toString(36)}@gmail.com`;
const PW = 'Nebula-QA-2026!';

async function j(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

// 1. sign up a probe
const su = await j(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
});
if (!su.json?.idToken) { console.error('signup failed', JSON.stringify(su).slice(0, 200)); process.exit(1); }
const token = su.json.idToken;
await fetch(`${BASE}/v1/data/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' });

// 2. build a REAL site
const t0 = Date.now();
const built = await j(`${BASE}/v1/studio/build`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    title: 'Aarya Sarees',
    kind: 'landing',
    brief: 'Aarya Sarees is a family-run handloom saree boutique in Pune since 1994. Handwoven Paithani and Ilkal sarees, natural dyes, bespoke blouses. Audience: women 25-60 who value craft over fast fashion. CTA: book a boutique visit.',
    cta_text: 'Book a boutique visit',
  }),
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`build: ${built.status} in ${secs}s`);
console.log('builder:', built.json?.builder, '| bytes:', built.json?.bytes);
console.log('stages:', JSON.stringify((built.json?.stages || []).map((s) => `${s.stage}${s.ai ? '' : '(noai)'}: ${s.detail}`), null, 1));

// 3. fetch the served page and save for inspection
if (built.json?.url) {
  const res = await fetch(built.json.url);
  const html = await res.text();
  const fs = await import('node:fs');
  fs.mkdirSync('/home/z/my-project/download', { recursive: true });
  fs.writeFileSync('/home/z/my-project/download/codegen_live_site.html', html);
  console.log('saved', html.length, 'bytes → /home/z/my-project/download/codegen_live_site.html');
  console.log('URL:', built.json.url);

  // quick quality signals
  const checks = {
    'data-rev reveals': (html.match(/data-rev/g) || []).length,
    '@keyframes (custom motion)': (html.match(/@keyframes\s+[a-z0-9-]+/gi) || []).length,
    'scoped section rules': (html.match(/#sec-[a-z0-9-]+/g) || []).length,
    'media queries (responsive)': (html.match(/@media/g) || []).length,
    'clamp() type scale': (html.match(/clamp\(/g) || []).length,
    ':hover interactions': (html.match(/:hover/g) || []).length,
    'grid/flex layouts': (html.match(/display:(grid|flex)/g) || []).length,
  };
  console.log('\nQuality signals:');
  for (const [k, v] of Object.entries(checks)) console.log(`  ${k}: ${v}`);
}
console.log('\nProbe to delete in Firebase Auth:', EMAIL);
