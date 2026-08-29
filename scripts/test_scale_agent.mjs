#!/usr/bin/env node
/**
 * Tests for the scale + engagement + agent wave:
 *   1. Seven branded templates with click-tracked CTA + one-click unsubscribe
 *   2. Open/click/unsub recording + the full unsub suppression chain
 *   3. Audience guards: suppression list + frequency cap (via runPipeline)
 *   4. Resume: a crashed mid-send run never double-sends
 *   5. Per-campaign dedicated list in campaign mode (exact recipients at scale)
 *   6. Suppression management API routes
 *   7. Agentic assistant: snapshot → tools → reply (incl. create_email_task)
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 20+.
 *   node scripts/test_scale_agent.mjs
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
const captured = { sends: [], lists: [], batches: [], campaigns: [] };
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
    captured.sends.push({ url: u, body: JSON.parse(body) });
    return jsonRes(200, { status: 'SUCCESS', statusCode: 1000, message: 'NA' });
  }
  if (u.startsWith('https://cloudapi.mailercloud.com/v1/')) {
    const path = u.replace('https://cloudapi.mailercloud.com/v1', '');
    if (path === '/list') {
      const b = JSON.parse(body);
      listCounter++;
      const id = `LST${listCounter}`;
      captured.lists.push({ id, name: b.name });
      return jsonRes(200, { id });
    }
    if (path === '/contacts/batch') { captured.batches.push(JSON.parse(body)); return jsonRes(200, { status: 'success' }); }
    if (path === '/contacts/upsert') return jsonRes(200, { status: 'success' });
    if (path === '/templates/create') return jsonRes(200, { id: 'TPL9' });
    if (path === '/campaign/save') { captured.campaigns.push(JSON.parse(body)); return jsonRes(200, { id: `MC${captured.campaigns.length}` }); }
    return jsonRes(200, {});
  }
  return realFetch(url, init);
};

function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

/* ── Modules under test (import AFTER fetch mock installed) ─────── */
const { runPipeline, handleMail } = await import('../cloudflare/worker/src/emailer/pipeline.js');
const { renderHtml } = await import('../cloudflare/worker/src/emailer/copywriter.js');
const { TEMPLATE_STYLES } = await import('../cloudflare/worker/src/emailer/business.js');
const { openToken, saveTokenMap, recordClick, recordUnsub, clickStats } = await import('../cloudflare/worker/src/emailer/track.js');
const { applyUnsub } = await import('../cloudflare/worker/src/emailer/unsub.js');
const { handleAssistant } = await import('../cloudflare/worker/src/emailer/assistant.js');
const { createStore, stateBackendName } = await import('../cloudflare/worker/src/emailer/state.js');
const { putTask, getTask, listTasks } = await import('../cloudflare/worker/src/emailer/tasks.js');
const { saveBusinessProfile } = await import('../cloudflare/worker/src/emailer/business.js');

/* ── Harness ────────────────────────────────────────────────────── */
let contactsInCrm = [
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
    FIREBASE_PROJECT_ID: 'nebula-crm-70f58',
    MAILERCLOUD_API_KEY: 'mc_test_key',
    SARVAM_API_KEY: 'sarvam_test',
    MAIL_DRY_RUN: 'false',
    MAIL_DELIVERY_MODE: 'auto',
    MAIL_TRANSACTIONAL_MAX: '1000',
    MAIL_BUSINESS_NAME: 'Nebula CRM',
    MAIL_TIMEZONE: 'Asia/Calcutta',
    MAIL_SENDER_EMAIL: 'das@aidraft.bond',
    MAIL_RUN_RETRY_MS: '20',
    MAIL_ANALYTICS_INTERVAL_HOURS: '24',
    ...overrides,
  };
}

function storeOf(env) { return createStore(env); }

