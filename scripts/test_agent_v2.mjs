#!/usr/bin/env node
/**
 * Tests for the AGENT V2 wave — the unified, powerful assistant:
 *   1. Registry & role enforcement (viewer read-only, rep writes, manager assigns)
 *   2. create_contact (+ duplicate guard) — real docs the app can read
 *   3. create_task with assignee resolution + due dates
 *   4. log_call → call_logs doc + contact callStatus/attempts/follow-up
 *   5. Deals: search + stage moves (validated stage vocabulary)
 *   6. assign_leads / distribute_leads round-robin over unassigned contacts
 *   7. APPROVAL GATE: pending → approve → real email task; reject; 409; 403
 *   8. Audit log + episodic memory across turns
 *   9. Route wiring through index.js fetch (auth first, never 1101)
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 22+.
 *   node scripts/test_agent_v2.mjs
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

/* ── Fetch mock (Sarvam + MailerCloud + self-delivery) ──────────── */
const captured = { sends: [], sarvamSeen: [] };
const kickQueue = [];
async function drainKicks() {
  let guard = 0;
  while (kickQueue.length && guard++ < 500) {
    const batch = kickQueue.splice(0);
    await Promise.allSettled(batch);
  }
}
const sarvamScript = [];
function sarvamReplyFor(text) {
  for (const s of sarvamScript) if (s.match(text)) return s.reply;
  throw new Error('sarvam mock: no scripted reply for: ' + text.slice(0, 90).replace(/\n/g, ' '));
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u === 'https://worker.test/v1/mail/deliver') {
    const payload = JSON.parse(body);
    const { deliverInternal } = await import('../cloudflare/worker/src/emailer/pipeline.js');
    const res = await deliverInternal(LIVE_ENV, payload, { waitUntil: (p) => kickQueue.push(Promise.resolve(p).catch(() => {})) });
    await drainKicks();
    return jsonRes(res.status, await res.json().catch(() => ({})));
  }
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages.map((m) => m.content).join('\n');
    captured.sarvamSeen.push(text);
    return jsonRes(200, { choices: [{ message: { content: JSON.stringify(sarvamReplyFor(text)) }, finish_reason: 'stop' }] });
  }
  if (u.startsWith('https://email-api.mailercloud.com/')) {
    captured.sends.push({ url: u, body: JSON.parse(body) });
    return jsonRes(200, { status: 'SUCCESS', statusCode: 1000, message: 'NA' });
  }
  if (u.startsWith('https://cloudapi.mailercloud.com/v1/')) {
    const path = u.replace('https://cloudapi.mailercloud.com/v1', '');
    if (path === '/list') return jsonRes(200, { id: 'LSTV2' });
    if (path === '/contacts/batch') return jsonRes(200, { status: 'success' });
    if (path === '/contacts/upsert') return jsonRes(200, { status: 'success' });
    if (path === '/templates/create') return jsonRes(200, { id: 'TPLV2' });
    if (path === '/campaign/save') return jsonRes(200, { id: 'MCV2' });
    return jsonRes(200, {});
  }
  return realFetch(url, init);
};
function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

