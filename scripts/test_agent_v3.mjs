#!/usr/bin/env node
/**
 * Tests for the AGENT V3 wave — MCP-hosted super-agent:
 *   1. PAIRING GRANTS: mint from the app, use on /mcp, list, revoke
 *   2. MCP PROTOCOL: initialize / tools/list (role-filtered) / tools/call /
 *      ping / unknown method — JSON-RPC 2.0 shapes, auth enforcement
 *   3. BUILDER: build_website AI path + signature fallback, public serving
 *      at /sites/<id>, save_note + list_artifacts registry
 *   4. RESEARCH: web_search (provider chain + fallback), web_fetch text
 *      extraction (scripts stripped), SSRF guard
 *   5. AGENT LOOP: multi-step research chain + build-with-URL reply +
 *      artifacts surfaced in the chat response
 *   6. ROUTES through index.js fetch: /mcp, /sites, pair auth ordering
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 22+.
 *   node scripts/test_agent_v3.mjs
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

function makeR2() {
  const m = new Map();
  return {
    __map: m,
    async put(key, value, opts = {}) { m.set(key, { value, opts }); return { key }; },
    async get(key) {
      const o = m.get(key);
      if (!o) return null;
      return {
        body: o.value,
        writeHttpMetadata(h) { h.set('Content-Type', o.opts?.httpMetadata?.contentType || 'application/octet-stream'); },
        httpEtag: '"shim"',
      };
    },
    async delete(key) { m.delete(key); },
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

/* ── Fetch mock (Sarvam + web + everything else) ────────────────── */
const captured = { sarvamSeen: [] };
const sarvamScript = [];
function sarvamReplyFor(text) {
  for (const s of sarvamScript) if (s.match(text)) return typeof s.reply === 'function' ? s.reply(text) : s.reply;
  throw new Error('sarvam mock: no scripted reply for: ' + text.slice(0, 90).replace(/\n/g, ' '));
}

