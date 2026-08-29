#!/usr/bin/env node
/**
 * LIVE post-deploy verification for the Business Branding release (844fcc2):
 *   1. business profile CRUD on the live worker
 *   2. /status reflects the branded From identity
 *   3. AI preview renders with the business brand (no "Nebula CRM" leak)
 *   4. a REAL test email goes out under the business brand
 *
 * Usage: node scripts/verify_brand_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = `nebula.brand.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;
const OWNER_NOTIFY = 'bahyamshop2@gmail.com'; // owner-controlled inbox (previous live checks)

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function main() {
  // 0) Mint a token
  let token;
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
  });
  if (su.ok) token = (await su.json()).idToken;
  else {
    console.log('signUp failed (may already exist) — trying signIn');
    const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
    });
    if (!si.ok) { console.log('signIn also failed:', si.status, await si.text()); process.exit(1); }
    token = (await si.json()).idToken;
  }
  const AH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  ok(!!token, 'probe token minted', EMAIL);

  // 1) Business profile CRUD
  const before = await (await fetch(`${WORKER}/v1/mail/business`, { headers: AH })).json();
  ok(Array.isArray(before.template_styles) && before.template_styles.length === 5, 'GET /business lists 5 template styles', JSON.stringify(before.template_styles));
  ok(before.brand && typeof before.brand.branded === 'boolean', 'resolved brand present');

  const BRAND = {
    business_name: 'AI Draft Bond',
    tagline: 'AI-powered legal drafting for Indian law firms',
    about: 'AI Draft Bond drafts, reviews and organises legal documents for Indian law practices — contracts, notices and case files drafted in minutes, reviewed and filed cleanly.',
    industry: 'Legal Technology',
    products: ['AI contract drafting', 'Document review', 'Case file organisation'],
    audience: 'Law firms, advocates and legal teams in India',
    tone: 'Confident, precise, premium',
    website: 'https://aidraft.bond',
    address: 'Bengaluru, India',
    contact_email: 'das@aidraft.bond',
    sender_name: 'AI Draft Bond',
    signature_name: 'Team AI Draft Bond',
    brand_color: '#7C5CFF',
    default_style: 'modern',
  };
  const save = await (await fetch(`${WORKER}/v1/mail/business`, {
    method: 'POST', headers: AH, body: JSON.stringify(BRAND),
  })).json();
  ok(save.ok === true, 'POST /business saved the brand');
  ok(save.brand?.fromName === 'AI Draft Bond', 'resolved From name = AI Draft Bond', JSON.stringify(save.brand));
  ok(save.taught === true, 'AI memory taught from profile');

  const after = await (await fetch(`${WORKER}/v1/mail/business`, { headers: AH })).json();
  ok(after.profile.business_name === 'AI Draft Bond' && after.profile.brand_color === '#7c5cff', 'profile persists with normalized fields');
  ok(after.brand.branded === true, 'brand.branded true');

  // 2) /status reports branded sender
  const st = await (await fetch(`${WORKER}/v1/mail/status`, { headers: AH })).json();
  ok(st.sender?.fromName === 'AI Draft Bond', '/status From name = business brand', JSON.stringify(st.sender));
  ok(st.business_profile?.branded === true, '/status business_profile.branded');

  // 3) AI preview — real Sarvam call — must be branded
  const pv = await fetch(`${WORKER}/v1/mail/preview?task=${encodeURIComponent('Announce our new AI drafting assistant to law firms')}&style=modern`, { headers: AH });
  const pvj = await pv.json().catch(() => ({}));
  const html = pvj.html || '';
  ok(pv.ok && html.length > 500, 'AI preview rendered', `len=${html.length}`);
  ok(html.includes('AI Draft Bond'), 'preview HTML carries the business name');
  ok(!html.includes('Nebula CRM'), 'preview HTML has NO Nebula CRM branding');
  ok(html.includes('Team AI Draft Bond'), 'preview signature = Team AI Draft Bond');
  ok(html.includes('aidraft.bond'), 'preview footer carries the website');

  // 4) REAL test email under the brand (owner-controlled inbox)
  const t = await (await fetch(`${WORKER}/v1/mail/test`, {
    method: 'POST', headers: AH, body: JSON.stringify({ to: OWNER_NOTIFY }),
  })).json();
  ok(t.ok === true, `REAL test email sent to ${OWNER_NOTIFY} — check inbox: it must show "AI Draft Bond" as sender`, JSON.stringify({ from: t.from, subject: t.subject }).slice(0, 200));
  ok(t.from === 'AI Draft Bond <das@aidraft.bond>', 'provider From = AI Draft Bond', t.from);
  ok(t.branded === true, 'test response marks branded=true');

  console.log(`\nNOTE: probe user ${EMAIL} can be deleted in Firebase Auth.`);
  console.log('NOTE: the business profile above was seeded from the owner\'s taught memory facts.');
  console.log('      The owner can edit everything in the app: AI Email → Business Profile (top card).');

  console.log('\n══════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('FAILURES:'); for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
  console.log('ALL GREEN');
}

main().catch((e) => { console.error(e); process.exit(1); });