async function callMail(env, method, path, body, uid = 'user_123') {
  const url = new URL(`https://worker.test${path}`);
  const req = new Request(url, {
    method,
    headers: { Authorization: 'Bearer whatever', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleMail(req, env, { url, uid, ctx: { waitUntil: () => {} } });
  return { res, json: await res.json() };
}

const brand = {
  name: 'Aidraft Legal', tagline: 'Legal, simplified', color: '#7C5CFF',
  logoUrl: '', website: 'https://aidraft.bond', ctaUrl: 'https://aidraft.bond/start',
  address: 'MG Road, Bengaluru', phone: '', contactEmail: 'hi@aidraft.bond',
  signature: 'Team Aidraft Legal', fromName: 'Aidraft Legal',
  permission: 'You subscribed to updates from Aidraft Legal.',
  defaultStyle: 'modern', publicBaseUrl: 'https://worker.test',
};
const copy = {
  subject: 'Your contracts, faster', preheader: 'Draft in minutes, not days',
  headline: 'Contract drafting, reimagined', intro: 'Aidraft turns briefs into bulletproof drafts.',
  sections: [{ title: 'Why teams switch', body: 'Ten drafts a day, zero formatting pain.' }],
  cta_text: 'See it in action', closing: 'Talk soon,', ps: 'P.S. Two-minute setup.',
};

/* ── 1. Templates: 7 styles + tracked CTA + unsubscribe ─────────── */
console.log('\n— 1. Seven branded templates, tracked CTA + one-click unsubscribe —');
{
  ok(TEMPLATE_STYLES.length === 7 && TEMPLATE_STYLES.includes('editorial') && TEMPLATE_STYLES.includes('spotlight'),
    'TEMPLATE_STYLES = 7 with editorial + spotlight', JSON.stringify(TEMPLATE_STYLES));

  const tracked = { campaignId: 'ai_t1_1', base: 'https://worker.test', wrap: true, unsub: true };
  const htmls = {};
  for (const style of TEMPLATE_STYLES) {
    htmls[style] = renderHtml({ MAIL_PUBLIC_BASE_URL: 'https://worker.test' }, copy, {
      personalize: true, track: tracked, brand, style,
    });
  }
  ok(new Set(Object.values(htmls).map((h) => h.length)).size === TEMPLATE_STYLES.length,
    'all 7 styles render distinct HTML');
  for (const style of TEMPLATE_STYLES) {
    const h = htmls[style];
    ok(h.includes('/v1/t/u?c=ai_t1_1') && h.includes('u=%7B%7Bopen_uid%7D%7D'),
      `${style}: unsubscribe link with per-recipient token`);
    ok(h.includes('/v1/t/c?c=ai_t1_1') && h.includes('to=https%3A%2F%2Faidraft.bond%2Fstart'),
      `${style}: CTA wrapped in click tracker`);
    ok(h.includes('Hi {{first_name}},') && h.includes('Aidraft Legal'), `${style}: greeting + brand`);
  }

  const plain = renderHtml({}, copy, { brand, style: 'modern' });
  ok(!plain.includes('/v1/t/u') && !plain.includes('/v1/t/c'), 'untracked render (preview/test) has no tracking or unsub');

  const overridden = renderHtml({}, { ...copy, cta_url: 'https://aidraft.bond/pricing' }, { brand, style: 'modern' });
  ok(overridden.includes('href="https://aidraft.bond/pricing"'), 'copy.cta_url overrides the CTA destination');

  const badOverride = renderHtml({}, { ...copy, cta_url: 'javascript:alert(1)' }, { brand, style: 'modern' });
  ok(!badOverride.includes('javascript:'), 'non-http cta_url dropped (safety)');
}

/* ── 2. Recording: clicks + unsubs + the suppression chain ──────── */
console.log('\n— 2. Click + unsub recording → suppression + contact opt-out —');
{
  const env = await makeEnv();
  const db = env.DB;
  await seedDoc(db, 'campaigns', 'ai_t9_1', { name: 'x', metrics: { opens: 0, clicks: 0 } });
  const token = openToken('ai_t9_1', 'asha@example.com');
  await saveTokenMap(env, 'ai_t9_1', { [token]: 'asha@example.com' });

  // clicks: unique per (campaign, recipient)
  await recordClick(env, 'ai_t9_1', token);
  await recordClick(env, 'ai_t9_1', token);
  const t2 = openToken('ai_t9_1', 'vik@example.com');
  await recordClick(env, 'ai_t9_1', t2);
  const stats = await clickStats(env, 'ai_t9_1');
  ok(stats.clicks === 2, 'clicks counted once per unique recipient', JSON.stringify(stats));
  let doc = JSON.parse((await db.prepare("SELECT json FROM docs WHERE col='campaigns' AND id='ai_t9_1'").first()).json);
  ok(doc.metrics.clicks === 2, 'campaign metrics.clicks = 2');

  // unsub chain: record → suppress → contact opt-out
  const page = await applyUnsub(env, { campaignId: 'ai_t9_1', token });
  ok(page.email === 'asha@example.com' && page.fresh, 'unsub resolves the recipient from the token map', JSON.stringify(page));
  doc = JSON.parse((await db.prepare("SELECT json FROM docs WHERE col='campaigns' AND id='ai_t9_1'").first()).json);
  ok(doc.metrics.unsubscribes === 1, 'campaign metrics.unsubscribes = 1');

  const again = await applyUnsub(env, { campaignId: 'ai_t9_1', token });
  ok(again.already === true, 'second click is idempotent (already)');

  const store = storeOf(env);
  const sup = JSON.parse(await store.get('mail:suppressions'));
  ok(sup.some((s) => s.email === 'asha@example.com' && s.code === 'unsub'), 'address added to the suppression list');
  const contact = JSON.parse((await db.prepare("SELECT json FROM docs WHERE col='contacts' AND id='c1'").first()).json);
  ok(contact.emailOptOut === true && contact.tags.includes('unsubscribed'), 'CRM contact opted out + tagged');

  // junk tokens are ignored
  const junk = await applyUnsub(env, { campaignId: 'ai_t9_1', token: '../../etc' });
  ok(junk.already === true && junk.fresh === false, 'malformed token ignored safely');
}

/* ── 3. Audience guards: suppression + frequency cap ────────────── */
console.log('\n— 3. Audience guards: suppressed + recently-emailed are held back —');
{
  const env = await makeEnv();
  const store = storeOf(env);
  // Asha unsubscribed; Vik was emailed 2h ago; Maya is fair game.
  await store.put('mail:suppressions', JSON.stringify([{ email: 'asha@example.com', code: 'unsub', at: new Date().toISOString() }]));
  await store.put('mail:sentlog', JSON.stringify([{ email: 'vik@example.com', at: new Date(Date.now() - 2 * 3600e3).toISOString() }]));

  const due = new Date(Date.now() - 60_000).toISOString();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('build a marketing brief'), reply: { business_type: 'x', industry: 'y', target_audience: 'z', tone: 'warm', topics_pool: [], segment_hints: [], language: 'en' } },
    { match: (t) => t.includes('Write ONE high-engagement marketing email'), reply: { ...copy } },
  );
  await saveBusinessProfile(store, { business_name: 'Aidraft Legal', website: 'https://aidraft.bond', cta_url: 'https://aidraft.bond/start' });

  const task = {
    id: 't_guard', instruction: 'email everyone', source: 'api', createdBy: 'u1',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    plan: { audience: { segment: null, max_recipients: 100 }, explicit_recipients: [], emails: [{ seq: 1, sendAt: due, goal: 'g', angle: 'a', tone: 't', template_style: 'modern' }] },
    emails: [{ seq: 1, sendAt: due, status: 'planned', subject: null, campaignId: null, crmCampaignId: null, templateId: null }],
    events: [], error: null,
  };
  await putTask(store, task);

  const run = await runPipeline(env, { trigger: 'test', onlyTaskId: 't_guard', force: true });
  const sentTo = captured.sends.map((s) => s.body.email.recipients.to[0].email.toLowerCase());
  ok(sentTo.length === 1 && sentTo[0] === 'maya@example.com',
    `exactly 1 send — only the eligible contact (${JSON.stringify(sentTo)})`);
  ok(run.log.some((l) => l.includes('held back')), 'run log reports the held-back count');

  const after = await getTask(store, 't_guard');
  ok(after.emails[0].status === 'sent', 'email marked sent');
  ok(Array.isArray(after.emails[0].sentEmails) && after.emails[0].sentEmails[0] === 'maya@example.com',
    'sentEmails persisted for resume');
  ok(after.emails[0].delivery && after.emails[0].delivery.sent === 1, 'delivery summary on the task');

  const log = JSON.parse(await store.get('mail:sentlog'));
  ok(log.some((r) => r.email === 'maya@example.com'), 'send log appended (frequency cap feeds itself)');
}

/* ── 4. Resume: crashed mid-send never double-sends ─────────────── */
console.log('\n— 4. Resume: a crashed "sending" run only sends the remainder —');
{
  const env = await makeEnv();
  const store = storeOf(env);
  const due = new Date(Date.now() - 60_000).toISOString();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('build a marketing brief'), reply: { business_type: 'x', industry: 'y', target_audience: 'z', tone: 'warm', topics_pool: [], segment_hints: [], language: 'en' } },
    { match: (t) => t.includes('Write ONE high-engagement marketing email'), reply: { ...copy } },
  );

  const task = {
    id: 't_resume', instruction: 'email the leads', source: 'api', createdBy: 'u1',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    plan: { audience: { segment: null, max_recipients: 100 }, explicit_recipients: [], emails: [{ seq: 1, sendAt: due, goal: 'g', angle: 'a', tone: 't', template_style: 'modern' }] },
    emails: [{
      seq: 1, sendAt: due, status: 'sending', subject: null, campaignId: null, crmCampaignId: null, templateId: null,
      // The crashed run had already accepted Asha.
      sentEmails: ['asha@example.com'],
    }],
    events: [], error: null,
  };
  await putTask(store, task);
  captured.sends.length = 0;
  await runPipeline(env, { trigger: 'test', onlyTaskId: 't_resume', force: true });
  const sentTo = captured.sends.map((s) => s.body.email.recipients.to[0].email.toLowerCase());
  ok(!sentTo.includes('asha@example.com'), 'already-sent recipient skipped after crash', JSON.stringify(sentTo));
  ok(sentTo.length === 2, 'remaining two recipients delivered', JSON.stringify(sentTo));
  const after = await getTask(store, 't_resume');
  ok(after.emails[0].status === 'sent' && after.emails[0].delivery.sent === 3,
    'resume merges previous + new into the delivery truth', JSON.stringify(after.emails[0].delivery));
  ok(after.emails[0].delivery.accepted_rate === 100, 'accepted rate stays honest across resumes');
}

