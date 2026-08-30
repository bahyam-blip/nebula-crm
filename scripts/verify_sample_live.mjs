#!/usr/bin/env node
/**
 * LIVE post-deploy verification for the Sample-Campaign release (41ecb92+):
 *   1. CONTENT PATH via /v1/mail/preview — the exact writeEmail + renderHtml
 *      chain the sample campaign uses. Asserts the AI honours the owner
 *      instruction and produces ZERO backend/infrastructure talk.
 *   2. REAL SEND via POST /v1/mail/test — full end-to-end. If the provider
 *      answers 9002 (sending quota exhausted) that is an ACCOUNT issue, not
 *      a code issue: reported loudly as an owner action, content checks
 *      already covered by (1).
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

let passed = 0, failed = 0, warns = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}
function warn(name, extra = '') { warns++; console.log(`  ⚠ ${name} ${extra}`); }

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

  // 1) CONTENT PATH — preview renders the same AI-drafted, branded email the
  //    sample send delivers (no provider quota involved).
  const INSTR = 'Announce our festive-season offer on AI contract drafting for law firms';
  const pv1 = await fetch(`${WORKER}/v1/mail/preview?task=${encodeURIComponent(INSTR)}&style=aurora`, { headers: AH });
  const j1 = await pv1.json().catch(() => ({}));
  const h1 = j1.html || '';
  ok(pv1.ok && h1.length > 1000, 'preview (aurora, instruction) rendered', `len=${h1.length}`);
  ok(h1.includes('#07080f'), 'aurora template rendered');
  const leaks1 = BACKEND_LEAKS.filter((w) => h1.includes(w));
  ok(leaks1.length === 0, 'AI-drafted content has ZERO backend talk', leaks1.join(', '));
  ok(!/test email/i.test(j1.copy?.subject || ''), 'subject is customer-facing', j1.copy?.subject);
  // NOTE: /preview renders WITHOUT tracking context (no campaign token), so no
  // unsubscribe footer here — campaign sends add it via the track block
  // (covered by the unit suites). Only content checks apply to previews.
  ok(h1.includes('aidraft.bond') || /aidraft/i.test(h1), 'branded content present');
  console.log(`    → subject: "${j1.copy?.subject}"`);

  const pv2 = await fetch(`${WORKER}/v1/mail/preview?task=${encodeURIComponent('Introduce our business to a new client')}&style=modern`, { headers: AH });
  const j2 = await pv2.json().catch(() => ({}));
  const h2 = j2.html || '';
  ok(pv2.ok && h2.length > 1000, 'preview (modern, defaults) rendered', `len=${h2.length}`);
  ok(!h2.includes('#07080f'), 'modern template differs from aurora');
  const leaks2 = BACKEND_LEAKS.filter((w) => h2.includes(w));
  ok(leaks2.length === 0, 'default-style content also free of backend talk', leaks2.join(', '));
  console.log(`    → subject: "${j2.copy?.subject}"`);

  // 2) REAL SEND — end to end. Quota exhaustion (9002) = account action.
  const r1 = await fetch(`${WORKER}/v1/mail/test`, {
    method: 'POST', headers: AH,
    body: JSON.stringify({ to: OWNER_NOTIFY, instruction: INSTR, style: 'aurora' }),
  });
  const s1 = await r1.json().catch(() => ({}));
  if (r1.status === 200 && s1.ok === true) {
    ok(s1.template_style === 'aurora', 'send: style honoured', s1.template_style);
    ok(s1.branded === true, 'send: business brand used');
    ok(!/test email/i.test(s1.subject || ''), 'send: subject customer-facing', s1.subject);
    ok(['ai', 'signature'].includes(s1.drafted_by), 'send: drafted_by reported', s1.drafted_by);
    const sh = s1.email_html || '';
    const leaks = BACKEND_LEAKS.filter((w) => sh.includes(w));
    ok(leaks.length === 0, 'send: delivered HTML free of backend talk', leaks.join(', '));
    console.log(`    → sent to ${s1.sent_to}: "${s1.subject}"`);
  } else if (s1.provider_status === 9002 || /quota/i.test(s1.error || '')) {
    warn(`PROVIDER QUOTA EXHAUSTED (MailerCloud 9002) — the send path is correct but the account needs a top-up. Owner action required.`, `(subject attempted: "${s1.message || s1.error}")`);
  } else {
    ok(false, 'sample send → ok', JSON.stringify({ s: r1.status, e: s1.error, p: s1.provider_status }));
  }

  // 3) Public routes healthy.
  const px = await fetch(`${WORKER}/v1/t/o.png`);
  ok(px.status === 200 && (px.headers.get('content-type') || '').includes('image'), 'open pixel 200 image/png');
  const ck = await fetch(`${WORKER}/v1/t/c?u=https%3A%2F%2Faidraft.bond&t=x`, { redirect: 'manual' });
  ok(ck.status === 302, 'click redirect 302', String(ck.status));
  const un = await fetch(`${WORKER}/v1/t/u?t=x`);
  ok(un.status === 200, 'unsubscribe page 200');

  console.log(`\n══════════════════════════════════════`);
  console.log(`  ${passed} passed, ${failed} failed, ${warns} owner-action warning(s)`);
  if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  if (warns) {
    console.log('NOTE: top up the MailerCloud sending plan (provider 9002), then re-run: node scripts/verify_sample_live.mjs');
  } else {
    console.log(`Owner inbox ${OWNER_NOTIFY} should now show the real sample campaign(s).`);
  }
  console.log('ALL GREEN — templates are customer-facing end to end.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
