#!/usr/bin/env node
/**
 * test_agent_v9.mjs — Agent v9: the team gets MORE advanced.
 *
 * Covers:
 *   • the Reflector joins the roster (10 specialists)
 *   • the LIVE RUN SINK — team runs persist a doc after every row (and
 *     a broken sink can never break a build)
 *   • the Lead's page_goal (plan + leadBlock + deterministic fallback)
 *   • researchIntelligence — the Researcher SYNTHESIZES live search
 *     results into market intelligence (with raw-facts + web-down
 *     degradation)
 *   • reflectOnBuild — the post-build self-evolution loop (learn,
 *     sharpen, skip, outage-safe)
 *   • startBuildRun/getRunStatus — the async live-run flow (job doc,
 *     result payload, owner scoping, timeout honesty)
 *   • SURGICAL refine — sections:['hero'] re-codes ONLY the hero, reuses
 *     every other fragment byte-identical, bumps the version; missing
 *     fragments / unknown ids fall back to a full re-code
 */
import { strict as assert } from 'node:assert';

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
}
function section(name) { console.log(`\n— ${name} —`); }

const A = await import('../cloudflare/worker/src/emailer/agents.js');
const D = await import('../cloudflare/worker/src/emailer/designer.js');
const B = await import('../cloudflare/worker/src/emailer/builder.js');
const { AGENT_TEAM, createTeamRun, leadPlan, leadBlock, defaultLeadPlan, reflectOnBuild } = A;
const { researchIntelligence, researchFacts } = D;
const { buildWebsite, refineSite, startBuildRun, getRunStatus } = B;

/* ── Sarvam + web fetch mock (scripted + captured) ────────────────── */
const sarvamScript = [];
const sarvamSeen = [];
let ddgResults = [];
let ddgUp = true;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    sarvamSeen.push(text);
    for (const s of sarvamScript) {
      if (s.match(text)) {
        const reply = typeof s.reply === 'function' ? s.reply(text) : s.reply;
        const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
        return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ error: 'no scripted reply' }), { status: 500 });
  }
  if (u.startsWith('https://html.duckduckgo.com/html/')) {
    if (!ddgUp) return new Response('blocked', { status: 403 });
    const anchors = ddgResults.map((r, i) =>
      `<a class="result__a" href="https://example.com/${i}">${r.title}</a>` +
      `<a class="result__snippet" href="#">${r.snippet}</a>`
    ).join('');
    return new Response(`<html>${anchors}</html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  return new Response(JSON.stringify({ error: `unmocked ${u}` }), { status: 404 });
};

const env = { SARVAM_API_KEY: 'sarvam_test', MEDIA: {
  async put(key, value, opts) { this.__map = this.__map || new Map(); this.__map.set(key, { value, opts }); return { key }; },
  async get(key) { const e = this.__map?.get(key); return e ? { text: async () => e.value } : null; },
  async head(key) { return null; },
} };
const brand = { name: 'Musafir Coffee', color: '#8a5a2b', contactEmail: 'hi@musafir.test', profile: { industry: 'cafes' } };
const design = {
  theme: 'aurora', themeLabel: 'Aurora glass',
  palette: { bg: '#0a0d18', surface: '#111527', ink: '#eef1fb', muted: '#98a1c0', accent: '#7c8cff', accent2: '#3dd8d8' },
  font: 'grotesk', voice: 'cozy premium', audience: 'coffee lovers', art: 'mesh', hero: 'centered', radius: 18,
};
const thought = { design, headlineAngle: 'Single-origin, slow-poured', mustHave: [], queries: ['mumbai specialty coffee'], ai: true };
const content = {
  title: 'Musafir Coffee', kicker: 'Mumbai', headline: 'Coffee worth the trip',
  sub: 'Single-origin pours and weekend cuppings.', primary_cta: { label: 'Find us', href: 'mailto:hi@musafir.test' },
  secondary_cta: null, hero_badges: ['Since 2019'], marquee: [], stats: [],
  features: [{ icon: '☕', title: 'Single origin', text: 'Coorg beans.' }],
  testimonials: [], faq: [], offer: null, event: null, work: [], skills: [], report: null,
  contact: { email: 'hi@musafir.test', phone: '', address: '', hours: '' },
  cta_title: 'Come say hi', cta_sub: '', footer_note: 'Made with Nebula',
};
const PLAN = { sections: [
  { id: 'hero', name: 'Home', goal: 'state the promise', layout: 'Statement hero', content_keys: ['kicker', 'headline', 'sub', 'primary_cta'], motion: 'rise' },
  { id: 'menu', name: 'Menu', goal: 'show the pours', layout: 'Two-column list', content_keys: ['features'], motion: 'reveal' },
  { id: 'contact', name: 'Contact', goal: 'convert', layout: 'Split band', content_keys: ['cta_title', 'contact', 'primary_cta'], motion: 'slide' },
], nav: ['hero', 'menu', 'contact'], ai: true };

function sectionReply(text) {
  const id = /section "sec-([a-z0-9-]+)"/.exec(text)?.[1] || 'hero';
  const headline = (/"headline":"([^"]*)"/.exec(text)?.[1] || `Hand-coded ${id}`).replace(/[<>]/g, '');
  return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><h2>${headline}</h2><p>Bespoke ${id} section with real copy and hand-written CSS for the page.</p></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:clamp(30px,5vw,54px)}#sec-${id} p{color:var(--muted)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'q'.repeat(40)} */</style>` };
}

