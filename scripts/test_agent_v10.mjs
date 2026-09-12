#!/usr/bin/env node
/**
 * test_agent_v10.mjs — Agent v10 "DEEPTHINK": the team thinks longer,
 * plans better, understands deeper, researches in two rounds, designs
 * with real tokens + WCAG-enforced colour, journey-maps the architecture,
 * and GENUINELY researches + builds its own skills.
 *
 * Covers:
 *   • roster: 12 specialists (Analyst 🧭 + Skill Researcher 📚 join)
 *   • leadDeepThink: self-critique → revision (emphasis/risks/angle/
 *     extra_query merged + capped), "sharp" verdict, outage-safe fallback
 *   • applyDeepThink purity (no revision applied when ai=false)
 *   • projectUnderstanding: the shared understanding artifact + block,
 *     empty-reply and outage degradation
 *   • enforceContrast: deterministic WCAG repair (ink ≥7:1, muted ≥4.5:1,
 *     accent ≥3:1) + contrastRatio math + untouched good palettes
 *   • designBrief v2: type_scale / texture / motion_intensity / ux_flow
 *     parsed with hard defaults; palette contrast-enforced
 *   • globalCss v2: --accent-soft, --step-*, --dur-2, motion-intensity
 *     scaling of the reveal system, texture variants
 *   • researchIntelligence round 2: a follow_up query is chased and the
 *     new facts merged (+ researcher trace row)
 *   • planSections: UX FLOW + journey parsed into the plan
 *   • section prompts carry JOURNEY STAGE / TYPE SCALE / MOTION INTENSITY
 *   • researchAndLearnSkill: web → distilled RULES → library with the
 *     skill-research source; skip/web-down/no-store degradation
 *   • FULL v10 build: understand + skill stages in the trace, deep:true,
 *     the researched skill lands in the library, understanding flows
 *     into specialist prompts
 *   • research_skill tool: registered (write tier), MCP v5.0.0 advert +
 *     schema, runTool happy path + topic validation
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
const G = await import('../cloudflare/worker/src/emailer/codegen.js');
const B = await import('../cloudflare/worker/src/emailer/builder.js');
const S = await import('../cloudflare/worker/src/emailer/skills.js');
const AS = await import('../cloudflare/worker/src/emailer/assistant.js');
const M = await import('../cloudflare/worker/src/emailer/mcp.js');
const { AGENT_TEAM, createTeamRun, leadPlan, leadDeepThink, applyDeepThink, projectUnderstanding, understandingBlock, researchAndLearnSkill, defaultLeadPlan } = A;
const { designBrief, researchIntelligence, enforceContrast, contrastRatio } = D;
const { planSections, globalCss } = G;
const { buildWebsite } = B;
const { TOOLS } = AS;

/* ── Sarvam + web fetch mock (scripted + captured) ────────────────── */
const sarvamScript = [];
const sarvamSeen = [];
let ddgUp = true;
let ddgByQuery = null; // optional fn(query) → results

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
    const q = decodeURIComponent((/[?&]q=([^&]+)/.exec(u) || [])[1] || '');
    const results = ddgByQuery ? ddgByQuery(q) : [
      { title: 'Mumbai specialty coffee scene grows', snippet: '15% growth in specialty cafes across Mumbai in 2024.' },
      { title: 'Cold brew pricing in Mumbai', snippet: 'Bandra cafes sell cold brew at ₹280-350.' },
    ];
    const anchors = results.map((r, i) =>
      `<a class="result__a" href="https://example.com/${encodeURIComponent(q).slice(0, 12)}-${i}">${r.title}</a>` +
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
  { id: 'hero', name: 'Home', goal: 'state the promise', journey: 'land → promise', layout: 'Statement hero', content_keys: ['kicker', 'headline', 'sub', 'primary_cta'], motion: 'rise' },
  { id: 'menu', name: 'Menu', goal: 'show the pours', journey: 'scan → proof', layout: 'Two-column list', content_keys: ['features'], motion: 'reveal' },
  { id: 'contact', name: 'Contact', goal: 'convert', journey: 'act → booking', layout: 'Split band', content_keys: ['cta_title', 'contact', 'primary_cta'], motion: 'slide' },
], nav: ['hero', 'menu', 'contact'], ai: true };

