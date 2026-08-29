#!/usr/bin/env node
/**
 * Zero-dependency end-to-end test for the AI mailer v4
 * (role-gate removal + business memory + task system upgrades).
 *
 * Mocks every outbound fetch (Sarvam, MailerCloud, Google token endpoint,
 * Firestore REST) and drives the REAL pipeline modules. Node 18+.
 *
 *   node scripts/test_mailer_v4.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));

/** Real-SQLite stand-in for Cloudflare D1 (the CRM database since the
 * Firestore migration). Runs the actual schema.sql so drift breaks tests,
 * not production. */
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

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/* ── Test fixtures ──────────────────────────────────────────────── */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const serviceAccount = {
  client_email: 'sa@nebula-crm-70f58.iam.gserviceaccount.com',
  private_key: pem,
};

// In-memory KV stand-in for env.NEBULA_EMAIL_KV
function kvMock() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, String(v)),
    delete: async (k) => void m.delete(k),
    _map: m,
  };
}

const captured = { campaigns: [], activities: [], sends: [], templates: [], batches: [] };
let lastSarvamEffort = 'unset'; // remembers the reasoning_effort of the last non-starved call
let failStateFetch = false; // regression toggle: make Firestore state reads throw
let contactsInCrm = [
  { name: 'Asha Rao', email: 'asha@example.com', status: 'lead', company: 'Acme' },
  { name: 'Vik Singh', email: 'vik@example.com', status: 'customer', company: 'Globex' },
  { name: 'No Email', email: '', status: 'lead', company: 'X' },
];
let sarvamScript = []; // queue of {match(fn), reply(obj)}
let sarvamStarveNext = 0; // >0: next N Sarvam calls return the budget-starved 200 (empty content + reasoning_content)

function sarvamReplyFor(bodyText) {
  for (const s of sarvamScript) if (s.match(bodyText)) return s.reply;
  throw new Error('sarvam mock: no scripted reply for: ' + bodyText.slice(0, 80));
}

/* ── Global fetch mock ──────────────────────────────────────────── */

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';

  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    return jsonRes(200, { access_token: 'mock-oauth-token', expires_in: 3600 });
  }
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages.map((m) => m.content).join('\n');
    const effort = parsed.reasoning_effort;
    if (sarvamStarveNext > 0) {
      // Reproduce the production killer: reasoning ate the completion budget,
      // HTTP 200, content EMPTY, reasoning_content filled, finish=length.
      sarvamStarveNext--;
      const draft = globalThis.__sarvamGarbageReasoning
        ? 'pondering the request deeply but never drafting an answer'
        : 'thinking… the owner wants… draft: ' + JSON.stringify(sarvamReplyFor(text));
      return jsonRes(200, {
        choices: [{
          message: { content: '', reasoning_content: draft },
          finish_reason: 'length',
        }],
        usage: { completion_tokens: 2048, prompt_tokens: 900 },
      });
    }
    // Assert the thinking switch: payload must carry reasoning_effort (null = off).
    if (!('reasoning_effort' in parsed)) {
      return jsonRes(400, { error: { message: 'mock: reasoning_effort missing from payload' } });
    }
    lastSarvamEffort = effort;
    return jsonRes(200, { choices: [{ message: { content: JSON.stringify(sarvamReplyFor(text)) }, finish_reason: 'stop' }] });
  }
  if (u.startsWith('https://email-api.mailercloud.com/')) {
    captured.sends.push({ url: u, body: JSON.parse(body) });
    return jsonRes(200, { status: 'SUCCESS', statusCode: 1000, message: 'NA' });
  }
  if (u.startsWith('https://cloudapi.mailercloud.com/v1/')) {
    const path = u.replace('https://cloudapi.mailercloud.com/v1', '');
    if (path === '/list') return jsonRes(200, { id: 'LST1' });
    if (path === '/contacts/batch') { captured.batches.push(JSON.parse(body)); return jsonRes(200, { status: 'success' }); }
    if (path === '/contacts/upsert') return jsonRes(200, { status: 'success' });
    if (path === '/templates/create') { captured.templates.push(JSON.parse(body)); return jsonRes(200, { id: 'TPL9' }); }
    if (path === '/campaign/save') return jsonRes(200, { id: 'MC1' });
    return jsonRes(200, {});
  }
  if (u.startsWith('https://firestore.googleapis.com/')) {
    if (u.includes(':runQuery')) {
      const q = JSON.parse(body);
      const fromContacts = JSON.stringify(q).includes('"contacts"');
      if (fromContacts) {
        return jsonRes(200, contactsInCrm.map((c, i) => ({
          document: {
            name: `projects/nebula-crm-70f58/databases/(default)/documents/contacts/c${i + 1}`,
            fields: fsFields({
              name: c.name, email: c.email, status: c.status, company: c.company,
              tags: [], createdAt: '2026-08-01T10:00:00Z',
            }),
          },
        })));
      }
      if (JSON.stringify(q).includes('"campaigns"')) {
        return jsonRes(200, captured.campaigns.map((c, i) => ({
          document: {
            name: `projects/nebula-crm-70f58/databases/(default)/documents/campaigns/${c.id}`,
            fields: fsFields(c.fields),
          },
        })));
      }
      return jsonRes(200, []);
    }
    if (u.includes('/documents/campaigns/') && init.method === 'PATCH') {
      const id = u.split('/documents/campaigns/')[1].split('?')[0];
      const fields = fsToPlain(JSON.parse(body).fields);
      const existing = captured.campaigns.findIndex((c) => c.id === id);
      if (existing >= 0) captured.campaigns[existing].fields = fields;
      else captured.campaigns.push({ id, fields });
      return jsonRes(200, { name: `x/campaigns/${id}`, fields: JSON.parse(body).fields });
    }
    if (u.includes('/documents/activities') && init.method === 'POST') {
      captured.activities.push(fsToPlain(JSON.parse(body).fields));
      return jsonRes(200, { name: 'x/activities/a1' });
    }
    if (u.includes('/documents/mail_state/')) {
      if (failStateFetch) throw new Error('simulated transient failure (429/network)');
      return jsonRes(404, { error: { message: 'not found' } });
    }
    return jsonRes(200, {});
  }
  return realFetch(url, init);
};

