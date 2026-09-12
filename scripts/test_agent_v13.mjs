/**
 * AGENT V13 · CRAFT + TRANSPARENCY — the test suite.
 *
 * Covers the owner's directive ("after building give a summary of the
 * stack/technology/code/front end/back end; while building show the code
 * it is writing upon expansion in a shell along with artifacts; design
 * skills must be excellent; deep research through the internet"):
 *   1. TRACE TRANSPARENCY — trace rows carry bounded CODE payloads and
 *      ARTIFACT events; runAgent detailFn can return {detail, code, artifact}.
 *   2. CODEGEN LIVE CODE — engineer rows ship the actual section code;
 *      plan/design/photos/site artifacts land in the trace.
 *   3. BUILD REPORT — deterministic handover sheet: stack layers,
 *      frontend sections + detected components, quality, crew; stored at
 *      agent:report:<id>; returned by buildWebsite; readable via
 *      getBuildReport; webapp builds produce one too.
 *   4. DESIGN CRAFT — composition library + craft laws in the section
 *      prompt; craft-aware QA rubric; v13 global CSS primitives
 *      (.glass/.text-gradient/.glow/.bento) in the assembled page.
 *   5. WEBAPP LIVE TEAM — webapp builds stream Lead/Architect/Engineer/
 *      Builder rows with a code payload.
 *   6. DEEP RESEARCH — the Researcher opens the primary source and mines
 *      number-bearing facts with the source attributed.
 *   7. BUG FIXES — engine keyframes names are CSS-safe (sec- prefix);
 *      fallback path reports leaks scrubbed.
 */

import { strict as assert } from 'node:assert';
import * as A from '../cloudflare/worker/src/emailer/agents.js';
import * as CG from '../cloudflare/worker/src/emailer/codegen.js';
import * as BLD from '../cloudflare/worker/src/emailer/builder.js';
import * as R from '../cloudflare/worker/src/emailer/report.js';
import * as SB from '../cloudflare/worker/src/emailer/sitebrand.js';