function sectionReply(text) {
  const id = /section "sec-([a-z0-9-]+)"/.exec(text)?.[1] || 'hero';
  const headline = (/"headline":"([^"]*)"/.exec(text)?.[1] || `Hand-coded ${id}`).replace(/[<>]/g, '');
  return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><h2>${headline}</h2><p>Bespoke ${id} section with real copy and hand-written CSS for the page.</p></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:clamp(30px,5vw,54px)}#sec-${id} p{color:var(--muted)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'q'.repeat(40)} */</style>` };
}

const DEEPTHINK_REPLY = {
  verdict: 'sharpen',
  extra_emphasis: ['the booking band must show real-time seat scarcity'],
  extra_risks: ['weekend cupping schedule could read as static'],
  angle: 'one origin, one week, poured slowly',
  extra_query: 'weekend cupping workshop pricing mumbai',
  depth: 'deep',
};
const ANALYST_REPLY = {
  business_model: 'walk-in cafe sales plus weekend cupping workshops',
  audience_psyche: 'treats coffee as a small ritual; fears burnt espresso; wants a place to belong',
  competitive_context: 'competes with chain cafes on atmosphere, wins on origin story',
  voice_spec: 'warm, specific, unhurried — say "Coorg" not "premium beans"',
  success_metric: 'a weekend workshop gets booked',
  objections: ['is it worth the price', 'is it far from the metro'],
};

/** The full scripted flow for a successful v10 build. */
function primeFullBuild({ leadGoal = 'book tables for friday nights' } = {}) {
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('EXECUTION PLAN'), reply: { audience: 'coffee lovers in mumbai', page_goal: leadGoal, research_focus: 'mumbai cafe market', queries: ['mumbai specialty coffee trend'], sections_target: 4, emphasis: ['menu tactile'], risks: ['generic cafe look'], tone_note: 'warm, specific, sensory' } },
    { match: (t) => t.includes('DEEP-THINK'), reply: DEEPTHINK_REPLY },
    { match: (t) => t.includes('PROJECT UNDERSTANDING'), reply: ANALYST_REPLY },
    { match: (t) => t.includes('Turn the raw results into MARKET INTELLIGENCE'), reply: { facts: ['Specialty cafes in Mumbai grew ~15% in 2024', 'Cold brew sells at ₹280-350 in Bandra cafes'], implication: 'lead with freshness, honest pricing and the weekend cupping ritual', follow_up: 'cupping workshop ticket prices mumbai 2026' } },
    { match: (t) => t.includes('Decide the design system'), reply: { theme: 'aurora', palette: { accent: '#7c8cff' }, font: 'grotesk', type_scale: 'dramatic', texture: 'grain', motion_intensity: 'bold', ux_flow: ['land → promise', 'scan → proof', 'act → booking'], voice: 'cozy premium', audience: 'coffee lovers', headline_angle: 'Single-origin, slow-poured', must_have: [], research_queries: ['mumbai specialty coffee'] } },
    { match: (t) => t.includes('conversion copywriter'), reply: { ...content } },
    { match: (t) => t.includes('FINAL review'), reply: { verdict: 'good' } },
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: PLAN.sections.map((s) => ({ id: s.id, verdict: 'good' })) } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
    { match: (t) => t.includes('After every finished build'), reply: { title: 'Hero trust rows convert when badges are concrete', domain: 'design', body: 'Name the trust badges with concrete specifics (since-year, origin, price band) — generic badges depress hero conversion.' } },
    { match: (t) => t.includes('DURABLE SKILLS'), reply: { title: 'Cafe heroes convert with scent words', domain: 'copy', body: 'Name the sensory specifics in hero copy — origin, roast, aroma — because cafe visitors scan for freshness cues before price.', source: 'example.com' } },
  );
  ddgUp = true;
  ddgByQuery = (q) => (q.includes('cupping workshop ticket')
    ? [{ title: 'Cupping workshops Mumbai price list', snippet: 'Weekend cupping workshops in Mumbai run ₹900-1400 per seat in 2026.' }]
    : [
        { title: 'Mumbai specialty coffee scene grows', snippet: '15% growth in specialty cafes across Mumbai in 2024.' },
        { title: 'Cold brew pricing in Mumbai', snippet: 'Bandra cafes sell cold brew at ₹280-350.' },
      ]);
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