function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function fsFields(plain) {
  const out = {};
  for (const [k, v] of Object.entries(plain)) out[k] = fsVal(v);
  return out;
}
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object') return { mapValue: { fields: fsFields(v) } };
  return { stringValue: String(v) };
}
function fsToPlain(fields) {
  const one = (v) => {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(one);
    if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = one(x); return o; }
    return null;
  };
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = one(v);
  return out;
}

/* ── Module under test (import AFTER fetch mock is installed) ───── */

const { handleMail, runPipeline, mailConfigState } = await import(
  '../cloudflare/worker/src/emailer/pipeline.js'
);
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const { learnFromResults, getMemory, memoryContext } = await import(
  '../cloudflare/worker/src/emailer/memory.js'
);

/* ── Harness ────────────────────────────────────────────────────── */

async function makeEnv() {
  const db = makeD1();
  for (const [i, c] of contactsInCrm.entries()) {
    await seedDoc(db, 'contacts', `c${i + 1}`, {
      name: c.name, email: c.email, status: c.status, company: c.company,
      tags: [], segments: [], createdAt: '2026-08-01T10:00:00.000Z',
      teamId: 'default-team',
    });
  }
  return {
    DB: db,
    FIREBASE_PROJECT_ID: 'nebula-crm-70f58',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify(serviceAccount),
    MAILERCLOUD_API_KEY: 'mc_test_key',
    SARVAM_API_KEY: 'sarvam_test',
    NEBULA_EMAIL_KV: kvMock(),
    MAIL_DRY_RUN: 'false',
    MAIL_DELIVERY_MODE: 'auto',
    MAIL_TRANSACTIONAL_MAX: '250',
    MAIL_BUSINESS_NAME: 'Nebula CRM',
    MAIL_TIMEZONE: 'Asia/Calcutta',
    MAIL_SENDER_EMAIL: 'das@aidraft.bond',
    MAIL_RUN_RETRY_MS: '20',
    MAIL_ANALYTICS_INTERVAL_HOURS: '24',
  };
}

