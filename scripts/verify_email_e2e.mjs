#!/usr/bin/env node
/**
 * Live end-to-end proof of the email truth chain against the DEPLOYED worker:
 *
 *   task ("send right away to <probe>") → planner → REAL MailerCloud send
 *   → per-email delivered/failed counts → analytics totals → open pixel
 *   → opens counted back into analytics.
 *
 * Usage: node scripts/verify_email_e2e.mjs
 * Requires: SENDGRID-free — uses MailerCloud via the worker. Creates one
 * throwaway Firebase user (probe) and sends it ONE real email.
 */
import { readFileSync } from 'node:fs';

const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const API_KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const PROBE_EMAIL = `nebula.e2e.probe${Date.now() % 100000}.${STAMP}@gmail.com`;
const PROBE_PW = 'Probe!23456789';

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${name}${extra ? ` — ${extra}` : ''}`); console.log(`  ✗ ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`probe: ${PROBE_EMAIL}`);

// ── 1. Fresh Firebase user + id token ──────────────────────────────
let idToken = '';
{
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PW, returnSecureToken: true }) });
  const j = await r.json().catch(() => ({}));
  if (j.idToken) idToken = j.idToken;
  else {
    // already exists? sign in instead
    const r2 = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: PROBE_EMAIL, password: PROBE_PW, returnSecureToken: true }) });
    const j2 = await r2.json().catch(() => ({}));
    idToken = j2.idToken || '';
  }
  ok(!!idToken, 'probe user token minted');
}
const AH = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

// ── 2. Health + public pixel ───────────────────────────────────────
{
  const r = await fetch(`${WORKER}/v1/health`);
  ok(r.status === 200, '/v1/health 200');
  const p = await fetch(`${WORKER}/v1/t/o.png?c=e2e_probe&u=e2e`);
  const buf = new Uint8Array(await p.arrayBuffer());
  ok(p.status === 200 && (p.headers.get('content-type') || '').startsWith('image/png') && buf.length > 0,
    'open pixel public + png', `${p.status} ${p.headers.get('content-type')} ${buf.length}b`);
}

// ── 3. Bootstrap profile ───────────────────────────────────────────
{
  const r = await fetch(`${WORKER}/v1/data/bootstrap`, { method: 'POST', headers: AH, body: JSON.stringify({}) });
  ok(r.status === 200, 'bootstrap 200', String(r.status));
}

// ── 4. Mailer status ───────────────────────────────────────────────
{
  const r = await fetch(`${WORKER}/v1/mail/status`, { headers: AH });
  const j = await r.json().catch(() => ({}));
  ok(r.status === 200 && j.configured === true, 'mailer configured (MAILERCLOUD_API_KEY present)', JSON.stringify(j).slice(0, 160));
}

// ── 5. Campaign task: explicit recipient + right away ──────────────
let taskId = '';
{
  const r = await fetch(`${WORKER}/v1/mail/tasks`, { method: 'POST', headers: AH,
    body: JSON.stringify({ instruction: `Send an email right away to ${PROBE_EMAIL} introducing our product and invite them to reply for details.` }) });
  const j = await r.json().catch(() => ({}));
  taskId = j.task?.id || '';
  ok(r.status === 201 && !!taskId, 'task created 201', `${r.status} ${JSON.stringify(j).slice(0, 160)}`);
}

// ── 6. Force-run the pipeline, wait for the send ───────────────────
let sent = false, plan = null, taskJson = null;
for (let i = 0; i < 12 && !sent; i++) {
  await fetch(`${WORKER}/v1/mail/run`, { method: 'POST', headers: AH, body: JSON.stringify({ trigger: 'e2e' }) });
  await sleep(8000);
  const r = await fetch(`${WORKER}/v1/mail/tasks`, { headers: AH });
  const j = await r.json().catch(() => ({}));
  taskJson = (j.tasks || []).find((t) => t.id === taskId);
  plan = taskJson?.plan || null;
  const mails = taskJson?.emails || [];
  sent = mails.some((e) => ['sent', 'partial'].includes(e.status));
  if (taskJson?.status === 'failed') break;
}
ok(!!plan, 'planner produced a plan', JSON.stringify(taskJson || {}).slice(0, 200));
ok((plan?.explicit_recipients || []).includes(PROBE_EMAIL), 'plan names the probe as explicit recipient', JSON.stringify(plan?.explicit_recipients || []));
ok(sent, 'email REALLY sent (provider accepted)', JSON.stringify(taskJson?.emails || []).slice(0, 220));
const firstSent = (taskJson?.emails || []).find((e) => ['sent', 'partial'].includes(e.status));
ok((firstSent?.delivery?.sent ?? 0) >= 1 && (firstSent?.delivery?.failed ?? 0) === 0,
  'per-email delivery counts present (sent=1, failed=0)', JSON.stringify(firstSent?.delivery || {}));
ok((firstSent?.recipients || []).includes(PROBE_EMAIL), 'the NAMED recipient received it', JSON.stringify(firstSent?.recipients || []));
// The CRM campaign doc id the pipeline writes for this email.
firstSent.crmId = firstSent?.crmCampaignId || `ai_${taskId}_${firstSent?.seq ?? 1}`;
ok(((taskJson?.events || []).some((e) => e.kind === 'send' && /delivered/.test(e.text))),
  'send event reports delivered numbers', JSON.stringify((taskJson?.events || []).slice(-1)).slice(0, 200));

// ── 7. Analytics shows the campaign + real totals ──────────────────
let analytics = null;
{
  // refresh=1 forces a live MailerCloud + D1 pull (bypasses the 20h KV throttle)
  const r = await fetch(`${WORKER}/v1/mail/analytics?refresh=1`, { headers: AH });
  analytics = await r.json().catch(() => ({}));
  const row = (analytics.campaigns || []).find((c) => c.crmCampaignId === firstSent.crmId);
  ok(!!row, 'campaign appears in analytics', JSON.stringify(analytics.campaigns || []).slice(0, 200));
  ok((row?.delivered ?? 0) >= 1, 'analytics delivered >= 1', JSON.stringify(row || {}).slice(0, 200));
  ok((analytics.totals?.delivered ?? 0) >= 1, 'totals.delivered >= 1', JSON.stringify(analytics.totals || {}));
}

// ── 8. Open the pixel as the recipient would → opens counted ───────
if (firstSent?.crmId) {
  const { openToken } = await import('../cloudflare/worker/src/emailer/track.js');
  const tok = openToken(firstSent.crmId, PROBE_EMAIL);
  const p = await fetch(`${WORKER}/v1/t/o.png?c=${encodeURIComponent(firstSent.crmId)}&u=${tok}`);
  ok(p.status === 200 && (p.headers.get('content-type') || '').startsWith('image/png'), 'pixel renders for real campaign');
  const r = await fetch(`${WORKER}/v1/mail/analytics?refresh=1`, { headers: AH });
  const j = await r.json().catch(() => ({}));
  const row = (j.campaigns || []).find((c) => c.crmCampaignId === firstSent.crmId);
  ok((row?.opens ?? 0) >= 1, 'open tracked into analytics (opened >= 1)', JSON.stringify(row || {}).slice(0, 200));
  ok((j.totals?.opens ?? 0) >= 1, 'totals.opens >= 1', JSON.stringify(j.totals || {}));
}

console.log(`\n════════════════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
console.log('ALL GREEN — emails really send and analytics shows the truth');