/* ══ 1. ROSTER — twelve specialists ════════════════════════════════ */
section('ROSTER — twelve specialists');
{
  const keys = Object.keys(AGENT_TEAM);
  ok(keys.length === 13, `13 specialists (${keys.join(', ')})`, String(keys.length));
  ok(AGENT_TEAM.analyst && AGENT_TEAM.analyst.emoji === '🧭' && /understanding/.test(AGENT_TEAM.analyst.role), 'the Analyst is on the roster (🧭, project understanding)');
  ok(AGENT_TEAM.skill_researcher && AGENT_TEAM.skill_researcher.emoji === '📚' && /skill/.test(AGENT_TEAM.skill_researcher.role), 'the Skill Researcher is on the roster (📚)');
  ok(AGENT_TEAM.lead.role.includes('deep-thinks'), 'Lead role mentions deep-think');
  ok(TOOLS.research_skill && TOOLS.research_skill.roles.includes('admin'), 'research_skill role-gated for admins');
}

/* ══ 2. DEEP-THINK — plan self-critique & revision ═════════════════ */
section('LEAD DEEP-THINK — think → critique → revise');
{
  primeFullBuild();
  const base = await leadPlan(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', brand });
  const rev = await leadDeepThink(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', brand, plan: base });
  ok(rev.ai === true && rev.sharp === false, 'deep-think ran and asked to sharpen');
  const revised = applyDeepThink(base, rev);
  ok(revised.deep === true, 'revised plan is marked deep');
  ok(revised.emphasis.some((e) => e.includes('seat scarcity')), 'extra_emphasis merged into the plan', revised.emphasis.join('|'));
  ok(revised.risks.some((r) => r.includes('cupping schedule')), 'extra_risks merged');
  ok(revised.angle === 'one origin, one week, poured slowly', 'sharper angle carried');
  ok(revised.queries.includes('weekend cupping workshop pricing mumbai'), 'extra_query appended to research queries');
  ok(revised.depth === 'deep', 'depth escalation recorded');
  ok(revised.queries.length <= 3, 'queries stay capped at 3');

  // caps: a plan already at cap does not overflow
  const full = { ...base, queries: ['a', 'b', 'c'], emphasis: ['1', '2', '3', '4', '5', '6'], risks: ['1', '2', '3', '4', '5'] };
  const capped = applyDeepThink(full, DEEPTHINK_REPLY);
  ok(capped.queries.length === 3 && capped.emphasis.length === 6 && capped.risks.length === 5, 'revisions respect the caps');

  // sharp verdict → plan held
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('DEEP-THINK'), reply: { verdict: 'sharp', extra_emphasis: [], extra_risks: [], angle: '', extra_query: '', depth: 'standard' } });
  const rev2 = await leadDeepThink(env, { kind: 'landing', brief: 'x', brand, plan: base });
  ok(rev2.ai === true && rev2.sharp === true, 'sharp verdict recorded (plan held up)');
  const held = applyDeepThink(base, rev2);
  ok(held.emphasis.length === base.emphasis.length && held.queries.length === base.queries.length, 'sharp verdict changes nothing');

  // outage → empty revision, never throws
  sarvamScript.length = 0;
  const rev3 = await leadDeepThink(env, { kind: 'landing', brief: 'x', brand, plan: base });
  ok(rev3.ai === false && rev3.sharp === true, 'deep-think outage degrades to no-revision');
  ok(applyDeepThink(base, rev3) === base, 'non-AI revision leaves the plan untouched (pure)');
}

