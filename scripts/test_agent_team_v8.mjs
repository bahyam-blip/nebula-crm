#!/usr/bin/env node
/**
 * test_agent_team_v8.mjs — the multi-agent runtime (GLM-class agentic
 * engineering re-engineered for Nebula).
 *
 * Covers: the agent roster, the team-run trace bus (record/stages/summary),
 * runAgent success + failure tracing, the Lead orchestrator (adaptive plan
 * + deterministic fallback + budget clamps), leadBlock formatting,
 * codegenSite traced through named agents INCLUDING the QA rework loop
 * (critique reaches the engineer's prompt), buildWebsite returning the
 * full team trace + summary, and refineSite traced end-to-end.
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
const CG = await import('../cloudflare/worker/src/emailer/codegen.js');
const B = await import('../cloudflare/worker/src/emailer/builder.js');
const { AGENT_TEAM, createTeamRun, runAgent, leadPlan, leadBlock, defaultLeadPlan } = A;
const { codegenSite, planSections } = CG;
const { buildWebsite, refineSite } = B;

/* ── Sarvam fetch mock (scripted + captured) ─────────────────────── */
const sarvamScript = [];
const sarvamSeen = [];
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
  return new Response(JSON.stringify({ error: `unmocked ${u}` }), { status: 404 });
};

const env = { SARVAM_API_KEY: 'sarvam_test', MEDIA: {
  async put(key, value, opts) { this.__map = this.__map || new Map(); this.__map.set(key, { value, opts }); return { key }; },
  async get(key) { return null; },
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
function primeCodegen({ flagMenu = false } = {}) {
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: flagMenu
      ? { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'menu', verdict: 'fix', note: 'grid collapses on mobile' }, { id: 'contact', verdict: 'good' }] }
      : { verdicts: PLAN.sections.map((s) => ({ id: s.id, verdict: 'good' })) } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
  );
}

/* ── Minimal in-memory state store ───────────────────────────────── */
function memStore() {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}

/* ══ 1. THE ROSTER ═════════════════════════════════════════════════ */
section('AGENT ROSTER');
{
  const keys = Object.keys(AGENT_TEAM);
  ok(keys.length === 13, `thirteen named specialists on the team (${keys.join(', ')})`);
  ok(AGENT_TEAM.reflector?.role.toLowerCase().includes('lesson'), 'the Reflector turns builds into lessons');
  ok(keys.every((k) => AGENT_TEAM[k].name && AGENT_TEAM[k].emoji && AGENT_TEAM[k].role), 'every agent has name, emoji and role');
  ok(AGENT_TEAM.lead.role.includes('orchestrator'), 'the Lead is the orchestrator');
  ok(AGENT_TEAM.engineer.role.toLowerCase().includes('hand-codes'), 'the Engineer hand-codes');
  ok(AGENT_TEAM.qa.role.toLowerCase().includes('review'), 'QA reviews the code');
}

/* ══ 2. TEAM RUN — the trace bus ═══════════════════════════════════ */
section('TEAM RUN (trace bus)');
{
  const team = createTeamRun({ kind: 'landing', title: 'T' });
  team.record('director', 'designing the art direction', { ok: true, ai: true, ms: 1200, detail: 'onyx direction' });
  team.record('engineer', 'hand-coding "Menu"', { ok: true, ai: true, ms: 3400, detail: 'sec-menu written' });
  team.record('builder', 'wiring & hosting the page', { ok: true, ai: false, detail: '4 sections assembled' });
  team.record('researcher', 'scanning the live web', { ok: false, ai: true, ms: 900, detail: 'web unreachable' });
  team.stage('think', true, true, 'AI art direction');
  ok(team.trace.length === 4, 'trace records every invocation');
  ok(team.trace[0].agent === 'Art Director' && team.trace[0].emoji === '🎨', 'rows resolve the roster entry');
  ok(team.trace[0].ms === 1200 && team.trace[0].ai === true && team.trace[0].ok === true, 'rows carry duration + ai + ok');
  ok(team.trace[2].ai === false, 'deterministic steps record ai:false');
  ok(team.trace[3].ok === false, 'failures are recorded honestly');
  ok(team.stages.length === 1 && team.stages[0].stage === 'think', 'legacy stage rows recorded in parallel');
  const sum = team.summary();
  ok(sum.agents === 4 && sum.ai_calls === 3 && sum.failed === 1 && sum.ms >= 1, `summary counts agents/ai/fails/time (${JSON.stringify(sum)})`);
  const unknown = createTeamRun({});
  unknown.record('mystery', 'doing something');
  ok(unknown.trace[0].agent === 'mystery' && unknown.trace[0].emoji === '🤖', 'unknown agents still trace safely');
}

