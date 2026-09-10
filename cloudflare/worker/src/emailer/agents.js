/**
 * AGENTS — the multi-agent runtime (Agent v8).
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
 *
 * This module is the runtime; builder.js/codegen.js/designer.js are the
 * team's job description. Agent keys: lead | researcher | director |
 * copywriter | copy_chief | architect | engineer | qa | builder.
 */

import { sarvamChat } from './sarvam.js';

/* ══ The team roster ═════════════════════════════════════════════════ */

export const AGENT_TEAM = {
  lead: { name: 'Lead', emoji: '🧠', role: 'orchestrator — plans how the team runs' },
  researcher: { name: 'Researcher', emoji: '🔍', role: 'live market research' },
  director: { name: 'Art Director', emoji: '🎨', role: 'design system & art direction' },
  copywriter: { name: 'Copywriter', emoji: '✍️', role: 'conversion copy' },
  copy_chief: { name: 'Copy Chief', emoji: '🧐', role: 'copy review & tightening' },
  architect: { name: 'Architect', emoji: '📐', role: 'information architecture' },
  engineer: { name: 'Engineer', emoji: '🛠️', role: 'hand-codes the sections' },
  qa: { name: 'QA Director', emoji: '🔎', role: 'code review & rework' },
  builder: { name: 'Builder', emoji: '🚀', role: 'assembly, hosting & integrity' },
};

/* ══ Team run — the trace bus ════════════════════════════════════════ */

/**
 * One team run per build. Every AI call goes through runAgent() so the
 * trace captures who did what and how long it took; deterministic steps
 * (wire, host, fallbacks) are recorded directly. The run carries BOTH
 * output shapes: trace (agent rows, new) and stages (legacy rows kept
 * so existing consumers/tests stay valid).
 */
export function createTeamRun(meta = {}) {
  const run = {
    meta, // { kind, title } — what this team is building
    startedAt: Date.now(),
    trace: [],
    stages: [],
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
    },
    stage(name, ok, ai, detail) {
      run.stages.push({ stage: name, ok: ok !== false, ai: ai === true, detail: String(detail || '').slice(0, 140) });
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

const LEAD_SYSTEM = `You are the Lead of an elite multi-agent web studio. Your team (researcher, art director, copywriter, architect, engineers, QA) is about to build a bespoke page. Read the brief and write the EXECUTION PLAN that makes every specialist sharp. Respond with ONLY JSON:

{"audience":"who this page must convince, 5-10 words","research_focus":"the single most valuable thing to learn from the live web for THIS business, one line","queries":["0-2 short, specific web searches"],"sections_target":4,"emphasis":["2-4 parts of this page that deserve the most craft, e.g. 'the menu section must feel tactile'"],"risks":["1-3 ways this build could feel generic or wrong for this audience"],"tone_note":"one line of direction every writer on the team follows"}

Rules:
- Decide from the BRIEF, not habit: a tiffin service and a law firm need different teams' energy.
- queries must be things a search engine can actually answer (markets, prices, local facts, trends) — not the business's own name.
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
  return {
    audience: `${kind === 'webapp' ? 'people who need this tool daily' : "the business's real customers"}`,
    research_focus: `what customers in this market expect from a ${kind === 'webapp' ? 'tool like this' : 'business like this'}`,
    queries: [],
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
export async function leadPlan(env, { kind, brief, brand, style, team = null }) {
  const fallback = () => defaultLeadPlan({ kind, brief, brand });
  try {
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
            `BUSINESS: ${brand.name}${brand.profile?.industry ? ` (${brand.profile.industry})` : ''}`,
            `PAGE KIND: ${kind}`,
            style ? `STYLE REQUEST: ${style}` : '',
            `BRIEF: ${String(brief).slice(0, 1500)}`,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: 700, temperature: 0.55 },
      (out) => `${out.sections_target || 4} sections · ${String(out.audience || '').slice(0, 60)}`
    );
    const plan = {
      audience: String(j.audience || '').slice(0, 140),
      research_focus: String(j.research_focus || '').slice(0, 200),
      queries: Array.isArray(j.queries) ? j.queries.map((q) => String(q).slice(0, 120)).filter(Boolean).slice(0, 2) : [],
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
    lead.audience ? `AUDIENCE: ${lead.audience}` : '',
    lead.tone_note ? `TONE: ${lead.tone_note}` : '',
    lead.emphasis.length ? `CRAFT EMPHASIS: ${lead.emphasis.join('; ')}` : '',
    lead.risks.length ? `AVOID: ${lead.risks.join('; ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
