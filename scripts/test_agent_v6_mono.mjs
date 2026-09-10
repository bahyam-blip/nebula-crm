#!/usr/bin/env node
/**
 * Tests for the MONO wave (Agent v6):
 *   1. SKILLS LIBRARY — seeded expertise, learn_skill (create/sharpen/
 *      dedupe/cap), forget_skill, skillsForDomain packing + budget
 *   2. GUARD — hourly rate limits (build/refine/search/...) + sha256Hex
 *   3. POLISH LOOP — director self-critique (verdict good / improve→merge)
 *   4. INTEGRITY — sha256 in R2 metadata + artifact records + versions;
 *      X-Content-Sha256 header on served sites; GET /sites/<id>/meta
 *   5. TOOLS — registry at 33, new tools (plan_task/list_skills/learn_skill),
 *      role gates (viewer: reads-only + learn_skill denied), plan_task teach
 *   6. MCP — schemas/descriptions for the 3 new tools
 *   7. PUBLIC /connect — page renders with the MCP endpoint + security model
 *   8. SITE ENGINE v3 — onyx/neo themes, Google Fonts links, grain, bento,
 *      marquee, wordmark, SVG art, onyx monochrome discipline
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 22+.
 *   node scripts/test_agent_v6_mono.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));

/* ── D1 stand-in ─────────────────────────────────────────────────── */
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

/* ── R2 stand-in with head() + customMetadata ───────────────────── */
function makeR2() {
  const m = new Map();
  return {
    __map: m,
    async put(key, value, opts = {}) {
      m.set(key, { value, opts, customMetadata: opts.customMetadata || {}, httpMetadata: opts.httpMetadata || {}, uploaded: new Date(), size: typeof value === 'string' ? value.length : String(value).length });
      return { key };
    },
    async get(key) {
      const o = m.get(key);
      if (!o) return null;
      return {
        body: o.value, customMetadata: o.customMetadata, size: o.size,
        async text() { return typeof o.value === 'string' ? o.value : new TextDecoder().decode(o.value); },
        writeHttpMetadata(h) { h.set('Content-Type', o.httpMetadata?.contentType || 'application/octet-stream'); },
        httpEtag: '"shim"',
      };
    },
    async head(key) {
      const o = m.get(key);
      if (!o) return null;
      return { customMetadata: o.customMetadata, size: o.size, uploaded: o.uploaded, httpMetadata: o.httpMetadata };
    },
    async delete(key) { m.delete(key); },
  };
}

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

/* ── Fetch mock: Sarvam scripted, DDG minimal ───────────────────── */
const sarvamScript = [];
const sarvamSeen = [];
function script(match, reply) { sarvamScript.push({ match, reply }); }
function sarvamReplyFor(text) {
  for (const s of sarvamScript) if (s.match(text)) return typeof s.reply === 'function' ? s.reply(text) : s.reply;
  throw new Error('sarvam mock: no scripted reply');
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const jsonRes = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(init.body || '{}');
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    sarvamSeen.push(text);
    let reply;
    try { reply = sarvamReplyFor(text); } catch { return jsonRes(500, { error: 'no script' }); }
    const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
    return jsonRes(200, { choices: [{ message: { content }, finish_reason: 'stop' }] });
  }
  if (u.startsWith('https://html.duckduckgo.com/')) {
    return new Response(`<a class="result__a" href="https://duckduckgo.com/l/?uddg=${encodeURIComponent('https://trend.example.com/x')}&rut=x">Trend</a><a class="result__snippet" href="#">Whitespace is the breath of design.</a>`, { status: 200 });
  }
  return jsonRes(404, { error: `unmocked fetch: ${u}` });
};

/* ── env + users ────────────────────────────────────────────────── */
const USERS = [
  { id: 'u_mgr', displayName: 'Asha Rao', role: 'manager', teamId: 'default-team', email: 'asha@team.test' },
  { id: 'u_view', displayName: 'Ria M', role: 'viewer', teamId: 'default-team', email: 'ria@team.test' },
];
const MGR = { uid: 'u_mgr', role: 'manager', displayName: 'Asha Rao', teamId: 'default-team' };
const VIEW = { uid: 'u_view', role: 'viewer', displayName: 'Ria M', teamId: 'default-team' };