/* ══ 3. runAgent — success + failure tracing ═══════════════════════ */
section('runAgent — traced AI calls');
{
  sarvamScript.length = 0;
  sarvamScript.push({ match: () => true, reply: { answer: 42 } });
  const team = createTeamRun({});
  const out = await runAgent(env, team, 'architect', 'planning the sections', [
    { role: 'system', content: 'sys' }, { role: 'user', content: 'user' },
  ], { json: true, maxTokens: 100 }, (j) => `${j.answer} answer`);
  ok(out.answer === 42, 'runAgent returns the parsed sarvam result');
  ok(team.trace[0].ok === true && team.trace[0].ai === true && team.trace[0].ms >= 1, 'success traced with duration');
  ok(team.trace[0].detail === '42 answer', 'detailFn distills the human line', team.trace[0].detail);

  sarvamScript.length = 0; // no script → 500
  let threw = false;
  try { await runAgent(env, team, 'engineer', 'hand-coding "X"', [{ role: 'user', content: 'x' }], {}); }
  catch { threw = true; }
  ok(threw, 'runAgent re-throws so caller fallbacks still work');
  ok(team.trace[1].ok === false && /no scripted reply|Sarvam 500/.test(team.trace[1].detail), 'failure traced with the reason', team.trace[1].detail);
}

