#!/usr/bin/env node
/**
 * Tests for the AGENT V5 wave — the STUDIO BUILD ENGINE v2:
 *   1. EXTRACTION GATE: markdown fences, model chatter, truncated and
 *      fenceless output can NEVER reach R2 as "the website"
 *   2. DESIGN PIPELINE: think (AI design brief) → research (live web facts)
 *      → write (AI copy JSON) → render (deterministic premium templates)
 *      with per-stage fallbacks; stage trace + builder labels
 *   3. WEBAPPS: AI document path with truncation retry + signature app
 *      fallback + remote-script sanitizer
 *   4. REFINE: stored plan re-render (version bump, snapshot, same URL),
 *      webapp refine, legacy no-plan path, role/id guards, ?v=N serving
 *   5. SUPABASE: connector verify (good/bad token), vault storage, SQL tool
 *      success/failure/not-connected, manager-only role gate (tool + REST)
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 22+.
 *   node scripts/test_builder_v2.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createSign, createPublicKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'nebula-crm-70f58';

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
        async text() { return typeof o.value === 'string' ? o.value : new TextDecoder().decode(o.value); },
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

/* ── Firebase signing keypair (real RS256, mocked JWKs) ─────────── */
const { publicKey: FB_PUB, privateKey: FB_PRIV } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const FB_JWK = FB_PUB.export({ format: 'jwk' });

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fbToken(uid, { kid = 'test-kid', expiresIn = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: uid,
    iat: now,
    exp: now + expiresIn,
  }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(FB_PRIV);
  return `${head}.${body}.${b64url(sig)}`;
}

/* ── Fetch mock (Sarvam scriptable + Supabase + DDG) ────────────── */
const captured = { supabase: [], sarvam: [] };
const sarvamScript = [];
function sarvamReplyFor(text) {
  for (const s of sarvamScript) if (s.match(text)) return typeof s.reply === 'function' ? s.reply(text) : s.reply;
  throw new Error('sarvam mock: no scripted reply');
}

/* Codegen stages (Agent v7): the agent plans + hand-codes each section. */
const codegenScript = () => [
  { match: (t) => t.includes('Plan its information architecture'), reply: { sections: [
      { id: 'hero', name: 'Home', goal: 'state the promise and win the click', layout: 'Statement hero: oversized display headline, CTA row, trust chips', content_keys: ['kicker', 'headline', 'sub', 'primary_cta', 'secondary_cta', 'hero_badges'], motion: 'staggered rise on load' },
      { id: 'features', name: 'Why us', goal: 'prove it with outcomes', layout: 'Asymmetric two-column: sticky title left, staggered cards right', content_keys: ['features', 'stats'], motion: 'rising blur reveal' },
      { id: 'contact', name: 'Contact', goal: 'convert', layout: 'Split band: CTA headline left, contact list right', content_keys: ['cta_title', 'cta_sub', 'contact', 'primary_cta'], motion: 'band slides up' },
    ], nav: ['hero', 'features', 'contact'] } },
  { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'features', verdict: 'good' }, { id: 'contact', verdict: 'good' }] } },
  { match: (t) => t.includes('HAND-CODING one section'), reply: (t) => {
      const id = /section "sec-([a-z0-9-]+)"/.exec(t)?.[1] || 'hero';
      const headline = (/"headline":"([^"]*)"/.exec(t)?.[1] || `Hand-coded ${id}`).replace(/[<>]/g, '');
      const sub = (/"sub":"([^"]*)"/.exec(t)?.[1] || 'Bespoke section content.').replace(/[<>]/g, '');
      return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><span class="kicker">${id}</span><h2>${headline}</h2><p>${sub}</p><a class="btn btn-accent" href="#sec-contact">Act</a></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:clamp(30px,5vw,54px)}#sec-${id} p{color:var(--muted)}#sec-${id} .btn-accent:hover{transform:translateY(-2px)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'x'.repeat(40)} */</style>` };
    } },
];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  const jsonRes = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  if (u.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) {
    return jsonRes(200, { keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'test-kid', n: FB_JWK.n, e: FB_JWK.e }] });
  }

  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    captured.sarvam.push(text);
    let reply;
    try { reply = sarvamReplyFor(text); } catch (e) { return jsonRes(500, { error: e.message }); }
    const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
    return jsonRes(200, { choices: [{ message: { content }, finish_reason: 'stop' }] });
  }

  // DuckDuckGo html provider (research stage)
  if (u.startsWith('https://html.duckduckgo.com/html')) {
    return new Response(
      `<a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent('https://coffeemarket.example.com/2026')}&rut=x">Coffee market 2026</a>` +
      `<a class="result__snippet" href="#">Specialty coffee demand grew 12% this year.</a>`,
      { status: 200 });
  }

  // Supabase Management API
  if (u.startsWith('https://api.supabase.com/')) {
    const auth = init.headers?.Authorization || '';
    captured.supabase.push({ method, path: u.replace('https://api.supabase.com', ''), auth, body });
    if (u.endsWith('/database/query')) {
      if (!auth.includes('sbp_good')) return jsonRes(401, { message: 'Invalid API key' });
      const q = JSON.parse(body).query || '';
      if (/DROP TABLE/i.test(q)) return new Response('syntax error at or near "DROP"', { status: 400 });
      return jsonRes(200, [{ id: 1, name: 'first order' }]);
    }
    if (/\/v1\/projects\/[^/]+$/.test(u)) {
      if (!auth.includes('sbp_good')) return jsonRes(401, { message: 'Invalid token' });
      return jsonRes(200, { id: 'abcdefg', name: 'Musafir Production' });
    }
    return jsonRes(404, { message: 'not found (supabase mock)' });
  }

  return jsonRes(404, { error: `unmocked fetch: ${method} ${u}` });
};

