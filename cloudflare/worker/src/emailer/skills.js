/**
 * SKILLS — the agent's live, self-improving capability library.
 *
 * The user's ask: "give abundant skill to improve its own skills live".
 * This module is that loop, made concrete:
 *
 *   1. SEEDED EXPERTISE — a curated library of design/engineering/copy
 *      skills ships WITH the worker (distilled rules, not prose), so a
 *      fresh install already thinks at a senior level.
 *   2. INJECTED INTO THINKING — relevant skills are packed into the
 *      designer/copywriter prompts on EVERY build (skillsForDomain).
 *   3. LEARNED FROM THE WILD — after researching the web, the agent can
 *      distill what it learned into a NEW skill (learn_skill) that is
 *      stored per-user, deduped, capped — and used in every later build.
 *      The agent literally gets better at its job by doing it.
 *
 * Storage: skills:library:<uid> → [{slug,title,domain,body,source,at}]
 * (learned skills only; seeded ones are code). Cap 40 learned per user.
 */

import { esc } from './htmlutil.js';

const LIB_KEY = (uid) => `skills:library:${uid || 'shared'}`;
const LEARNED_CAP = 40;
const BODY_MAX = 600;

export const SKILL_DOMAINS = ['design', 'layout', 'motion', 'copy', 'ux', 'engineering', 'marketing'];

/* ══ Seeded expertise — senior-level rule cards ═══════════════════════ */

export const SEED_SKILLS = [
  {
    slug: 'visual-hierarchy',
    title: 'Visual hierarchy: one hero, one action',
    domain: 'design',
    body: 'Every screen answers ONE question first. Size = importance: hero headline 2.5-4x body, then a steep drop — never a smooth gradient of sizes. Exactly one primary action per viewport, repeated at the end. Whitespace IS hierarchy: group related items with proximity before adding boxes or lines.',
  },
  {
    slug: 'typography-pairing',
    title: 'Typography: pair one voice + one workhorse',
    domain: 'design',
    body: 'Pair a characterful display face (Fraunces, Space Grotesk, Cormorant, Syne) with a neutral body face (Inter, DM Sans). Display sizes get negative tracking (-0.02em) and tighter leading (1.05-1.15); body gets 1.6+. Never more than 2 families. Numerals in stats: tabular. Scale by ratio ~1.25, not arbitrary steps.',
  },
  {
    slug: 'color-systems',
    title: 'Color: 60/30/10 and one accent',
    domain: 'design',
    body: '60% background, 30% surface, 10% accent. ONE accent family carries every call-to-action; a second hue only supports (gradients, highlights). Text-on-bg must hit 7:1 (headlines) and 4.5:1 (body). Dark themes: raise surface lightness with elevation, never pure gray text below #6b6b6b on black.',
  },
  {
    slug: 'motion-design',
    title: 'Motion: choreograph, do not decorate',
    domain: 'motion',
    body: 'Motion must explain structure: elements enter staggered (60-120ms steps) from the direction they came from; duration 200-500ms with ease-out cubic; blur-in + rise reads premium. Ambient loops (orbs, marquees) move SLOW (16s+). Everything honors prefers-reduced-motion. Two springs max per page.',
  },
  {
    slug: 'microinteraction-craft',
    title: 'Micro-interactions: the page answers the hand',
    domain: 'motion',
    body: 'Hover lifts cards 4-6px with shadow growth; buttons shine-sweep or brighten in <200ms; nav links animate underline from left; the cursor can carry a soft glow on pointer:fine. Press states compress (scale .97). Feedback under 100ms feels instant — animate opacity/transform only, never layout.',
  },
  {
    slug: 'bento-editorial',
    title: 'Layout: bento + editorial asymmetry',
    domain: 'layout',
    body: 'Uniform 3-col card rows read as template. Use bento: first card spans 2 cols and leads; mix text spans with art tiles. Editorial pages: rule lines + numbered kickers + oversized headline (clamp to 15vw) + generous section padding (84px). Mobile-first: every grid collapses to 1-col under 760px.',
  },
  {
    slug: 'art-direction',
    title: 'Art direction: real art beats emoji',
    domain: 'design',
    body: 'Emoji billboards scream template. Use abstract SVG compositions (concentric rings, wave fields, mesh blobs, iso grids, mondrian blocks) tinted by the palette — they always render, never break, and scale. One motif per page, repeated at different crops for coherence. Film grain at 5% makes flat blacks tactile.',
  },
  {
    slug: 'conversion-copy',
    title: 'Copy: payoff first, proof always',
    domain: 'copy',
    body: 'Headline = the outcome in 4-9 words ("Custom thalis in 20 minutes"), never "Welcome to X". Sub answers what/why in one breath. Features are titled by outcome and backed by proof (numbers, names, specifics). FAQ pre-empts the real objections: price, time, trust, availability. One CTA verb per button.',
  },
  {
    slug: 'mobile-first-trust',
    title: 'UX: thumb-first, trust always',
    domain: 'ux',
    body: 'Design at 390px first: 44px touch targets, sticky CTA reachable by thumb, no hover-only information. Trust is a section, not a badge: real testimonials with names/roles, concrete stats with labels, honest contact info visible without scrolling. Break lines of copy at 60-70ch max for reading comfort.',
  },
  {
    slug: 'perf-budget',
    title: 'Engineering: fast pages feel expensive',
    domain: 'engineering',
    body: 'Single-file budget: ~120KB HTML total, fonts via display=swap with preconnect, zero render-blocking JS (one inline <script> at body end), CSS custom properties for theming, IntersectionObserver over scroll handlers, passive listeners, requestAnimationFrame for counters. Content visible without JS; JS only adds motion.',
  },
  {
    slug: 'accessibility-basics',
    title: 'Accessibility: contrast, focus, alternatives',
    domain: 'ux',
    body: 'Contrast 4.5:1 body / 3:1 large text. :focus-visible rings (2px accent, 3px offset) on every interactive element. Decorative art = aria-hidden + empty alt; icons get labels. Details/summary before JS accordions. Hit areas 44px. Color never the only signal — pair with icon or text.',
  },
  {
    slug: 'seo-structure',
    title: 'Marketing: structure that ranks and converts',
    domain: 'marketing',
    body: 'One h1, descriptive title <=60 chars, meta description 140-160, semantic sections (header/main/section/footer), og:title/description for shares. Above the fold: what-it-is + for-whom + one action. Marquee of offer keywords adds scannable energy. CTA band before the footer; giant wordmark footer for brand recall.',
  },
];