async function call(env, method, path, body, uid = 'user_123') {
  const url = new URL(`https://worker.test${path}`);
  const req = new Request(url, {
    method,
    headers: { Authorization: 'Bearer whatever', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const waits = [];
  const res = await handleMail(req, env, { url, uid, ctx: { waitUntil: (p) => waits.push(p) } });
  return { res, json: await res.json(), waits };
}
const drain = (waits) => Promise.allSettled(waits.map((p) => Promise.resolve(p)));

/** The same fail-soft store the worker would build for this env (D1 first). */
function storeOf(env) {
  return createStore(env);
}

/* ── Tests ──────────────────────────────────────────────────────── */

console.log('\n— 1. Role gate removed: ANY signed-in user can use the mailer —');
{
  const env = await makeEnv();
  // No users/{uid} lookup happens at all any more; uid is just audit info.
  const { res, json } = await call(env, 'GET', '/v1/mail/status', null, 'someRandomSalesRepUid');
  ok(res.status === 200, 'GET /status is 200 for a plain user uid (was 403)', `got ${res.status} ${JSON.stringify(json).slice(0, 120)}`);
  ok(json.configured === true && json.ready === true, 'status reports configured+ready with all secrets present');

  const brief = await call(env, 'GET', '/v1/mail/memory');
  ok(brief.res.status === 200, 'GET /memory is 200 for a plain user uid');
  ok(brief.json.memory && brief.json.memory.facts, 'memory shape present (facts object)');
}

console.log('\n— 2. Business memory: teach (AI distill + structured facts) —');
{
  const env = await makeEnv();
  sarvamScript = [
    {
      match: (t) => t.includes('maintain the marketing memory'),
      reply: {
        business_type: 'Artisan coffee roastery selling subscriptions online',
        industry: 'Food & Beverage',
        products: ['Espresso beans', 'Cold brew', 'Subscriptions'],
        audience: 'Cafes and young professionals',
        tone: 'Warm, premium, playful',
        offers: ['Free delivery above ₹999'],
        insights: [{ text: 'Owner stresses freshness — lead with roast dates', kind: 'positioning' }],
      },
    },
  ];

  const teach = await call(env, 'POST', '/v1/mail/memory', {
    note: 'We are an artisan coffee roastery in Mumbai. We sell fresh-roasted beans, cold brew and subscriptions. Our buyers are cafes and young professionals. Tone: warm, premium, a little playful. Free delivery over ₹999.',
  });
  ok(teach.res.status === 200, 'POST /memory (note only) → 200');
  const mem = teach.json.memory;
  ok(mem.facts.business_type.includes('coffee roastery'), 'AI distilled the note into business_type', mem.facts.business_type);
  ok(mem.facts.products.length === 3, 'AI extracted products', JSON.stringify(mem.facts.products));
  ok(mem.insights.length === 1, 'AI produced 1 insight', JSON.stringify(mem.insights));
  ok(mem.facts_origin.business_type === 'owner', 'facts tagged as owner-taught');

  const teach2 = await call(env, 'POST', '/v1/mail/memory', { facts: { tone: 'Warm, premium, playful', offers: ['Monsoon 20% off'] } });
  ok(teach2.res.status === 200, 'POST /memory (structured facts) → 200');
  ok(teach2.json.memory.facts.offers.includes('Monsoon 20% off'), 'offers merged');
  ok(teach2.json.memory.facts.offers.includes('Free delivery above ₹999'), 'existing offers kept (merge not replace)');

  const bad = await call(env, 'POST', '/v1/mail/memory', {});
  ok(bad.res.status === 400, 'empty teach body → 400');

  // memoryContext feeds prompts
  const mem2 = await getMemory(storeOf(env));
  const ctx = memoryContext(mem2);
  ok(ctx.includes('coffee roastery') && ctx.includes('CREATIVE PLAYBOOK'), 'memoryContext renders facts + playbook');
}

console.log('\n— 3. Task lifecycle: plan → write → send → write-back → events —');
{
  const env = await makeEnv();
  captured.sends.length = 0; captured.campaigns.length = 0; captured.activities.length = 0; captured.batches.length = 0;
  const dueAt = new Date(Date.now() - 60_000).toISOString();       // seq 1: due now
  const futureAt = new Date(Date.now() + 3 * 86400_000).toISOString(); // seq 2: later
  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Artisan coffee roastery selling fresh-roasted beans online',
        industry: 'Food & Beverage', target_audience: 'Cafes and young professionals',
        value_props: ['fresh roasted daily'], tone: 'warm, premium', topics_pool: [], segment_hints: ['lead', 'customer'], language: 'en',
      } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'Owner wants a monsoon sale promo',
        audience: { segment: 'lead', max_recipients: 2 },
        emails: [
          { seq: 1, sendAt: dueAt, goal: 'Announce sale', angle: 'curiosity', tone: 'premium', template_style: 'offer' },
          { seq: 2, sendAt: futureAt, goal: 'Reminder', angle: 'urgency', tone: 'friendly', template_style: 'offer' },
        ],
        reasoning: 'Two touches',
      } },
    { match: (t) => t.includes('Write ONE high-engagement'), reply: {
        subject: 'Your monsoon brew is ready', preheader: 'Fresh roast, 20% off this week only',
        headline: 'Monsoon Sale', intro: 'Fresh-roasted and 20% off.', sections: [{ title: 'Why now', body: 'Stock is limited.' }],
        cta_text: 'Shop the sale', closing: 'Cheers,', ps: 'Free delivery over ₹999.',
      } },
  ];

  const created = await call(env, 'POST', '/v1/mail/tasks', { instruction: 'Promote our monsoon 20% off to leads' }, 'owner_uid_1');
  ok(created.res.status === 201, 'POST /tasks → 201');
  const taskId = created.json.task.id;
  ok(created.json.task.status === 'pending', 'task starts pending');

  await drain(created.waits); // runWhenFree executes the pipeline

  const list = await call(env, 'GET', '/v1/mail/tasks');
  const t = list.json.tasks.find((x) => x.id === taskId);
  ok(!!t, 'task persisted');
  ok(t.status === 'active', 'task active (email 2 planned for future)', t.status);
  ok(t.emails.length === 2, 'plan has 2 emails');
  ok(t.emails[0].status === 'sent', 'email 1 (due) was sent', t.emails[0].status);
  ok(t.emails[1].status === 'planned', 'email 2 (future) stays planned', t.emails[1].status);
  ok(t.emails[0].subject === 'Your monsoon brew is ready', 'subject recorded');
  ok(t.progress.total === 2 && t.progress.done === 1 && t.progress.pending === 1, 'progress computed', JSON.stringify(t.progress));
  // The owner gave no scheduling language, so the 3-day-out email 2 is
  // pulled back to ~base+48h (30 min + 2 days) — still OUTSIDE the runner's
  // 26h lookahead, i.e. it can never fire as an immediate second blast.
  const nextMs = Date.parse(t.progress.nextSendAt || '');
  const wantMs = Date.now() + (30 * 60 + 48 * 3600) * 1000;
  ok(
    Number.isFinite(nextMs) && Math.abs(nextMs - wantMs) < 15 * 60 * 1000,
    'nextSendAt pulled back to ~+48h30m (outside lookahead)',
    t.progress.nextSendAt,
  );
  ok(t.events.some((e) => e.kind === 'plan'), 'event: plan ready');
  ok(t.events.some((e) => e.kind === 'send'), 'event: email sent');

  // personalized transactional delivery used (audience of 1 lead ≤ 250)
  const send = captured.sends[0];
  ok(!!send && send.url.endsWith('/email-api'), 'delivered via Email API /email-api (transactional)');
  ok(send.body.version === '1.0' && send.body.email.from === 'das@aidraft.bond', 'send body: version 1.0 + verified sender');
  ok(send.body.email.recipients.to.length === 1 && send.body.email.recipients.to[0].merge_vars, 'mail merge per recipient');
  ok(captured.batches.length >= 1, 'audience synced to MailerCloud list');
  ok(captured.templates.length === 1, 'template saved to MailerCloud library');

  // campaign doc written back to the CRM database (D1) with extras
  const campRow = await env.DB.__sqlite.prepare(
    `SELECT id, json FROM docs WHERE col = 'campaigns' AND id LIKE 'ai_${taskId}%'`).get();
  ok(!!campRow, 'campaign doc written to D1 campaigns/');
  const campJson = campRow ? JSON.parse(campRow.json) : {};
  ok(campJson.source === 'ai-mailer' && campJson.metrics?.sent === 1, 'campaign doc: source + real sent count', JSON.stringify(campJson.metrics));
  const actRow = await env.DB.__sqlite.prepare(
    "SELECT COUNT(*) AS n FROM docs WHERE col = 'activities'").get();
  ok((actRow?.n ?? 0) >= 1, 'activity timeline entry written');

  // memory learned the campaign focus
  const memAfter = await getMemory(storeOf(env));
  ok(memAfter.notes.some((n) => n.includes('monsoon')), 'memory.notes captured campaign focus');
}