/* ══ 3. ANALYST — the project understanding artifact ═══════════════ */
section('ANALYST — project understanding');
{
  primeFullBuild();
  const u = await projectUnderstanding(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', brand });
  ok(u && u.ai === true, 'understanding artifact built');
  ok(u.business_model.includes('cupping workshops'), 'business model captured');
  ok(u.audience_psyche.includes('ritual'), 'audience psyche captured');
  ok(u.objections.length === 2, 'objections listed');
  const block = understandingBlock(u);
  ok(block.includes('BUSINESS MODEL:') && block.includes('AUDIENCE PSYCHE:') && block.includes('OBJECTIONS TO ANSWER:') && block.includes('THIS PAGE WINS IF:'), 'understandingBlock formats all sections');

  // empty reply → '' (model returned nothing usable)
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('PROJECT UNDERSTANDING'), reply: {} });
  ok((await projectUnderstanding(env, { kind: 'landing', brief: 'x', brand })) === '', 'empty reply → no artifact, no throw');
  // outage → ''
  sarvamScript.length = 0;
  ok((await projectUnderstanding(env, { kind: 'landing', brief: 'x', brand })) === '', 'analyst outage degrades silently');
  ok(understandingBlock('') === '' && understandingBlock(null) === '', 'understandingBlock of nothing is empty');
}

/* ══ 4. ENFORCE CONTRAST — WCAG math on the palette ════════════════ */
section('ENFORCE CONTRAST — AI hues, math ratios');
{
  ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.1, 'contrastRatio(white, black) = 21');

  // Dark bg, too-dark ink → pushed lighter until ≥7:1
  const dark = enforceContrast({ bg: '#0a0d18', ink: '#333344', muted: '#2a2a35', accent: '#14141f' });
  ok(contrastRatio(dark.ink, dark.bg) >= 7, `ink lifted to ≥7:1 (${contrastRatio(dark.ink, dark.bg).toFixed(2)})`);
  ok(contrastRatio(dark.muted, dark.bg) >= 4.5, `muted lifted to ≥4.5:1 (${contrastRatio(dark.muted, dark.bg).toFixed(2)})`);
  ok(contrastRatio(dark.accent, dark.bg) >= 3, `accent lifted to ≥3:1 (${contrastRatio(dark.accent, dark.bg).toFixed(2)})`);
  ok(dark.bg === '#0a0d18', 'background is never touched');

  // Light bg, too-light text → pushed darker
  const light = enforceContrast({ bg: '#faf7f2', ink: '#d8d2c8', muted: '#e5ded2', accent: '#f2e7d8' });
  ok(contrastRatio(light.ink, light.bg) >= 7, `light-bg ink darkened to ≥7:1 (${contrastRatio(light.ink, light.bg).toFixed(2)})`);
  ok(contrastRatio(light.muted, light.bg) >= 4.5, `light-bg muted darkened to ≥4.5:1 (${contrastRatio(light.muted, light.bg).toFixed(2)})`);
  ok(contrastRatio(light.accent, light.bg) >= 3, `light-bg accent darkened to ≥3:1 (${contrastRatio(light.accent, light.bg).toFixed(2)})`);

  // Good palette passes through unchanged
  const good = { bg: '#0a0d18', ink: '#eef1fb', muted: '#98a1c0', accent: '#7c8cff' };
  const same = enforceContrast(good);
  ok(same.ink === good.ink && same.muted === good.muted && same.accent === good.accent, 'a compliant palette is left untouched');
  ok(enforceContrast({}).ink === undefined, 'no bg → no-op (never throws)');
  ok(enforceContrast(null).bg === undefined, 'null palette → no-op');
}