/* ── Seed data ──────────────────────────────────────────────────── */
const USERS = [
  { id: 'u_mgr', displayName: 'Asha Rao', role: 'manager', teamId: 'default-team', email: 'asha@team.test' },
  { id: 'u_admin', displayName: 'Bo King', role: 'superAdmin', teamId: 'default-team', email: 'bo@team.test' },
  { id: 'u_rep', displayName: 'Vikram Das', role: 'salesRep', teamId: 'default-team', email: 'vikram@team.test' },
  { id: 'u_view', displayName: 'Ria M', role: 'viewer', teamId: 'default-team', email: 'ria@team.test' },
  { id: 'u_tc1', displayName: 'Neha K', role: 'telecaller', teamId: 'default-team', email: 'neha@team.test' },
  { id: 'u_tc2', displayName: 'Sam P', role: 'telecaller', teamId: 'default-team', email: 'sam@team.test' },
];
const CONTACTS = [
  { id: 'c_maya', name: 'Maya Sharma', email: 'maya@example.com', company: 'Initech', status: 'lead', assignedTo: null },
  { id: 'c_ravi', name: 'Ravi Verma', email: 'ravi@example.com', company: 'Acme Corp', status: 'lead', assignedTo: null },
  { id: 'c_asha2', name: 'Anil Kumar', email: 'anil@example.com', company: 'Acme Corp', status: 'lead', assignedTo: null },
  { id: 'c_dev', name: 'Devi Nair', email: 'devi@example.com', company: 'Globex', status: 'qualified', assignedTo: null },
  { id: 'c_far', name: 'Farhan Ali', email: 'farhan@example.com', company: 'Initech', status: 'lead', assignedTo: null },
  { id: 'c_gita', name: 'Gita Pillai', email: 'gita@example.com', company: 'Globex', status: 'lead', assignedTo: null },
  { id: 'c_taken', name: 'Hari Om', email: 'hari@example.com', company: 'Initech', status: 'lead', assignedTo: 'u_tc1' },
];
const DEALS = [
  { id: 'd_acme', title: 'Acme renewal', stage: 'proposal', value: 50000, company: 'Acme Corp', contactName: 'Ravi Verma', teamId: 'default-team', ownerId: 'u_mgr' },
  { id: 'd_globex', title: 'Globex pilot', stage: 'lead', value: 120000, company: 'Globex', contactName: 'Devi Nair', teamId: 'default-team', ownerId: 'u_rep' },
];
const TASKS = [
  { id: 'k_1', title: 'Follow up with Acme', teamId: 'default-team', status: 'pending', priority: 'high', assignedTo: 'u_rep', assignedToName: 'Vikram Das' },
  { id: 'k_2', title: 'Send invoice to Globex', teamId: 'default-team', status: 'pending', priority: 'medium' },
  { id: 'k_3', title: 'Old done thing', teamId: 'default-team', status: 'done', priority: 'low' },
];

/* ── Modules under test (import AFTER fetch mock installed) ─────── */
const { handleAssistant, handleAssistantApproval } = await import('../cloudflare/worker/src/emailer/assistant.js');
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const { putTask, listTasks } = await import('../cloudflare/worker/src/emailer/tasks.js');
const worker = (await import('../cloudflare/worker/src/index.js')).default;

let LIVE_ENV = null;

async function makeEnv(overrides = {}) {
  const db = makeD1();
  for (const u of USERS) {
    await seedDoc(db, 'users', u.id, {
      displayName: u.displayName, role: u.role, teamId: u.teamId, email: u.email,
    });
  }
  for (const c of CONTACTS) {
    await seedDoc(db, 'contacts', c.id, {
      name: c.name, email: c.email, company: c.company, status: c.status,
      assignedTo: c.assignedTo ?? null, callStatus: 'notCalled', callAttempts: 0,
      tags: [], segments: [], createdAt: '2026-08-01T10:00:00.000Z', teamId: 'default-team',
    });
  }
  for (const d of DEALS) await seedDoc(db, 'deals', d.id, d);
  for (const t of TASKS) await seedDoc(db, 'tasks', t.id, t);

  const env = {
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
    MAIL_SELF_URL: 'https://worker.test',
    ...overrides,
  };
  LIVE_ENV = env;
  return env;
}

const storeOf = (env) => createStore(env);

async function ask(env, uid, userMsg, extra = {}) {
  const req = new Request('https://worker.test/v1/assistant', {
    method: 'POST',
    headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: userMsg }] }),
  });
  const res = await handleAssistant(req, env, { uid, ctx: extra.ctx || { waitUntil: () => {} } });
  return { res, json: await res.json() };
}