console.log('\n— 4. Cancel: planned future email never sends —');
{
  const env = await makeEnv();
  const futureAt = new Date(Date.now() + 5 * 86400_000).toISOString();
  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Artisan coffee roastery', industry: 'F&B', target_audience: 'cafes',
        value_props: ['fresh'], tone: 'warm', topics_pool: [], segment_hints: [], language: 'en',
      } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'u', audience: { segment: null, max_recipients: 2 },
        emails: [{ seq: 1, sendAt: futureAt, goal: 'g', angle: 'a', tone: 't', template_style: 'offer' }],
        reasoning: 'r',
      } },
    { match: (t) => t.includes('Write ONE high-engagement'), reply: {
        subject: 's', preheader: 'p', headline: 'h', intro: 'i', sections: [], cta_text: 'c', closing: 'cl', ps: '',
      } },
  ];
  const created = await call(env, 'POST', '/v1/mail/tasks', { instruction: 'Newsletter next week' });
  await drain(created.waits);
  const id = created.json.task.id;

  const cancel = await call(env, 'POST', `/v1/mail/tasks/${id}/cancel`, {});
  ok(cancel.res.status === 200 && cancel.json.cancelled === true, 'cancel live task → ok');
  ok(cancel.json.task.status === 'cancelled' && cancel.json.task.emails[0].status === 'cancelled', 'planned email marked cancelled');

  const before = captured.sends.length;
  const run = await call(env, 'POST', '/v1/mail/run?force=1', {});
  await drain([]);
  ok(run.res.status === 200, 'pipeline run after cancel is 200');
  ok(captured.sends.length === before, 'no email sent after cancellation');

  const cancelAgain = await call(env, 'POST', `/v1/mail/tasks/${id}/cancel`, {});
  ok(cancelAgain.json.cancelled === false, 're-cancel is a no-op');
}