/** The full scripted flow for a successful multi-agent build. */
function primeFullBuild({ leadGoal = 'book tables for friday nights', headline = 'Coffee worth the trip' } = {}) {
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('EXECUTION PLAN'), reply: { audience: 'coffee lovers in mumbai', page_goal: leadGoal, research_focus: 'mumbai cafe market', queries: ['mumbai specialty coffee trend'], sections_target: 4, emphasis: ['menu tactile'], risks: ['generic cafe look'], tone_note: 'warm, specific, sensory' } },
    { match: (t) => t.includes('Turn the raw results into MARKET INTELLIGENCE'), reply: { facts: ['Specialty cafes in Mumbai grew ~15% in 2024', 'Cold brew sells at ₹280-350 in Bandra cafes', 'Weekend cupping workshops sell out 2 weeks ahead'], implication: 'lead with freshness, honest pricing and the weekend cupping ritual' } },
    { match: (t) => t.includes('Decide the design direction'), reply: { theme: 'aurora', palette: { accent: '#7c8cff' }, font: 'grotesk', voice: 'cozy premium', audience: 'coffee lovers', headline_angle: 'Single-origin, slow-poured', must_have: [], research_queries: ['mumbai specialty coffee'] } },
    { match: (t) => t.includes('conversion copywriter'), reply: { ...content, headline } },
    { match: (t) => t.includes('FINAL review'), reply: { verdict: 'good' } },
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: PLAN.sections.map((s) => ({ id: s.id, verdict: 'good' })) } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
    { match: (t) => t.includes('After every finished build'), reply: { title: 'Hero trust rows convert when badges are concrete', domain: 'design', body: 'Name the trust badges with concrete specifics (since-year, origin, price band) — generic badges depress hero conversion.' } },
  );
  ddgResults = [
    { title: 'Mumbai specialty coffee scene grows', snippet: '15% growth in specialty cafes across Mumbai in 2024.' },
    { title: 'Cold brew pricing in Mumbai', snippet: 'Bandra cafes sell cold brew at ₹280-350.' },
  ];
  ddgUp = true;
}