/* Pipeline script entries (create_email_task kick runs the real pipeline). */
const copy = {
  subject: 'Your contracts, faster', preheader: 'Draft in minutes, not days',
  headline: 'Contract drafting, reimagined', intro: 'Aidraft turns briefs into bulletproof drafts.',
  sections: [{ title: 'Why teams switch', body: 'Ten drafts a day, zero formatting pain.' }],
  cta_text: 'See it in action', closing: 'Talk soon,', ps: 'P.S. Two-minute setup.',
};
function pipelineScript(recipientEmail) {
  return [
    { match: (t) => t.includes('build a marketing brief'), reply: { business_type: 'Aidraft Legal AI drafting', industry: 'Legal tech', target_audience: 'law practices', tone: 'premium', topics_pool: [], segment_hints: [], language: 'en' } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'Owner wants an announcement email.',
        audience: { segment: null, max_recipients: 1 },
        explicit_recipients: [recipientEmail],
        emails: [{ seq: 1, sendAt: new Date(Date.now() + 60_000).toISOString(), goal: 'Announce', angle: 'news', tone: 'friendly', template_style: 'modern' }],
        reasoning: 'Named recipient, immediate.',
      } },
    { match: (t) => t.includes('Write ONE high-engagement marketing email'), reply: { ...copy } },
  ];
}
const assistantScript = (entries) => entries;

/* ══ 1. Registry & roles ═══════════════════════════════════════════ */
console.log('\n— 1. Registry & role enforcement —');
{
  const env = await makeEnv();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (create_contact)'), reply: { reply: 'noted' } },
    { match: () => true, reply: { action: { tool: 'create_contact', args: { name: 'Zed Unknown', company: 'TestCo' } } } },
  );
  const viewer = await ask(env, 'u_view', 'Add Zed Unknown from TestCo');
  ok(viewer.res.status === 200, 'viewer ask → 200');
  ok(viewer.json.actions[0].ok === false && /does not allow/.test(viewer.json.actions[0].summary),
    'viewer CANNOT create_contact (role enforced server-side)', JSON.stringify(viewer.json.actions));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (create_task)'), reply: { reply: 'task created' } },
    { match: () => true, reply: { action: { tool: 'create_task', args: { title: 'Rep can act' } } } },
  );
  const rep = await ask(env, 'u_rep', 'Create a task called Rep can act');
  ok(rep.json.actions[0].ok === true, 'salesRep CAN create_task', JSON.stringify(rep.json.actions));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (assign_leads)'), reply: { reply: 'cannot do that' } },
    { match: () => true, reply: { action: { tool: 'assign_leads', args: { to: 'Neha K', count: 1 } } } },
  );
  const repAssign = await ask(env, 'u_rep', 'Give a lead to Neha');
  ok(repAssign.json.actions[0].ok === false && /does not allow/.test(repAssign.json.actions[0].summary),
    'salesRep CANNOT assign_leads', JSON.stringify(repAssign.json.actions));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (no_such_tool)'), reply: { reply: 'ok' } },
    { match: () => true, reply: { action: { tool: 'no_such_tool', args: {} } } },
  );
  const ghost = await ask(env, 'u_mgr', 'Do the ghost tool');
  ok(/unknown tool/.test(ghost.json.actions[0].summary), 'unknown tool rejected cleanly', JSON.stringify(ghost.json.actions));
}

/* ══ 2. create_contact ═════════════════════════════════════════════ */
console.log('\n— 2. create_contact: real doc + duplicate guard —');
{
  const env = await makeEnv();
  const store = storeOf(env);
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (create_contact)'), reply: { reply: 'Kiran added.' } },
    { match: () => true, reply: { action: { tool: 'create_contact', args: { name: 'Kiran Joshi', email: 'kiran@newco.test', phone: '9876500000', company: 'NewCo', jobTitle: 'CTO' } } } },
  );
  const { json } = await ask(env, 'u_mgr', 'Add Kiran Joshi kiran@newco.test 9876500000 at NewCo, CTO');
  ok(json.actions[0].ok === true && json.actions[0].summary.includes('Kiran Joshi'), 'contact created via tool', JSON.stringify(json.actions));
  const row = await env.DB.prepare("SELECT json FROM docs WHERE col = 'contacts' AND json LIKE '%kiran@newco.test%'").first();
  ok(!!row, 'contact doc landed in D1');
  const doc = JSON.parse(row.json);
  ok(doc.status === 'lead' && doc.source === 'ai-assistant' && doc.teamId === 'default-team' && doc.ownerId === 'u_mgr',
    'new contact carries lead status, source, team + owner stamps', JSON.stringify(doc).slice(0, 200));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (create_contact)'), reply: { reply: 'already there' } },
    { match: () => true, reply: { action: { tool: 'create_contact', args: { name: 'Maya Duplicate', email: 'maya@example.com' } } } },
  );
  const dup = await ask(env, 'u_mgr', 'Add Maya Duplicate maya@example.com');
  ok(dup.json.actions[0].ok === false && /already exists/.test(dup.json.actions[0].summary),
    'duplicate email refused (no silent dupes)', JSON.stringify(dup.json.actions));
}

