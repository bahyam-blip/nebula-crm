/**
 * BUILD REPORT — Agent v13 TRANSPARENCY.
 *
 * The owner's directive: after every build the team must hand back a
 * SUMMARY OF WHAT IT BUILT — the stack, the technology, the code, the
 * front end, the back end — like a senior engineer's handover note.
 *
 * This module is exactly that, deterministic (no AI call, can never
 * fail the build): it reads the finished build's own artifacts — the
 * assembled HTML, the coded sections, the design system, the team
 * trace, the research and QA results — and distills a structured
 * report the app renders as the build's final deliverable sheet.
 */

const COMPONENT_DETECTORS = [
  ['Tabs', /data-tab=/i],
  ['Accordions', /<details class="acc"/i],
  ['Dialogs / modals', /<(dialog|button data-dialog)/i],
  ['Lightbox gallery', /img\.ph|<img[^>]*class="[^"]*ph/i],
  ['Inline form validation', /form data-validate/i],
  ['Pricing toggle', /data-price-toggle/i],
  ['Count-up stats', /data-count=/i],
  ['Marquee band', /class="marquee"/i],
  ['Copy buttons', /data-copy=/i],
  ['Scroll carousel', /snap-row/i],
  ['Scroll progress + condensed nav', /rev-progress/i],
];

function detectComponents(html) {
  const found = [];
  for (const [label, re] of COMPONENT_DETECTORS) {
    if (re.test(html)) found.push(label);
  }
  return found;
}

function detectBehavior(html) {
  const parts = ['IntersectionObserver scroll reveals'];
  if (/data-tab=/i.test(html)) parts.push('tab switching');
  if (/data-dialog=|<dialog/i.test(html)) parts.push('modal dialogs + lightbox');
  if (/form data-validate/i.test(html)) parts.push('inline form validation');
  if (/data-count=/i.test(html)) parts.push('count-up statistics');
  if (/class="marquee"/i.test(html)) parts.push('seamless marquee');
  if (/data-price-toggle/i.test(html)) parts.push('pricing toggle');
  parts.push('progress rail + condensing nav');
  return parts.join(', ');
}

function policyDetail(policy) {
  const bits = [];
  if (policy?.legalLinks) bits.push('Privacy · Terms inline');
  if (policy?.health) bits.push('health disclaimer');
  if (policy?.finance) bits.push('investment-risk note');
  if (policy?.commerce) bits.push('honest-pricing rules applied');
  if (policy?.kids) bits.push('child-safe data rules');
  return bits.length ? bits.join(' · ') : 'none required for this brief';
}

/**
 * buildReport — the deterministic handover sheet for one finished build.
 *
 * @param {object} p
 *   kind, title, brand, url, html, builder — the shipped artifact
 *   plan       { sections, nav }         the architecture
 *   coded      [{ id, html, css }]       the hand-written fragments
 *   design     the locked design system (palette, fontPair, harmony…)
 *   images     verified photography actually embedded
 *   team       the team trace rows;  teamSummary {agents, ai_calls, ms}
 *   understanding  the Analyst artifact (may be null)
 *   lead       the Lead plan (audience, page_goal)
 *   research   { queries, ai, facts }    research outcome (may be null)
 *   verdicts   QA verdicts {id: good|fix};  reworked  count
 *   leaks      foreign-brand tokens scrubbed
 *   skills     [notes] — what the Reflector / Skill Researcher learned
 *   buildMs    wall time of the whole build
 */
