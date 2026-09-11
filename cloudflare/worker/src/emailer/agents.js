/**
 * AGENTS — the multi-agent runtime (Agent v11 · IDENTITY).
 *
 * The user asked for the open GLM-class agentic engineering pattern,
 * re-engineered into this app: not one prompt doing everything, but a
 * TEAM of named specialist agents working a shared artifact bus:
 *
 *   • NAMED SPECIALISTS  — every agent has a name, a role and a craft.
 *     A Lead orchestrator reads the brief and decides HOW the team runs
 *     (adaptive plan), then hands artifacts specialist to specialist.
 *   • ISOLATED CONTEXTS  — an agent receives ONLY its role prompt plus
 *     the artifacts it needs (never the whole conversation). That is how
 *     real agent teams avoid context poisoning — and it is also exactly
 *     what keeps every single call inside Sarvam's small completion
 *     budget. The artifact bus IS the context strategy.
 *   • REWORK LOOPS       — reviewers return structured verdicts; failing
 *     work goes back to its author WITH the critique attached, bounded.
 *   • FULL TRACE         — every agent invocation is recorded (who, what,
 *     how long, outcome) and surfaced to the app: the user watches the
 *     team work, and the build response proves there was no template.
 *   • LIVE RUN SINK      — a team run can persist its trace after EVERY
 *     row (the live run doc), so the app polls GET /v1/studio/run and
 *     watches the team work in real time — not a paced ticker.
 *   • SELF-EVOLUTION     — a Reflector distills each finished build into
 *     a reusable skill (learn_skill), so the team measurably improves
 *     with every job it ships.
 *
 * v10 DEEPTHINK — the team got measurably smarter, not just bigger:
 *   • DEEP-THINK (Lead, 2nd pass) — the Lead critiques its own plan and
 *     returns concrete revisions (extra emphasis, extra risks, one extra
 *     research angle). Planning is now think → self-critique → revise,
 *     not one-shot.
 *   • ANALYST (🧭) — builds the PROJECT UNDERSTANDING artifact (business
 *     model, audience psyche, competitive context, voice spec, success
 *     metric) BEFORE design/copy/architecture. Every specialist reads it
 *     — this is "understands the project better", as an artifact.
 *   • SKILL RESEARCHER (📚) — genuinely researches the web for expert
 *     domain knowledge relevant to the brief and distills a NEW skill
 *     into the library (with its source), so the team studies its craft
 *     the way a real studio does. Also exposed as the research_skill
 *     tool (MCP + chat).
 *
 * This module is the runtime; builder.js/codegen.js/designer.js are the
 * team's job description. Agent keys: lead | researcher | director |
 * copywriter | copy_chief | architect | engineer | qa | builder |
 * reflector | analyst | skill_researcher.
 */

import { sarvamChat } from './sarvam.js';

/* ══ The team roster ═════════════════════════════════════════════════ */

export const AGENT_TEAM = {
  lead: { name: 'Lead', emoji: '🧠', role: 'orchestrator — plans, deep-thinks and revises' },
  analyst: { name: 'Analyst', emoji: '🧭', role: 'project understanding: market, audience, voice' },
  researcher: { name: 'Researcher', emoji: '🔍', role: 'live market research' },
  director: { name: 'Art Director', emoji: '🎨', role: 'design system, colour & UX flow' },
  copywriter: { name: 'Copywriter', emoji: '✍️', role: 'conversion copy' },
  copy_chief: { name: 'Copy Chief', emoji: '🧐', role: 'copy review & tightening' },
  architect: { name: 'Architect', emoji: '📐', role: 'information architecture & journey' },
  photographer: { name: 'Photographer', emoji: '📷', role: 'sources real photography for the page' },
  engineer: { name: 'Engineer', emoji: '🛠️', role: 'hand-codes the sections' },
  qa: { name: 'QA Director', emoji: '🔎', role: 'code review & rework' },
  builder: { name: 'Builder', emoji: '🚀', role: 'assembly, hosting & integrity' },
  reflector: { name: 'Reflector', emoji: '🪞', role: 'turns every build into a lesson' },
  skill_researcher: { name: 'Skill Researcher', emoji: '📚', role: 'researches the craft, grows the skill library' },
};