/* ══ 5. DESIGN BRIEF v2 — tokens, UX flow, enforced palette ════════ */
section('ART DIRECTOR v2 — design-system tokens + UX flow');
{
  primeFullBuild();
  const t = await designBrief(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', style: '', brand, lead: null, understanding: null });
  ok(t.ai === true, 'design brief AI path ran');
  ok(t.design.type_scale === 'dramatic' && t.design.texture === 'grain' && t.design.motion_intensity === 'bold', 'type scale / texture / motion intensity parsed', JSON.stringify([t.design.type_scale, t.design.texture, t.design.motion_intensity]));
  ok(Array.isArray(t.design.ux_flow) && t.design.ux_flow.length === 3 && t.design.ux_flow[0].includes('promise'), 'ux_flow captured');
  ok(contrastRatio(t.design.palette.accent, t.design.palette.bg) >= 3 || t.design.palette.accent !== '#7c8cff', 'palette passed the contrast gate');

  // Model omitted the v10 fields → hard defaults, still coherent
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t2) => t2.includes('Decide the design system'), reply: { theme: 'onyx', palette: {}, font: 'grotesk', voice: 'calm precision', audience: 'founders' } });
  const t2 = await designBrief(env, { kind: 'landing', brief: 'x', style: '', brand });
  ok(t2.ai === true && t2.design.type_scale === 'classic' && t2.design.motion_intensity === 'balanced', 'omitted tokens fall back to classic/balanced');
  ok(t2.design.texture === 'grain', 'onyx theme defaults to grain texture', t2.design.texture);
  ok(Array.isArray(t2.design.ux_flow) && t2.design.ux_flow.length === 0, 'missing ux_flow → empty array');
  // outage → deterministic fallback still returns a design
  sarvamScript.length = 0;
  const t3 = await designBrief(env, { kind: 'landing', brief: 'x', style: '', brand });
  ok(t3.ai === false && t3.design && t3.design.themeLabel, 'director outage → deterministic design, never throws');
}

/* ══ 6. GLOBAL CSS v2 — tokens + motion/texture variants ═══════════ */
section('GLOBAL CSS v2 — design tokens');
{
  const g1 = globalCss({ ...design, type_scale: 'dramatic', motion_intensity: 'bold', texture: 'grain' });
  ok(g1.css.includes('--accent-soft:'), '--accent-soft token present');
  ok(g1.css.includes('--step-0:') && g1.css.includes('--step-5:'), 'fluid type-scale steps present');
  ok(g1.css.includes('--dur-2:.8s') && g1.css.includes('--shadow-lift:'), 'bold motion → longer reveals + shadow tokens');
  ok(/data-rev]\{opacity:0;transform:translateY\(34px\)/.test(g1.css), 'bold reveal shifts 34px');
  ok(g1.css.includes('feTurbulence'), 'grain texture emits the film-grain overlay');

  const g2 = globalCss({ ...design, type_scale: 'compact', motion_intensity: 'calm', texture: 'clean' });
  ok(g2.css.includes('--dur-2:.55s') && /translateY\(16px\)/.test(g2.css), 'calm motion → shorter, shallower reveals');
  ok(g2.css.includes('/* clean texture — flat, no overlay */'), 'clean texture emits no overlay');
  ok(!g2.css.includes('feTurbulence'), 'clean texture has no grain');

  const g3 = globalCss({ ...design, type_scale: 'classic', motion_intensity: 'balanced', texture: 'grid' });
  ok(g3.css.includes('body::before') && g3.css.includes('linear-gradient(var(--border)'), 'grid texture emits the structural grid');
  ok(/translateY\(26px\)/.test(g3.css) && g3.css.includes('--dur-2:.7s'), 'balanced motion matches the v9 baseline');
}