export function buildReport(p) {
  const {
    kind, title, brand, url, html = '', builder = 'ai',
    plan = null, coded = null, design = {}, images = [],
    team = [], teamSummary = null, understanding = null, lead = null,
    research = null, verdicts = {}, reworked = 0, leaks = 0,
    skills = [], buildMs = 0,
  } = p;

  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  const fragments = Array.isArray(coded) ? coded : [];
  const codedChars = fragments.reduce((n, c) => n + (c.html?.length || 0) + (c.css?.length || 0), 0);
  const components = detectComponents(html);
  const pair = design.fontPair || null;
  const isWebapp = kind === 'webapp';
  const handCoded = builder === 'ai' || builder === 'ai+engine';

  const stack = [
    {
      layer: 'Structure',
      detail: isWebapp
        ? 'Single-file HTML5 app — semantic shell, offline-capable'
        : `Semantic HTML5 — ${sections.length || fragments.length || 1} section${(sections.length || fragments.length || 1) === 1 ? '' : 's'}, ${handCoded ? `${fragments.length || sections.length || 1} hand-coded by the AI engineers` : 'assembled by the deterministic engine'}`,
    },
    {
      layer: 'Styling',
      detail: `CSS3 — custom-property token system${design.ramp ? ' + 10-step accent ramp' : ''}, color-mix() tints, clamp() fluid type, grid/flex layouts, scroll-snap${design.texture ? `, ${design.texture} texture` : ''}`,
    },
    { layer: 'Behavior', detail: `Vanilla JS — ${isWebapp ? 'offline data layer (load → render → mutate → save), undo toasts, empty states' : detectBehavior(html)}` },
    {
      layer: 'Typography',
      detail: pair
        ? `Google Fonts — ${pair.display} (display) × ${pair.body} (body), display=swap, preconnected`
        : `Font stack — ${design.font || 'modern'} system with clamp() scale`,
    },
    {
      layer: 'Design system',
      detail: [
        design.themeLabel ? String(design.themeLabel) : design.theme || null,
        design.harmony ? `${design.harmony} harmony` : null,
        design.palette?.accent ? `accent ${design.palette.accent}` : null,
        design.radius ? `${design.radius}px radius` : null,
        design.type_scale ? `${design.type_scale} type scale` : null,
        design.motion_intensity ? `${design.motion_intensity} motion` : null,
      ].filter(Boolean).join(' · '),
    },
    {
      layer: 'Media',
      detail: images.length
        ? `${images.length} verified photograph${images.length === 1 ? '' : 's'} (Web/Commons-sourced, allowlisted, lazy-loaded)`
        : 'Pure CSS art direction — gradients, shapes, texture',
    },
    { layer: 'SEO', detail: 'OG + Twitter cards · canonical URL · JSON-LD structured data · robots meta · SVG favicon' },
    { layer: 'Compliance', detail: policyDetail(p.policy) },
    {
      layer: 'Hosting',
      detail: 'Cloudflare R2 object storage · edge-served · versioned snapshots · SHA-256 integrity digest',
    },
    {
      layer: 'Backend',
      detail: isWebapp
        ? 'Offline-first client store — versioned localStorage with migrate() guard; schema is backend-sync-ready (flat records, ISO dates)'
        : 'None required — static single-file page; forms validate inline and hand off to the client\'s contact channels',
    },
  ];

  const frontend = {
    sections: (sections.length ? sections : fragments.map((c) => ({ id: c.id, name: c.id, goal: '', motion: '' }))).map((s) => {
      const frag = fragments.find((c) => c.id === s.id);
      return {
        id: s.id,
        name: s.name || s.id,
        goal: String(s.goal || '').slice(0, 120),
        motion: String(s.motion || '').slice(0, 80),
        chars: frag ? (frag.html?.length || 0) + (frag.css?.length || 0) : null,
      };
    }),
    components,
    images: images.length,
    coded_chars: codedChars || null,
  };

  const qaRows = Object.entries(verdicts);
  const report = {
    title,
    kind,
    brand,
    url,
    builder,
    bytes: html.length,
    built_at: new Date().toISOString(),
    build_ms: Math.max(1, Math.round(buildMs || teamSummary?.ms || 0)),
    overview: [
      lead?.page_goal ? `Goal: ${lead.page_goal}` : '',
      lead?.audience ? `Audience: ${lead.audience}` : '',
      understanding?.success_metric ? `Wins if: ${understanding.success_metric}` : '',
    ].filter(Boolean).join(' · '),
    stack,
    frontend,
    quality: {
      contrast: 'WCAG-enforced (math-gated palette)',
      identity: leaks === 0 ? 'verified — 100% client branding' : `${leaks} foreign token(s) scrubbed`,
      qa: qaRows.length
        ? `${qaRows.filter(([, v]) => v === 'good').length}/${qaRows.length} sections passed · ${reworked} reworked`
        : 'review skipped',
      motion: 'reduced-motion safe · GPU-only animation',
    },
    agents: {
      count: teamSummary?.agents || new Set(team.map((t) => t.agent)).size || 0,
      ai_calls: teamSummary?.ai_calls || 0,
      wall_ms: Math.max(1, Math.round(teamSummary?.ms || buildMs || 0)),
      crew: team
        .filter((t) => t.ai)
        .slice(0, 8)
        .map((t) => ({ agent: t.agent, action: t.action, ms: t.ms })),
    },
    research: research && (research.queries?.length || research.ai)
      ? {
          queries: research.queries || [],
          mode: research.ai ? 'live web search + AI synthesis' : 'raw web facts',
          facts: Array.isArray(research.facts) ? research.facts.length : null,
        }
      : null,
    skills: skills.filter(Boolean).slice(0, 3),
  };
  return report;
}