/* ══ Team run — the trace bus ════════════════════════════════════════ */

/**
 * One team run per build. Every AI call goes through runAgent() so the
 * trace captures who did what and how long it took; deterministic steps
 * (wire, host, fallbacks) are recorded directly. The run carries BOTH
 * output shapes: trace (agent rows, new) and stages (legacy rows kept
 * so existing consumers/tests stay valid).
 *
 * v9 LIVE SINK: pass `sink` (an async fn receiving the run doc) and it
 * fires after every recorded row — fire-and-forget, never throws, never
 * blocks the build. This is what makes a run watchable in real time.
 */
export function createTeamRun(meta = {}, sink = null) {
  const emit = () => {
    if (typeof sink !== 'function') return;
    try {
      const out = sink(run.doc());
      if (out && typeof out.catch === 'function') out.catch(() => {});
    } catch { /* the trace must never break the build */ }
  };
  const run = {
    meta, // { kind, title } — what this team is building
    startedAt: Date.now(),
    trace: [],
    stages: [],
    doc() {
      return {
        meta: run.meta,
        started_at: new Date(run.startedAt).toISOString(),
        trace: run.trace,
        stages: run.stages,
        summary: run.summary(),
      };
    },
    record(key, action, { ok = true, ai = true, ms = 0, detail = '' } = {}) {
      const a = AGENT_TEAM[key] || { name: String(key || 'agent'), emoji: '🤖', role: 'specialist' };
      run.trace.push({
        agent: a.name,
        emoji: a.emoji,
        role: a.role,
        action: String(action || '').slice(0, 90),
        ok: ok !== false,
        ai: ai === true,
        ms: Math.max(1, Math.round(ms || 0)),
        detail: String(detail || '').slice(0, 140),
      });
      emit();
    },
    stage(name, ok, ai, detail) {
      run.stages.push({ stage: name, ok: ok !== false, ai: ai === true, detail: String(detail || '').slice(0, 140) });
      emit();
    },
    summary() {
      const aiCalls = run.trace.filter((t) => t.ai).length;
      const failed = run.trace.filter((t) => !t.ok).length;
      return { agents: new Set(run.trace.map((t) => t.agent)).size, ai_calls: aiCalls, failed, ms: Math.max(1, Date.now() - run.startedAt) };
    },
  };
  return run;
}

/** Silent team for direct module use (tests, refine paths) — no-op trace. */
export function silentTeam() {
  return createTeamRun({ kind: 'direct', title: 'direct call' });
}

/**
 * runAgent — one named agent performs one action.
 * Wraps sarvamChat, records the invocation (ok or failed, with duration)
 * into the team trace, and re-throws so the caller's existing fallbacks
 * keep working unchanged. detailFn distills a human line from the result.
 */
export async function runAgent(env, team, key, action, messages, opts = {}, detailFn = null) {
  const T = team || silentTeam();
  const t0 = Date.now();
  try {
    const out = await sarvamChat(env, messages, opts);
    let detail = '';
    if (typeof detailFn === 'function') {
      try { detail = String(detailFn(out) || ''); } catch { detail = ''; }
    }
    T.record(key, action, { ok: true, ai: true, ms: Date.now() - t0, detail });
    return out;
  } catch (e) {
    T.record(key, action, { ok: false, ai: true, ms: Date.now() - t0, detail: String(e?.message || e) });
    throw e;
  }
}

/* ══ The Lead — adaptive team plan (the orchestrator agent) ══════════ */