console.log('\n— 5. Lock retry: task starts even while another run holds the lock —');
{
  const env = await makeEnv();
  const store = storeOf(env);
  await store.put('mail:lock', String(Date.now())); // pretend a run is in progress
  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Artisan coffee roastery', industry: 'F&B', target_audience: 'cafes',
        value_props: ['fresh'], tone: 'warm', topics_pool: [], segment_hints: [], language: 'en',
      } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'u', audience: { segment: null, max_recipients: 2 },
        emails: [{ seq: 1, sendAt: new Date(Date.now() - 1000).toISOString(), goal: 'g', angle: 'a', tone: 't', template_style: 'offer' }],
        reasoning: 'r',
      } },
    { match: (t) => t.includes('Write ONE high-engagement'), reply: {
        subject: 'Lock test', preheader: 'p', headline: 'h', intro: 'i', sections: [], cta_text: 'c', closing: 'cl', ps: '',
      } },
  ];
  const created = await call(env, 'POST', '/v1/mail/tasks', { instruction: 'Quick announcement' });
  ok(created.res.status === 201, 'POST /tasks returns 201 immediately even when locked');

  // While locked, the first retry skips…
  await new Promise((r) => setTimeout(r, 60));
  let t = (await call(env, 'GET', '/v1/mail/tasks')).json.tasks.find((x) => x.id === created.json.task.id);
  ok(t.status === 'pending', 'task still pending while lock held', t.status);

  // …free the lock → the next retry plans + executes it.
  await store.delete('mail:lock');
  await drain(created.waits);
  t = (await call(env, 'GET', '/v1/mail/tasks')).json.tasks.find((x) => x.id === created.json.task.id);
  ok(t.status === 'done' && t.emails[0].status === 'sent', 'runWhenFree retried and completed the task after lock freed', `${t.status}/${t.emails[0]?.status}`);
}

console.log('\n— 6. Analytics learnings merge into memory (dedupe + weights) —');
{
  const env = await makeEnv();
  const kv = storeOf(env);
  const learnings = {
    recommendations: ['Lead with the roast date in subject lines'],
    best_subject_styles: ['short questions'],
    best_send_hour: 10,
    observations: ['Leads engage more on weekdays'],
  };
  const campaigns = [
    { subject: 'Your monsoon brew is ready', open_rate: 42 },
    { subject: 'We changed our logo', open_rate: 3 },
  ];
  await learnFromResults(kv, learnings, campaigns);
  const mem1 = await getMemory(kv);
  ok(mem1.insights.some((i) => i.kind === 'winner' && i.text.includes('monsoon brew')), 'WINNER insight recorded');
  ok(mem1.insights.some((i) => i.kind === 'flop'), 'FLOP insight recorded');
  ok(mem1.insights.some((i) => i.kind === 'timing' && i.text.includes('10:00')), 'best send hour recorded');

  // second run: same texts → weights increase, no duplicates
  await learnFromResults(kv, learnings, campaigns);
  const mem2 = await getMemory(kv);
  const dupCount = mem2.insights.filter((i) => i.text.includes('monsoon brew')).length;
  ok(dupCount === 1, 'no duplicate winner insights', String(dupCount));
  const rec = mem2.insights.find((i) => i.text.includes('roast date'));
  ok(rec.weight === 2, 'repeated learning strengthens weight (×2)', `weight=${rec.weight}`);
}

console.log('\n— 7. Status reflects memory + dry-run config still open to all —');
{
  const env = await makeEnv();
  // teach one fact so the status endpoint can surface business understanding
  sarvamScript = []; // structured facts only — no Sarvam call needed
  await call(env, 'POST', '/v1/mail/memory', { facts: { business_type: 'Handmade jewellery brand' } });

  const st = await call(env, 'GET', '/v1/mail/status');
  ok(st.json.memory && typeof st.json.memory.insights === 'number', 'status carries memory summary');
  ok(st.json.business_understood && st.json.business_understood.type === 'Handmade jewellery brand', 'status shows business understanding from memory', JSON.stringify(st.json.business_understood));

  const cfg = await call(env, 'POST', '/v1/mail/config', { dry_run: true });
  ok(cfg.res.status === 200 && cfg.json.dryRun === true, 'dry-run override works (any signed-in user)');
  const cfg2 = await call(env, 'POST', '/v1/mail/config', { dry_run: null });
  ok(cfg2.json.dryRun === false && cfg2.json.dryRunSource === 'env', 'reset to env default (false = live)');
}

console.log('\n— 8. Dry-run safety: pipeline plans but never sends —');
{
  const env = await makeEnv();
  await storeOf(env).put('mail:dry_run_override', 'true');
  captured.sends.length = 0;
  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Artisan coffee roastery', industry: 'F&B', target_audience: 'cafes',
        value_props: ['fresh'], tone: 'warm', topics_pool: [], segment_hints: [], language: 'en',
      } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'u', audience: { segment: null, max_recipients: 2 },
        emails: [{ seq: 1, sendAt: new Date(Date.now() - 1000).toISOString(), goal: 'g', angle: 'a', tone: 't', template_style: 'offer' }],
        reasoning: 'r',
      } },
    { match: (t) => t.includes('Write ONE high-engagement'), reply: {
        subject: 'Dry run subject', preheader: 'p', headline: 'h', intro: 'i', sections: [], cta_text: 'c', closing: 'cl', ps: '',
      } },
  ];
  const created = await call(env, 'POST', '/v1/mail/tasks', { instruction: 'Anything' });
  await drain(created.waits);
  const t = (await call(env, 'GET', '/v1/mail/tasks')).json.tasks.find((x) => x.id === created.json.task.id);
  ok(t.emails[0].status === 'dry_run', 'due email marked dry_run (nothing delivered)');
  ok(captured.sends.length === 0, 'zero provider sends in dry-run mode');
  await storeOf(env).delete('mail:dry_run_override');
}