/* Codegen stages (Agent v7): the agent plans + hand-codes each section. */
const codegenScript = () => [
  { match: (t) => t.includes('Plan its information architecture'), reply: { sections: [
      { id: 'hero', name: 'Home', goal: 'state the promise', layout: 'Statement hero with oversized headline and CTA row', content_keys: ['kicker', 'headline', 'sub', 'primary_cta', 'secondary_cta', 'hero_badges'], motion: 'staggered rise' },
      { id: 'features', name: 'Why us', goal: 'prove it', layout: 'Asymmetric card grid', content_keys: ['features', 'stats'], motion: 'scroll reveal' },
      { id: 'contact', name: 'Contact', goal: 'convert', layout: 'Split band with CTA and contact list', content_keys: ['cta_title', 'cta_sub', 'contact', 'primary_cta'], motion: 'slide up' },
    ], nav: ['hero', 'features', 'contact'] } },
  { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'features', verdict: 'good' }, { id: 'contact', verdict: 'good' }] } },
  { match: (t) => t.includes('HAND-CODING one section'), reply: (t) => {
      const id = /section "sec-([a-z0-9-]+)"/.exec(t)?.[1] || 'hero';
      const headline = (/"headline":"([^"]*)"/.exec(t)?.[1] || `Hand-coded ${id}`).replace(/[<>]/g, '');
      const sub = (/"sub":"([^"]*)"/.exec(t)?.[1] || 'Bespoke section content.').replace(/[<>]/g, '');
      const titles = [...t.matchAll(/"title":"([^"]*)"/g)].map((m) => m[1].replace(/[<>]/g, '')).slice(0, 8);
      const list = titles.length ? `<ul>${titles.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
      return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><span class="kicker">${id}</span><h2>${headline}</h2><p>${sub}</p>${list}<a class="btn btn-accent" href="#sec-contact">Act</a></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:clamp(30px,5vw,54px)}#sec-${id} .btn-accent:hover{transform:translateY(-2px)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'y'.repeat(40)} */</style>` };
    } },
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages.map((m) => m.content).join('\n');
    captured.sarvamSeen.push(text);
    const reply = sarvamReplyFor(text);
    const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
    return jsonRes(200, { choices: [{ message: { content }, finish_reason: 'stop' }] });
  }
  if (u.startsWith('https://html.duckduckgo.com/')) {
    if (globalThis.__ddgHtmlDown) return jsonRes(403, {});
    return new Response(globalThis.__ddgHtml || DDG_FIXTURE, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  if (u.startsWith('https://lite.duckduckgo.com/')) {
    if (globalThis.__ddgLiteDown) return jsonRes(403, {});
    return new Response(globalThis.__ddgLite || DDG_LITE_FIXTURE, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  if (u.startsWith('https://api.duckduckgo.com/')) {
    return jsonRes(200, globalThis.__ddgInstant || { AbstractText: '', RelatedTopics: [] });
  }
  if (u === 'https://example.com/competitor' || u === 'https://example.com/competitor/') {
    return new Response(FETCH_FIXTURE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return jsonRes(404, {});
};
function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

const DDG_FIXTURE = `<html><body>
<div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbestbakery.example.com%2F&amp;rut=abc">Best Bakery in Mumbai — 2026 Guide</a></h2>
<a class="result__snippet" href="#">The top rated &amp; beloved bakeries this year, ranked by locals.</a></div>
<div class="result"><h2><a rel="nofollow" class="result__a" href="https://cakes.example.com/post">How bakeries sell more with WhatsApp</a></h2>
<a class="result__snippet" href="#">Ordering over chat grew repeat orders by 32%.</a></div>
</body></html>`;

const DDG_LITE_FIXTURE = `<html><body>
<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Flite.example.com%2Fx" class='result-link'>Lite Result One</a></td></tr>
<tr><td class='result-snippet'>A snippet from the lite endpoint</td></tr></table>
</body></html>`;

const FETCH_FIXTURE = `<html><head><title>Competitor Insights</title>
<link rel="stylesheet" href="https://evil.example.com/x.css"></head>
<body><h1>Market</h1>
<script src="https://evil.example.com/tracker.js"></script>
<style>.x{color:red}</style>
<p>Mumbai bakery market grew 12% in 2026.</p>
<iframe src="https://evil.example.com"></iframe>
<p>Contact: hello@competitor.example.com</p></body></html>`;

/* ── Seed data ──────────────────────────────────────────────────── */
const USERS = [
  { id: 'u_mgr', displayName: 'Asha Rao', role: 'manager', teamId: 'default-team', email: 'asha@team.test' },
  { id: 'u_view', displayName: 'Ria M', role: 'viewer', teamId: 'default-team', email: 'ria@team.test' },
];
const CONTACTS = [
  { id: 'c_maya', name: 'Maya Sharma', email: 'maya@example.com', company: 'Initech', status: 'lead', assignedTo: null, teamId: 'default-team' },
];

/* ── Modules under test (import AFTER fetch mock installed) ─────── */
const { handleMcp, handleMcpPair, serveAgentSite, mcpServerInfo } = await import('../cloudflare/worker/src/emailer/mcp.js');
const { runTool, TOOLS } = await import('../cloudflare/worker/src/emailer/assistant.js');
const { handleAssistant } = await import('../cloudflare/worker/src/emailer/assistant.js');
const { buildWebsite, saveNote, listArtifacts } = await import('../cloudflare/worker/src/emailer/builder.js');
const { webSearch, webFetch } = await import('../cloudflare/worker/src/emailer/research.js');
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const worker = (await import('../cloudflare/worker/src/index.js')).default;

async function makeEnv(overrides = {}) {
  const db = makeD1();
  for (const u of USERS) {
    await seedDoc(db, 'users', u.id, { displayName: u.displayName, role: u.role, teamId: u.teamId, email: u.email });
  }
  for (const c of CONTACTS) await seedDoc(db, 'contacts', c.id, c);
  const env = {
    DB: db,
    MEDIA: makeR2(),
    FIREBASE_PROJECT_ID: 'nebula-crm-70f58',
    SARVAM_API_KEY: 'sarvam_test',
    MAILERCLOUD_API_KEY: 'mc_test_key',
    MAIL_BUSINESS_NAME: 'Nebula CRM',
    MAIL_BRAND_COLOR: '#6C8CFF',
    MAIL_SELF_URL: 'https://worker.test',
    ...overrides,
  };
  return env;
}

const CTX = { waitUntil: () => {} };

async function mcpRpc(env, method, params, token, id = 1) {
  const req = new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }),
  });
  const res = await handleMcp(req, env, CTX);
  let body = null;
  try { body = await res.json(); } catch { /* notifications return empty */ }
  return { res, body };
}

async function pair(env, uid, label) {
  const req = new Request('https://worker.test/v1/assistant/mcp/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
  const res = await handleMcpPair(req, env, { uid });
  return { res, json: await res.json() };
}

/* ══ 1. Pairing grants ════════════════════════════════════════════ */
console.log('\n— 1. Pairing grants (no static API tokens) —');
const env = await makeEnv();
let grantToken = '';
{
  const { res, json } = await pair(env, 'u_mgr', 'Claude Desktop');
  ok(res.status === 200 && json.ok === true, 'POST pair mints a grant');
  ok(typeof json.token === 'string' && json.token.startsWith('mcp_') && json.token.length >= 40,
    'grant token is a 192-bit mcp_ secret', json.token);
  ok(json.url === 'https://worker.test/mcp', 'grant carries the MCP endpoint URL', json.url);
  ok(json.expires_at && Date.parse(json.expires_at) > Date.now(), 'expires_at in the future (24h)');
  grantToken = json.token;

  const list = await (await handleMcpPair(
    new Request('https://worker.test/v1/assistant/mcp/pair', { method: 'GET' }), env, { uid: 'u_mgr' }
  )).json();
  ok(Array.isArray(list.grants) && list.grants.some((g) => g.grant_id === grantToken && g.label === 'Claude Desktop'),
    'GET pair lists the active grant', JSON.stringify(list.grants));

  const listOther = await (await handleMcpPair(
    new Request('https://worker.test/v1/assistant/mcp/pair', { method: 'GET' }), env, { uid: 'u_view' }
  )).json();
  ok(Array.isArray(listOther.grants) && listOther.grants.length === 0, 'grants are scoped to their owner');

  const bad = await (await handleMcpPair(
    new Request('https://worker.test/v1/assistant/mcp/pair', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_id: 'nope' }),
    }), env, { uid: 'u_mgr' }
  )).json();
  ok(bad.error === 'grant not found', 'DELETE of unknown grant 404s');
}