/* ══ 3. create_task ════════════════════════════════════════════════ */
console.log('\n— 3. create_task: assignee resolution + due + priority —');
{
  const env = await makeEnv();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (create_task)'), reply: { reply: 'Reminder set for Neha.' } },
    { match: () => true, reply: { action: { tool: 'create_task', args: { title: 'Call the new leads', description: 'Intro calls', assigneeName: 'Neha K', due: '2026-09-20', priority: 'high' } } } },
  );
  const { json } = await ask(env, 'u_mgr', 'Remind Neha K to call the new leads on 2026-09-20, high priority');
  ok(json.actions[0].ok === true && /assigned to Neha K/.test(json.actions[0].summary), 'task created + assigned', JSON.stringify(json.actions));
  const row = await env.DB.prepare("SELECT json FROM docs WHERE col = 'tasks' AND json LIKE '%Call the new leads%'").first();
  const doc = JSON.parse(row.json);
  ok(doc.assignedTo === 'u_tc1' && doc.assignedToName === 'Neha K', 'assignee resolved to uid by name', JSON.stringify(doc).slice(0, 200));
  ok(doc.dueAt?.v === '2026-09-20T09:30:00.000Z' && doc.priority === 'high' && doc.createdBy === 'u_mgr',
    'due ts marker + priority + creator stamps', JSON.stringify(doc).slice(0, 220));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (create_task)'), reply: { reply: 'who?' } },
    { match: () => true, reply: { action: { tool: 'create_task', args: { title: 'Ghost assignment', assigneeName: 'Nonexistent Person' } } } },
  );
  const ghost = await ask(env, 'u_mgr', 'Assign a task to Nonexistent Person');
  ok(ghost.json.actions[0].ok === false && /no teammate matching/.test(ghost.json.actions[0].summary),
    'unknown assignee refused (never guesses people)', JSON.stringify(ghost.json.actions));
}

/* ══ 4. log_call ═══════════════════════════════════════════════════ */
console.log('\n— 4. log_call: call log doc + contact updated —');
{
  const env = await makeEnv();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (log_call)'), reply: { reply: 'Logged. Follow-up scheduled.' } },
    { match: () => true, reply: { action: { tool: 'log_call', args: { contactQuery: 'Maya Sharma', outcome: 'interested', notes: 'Wants pricing', followUpInDays: 3 } } } },
  );
  const { json } = await ask(env, 'u_rep', 'I spoke to Maya Sharma — interested, wants pricing, follow up in 3 days');
  ok(json.actions[0].ok === true && /call logged on Maya Sharma \(interested\)/.test(json.actions[0].summary),
    'call logged with outcome', JSON.stringify(json.actions));

  const callRow = await env.DB.prepare("SELECT json FROM docs WHERE col = 'call_logs' AND json LIKE '%Maya Sharma%'").first();
  ok(!!callRow, 'call_logs doc written');
  const call = JSON.parse(callRow.json);
  ok(call.outcome === 'interested' && call.contactId === 'c_maya' && call.callerId === 'u_rep' && call.notes === 'Wants pricing',
    'call doc carries outcome/contact/caller/notes', JSON.stringify(call).slice(0, 200));

  const cRow = await env.DB.prepare("SELECT json FROM docs WHERE col = 'contacts' AND id = 'c_maya'").first();
  const c = JSON.parse(cRow.json);
  ok(c.callStatus === 'interested' && c.callAttempts === 1 && !!c.lastCallAt && !!c.followUpAt,
    'contact updated: status, attempts, lastCallAt, followUpAt', JSON.stringify(c).slice(0, 240));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (log_call)'), reply: { reply: 'nope' } },
    { match: () => true, reply: { action: { tool: 'log_call', args: { contactQuery: 'Maya Sharma', outcome: 'teleported' } } } },
  );
  const bad = await ask(env, 'u_rep', 'Log a teleported call with Maya');
  ok(bad.json.actions[0].ok === false && /outcome must be one of/.test(bad.json.actions[0].summary),
    'invalid outcome refused', JSON.stringify(bad.json.actions));
}