/* ══ Library access ═══════════════════════════════════════════════════ */

function safeParseList(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => s && s.slug && s.body) : [];
  } catch {
    return [];
  }
}

export async function listSkills(store, uid) {
  const learned = store ? safeParseList(await store.get(LIB_KEY(uid))) : [];
  return {
    seeded: SEED_SKILLS.map(({ slug, title, domain }) => ({ slug, title, domain, seeded: true })),
    learned: learned.map((s) => ({ slug: s.slug, title: s.title, domain: s.domain, at: s.at, source: s.source, seeded: false })),
    total: SEED_SKILLS.length + learned.length,
  };
}

export function slugify(t) {
  return String(t || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48) || 'skill';
}

/**
 * learn_skill — the agent saves a distilled capability it discovered.
 * Dedupe by slug: re-learning UPDATES the body (live improvement of an
 * existing skill), which is the "improve its own skills" half.
 */
export async function learnSkill(store, uid, args, { source = 'agent-research' } = {}) {
  const title = String(args?.title || '').trim().slice(0, 120);
  const body = String(args?.body || '').trim().slice(0, BODY_MAX);
  const domain = SKILL_DOMAINS.includes(String(args?.domain)) ? String(args.domain) : 'design';
  if (title.length < 6) return { ok: false, error: 'skill needs a descriptive title (>=6 chars)' };
  if (body.length < 40) return { ok: false, error: `skill body too short (${body.length}/40) — distill the actual RULES learned, not a topic name` };
  const slug = slugify(args?.slug || title);
  const learned = store ? safeParseList(await store.get(LIB_KEY(uid))) : [];
  const existingIdx = learned.findIndex((s) => s.slug === slug);
  const rec = { slug, title, domain, body, source: String(source).slice(0, 60), at: new Date().toISOString() };
  let updated = false;
  if (existingIdx >= 0) { learned[existingIdx] = rec; updated = true; }
  else learned.unshift(rec);
  if (store) await store.put(LIB_KEY(uid), JSON.stringify(learned.slice(0, LEARNED_CAP)));
  return {
    ok: true, slug, title, domain, updated,
    total_learned: learned.length,
    note: updated
      ? `skill "${title}" sharpened — future builds use the improved rules`
      : `skill "${title}" learned — it now informs every future build`,
  };
}

export async function forgetSkill(store, uid, args) {
  const slug = slugify(args?.slug || args?.title || '');
  const learned = store ? safeParseList(await store.get(LIB_KEY(uid))) : [];
  const next = learned.filter((s) => s.slug !== slug);
  if (next.length === learned.length) return { ok: false, error: `no learned skill "${slug}" (seeded skills cannot be forgotten)` };
  if (store) await store.put(LIB_KEY(uid), JSON.stringify(next));
  return { ok: true, forgotten: slug, note: `skill "${slug}" removed from the library` };
}

/**
 * skillsForDomain — pick the skill pack for a build. Learned skills for
 * the domain win (freshest), then seeded, then adjacent domains. Output
 * is a compact prompt block (bounded chars) — Sarvam-safe.
 */
export async function skillsForDomain(store, uid, domain, { maxSkills = 6, maxChars = 1600 } = {}) {
  const learned = store ? safeParseList(await store.get(LIB_KEY(uid))) : [];
  const adj = { design: ['layout', 'motion'], layout: ['design'], motion: ['design'], copy: ['marketing'], ux: ['design'], engineering: [], marketing: ['copy'] };
  const order = (s) => (s.domain === domain ? 0 : (adj[domain] || []).includes(s.domain) ? 1 : 2);
  const pool = [
    ...learned.map((s) => ({ ...s, learned: true })),
    ...SEED_SKILLS.map((s) => ({ ...s, learned: false })),
  ].sort((a, b) => order(a) - order(b) || (b.learned ? 1 : 0) - (a.learned ? 1 : 0));

  const picked = [];
  let used = 0;
  for (const s of pool) {
    if (picked.length >= maxSkills) break;
    const chunk = `• ${s.title}: ${s.body}`;
    if (used + chunk.length > maxChars) continue;
    picked.push(chunk);
    used += chunk.length + 1;
  }
  return {
    block: picked.length ? `EXPERT SKILL PACK (apply silently):\n${picked.join('\n')}` : '',
    skills: picked,
    learnedCount: learned.length,
  };
}
