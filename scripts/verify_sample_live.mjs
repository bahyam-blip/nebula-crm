#!/usr/bin/env node
/**
 * LIVE post-deploy verification for the Sample-Campaign release (41ecb92+):
 *   1. POST /v1/mail/test sends a REAL customer-facing sample campaign
 *      (AI-drafted honouring the owner instruction) — response carries the
 *      exact email HTML, which must contain ZERO backend/infrastructure talk.
 *   2. A second sample in a different template style renders differently.
 *   3. Public tracking routes stay healthy (pixel / click / unsub).
 *
 * Usage: node scripts/verify_sample_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = `nebula.sample.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;
const OWNER_NOTIFY = 'bahyamshop2@gmail.com'; // owner-controlled inbox

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const BACKEND_LEAKS = ['MailerCloud', 'mailercloud', 'API key', 'transactional', 'email system works',
  'What this proves', 'One last thing to confirm', 'endpoint your CRM', 'nebula-test'];

async function main() {
  // 0) Mint a token
  let token;
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
  });
  if (su.ok) token = (await su.json()).idToken;
  else {
    const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
    });
    if (!si.ok) { console.log('signIn failed:', si.status, await si.text()); process.exit(1); }
    token = (await si.json()).idToken;
  }
  const AH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  ok(!!token, 'probe token minted', EMAIL);

  // 1) Real sample campaign with an owner instruction — aurora style.
  const INSTR = 'Announce our festive-season offer on AI contract drafting for law firms';
  const r1 = await fetch(`${WORKER}/v1/mail/test`, {
    method: 'POST', headers: AH,
    body: JSON.stringify({ to: OWNER_NOTIFY, instruction: INSTR, style: 'aurora' }),
  });
  const j1 = await r1.json().catch(() => ({}));
  ok(r1.status === 200 && j1.ok === true, 'sample campaign send → ok', JSON.stringify({ s: r1.status, e: j1.error, p: j1.provider_status }));
  ok(j1.template_style === 'aurora', 'style honoured (aurora)', j1.template_style);
  ok(j1.branded === true, 'sent under the business brand');
  ok(j1.subject && !/test email/i.test(j1.subject), 'subject is customer-facing (no "test email")', j1.subject);
  ok(['ai', 'signature'].includes(j1.drafted_by), 'drafted_by reported', j1.drafted_by);
  const h1 = j1.email_html || '';
  ok(h1.length > 1000, 'email_html present in response', `len=${h1.length}`);
  ok(h1.includes('#07080f'), 'aurora template rendered');
  ok(h1.includes('Unsubscribe'), 'one-click unsubscribe footer present');
  const leaks1 = BACKEND_LEAKS.filter((w) => h1.includes(w));
  ok(leaks1.length === 0, 'email body has ZERO backend talk (instruction sample)', leaks1.join(', '));
  ok(h1.includes('aidraft.bond') || h1.includes('Aidraft'), 'branded content present');
  console.log(`    → subject: "${j1.subject}" (drafted_by=${j1.drafted_by})`);

  // 2) Second sample — default style, no instruction — must render a different template.
  const r2 = await fetch(`${WORKER}/v1/mail/test`, {
    method: 'POST', headers: AH,
    body: JSON.stringify({ to: OWNER_NOTIFY }),
  });
  const j2 = await r2.json().catch(() => ({}));
  ok(r2.status === 200 && j2.ok === true, 'second sample (defaults) → ok', JSON.stringify({ s: r2.status, e: j2.error }));
  const h2 = j2.email_html || '';
  ok(!h2.includes('#07080f') || j2.template_style !== 'aurora', 'default style differs from aurora', j2.template_style);
  const leaks2 = BACKEND_LEAKS.filter((w) => h2.includes(w));
  ok(leaks2.length === 0, 'default sample also free of backend talk', leaks2.join(', '));
  ok(!/test email/i.test(j2.subject || 'test email'), 'default subject also customer-facing', j2.subject);
  console.log(`    → subject: "${j2.subject}" (style=${j2.template_style})`);

  // 3) Public routes healthy.
  const px = await fetch(`${WORKER}/v1/t/o.png`);
  ok(px.status === 200 && (px.headers.get('content-type') || '').includes('image'), 'open pixel 200 image/png');
  const ck = await fetch(`${WORKER}/v1/t/c?u=https%3A%2F%2Faidraft.bond&t=x`, { redirect: 'manual' });
  ok(ck.status === 302, 'click redirect 302', String(ck.status));
  const un = await fetch(`${WORKER}/v1/t/u?t=x`);
  ok(un.status === 200, 'unsubscribe page 200');

  console.log(`\n══════════════════════════════════════`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log('ALL GREEN — sample campaigns are customer-facing end to end.');
  console.log(`Owner inbox ${OWNER_NOTIFY} should now show TWO real sample campaigns (aurora + default).`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