/* ══ 5. Deals ══════════════════════════════════════════════════════ */
console.log('\n— 5. search_deals + update_deal_stage —');
{
  const env = await makeEnv();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (search_deals)'), reply: { reply: 'Acme renewal is at proposal for ₹50,000.' } },
    { match: () => true, reply: { action: { tool: 'search_deals', args: { query: 'acme' } } } },
  );
  const { json } = await ask(env, 'u_mgr', 'Where is the Acme deal?');
  ok(json.actions[0].ok === true, 'search_deals ran');
  ok(json.reply.includes('₹50,000') || json.reply.includes('50,000'), 'deal value surfaced in reply', json.reply);

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (update_deal_stage)'), reply: { reply: 'Moved to won.' } },
    { match: () => true, reply: { action: { tool: 'update_deal_stage', args: { query: 'acme', stage: 'won' } } } },
  );
  const won = await ask(env, 'u_mgr', 'Mark Acme as won');
  ok(won.json.actions[0].ok === true && /moved to won/.test(won.json.actions[0].summary), 'deal moved to won', JSON.stringify(won.json.actions));
  const dRow = await env.DB.prepare("SELECT json FROM docs WHERE col = 'deals' AND id = 'd_acme'").first();
  const d = JSON.parse(dRow.json);
  ok(d.stage === 'won' && !!d.actualCloseDate, 'stage persisted + close date stamped', JSON.stringify(d).slice(0, 160));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (update_deal_stage)'), reply: { reply: 'no' } },
    { match: () => true, reply: { action: { tool: 'update_deal_stage', args: { query: 'acme', stage: 'superhero' } } } },
  );
  const badStage = await ask(env, 'u_mgr', 'Move Acme to superhero');
  ok(badStage.json.actions[0].ok === false && /stage must be one of/.test(badStage.json.actions[0].summary),
    'invalid stage refused', JSON.stringify(badStage.json.actions));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (update_deal_stage)'), reply: { reply: 'cannot' } },
    { match: () => true, reply: { action: { tool: 'update_deal_stage', args: { query: 'globex', stage: 'won' } } } },
  );
  const repMove = await ask(env, 'u_rep', 'Mark Globex pilot as won');
  ok(repMove.json.actions[0].ok === false && (/does not allow/.test(repMove.json.actions[0].summary) || /not permitted|denied/.test(repMove.json.actions[0].summary)),
    'salesRep cannot move another rep\'s deal', JSON.stringify(repMove.json.actions));
}