/* ── Minimal in-memory state store ───────────────────────────────── */
function memStore() {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    __map: m,
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ 1. ROSTER — the Reflector joins ═══════════════════════════════ */
section('ROSTER — ten specialists');
{
  ok(AGENT_TEAM.reflector && AGENT_TEAM.reflector.emoji === '🪞' && /lesson/.test(AGENT_TEAM.reflector.role), 'the Reflector is on the roster with the mirror emoji');
}

/* ══ 2. LIVE RUN SINK — the trace persists itself ══════════════════ */
section('TEAM RUN SINK');
{
  const docs = [];
  const team = createTeamRun({ kind: 'landing', title: 'T' }, async (doc) => { docs.push(doc); });
  team.record('lead', 'forming the team plan', { ms: 12, detail: '4 sections' });
  team.stage('lead', true, true, 'team plan');
  team.record('engineer', 'hand-coding "Menu"', { ms: 3400 });
  ok(docs.length === 3, `sink fired after every row (${docs.length})`);
  ok(docs[2].trace.length === 2 && docs[2].stages.length === 1, 'doc carries trace + stages');
  ok(docs[2].summary && docs[2].summary.ai_calls === 2, 'doc summary is live');
  ok(typeof docs[2].started_at === 'string' && docs[2].meta.kind === 'landing', 'doc carries meta + started_at');

  const boom = createTeamRun({}, async () => { throw new Error('sink exploded'); });
  boom.record('lead', 'still fine', {});
  ok(boom.trace.length === 1, 'a throwing sink never breaks the trace');
  const rej = createTeamRun({}, async () => { throw new Error('x'); });
  let crashed = false;
  try { rej.record('lead', 'async boom', {}); await sleep(10); } catch { crashed = true; }
  ok(!crashed, 'async sink rejection is swallowed');
  const noSink = createTeamRun({});
  noSink.record('lead', 'no sink', {});
  ok(noSink.trace.length === 1, 'runs without a sink behave exactly as v8');
}

/* ══ 3. LEAD page_goal ═════════════════════════════════════════════ */
section('LEAD — page_goal');
{
  primeFullBuild();
  const lead = await leadPlan(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', brand });
  ok(lead.page_goal === 'book tables for friday nights', 'Lead plan carries page_goal', lead.page_goal);
  const block = leadBlock(lead);
  ok(block.includes('THE PAGE MUST: book tables for friday nights'), 'leadBlock injects THE PAGE MUST');
  const d = defaultLeadPlan({ kind: 'promo', brief: '', brand });
  ok(d.page_goal === 'drive offer redemptions', 'deterministic fallback has a kind-aware page_goal');
  ok(defaultLeadPlan({ kind: 'webapp', brief: '', brand }).page_goal === 'make the core action effortless', 'webapp fallback goal');
}

/* ══ 4. RESEARCH INTELLIGENCE — the Researcher thinks ══════════════ */
section('RESEARCHER — synthesis, fallbacks');
{
  primeFullBuild();
  const team = createTeamRun({});
  const ri = await researchIntelligence(env, { queries: ['mumbai specialty coffee trend'], brief: 'cozy coffee shop', brand, team });
  ok(ri.ai === true, 'synthesis succeeded');
  ok(ri.block.includes('MARKET INTELLIGENCE'), 'block is market intelligence, not raw snippets');
  ok(ri.block.includes('WHAT IT MEANS FOR THIS PAGE:'), 'implication line present');
  ok(ri.block.includes('15%'), 'facts carried into the block');
  ok(team.trace.some((r) => r.agent === 'Researcher' && r.ok === true && /facts synthesized/.test(r.detail)), 'Researcher traced with the distilled count');

  // synthesis down → raw facts degrade gracefully
  sarvamScript.length = 0;
  const ri2 = await researchIntelligence(env, { queries: ['mumbai specialty coffee trend'], brief: '', brand, team: null });
  ok(ri2.ai === false && ri2.block.includes('MARKET FACTS'), 'synthesis outage degrades to raw facts');
  ok(ri2.block.includes('15% growth'), 'raw facts preserved');

  // web down → honest empty
  ddgUp = false;
  const ri3 = await researchIntelligence(env, { queries: ['mumbai specialty coffee trend'], brief: '', brand, team: null });
  ok(ri3.block === '' && ri3.ai === false, 'web down → empty block, never throws');
  ddgUp = true;

  // no queries → no-op
  const ri4 = await researchIntelligence(env, { queries: [], brand, team: null });
  ok(ri4.block === '' && ri4.ai === false, 'no queries → no-op');
  // legacy researchFacts still exported + working
  const raw5 = await researchFacts(['mumbai specialty coffee trend']);
  ok(raw5.includes('MARKET FACTS'), 'legacy researchFacts intact');
}

/* ══ 5. REFLECTOR — the self-evolution loop ════════════════════════ */
section('REFLECTOR — builds become lessons');
{
  const st = memStore();
  primeFullBuild();
  const note1 = await reflectOnBuild(env, st, 'u_ref', {
    lead: defaultLeadPlan({ kind: 'landing', brief: 'x', brand }),
    plan: PLAN,
    brand,
    verdicts: { hero: 'good', menu: 'fix' },
    team: null,
  });
  ok(note1.includes('learned'), 'reflection stored a skill', note1);
  const lib = JSON.parse(await st.get('skills:library:u_ref'));
  ok(lib.length === 1 && lib[0].source === 'build-reflection', 'skill stored with the build-reflection source');
  ok(/Hero trust rows/.test(lib[0].title) && lib[0].body.length >= 40, 'skill carries title + actionable body');

  // same lesson again → sharpen, not duplicate
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('After every finished build'), reply: { title: 'Hero trust rows convert when badges are concrete', domain: 'design', body: 'Name the trust badges with concrete specifics — sharper version with price bands and origin names.' } });
  const note2 = await reflectOnBuild(env, st, 'u_ref', { lead: defaultLeadPlan({ kind: 'landing', brief: 'x', brand }), plan: PLAN, brand });
  ok(note2.includes('sharpened'), 're-reflection sharpens the existing skill', note2);
  const lib2 = JSON.parse(await st.get('skills:library:u_ref'));
  ok(lib2.length === 1, 'no duplicate skills');

  // skip → honest no-op
  sarvamScript.length = 0;
  sarvamScript.push({ match: () => true, reply: { skip: true } });
  ok((await reflectOnBuild(env, st, 'u_ref', { lead: defaultLeadPlan({ kind: 'landing', brief: 'x', brand }), plan: PLAN, brand })) === '', 'skip verdict stores nothing');

  // outage → '', never throws
  sarvamScript.length = 0;
  ok((await reflectOnBuild(env, st, 'u_ref', { lead: defaultLeadPlan({ kind: 'landing', brief: 'x', brand }), plan: PLAN, brand })) === '', 'outage-safe reflection');
  ok((await reflectOnBuild(env, st, 'u_ref', { lead: null, plan: null, brand })) === '', 'no digest → no call at all');
}