/* ── 5. Campaign mode: dedicated per-campaign list ──────────────── */
console.log('\n— 5. Campaign mode: dedicated list = EXACTLY the asked recipients —');
{
  const env = await makeEnv({ MAIL_DELIVERY_MODE: 'campaign' });
  const store = storeOf(env);
  const due = new Date(Date.now() + 3600_000).toISOString();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('build a marketing brief'), reply: { business_type: 'x', industry: 'y', target_audience: 'z', tone: 'warm', topics_pool: [], segment_hints: [], language: 'en' } },
    { match: (t) => t.includes('Write ONE high-engagement marketing email'), reply: { ...copy } },
  );
  const task = {
    id: 't_big', instruction: 'blast everyone', source: 'api', createdBy: 'u1',
    status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    plan: { audience: { segment: null, max_recipients: 3 }, explicit_recipients: [], emails: [{ seq: 1, sendAt: due, goal: 'g', angle: 'a', tone: 't', template_style: 'bold' }] },
    emails: [{ seq: 1, sendAt: due, status: 'planned', subject: null, campaignId: null, crmCampaignId: null, templateId: null }],
    events: [], error: null,
  };
  await putTask(store, task);
  captured.lists.length = 0; captured.campaigns.length = 0; captured.batches.length = 0;
  await runPipeline(env, { trigger: 'test', onlyTaskId: 't_big', force: true });

  const dedicated = captured.lists.find((l) => l.name.includes('ai_t_big_1'));
  ok(!!dedicated, 'dedicated list created for the campaign', JSON.stringify(captured.lists.map((l) => l.name)));
  const batchForList = captured.batches.find((b) => b.contacts?.[0]?.list_id === dedicated?.id);
  ok(!!batchForList && batchForList.contacts.length === 3, 'exactly the 3 planned recipients synced into it');
  ok(captured.campaigns.length === 1 && captured.campaigns[0].list_ids?.[0] === dedicated?.id,
    'campaign scheduled on the dedicated list (not the master)');
}