console.log('\n— 9. Crash-proofing: state-layer failures must never 1101 the routes —');
{
  // Simulate the production outage: the state database starts throwing
  // (quota wall / network / transient provider error) while the rest of the
  // system (MailerCloud send path, OAuth) keeps working.
  const env = await makeEnv();
  env.DB.prepare = () => { throw new Error('simulated transient failure (429/network)'); };

  const st = await call(env, 'GET', '/v1/mail/status');
  ok(st.res.status === 200, 'GET /status stays 200 when the state store throws (was Cloudflare 1101)',
    `got ${st.res.status}`);
  ok(!!st.json.state_error, 'status surfaces state_error for diagnosis', JSON.stringify(st.json.state_error || '').slice(0, 120));

  const before = captured.sends.length;
  const tst = await call(env, 'POST', '/v1/mail/test', { to: 'owner@example.com', name: 'Nebula Owner' });
  ok(tst.res.status === 200 && tst.json.ok === true, 'POST /test still sends one real email with the store down');
  ok(captured.sends.length === before + 1, 'provider saw exactly one send');
}
{
  // Corrupt / half-written state must read as empty, not crash.
  const env = await makeEnv();
  env.NEBULA_EMAIL_KV._map.set('mail:last_run', '{not json!!');
  env.NEBULA_EMAIL_KV._map.set('biz:brief', '<<<');
  env.NEBULA_EMAIL_KV._map.set('mail:task:index', 'garbage[');
  const st = await call(env, 'GET', '/v1/mail/status');
  ok(st.res.status === 200 && st.json.last_run === null, 'status survives corrupt last_run/brief JSON');
  const tl = await call(env, 'GET', '/v1/mail/tasks');
  ok(tl.res.status === 200 && tl.json.count === 0, 'tasks list survives corrupt index JSON');
}

console.log('\n— 10. Business Brain honesty: owner teaching must fail LOUDLY —');
{
  // The original sin: the state store swallows write errors, the memory
  // route answered ok:true, the app toasted "Learned." and the owner's
  // teaching silently vanished. Owner-taught memory is NOT advisory.
  const env = await makeEnv();
  env.DB.prepare = () => { throw new Error('simulated transient failure (429/network)'); };

  const teach = await call(env, 'POST', '/v1/mail/memory', {
    facts: { business_type: 'Handmade coffee', products: ['Beans'] },
  });
  ok(teach.res.status === 503, 'POST /memory with the store down → 503, NOT a fake ok:true', `got ${teach.res.status} ${JSON.stringify(teach.json).slice(0, 120)}`);
  ok(!!teach.json.error && /save/i.test(teach.json.error), 'error explains the save failed and nothing was lost', teach.json.error);

  const mem = await call(env, 'GET', '/v1/mail/memory');
  ok(mem.res.status === 503, 'GET /memory with the store down → 503, not a fake "AI knows nothing"', `got ${mem.res.status}`);
  ok(!!mem.json.state_error, 'GET /memory surfaces state_error', JSON.stringify(mem.json.state_error || '').slice(0, 100));
}
{
  // Happy path still persists (guards the put() boolean contract).
  const env = await makeEnv();
  const t1 = await call(env, 'POST', '/v1/mail/memory', { facts: { business_type: 'Probe coffee co' } });
  ok(t1.res.status === 200 && t1.json.ok === true, 'teach still ok:true when the store is healthy');
  const g1 = await call(env, 'GET', '/v1/mail/memory');
  ok(g1.json.memory.facts.business_type === 'Probe coffee co', 'taught fact persists across requests');
}