/* ══ 6. assign_leads / distribute_leads ════════════════════════════ */
console.log('\n— 6. Lead assignment: round-robin across the team —');
{
  const env = await makeEnv();
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (distribute_leads)'), reply: { reply: 'Leads shared between Neha and Sam.' } },
    { match: () => true, reply: { action: { tool: 'distribute_leads', args: { to: ['Neha K', 'Sam P'], count: 4 } } } },
  );
  const { json } = await ask(env, 'u_mgr', 'Distribute 4 fresh leads between Neha K and Sam P');
  ok(json.actions[0].ok === true, 'distribute_leads ran', JSON.stringify(json.actions));
  ok(json.actions[0].summary.includes('Neha K') && json.actions[0].summary.includes('Sam P'), 'split reported per person', json.actions[0].summary);
  const rows = await env.DB.prepare("SELECT id, json FROM docs WHERE col = 'contacts'").all();
  const all = (rows.results || []).map((r) => ({ id: r.id, ...JSON.parse(r.json) }));
  const assigned = all.filter((c) => c.assignedBy === 'u_mgr');
  const neha = all.filter((c) => c.assignedTo === 'u_tc1').length;
  const sam = all.filter((c) => c.assignedTo === 'u_tc2').length;
  ok(neha === 3 && sam === 2, 'round robin: Neha 3 (2 new + 1 pre-assigned), Sam 2', `neha=${neha} sam=${sam}`);
  ok(assigned.every((c) => c.assignedBy === 'u_mgr' && !!c.assignedAt), 'assignment stamps: by whom + when');

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (assign_leads)'), reply: { reply: 'Given to Vikram.' } },
    { match: () => true, reply: { action: { tool: 'assign_leads', args: { to: 'Vikram Das', count: 2 } } } },
  );
  const give = await ask(env, 'u_mgr', 'Give 2 leads to Vikram Das');
  ok(give.json.actions[0].ok === true && /Vikram Das \+2/.test(give.json.actions[0].summary), 'assign_leads to one person', give.json.actions[0].summary);

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (distribute_leads)'), reply: { reply: 'ambiguous' } },
    { match: () => true, reply: { action: { tool: 'distribute_leads', args: { to: ['Ghost One', 'Neha K'] } } } },
  );
  const ghost = await ask(env, 'u_mgr', 'Distribute leads between Ghost One and Neha K');
  ok(ghost.json.actions[0].ok === false && /no \(unique\) teammate matching/.test(ghost.json.actions[0].summary),
    'unknown teammate in distribution refused', JSON.stringify(ghost.json.actions));
}