async function makeEnv() {
  const db = makeD1();
  for (const u of USERS) {
    const now = Date.now();
    await db.prepare(
      `INSERT INTO docs (col, id, team_id, json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(col, id) DO UPDATE SET json = excluded.json`
    ).bind('users', u.id, u.teamId, JSON.stringify({ displayName: u.displayName, role: u.role, teamId: u.teamId, email: u.email }), now, now).run();
  }
  return {
    DB: db,
    MEDIA: makeR2(),
    SARVAM_API_KEY: 'sarvam_test',
    VAULT_KEY: 'vault-test-key',
    MAIL_BUSINESS_NAME: 'Musafir Coffee',
    MAIL_BRAND_COLOR: '#8a5a2b',
    AGENT_APPROVAL_MODE: 'off',
  };
}

const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const { SEED_SKILLS, learnSkill, forgetSkill, listSkills, skillsForDomain, slugify } = await import('../cloudflare/worker/src/emailer/skills.js');
const { rateLimit, LIMITS, sha256Hex } = await import('../cloudflare/worker/src/emailer/guard.js');
const { TOOLS, runTool } = await import('../cloudflare/worker/src/emailer/assistant.js');
const { TOOL_SCHEMAS } = await import('../cloudflare/worker/src/emailer/mcp.js');
const { buildWebsite, refineSite, serveAgentSite } = await import('../cloudflare/worker/src/emailer/builder.js');
const { renderSite, normalizeDesign, THEMES } = await import('../cloudflare/worker/src/emailer/site_templates.js');

const CTX = { waitUntil: () => {} };
const env = await makeEnv();
const store = createStore(env);

/* ══ 1. SKILLS LIBRARY ═══════════════════════════════════════════ */
section('SKILLS LIBRARY');
ok(SEED_SKILLS.length >= 10, `seeded expertise present (${SEED_SKILLS.length} skills)`);
ok(SEED_SKILLS.every((s) => s.slug && s.title && s.body && s.domain), 'every seed has slug/title/body/domain');
ok(SKILL_DOMAIN_GUARD(), 'domains constrained to the 7 known values');

function SKILL_DOMAIN_GUARD() {
  const known = new Set(['design', 'layout', 'motion', 'copy', 'ux', 'engineering', 'marketing']);
  return SEED_SKILLS.every((s) => known.has(s.domain));
}

const lib0 = await listSkills(store, MGR.uid);
ok(lib0.seeded.length === SEED_SKILLS.length && lib0.learned.length === 0, 'library starts seeded-only');

const learn1 = await learnSkill(store, MGR.uid, { title: 'Cafe hero patterns', domain: 'design', body: 'Lead with the sensory promise in 4-6 words; one dish hero; hours strip above the fold; menu as bento, never a PDF link.' });
ok(learn1.ok === true && learn1.updated === false, 'learn_skill creates a new skill');
const learn2 = await learnSkill(store, MGR.uid, { title: 'cafe hero patterns', domain: 'layout', body: 'Improved rule: pair the hero with a split art panel and move the CTA above the fold on mobile.' });
ok(learn2.ok === true && learn2.updated === true && learn2.slug === learn1.slug, 're-learning same slug SHARPENS the skill');
const learnBad = await learnSkill(store, MGR.uid, { title: 'Too short', domain: 'design', body: 'nope' });
ok(learnBad.ok === false, 'learn_skill rejects thin bodies');
const learnX = await learnSkill(store, MGR.uid, { title: 'X domain skill', domain: 'notadomain', body: 'A body long enough to pass validation for the domain check test.' });
ok(learnX.ok === true && learnX.domain === 'design', 'unknown domain falls back to design');

for (let i = 0; i < 45; i++) {
  await learnSkill(store, MGR.uid, { title: `Filler skill number ${i}`, domain: 'copy', body: `Filler body ${i} — distilled rule text that is definitely long enough to pass.` });
}
const lib1 = await listSkills(store, MGR.uid);
ok(lib1.learned.length <= 40, `learned library capped at 40 (got ${lib1.learned.length})`);
// The cap keeps the 40 NEWEST skills — the earliest learns were evicted.
// Re-teach the cafe skill so it survives, then forget a survivor.
const relearn = await learnSkill(store, MGR.uid, { title: 'Cafe hero patterns', domain: 'design', body: 'Re-learned after the cap test: lead with the sensory promise; one dish hero; hours above the fold; menu as bento.' });
ok(relearn.ok === true && relearn.updated === false && relearn.slug === 'cafe-hero-patterns', 'evicted skill can be re-taught (fresh learn)');
const forget = await forgetSkill(store, MGR.uid, { slug: 'filler-skill-number-44' });
ok(forget.ok === true, 'forget_skill removes a learned skill');
const forgetSeed = await forgetSkill(store, MGR.uid, { slug: 'visual-hierarchy' });
ok(forgetSeed.ok === false, 'seeded skills cannot be forgotten');