/* ══ 6. FULL BUILD through v9 — reflect stage in the trace ═════════ */
section('BUILD v9 — reflect stage + response');
{
  primeFullBuild();
  const st = memStore();
  const res = await buildWebsite(env, st, { uid: 'u_v9', displayName: 'Owner' },
    { title: 'Musafir Coffee', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours.' }, 'https://worker.test');
  ok(res.ok === true && res.builder === 'ai', 'v9 build succeeds');
  ok((res.team || []).some((r) => r.agent === 'Reflector' && r.ok === true), 'Reflector traced on the build');
  ok((res.stages || []).some((s) => s.stage === 'reflect' && s.ai === true), 'reflect stage recorded');
  ok(res.reflected && res.reflected.includes('learned'), 'response carries the reflection note', res.reflected);
  const lib = JSON.parse(await st.get('skills:library:u_v9'));
  ok(lib.length === 1, 'the learned skill is in the library for the NEXT build');
  ok(sarvamSeen.some((t) => t.includes('THE PAGE MUST: book tables for friday nights')), 'page_goal reached specialist prompts');
  ok(sarvamSeen.some((t) => t.includes('MARKET INTELLIGENCE (Researcher synthesis')), 'researcher intelligence reached the copywriter');
  // plan carries coded fragments for surgical refines
  const plan = JSON.parse(await st.get(`agent:siteplan:${res.artifact_id}`));
  ok(Array.isArray(plan.coded) && plan.coded.length === 3 && plan.coded.every((c) => c.html && c.css), 'siteplan stores all 3 coded fragments');
  ok(plan.coded.find((c) => c.id === 'menu').html.includes('Bespoke menu section'), 'menu fragment is the real coded HTML');
}

/* ══ 7. LIVE RUNS — start + poll, owner-scoped ═════════════════════ */
section('LIVE RUNS — watch the team work');
{
  primeFullBuild();
  const st = memStore();
  let captured;
  const ctx = { waitUntil(p) { captured = p; } };
  const job = await startBuildRun(env, st, { uid: 'u_live', displayName: 'Owner' },
    { title: 'Musafir Live', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours.' }, 'https://worker.test', ctx);
  ok(job.ok === true && /^b_[a-z0-9]+$/.test(job.job_id), 'job id issued', job.job_id);
  ok(job.poll === `/v1/studio/run?id=${job.job_id}`, 'poll path returned');

  // wait for the detached run to land (mock AI is fast)
  let doc = null;
  for (let i = 0; i < 200; i++) {
    await sleep(25);
    doc = JSON.parse(await st.get(`agent:run:${job.job_id}`));
    if (doc?.status === 'done' || doc?.status === 'error') break;
  }
  ok(doc?.status === 'done', 'run doc reached done');
  ok(doc?.result?.artifact_id && doc.result.url === `https://worker.test/sites/${doc.result.artifact_id}`, 'result payload carries the artifact');
  ok(doc.result.builder === 'ai' && doc.result.team_summary?.ai_calls >= 9, `result carries builder + team summary (${doc.result?.team_summary?.ai_calls})`);
  ok((doc.trace || []).some((r) => r.agent === 'Reflector'), 'live trace streamed the Reflector row');
  ok(captured instanceof Promise, 'run handed to ctx.waitUntil');

  const status = await getRunStatus(st, 'u_live', job.job_id);
  ok(status.ok === true && status.status === 'done', 'getRunStatus: done');
  ok(status.trace.length >= 10 && status.result?.artifact_id, 'poll returns the full trace + result');
  ok((await getRunStatus(st, 'u_other', job.job_id)).ok === false, 'runs are owner-scoped');
  ok((await getRunStatus(st, 'u_live', '../etc')).ok === false, 'bad ids rejected');
  ok((await getRunStatus(st, 'u_live', 'b_missing')).ok === false, 'unknown id → not found');

  // timeout honesty
  await st.put('agent:run:z_old', JSON.stringify({ id: 'z_old', uid: 'u_live', kind: 'landing', title: 'stale', at: new Date(Date.now() - 400_000).toISOString(), status: 'running', trace: [], stages: [] }));
  const stale = await getRunStatus(st, 'u_live', 'z_old');
  ok(stale.status === 'timeout' && /time budget/.test(stale.note), 'stale running doc reports timeout honestly');
}

/* ══ 8. SURGICAL REFINE — re-code only the hero ════════════════════ */
section('SURGICAL REFINE — sections:["hero"]');
{
  primeFullBuild();
  const st = memStore();
  const res = await buildWebsite(env, st, { uid: 'u_surg', displayName: 'Owner' },
    { title: 'Musafir Coffee', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours.' }, 'https://worker.test');
  const before = JSON.parse(await st.get(`agent:siteplan:${res.artifact_id}`));
  const menuBefore = before.coded.find((c) => c.id === 'menu').html;
  const contactBefore = before.coded.find((c) => c.id === 'contact').html;
  const heroBefore = before.coded.find((c) => c.id === 'hero').html;
  const codeCallsBefore = sarvamSeen.filter((t) => t.includes('HAND-CODING one section')).length;
  const seenMark = sarvamSeen.length;

  // refine that only re-codes the hero (copy review now asks for a bolder headline)
  primeFullBuild();
  sarvamScript.splice(3, 1, { match: (t) => t.includes('after client feedback'), reply: { ...content, headline: 'Coffee worth the trip, bold and slow' } });
  const rr = await refineSite(env, st, { uid: 'u_surg' },
    { artifact_id: res.artifact_id, instruction: 'make the hero statement bolder', sections: ['hero'] }, 'https://worker.test');
  const refineSeen = sarvamSeen.slice(seenMark);
  ok(rr.ok === true && rr.version === 2, 'surgical refine bumps to v2', JSON.stringify({ ok: rr.ok, err: rr.error }));
  ok(/surgical re-code of hero/.test(rr.note), 'note names the surgical scope', rr.note);
  ok((rr.team || [])[0].detail.includes('surgical: hero'), 'Lead trace announces the scope');
  const codeCalls = refineSeen.filter((t) => t.includes('HAND-CODING one section')).length;
  ok(codeCalls === 1, `exactly ONE section re-coded (got ${codeCalls})`);
  ok(refineSeen.some((t) => t.includes('HAND-CODING one section') && t.includes('sec-hero')), 'the hero prompt was the one issued');
  ok(refineSeen.filter((t) => t.includes('HAND-CODING one section') && t.includes('"sec-menu"')).length === 0, 'menu NOT re-coded');
  ok(refineSeen.filter((t) => t.includes('HAND-CODING one section') && t.includes('"sec-contact"')).length === 0, 'contact NOT re-coded');

  const after = JSON.parse(await st.get(`agent:siteplan:${res.artifact_id}`));
  const menuAfter = after.coded.find((c) => c.id === 'menu').html;
  const contactAfter = after.coded.find((c) => c.id === 'contact').html;
  const heroAfter = after.coded.find((c) => c.id === 'hero').html;
  ok(menuAfter === menuBefore, 'menu fragment byte-identical');
  ok(contactAfter === contactBefore, 'contact fragment byte-identical');
  ok(heroAfter !== heroBefore, 'hero fragment re-coded');
  const served = await env.MEDIA.get(`sites/${res.artifact_id}.html`);
  const servedHtml = await served.text();
  ok(servedHtml.includes('Coffee worth the trip, bold and slow'), 'new hero copy made it into the served page');
  ok(servedHtml.includes('Bespoke menu section') && servedHtml.includes(menuBefore), 'untouched fragments still in the assembled page');

  // unknown section id → falls back to a full re-code
  const codeCalls2 = sarvamSeen.filter((t) => t.includes('HAND-CODING one section')).length;
  const seenMark2 = sarvamSeen.length;
  primeFullBuild();
  sarvamScript.splice(3, 1, { match: (t) => t.includes('after client feedback'), reply: { ...content, headline: 'Coffee worth the trip, v3' } });
  const rr2 = await refineSite(env, st, { uid: 'u_surg' },
    { artifact_id: res.artifact_id, instruction: 'another pass', sections: ['nonexistent'] }, 'https://worker.test');
  ok(rr2.ok === true && rr2.version === 3, 'unknown section id still refines');
  ok(rr2.note.includes('re-coded from your instruction'), 'falls back to the full re-code', rr2.note);
  const grew = sarvamSeen.slice(seenMark2).filter((t) => t.includes('HAND-CODING one section')).length;
  ok(grew >= 3, `full re-code re-codes every section (grew by ${grew})`);
}

/* ══ 9. FLEA CIRCUS — sink dead, web down, still ships ═════════════ */
section('DEGRADATION — sink + web + reflection all dead');
{
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('EXECUTION PLAN'), reply: { audience: 'x', page_goal: 'y', queries: ['mumbai coffee'], sections_target: 4 } },
    { match: (t) => t.includes('Decide the design direction'), reply: { theme: 'onyx', palette: { accent: '#7c8cff' }, font: 'grotesk', voice: 'quiet', audience: 'readers', headline_angle: 'x', must_have: [], research_queries: [] } },
    { match: (t) => t.includes('conversion copywriter'), reply: { ...content } },
    { match: (t) => t.includes('FINAL review'), reply: { verdict: 'good' } },
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: PLAN.sections.map((s) => ({ id: s.id, verdict: 'good' })) } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
  );
  ddgUp = false;
  const st = memStore();
  let sinkCalls = 0;
  const res = await buildWebsite(env, st, { uid: 'u_deg', displayName: 'Owner' },
    { title: 'Musafir', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.' }, 'https://worker.test');
  ok(res.ok === true && res.builder === 'ai', 'build survives dead web + dead reflection');
  ok(res.reflected === '', 'no reflection note when the Reflector is unreachable');
  ok(res.stages.some((s) => s.stage === 'research' && /skipped \(web unreachable\)/.test(s.detail)), 'research stage honest when the web is down');
  ok((res.team || []).some((r) => r.agent === 'Researcher' && /web unreachable/.test(r.detail)), 'Researcher row is honest about the outage');
  ddgUp = true;
}

console.log(`\n══════════════════════════════════════`);
console.log(`AGENT V9: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