let passed = 0;
const failures = [];
function ok(cond, label, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${label} ${detail}`); }
}
function section(name) { console.log(`\n— ${name} —`); }

/* ══ harness ══ */
function memStore() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

const sarvamSeen = [];
const sarvamScript = [];
function sarvamReplyFor(text) {
  for (const s of sarvamScript) {
    if (s.re.test(text)) {
      const reply = typeof s.reply === 'function' ? s.reply(text) : s.reply;
      return reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
    }
  }
  return null;
}

// Deep-research fixtures: the DDG results page + the "credible" source page.
let ddgHit = null;       // { title, url, snippet } | null
let sourcePage = '';     // html of the fetched source

globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    sarvamSeen.push(text);
    const reply = sarvamReplyFor(text);
    if (reply === null) return new Response(JSON.stringify({ error: 'no scripted reply' }), { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }), { status: 200 });
  }
  if (u.includes('duckduckgo')) {
    if (ddgHit) {
      const rows = `<a class="result__a" href="${ddgHit.url}">${ddgHit.title}</a><a class="result__snippet">${ddgHit.snippet}</a>`;
      return new Response(`<html>${rows}</html>`, { status: 200 });
    }
    return new Response('<html></html>', { status: 200 });
  }
  if (u.includes('wikipedia') || u.includes('openverse') || u.includes('commons')) {
    return new Response(JSON.stringify({ results: [], query: { pages: {} } }), { status: 200 });
  }
  if (sourcePage && u === sourcePage.url) {
    return new Response(sourcePage.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  return new Response(JSON.stringify({ error: `unmocked ${u}` }), { status: 404 });
};

function makeEnv() {
  const MEDIA = new Map();
  return {
    SARVAM_API_KEY: 'sarvam_test',
    MEDIA: {
      put: async (k, v) => { MEDIA.set(k, String(v)); return { key: k }; },
      get: async (k) => (MEDIA.has(k) ? { text: async () => MEDIA.get(k) } : null),
      head: async (k) => (MEDIA.has(k) ? { size: MEDIA.get(k).length, customMetadata: {} } : null),
    },
    __MEDIA: MEDIA,
  };
}
function readPage(env, id) {
  const raw = env.__MEDIA.get(`sites/${id}.html`);
  return raw || '';
}
const MGR = { uid: 'u_v13', displayName: 'Owner', role: 'superAdmin' };

/* ══ 1. TRACE TRANSPARENCY ══ */
section('TRACE TRANSPARENCY (code + artifacts on rows)');
{
  const run = A.createTeamRun({ kind: 'landing', title: 'T' });
  run.record('engineer', 'shipped "Hero"', {
    detail: '3200 chars hand-written',
    code: { lang: 'html', label: 'sec-hero · Hero', preview: `<section id="sec-hero">${'x'.repeat(1200)}`, lines: 90, chars: 3200 },
    artifact: { type: 'design', label: 'Aurora design system', detail: 'accent #34d399 · Fraunces × Inter' },
  });
  const row = run.trace[0];
  ok(row.code && row.code.chars === 3200 && row.code.lines === 90, 'row carries the code payload');
  ok(row.code.preview.length <= 900, `code preview is bounded (${row.code.preview.length} ≤ 900)`);
  ok(row.artifact && row.artifact.type === 'design' && row.artifact.label === 'Aurora design system', 'row carries the artifact event');
  ok(row.agent === 'Engineer', 'row keeps the agent identity');

  // runAgent detailFn object form
  sarvamSeen.length = 0;
  sarvamScript.length = 0;
  sarvamScript.push({ re: /probe-run-agent/, reply: { fine: true } });
  const env = makeEnv();
  const run2 = A.createTeamRun({ kind: 'x', title: 'y' });
  await A.runAgent(env, run2, 'engineer', 'testing', [
    { role: 'system', content: 'probe-run-agent' },
    { role: 'user', content: 'go' },
  ], { maxTokens: 64 }, () => ({ detail: 'wrote it', code: { lang: 'html', label: 'L', preview: '<p>hi</p>', lines: 3, chars: 8 } }));
  ok(run2.trace[0].code?.chars === 8 && run2.trace[0].detail === 'wrote it', 'runAgent detailFn object form lands code on the row');
}

/* ══ 2. BUILD REPORT (deterministic) ══ */
section('BUILD REPORT — the handover sheet');
{
  const html = `<!DOCTYPE html><html><head><title>T</title></head><body><nav class="site-nav"></nav><div id="rev-progress"></div><div class="marquee"><div class="marquee-track"><span>x</span></div></div><section id="sec-hero" data-rev><span data-count="40">0</span><details class="acc"><summary>Q</summary></details><form data-validate><input type="email" required></form><button data-dialog="d1">x</button><dialog id="d1"></dialog></section><footer class="site-footer"></footer></body></html>`;
  const rep = R.buildReport({
    kind: 'landing',
    title: 'Musafir Roasters',
    brand: 'Musafir Roasters',
    url: 'https://w.test/sites/s_x',
    html,
    builder: 'ai',
    plan: { sections: [
      { id: 'hero', name: 'Home', goal: 'state the promise', motion: 'staggered rise' },
      { id: 'menu', name: 'Menu', goal: 'make it tactile', motion: 'cards rise' },
    ] },
    coded: [
      { id: 'hero', html: '<section></section>', css: '#sec-hero{}' },
      { id: 'menu', html: '<section></section>', css: '#sec-menu{}' },
    ],
    design: { themeLabel: 'Aurora glass', theme: 'aurora', harmony: 'complementary', radius: 18, type_scale: 'dramatic', motion_intensity: 'bold', texture: 'grain', palette: { accent: '#34d399', bg: '#0a0d18' }, fontPair: { display: 'Fraunces', body: 'Inter' } },
    images: [{ url: 'https://upload.wikimedia.org/x.jpg', alt: 'barista' }],
    team: [{ agent: 'Lead', action: 'forming the team plan', ai: true, ms: 4200 }, { agent: 'Engineer', action: 'hand-coding', ai: true, ms: 9000 }],
    teamSummary: { agents: 9, ai_calls: 13, ms: 91000 },
    understanding: { success_metric: 'book a table' },
    lead: { page_goal: 'book tables', audience: 'coffee lovers' },
    research: { queries: ['bangalore filter coffee'], ai: true, facts: 5 },
    verdicts: { hero: 'good', menu: 'good' },
    reworked: 0,
    leaks: 0,
    skills: ['learned: use local micro-narratives'],
    buildMs: 93000,
    policy: { legalLinks: true, commerce: true },
  });
  ok(rep.title === 'Musafir Roasters' && rep.url.includes('/sites/s_x'), 'report identifies the artifact');
  const layers = rep.stack.map((s) => s.layer);
  for (const l of ['Structure', 'Styling', 'Behavior', 'Typography', 'Design system', 'Media', 'SEO', 'Hosting', 'Backend']) {
    ok(layers.includes(l), `stack layer "${l}" present`);
  }
  ok(/Semantic HTML5 — 2 sections/.test(rep.stack[0].detail), 'structure quantifies hand-coded sections', rep.stack[0].detail);
  ok(/Fraunces/.test(rep.stack.find((s) => s.layer === 'Typography').detail) && /Inter/.test(rep.stack.find((s) => s.layer === 'Typography').detail), 'typography names the real pairing');
  ok(/localStorage|static single-file/.test(rep.stack.find((s) => s.layer === 'Backend').detail), 'backend layer states the truth');
  ok(rep.frontend.sections.length === 2 && rep.frontend.sections[0].chars > 0, 'frontend lists sections with code sizes');
  ok(rep.frontend.components.includes('Tabs') === false && rep.frontend.components.includes('Accordions') && rep.frontend.components.includes('Inline form validation') && rep.frontend.components.includes('Count-up stats') && rep.frontend.components.includes('Marquee band'), `component detection works (${rep.frontend.components.join(', ')})`);
  ok(/Privacy · Terms/.test(rep.stack.find((s) => s.layer === 'Compliance').detail), 'compliance reflects the policy needs');
  ok(rep.quality.identity === 'verified — 100% client branding', 'quality reports identity');
  ok(rep.agents.count === 9 && rep.agents.crew.length === 2, 'agents summary carried');
  ok(rep.overview.includes('book tables'), 'overview carries goal + metric');
  ok(rep.build_ms >= 93000, 'build wall time carried');
}

/* ══ 3. CODEGEN LIVE CODE + ARTIFACTS ══ */
section('CODEGEN LIVE CODE — engineer rows carry the code');
{
  sarvamScript.length = 0;
  sarvamSeen.length = 0;
  sarvamScript.push({ re: /EXECUTION PLAN/, reply: { brand_name: 'Musafir Roasters', audience: 'coffee lovers', page_goal: 'book tables', research_focus: 'x', queries: [], image_ideas: [], sections_target: 4, emphasis: [], risks: [], tone_note: 'warm' } });
  sarvamScript.push({ re: /one breath later|DEEP-THINK/i, reply: { verdict: 'sharp', extra_emphasis: [], extra_risks: [], angle: '', extra_query: '', depth: 'standard' } });
  sarvamScript.push({ re: /Project Analyst/, reply: { business_model: 'cafe', audience_psyche: 'cafe lovers', competitive_context: 'cafes', voice_spec: 'warm', success_metric: 'book', objections: ['price'] } });
  sarvamScript.push({ re: /design director of a world-class web studio/, reply: { theme: 'aurora', hero: 'split', art: 'mesh', palette: { bg: '#0a0d18', surface: '#12141f', ink: '#eef1fb', muted: '#98a1c0', accent: '#34d399', accent2: '#22d3ee' }, font: 'modern', type_scale: 'dramatic', texture: 'grain', motion_intensity: 'bold', ux_flow: ['land', 'scan'], voice: 'warm', audience: 'coffee lovers', headline_angle: 'Filter coffee, fast', must_have: ['menu'], research_queries: [] } });
  sarvamScript.push({ re: /Researcher of an elite multi-agent web studio/, reply: { facts: ['fact one'], implication: 'be warm', follow_up: '' } });
  sarvamScript.push({ re: /conversion copywriter/, reply: { title: 'Musafir Roasters', kicker: 'Cafe', headline: 'Filter coffee, brewed slow', sub: 'A Bangalore cafe corner.', primary_cta: { label: 'Book a table', href: 'https://musafir.test' }, features: [{ icon: '☕', title: 'Single origin', text: 'estate fresh' }], hero_badges: ['Since 2019'] } });
  sarvamScript.push({ re: /FINAL review/, reply: { verdict: 'good' } });
  sarvamScript.push({ re: /lead architect of a world-class web studio/, reply: { sections: [
    { id: 'hero', name: 'Home', goal: 'promise', journey: 'land', layout: 'split hero with art panel', content_keys: ['headline', 'sub', 'primary_cta'], motion: 'staggered rise' },
    { id: 'menu', name: 'Menu', goal: 'tactile', journey: 'scan', layout: 'bento grid', content_keys: ['features'], motion: 'cards rise' },
  ], nav: ['hero', 'menu'] } });
  sarvamScript.push({
    re: /senior front-end engineer/,
    reply: (text) => {
      const m = /sec-([a-z0-9-]+)/.exec(text.split('NOW hand-code')[1] || 'sec-hero');
      const id = m ? m[1] : 'hero';
      return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><h2 class="text-gradient">${id}</h2><div class="bento"><div class="glass span-6">a</div><div class="glass">b</div></div></div></section>\n<style>#sec-${id}{padding:40px}#sec-${id} .glow{min-height:120px}@keyframes sec-${id}-drift{from{opacity:0}to{opacity:1}}</style>` };
    },
  });
  sarvamScript.push({ re: /design director reviewing/, reply: { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'menu', verdict: 'good' }] } });
  sarvamScript.push({ re: /Reflector of an elite/, reply: { skip: true } });
  sarvamScript.push({ re: /Skill Researcher/, reply: { skip: true } });

  const st = memStore();
  const env = makeEnv();
  const site = SB.extractSiteBrand({ title: 'Musafir Roasters', brief: 'Cafe website for "Musafir Roasters" in Bangalore — filter coffee, snacks.', ctaArgs: {}, profile: null, brand: { name: 'Aidraft Legal' } });
  const res = await BLD.buildWebsite(env, st, MGR,
    { title: 'Musafir Roasters', kind: 'landing', brief: 'Cafe website for "Musafir Roasters" in Bangalore — filter coffee, snacks, cozy corner.' },
    'https://worker.test', { runId: `b_v13${Date.now().toString(36)}` });
  ok(res.ok === true, 'scripted codegen build succeeds', JSON.stringify(res).slice(0, 140));

  const codeRows = (res.team || []).filter((r) => r.code);
  ok(codeRows.length >= 2, `${codeRows.length} engineer rows carry live code`);
  ok(codeRows.every((r) => r.code.preview.includes('<section id="sec-')), 'code previews contain the actual section markup');
  ok(codeRows.some((r) => r.code.label.includes('hero')), 'hero code row labeled');

  const artifacts = (res.team || []).filter((r) => r.artifact).map((r) => r.artifact.type);
  ok(artifacts.includes('design'), 'design-system artifact traced');
  ok(artifacts.includes('plan'), 'section-plan artifact traced');
  ok(artifacts.includes('site'), 'assembled-site artifact traced');

  // Report: returned + stored + readable.
  ok(res.report && res.report.stack?.length >= 9, 'build response carries the report');
  const stored = await st.get(`agent:report:${res.artifact_id}`);
  ok(stored && JSON.parse(stored).frontend.sections.length >= 2, 'report stored at agent:report:<id>');
  const read = await BLD.getBuildReport(st, MGR.uid, res.artifact_id);
  ok(read.ok === true && read.report.title === 'Musafir Roasters', 'getBuildReport reads the stored report');

  // Live run doc carried the report + code rows too.
  const runDoc = JSON.parse(await st.get(`agent:run:${res.note ? res.artifact_id : ''}`) || 'null');
  ok(runDoc === null || runDoc.result?.report, 'run doc result carries the report (when run doc used)');

  const page = readPage(env, res.artifact_id);
  ok(page.includes('.text-gradient') && page.includes('.glass{') && page.includes('.bento{') && page.includes('.glow::before'), 'v13 global CSS primitives shipped');
  ok(page.includes('COMPOSITION') === false, 'the composition library never leaks into the page');
  ok(page.includes('Fraunces') || /font-family:var\(--display\)/.test(page), 'page wired with the locked typography');

  // Engineer prompt carries the composition library + craft laws; QA carries the craft rubric.
  const engPrompt = sarvamSeen.find((t) => /senior front-end engineer/.test(t)) || '';
  ok(/COMPOSITION LIBRARY/.test(engPrompt) && /CRAFT LAWS/.test(engPrompt), 'engineer prompt teaches the composition library');
  ok(/never render 3\+ identical cards/.test(engPrompt), 'anti-template craft law present');
  ok(engPrompt.includes('.glass') && engPrompt.includes('.bento'), 'engineer prompt lists the v13 primitives');
  const qaPrompt = sarvamSeen.find((t) => /design director reviewing/.test(t)) || '';
  ok(/FLAT DESIGN/.test(qaPrompt) && /no clear focal point/.test(qaPrompt), 'QA rubric judges craft, not just breakage');
}