const pack = await skillsForDomain(store, MGR.uid, 'design', { maxChars: 1200 });
ok(pack.block.startsWith('EXPERT SKILL PACK'), 'skillsForDomain returns a prompt block');
ok(pack.block.length <= 1400, `skill pack respects the char budget (${pack.block.length})`);
ok(pack.skills.some((s) => s.includes('Cafe hero patterns')), 'learned design skill is packed first');
ok(pack.skills.some((s) => s.includes('Visual hierarchy')), 'seeded design skills still packed');
const packCopy = await skillsForDomain(store, MGR.uid, 'copy', { maxChars: 500 });
ok(!packCopy.skills.some((s) => s.includes('Cafe hero patterns')), 'foreign-domain learned skill yields to copy skills');

/* ══ 2. GUARD ════════════════════════════════════════════════════ */
section('GUARD — rate limits + integrity hashing');
ok(LIMITS.build_website.perHour === 12, 'build limit is 12/hour');
const rlStore = new Map();
const kvStore = { async get(k) { return rlStore.get(k) ?? null; }, async put(k, v) { rlStore.set(k, v); } };
let blocked = null;
for (let i = 0; i < 13; i++) blocked = await rateLimit(kvStore, 'u_x', 'build_website');
ok(blocked.ok === false && /hourly limit/.test(blocked.error), '13th build in the window is blocked');
ok((await rateLimit(kvStore, 'u_other', 'build_website')).ok === true, 'limits are per-uid');
const openRl = await rateLimit(null, 'u_x', 'build_website');
ok(openRl.ok === true, 'no store → open (non-production tests pass)');
const dig = await sha256Hex('nebula');
ok(/^[0-9a-f]{64}$/.test(dig) && dig === (await sha256Hex('nebula')) && dig !== (await sha256Hex('nebula2')), 'sha256Hex deterministic + hex');

/* ══ 3+4. BUILD PIPELINE — skills, polish, integrity ═════════════ */
section('BUILD v3 — skills injected + polish loop + integrity');
sarvamScript.length = 0;