console.log('\n— 11. Sarvam starvation: the bug that failed every campaign —');
{
  // sarvam-105b shares one completion budget between thinking and the
  // answer. When thinking eats it: HTTP 200, content "", reasoning_content
  // filled, finish_reason "length". sarvam.js must (1) disable thinking by
  // default, (2) recover a JSON draft from the reasoning trace, (3) retry.
  const { sarvamChat } = await import('../cloudflare/worker/src/emailer/sarvam.js');
  const env = { SARVAM_API_KEY: 'sarvam_test' };
  sarvamScript = [{ match: () => true, reply: { subject: 'Recovered subject', ok: 1 } }];

  // (a) thinking OFF by default — the payload carries reasoning_effort: null
  sarvamStarveNext = 0;
  await sarvamChat(env, [{ role: 'user', content: 'hello planner' }], { json: true });
  ok(lastSarvamEffort === null, 'default payload disables thinking (reasoning_effort: null)', String(lastSarvamEffort));

  // (b) empty content + JSON draft inside reasoning → recovered, no throw
  sarvamStarveNext = 1;
  const rec = await sarvamChat(env, [{ role: 'user', content: 'hello planner' }], { json: true });
  ok(rec.subject === 'Recovered subject', 'JSON draft recovered from reasoning_content');

  // (c) empty content + garbage reasoning → retried → second attempt answers
  sarvamStarveNext = 1;
  const origScript = sarvamScript;
  sarvamScript = [{ match: () => true, reply: { subject: 'Second attempt', ok: 2 } }];
  // starve with UNPARSEABLE reasoning: temporarily patch the mock toggle
  globalThis.__sarvamGarbageReasoning = true;
  const rec2 = await sarvamChat(env, [{ role: 'user', content: 'hello planner' }], { json: true });
  ok(rec2.subject === 'Second attempt', 'empty answer retried and second attempt succeeded');
  globalThis.__sarvamGarbageReasoning = false;
  sarvamScript = origScript;

  // (d) all attempts starve → clean, honest error (never a silent empty plan)
  sarvamStarveNext = 9;
  globalThis.__sarvamGarbageReasoning = true;
  let threw = '';
  try { await sarvamChat(env, [{ role: 'user', content: 'hello planner' }], { json: true }); }
  catch (e) { threw = String(e.message); }
  ok(/after 3 attempts/.test(threw), 'persistent starvation throws after 3 attempts', threw.slice(0, 80));
  sarvamStarveNext = 0;
  globalThis.__sarvamGarbageReasoning = false;
}

console.log('\n— 12. Task retry: failed campaigns are recoverable —');
{
  const { putTask } = await import('../cloudflare/worker/src/emailer/tasks.js');

  // (a) planning failed ("Empty AI response") → retry re-plans and delivers
  const env = await makeEnv();
  // Script the BRIEF only — the planner call has no reply, so planTask
  // throws exactly like the production "Empty AI response" did.
  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Artisan coffee roastery', industry: 'F&B', target_audience: 'cafes',
        value_props: ['fresh'], tone: 'warm', topics_pool: [], segment_hints: ['lead'], language: 'en',
      } },
  ];
  sarvamStarveNext = 0;
  const broken = await call(env, 'POST', '/v1/mail/tasks', { instruction: 'Promote monsoon sale' }, 'owner_uid_1');
  await drain(broken.waits);
  let t = (await call(env, 'GET', '/v1/mail/tasks')).json.tasks.find((x) => x.id === broken.json.task.id);
  ok(t.status === 'failed', 'unscripted planning run ends failed (production repro)', t.status);
  ok(/after 3 attempts|Empty AI|no scripted reply/i.test(t.error || ''), 'failure error is diagnostic', String(t.error).slice(0, 90));

  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Artisan coffee roastery', industry: 'F&B', target_audience: 'cafes',
        value_props: ['fresh'], tone: 'warm', topics_pool: [], segment_hints: ['lead'], language: 'en',
      } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'u', audience: { segment: 'lead', max_recipients: 2 },
        emails: [{ seq: 1, sendAt: new Date(Date.now() - 1000).toISOString(), goal: 'g', angle: 'a', tone: 't', template_style: 'offer' }],
        reasoning: 'r',
      } },
    { match: (t) => t.includes('Write ONE high-engagement'), reply: {
        subject: 'Retry worked', preheader: 'p', headline: 'h', intro: 'i', sections: [], cta_text: 'c', closing: 'cl', ps: '',
      } },
  ];
  const retry = await call(env, 'POST', `/v1/mail/tasks/${t.id}/retry`, {});
  ok(retry.res.status === 200 && retry.json.task.status === 'pending', 'failed task retry → 200, back to pending', JSON.stringify(retry.json).slice(0, 120));
  await drain(retry.waits);
  t = (await call(env, 'GET', '/v1/mail/tasks')).json.tasks.find((x) => x.id === t.id);
  ok(t.status === 'done' && t.emails[0].status === 'sent' && t.emails[0].subject === 'Retry worked', 'retry re-planned and delivered the campaign', `${t.status}/${t.emails[0]?.status}`);

  // (b) retrying a live/done task is a clean 409, not a state corruption
  const retryLive = await call(env, 'POST', `/v1/mail/tasks/${t.id}/retry`, {});
  ok(retryLive.res.status === 409, 'retry of a done task → 409', String(retryLive.res.status));

  // (c) partial failure: only FAILED emails requeue — sent ones never resend
  const env2 = await makeEnv();
  const partial = {
    id: 't_partial1', instruction: 'i', source: 'api', createdBy: 'u1',
    status: 'failed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    plan: { understanding: 'u' },
    emails: [
      { seq: 1, status: 'sent', sendAt: new Date(Date.now() - 3600_000).toISOString(), subject: 'Already sent' },
      { seq: 2, status: 'failed', sendAt: new Date(Date.now() - 1800_000).toISOString(), subject: 'Bounced', error: 'provider 500' },
    ],
    events: [], error: '1 of 2 sends failed',
  };
  await putTask(storeOf(env2), JSON.parse(JSON.stringify(partial)));
  const pr = await call(env2, 'POST', '/v1/mail/tasks/t_partial1/retry', {});
  ok(pr.res.status === 200 && pr.json.task.status === 'active', 'partial-failure retry → active', JSON.stringify(pr.json).slice(0, 100));
  const pe = pr.json.task.emails;
  ok(pe[0].status === 'sent' && pe[0].subject === 'Already sent', 'sent email untouched (no duplicate delivery)');
  ok(pe[1].status === 'planned' && new Date(pe[1].sendAt).getTime() > Date.now(), 'failed email requeued ~10 min out', pe[1].sendAt);
  ok(pr.json.task.emails.filter((e) => e.status === 'failed').length === 0, 'no failed emails remain after retry');

  // (d) nothing to retry → 409
  const nothing = await call(env2, 'POST', '/v1/mail/tasks/t_missing/retry', {});
  ok(nothing.res.status === 404, 'retry of unknown task → 404', String(nothing.res.status));
}