/* ══ 2. MCP protocol ══════════════════════════════════════════════ */
console.log('\n— 2. MCP protocol (JSON-RPC 2.0) —');
{
  const info = await (await mcpServerInfo(new Request('https://worker.test/mcp'), env)).json();
  ok(info.server === 'nebula-crm-mcp' && info.tools === Object.keys(TOOLS).length,
    `GET /mcp capability advert (${info.tools} tools)`);
  ok(info.auth.mode.includes('pairing'), 'advert documents grant auth (no API tokens)');

  const noAuth = await mcpRpc(env, 'initialize', { protocolVersion: '2025-03-26' }, null);
  ok(noAuth.res.status === 401 && noAuth.body?.error?.code === -32001, 'POST /mcp without credential → 401 JSON-RPC error');

  const init = await mcpRpc(env, 'initialize', { protocolVersion: '2025-03-26' }, grantToken);
  ok(init.body?.result?.protocolVersion === '2025-03-26', 'initialize echoes supported protocol version');
  ok(init.body?.result?.serverInfo?.name === 'nebula-crm-mcp', 'initialize returns serverInfo');
  ok(!!init.body?.result?.capabilities?.tools, 'initialize declares tools capability');

  const initOld = await mcpRpc(env, 'initialize', { protocolVersion: '2024-11-05' }, grantToken, 2);
  ok(initOld.body?.result?.protocolVersion === '2024-11-05', 'client-requested older version honoured');

  const notifReq = new Request('https://worker.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grantToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  const notifRes = await handleMcp(notifReq, env, CTX);
  ok(notifRes.status === 202, 'notifications/initialized → 202 empty');

  const list = await mcpRpc(env, 'tools/list', {}, grantToken);
  const names = (list.body?.result?.tools || []).map((t) => t.name);
  ok(names.length === Object.keys(TOOLS).length, `tools/list exposes all ${Object.keys(TOOLS).length} tools`, String(names.length));
  ok(['build_website', 'web_search', 'web_fetch', 'save_note', 'list_artifacts', 'create_email_task'].every((n) => names.includes(n)),
    'builder + research + email tools present');
  const buildSpec = list.body.result.tools.find((t) => t.name === 'build_website');
  ok(buildSpec?.inputSchema?.type === 'object' && !!buildSpec?.description, 'build_website has schema + description');

  // Role filtering: viewer must NOT see role-gated write tools
  const { json: vjson } = await pair(env, 'u_view', 'viewer pairing');
  const vList = await mcpRpc(env, 'tools/list', {}, vjson.token);
  const vNames = (vList.body?.result?.tools || []).map((t) => t.name);
  ok(!vNames.includes('build_website') && !vNames.includes('create_contact'),
    'role-gated tools hidden from viewer in tools/list');
  ok(vNames.includes('web_search') && vNames.includes('crm_overview'), 'read tools visible to viewer');
  ok(vNames.includes('create_email_task'), 'consequential tool visible (has approval gate, no role gate)');

  const call = await mcpRpc(env, 'tools/call', { name: 'crm_overview', arguments: {} }, grantToken);
  const inner = JSON.parse(call.body?.result?.content?.[0]?.text || '{}');
  ok(call.body?.result?.isError === false && inner.ok === true && !!inner.crm,
    'tools/call crm_overview executes (isError false, live data)');

  const denied = await mcpRpc(env, 'tools/call', { name: 'create_contact', arguments: { name: 'Zed' } }, vjson.token);
  const deniedInner = JSON.parse(denied.body?.result?.content?.[0]?.text || '{}');
  ok(denied.body?.result?.isError === true && deniedInner.notPermitted === true,
    'tools/call enforces roles server-side (viewer denied create_contact)');

  const unknown = await mcpRpc(env, 'tools/call', { name: 'does_not_exist', arguments: {} }, grantToken);
  ok(unknown.body?.error?.code === -32602, 'unknown tool → JSON-RPC -32602');

  const badMethod = await mcpRpc(env, 'resources/list', {}, grantToken);
  ok(badMethod.body?.error?.code === -32601, 'unknown method → JSON-RPC -32601');

  const ping = await mcpRpc(env, 'ping', {}, grantToken);
  ok(ping.body?.result && Object.keys(ping.body.result).length === 0, 'ping → empty result');
}

/* ══ 3. Builder ═══════════════════════════════════════════════════ */
console.log('\n— 3. Builder: sites, fallback, notes, registry —');
const store = createStore(env);
let aiSiteId = '';
{
  const html = '<!DOCTYPE html><html><head><title>Sunrise Bakehouse</title><style>h1{color:#d47}</style></head><body><h1>Sunrise Bakehouse</h1><p>Fresh Mumbai sourdough daily' + 'x'.repeat(600) + '</p></body></html>';
  sarvamScript.length = 0;
  // v3 pipeline: THINK → RESEARCH → WRITE → POLISH → PLAN → CODE per section → REVIEW → WIRE.
  sarvamScript.push(
    ...codegenScript(),
    // Agent v8: the Lead orchestrator plans the run before the specialists
    { match: (t) => t.includes('elite multi-agent web studio'), reply: { audience: 'Mumbai foodies', research_focus: 'mumbai bakery market', queries: [], sections_target: 4, emphasis: ['menu highlights'], risks: ['generic bakery look'], tone_note: 'warm artisan specificity' } },
    { match: (t) => t.includes('Decide the design direction'), reply: { theme: 'editorial', palette: { accent: '#b3402a' }, font: 'serif', voice: 'warm artisan', audience: 'Mumbai foodies', headline_angle: 'Fresh sourdough daily', must_have: ['menu highlights'], research_queries: [] } },
    { match: (t) => t.includes('conversion copywriter'), reply: { title: 'Sunrise Bakehouse', kicker: 'Bakery', headline: 'Sunrise Bakehouse', sub: 'Fresh Mumbai sourdough daily.', primary_cta: { label: 'Order now', href: 'mailto:hello@sunrise.test' }, features: [{ icon: '🥐', title: 'Baked at dawn', text: 'Croissants out of the oven by 7am.' }], contact: { email: 'hello@sunrise.test' } } },
  );

  const res = await buildWebsite(env, store, { uid: 'u_mgr', displayName: 'Asha', role: 'manager' },
    { title: 'Sunrise Bakehouse', kind: 'landing', brief: 'Artisan bakery in Mumbai. Fresh sourdough, croissants and filter coffee. CTA: order for pickup.' }, 'https://worker.test');
  ok(res.ok === true && res.builder === 'ai', 'build_website AI codegen pipeline succeeds (agent hand-coded the page)', JSON.stringify(res).slice(0, 160));
  ok(Array.isArray(res.stages) && res.stages.some((s) => s.stage === 'think') && res.stages.some((s) => s.stage === 'write') && res.stages.some((s) => String(s.stage).startsWith('code:')),
    'build returns the stage trace (think → write → code:<section> → wire)', JSON.stringify(res.stages));
  ok(Array.isArray(res.team) && ['Lead', 'Art Director', 'Copywriter', 'Architect', 'Engineer', 'QA Director'].every((a) => res.team.some((r) => r.agent === a)),
    'build returns the multi-agent team trace (v8)', JSON.stringify((res.team || []).map((r) => r.agent)));
  ok(/^https:\/\/worker\.test\/sites\/s_[a-z0-9]+$/.test(res.url || ''), 'returns public URL', res.url);
  aiSiteId = res.artifact_id;

  const served = await serveAgentSite(new Request(res.url), env, `/sites/${aiSiteId}`);
  const servedText = await served.text();
  ok(served.status === 200 && servedText.includes('Sunrise Bakehouse') && servedText.includes('<!DOCTYPE html>'), 'GET /sites/<id> serves the AI-designed site');
  ok(served.headers.get('Content-Type').includes('text/html'), 'served as text/html');
  ok(servedText.includes('Baked at dawn') && servedText.includes('viewport'), 'engine page carries AI copy + mobile viewport');

  // Fallback: AI garbage at every stage → engine fallback, still shipped
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('design director'), reply: 'I cannot do that today.' },
    { match: (t) => t.includes('conversion copywriter'), reply: 'no JSON here' },
  );
  const fb = await buildWebsite(env, store, { uid: 'u_mgr', displayName: 'Asha', role: 'manager' },
    { title: 'Diwali Offer', kind: 'promo', brief: 'Twenty percent off every gift hamper this Diwali. Family packs available. Order by Friday for delivery before the festival weekend.' }, 'https://worker.test');
  ok(fb.ok === true && fb.builder === 'signature', 'AI failure degrades to the deterministic engine — build NEVER fails', JSON.stringify({ builder: fb.builder, ok: fb.ok }));
  const fbHtml = await (await serveAgentSite(new Request(fb.url), env, `/sites/${fb.artifact_id}`)).text();
  ok(fbHtml.includes('Diwali Offer') && fbHtml.includes('<!DOCTYPE html>') && fbHtml.includes('</html>'), 'fallback site is complete branded HTML');
  ok(!fbHtml.includes('```') && !fbHtml.toLowerCase().includes('doctype]'), 'fallback page never leaks fences or model chatter');

  // Sanitizer: remote script/iframes stripped from AI webapp output
  const pad = 'p'.repeat(600);
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('single-file web app'), reply: { __raw: `<!DOCTYPE html><html><head><title>Batch Counter</title></head><body><h1>App</h1>${pad}<script src="https://evil.test/x.js"></script><iframe src="https://evil.test"></iframe><script>localStorage.setItem("ok","1")</script></body></html>` } });
  const san = await buildWebsite(env, store, { uid: 'u_mgr', role: 'manager' }, { title: 'App', kind: 'webapp', brief: 'A simple counter app for tracking daily bake batches.' }, 'https://worker.test');
  const sanHtml = await (await serveAgentSite(new Request(san.url), env, `/sites/${san.artifact_id}`)).text();
  ok(!sanHtml.includes('evil.test'), 'sanitizer strips remote scripts/iframes');
  ok(sanHtml.includes('localStorage'), 'inline app scripts survive');

  // save_note + registry
  const note = await saveNote(store, { uid: 'u_mgr', displayName: 'Asha' }, { title: 'Mumbai bakery market notes', content: '# Findings\n\n- Market grew 12% in 2026\n- WhatsApp ordering lifts repeat sales' });
  ok(note.ok === true && note.artifact_id.startsWith('n_'), 'save_note stores an artifact');

  const arts = await listArtifacts(store, 'u_mgr');
  ok(arts.length === 4, 'list_artifacts shows all builds (3 sites + 1 note)', String(arts.length));
  ok(arts[0].id === note.artifact_id, 'newest first');

  const notePage = await serveAgentSite(new Request(`https://worker.test/sites/${note.artifact_id}`), env, `/sites/${note.artifact_id}`);
  const noteHtml = await notePage.text();
  ok(notePage.status === 200 && noteHtml.includes('Findings') && noteHtml.includes('Market grew'), 'notes are served as shareable pages too');

  ok((await serveAgentSite(new Request('https://worker.test/sites/zzznope'), env, '/sites/zzznope')).status === 404,
    'unknown artifact → 404');
}

