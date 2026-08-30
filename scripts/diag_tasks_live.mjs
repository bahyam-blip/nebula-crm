#!/usr/bin/env node
/**
 * Live diagnostic: read the deployed worker's mail tasks + status + analytics
 * to see exactly what happened to the owner's "send to hundreds" task.
 */
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const API_KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const PROBE_EMAIL = `nebula.diag.${Date.now() % 1000000}@gmail.com`;
const PROBE_PW = 'Probe!23456789';

const r = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PW, returnSecureToken: true }) });
const j = await r.json().catch(() => ({}));
if (!j.idToken) { console.error('token mint failed', j); process.exit(1); }
const AH = { Authorization: `Bearer ${j.idToken}`, 'Content-Type': 'application/json' };

const status = await (await fetch(`${WORKER}/v1/mail/status`, { headers: AH })).json();
console.log('══ STATUS ══');
console.log(JSON.stringify(status, null, 2).slice(0, 2500));

const tasks = await (await fetch(`${WORKER}/v1/mail/tasks`, { headers: AH })).json();
console.log(`\n══ TASKS (${tasks.count}) ══`);
for (const t of (tasks.tasks || []).slice(0, 8)) {
  console.log(`\n— ${t.id} [${t.status}] created ${t.createdAt} by ${t.createdBy}`);
  console.log(`  instruction: ${String(t.instruction).slice(0, 220)}`);
  if (t.plan) {
    console.log(`  plan.understanding: ${t.plan.understanding}`);
    console.log(`  plan.audience: ${JSON.stringify(t.plan.audience)}`);
    console.log(`  plan.explicit: ${JSON.stringify(t.plan.explicit_recipients || []).slice(0, 200)}`);
    for (const e of t.plan.emails || []) console.log(`  plan.email seq=${e.seq} sendAt=${e.sendAt} style=${e.template_style}`);
  }
  for (const e of t.emails || []) console.log(`  email seq=${e.seq} [${e.status}] sendAt=${e.sendAt} err=${e.error || '-'} delivery=${JSON.stringify(e.delivery || null).slice(0, 300)}`);
  console.log(`  progress: ${JSON.stringify(t.progress)}`);
  for (const ev of (t.events || []).slice(-12)) console.log(`  · ${ev.at} [${ev.kind}] ${ev.text}`);
  if (t.error) console.log(`  ERROR: ${t.error}`);
}

const sup = await (await fetch(`${WORKER}/v1/mail/suppressions`, { headers: AH })).json();
console.log(`\n══ SUPPRESSIONS: ${sup.count} ══`);
console.log(JSON.stringify((sup.suppressions || []).slice(0, 8), null, 1).slice(0, 800));