/* ══ 4. THE LEAD — adaptive orchestrator ═══════════════════════════ */
section('LEAD — the orchestrator agent');
{
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('elite multi-agent web studio'), reply: {
    audience: 'regulars who commute past the shop', research_focus: 'mumbai cafe pricing',
    queries: ['mumbai specialty coffee trend', 'cold brew price india', 'extra query gets dropped'],
    sections_target: 7, emphasis: ['menu must feel tactile', 'cupping story'], risks: ['generic cafe look'],
    tone_note: 'warm and specific — name dishes and neighbourhoods',
  } });
  const team = createTeamRun({});
  const lead = await leadPlan(env, { kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai.', brand, style: '', team });
  ok(lead.ai === true, 'Lead AI plan used');
  ok(lead.audience.length > 0 && lead.tone_note.includes('warm'), 'plan carries audience + tone');
  ok(lead.queries.length === 2, `queries capped at 2 (got ${lead.queries.length})`);
  ok(lead.sections_target === 7, `sections_target clamped into the v15 5-7 budget (got ${lead.sections_target})`);
  ok(lead.emphasis.length === 2 && lead.risks.length === 1, 'emphasis + risks carried');
  ok(team.trace.some((r) => r.agent === 'Lead' && r.ok === true), 'Lead invocation traced');
  ok(sarvamSeen.at(-1).includes('A cozy specialty coffee shop'), 'Lead prompt carries the brief');

  // Fallback: sarvam down → deterministic plan, never throws
  sarvamScript.length = 0;
  const lead2 = await leadPlan(env, { kind: 'event', brief: 'A pop-up supper club.', brand });
  ok(lead2.ai === false && Array.isArray(lead2.emphasis) && lead2.emphasis.length >= 1, 'Lead falls back to a deterministic plan');
  const lead3 = defaultLeadPlan({ kind: 'portfolio', brief: '', brand });
  ok(lead3.sections_target === 6 && lead3.tone_note.length > 10, 'deterministic plan is complete for every kind (6 sections, v15 first-round depth)');

  // leadBlock formatting
  const block = leadBlock(lead);
  ok(block.includes('AUDIENCE:') && block.includes('TONE:') && block.includes('CRAFT EMPHASIS:') && block.includes('AVOID:'), 'leadBlock formats all four lines');
  ok(leadBlock(null) === '', 'leadBlock empty when no plan');
}

/* ══ 5. CODEGEN THROUGH THE TEAM + QA REWORK LOOP ══════════════════ */
section('CODEGEN — named agents + QA rework loop');
{
  primeCodegen({ flagMenu: true });
  const team = createTeamRun({ kind: 'landing', title: 'Musafir' });
  const lead = defaultLeadPlan({ kind: 'landing', brief: 'coffee', brand });
  const cg = await codegenSite(env, { kind: 'landing', brief: 'A cozy specialty coffee shop.', brand, thought, content, lead, team });
  ok(cg.html.startsWith('<!DOCTYPE html>') && cg.html.includes('</html>'), 'codegen produced a complete page');
  const agents = team.trace.map((r) => r.agent);
  ok(agents.includes('Architect'), 'Architect traced on the plan');
  ok(team.trace.filter((r) => r.agent === 'Engineer').length >= 4, `Engineer traced per section + rework (${team.trace.filter((r) => r.agent === 'Engineer').length} calls)`);
  ok(agents.includes('QA Director'), 'QA Director traced on review');
  ok(agents.includes('Builder') && team.trace.find((r) => r.agent === 'Builder')?.ai === false, 'Builder traced deterministically on wire');
  ok(team.stages.some((s) => s.stage === 'plan') && team.stages.some((s) => s.stage.startsWith('code:menu')) , 'stage mirror keeps the legacy trace');
  ok(team.stages.filter((s) => s.stage === 'code:menu').some((s) => s.detail.includes('re-coded')), 'rework visible in the stage trace', JSON.stringify(team.stages.filter((s) => s.stage.startsWith('code:'))));

  // THE REWORK LOOP: the QA critique reaches the engineer's prompt
  const reworkCall = sarvamSeen.find((t) => t.includes('QA REWORK NOTE'));
  ok(!!reworkCall, 'QA critique was fed back to the engineer');
  ok(reworkCall.includes('grid collapses on mobile'), 'the exact critique text reaches the rework call');
  ok(reworkCall.includes('HAND-CODING one section'), 'rework call is a real engineer call');

  // Engineer hand-code rows carry per-section action labels
  const menuRow = team.trace.find((r) => r.agent === 'Engineer' && r.action.includes('Menu'));
  ok(!!menuRow, `engineer rows are labeled with the section name ("${menuRow?.action}")`);
}

/* ══ 6. PLANS SECTIONS CAP FROM THE LEAD ═══════════════════════════ */
section('ARCHITECT — Lead plan constrains the IA');
{
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('Plan its information architecture'), reply: { sections: [...PLAN.sections, { id: 'extra1', name: 'Extra', goal: 'g', layout: 'l', content_keys: ['marquee'], motion: 'm' }, { id: 'extra2', name: 'Extra2', goal: 'g', layout: 'l', content_keys: ['stats'], motion: 'm' }], nav: ['hero', 'menu', 'contact'] } });
  const lead5 = { ...defaultLeadPlan({ kind: 'landing', brief: '', brand }), sections_target: 4 };
  const p = await planSections(env, { kind: 'landing', brief: 'coffee', brand, thought, content, lead: lead5, team: null });
  ok(p.sections.length === 4, `plan capped at the Lead's sections_target (${p.sections.length})`);
  ok(sarvamSeen.at(-1).includes('PLAN EXACTLY 4 SECTIONS'), 'architect prompt carries the Lead instruction');
  ok(sarvamSeen.at(-1).includes('PLAN EXACTLY'), 'cap instruction present');
}