/* ── Seed data / env ─────────────────────────────────────────────── */
const USERS = [
  { id: 'u_mgr', displayName: 'Asha Rao', role: 'manager', teamId: 'default-team', email: 'asha@team.test' },
  { id: 'u_view', displayName: 'Ria M', role: 'viewer', teamId: 'default-team', email: 'ria@team.test' },
  { id: 'u_rep', displayName: 'Sam P', role: 'salesRep', teamId: 'default-team', email: 'sam@team.test' },
];
const MGR = { uid: 'u_mgr', role: 'manager', displayName: 'Asha Rao', teamId: 'default-team' };
const REP = { uid: 'u_rep', role: 'salesRep', displayName: 'Sam P', teamId: 'default-team' };

async function makeEnv(overrides = {}) {
  const db = makeD1();
  for (const u of USERS) {
    await seedDoc(db, 'users', u.id, { displayName: u.displayName, role: u.role, teamId: u.teamId, email: u.email });
  }
  return {
    DB: db,
    MEDIA: makeR2(),
    FIREBASE_PROJECT_ID: PROJECT_ID,
    SARVAM_API_KEY: 'sarvam_test',
    VAULT_KEY: 'vault-test-key',
    MAIL_BUSINESS_NAME: 'Musafir Coffee',
    MAIL_BRAND_COLOR: '#8a5a2b',
    ...overrides,
  };
}

const CTX = { waitUntil: () => {} };
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const { extractSiteHtml, designBrief, defaultCopy, mergeCopy, applyCtaOverrides } =
  await import('../cloudflare/worker/src/emailer/designer.js');
const { renderSite, normalizeDesign, THEMES } = await import('../cloudflare/worker/src/emailer/site_templates.js');
const { buildWebsite, refineSite, listArtifacts } = await import('../cloudflare/worker/src/emailer/builder.js');
const { runTool, TOOLS } = await import('../cloudflare/worker/src/emailer/assistant.js');
const worker = (await import('../cloudflare/worker/src/index.js')).default;