/* ══ 4. Research ══════════════════════════════════════════════════ */
console.log('\n— 4. Research: web_search + web_fetch —');
{
  const s = await webSearch({ query: 'best bakery mumbai 2026' });
  ok(s.ok === true && s.provider === 'duckduckgo_html', 'web_search primary provider works');
  ok(s.results.length === 2 && s.results[0].url === 'https://bestbakery.example.com/' && s.results[0].title.includes('Best Bakery'),
    'results parsed: uddg unwrapped, title kept', JSON.stringify(s.results[0]));
  ok(s.results[0].snippet.includes('beloved'), 'snippets decoded (entities)');

  globalThis.__ddgHtmlDown = true;
  const s2 = await webSearch({ query: 'fallback' });
  ok(s2.ok === true && s2.provider === 'duckduckgo_lite', 'chain falls back to lite endpoint when html 403s', s2.provider);
  ok(s2.results[0].url === 'https://lite.example.com/x', 'lite results parsed');
  globalThis.__ddgHtmlDown = false;

  globalThis.__ddgLiteDown = true;
  globalThis.__ddgInstant = { Heading: 'Bakery', AbstractText: 'A bakery is an establishment.', AbstractURL: 'https://en.wikipedia.org/wiki/Bakery', RelatedTopics: [{ FirstURL: 'https://en.wikipedia.org/wiki/Sourdough', Text: 'Sourdough - Bread made by fermentation' }] };
  globalThis.__ddgHtmlDown = true; // take providers 1+2 down to reach #3
  const s3 = await webSearch({ query: 'bakery' });
  ok(s3.ok === true && s3.provider === 'duckduckgo_answers' && s3.results.length === 2, 'third provider: instant answers', s3.provider);
  delete globalThis.__ddgInstant; delete globalThis.__ddgLiteDown; delete globalThis.__ddgHtmlDown;

  globalThis.__ddgHtmlDown = true; globalThis.__ddgLiteDown = true; globalThis.__ddgInstant = {};
  const s4 = await webSearch({ query: 'nothing works' });
  ok(s4.ok === false && /unavailable/.test(s4.error) && s4.error.includes('duckduckgo_answers'),
    'honest failure with provider attempts listed', s4.error?.slice(0, 60));
  delete globalThis.__ddgInstant; globalThis.__ddgHtmlDown = false; globalThis.__ddgLiteDown = false;

  const f = await webFetch({ url: 'https://example.com/competitor' });
  ok(f.ok === true && f.title === 'Competitor Insights', 'web_fetch extracts title');
  ok(f.text.includes('grew 12%') && f.text.includes('hello@competitor.example.com'), 'body text extracted');
  ok(!f.text.includes('.x{color:red}') && !f.text.includes('tracker'), 'scripts/styles removed from text');

  const ssrf = await webFetch({ url: 'http://127.0.0.1:8080/admin' });
  ok(ssrf.ok === false && /local addresses/.test(ssrf.error), 'SSRF guard blocks localhost');
  const proto = await webFetch({ url: 'ftp://example.com/x' });
  ok(proto.ok === false, 'non-http(s) protocol rejected');
}

