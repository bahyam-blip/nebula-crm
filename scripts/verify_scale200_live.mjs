#!/usr/bin/env node
/**
 * SCALE VERIFICATION (capped): create a 200-recipient task, watch the
 * chunked chain move the live counter (first batches), then CANCEL —
 * proving: plan (1 email × 200 × all contacts) → prepare → chunk chain
 * → live progress → cancellation honoured. No mass test-blast.
 */
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const API_KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `nebula.scale200.${Date.now() % 1000000}@gmail.com`, password: 'Probe!23456789', returnSecureToken: true }) });
const j = await r.json();
const AH = { Authorization: `Bearer ${j.idToken}`, 'Content-Type': 'application/json' };

const created = await (await fetch(`${WORKER}/v1/mail/tasks`, { method: 'POST', headers: AH,
  body: JSON.stringify({ instruction: 'send a marketing email to 200 emails from the contacts now. send it right away.' }) })).json();
const id = created.task.id;
console.log('created', id);

let cancelled = false;
for (let i = 0; i < 55 && !cancelled; i++) {
  await new Promise((r2) => setTimeout(r2, 10000));
  const list = await (await fetch(`${WORKER}/v1/mail/tasks`, { headers: AH })).json();
  const t = (list.tasks || []).find((x) => x.id === id);
  const e1 = (t?.emails || [])[0] || {};
  const sent = e1.delivery?.sent ?? 0;
  if (i % 2 === 0 || sent > 0) {
    console.log(`${String(i).padStart(2)} ${t?.status} e1=${e1.status} sent=${sent}/${e1.exec?.audienceCount ?? '?'}`);
  }
  if (sent >= 30) {
    // First chunk(es) proven — cancel to avoid a real 200-person blast.
    const c = await (await fetch(`${WORKER}/v1/mail/tasks/${id}/cancel`, { method: 'POST', headers: AH, body: '{}' })).json();
    cancelled = true;
    console.log('>>> cancelled after', sent, 'sends —', c.ok, c.task?.status);
  }
}
// final state
const list = await (await fetch(`${WORKER}/v1/mail/tasks`, { headers: AH })).json();
const t = (list.tasks || []).find((x) => x.id === id);
const e1 = (t?.emails || [])[0] || {};
console.log('\nFINAL:', t?.status, 'e1:', e1.status, 'delivery:', JSON.stringify(e1.delivery || null));
for (const ev of (t?.events || []).slice(-8)) console.log(` · [${ev.kind}] ${ev.text}`);
const plan = t?.plan || {};
console.log('\nVERDICT:');
console.log(`  1 email × 200 × all: ${plan.emails?.length === 1 && plan.audience?.max_recipients === 200 && !plan.audience?.segment ? 'PASS' : 'CHECK'} (${plan.emails?.length}e, ${plan.audience?.max_recipients}r, seg=${plan.audience?.segment})`);
console.log(`  chunk chain moved:   ${(e1.delivery?.sent ?? 0) >= 30 ? 'PASS' : 'CHECK'} (${e1.delivery?.sent} sent before cancel)`);
console.log(`  cancel honoured:     ${t?.status === 'cancelled' ? 'PASS' : 'CHECK'}`);