/* Codegen stages (Agent v7): plan + hand-coded sections + review. */
const codegenScript = () => {
  script((t) => t.includes('Plan its information architecture'), { sections: [
    { id: 'hero', name: 'Home', goal: 'state the promise', layout: 'Statement hero with oversized headline and CTA row', content_keys: ['kicker', 'headline', 'sub', 'primary_cta', 'secondary_cta', 'hero_badges', 'marquee'], motion: 'staggered rise' },
    { id: 'features', name: 'Why us', goal: 'prove it', layout: 'Asymmetric card grid', content_keys: ['features', 'stats'], motion: 'scroll reveal' },
    { id: 'contact', name: 'Contact', goal: 'convert', layout: 'Split band', content_keys: ['cta_title', 'cta_sub', 'contact', 'primary_cta'], motion: 'slide up' },
  ], nav: ['hero', 'features', 'contact'] });
  script((t) => t.includes('reviewing hand-coded sections'), { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'features', verdict: 'good' }, { id: 'contact', verdict: 'good' }] });
  script((t) => t.includes('HAND-CODING one section'), (t) => {
    const id = /section "sec-([a-z0-9-]+)"/.exec(t)?.[1] || 'hero';
    const headline = (/"headline":"([^"]*)"/.exec(t)?.[1] || `Hand-coded ${id}`).replace(/[<>]/g, '');
    const sub = (/"sub":"([^"]*)"/.exec(t)?.[1] || 'Bespoke section content.').replace(/[<>]/g, '');
    const titles = [...t.matchAll(/"title":"([^"]*)"/g)].map((m) => m[1].replace(/[<>]/g, '')).slice(0, 8);
    const list = titles.length ? `<ul>${titles.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
    return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><span class="kicker">${id}</span><h2>${headline}</h2><p>${sub}</p>${list}<a class="btn btn-accent" href="#sec-contact">Act</a></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:clamp(30px,5vw,54px)}#sec-${id} .btn-accent:hover{transform:translateY(-2px)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'m'.repeat(40)} */</style>` };
  });
};
const designReply = {
  theme: 'onyx', hero: 'split', art: 'rings',
  palette: { bg: '#050505', surface: '#0d0d0d', ink: '#f5f5f5', muted: '#8f8f8f', accent: '#ffffff', accent2: '#8f8f8f' },
  font: 'grotesk', voice: 'quiet confidence', audience: 'design-led founders',
  headline_angle: 'Websites that feel engineered', must_have: ['proof strip', 'process bento'],
  research_queries: ['studio portfolio trends 2026'],
};
// NOTE: matcher order matters — the POLISH prompt also says "design
// director", so the FINAL-review script must come first and the design
// script must exclude it.
script((t) => t.includes('FINAL review'), { verdict: 'improve', content: { headline: 'Sites that feel engineered to sell', sub: 'A studio shipping fast, minimal, conversion-first sites in seven days.' } });
script((t) => t.includes('design director') && !t.includes('FINAL review'), designReply);
script((t) => t.includes('conversion copywriter'), {
  title: 'Vega Studio', kicker: 'Vega', headline: 'Websites that feel engineered',
  sub: 'A studio that ships fast, minimal, conversion-first sites.', marquee: ['Strategy', 'Design', 'Engineering'],
  primary_cta: { label: 'Start a project', href: 'mailto:hi@vega.test' }, hero_badges: ['12 launches'],
  features: [{ icon: '◆', title: 'Ships in 7 days', text: 'One page, done.' }, { icon: '◇', title: 'Conversion-first', text: 'Proof above the fold.' }, { icon: '○', title: 'Yours forever', text: 'Code delivered.' }],
  contact: { email: 'hi@vega.test' }, footer_note: 'Built by Vega',
});
codegenScript();

const build1 = await buildWebsite(env, store, MGR, {
  kind: 'landing', brief: 'A premium dark portfolio for Vega Studio, minimal and engineered, for design-led founders.', title: 'Vega Studio',
}, 'https://nebula.test');
ok(build1.ok === true, 'build succeeds end-to-end');
ok(build1.stages.some((s) => s.stage === 'polish' && s.ai === true), 'polish stage applied the director pass');
ok(build1.stages.some((s) => s.stage === 'wire'), `wire stage assembles the hand-coded sections (${build1.stages.at(-1)?.detail})`);
ok(build1.stages.filter((s) => String(s.stage).startsWith('code:')).length === 3, 'three sections hand-coded');
ok(/^[0-9a-f]{64}$/.test(build1.sha256 || ''), 'build returns sha256 digest');
ok(build1.stages.length === 10, `stage trace: think/research/write/polish/plan/code×3/review/wire (${build1.stages.length})`);

// Sarvam received the skill pack + polish budget respected
ok(sarvamSeen.some((t) => t.includes('EXPERT SKILL PACK') && t.includes('Cafe hero patterns')), 'design prompt carried the learned skill pack');
ok(
  sarvamSeen.some((t) => t.includes('design director') && t.includes('onyx') && t.includes('"hero"') && t.includes('"art"')),
  'design prompt teaches the 8 themes + hero/art schema'
);

// R2 customMetadata + artifact record + versions carry the digest
const r2obj = env.MEDIA.__map.get(`sites/${build1.artifact_id}.html`);
ok(r2obj?.customMetadata?.sha256 === build1.sha256, 'R2 customMetadata carries sha256');

