#!/usr/bin/env node
/**
 * LIVE verify of the user's exact scenario against the deployed worker:
 *   "send a marketing email to 3 emails from the contacts now"
 * Expect: ONE email (not a 3-sequence), 3 recipients from ALL contacts
 * (no segment narrowing), scheduled ~now (not +30 min), delivered via the
 * chunk chain within ~3 minutes.
 */
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const API_KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const PROBE_EMAIL = `nebula.scale.${Date.now() % 1000000}@gmail.com`;
const PROBE_PW = 'Probe!23456789';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PW, returnSecureToken: true }) });
const j = await r.json().catch(() => ({}));
if (!j.idToken) { console.error('token fail', j); process.exit(1); }
const AH = { Authorization: `Bearer ${j.idToken}`, 'Content-Type': 'application/json' };

const created = await (await fetch(`${WORKER}/v1/mail/tasks`, { method: 'POST', headers: AH,
  body: JSON.stringify({ instruction: 'send a marketing email to 3 emails from the contacts now' }) })).json();
if (!created.ok) { console.error('task create failed', created); process.exit(1); }
const id = created.task.id;
console.log(`task ${id} created (${new Date().toISOString()})`);

let task = null;
for (let i = 0; i < 40; i++) {
  await sleep(i < 4 ? 8000 : 6000);
  const list = await (await fetch(`${WORKER}/v1/mail/tasks`, { headers: AH })).json();
  task = (list.tasks || []).find((t) => t.id === id);
  if (!task) { console.log('poll: task not listed yet'); continue; }
  const e1 = (task.emails || [])[0] || {};
  console.log(`poll ${i}: status=${task.status} emails=${(task.emails || []).length} e1=${e1.status} delivered=${e1.delivered ?? e1.delivery?.sent ?? '?'} plan=${task.plan ? `${task.plan.emails.length}e×${task.plan.audience.max_recipients}r(seg:${task.plan.audience.segment ?? 'all'})@${task.plan.emails[0]?.sendAt}` : '…'}`);
  if (['done', 'failed', 'cancelled'].includes(task.status)) break;
}

const plan = task?.plan || {};
const e1 = (task?.emails || [])[0] || {};
const sendAtOk = plan.emails?.[0]?.sendAt ? (Date.parse(plan.emails[0].sendAt) - Date.parse(task.createdAt)) < 10 * 60e3 : false;
console.log('\n── VERDICT ──');
console.log(`ONE email (not 3):            ${plan.emails?.length === 1 ? 'PASS' : 'FAIL'} (${plan.emails?.length})`);
console.log(`3 recipients from ALL:        ${plan.audience?.max_recipients === 3 && !plan.audience?.segment ? 'PASS' : 'FAIL'} (${JSON.stringify(plan.audience)})`);
console.log(`scheduled ~now (<10 min):     ${sendAtOk ? 'PASS' : 'FAIL'} (${plan.emails?.[0]?.sendAt})`);
console.log(`delivered:                    ${e1.delivery?.sent === 3 ? 'PASS' : 'FAIL'} (${JSON.stringify(e1.delivery)})`);
console.log(`task terminal:                ${['done'].includes(task?.status) ? 'PASS' : 'FAIL'} (${task?.status})`);
console.log(`last events:`);
for (const ev of (task?.events || []).slice(-6)) console.log(`  · [${ev.kind}] ${ev.text}`);