/* ══ 5. Agent loop: research chain + build with URL ═══════════════ */
console.log('\n— 5. Agent loop end-to-end —');
{
  // (a) research chain: web_search → reply citing source
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (web_search)'), reply: { reply: 'Mumbai bakery market grew 12% in 2026 (source: example.com). Worth a festive push.' } },
    { match: () => true, reply: { action: { tool: 'web_search', args: { query: 'mumbai bakery market 2026' } } } },
  );
  const r1 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Research the Mumbai bakery market for me' }] }),
  });
  const a1 = await (await handleAssistant(r1, env, { uid: 'u_mgr', ctx: CTX })).json();
  ok(a1.ok && a1.reply.includes('12%') && a1.actions[0]?.tool === 'web_search',
    'research chain: agent searched the web and cited findings', a1.reply?.slice(0, 80));

  // (b) build chain: build_website → reply quoting the URL, artifacts in response
  const siteHtml = '<!DOCTYPE html><html><head><title>Bakehouse Festive</title></head><body><h1>Festive hampers</h1><p>Order by Friday' + 'y'.repeat(400) + '</p></body></html>';
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (build_website)'), reply: { reply: 'Your festive landing page is live at https://worker.test/sites/QUOTE_URL — share it with customers.' } },
    { match: (t) => t.includes('KIND:'), reply: { __raw: siteHtml } },
    { match: () => true, reply: { action: { tool: 'build_website', args: { title: 'Bakehouse Festive', kind: 'promo', brief: 'Festive hamper pre-orders, 20% off, order by Friday.' } } } },
  );
  const r2 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Build me a festive promo page for my bakery' }] }),
  });
  const a2 = await (await handleAssistant(r2, env, { uid: 'u_mgr', ctx: CTX })).json();
  ok(a2.ok && a2.actions[0]?.tool === 'build_website', 'build chain: agent built a website');
  ok(Array.isArray(a2.artifacts) && a2.artifacts[0]?.url?.startsWith('https://worker.test/sites/'),
    'artifact surfaced in chat response with URL', JSON.stringify(a2.artifacts));
  const builtId = a2.artifacts?.[0]?.id;
  ok(a2.reply.includes(builtId) || a2.reply.includes('QUOTE_URL'), 'reply references the built page', a2.reply.slice(0, 100));
  const builtServed = await serveAgentSite(new Request(a2.artifacts[0].url), env, `/sites/${builtId}`);
  ok(builtServed.status === 200, 'chat-built site is actually live on /sites');

  // (c) viewer cannot build
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('TOOL_RESULT (build_website)'), reply: { reply: 'Understood.' } },
    { match: () => true, reply: { action: { tool: 'build_website', args: { title: 'X', brief: 'Viewer tries to build a site here.' } } } },
  );
  const r3 = new Request('https://worker.test/v1/assistant', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a site' }] }),
  });
  const a3 = await (await handleAssistant(r3, env, { uid: 'u_view', ctx: CTX })).json();
  ok(a3.actions[0]?.ok === false, 'viewer build attempt denied server-side', JSON.stringify(a3.actions));
}