/* ══ 7. RESEARCH — round 2 chases the follow-up ════════════════════ */
section('RESEARCHER v10 — two-round research');
{
  primeFullBuild();
  const team = createTeamRun({});
  const ri = await researchIntelligence(env, { queries: ['mumbai specialty coffee trend'], brief: 'cozy coffee shop', brand, team });
  ok(ri.ai === true, 'synthesis succeeded');
  ok(ri.follow_up === 'cupping workshop ticket prices mumbai 2026', 'follow_up surfaced by the synthesis', ri.follow_up);
  ok(ri.block.includes('₹900-1400'), 'round-2 facts merged into the intelligence block');
  ok(ri.facts.length > 2, 'facts grew past the first round');
  ok(team.trace.some((r) => r.agent === 'Researcher' && /follow-up/.test(r.action)), 'Researcher traced chasing the follow-up');

  // no follow_up → single round, no extra rows
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('MARKET INTELLIGENCE'), reply: { facts: ['Only fact.'], implication: 'go', follow_up: '' } });
  const team2 = createTeamRun({});
  const ri2 = await researchIntelligence(env, { queries: ['mumbai cafe market'], brief: '', brand, team: team2 });
  ok(ri2.ai === true && ri2.follow_up === '' && !team2.trace.some((r) => /follow-up/.test(r.action)), 'no follow_up → no second round');
  // synthesis outage → raw facts
  sarvamScript.length = 0;
  const ri3 = await researchIntelligence(env, { queries: ['mumbai cafe market'], brief: '', brand, team: null });
  ok(ri3.ai === false && ri3.block.includes('MARKET FACTS'), 'synthesis outage → raw facts degrade');
  // web outage → honest empty
  ddgUp = false;
  const ri4 = await researchIntelligence(env, { queries: ['mumbai cafe market'], brief: '', brand, team: null });
  ok(ri4.block === '' && ri4.ai === false && ri4.follow_up === '', 'web outage → empty, never throws');
  ddgUp = true;
}