const env = await makeEnv();
const st = createStore(env);

async function studioFetch(method, path, token, payload) {
  const req = new Request(`https://worker.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  const res = await worker.fetch(req, env, CTX);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { res, json, text };
}

async function serve(id, qs = '') {
  const res = await worker.fetch(new Request(`https://worker.test/sites/${id}${qs}`), env, CTX);
  return { res, text: await res.text() };
}

/* ══ 1. Extraction gate ══════════════════════════════════════════ */
console.log('\n— 1. Extraction gate (the screenshots bug) —');
{
  const good = '<!DOCTYPE html><html><head><title>T</title></head><body>' + 'x'.repeat(500) + '</body></html>';

  const fenced = extractSiteHtml('```html\n' + good + '\n```\nWant it on GitHub, Vercel or your own domain?');
  ok(!!fenced.html && !fenced.html.includes('```') && !fenced.html.includes('Want it on GitHub'),
    'fence + trailing chatter stripped — only the document survives');

  const prosed = extractSiteHtml('Here is your site:\n\n' + good + '\n\nLet me know if you want changes!');
  ok(!!prosed.html && !prosed.html.includes('Let me know'), 'prose before/after the document removed');

  const trunc = extractSiteHtml('<!DOCTYPE html><html><head><title>T</title></head><body>' + 'y'.repeat(600));
  ok(!!trunc.error && /truncated/.test(trunc.error), 'truncated document (no </html>) is REJECTED, never saved');

  const noDoc = extractSiteHtml('I would build you a great site but here is a plan instead…');
  ok(!!noDoc.error && /no HTML document/.test(noDoc.error), 'fenceless chatter → rejected');

  const tiny = extractSiteHtml(good.replace('x'.repeat(500), 'x'.repeat(10)));
  ok(!!tiny.error, 'tiny fragments rejected');

  ok(!!extractSiteHtml(good).html, 'clean document passes untouched');
}

/* ══ 2. Design pipeline ══════════════════════════════════════════ */
console.log('\n— 2. Designer: think → research → write → render —');
{
  // defaultCopy + merge + CTA overrides
  const base = defaultCopy({ kind: 'landing', title: 'Musafir Coffee', brief: 'A cozy specialty coffee shop. Single-origin pours. Weekend cupping sessions.', brand: { name: 'Musafir Coffee', color: '#8a5a2b', contactEmail: 'hi@musafir.test' } });
  ok(base.headline === 'Musafir Coffee' && base.features.length >= 2 && base.primary_cta.href.includes('mailto:'),
    'defaultCopy builds a complete page from the brief alone');
  const merged = mergeCopy({ headline: '', features: [{ icon: '☕', title: 'Real copy', text: 'AI words' }] }, base);
  ok(merged.headline === base.headline && merged.features[0].title === 'Real copy',
    'mergeCopy keeps defaults for empty AI fields, uses non-empty ones');
  const cta = applyCtaOverrides(merged, { cta_text: 'Order on WhatsApp', cta_url: 'https://wa.me/91123' });
  ok(cta.primary_cta.label === 'Order on WhatsApp' && cta.primary_cta.href === 'https://wa.me/91123', 'CTA overrides applied');

  // designBrief: AI path with research queries
  sarvamScript.length = 0;
  sarvamScript.push({
    match: (t) => t.includes('design director'),
    reply: { theme: 'luxe', palette: { bg: '#0c0b09', accent: '#d3aa5e' }, font: 'serif', voice: 'quiet luxury', audience: 'coffee connoisseurs', headline_angle: 'Single-origin, slow-poured', must_have: ['origin story'], research_queries: ['specialty coffee market india 2026'] },
  });
  const thought = await designBrief(env, { kind: 'landing', brief: 'Specialty coffee shop in Mumbai', style: '', brand: { name: 'Musafir Coffee', color: '#8a5a2b', profile: { industry: 'cafes' } } });
  ok(thought.ai === true && thought.design.theme === 'luxe' && thought.queries.length === 1,
    'designBrief: AI art direction with research queries', JSON.stringify(thought.design.theme));

  // researchFacts hits the mocked DDG html provider
  const { researchFacts } = await import('../cloudflare/worker/src/emailer/designer.js');
  const facts = await researchFacts(['specialty coffee market india 2026']);
  ok(facts.includes('MARKET FACTS') && facts.includes('grew 12%'), 'researchFacts returns live web facts');

  // renderSite sanity across kinds × themes (deterministic engine)
  let allValid = true;
  for (const kind of ['landing', 'promo', 'event', 'portfolio', 'report']) {
    for (const theme of Object.keys(THEMES)) {
      const d = normalizeDesign({ theme }, { kind, styleHint: '', brandColor: '#8a5a2b' });
      const html = renderSite({ kind, design: d, content: base, brand: { name: 'Musafir Coffee', color: '#8a5a2b' } });
      if (!html.startsWith('<!DOCTYPE html>') || !html.includes('</html>') || !html.includes('<title>Musafir Coffee</title>')) allValid = false;
    }
  }
  ok(allValid, `renderSite: 30 theme×kind combinations all produce complete documents`);
}

/* ══ 3. Full build pipeline ══════════════════════════════════════ */
console.log('\n— 3. buildWebsite v2 end-to-end —');
let siteId = '';
let sig = { artifact_id: '' };
{
  sarvamScript.length = 0;
  sarvamScript.push(
    ...codegenScript(),
    // Agent v8: the Lead orchestrator plans the run first
    { match: (t) => t.includes('elite multi-agent web studio'), reply: { audience: 'coffee lovers in mumbai', research_focus: 'mumbai cafe market', queries: ['mumbai specialty coffee trend'], sections_target: 4, emphasis: ['menu tactile'], risks: ['generic cafe look'], tone_note: 'warm, specific, sensory' } },
    { match: (t) => t.includes('Decide the design direction'), reply: { theme: 'aurora', palette: { accent: '#c07a3d' }, font: 'modern', voice: 'cozy premium', audience: 'coffee lovers', headline_angle: 'Single-origin, slow-poured', must_have: [], research_queries: ['mumbai specialty coffee trend'] } },
    { match: (t) => t.includes('conversion copywriter'), reply: { title: 'Musafir Coffee', kicker: 'Mumbai', headline: 'Coffee worth the trip', sub: 'Single-origin pours and weekend cuppings at Musafir.', primary_cta: { label: 'Find us', href: 'mailto:hi@musafir.test' }, features: [{ icon: '☕', title: 'Single origin', text: 'Beans from Coorg estates, roasted weekly.' }, { icon: '🥐', title: 'Fresh bakes', text: 'Croissants at 8am sharp.' }], contact: { email: 'hi@musafir.test' } } },
  );

  const res = await buildWebsite(env, st, MGR,
    { title: 'Musafir Coffee', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours and weekend cupping sessions.' },
    'https://worker.test');
  ok(res.ok === true && res.builder === 'ai', 'AI codegen build succeeds with builder=ai', JSON.stringify(res).slice(0, 200));
  siteId = res.artifact_id;
  ok(/^https:\/\/worker\.test\/sites\/s_[a-z0-9]+$/.test(res.url || ''), 'returns the public URL', res.url);
  ok(res.version === 1, 'first build is version 1');
  const stages = res.stages.map((s) => s.stage);
  ok(stages[0] === 'lead' && stages.includes('think') && stages.includes('research') && stages.includes('write') && stages.includes('plan') && stages.includes('wire'),
    'stage trace: lead → think → research → write → plan → code → wire', JSON.stringify(stages));
  ok(stages.filter((s) => String(s).startsWith('code:')).length === 3, 'three sections hand-coded (hero, features, contact)', JSON.stringify(stages));
  ok(res.stages.find((s) => s.stage === 'research')?.ai === true, 'research stage actually used the live web');
  ok(res.stages.find((s) => s.stage === 'plan')?.ai === true, 'plan stage was a real AI call');
  ok(Array.isArray(res.team) && ['Lead', 'Researcher', 'Art Director', 'Copywriter', 'Architect', 'Engineer', 'QA Director', 'Builder'].every((a) => res.team.some((r) => r.agent === a)),
    'multi-agent team trace in the response (v8)', JSON.stringify((res.team || []).map((r) => r.agent)));
  ok(res.team_summary?.ai_calls >= 8 && res.team_summary?.agents >= 8, `team summary honest (${JSON.stringify(res.team_summary)})`);

  const page = await serve(siteId);
  ok(page.res.status === 200 && page.text.includes('Coffee worth the trip'), 'served page carries the AI copy');
  ok(!page.text.includes('```') && !page.text.includes('MARKET FACTS'), 'no fences or research scaffolding leak to the page');
  ok(page.text.includes('IntersectionObserver') && page.text.includes('data-rev'), 'wired page ships the reveal motion system');
  ok(page.text.includes('site-nav') && page.text.includes('site-footer'), 'nav + footer chrome present');
  ok(!!await env.MEDIA.get(`agent:siteplan:${siteId}`) === false, 'plan NOT in R2 (lives in state store)');

  const planRaw = await st.get(`agent:siteplan:${siteId}`);
  const plan = JSON.parse(planRaw);
  ok(plan?.design?.theme === 'aurora' && Array.isArray(plan.content.features), 'site plan stored for refine', planRaw.slice(0, 80));
  ok(plan?.engine === 'codegen' && Array.isArray(plan.sections) && plan.sections.length === 3, 'plan records the codegen engine + section architecture');

  // CTA override path
  const res2 = await buildWebsite(env, st, MGR,
    { title: 'Promo', kind: 'promo', brief: 'Diwali gift hampers at twenty percent off this week only. Order by Friday.', cta_text: 'Order on WhatsApp', cta_url: 'https://wa.me/91123' },
    'https://worker.test');
  const page2 = await serve(res2.artifact_id);
  ok(page2.text.includes('Order on WhatsApp') && page2.text.includes('wa.me/91123'), 'CTA overrides reach the rendered page');

  // Full fallback: no scripted replies → sarvam 500s everywhere →
  // codegen fails → deterministic signature render (engine safety net)
  sarvamScript.length = 0;
  const fb = await buildWebsite(env, st, MGR,
    { title: 'Fallback Page', kind: 'landing', brief: 'A quiet bookstore for people who read slowly. Poetry nights on Fridays.' }, 'https://worker.test');
  ok(fb.ok === true && fb.builder === 'signature', 'total AI outage still ships (signature engine fallback)', JSON.stringify({ builder: fb.builder }));
  ok(fb.stages.some((s) => s.stage === 'render' && /fallback/.test(s.detail)), 'fallback stage trace is honest');
  const fbPage = await serve(fb.artifact_id);
  ok(fbPage.text.includes('Fallback Page') && fbPage.text.includes('</html>'), 'fallback page complete');
}

/* ══ 4. Webapp path ══════════════════════════════════════════════ */
console.log('\n— 4. Webapp builds: AI, truncation retry, signature —');
{
  const appDoc = '<!DOCTYPE html><html><head><title>Tip Tracker</title></head><body><h1>Tips</h1>' + 'z'.repeat(500) + '<script>localStorage.setItem("tips","1")</script></body></html>';
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('single-file web app'), reply: { __raw: appDoc } });
  const app = await buildWebsite(env, st, REP, { title: 'Tip Tracker', kind: 'webapp', brief: 'Field team tip tracker that works offline.' }, 'https://worker.test');
  ok(app.ok === true && app.builder === 'ai', 'webapp AI path');
  ok((await serve(app.artifact_id)).text.includes('localStorage'), 'webapp keeps inline scripts');

  // Truncation → the builder retries once with a smaller instruction, and
  // when the model still cannot finish a document → signature app ships.
  sarvamScript.length = 0;
  sarvamScript.push({ match: () => true, reply: { __raw: '<!DOCTYPE html><html><head><title>Big</title></head><body>' + 'q'.repeat(900) } });
  sig = await buildWebsite(env, st, REP, { title: 'Offline Notes', kind: 'webapp', brief: 'Notes app for the field team.' }, 'https://worker.test');
  ok(sig.ok === true && sig.builder === 'signature', 'truncated webapp → signature app still ships', JSON.stringify({ builder: sig.builder }));
  const sigPage = await serve(sig.artifact_id);
  ok(sigPage.text.includes('localStorage') && sigPage.text.includes('Offline Notes'), 'signature app is a real offline tracker');
}