/* ══ 7. buildWebsite — the full team in the response ═══════════════ */
section('BUILD RESPONSE — team trace + summary');
{
  primeCodegen();
  sarvamScript.unshift(
    { match: (t) => t.includes('elite multi-agent web studio'), reply: { audience: 'coffee lovers in mumbai', research_focus: 'mumbai cafe market', queries: ['mumbai specialty coffee trend'], sections_target: 4, emphasis: ['menu tactile'], risks: ['generic cafe look'], tone_note: 'warm, specific, sensory' } },
    { match: (t) => t.includes('Decide the design system'), reply: { theme: 'aurora', palette: { accent: '#7c8cff' }, font: 'grotesk', voice: 'cozy premium', audience: 'coffee lovers', headline_angle: 'Single-origin, slow-poured', must_have: [], research_queries: ['mumbai specialty coffee'] } },
    { match: (t) => t.includes('conversion copywriter'), reply: { title: 'Musafir Coffee', kicker: 'Mumbai', headline: 'Coffee worth the trip', sub: 'Single-origin pours and weekend cuppings.', primary_cta: { label: 'Find us', href: 'mailto:hi@musafir.test' }, features: [{ icon: '☕', title: 'Single origin', text: 'Coorg beans, roasted weekly.' }], contact: { email: 'hi@musafir.test' } } },
    { match: (t) => t.includes('FINAL review'), reply: { verdict: 'good' } },
  );
  const st = memStore();
  const res = await buildWebsite(env, st, { uid: 'u_team', displayName: 'Owner' },
    { title: 'Musafir Coffee', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours.' }, 'https://worker.test');
  ok(res.ok === true && res.builder === 'ai', 'multi-agent build succeeds with builder=ai', JSON.stringify({ builder: res.builder, err: res.error }));
  const teamAgents = (res.team || []).map((r) => r.agent);
  for (const expected of ['Lead', 'Researcher', 'Art Director', 'Copywriter', 'Architect', 'Engineer', 'QA Director', 'Builder']) {
    ok(teamAgents.includes(expected), `team trace includes ${expected}`, JSON.stringify(teamAgents));
  }
  ok((res.team || []).every((r) => r.agent && r.action && typeof r.ms === 'number' && typeof r.ai === 'boolean'), 'every team row is display-ready');
  ok(res.team_summary && res.team_summary.ai_calls >= 8, `team summary counts the AI calls (${res.team_summary?.ai_calls})`, JSON.stringify(res.team_summary));
  ok(res.team_summary.agents >= 8, `team summary counts distinct agents (${res.team_summary?.agents})`);
  ok(Array.isArray(res.stages) && res.stages[0].stage === 'lead', 'legacy stages still present, lead first');
  ok(sarvamSeen.some((t) => t.includes('TONE: warm, specific, sensory')), 'Lead direction reached specialist prompts');
  ok(sarvamSeen.some((t) => t.includes('AUDIENCE: coffee lovers in mumbai') && t.includes('AVOID: generic cafe look')), 'Lead audience + risks reached the specialists');

  // REFINE — traced through the same team bus
  const rr = await refineSite(env, st, { uid: 'u_team' }, { artifact_id: res.artifact_id, instruction: 'make the headline bolder' }, 'https://worker.test');
  ok(rr.ok === true, 'refine succeeds');
  const refineAgents = (rr.team || []).map((r) => r.agent);
  ok(refineAgents.includes('Copywriter') && refineAgents.includes('Engineer') && refineAgents.includes('QA Director'), 'refine team: copywriter + engineers + QA re-code the page', JSON.stringify(refineAgents));
  ok((rr.team || [])[0].action.includes('change request'), 'refine trace opens with the Lead reading the request');
}

/* ══ 8. TOTAL OUTAGE — the team still ships ════════════════════════ */
section('OUTAGE — honest trace, deterministic safety net');
{
  sarvamScript.length = 0; // everything 500s
  const st = memStore();
  const res = await buildWebsite(env, st, { uid: 'u_out', displayName: 'Owner' },
    { title: 'Bookstore', kind: 'landing', brief: 'A quiet bookstore for people who read slowly. Poetry nights on Fridays.' }, 'https://worker.test');
  ok(res.ok === true, 'total AI outage still ships a page');
  ok((res.team || []).some((r) => r.agent === 'Lead' && r.ok === false), 'failed Lead call traced honestly');
  ok((res.team || []).some((r) => r.agent === 'Builder' && /deterministic engine/i.test(r.detail)), 'engine fallback traced on the Builder row', JSON.stringify((res.team || []).map((r) => `${r.agent}:${r.detail}`)));
  ok(res.stages.some((s) => s.stage === 'render' && /fallback/.test(s.detail)), 'legacy fallback stage intact');
}

console.log(`\n══════════════════════════════════════`);
console.log(`AGENT TEAM v8: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
