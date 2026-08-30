#!/usr/bin/env node
/** Create a real 3-recipient task and capture kick-failure diagnostics. */
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const API_KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `nebula.probe3.${Date.now() % 1000000}@gmail.com`, password: 'Probe!23456789', returnSecureToken: true }) });
const j = await r.json();
const AH = { Authorization: `Bearer ${j.idToken}`, 'Content-Type': 'application/json' };
const created = await (await fetch(`${WORKER}/v1/mail/tasks`, { method: 'POST', headers: AH,
  body: JSON.stringify({ instruction: 'send a marketing email to 3 emails from the contacts now' }) })).json();
console.log('created', created.task.id, 'at', new Date().toISOString().slice(11, 19));
let terminal = false;
for (let i = 0; i < 22 && !terminal; i++) {
  await new Promise((r2) => setTimeout(r2, 12000));
  const list = await (await fetch(`${WORKER}/v1/mail/tasks`, { headers: AH })).json();
  const t = (list.tasks || []).find((x) => x.id === created.task.id);
  const e1 = (t?.emails || [])[0] || {};
  console.log(`${String(i).padStart(2)} ${t?.status} e1=${e1.status} sent=${e1.delivery?.sent ?? '-'}`);
  const errs = (t?.events || []).filter((ev) => ev.kind === 'error');
  if (errs.length) {
    for (const ev of errs.slice(-3)) console.log(` · ERR [${ev.at.slice(11, 19)}] ${ev.text}`);
  }
  if (['done', 'failed', 'cancelled'].includes(t?.status)) {
    terminal = true;
    for (const ev of (t?.events || []).slice(-6)) console.log(` · [${ev.kind}] ${ev.text}`);
    console.log('delivery:', JSON.stringify(e1.delivery || null));
  }
}