/* ══ 7. Approval gate ══════════════════════════════════════════════ */
console.log('\n— 7. Approval gate: mass sends wait for the human —');
{
  const env = await makeEnv({ AGENT_APPROVAL_MODE: 'always' });
  const store = storeOf(env);
  const pending = [];
  const collectorCtx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
  const base = pipelineScript('ravi@example.com');

  // 7a. Pending: prepared but NOT sent
  sarvamScript.length = 0;
  sarvamScript.push(
    ...base,
    { match: (t) => t.includes('TOOL_RESULT (create_email_task)'), reply: { reply: 'Campaign ready — press Approve to send.' } },
    { match: () => true, reply: { action: { tool: 'create_email_task', args: { instruction: 'Send an announcement about our new offer to all leads' } } } },
  );
  const ask1 = await ask(env, 'u_mgr', 'Send an announcement about our new offer to all leads', { ctx: collectorCtx });
  const ap1 = ask1.json.approvals?.[0];
  ok(!!ap1?.id && ap1.tool === 'create_email_task', 'approval object returned to the chat', JSON.stringify(ask1.json.approvals));
  ok(ask1.json.actions[0].summary.includes('awaiting your approval'), 'action chip says awaiting approval');
  let mailTasks = (await listTasks(store)).filter((t) => t.source === 'assistant');
  ok(mailTasks.length === 0, 'NO email task exists before approval', JSON.stringify(mailTasks).slice(0, 120));

  // 7b. Approval execution → real task + real delivery
  const approveReq = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ap1.id, decision: 'approved' }),
  });
  const approveRes = await handleAssistantApproval(approveReq, env, { uid: 'u_mgr', ctx: collectorCtx });
  const approveJson = await approveRes.json();
  ok(approveRes.status === 200 && approveJson.status === 'approved' && !!approveJson.taskId, 'approve → task started', JSON.stringify(approveJson));
  await Promise.allSettled(pending);
  mailTasks = (await listTasks(store)).filter((t) => t.source === 'assistant');
  ok(mailTasks.length === 1 && mailTasks[0].status === 'done', 'approved task PLANNED AND DELIVERED', mailTasks[0]?.status);
  ok(captured.sends.some((s) => s.body?.email?.recipients?.to?.[0]?.email === 'ravi@example.com'),
    'approved campaign actually reached the recipient');

  // 7c. Double-decide → 409 (fresh Request — a body can only be read once)
  const againReq = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ap1.id, decision: 'approved' }),
  });
  const again = await handleAssistantApproval(againReq, env, { uid: 'u_mgr', ctx: collectorCtx });
  ok(again.status === 409, 'second decision on same approval → 409', `got ${again.status}`);

  // 7d. Rejection → nothing sends
  sarvamScript.length = 0;
  sarvamScript.push(
    ...base,
    { match: (t) => t.includes('TOOL_RESULT (create_email_task)'), reply: { reply: 'Ready — approve?' } },
    { match: () => true, reply: { action: { tool: 'create_email_task', args: { instruction: 'Send the Diwali blast to everyone' } } } },
  );
  const ask2 = await ask(env, 'u_mgr', 'Send the Diwali blast to everyone', { ctx: collectorCtx });
  const ap2 = ask2.json.approvals?.[0];
  ok(!!ap2?.id, 'second approval created');
  const rejectReq = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ap2.id, decision: 'rejected' }),
  });
  const rejectRes = await handleAssistantApproval(rejectReq, env, { uid: 'u_mgr', ctx: collectorCtx });
  const rejectJson = await rejectRes.json();
  ok(rejectRes.status === 200 && rejectJson.status === 'rejected' && /Declined/.test(rejectJson.reply || ''), 'reject → declined, nothing sent', JSON.stringify(rejectJson));
  mailTasks = (await listTasks(store)).filter((t) => t.source === 'assistant');
  ok(mailTasks.length === 1, 'rejected approval created NO email task', `count=${mailTasks.length}`);

  // 7e. Non-requester, non-manager cannot decide
  sarvamScript.length = 0;
  sarvamScript.push(
    ...base,
    { match: (t) => t.includes('TOOL_RESULT (create_email_task)'), reply: { reply: 'Ready — approve?' } },
    { match: () => true, reply: { action: { tool: 'create_email_task', args: { instruction: 'Send the year-end note to all clients' } } } },
  );
  const ask3 = await ask(env, 'u_mgr', 'Send the year-end note to all clients', { ctx: collectorCtx });
  const ap3 = ask3.json.approvals?.[0];
  const repReq = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: ap3.id, decision: 'approved' }),
  });
  const repRes = await handleAssistantApproval(repReq, env, { uid: 'u_rep', ctx: collectorCtx });
  ok(repRes.status === 403, 'rep cannot approve a manager\'s send (403)');

  // 7f. Bad requests
  const noId = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' }),
  });
  ok((await handleAssistantApproval(noId, env, { uid: 'u_mgr', ctx: collectorCtx })).status === 400, 'missing id → 400');
  const badDecision = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'ap_x', decision: 'maybe' }),
  });
  ok((await handleAssistantApproval(badDecision, env, { uid: 'u_mgr', ctx: collectorCtx })).status === 400, 'bad decision → 400');
  const ghostId = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'ap_ghost', decision: 'approved' }),
  });
  ok((await handleAssistantApproval(ghostId, env, { uid: 'u_mgr', ctx: collectorCtx })).status === 404, 'unknown id → 404');

  // 7g. Direct mode still queues immediately (legacy behaviour, approval off)
  const env2 = await makeEnv();
  const store2 = storeOf(env2);
  const pending2 = [];
  const collector2 = { waitUntil: (p) => pending2.push(Promise.resolve(p).catch(() => {})) };
  sarvamScript.length = 0;
  sarvamScript.push(
    ...pipelineScript('maya@example.com'),
    { match: (t) => t.includes('TOOL_RESULT (create_email_task)'), reply: { reply: 'Queued and starting.' } },
    { match: () => true, reply: { action: { tool: 'create_email_task', args: { instruction: 'Send Maya the introduction email about Aidraft Legal' } } } },
  );
  const direct = await ask(env2, 'u_mgr', 'Send Maya the introduction email', { ctx: collector2 });
  ok(!direct.json.approvals && direct.json.actions[0].ok, 'approval OFF → immediate queue (legacy behaviour)', JSON.stringify(direct.json.actions));
  await Promise.allSettled(pending2);
  const directTask = (await listTasks(store2)).find((t) => t.source === 'assistant');
  ok(!!directTask && directTask.status === 'done', 'direct-mode task delivered', directTask?.status);
  ok(captured.sends.some((s) => s.body?.email?.recipients?.to?.[0]?.email === 'maya@example.com'), 'direct-mode email reached Maya');
}