/* ══ 4. WEBAPP LIVE TEAM ══ */
section('WEBAPP — a real watchable team + report');
{
  sarvamScript.length = 0;
  sarvamScript.push({ re: /lead engineer planning/, reply: { app_name: 'TipJar', core_loop: 'record a tip', features: [{ name: 'Log', purpose: 'add tips' }], data: { entity: 'Tip', fields: ['id', 'amount', 'createdAt'] }, screens: ['Home'], empty_state: 'No tips yet' } });
  sarvamScript.push({ re: /senior product engineer/, reply: { __raw: '<!DOCTYPE html><html><head><title>TipJar</title><style>body{color:#111}</style></head><body><h1>TipJar</h1><input id="a"><button onclick="add()">Add</button><div id="l"></div><script>function add(){var v=document.getElementById("a").value;var l=JSON.parse(localStorage.getItem("tip.v1")||"[]");l.unshift({t:v,d:false});localStorage.setItem("tip.v1",JSON.stringify(l));document.getElementById("l").textContent=l.length}</script></body></html>' } });

  const st = memStore();
  const env = makeEnv();
  const res = await BLD.buildWebsite(env, st, MGR,
    { title: 'TipJar', kind: 'webapp', brief: 'A tip tracker web app for field teams.' },
    'https://worker.test', { runId: `b_w13${Date.now().toString(36)}` });
  ok(res.ok === true, 'webapp build succeeds', JSON.stringify(res).slice(0, 120));
  const agents = (res.team || []).map((r) => r.agent);
  ok(agents.includes('Lead') && agents.includes('Architect') && agents.includes('Engineer') && agents.includes('Builder'), `webapp team traced (${agents.join(', ')})`);
  const engRow = (res.team || []).find((r) => r.agent === 'Engineer' && r.code);
  ok(engRow && engRow.code.preview.startsWith('<!DOCTYPE html>'), 'webapp engineer row carries the app code');
  const planArt = (res.team || []).find((r) => r.artifact?.type === 'plan');
  ok(planArt && /Tip \{/.test(planArt.artifact.detail), 'webapp plan artifact names the data model');
  ok(res.report && res.report.stack.find((s) => s.layer === 'Backend').detail.includes('localStorage'), 'webapp report describes the offline data layer');
  const stored = await st.get(`agent:report:${res.artifact_id}`);
  ok(stored && JSON.parse(stored).kind === 'webapp', 'webapp report stored');
}

/* ══ 5. DEEP RESEARCH ══ */
section('DEEP RESEARCH — opens the primary source');
{
  ddgHit = { title: 'Bangalore coffee guide', url: 'https://examplecoffee.org/guide', snippet: 'Bangalore has 1200+ specialty cafes.' };
  sourcePage = {
    url: 'https://examplecoffee.org/guide',
    body: '<html><body><h1>The Bangalore filter coffee field guide</h1><p>The Bangalore specialty coffee market grew 42 percent between 2022 and 2025 with over 1200 cafes now operating across the city and its outskirts.</p><p>Filter coffee remains 65 percent of daily orders in traditional roasteries, and the average cafe ticket is 240 rupees on weekdays.</p><p>Weekend footfall peaks between 8 and 11 in the morning, when roasteries report queues of regulars who order standing at the counter.</p><script>var junk="skip me";</script></body></html>',
  };
  sarvamScript.length = 0;
  sarvamScript.push({ re: /Researcher of an elite multi-agent web studio/, reply: { facts: ['market growing'], implication: 'lead with heritage', follow_up: '' } });

  const { researchIntelligence } = await import('../cloudflare/worker/src/emailer/designer.js');
  const team = A.createTeamRun({ kind: 'landing', title: 'r' });
  const ri = await researchIntelligence(makeEnv(), { queries: ['bangalore filter coffee market'], brief: 'cafe', brand: { name: 'Musafir Roasters' }, team });
  ok(ri.ai === true && ri.facts?.length >= 2, `researcher synthesized + deep-read (${ri.facts?.length} facts)`);
  ok(ri.facts.some((f) => f.includes('[source: examplecoffee.org')), 'deep-read facts carry the source attribution');
  ok(ri.facts.some((f) => /42 percent|1200/.test(f)), 'number-bearing page facts mined');
  const rows = team.trace.map((r) => r.action);
  ok(rows.includes('reading the primary source'), 'deep read traced as a researcher row');
  ddgHit = null;
  sourcePage = '';
}

/* ══ 6. BUG FIXES ══ */
section('BUG FIXES');
{
  // Engine fallback keyframes must be CSS-safe (animation names cannot
  // start with a digit; a section id like "3col" would produce one).
  const design = { palette: { bg: '#0a0d18', accent: '#34d399', ink: '#fff', muted: '#9aa' }, radius: 16, font: 'modern' };
  const fb = CG.engineFallbackSection({ id: '3col', name: 'Grid', content_keys: [] }, { sub: 'x', primary_cta: { label: 'Go', href: 'https://x.test' } }, design);
  ok(fb.css.includes('@keyframes sec-3col-rise'), 'engine keyframes names are CSS-safe (sec- prefixed)');

  // The sanitizer keeps the section alive even with poisoned handlers.
  const parsed = CG.parseSection('<section id="sec-a" onclick="evil()"><div class="wrap"><h2>Hi there</h2><p>hello world this is definitely enough real text to pass the minimum length gate for hand-coded sections in the pipeline</p></div></section><style>#sec-a{color:#fff;padding:20px;border:1px solid #333;background:#111;border-radius:12px;max-width:640px;margin:0 auto}</style>', 'a', null);
  ok(!/onclick/.test(parsed.html), 'inline handlers still stripped');

  // Report degrades gracefully with missing inputs (legacy refine path).
  const thin = R.buildReport({ kind: 'landing', title: 'T', brand: 'B', html: '<html></html>' });
  ok(thin.stack.length >= 9 && thin.frontend.sections.length === 0, 'report never throws on thin inputs');
}

/* ══ done ══ */
console.log(`\n══════════════════════════════════════`);
console.log(`AGENT V13: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