/* ══ 5. Refine ═══════════════════════════════════════════════════ */
console.log('\n— 5. refine_site (versions, snapshots, guards) —');
{
  const before = await listArtifacts(st, 'u_mgr');
  const beforeDoc = before.find((a) => a.id === siteId);

  sarvamScript.length = 0;
  sarvamScript.push(
    ...codegenScript(),
    {
      match: (t) => t.includes('updating the content'),
      reply: { title: 'Musafir Coffee', headline: 'The best cup in Mumbai', sub: 'Updated tagline for the refine test.', features: [{ icon: '☕', title: 'Single origin', text: 'Still Coorg beans.' }] },
    },
  );
  const r = await refineSite(env, st, MGR, { artifact_id: siteId, instruction: 'Punch up the headline, keep everything else' }, 'https://worker.test');
  ok(r.ok === true && r.version === 2, 'refine bumps to version 2', JSON.stringify({ v: r.version }));
  ok(r.url === `https://worker.test/sites/${siteId}`, 'same public URL after refine');

  const page = await serve(siteId);
  ok(page.text.includes('The best cup in Mumbai'), 'latest version serves the RE-CODED refined copy');
  ok(!page.text.includes('Coffee worth the trip'), 'old headline gone from latest');
  ok(page.text.includes('data-rev'), 'refined page is still hand-coded (motion system intact)');

  const v1 = await serve(siteId, '?v=1');
  ok(v1.res.status === 200 && v1.text.includes('Coffee worth the trip'), '?v=1 still serves the original snapshot');
  ok(!!env.MEDIA.__map.get(`sites/${siteId}.v1.html`), 'previous version snapshotted in R2');

  const afterDoc = (await listArtifacts(st, 'u_mgr')).find((a) => a.id === siteId);
  ok(afterDoc.version === 2 && Array.isArray(afterDoc.versions) && afterDoc.versions.length === 2,
    'registry carries version history');
  ok(afterDoc.last_refine === 'Punch up the headline, keep everything else', 'registry remembers the last instruction');

  // webapp refine → AI rebuild path
  const webappId = sig.artifact_id;
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('single-file web app'), reply: { __raw: '<!DOCTYPE html><html><head><title>Notes v2</title></head><body><h1>Notes</h1>' + 'w'.repeat(500) + '<script>var ok=1</script></body></html>' } });
  const wr = await refineSite(env, st, REP, { artifact_id: webappId, instruction: 'Add dark mode toggle' }, 'https://worker.test');
  ok(wr.ok === true && wr.version === 2, 'webapp refine rebuilds as v2');
  ok((await serve(webappId)).text.includes('Notes v2'), 'refined webapp served');

  // Guards
  const missing = await refineSite(env, st, MGR, { artifact_id: 's_ghost', instruction: 'make it pop' }, 'https://worker.test');
  ok(missing.ok === false && /not found/.test(missing.error), 'unknown artifact rejected');
  const note = await import('../cloudflare/worker/src/emailer/builder.js').then((m) => m.saveNote(st, MGR, { title: 'Note', content: 'A '.repeat(100) }));
  const noteRef = await refineSite(env, st, MGR, { artifact_id: note.artifact_id, instruction: 'make it pop' }, 'https://worker.test');
  ok(noteRef.ok === false && /notes cannot be refined/.test(noteRef.error), 'notes are not refinable');
  const short = await refineSite(env, st, MGR, { artifact_id: siteId, instruction: '' }, 'https://worker.test');
  ok(short.ok === false, 'empty instruction rejected');
}