// Serving: header + meta endpoint
{
  const req = new Request(`https://nebula.test/sites/${build1.artifact_id}`);
  const res = await serveAgentSite(req, env, `/sites/${build1.artifact_id}`);
  const html = await res.text();
  ok(res.status === 200 && html.startsWith('<!DOCTYPE html>'), 'served site is a clean document');
  ok(res.headers.get('X-Content-Sha256') === build1.sha256, 'X-Content-Sha256 header matches digest');
  ok(res.headers.get('X-Nebula-Artifact') === build1.artifact_id, 'X-Nebula-Artifact header present');
  ok(html.includes('fonts.googleapis.com'), 'served page loads real typography');
  ok(html.includes('feTurbulence'), 'served page carries film grain');
  ok(html.includes('Sites that feel engineered to sell'), 'polished headline is what ships');

  const mreq = new Request(`https://nebula.test/sites/${build1.artifact_id}/meta`);
  const mres = await serveAgentSite(mreq, env, `/sites/${build1.artifact_id}/meta`);
  const meta = await mres.json();
  ok(mres.status === 200 && meta.sha256 === build1.sha256 && meta.kind === 'landing', '/sites/<id>/meta exposes integrity');
  const m404 = await serveAgentSite(new Request('https://nebula.test/sites/s_missing/meta'), env, '/sites/s_missing/meta');
  ok(m404.status === 404, 'meta for unknown id → 404');
}

// Polish "good" verdict path
sarvamScript.length = 0;
script((t) => t.includes('FINAL review'), { verdict: 'good' });
script((t) => t.includes('design director') && !t.includes('FINAL review'), { ...designReply, theme: 'aurora', hero: 'centered', art: 'mesh' });
script((t) => t.includes('conversion copywriter'), { title: 'T', headline: 'Good enough already', sub: 'Fine sub.', features: [{ icon: 'x', title: 'A', text: 'B.' }] });
codegenScript();
const build2 = await buildWebsite(env, store, MGR, { kind: 'landing', brief: 'A cozy bakery landing page fordaily fresh bakes and custom cakes.' }, 'https://nebula.test');
ok(build2.ok === true && build2.stages.some((s) => s.stage === 'polish' && s.ai === false && /passed review/.test(s.detail)), 'polish verdict=good leaves copy untouched');

// Rate limit integration: exhaust builds for a fresh uid, expect a guard error
const freshStore = createStore(await makeEnv());
let last = null;
for (let i = 0; i < 12; i++) last = await rateLimit(freshStore, 'u_rl', 'build_website');
ok(last.ok === true && last.remaining === 0, '12 builds consume the whole window');
const buildBlocked = await buildWebsite(await makeEnv(), freshStore, { uid: 'u_rl', role: 'manager', displayName: 'RL' }, { kind: 'landing', brief: 'This one should be blocked by the hourly build guard.' }, '');
ok(buildBlocked.ok === false && buildBlocked.rateLimited === true, 'build_website enforces the hourly cap end-to-end');

/* ══ 5. TOOLS — registry, roles, plan ════════════════════════════ */
section('TOOLS — 33 registry, role gates, plan_task');
ok(Object.keys(TOOLS).length === 33, `registry has 33 tools (${Object.keys(TOOLS).length})`);
ok(TOOLS.plan_task?.tier === 'read' && TOOLS.list_skills?.tier === 'read', 'plan_task + list_skills are read-tier');
ok(Array.isArray(TOOLS.learn_skill?.roles) && TOOLS.learn_skill.roles.includes('salesRep') && !TOOLS.learn_skill.roles.includes('viewer'), 'learn_skill is write-gated (viewer denied)');

const plan = await runTool({ tool: 'plan_task', args: { goal: 'Launch Vega site', steps: ['research market', 'build the page', 'queue announcement email'], risk: 'Sarvam latency' } }, env, store, MGR, CTX);
ok(plan.ok === true && plan.steps.length === 3, 'plan_task returns the locked plan');
const planBad = await runTool({ tool: 'plan_task', args: { goal: 'x', steps: ['one'] } }, env, store, MGR, CTX);
ok(planBad.ok === false, 'plan_task needs a real goal + 2+ steps');

const skillsView = await runTool({ tool: 'list_skills', args: {} }, env, store, VIEW, CTX);
ok(skillsView.ok === true && skillsView.total === SEED_SKILLS.length + (await listSkills(store, VIEW.uid)).learned.length, 'viewer can list the skill library');
const learnDenied = await runTool({ tool: 'learn_skill', args: { title: 'Viewer attempt', body: 'Should be denied before body validation even matters.' } }, env, store, VIEW, CTX);
ok(learnDenied.ok === false && learnDenied.notPermitted === true, 'viewer cannot teach skills');
const learnOk = await runTool({ tool: 'learn_skill', args: { title: 'Manager lesson', domain: 'motion', body: 'Reveal choreography beats fade-ins: stagger 80ms, blur 6px, ease-out cubic.' } }, env, store, MGR, CTX);
ok(learnOk.ok === true, 'manager can teach skills through the agent loop');