/* ══ 6. Routes through index.js fetch ═════════════════════════════ */
console.log('\n— 6. index.js route wiring —');
{
  const r2a = await worker.fetch(new Request('https://worker.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) }), await makeEnv(), CTX);
  ok(r2a.status === 401, 'POST /mcp before Firebase gate (grant auth, 401 without credential)', String(r2a.status));

  const r2b = await worker.fetch(new Request('https://worker.test/v1/assistant/mcp/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), await makeEnv(), CTX);
  ok(r2b.status === 401, '/v1/assistant/mcp/pair stays behind Firebase auth');

  const envR = await makeEnv();
  const r2c = await worker.fetch(new Request('https://worker.test/sites/zzznope'), envR, CTX);
  ok(r2c.status === 404, 'GET /sites/<id> public route (404 for unknown, not 401)');

  const envI = await makeEnv();
  const r2d = await mcpServerInfo(new Request('https://worker.test/mcp'), envI);
  ok(r2d.status === 200, 'GET /mcp public info route live');

  // Full MCP round-trip through the REAL worker.fetch (grant → tools/call)
  const pairReq = new Request('https://worker.test/v1/assistant/mcp/pair', {
    method: 'POST', headers: { Authorization: 'Bearer firebase-but-invalid', 'Content-Type': 'application/json' }, body: '{}',
  });
  const deniedPair = await worker.fetch(pairReq, envI, CTX);
  ok(deniedPair.status === 401, 'pair route rejects invalid Firebase tokens');
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