/* ── 6. Suppression management API ──────────────────────────────── */
console.log('\n— 6. Suppression API: list / add / remove —');
{
  const env = await makeEnv();
  const add = await callMail(env, 'POST', '/v1/mail/suppressions', { email: 'spam@example.com', reason: 'manual' });
  ok(add.res.status === 200 && add.json.suppressed === 'spam@example.com', 'POST /suppressions adds');
  const bad = await callMail(env, 'POST', '/v1/mail/suppressions', { email: 'not-an-email' });
  ok(bad.res.status === 400, 'invalid email → 400');
  const list = await callMail(env, 'GET', '/v1/mail/suppressions', null);
  ok(list.json.count === 1 && list.json.suppressions[0].email === 'spam@example.com', 'GET /suppressions lists');
  const rm = await callMail(env, 'POST', '/v1/mail/suppressions/remove', { email: 'spam@example.com' });
  ok(rm.res.status === 200 && rm.json.removed === 'spam@example.com', 'POST /suppressions/remove clears');
  const list2 = await callMail(env, 'GET', '/v1/mail/suppressions', null);
  ok(list2.json.count === 0, 'list empty after removal');
}

/* ── 7. Agentic assistant ───────────────────────────────────────── */
console.log('\n— 7. Agentic assistant: snapshot → tools → reply (+ create_email_task) —');
{
  const env = await makeEnv();
  const store = storeOf(env);
  sarvamScript.length = 0;
  let step = 0;
  sarvamScript.push({
    match: () => true,
    reply: null, // computed below — dynamic per step
  });
  // Replace with a function-like scripted sequence.
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('CURRENT CRM SNAPSHOT') && step === 0, reply: { action: { tool: 'search_contacts', args: { query: 'maya', limit: 5 } } } },
    { match: (t) => t.includes('TOOL_RESULT') && step === 1, reply: { action: { tool: 'create_email_task', args: { instruction: 'Send Maya an introduction email about Aidraft Legal' } } } },
    { match: (t) => t.includes('TOOL_RESULT') && step === 2, reply: { reply: 'Maya is at maya@example.com — and I queued an intro email task for her. You can watch it in the AI Email screen.' } },
  );
  const advance = () => { step++; };

  async function ask(messages) {
    const req = new Request('https://worker.test/v1/assistant', {
      method: 'POST',
      headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    const res = await handleAssistant(req, env, { uid: 'user_123', ctx: { waitUntil: () => {} } });
    advance();
    return { res, json: await res.json() };
  }

  // Manually drive the loop the way the real client does (one round-trip per
  // step is not how the Worker works internally — the Worker loops itself —
  // so instead we script step-wise: run 1 does all steps internally).
  step = 0;
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => !t.includes('TOOL_RESULT ('), reply: { action: { tool: 'search_contacts', args: { query: 'maya', limit: 5 } } } },
    { match: (t) => t.includes('TOOL_RESULT (search_contacts)') && !t.includes('TOOL_RESULT (create_email_task)'), reply: { action: { tool: 'create_email_task', args: { instruction: 'Send Maya a short introduction email about Aidraft Legal.' } } } },
    { match: (t) => t.includes('TOOL_RESULT (create_email_task)'), reply: { reply: 'Found Maya (maya@example.com, Initech) and queued an on-brand intro email — see the AI Email screen.' } },
  );

  const { res, json } = await ask([{ role: 'user', content: "What is Maya's email and can you intro her to Aidraft?" }]);
  ok(res.status === 200, 'POST /v1/assistant → 200', JSON.stringify(json).slice(0, 160));
  ok(json.reply && json.reply.includes('Maya'), 'final reply mentions the person', json.reply);
  ok(Array.isArray(json.actions) && json.actions.length === 2, 'two tool actions executed', JSON.stringify(json.actions));
  ok(json.actions[0].tool === 'search_contacts' && json.actions[0].ok, 'search_contacts ran');
  ok(json.actions[1].tool === 'create_email_task' && json.actions[1].ok, 'create_email_task ran');

  const tasks = await listTasks(store);
  const created = tasks.find((t) => t.source === 'assistant');
  ok(!!created && created.instruction.includes('Maya'), 'email task actually queued by the assistant');
  ok(created.status === 'pending', 'queued task waits for the pipeline (same gates as the app)');

  // crm_overview from seeded D1
  const req2 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'How many contacts do we have?' }] }),
  });
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => !t.includes('TOOL_RESULT ('), reply: { action: { tool: 'crm_overview', args: {} } } },
    { match: (t) => t.includes('TOOL_RESULT (crm_overview)'), reply: { reply: 'We have 3 contacts in the CRM right now.' } },
  );
  const r2 = await handleAssistant(req2, env, { uid: 'user_123', ctx: { waitUntil: () => {} } });
  const j2 = await r2.json();
  ok(r2.status === 200 && j2.reply.includes('3 contacts'), 'crm_overview returns live D1 counts', j2.reply);

  // unknown tool handled
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => !t.includes('TOOL_RESULT ('), reply: { action: { tool: 'delete_everything', args: {} } } },
    { match: (t) => t.includes('TOOL_RESULT (delete_everything)'), reply: { reply: 'That tool does not exist.' } },
  );
  const req3 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'delete everything' }] }),
  });
  const r3 = await handleAssistant(req3, env, { uid: 'user_123', ctx: { waitUntil: () => {} } });
  const j3 = await r3.json();
  ok(r3.status === 200 && j3.actions[0].ok === false, 'unknown tool rejected safely');

  // bad body
  const req4 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const r4 = await handleAssistant(req4, env, { uid: 'user_123', ctx: { waitUntil: () => {} } });
  ok(r4.status === 400, 'empty messages → 400');
}

console.log('\n════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('ALL GREEN');