/* ══ 6. Supabase connector + SQL tool ════════════════════════════ */
console.log('\n— 6. Supabase: connect, verify, SQL —');
{
  const bad = await runTool({ tool: 'connect_platform', args: { connector: 'supabase', access_token: 'sbp_bad', project_ref: 'abcdefg' } }, env, st, MGR, CTX);
  ok(bad.ok === false && /rejected/.test(bad.error), 'bad Supabase token rejected before storing', bad.error);

  const good = await runTool({ tool: 'connect_platform', args: { connector: 'supabase', access_token: 'sbp_good', project_ref: 'abcdefg.supabase.co' } }, env, st, MGR, CTX);
  ok(good.ok === true && good.verified_as === 'Musafir Production', 'connect verifies and stores the project identity', JSON.stringify(good));

  const sqlNo = await runTool({ tool: 'supabase_sql', args: { query: 'SELECT 1' } }, env, st, REP, CTX);
  ok(sqlNo.ok === false && /manager can do this/.test(sqlNo.error), 'salesRep denied supabase_sql (role gate)', sqlNo.error);

  const sql = await runTool({ tool: 'supabase_sql', args: { query: 'CREATE TABLE orders (id int); SELECT * FROM orders;' } }, env, st, MGR, CTX);
  ok(sql.ok === true && Array.isArray(sql.rows) && sql.rows[0]?.name === 'first order', 'supabase_sql executes through the Management API', JSON.stringify(sql).slice(0, 300));

  const sqlFail = await runTool({ tool: 'supabase_sql', args: { query: 'DROP TABLE users' } }, env, st, MGR, CTX);
  ok(sqlFail.ok === false && /SQL failed/.test(sqlFail.error), 'SQL errors surfaced honestly', sqlFail.error?.slice(0, 60));

  const sqlMissing = await runTool({ tool: 'supabase_sql', args: {} }, env, st, MGR, CTX);
  ok(sqlMissing.ok === false && /required/.test(sqlMissing.error), 'empty query rejected');

  // REST: manager connects via /v1/studio/connect; viewer denied refine
  const restConnect = await studioFetch('POST', '/v1/studio/connect', fbToken('u_mgr'), { connector: 'supabase', access_token: 'sbp_good', project_ref: 'abcdefg' });
  ok(restConnect.res.status === 200 && restConnect.json.ok === true, 'REST connect supabase ok');

  // salesRef refines their OWN artifact (per-user registry isolation: another
  // user's artifact reads as not-found, which the guards section covers)
  const repRefine = await studioFetch('POST', '/v1/studio/refine', fbToken('u_rep'), { artifact_id: sig.artifact_id, instruction: 'add a summary screen' });
  ok(repRefine.res.status === 200 && repRefine.json.ok === true, 'salesRep can refine their own build (WRITE_ROLES)', JSON.stringify(repRefine.json).slice(0, 160));
  ok(repRefine.json.version === 3, 'refine chain reaches v3', String(repRefine.json.version));

  const viewRefine = await studioFetch('POST', '/v1/studio/refine', fbToken('u_view'), { artifact_id: siteId, instruction: 'tighten the copy' });
  ok(viewRefine.res.status === 403, 'viewer denied refine (REST role gate)');
}

/* ══ Summary ═════════════════════════════════════════════════════ */
console.log(`\n════════════════════════════════════════`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log('All builder-v2 tests green.');