const LEAD_SYSTEM = `You are the Lead of an elite multi-agent web studio. Your team (researcher, art director, photographer, copywriter, architect, engineers, QA) is about to build a bespoke page. Read the brief and write the EXECUTION PLAN that makes every specialist sharp. Respond with ONLY JSON:

{"brand_name":"THE CLIENT's business or brand name EXACTLY as the brief states it (a quoted name beats everything) — '' only if the brief names none","audience":"who this page must convince, 5-10 words","page_goal":"the ONE thing this page must achieve, 3-8 words (book tables, sell the course, win trust)","research_focus":"the single most valuable thing to learn from the live web for THIS business, one line","queries":["0-2 short, specific web searches"],"image_ideas":["0-3 photo subjects that would make THIS page feel real and specific (e.g. 'barista pouring latte art'), NOT stock clichés"],"sections_target":4,"emphasis":["2-4 parts of this page that deserve the most craft, e.g. 'the menu section must feel tactile'"],"risks":["1-3 ways this build could feel generic or wrong for this audience"],"tone_note":"one line of direction every writer on the team follows"}

Rules:
- Decide from the BRIEF, not habit: a tiffin service and a law firm need different teams' energy.
- brand_name: quote the client's name EXACTLY — every specialist will brand the page with it.
- queries must be things a search engine can actually answer (markets, prices, local facts, trends) — not the business's own name.
- image_ideas must be photographable scenes of THIS business's world (place, product, people, craft) — never abstract 'teamwork' stock.
- sections_target: 4 for a tight page, 5 only when the brief is rich (event agenda, portfolio, report).
- tone_note is ONE sentence, concrete enough to act on ("warm and specific — name the dishes, the neighbourhoods, the people").`;

/** Deterministic plan when the Lead cannot be reached — still useful. */
export function defaultLeadPlan({ kind, brief, brand }) {
  const kindEmphasis = {
    landing: ['the hero must state the promise in one breath', 'proof section with concrete specifics'],
    promo: ['the offer block must feel urgent but honest', 'CTA clarity above the fold'],
    event: ['the agenda must make the day feel worth attending', 'venue/date clarity'],
    portfolio: ['the work grid must show real craft', 'project stories over thumbnails'],
    report: ['the findings must read like research, not filler', 'table + sources credibility'],
    webapp: ['one core interaction done beautifully', 'fast, obvious, thumb-friendly'],
  };
  const kindGoal = {
    landing: 'win trust and drive the first contact',
    promo: 'drive offer redemptions',
    event: 'fill the room with registrations',
    portfolio: 'get commissioned for the next project',
    report: 'make the findings impossible to ignore',
    webapp: 'make the core action effortless',
  };
  return {
    brand_name: '',
    audience: `${kind === 'webapp' ? 'people who need this tool daily' : "the business's real customers"}`,
    page_goal: kindGoal[kind] || kindGoal.landing,
    research_focus: `what customers in this market expect from a ${kind === 'webapp' ? 'tool like this' : 'business like this'}`,
    queries: [],
    image_ideas: [],
    sections_target: 4,
    emphasis: kindEmphasis[kind] || kindEmphasis.landing,
    risks: ['generic stock phrasing', 'sections that could belong to any business'],
    tone_note: 'specific over grand — name real things, keep every line earning its place',
    ai: false,
  };
}

/**
 * LEAD — the orchestrator agent. Runs FIRST so every later specialist
 * works from an explicit plan (this is the GLM-class difference: the
 * team adapts to the brief; the pipeline is not hardwired). Never
 * throws — a failed Lead degrades to the deterministic plan.
 */
