#!/usr/bin/env node
/**
 * Tests for the Task-8 engine wave:
 *   1. TEN branded templates (aurora / promo / letter new) — pixel + CTA +
 *      unsubscribe + personalization in every style, distinct layouts
 *   2. Style aliases (dark→aurora, offer→promo, story/personal→letter…)
 *   3. Click implies open (image-blocked clients still count their opens)
 *   4. Engagement evidence on the campaign doc: lastOpen/lastClick + who
 *   5. Worker-pool sender: no straggler stalls, ordered progress, cancel →
 *      stopped + resume never double-sends
 *   6. Overlapped list sync: /list outage is non-fatal for transactional sends
 *   7. Planner design_notes + owner style commands survive sanitisation
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 20+.
 *   node scripts/test_engine_v2.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));

/* ── D1 stand-in (real SQLite on the shipped schema) ────────────── */
function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(here, '../cloudflare/worker/schema.sql'), 'utf8'));
  return {
    __sqlite: sqlite,
    prepare(sql) {
      let args = [];
      const b = {
        bind(...a) { args = a; return b; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { const i = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(i.changes) } }; },
      };
      return b;
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return {}; },
  };
}

async function seedDoc(db, col, id, data) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(col, id) DO UPDATE SET json = excluded.json`
  ).bind(col, id, typeof data.teamId === 'string' ? data.teamId : null,
         JSON.stringify(data), now, now).run();
}

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/* ── Fetch mock ─────────────────────────────────────────────────── */
const captured = { sends: [], lists: [], batches: [] };
let sendLatencyMs = 20;
let failListEndpoint = false;
let listCounter = 0;
const sarvamScript = [];
function sarvamReplyFor(text) {
  for (const s of sarvamScript) if (s.match(text)) return s.reply;
  throw new Error('sarvam mock: no scripted reply for: ' + text.slice(0, 90).replace(/\n/g, ' '));
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages.map((m) => m.content).join('\n');
    return jsonRes(200, { choices: [{ message: { content: JSON.stringify(sarvamReplyFor(text)) }, finish_reason: 'stop' }] });
  }
  if (u.startsWith('https://email-api.mailercloud.com/')) {
    await new Promise((r) => setTimeout(r, sendLatencyMs)); // simulated provider latency
    captured.sends.push({ url: u, body: JSON.parse(body) });
    return jsonRes(200, { status: 'SUCCESS', statusCode: 1000, message: 'NA' });
  }
  if (u.startsWith('https://cloudapi.mailercloud.com/v1/')) {
    const path = u.replace('https://cloudapi.mailercloud.com/v1', '');
    if (path === '/list') {
      if (failListEndpoint) return jsonRes(500, { message: 'list endpoint down' });
      const b = JSON.parse(body);
      listCounter++;
      const id = `LST${listCounter}`;
      captured.lists.push({ id, name: b.name });
      return jsonRes(200, { id });
    }
    if (path === '/contacts/batch') { captured.batches.push(JSON.parse(body)); return jsonRes(200, { status: 'success' }); }
    if (path === '/contacts/upsert') return jsonRes(200, { status: 'success' });
    if (path === '/templates/create') return jsonRes(200, { id: 'TPL9' });
    if (path === '/campaign/save') return jsonRes(200, { id: 'MC1' });
    return jsonRes(200, {});
  }
  return realFetch(url, init);
};

function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

/* ── Modules under test (import AFTER fetch mock installed) ─────── */
const { runPipeline, handleMail } = await import('../cloudflare/worker/src/emailer/pipeline.js');
const { renderHtml, writeEmail } = await import('../cloudflare/worker/src/emailer/copywriter.js');
const { TEMPLATE_STYLES, normalizeStyle, saveBusinessProfile } = await import('../cloudflare/worker/src/emailer/business.js');
const { planTask } = await import('../cloudflare/worker/src/emailer/planner.js');
const { openToken, saveTokenMap, recordOpen, recordClick, recordUnsub, openStats, clickStats } = await import('../cloudflare/worker/src/emailer/track.js');
const { sendPersonalizedBatch } = await import('../cloudflare/worker/src/emailer/emailapi.js');
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');

/* ── Harness ────────────────────────────────────────────────────── */
const contactsInCrm = [
  { id: 'c1', name: 'Asha Rao', email: 'asha@example.com', status: 'lead', company: 'Acme' },
  { id: 'c2', name: 'Vik Singh', email: 'vik@example.com', status: 'lead', company: 'Globex' },
  { id: 'c3', name: 'Maya Iyer', email: 'maya@example.com', status: 'customer', company: 'Initech' },
];

async function makeEnv(overrides = {}) {
  const db = makeD1();
  for (const c of contactsInCrm) {
    await seedDoc(db, 'contacts', c.id, {
      name: c.name, email: c.email, status: c.status, company: c.company,
      tags: [], segments: [], createdAt: '2026-08-01T10:00:00.000Z', teamId: 'default-team',
    });
  }
  return {
    DB: db,
    SARVAM_API_KEY: 'sarvam_test',
    MAILERCLOUD_API_KEY: 'mc_test',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'sa@test.iam', private_key: 'x' }),
    MAIL_DRY_RUN: 'false',
    MAIL_TRANSACTIONAL_MAX: '1000',
    MAIL_TEAM_ID: 'default-team',
    MAIL_BUSINESS_NAME: 'Aurora Labs',
    MAIL_BRAND_COLOR: '#7C5CFF',
    MAIL_WEBSITE_URL: 'https://auroralabs.example',
    ...overrides,
  };
}

const brand = {
  name: 'Aurora Labs', tagline: 'Design intelligence', color: '#7C5CFF',
  logoUrl: '', website: 'https://auroralabs.example', ctaUrl: 'https://auroralabs.example',
  address: 'MG Road, Bengaluru', phone: '', contactEmail: 'hi@auroralabs.example',
  signature: 'Team Aurora Labs', fromName: 'Aurora Labs',
  permission: 'You subscribed to Aurora Labs updates.', defaultStyle: 'modern',
  publicBaseUrl: 'https://worker.example',
};

const copy = {
  subject: 'Introducing the Atlas engine',
  preheader: 'The fastest way to ship design work',
  headline: 'Meet Atlas — your design co-pilot',
  intro: 'Atlas drafts production-ready layouts in seconds.',
  sections: [
    { title: 'Instant layouts', body: 'Describe the page and get a responsive draft.' },
    { title: 'Brand locked', body: 'Every export matches your design tokens.' },
  ],
  cta_text: 'See it in action',
  closing: 'Talk soon,',
  ps: 'Reply within 48h for early-access pricing.',
};

/* ══ 1. Ten templates render complete, distinct, tracked ═════════ */
console.log('\n1) Template system — 10 styles');
ok(TEMPLATE_STYLES.length === 10 && TEMPLATE_STYLES.includes('aurora') && TEMPLATE_STYLES.includes('promo') && TEMPLATE_STYLES.includes('letter'),
  'TEMPLATE_STYLES has 10 entries incl. aurora/promo/letter', TEMPLATE_STYLES.join(','));

const track = { campaignId: 'ai_t8_1', base: 'https://worker.example', token: 'tok123', wrap: true, unsub: true };
const htmls = {};
for (const style of TEMPLATE_STYLES) {
  htmls[style] = renderHtml(null, copy, { personalize: true, track, brand, style });
}
// hrefs go through esc() → &amp; in the HTML source; compare unescaped.
const flat = (h) => h.replace(/&amp;/g, '&');
for (const style of TEMPLATE_STYLES) {
  const h = flat(htmls[style]);
  ok(h.includes('/v1/t/o.png?c=ai_t8_1&u=tok123'), `${style}: open pixel present`);
  ok(h.includes('/v1/t/c?c=ai_t8_1&u=tok123&to='), `${style}: click-tracked CTA`);
  ok(h.includes('/v1/t/u?c=ai_t8_1&u=tok123'), `${style}: one-click unsubscribe`);
  ok(h.includes('Hi {{first_name}},'), `${style}: personalization salutation`);
  ok(h.includes('Aurora Labs'), `${style}: brand stamped`);
  ok(h.toLowerCase().includes('unsubscribe'), `${style}: footer unsubscribe line`);
}
ok(new Set(TEMPLATE_STYLES.map((s) => htmls[s].length)).size === 10, 'all 10 layouts are distinct (unique sizes)');
ok(htmls.aurora.includes('#07080f') && htmls.aurora.includes('box-shadow:0 0 24px'), 'aurora: dark neon glow layout');
ok(htmls.promo.includes('dashed') && htmls.promo.includes('✓'), 'promo: coupon chip + benefit ticks');
ok(htmls.letter.includes('Georgia') && htmls.letter.includes('fffdf9'), 'letter: serif personal-note layout');

/* untracked render (preview / test send): plain CTA, no pixel, no unsub */
const plain = renderHtml(null, copy, { personalize: false, brand, style: 'aurora' });
ok(!plain.includes('/v1/t/') && plain.includes('https://auroralabs.example'), 'untracked render: plain CTA, no tracking');

/* ══ 2. Style aliases ════════════════════════════════════════════ */
console.log('\n2) Style aliases');
ok(normalizeStyle('dark') === 'aurora', 'dark → aurora');
ok(normalizeStyle('neon') === 'aurora', 'neon → aurora');
ok(normalizeStyle('premium') === 'aurora', 'premium → aurora');
ok(normalizeStyle('offer') === 'promo', 'offer → promo');
ok(normalizeStyle('discount') === 'promo', 'discount → promo');
ok(normalizeStyle('sale') === 'promo', 'sale → promo');
ok(normalizeStyle('story') === 'letter', 'story → letter');
ok(normalizeStyle('personal') === 'letter', 'personal → letter');
ok(normalizeStyle('newsletter') === 'classic', 'newsletter → classic (legacy)');
ok(normalizeStyle('nonsense') === '', 'unknown style → "" (falls back to brand default)');

/* ══ 3. Click implies open ═══════════════════════════════════════ */
console.log('\n3) Click-implies-open');
{
  const env = await makeEnv();
  await seedDoc(env.DB, 'campaigns', 'ai_t8_click', {
    name: 'Click test', metrics: { sent: 10, delivered: 10, opens: 0, clicks: 0 },
    teamId: 'default-team', createdAt: new Date().toISOString(),
  });
  await saveTokenMap(env, 'ai_t8_click', { ctok1: 'asha@example.com', ctok2: 'vik@example.com' });

  const before = await openStats(env, 'ai_t8_click');
  ok(before.opens === 0, 'openStats starts at 0');

  // Reader with images blocked clicks the CTA → must count BOTH click and open.
  await recordClick(env, 'ai_t8_click', 'ctok1');
  const after = await openStats(env, 'ai_t8_click');
  const cAfter = await clickStats(env, 'ai_t8_click');
  ok(after.opens === 1, 'click recorded an open (unique opens 0→1)', JSON.stringify(after));
  ok(cAfter.clicks === 1, 'click recorded once');

  // The pixel fires afterwards for the same reader → NOT double-counted.
  await recordOpen(env, 'ai_t8_click', 'ctok1');
  const dedup = await openStats(env, 'ai_t8_click');
  ok(dedup.opens === 1, 'later pixel from same reader does not double-count');

  // Second reader clicks → 2 uniques.
  await recordClick(env, 'ai_t8_click', 'ctok2');
  const both = await openStats(env, 'ai_t8_click');
  ok(both.opens === 2, 'second clicker adds a second unique open');

  // Engagement evidence lives on the campaign doc for the app UI.
  const row = await env.DB.prepare("SELECT json FROM docs WHERE col='campaigns' AND id=?").bind('ai_t8_click').first();
  const m = (JSON.parse(row.json).metrics) || {};
  ok(m.lastClickEmail === 'vik@example.com' && !!m.lastClickAt, 'lastClick email+time recorded on campaign');
  ok(m.lastOpenEmail === 'vik@example.com' && !!m.lastOpenAt, 'lastOpen email+time recorded on campaign');
  ok(Array.isArray(m.openedSample) && m.openedSample.length === 2 && m.openedSample[0].email === 'vik@example.com',
    'openedSample holds newest-first engaged readers');
  ok(Array.isArray(m.clickedSample) && m.clickedSample.length === 2, 'clickedSample recorded');
  ok(m.openedVia === 'click', 'openedVia marks the click-sourced open');
}

/* ══ 4. Worker-pool sender ═══════════════════════════════════════ */
console.log('\n4) Worker-pool engine');
{
  const env = await makeEnv();
  captured.sends.length = 0;

  // 36 recipients at 60ms each, 12-way pool → ~4 rounds ≈ 240-400ms.
  // The OLD chunked engine would take ≥6 chunks; a single straggler in
  // chunk k stalled every later chunk. Assert the pool beats the worst
  // chunked time (36/12 × 60ms = 180ms floor; chunked-with-straggler ≈ 12×60).
  sendLatencyMs = 60;
  const rows = Array.from({ length: 36 }, (_, i) => ({
    name: `P${i}`, email: `p${i}@pool.example`, merge_vars: { first_name: `P${i}`, open_uid: 'u' },
  }));
  const t0 = Date.now();
  const res = await sendPersonalizedBatch(env, {
    subject: 'Pool test', html: '<p>hi</p>', recipients: rows,
  });
  const elapsed = Date.now() - t0;
  ok(res.sent === 36 && res.failed === 0, 'pool sent all 36 recipients', JSON.stringify({ sent: res.sent, failed: res.failed }));
  ok(elapsed < 500, `pool beats straggler-bound chunking (${elapsed}ms << 12×60ms)`);
  const uniq = new Set(captured.sends.map((s) => s.body.email.recipients.to[0].email));
  ok(uniq.size === 36, 'no double-sends under concurrency');

  // Progress: >1.5s run emits at least one mid-flight progress tick.
  captured.sends.length = 0;
  sendLatencyMs = 120;
  let progressTicks = 0;
  const longRows = Array.from({ length: 40 }, (_, i) => ({
    name: `L${i}`, email: `l${i}@pool.example`, merge_vars: {},
  }));
  await sendPersonalizedBatch(env, {
    subject: 'Progress test', html: '<p>hi</p>', recipients: longRows,
    onProgress: () => { progressTicks++; },
  });
  ok(progressTicks >= 1, 'live progress ticks emitted during long sends', `ticks=${progressTicks}`);

  // Cancel: shouldStop after the first window → stopped, partial sentEmails.
  captured.sends.length = 0;
  sendLatencyMs = 80;
  const stopRows = Array.from({ length: 30 }, (_, i) => ({
    name: `S${i}`, email: `s${i}@pool.example`, merge_vars: {},
  }));
  const stopRes = await sendPersonalizedBatch({ ...env, MAIL_STOP_CHECK_MS: '50' }, {
    subject: 'Cancel test', html: '<p>hi</p>', recipients: stopRows,
    shouldStop: async () => captured.sends.length >= 10,
  });
  ok(stopRes.stopped === true, 'cancel honoured mid-pool');
  ok(stopRes.sent < 30 && stopRes.sent > 0, `partial progress kept (${stopRes.sent} sent)`);
  const sentSet = new Set(stopRes.sentEmails);
  ok(sentSet.size === stopRes.sent, 'sentEmails ledger matches the sent count');

  // Resume: remaining recipients only — never a double-send.
  captured.sends.length = 0;
  const resumeRes = await sendPersonalizedBatch(env, {
    subject: 'Cancel test', html: '<p>hi</p>',
    recipients: stopRows.filter((r) => !sentSet.has(r.email)),
  });
  ok(resumeRes.sent === 30 - stopRes.sent, 'resume sends ONLY the unsent remainder', JSON.stringify({ first: stopRes.sent, resumed: resumeRes.sent }));
  ok(!resumeRes.sentEmails.some((e) => sentSet.has(e)), 'no overlap between run 1 and run 2 sends');
  sendLatencyMs = 20;
}

/* ══ 5. Overlapped list sync — outage is non-fatal ═══════════════ */
console.log('\n5) List-sync resilience + overlap');
{
  const { putTask, listTasks } = await import('../cloudflare/worker/src/emailer/tasks.js');
  const env = await makeEnv({ MAIL_FREQ_HOURS: '0' });
  const store = createStore(env);

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('Analyse this business'), reply: { business_type: 'AI SaaS', industry: 'software', target_audience: 'startups', value_props: ['fast'], tone: 'confident', topics_pool: ['launch'], segment_hints: ['lead'], language: 'en' } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'Send one announcement now', audience: { segment: null, max_recipients: 3 },
        explicit_recipients: [],
        emails: [{ seq: 1, sendAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), goal: 'announce', angle: 'launch', tone: 'confident', template_style: 'aurora', design_notes: 'dark premium, festive' }],
        reasoning: 'launch now',
      } },
    { match: (t) => t.includes('elite direct-response email copywriter'), reply: copy },
  );

  // Pending task → the pipeline plans it (design_notes flow) and sends it.
  await putTask(store, {
    id: 't_sync', instruction: 'announce the Atlas launch now', source: 'api', createdBy: 'u1',
    status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    events: [], error: null,
  });

  captured.sends.length = 0;
  captured.batches.length = 0;
  failListEndpoint = true; // MailerCloud /list is DOWN
  const r = await runPipeline(env, { trigger: 'test', force: true });
  failListEndpoint = false;
  ok(r.ok !== false, 'pipeline completed despite /list outage', JSON.stringify(r).slice(0, 300));
  ok(captured.sends.length === 3, 'all 3 transactional emails sent anyway', `sends=${captured.sends.length}`);
  const tasks = await listTasks(store);
  const t = tasks[0];
  ok(t && t.status === 'done', 'task finished done', t?.status || 'none');
  ok(t.emails[0].status === 'sent', 'email 1 delivered (sync failure non-fatal)', t.emails[0].status);
  ok(t.plan.emails[0].template_style === 'aurora' && t.plan.emails[0].design_notes === 'dark premium, festive',
    'planner kept template_style + design_notes through sanitisation');
  // The campaign doc carries the template style for the app.
  const crow = await env.DB.prepare("SELECT json FROM docs WHERE col='campaigns' AND id=?").bind(`ai_${t.id}_1`).first();
  ok(crow && JSON.parse(crow.json).templateStyle === 'aurora', 'campaign doc records templateStyle=aurora');
}

/* ══ 6. handleMail smoke — routes still answer ═══════════════════ */
console.log('\n6) Routes smoke');
{
  const env = await makeEnv();
  const req = (path, method = 'GET', body = null) => new Request(`https://w.test${path}`, {
    method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  });
  const resStatus = await handleMail(req('/v1/mail/status'), env, { url: new URL('https://w.test/v1/mail/status'), uid: 'u1', ctx: { waitUntil: () => {} } });
  ok(resStatus.status === 200, 'status route 200');
  const resBiz = await handleMail(req('/v1/mail/business'), env, { url: new URL('https://w.test/v1/mail/business'), uid: 'u1', ctx: { waitUntil: () => {} } });
  const biz = await resBiz.json();
  ok(biz.template_styles?.length === 10, 'business route advertises 10 styles to the app');
}

/* ══ Summary ═════════════════════════════════════════════════════ */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