/* ══ 6. MCP ══════════════════════════════════════════════════════ */
section('MCP — schemas for the new tools');
for (const t of ['plan_task', 'list_skills', 'learn_skill']) {
  ok(!!TOOL_SCHEMAS[t], `schema present: ${t}`);
}
ok(TOOL_SCHEMAS.plan_task.required.includes('steps'), 'plan_task schema requires steps');
ok(TOOL_SCHEMAS.learn_skill.required.includes('body'), 'learn_skill schema requires body');

/* ══ 7. PUBLIC /connect ══════════════════════════════════════════ */
section('PUBLIC /connect page');
const worker = (await import('../cloudflare/worker/src/index.js')).default;
{
  const res = await worker.fetch(new Request('https://nebula.test/connect'), env, CTX);
  const html = await res.text();
  ok(res.status === 200 && html.includes('<!DOCTYPE html>'), '/connect renders');
  ok(html.includes('https://nebula.test/mcp'), '/connect shows the MCP endpoint');
  ok(html.includes('Role-filtered') || html.includes('role checks'), '/connect explains role-filtered security');
  ok(html.includes('X-Content-Sha256'), '/connect documents artifact integrity');
  ok(html.includes('GitHub') && html.includes('Vercel') && html.includes('Supabase'), '/connect lists the platform connectors');
}

/* ══ 8. SITE ENGINE v3 ═══════════════════════════════════════════ */
section('SITE ENGINE v3 — themes, fonts, life');
const brand = { name: 'Vega', color: '#7C8CFF', contactEmail: 'hi@vega.test', mark: 'V' };
const content = {
  title: 'Vega', headline: 'Sites that feel engineered', sub: 'Studio work.', marquee: ['Strategy', 'Design', 'Build'],
  features: [{ icon: '◆', title: 'Fast', text: 'a' }, { icon: '◇', title: 'Lean', text: 'b' }, { icon: '○', title: 'Yours', text: 'c' }],
  contact: { email: 'hi@vega.test' },
};
{
  const d = normalizeDesign({ theme: 'onyx', palette: {}, font: '', hero: 'split', art: 'rings' }, { kind: 'landing', styleHint: '', brandColor: brand.color });
  const html = renderSite({ kind: 'landing', design: d, content, brand });
  ok(html.includes('family=Space+Grotesk'), 'onyx loads Space Grotesk');
  ok(html.includes('class="hero split"'), 'onyx split hero renders');
  ok(html.includes('<div class="marquee"'), 'marquee band renders');
  ok(html.includes('bento'), 'features render as bento');
  ok(html.includes('wordmark'), 'giant footer wordmark renders');
  ok(html.includes('--accent:#ffffff'), 'onyx stays monochrome (white accent)');
  const dNeo = normalizeDesign({ theme: 'neo', palette: {} }, { kind: 'landing', styleHint: '', brandColor: brand.color });
  const hNeo = renderSite({ kind: 'landing', design: dNeo, content, brand });
  ok(dNeo.font === 'syne' && hNeo.includes('family=Syne'), 'neo loads Syne and allows the brand accent');
  ok(dNeo.palette.accent === brand.color, 'neo keeps the brand accent');
  const dOld = normalizeDesign({ theme: 'editorial', palette: {}, font: '' }, { kind: 'landing', styleHint: '', brandColor: brand.color });
  ok(dOld.font === 'serif' && dOld.hero === 'editorial', 'editorial defaults: serif + editorial hero');
  const dLuxe = normalizeDesign({ theme: 'luxe', palette: {}, font: '' }, { kind: 'landing', styleHint: '', brandColor: brand.color });
  ok(dLuxe.font === 'luxe' && dLuxe.art === 'waves', 'luxe defaults: Cormorant + waves art');
  const keys = Object.keys(THEMES);
  ok(keys.length === 8 && keys.includes('onyx') && keys.includes('neo'), `8 design systems (${keys.join(',')})`);
}

/* ══ done ════════════════════════════════════════════════════════ */
console.log(`\n${'═'.repeat(56)}`);
console.log(`PASS ${passed}  FAIL ${failed}`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  • ${f}`); }
globalThis.fetch = realFetch;
process.exit(failed ? 1 : 0);