export async function leadPlan(env, { kind, brief, brand, site, style, team = null }) {
  const fallback = () => defaultLeadPlan({ kind, brief, brand });
  try {
    const { siteIdentityBlock } = await import('./sitebrand.js');
    const j = await runAgent(
      env,
      team,
      'lead',
      'forming the team plan',
      [
        { role: 'system', content: LEAD_SYSTEM },
        {
          role: 'user',
          content: [
            site ? siteIdentityBlock(site) : (brand?.name ? `BUSINESS CONTEXT (may or may not be the client): ${brand.name}` : ''),
            `PAGE KIND: ${kind}`,
            style ? `STYLE REQUEST: ${style}` : '',
            `BRIEF: ${String(brief).slice(0, 1500)}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: 800, temperature: 0.55 },
      (out) => `${out.sections_target || 4} sections · ${String(out.audience || '').slice(0, 60)}`
    );
    const plan = {
      brand_name: String(j.brand_name || '').slice(0, 80),
      audience: String(j.audience || '').slice(0, 140),
      page_goal: String(j.page_goal || '').slice(0, 90),
      research_focus: String(j.research_focus || '').slice(0, 200),
      queries: Array.isArray(j.queries) ? j.queries.map((q) => String(q).slice(0, 120)).filter(Boolean).slice(0, 2) : [],
      image_ideas: Array.isArray(j.image_ideas) ? j.image_ideas.map((q) => String(q).slice(0, 90)).filter(Boolean).slice(0, 3) : [],
      sections_target: [4, 5].includes(Number(j.sections_target)) ? Number(j.sections_target) : 4,
      emphasis: Array.isArray(j.emphasis) ? j.emphasis.map((e) => String(e).slice(0, 160)).filter(Boolean).slice(0, 4) : [],
      risks: Array.isArray(j.risks) ? j.risks.map((r) => String(r).slice(0, 140)).filter(Boolean).slice(0, 3) : [],
      tone_note: String(j.tone_note || '').slice(0, 220),
      ai: true,
    };
    if (!plan.audience && !plan.tone_note) return fallback();
    return plan;
  } catch {
    return fallback();
  }
}

/** Compact block the Lead's plan becomes inside specialist prompts. */
export function leadBlock(lead) {
  if (!lead) return '';
  const lines = [
    lead.brand_name ? `THE CLIENT IS: "${lead.brand_name}" — brand every name and mention with exactly this` : '',
    lead.audience ? `AUDIENCE: ${lead.audience}` : '',
    lead.page_goal ? `THE PAGE MUST: ${lead.page_goal}` : '',
    lead.tone_note ? `TONE: ${lead.tone_note}` : '',
    lead.emphasis.length ? `CRAFT EMPHASIS: ${lead.emphasis.join('; ')}` : '',
    lead.risks.length ? `AVOID: ${lead.risks.join('; ')}` : '',
    lead.image_ideas?.length ? `PHOTO DIRECTION: ${lead.image_ideas.join('; ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/* ══ The Lead, pass 2 — DEEP-THINK (self-critique & revision) ═════════ */

const DEEPTHINK_SYSTEM = `You are the same Lead, one breath later — now you DEEP-THINK. Re-read your own plan for the build with fresh, adversarial eyes: where would a top-tier studio push harder? Respond with ONLY JSON:

{"verdict":"sharp"|"sharpen","extra_emphasis":["0-3 SPECIFIC craft targets the plan under-weights, each naming the section or moment"],"extra_risks":["0-3 ways this page could still feel generic or miss THIS audience"],"angle":"a sharper narrative angle for the whole page in one line (the idea that makes it memorable), or '' to keep the current one","extra_query":"0-1 additional web search that would materially ground the copy, or ''","depth":"standard"|"deep"}

Rules:
- Critique the PLAN against the BRIEF, not taste: missing proof, missing local truth, missing objection-handling, wrong emphasis.
- extra_emphasis must be actionable ("the booking section needs real-time scarcity, not 'contact us'").
- When the plan is genuinely sharp for a small page, say sharp and keep additions near-empty — do not invent work.
- depth "deep" only when the brief is rich enough to spend one more research round on it.`;

/**
 * LEAD DEEP-THINK — the second planning pass. Takes the Lead's plan and
 * returns REVISIONS (never throws; on any failure the original plan runs
 * unchanged). This is the think → self-critique → revise loop that makes
 * planning an actual reasoning process instead of a single shot.
 */
export async function leadDeepThink(env, { kind, brief, brand, plan, team = null }) {
  const empty = { sharp: true, extra_emphasis: [], extra_risks: [], angle: '', extra_query: '', depth: 'standard', ai: false };
  try {
    const j = await runAgent(
      env,
      team,
      'lead',
      'deep-thinking the plan',
      [
        { role: 'system', content: DEEPTHINK_SYSTEM },
        {
          role: 'user',
          content: [
            `BUSINESS: ${brand.name}${brand.profile?.industry ? ` (${brand.profile.industry})` : ''}`,
            `PAGE KIND: ${kind}`,
            `BRIEF: ${String(brief).slice(0, 1200)}`,
            `MY PLAN SO FAR:\n${JSON.stringify({ audience: plan.audience, page_goal: plan.page_goal, research_focus: plan.research_focus, queries: plan.queries, emphasis: plan.emphasis, risks: plan.risks, tone_note: plan.tone_note }).slice(0, 1100)}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: 500, temperature: 0.5 },
      (out) => (out?.verdict === 'sharpen' ? `plan sharpened: ${String(out.angle || 'revision applied').slice(0, 60)}` : 'plan held up under critique')
    );
    const rev = {
      sharp: j?.verdict !== 'sharpen',
      extra_emphasis: Array.isArray(j?.extra_emphasis) ? j.extra_emphasis.map((e) => String(e).slice(0, 160)).filter(Boolean).slice(0, 3) : [],
      extra_risks: Array.isArray(j?.extra_risks) ? j.extra_risks.map((r) => String(r).slice(0, 140)).filter(Boolean).slice(0, 3) : [],
      angle: String(j?.angle || '').slice(0, 160),
      extra_query: String(j?.extra_query || '').slice(0, 120),
      depth: j?.depth === 'deep' ? 'deep' : 'standard',
      ai: true,
    };
    if (!rev.extra_emphasis.length && !rev.extra_risks.length && !rev.angle && !rev.extra_query) rev.sharp = true;
    return rev;
  } catch {
    return empty;
  }
}

/** Apply a Deep-Think revision to the Lead plan (pure, nothrow). */
export function applyDeepThink(plan, rev) {
  if (!rev || rev.ai !== true) return plan;
  return {
    ...plan,
    emphasis: [...(plan.emphasis || []), ...rev.extra_emphasis].slice(0, 6),
    risks: [...(plan.risks || []), ...rev.extra_risks].slice(0, 5),
    angle: rev.angle || plan.angle || '',
    queries: rev.extra_query && !(plan.queries || []).includes(rev.extra_query)
      ? [...(plan.queries || []), rev.extra_query].slice(0, 3)
      : (plan.queries || []).slice(0, 3),
    depth: rev.depth || plan.depth || 'standard',
    deep: true,
  };
}

/* ══ The Analyst — the PROJECT UNDERSTANDING artifact ════════════════ */

const ANALYST_SYSTEM = `You are the Project Analyst of an elite multi-agent web studio. Before anyone designs or writes a line, YOU produce the PROJECT UNDERSTANDING every specialist will work from. Read the brief like a strategist who has done a thousand of these. Respond with ONLY JSON:

{"business_model":"how this business makes money, one line","audience_psyche":"what this audience already believes, fears and wants — 1-2 sentences, be specific","competitive_context":"what alternatives they'd compare it against and what wins there, one line","voice_spec":"how the brand should sound: 3-5 traits with a do/don't example pair","success_metric":"the ONE behavior that defines this page worked, 3-8 words","objections":["2-4 real reasons a visitor would hesitate to act"]}

Rules:
- Infer from the brief; never invent facts (no fake numbers, no fake history).
- audience_psyche is about THIS audience's real life, not demographics — anchor it in the ACTUAL nouns of the brief (the products, the place, the people it names), never in a generic persona.
- objections must be the kind copy can answer (price, time, trust, effort).`;

/**
 * ANALYST — builds the shared PROJECT UNDERSTANDING artifact. Runs right
 * after the Lead so design, copy and architecture all work from the same
 * model of the business instead of re-inferring it three times. Never
 * throws: on failure the team simply proceeds on the brief (returns '').
 */
export async function projectUnderstanding(env, { kind, brief, brand, site, team = null }) {
  try {
    const { siteIdentityBlock } = await import('./sitebrand.js');
    const j = await runAgent(
      env,
      team,
      'analyst',
      'building the project understanding',
      [
        { role: 'system', content: ANALYST_SYSTEM },
        {
          role: 'user',
          content: [
            site ? siteIdentityBlock(site) : '',
            !site && brand?.profile?.audience ? `STATED AUDIENCE: ${brand.profile.audience}` : '',
            `PAGE KIND: ${kind}`,
            `BRIEF: ${String(brief).slice(0, 1400)}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: 550, temperature: 0.5 },
      (out) => `understood: ${String(out?.success_metric || 'project mapped').slice(0, 60)}`
    );
    const u = {
      business_model: String(j?.business_model || '').slice(0, 160),
      audience_psyche: String(j?.audience_psyche || '').slice(0, 260),
      competitive_context: String(j?.competitive_context || '').slice(0, 200),
      voice_spec: String(j?.voice_spec || '').slice(0, 200),
      success_metric: String(j?.success_metric || '').slice(0, 90),
      objections: Array.isArray(j?.objections) ? j.objections.map((o) => String(o).slice(0, 120)).filter(Boolean).slice(0, 4) : [],
      ai: true,
    };
    // A model that returned nothing usable is treated as a skip.
    if (!u.business_model && !u.audience_psyche && !u.objections.length) return '';
    return u;
  } catch {
    return '';
  }
}

/** Compact block the understanding artifact becomes inside prompts. */
export function understandingBlock(u) {
  if (!u) return '';
  return [
    u.business_model ? `BUSINESS MODEL: ${u.business_model}` : '',
    u.audience_psyche ? `AUDIENCE PSYCHE: ${u.audience_psyche}` : '',
    u.competitive_context ? `COMPETITIVE CONTEXT: ${u.competitive_context}` : '',
    u.voice_spec ? `VOICE SPEC: ${u.voice_spec}` : '',
    u.objections.length ? `OBJECTIONS TO ANSWER: ${u.objections.join('; ')}` : '',
    u.success_metric ? `THIS PAGE WINS IF: ${u.success_metric}` : '',
  ].filter(Boolean).join('\n');
}

/* ══ The Skill Researcher — studies the craft, grows the library ═════ */

const SKILL_RESEARCH_SYSTEM = `You are the Skill Researcher of an elite multi-agent web studio. You research the web to make the team genuinely better at its craft, and distill what you find into DURABLE SKILLS the whole library applies. Respond with ONLY JSON:

{"title":"skill title, 5-12 words, states the RULE not the topic","domain":"design|layout|motion|copy|ux|engineering|marketing","body":"2-4 sentences of concrete RULES distilled from these search results — what to always do, what to avoid, with the specific numbers/patterns found. Max 400 chars.","source":"the most credible source domain from the results, or 'synthesis'"}

Rules:
- Distill ONLY what the results actually support — never invent a statistic or claim.
- A skill is a RULE the team can apply on the next build, not a summary of a page.
- If the results are junk/SEO noise with nothing transferable, respond with {"skip":true}.`;

/**
 * SKILL RESEARCHER — genuinely researches a craft topic on the live web
 * and distills the findings into a new library skill (with source). This
 * is the "research skills and build them" capability, for real: web
 * search → synthesis → learn_skill, deduped and capped by the library.
 * Never throws. Returns the trace note, or '' when skipped.
 */
export async function researchAndLearnSkill(env, store, uid, { topic, brief = '', brand = null, team = null, source = 'skill-research' }) {
  try {
    if (!store || !uid || !topic || String(topic).trim().length < 6) return '';
    const { webSearch } = await import('./research.js');
    const res = await webSearch({ query: String(topic).slice(0, 220) });
    const items = Array.isArray(res?.results) ? res.results.slice(0, 5) : [];
    if (!items.length) return '';
    const raw = items
      .map((r, i) => `${i + 1}. ${r.title}${r.snippet ? ` — ${r.snippet}` : ''} [${String(r.url || '').slice(0, 80)}]`)
      .join('\n')
      .slice(0, 1400);
    const j = await runAgent(
      env,
      team,
      'skill_researcher',
      'researching a new skill',
      [
        { role: 'system', content: SKILL_RESEARCH_SYSTEM },
        {
          role: 'user',
          content: [
            `TOPIC: ${String(topic).slice(0, 200)}`,
            brand?.name ? `THIS SKILL WILL SERVE: ${brand.name}` : '',
            brief ? `CONTEXT: ${String(brief).slice(0, 240)}` : '',
            `SEARCH RESULTS:\n${raw}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: 480, temperature: 0.4 },
      (out) => (out?.skip ? 'nothing transferable in the results' : `studied: ${String(out?.title || '').slice(0, 60)}`)
    );
    if (j?.skip || !j?.title || !j?.body) return '';
    const { learnSkill } = await import('./skills.js');
    const out = await learnSkill(store, uid, {
      title: j.title,
      domain: j.domain,
      body: j.body,
      slug: j.title,
    }, { source });
    return out?.ok ? `skill "${out.title}" ${out.updated ? 'sharpened' : 'learned'} from live research` : '';
  } catch {
    return '';
  }
}

/* ══ The Reflector — the self-evolution loop ═════════════════════════ */

const REFLECTOR_SYSTEM = `You are the Reflector of an elite multi-agent web studio. After every finished build you extract ONE reusable, durable lesson from what the team just made, so future builds start smarter. Respond with ONLY JSON:

{"title":"skill title, 5-12 words, states the rule not the topic","domain":"design|layout|motion|copy|ux|engineering|marketing","body":"2-4 sentences of RULES the team applies next time — what made THIS build work, what to always do or avoid. Concrete, not generic. Max 400 chars."}

Rules:
- Extract from the ACTUAL build below (goal, audience, sections, QA verdicts) — never generic advice.
- If nothing was genuinely learnable, respond with {"skip":true}.
- domain must be the single best fit.`;

/**
 * REFLECT — the post-build self-evolution step. One small call turns the
 * finished build into a learned skill (learn_skill stores it per-user;
 * every later build injects it back). Never throws: reflection failing
 * must never fail the build that already succeeded. Returns the trace
 * note, or '' when skipped/unavailable.
 */
export async function reflectOnBuild(env, store, uid, { lead, plan, brand, verdicts = {}, team = null }) {
  try {
    const digest = [
      lead?.page_goal ? `PAGE GOAL: ${lead.page_goal}` : '',
      lead?.audience ? `AUDIENCE: ${lead.audience}` : '',
      lead?.tone_note ? `TONE: ${lead.tone_note}` : '',
      lead?.angle ? `NARRATIVE ANGLE: ${lead.angle}` : '',
      `SECTIONS: ${(plan?.sections || []).map((s) => `${s.id} (${s.name}: ${s.motion || 'reveal'})`).join(', ')}`,
      Object.keys(verdicts).length ? `QA VERDICTS: ${Object.entries(verdicts).map(([id, v]) => `${id}=${v}`).join(', ')}` : '',
    ].filter(Boolean).join('\n');
    if (!digest) return '';
    const j = await runAgent(
      env,
      team,
      'reflector',
      'learning from this build',
      [
        { role: 'system', content: REFLECTOR_SYSTEM },
        { role: 'user', content: `BUILD by the team for ${brand?.name || 'the client'}:\n${digest.slice(0, 1400)}` },
      ],
      { json: true, maxTokens: 450, temperature: 0.4 },
      (out) => (out?.skip ? 'nothing new worth storing' : `stored skill: ${String(out?.title || '').slice(0, 60)}`)
    );
    if (j?.skip || !j?.title || !j?.body) return '';
    const { learnSkill } = await import('./skills.js');
    const res = await learnSkill(store, uid, { title: j.title, domain: j.domain, body: j.body, slug: j.title }, { source: 'build-reflection' });
    return res?.ok ? `skill "${res.title}" ${res.updated ? 'sharpened' : 'learned'}` : '';
  } catch {
    return '';
  }
}