console.log('\n— 13. Open-tracking pixel + REAL analytics totals —');
{
  const env = await makeEnv();
  // (a) Unknown campaign opens are ignored (spam-proof unauthenticated route).
  const { recordOpen, openStats, openToken } = await import('../cloudflare/worker/src/emailer/track.js');
  const spam = await recordOpen(env, 'ai_unknown_campaign', 'tok');
  ok(!spam.ok, 'open for unknown campaign ignored', JSON.stringify(spam));

  // (b) A delivered transactional blast: 3 recipients, 2 accepted, 1 failed.
  await seedDoc(env.DB, 'campaigns', 'ai_track1_1', {
    source: 'ai-mailer', name: 'AI | track', channel: 'email', status: 'sent',
    audienceCount: 3, subject: 'Hi', deliveryMode: 'transactional',
    delivery: { mode: 'transactional', sent: 2, failed: 1, deferred: 0 },
    metrics: { sent: 2, delivered: 2, opens: 0, clicks: 0, conversions: 0, bounces: 1, unsubscribes: 0, revenue: 0, failed: 1, deferred: 0 },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  const tok1 = openToken('ai_track1_1', 'a@x.com');
  const r1 = await recordOpen(env, 'ai_track1_1', tok1);
  const r2 = await recordOpen(env, 'ai_track1_1', tok1); // same reader reloads
  const r3 = await recordOpen(env, 'ai_track1_1', 'tokb');
  ok(r1.ok && r1.unique, 'first open recorded as unique');
  ok(r2.ok && !r2.unique, 'repeat open counted once', JSON.stringify(r2));
  ok(r3.ok && r3.unique, 'second opener unique');
  const st = await openStats(env, 'ai_track1_1');
  ok(st.opens === 2, 'openStats counts 2 unique openers', JSON.stringify(st));

  // (c) collectAnalytics: transactional campaigns MUST appear with real
  // delivered / not_delivered numbers + pixel opens (max vs provider 0s).
  const mcStub = {
    campaignOpens: async () => ({ data: [] }),
    campaignClicks: async () => ({ data: [] }),
    campaignUnsubs: async () => ({ data: [] }),
    inboxTracking: async () => ({ data: [] }),
  };
  const kv = kvMock();
  const { collectAnalytics, getLatestAnalytics } = await import('../cloudflare/worker/src/emailer/analytics.js');
  await collectAnalytics(mcStub, env, kv);
  const snap = await getLatestAnalytics(kv);
  ok(!!snap, 'analytics snapshot persisted to KV');
  const row = snap.campaigns.find((c) => c.crmCampaignId === 'ai_track1_1');
  ok(!!row, 'transactional campaign included in snapshot (was skipped before)');
  ok(row.recipients === 3, 'recipients = audience count', String(row.recipients));
  ok(row.delivered === 2, 'delivered = provider-accepted truth', String(row.delivered));
  ok(row.not_delivered === 1, 'not_delivered = sent − delivered', String(row.not_delivered));
  ok(row.opens === 2, 'opens = pixel-tracked uniques', String(row.opens));
  ok(snap.totals && snap.totals.delivered === 2 && snap.totals.not_delivered === 1 && snap.totals.opens === 2,
    'totals sum delivered/not_delivered/opens', JSON.stringify(snap.totals));

  // (d) write-back: the CRM campaign doc gains the REAL metrics (never 0s).
  const back = await env.DB.prepare("SELECT json FROM docs WHERE col = 'campaigns' AND id = 'ai_track1_1'").first();
  const backMetrics = JSON.parse(back.json).metrics;
  ok(backMetrics.opens === 2 && backMetrics.delivered === 2 && backMetrics.failed === 1,
    'write-back keeps delivered/failed and pixel opens', JSON.stringify(backMetrics));
}

console.log(`\n════════════════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('ALL GREEN');