/* ══ 8. ARCHITECT — journey-mapped sections ════════════════════════ */
section('ARCHITECT — UX-flow journey mapping');
{
  primeFullBuild();
  const t = await designBrief(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', style: '', brand });
  const p = await planSections(env, { kind: 'landing', brief: 'cozy mumbai coffee shop', brand, thought: t, content, lead: null, understanding: ANALYST_REPLY });
  ok(p.ai === true, 'architect AI path ran');
  ok(p.sections[0].id === 'hero', 'hero first');
  ok(p.sections.every((s) => typeof s.journey === 'string'), 'every section carries a journey field');
  ok(p.sections.some((s) => /promise/.test(s.journey || '')), 'journey beats parsed from the plan reply', p.sections.map((s) => s.journey).join('|'));
  ok(sarvamSeen.some((txt) => txt.includes('UX FLOW the visitor travels') && txt.includes('act → booking')), 'the ux_flow reaches the architect prompt');

  // engineer prompt carries journey + type scale + motion intensity
  const ctx = { kind: 'landing', brief: 'cozy mumbai coffee shop', brand, thought: t, content, design: t.design, team: createTeamRun({}), section: PLAN.sections[1] };
  const out = await G.codeSection(env, ctx);
  ok(out && out.ai === true, 'section coded');
  ok(sarvamSeen.some((txt) => txt.includes('JOURNEY STAGE (serve exactly this beat): scan → proof')), 'journey stage reaches the engineer prompt');
  ok(sarvamSeen.some((txt) => txt.includes('TYPE SCALE: dramatic')), 'type scale reaches the engineer prompt');
  ok(sarvamSeen.some((txt) => txt.includes('MOTION INTENSITY: bold')), 'motion intensity reaches the engineer prompt');
}

/* ══ 9. SKILL RESEARCHER — researches and builds skills ════════════ */
section('SKILL RESEARCHER — web-researched skills');
{
  const st = memStore();
  primeFullBuild();
  const note = await researchAndLearnSkill(env, st, 'u_sr', { topic: 'cafe website hero best practices', brief: 'cozy mumbai cafe', brand });
  ok(note.includes('learned'), 'skill researched + stored', note);
  const lib = JSON.parse(await st.get('skills:library:u_sr'));
  ok(lib.length === 1 && lib[0].source === 'skill-research', 'skill stored with the skill-research source');
  ok(/scent words/.test(lib[0].title) && lib[0].body.length >= 40, 'skill carries RULES, not a topic name');
  ok(lib[0].domain === 'copy', 'domain respected');

  // model says skip → ''
  sarvamScript.length = 0;
  sarvamScript.push({ match: () => true, reply: { skip: true } });
  ok((await researchAndLearnSkill(env, st, 'u_sr', { topic: 'anything at all here' })) === '', 'junk results → honest skip');

  // web down → ''
  primeFullBuild();
  ddgUp = false;
  ok((await researchAndLearnSkill(env, st, 'u_sr', { topic: 'cafe website hero best practices' })) === '', 'web outage → skip, never throws');
  ddgUp = true;

  // no store / short topic → '' without any call
  const seenBefore = sarvamSeen.length;
  ok((await researchAndLearnSkill(env, null, 'u', { topic: 'cafe website hero best practices' })) === '', 'no store → no-op');
  ok((await researchAndLearnSkill(env, st, 'u', { topic: 'hi' })) === '', 'short topic → no-op');
  ok(sarvamSeen.length === seenBefore, 'guards make zero AI calls');

  // sharpen on re-research (same title)
  primeFullBuild();
  const again = await researchAndLearnSkill(env, st, 'u_sr', { topic: 'cafe website hero best practices' });
  ok(again.includes('sharpened'), 're-researching the same topic sharpens the skill', again);
  const lib2 = JSON.parse(await st.get('skills:library:u_sr'));
  ok(lib2.length === 1, 'still no duplicates');
}

/* ══ 10. FULL v10 BUILD — every new stage in the trace ═════════════ */
section('BUILD v10 — the full deep-thought pipeline');
{
  primeFullBuild();
  const st = memStore();
  const res = await buildWebsite(env, st, { uid: 'u_v10', displayName: 'Owner' },
    { title: 'Musafir Coffee', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours.' }, 'https://worker.test');
  ok(res.ok === true && res.builder === 'ai', 'v10 build succeeds + hand-coded', res.builder);
  ok(res.deep === true, 'response marks the run deep-thought');
  const stages = (res.stages || []).map((s) => s.stage);
  for (const s of ['lead', 'understand', 'think', 'research', 'write', 'polish', 'plan', 'review', 'wire', 'reflect', 'skill']) {
    ok(stages.includes(s), `stage present: ${s}`);
  }
  ok((res.team || []).some((r) => r.agent === 'Analyst' && r.ok === true), 'Analyst traced');
  ok((res.team || []).some((r) => r.agent === 'Lead' && /deep-thinking/.test(r.action)), 'Lead deep-think traced');
  ok((res.team || []).some((r) => r.agent === 'Skill Researcher' && r.ok === true), 'Skill Researcher traced');
  ok(res.understanding && res.understanding.success_metric, 'response carries the understanding artifact');
  ok(res.reflected && res.reflected.includes('learned'), 'Reflector note present');
  const lib = JSON.parse(await st.get('skills:library:u_v10'));
  ok(lib.length === 2, `library holds reflector + skill-researcher lessons (${lib.length})`, String(lib.length));
  ok(lib.some((s) => s.source === 'build-reflection') && lib.some((s) => s.source === 'skill-research'), 'both self-evolution sources present');
  ok(sarvamSeen.some((t) => t.includes('AUDIENCE PSYCHE: treats coffee as a small ritual')), 'understanding flows into specialist prompts');
  ok(sarvamSeen.some((t) => t.includes('CRAFT EMPHASIS: menu tactile; the booking band must show real-time seat scarcity')), 'deep-think emphasis flows into specialist prompts');
  // the analyst ran exactly once INSIDE this build (window over sarvamSeen)
  const windowStart = sarvamSeen.findLastIndex((t) => t.includes('EXECUTION PLAN'));
  ok(sarvamSeen.slice(windowStart).filter((t) => t.includes('PROJECT UNDERSTANDING')).length === 1, 'analyst ran exactly once per build');
}

/* ══ 11. FALLBACK PATH — v10 machinery can never kill a build ══════ */
section('DEGRADATION — dead web + dead skills + dead reflection');
{
  sarvamScript.length = 0; // every sarvam call fails
  ddgUp = false;
  const st = memStore();
  const res = await buildWebsite(env, st, { uid: 'u_deg', displayName: 'Owner' },
    { title: 'Resilient Cafe', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai that must never fail to ship.' }, 'https://worker.test');
  ok(res.ok === true, 'build still ships with everything down');
  ok(res.builder === 'signature' || res.builder === 'ai+engine', 'honest builder label on full outage', res.builder);
  const stages = (res.stages || []).map((s) => s.stage);
  ok(stages.includes('understand'), 'understand stage recorded even in degradation');
  ok(!stages.includes('skill') && !stages.includes('reflect'), 'reflect/skill skipped on fallback renders — nothing bespoke to learn from (by design)');
  const lib = JSON.parse(await st.get('skills:library:u_deg')) || [];
  ok(Array.isArray(lib) && lib.length === 0, 'nothing fake learned during an outage');
  ddgUp = true;
}

/* ══ 12. research_skill TOOL — registry + MCP + runTool ════════════ */
section('research_skill TOOL — the capability is exposed');
{
  ok(TOOLS.research_skill && TOOLS.research_skill.tier === 'write', 'research_skill registered as a write tool');
  ok(Array.isArray(TOOLS.research_skill.roles) && TOOLS.research_skill.roles.includes('admin'), 'role-gated (admin can call)');
  ok(M.TOOL_SCHEMAS.research_skill && M.TOOL_SCHEMAS.research_skill.required.includes('topic'), 'MCP schema requires topic');
  ok(M.SERVER_VERSION === '7.0.0', 'MCP server bumped to v7.0.0', M.SERVER_VERSION);

  // runTool happy path
  primeFullBuild();
  const st = memStore();
  const user = { uid: 'u_tool', role: 'admin', displayName: 'Owner' };
  const r = await AS.runTool({ tool: 'research_skill', args: { topic: 'cafe website menu page patterns' } }, env, st, user, {});
  ok(r.ok === true && /learned/.test(r.note), 'runTool(research_skill) stores a skill', r.note || r.error);
  const lib = JSON.parse(await st.get('skills:library:u_tool'));
  ok(lib.length === 1 && lib[0].source === 'skill-research', 'tool path stores with the skill-research source');

  // validation + honest failure
  const bad = await AS.runTool({ tool: 'research_skill', args: { topic: 'hi' } }, env, st, user, {});
  ok(bad.ok === false && /topic/.test(bad.error), 'short topic rejected');
  sarvamScript.length = 0;
  ddgUp = false;
  const down = await AS.runTool({ tool: 'research_skill', args: { topic: 'cafe website menu page patterns' } }, env, st, user, {});
  ok(down.ok === false && /unreachable|transferable/.test(down.error), 'web down → honest failure, no fake skill');
  ddgUp = true;
  const libAfter = JSON.parse(await st.get('skills:library:u_tool'));
  ok(libAfter.length === 1, 'failed research stored nothing');
}

/* ══ Outro ═════════════════════════════════════════════════════════ */
console.log(`\n${'═'.repeat(44)}`);
if (failures.length) {
  console.log(`  FAILURES:`);
  for (const f of failures) console.log(`   • ${f}`);
}
console.log(`AGENT V10: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