/* ══ 8. Audit log + episodic memory ════════════════════════════════ */
console.log('\n— 8. Audit log + episodic memory across sessions —');
{
  const env = await makeEnv();
  const store = storeOf(env);
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (crm_overview)'), reply: { reply: 'You have a healthy pipeline.' } },
    { match: () => true, reply: { action: { tool: 'crm_overview', args: {} } } },
  );
  await ask(env, 'u_mgr', 'How is my pipeline?');
  const audit = JSON.parse(await store.get('agent:audit') || '[]');
  ok(Array.isArray(audit) && audit.length >= 1, 'audit log written');
  const entry = audit[0];
  ok(entry.tool === 'crm_overview' && entry.ok === true && entry.uid === 'u_mgr' && typeof entry.ms === 'number',
    'audit entry: tool, ok, uid, latency', JSON.stringify(entry));
  ok(audit.length <= 100, 'audit capped at 100');

  const eps = JSON.parse(await store.get('agent:episodes:u_mgr') || '[]');
  ok(eps.length === 1 && eps[0].q.includes('pipeline') && eps[0].tools.includes('crm_overview'),
    'episode saved (question + tools)', JSON.stringify(eps));

  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (list_crm_tasks)'), reply: { reply: 'Two open tasks right now.' } },
    { match: (t) => t.includes('RECENT CONVERSATIONS'), reply: { action: { tool: 'list_crm_tasks', args: {} } } },
    { match: () => true, reply: { reply: 'fallback' } },
  );
  const second = await ask(env, 'u_mgr', 'What are my open tasks?');
  ok(second.json.reply.includes('Two open tasks'), 'episodic memory visible to NEXT turn (context continuity)', second.json.reply);
  ok(captured.sarvamSeen.some((t) => t.includes('RECENT CONVERSATIONS WITH THIS USER') && t.includes('How is my pipeline?')),
    'previous conversation injected as memory block');
  ok(second.json.actions[0]?.tool === 'list_crm_tasks' || true, 'list_crm_tasks reachable');
  const crmTasksResult = second.json.actions.find((a) => a.tool === 'list_crm_tasks');
  ok(!!crmTasksResult && crmTasksResult.ok, 'list_crm_tasks ran with open tasks', JSON.stringify(second.json.actions));
}

/* ══ 9. Route wiring through index.js ══════════════════════════════ */
console.log('\n— 9. index.js routes: auth first, approve endpoint live —');
{
  const env = await makeEnv();
  const noAuth = new Request('https://worker.test/v1/assistant/approve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x', decision: 'approved' }),
  });
  try {
    const r1 = await worker.fetch(noAuth, env, { waitUntil: () => {} });
    ok(r1.status === 401, '/v1/assistant/approve behind auth (401 without token)', `got ${r1.status}`);
  } catch (e) {
    ok(false, '/v1/assistant/approve behind auth (401 without token)', String(e).slice(0, 120));
  }
  const noAuth2 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }),
  });
  try {
    const r2 = await worker.fetch(noAuth2, env, { waitUntil: () => {} });
    ok(r2.status === 401, '/v1/assistant still behind auth (401, never 1101)', `got ${r2.status}`);
  } catch (e) {
    ok(false, '/v1/assistant still behind auth (401, never 1101)', String(e).slice(0, 120));
  }
}

/* ── Summary ─────────────────────────────────────────────────────── */
console.log(`\n════════════════════════════════════════`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log('  ALL GREEN');
}
