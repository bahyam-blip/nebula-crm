#!/usr/bin/env node
/**
 * LIVE post-deploy verification for the scale/engagement/agent release (65ec2b6):
 *   1. GET /v1/mail/business → 7 template styles (editorial + spotlight live)
 *   2. Suppression API round-trip (add → list → remove) as a signed-in user
 *   3. Agentic assistant: live Sarvam answer with CRM snapshot access
 *   4. Public unsub page renders branded HTML (no auth)
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_agent_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = `nebula.agent.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function main() {
  // 0) Probe token
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
    token = si.ok ? (await si.json()).idToken : null;
  }
  const AH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  ok(!!token, 'probe token minted', EMAIL);

  // 1) Business profile: 7 template styles live
  const biz = await (await fetch(`${WORKER}/v1/mail/business`, { headers: AH })).json();
  const styles = biz.template_styles || [];
  ok(styles.length === 7 && styles.includes('editorial') && styles.includes('spotlight'),
    'GET /business exposes 7 template styles', JSON.stringify(styles));
  ok(biz.brand?.branded === true, 'live brand resolved (owner profile present)', biz.brand?.name);

  // 2) Suppression API round-trip
  const target = `probe.unsub.${STAMP}@example.com`;
  const add = await (await fetch(`${WORKER}/v1/mail/suppressions`, {
    method: 'POST', headers: AH, body: JSON.stringify({ email: target, reason: 'manual' }),
  })).json();
  ok(add.ok === true && add.suppressed === target, 'POST /suppressions adds', JSON.stringify(add));
  const list = await (await fetch(`${WORKER}/v1/mail/suppressions`, { headers: AH })).json();
  ok(list.count >= 1 && (list.suppressions || []).some((s) => s.email === target),
    'GET /suppressions shows the entry', `count=${list.count}`);
  const rm = await (await fetch(`${WORKER}/v1/mail/suppressions/remove`, {
    method: 'POST', headers: AH, body: JSON.stringify({ email: target }),
  })).json();
  ok(rm.ok === true && rm.removed === target, 'POST /suppressions/remove clears');

  // 3) Agentic assistant (real Sarvam — informational question only; no
  //    write tools triggered so nothing is queued/sent)
  const ar = await fetch(`${WORKER}/v1/assistant`, {
    method: 'POST', headers: AH,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Quick pulse check: how many contacts, open deals and email campaigns does the CRM have right now? Answer in one short sentence.' }] }),
  });
  const aj = await ar.json().catch(() => ({}));
  ok(ar.status === 200 && typeof aj.reply === 'string' && aj.reply.length > 5,
    'POST /v1/assistant → live agentic reply', `${ar.status} ${JSON.stringify(aj).slice(0, 140)}`);
  ok(Array.isArray(aj.actions), 'answer carries the actions array', JSON.stringify(aj.actions ?? null));

  // 4) Public unsub page (no auth) — branded HTML
  const page = await fetch(`${WORKER}/v1/t/u?c=ci_probe&u=ciprobe`);
  const html = await page.text();
  ok(page.status === 200 && html.includes('Unsubscribed'), 'public unsub page renders');
  ok(!html.includes('Nebula CRM'), 'unsub page branded (no Nebula CRM leak)', html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILURES:', failures); process.exit(1); }
  console.log(`LIVE OK — probe user to delete in Firebase Auth: ${EMAIL}`);
}

main().catch((e) => { console.error('probe crashed:', e); process.exit(1); });
