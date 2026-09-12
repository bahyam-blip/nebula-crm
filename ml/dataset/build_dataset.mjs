#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════
 *  NEBULA CORE — dataset builder
 *  Turns the worker's own senior engineering capability into gold
 *  training pairs for our fine-tuned model. Every sample teaches the
 *  model to think and ship like Nebula's agent team:
 *
 *    plan     → business brief → EXECUTION PLAN JSON (features + layout)
 *    section  → section spec → production HTML/CSS (layout-safe)
 *    tokens   → brand words → design tokens JSON (real palette math)
 *    copy     → brand + tone → copy JSON (anti-generic rules)
 *    qa_fix   → broken snippet → hardened snippet (v14 layout laws)
 *    devops   → intent → GitHub Actions / hosting YAML (real workflows)
 *    skill    → domain + gap → distilled skill (SEED_SKILLS as gold)
 *    assistant→ owner question → grounded operational answer
 *
 *  Deterministic: seeded PRNG → rebuilds byte-stable JSONL.
 *  Output: ml/dataset/nebula-core.jsonl + nebula-core.stats.json
 *
 *  Run:  node ml/dataset/build_dataset.mjs [--scale 1] [--out DIR]
 * ═══════════════════════════════════════════════════════════════════
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HARMONIES, expandPalette, FONT_PAIRINGS, fontPairFor,
} from '../../cloudflare/worker/src/emailer/mastery.js';
import { SEED_SKILLS } from '../../cloudflare/worker/src/emailer/skills.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ── Deterministic PRNG (mulberry32) ─────────────────────────────── */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/* ── Shared law packs (the model's constitution, distilled) ──────── */
const CORE_SYSTEM =
  'You are Nebula Core, the fine-tuned engineering model of the Nebula platform. ' +
  'You build production-quality websites and apps on the FIRST round: deep thinking, ' +
  'complete features, real layouts, zero placeholders. You never fake completion and ' +
  'you answer in exactly the format asked.';

const DESIGN_LAWS = [
  'Design-system first: tokens (palette roles, type scale, spacing, radius, shadows) before markup.',
  'Never generic: no random gradients, no default blue/purple, no glassmorphism for its own sake.',
  'Fluid type via clamp(); spacing on a scale; one accent per brand, used deliberately.',
  'Layout safety: position:fixed banned inside sections, 100vh needs an svh twin, grid children need min-width:0, all text wrap-safe, overflow-x clipped.',
  'States are not optional: hover, focus-visible, empty, loading and error states ship with the component.',
  'Motion respects prefers-reduced-motion; entrance animations are subtle (opacity + 8-16px translate).',
].join(' ');

/* ── Content banks ───────────────────────────────────────────────── */
const BUSINESSES = [
  { kind: 'D2C skincare brand', audience: 'women 22-38', sell: 'small-batch serums', tone: 'warm, clinical-clean' },
  { kind: 'B2B SaaS for logistics', audience: 'ops managers', sell: 'route optimization', tone: 'sharp, data-led' },
  { kind: 'boutique law firm', audience: 'startup founders', sell: 'flat-fee incorporation', tone: 'precise, trustworthy' },
  { kind: 'yoga and pilates studio', audience: 'urban professionals', sell: 'class packs', tone: 'calm, grounded' },
  { kind: 'specialty coffee roaster', audience: 'home brewers', sell: 'subscription beans', tone: 'craft, curious' },
  { kind: 'dental clinic group', audience: 'families', sell: 'pain-free dentistry', tone: 'reassuring, clear' },
  { kind: 'industrial CNC job shop', audience: 'procurement engineers', sell: 'precision machining', tone: 'technical, no-nonsense' },
  { kind: 'online UPSC coaching', audience: 'aspirants 20-28', sell: 'test series + mentorship', tone: 'direct, motivating' },
  { kind: 'pet grooming at home', audience: 'dog and cat owners', sell: 'doorstep grooming', tone: 'friendly, playful' },
  { kind: 'wedding photography studio', audience: 'engaged couples', sell: 'candid packages', tone: 'romantic, editorial' },
  { kind: 'EV charging network', audience: 'fleet operators', sell: 'charging infra + software', tone: 'confident, technical' },
  { kind: 'kids coding school', audience: 'parents', sell: 'weekend coding tracks', tone: 'bright, credible' },
];

const STYLE_FAMILIES = [
  { name: 'swiss-editorial', hint: 'strict grid, huge serif display type, generous whitespace, near-black on paper' },
  { name: 'onyx-dark', hint: 'deep near-black ground, luminous accent, thin borders, mono details, restrained glow' },
  { name: 'aurora-gradient', hint: 'dark base with ONE expressive gradient reserved for hero art, crisp white type' },
  { name: 'warm-minimal', hint: 'warm off-whites, rounded-but-not-bubbly cards, humanist sans, soft shadows' },
];

const SECTIONS_BANK = [
  { key: 'hero', ask: 'a full-viewport hero: kicker, headline, one-line sub, primary CTA, secondary ghost CTA, background brand art' },
  { key: 'nav', ask: 'a sticky top nav: wordmark, 4 links, one button; collapses to a menu button under 720px' },
  { key: 'features', ask: 'a 3- or 4-card feature grid with icon, title, 2-line body; cards equal height' },
  { key: 'story', ask: 'a two-column story band: prose on one side, visual panel on the other, alternating order on mobile' },
  { key: 'stats', ask: 'a stat strip: 3-4 big numbers with labels' },
  { key: 'pricing', ask: 'a pricing trio with one emphasized plan, feature lists, per-plan CTA' },
  { key: 'testimonials', ask: 'a testimonial band: quote, name, role, avatar fallback monogram' },
  { key: 'faq', ask: 'a details/summary FAQ, 4-6 items, styled markers' },
  { key: 'cta', ask: 'a closing CTA band: one promise, one button, no clutter' },
  { key: 'footer', ask: 'a footer: wordmark, 3 link columns, legal line, social text links' },
];

/* ── The system prompts per family ───────────────────────────────── */
const SYS_PLAN = `${CORE_SYSTEM}\nYou are the ORCHESTRATOR. Convert a business brief into an EXECUTION PLAN: concrete working features (each shippable on round one), a binding LAYOUT CONTRACT, palette seed and section list. Reply with ONLY a JSON object: {"understanding": string, "features": [{"name": string, "behavior": string}], "layout_contract": string, "palette_seed": "#rrggbb", "style": string, "sections": [{"key": string, "purpose": string}], "risks": [string]}.`;
const SYS_SECTION = `${CORE_SYSTEM}\nYou are the ENGINEER. Emit ONE self-contained section as a single <section> element with a <style> block. Scope every selector under the section root class. Obey: ${DESIGN_LAWS} No markdown fences, no explanation — HTML only.`;
const SYS_TOKENS = `${CORE_SYSTEM}\nYou are the DESIGNER. Convert brand words into a design-token object. Reply with ONLY JSON: {"palette": {"bg": "...", "surface": "...", "ink": "...", "muted": "...", "accent": "...", "line": "..."}, "fonts": {"display": string, "body": string, "scale": string}, "radius": string, "shadow": string, "motion": string, "rationale": string}.`;
const SYS_COPY = `${CORE_SYSTEM}\nYou are the COPY CHIEF. Write specific, human, zero-generic copy. Forbidden: "unleash", "elevate", "seamless", "game-changer", "in today's fast-paced world". Reply with ONLY JSON: {"kicker": string, "headline": string, "sub": string, "ctas": [string], "section_copy": [{"key": string, "title": string, "body": string}]}.`;
const SYS_QA = `${CORE_SYSTEM}\nYou are the QA DIRECTOR. Fix the snippet against the stated law while preserving intent. Reply with ONLY the corrected HTML/CSS, no commentary.`;
const SYS_DEVOPS = `${CORE_SYSTEM}\nYou are the DEVOPS engineer. Emit exactly one complete, valid YAML file for the request. No fences, no commentary — YAML only.`;
const SYS_SKILL = `${CORE_SYSTEM}\nYou distill engineering experience into reusable SKILLS: short imperative rules, concrete thresholds, no prose fluff. Reply with ONLY the skill body (2-6 rules).`;
const SYS_ASSIST = `${CORE_SYSTEM}\nYou are Nebula's operator assistant for the platform owner: CRM, email campaigns, hosting, GitHub flows, billing. Answer concretely with exact routes, settings and limits. Keep it under 120 words.`;

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

/* ── Palette helper (real harmony math from mastery.js) ──────────── */
function paletteFor(r) {
  const harmony = pick(r, Object.keys(HARMONIES));
  const seeds = ['#0e7c66', '#b4552d', '#2743a0', '#8a1f3d', '#5b3a8e', '#1f6f50', '#a03e68', '#33518f', '#7a5c10', '#2f6f8f'];
  const p = expandPalette(pick(r, seeds), { harmony });
  return {
    bg: p.bg || '#faf7f2', surface: p.surface || '#ffffff', ink: p.ink || '#191919',
    muted: p.muted || '#5c5c5c', accent: p.accent || seeds[0], line: p.line || '#e4ded4',
  };
}

/* ── Family generators ───────────────────────────────────────────── */

function genPlan(r) {
  const b = pick(r, BUSINESSES);
  const style = pick(r, STYLE_FAMILIES);
  const harmony = pick(r, Object.keys(HARMONIES));
  const pal = paletteFor(r);
  const featureSets = [
    ['Online booking with slot guard', 'WhatsApp deep-link on every CTA', 'Auto pricing tiers by city'],
    ['Lead capture wired to CRM', 'Coupon engine with expiry', 'Gallery with lazy images'],
    ['Live order tracking page', 'Review wall with verified badge', 'Newsletter capture with double opt-in'],
    ['Diagnostic quiz → product match', 'Subscription with pause/skip', 'Store locator with hours'],
    ['Fee calculator (no fake numbers)', 'Case study library', 'Consult booking with reminders'],
  ];
  const features = pick(r, featureSets);
  const sections = ['hero', 'nav', 'features', 'story', 'stats', 'pricing', 'cta', 'footer'].slice(0, 6 + Math.floor(r() * 2));
  const user = [
    `Business: ${b.kind}.`,
    `Audience: ${b.audience}. Selling: ${b.sell}. Tone: ${b.tone}.`,
    `Style direction: ${style.name} — ${style.hint}.`,
    `Palette harmony: ${harmony}, seed ${pal.accent}.`,
    `Target: a single-page site whose features WORK on round one (no lorem, no dead buttons).`,
  ].join('\n');
  const assistant = JSON.stringify({
    understanding: `${b.kind} needs a page that converts ${b.audience} by making ${b.sell} obvious and bookable within one scroll session.`,
    features: features.map((f) => ({ name: f, behavior: `${f} — fully wired client-side this round: visible, interactive, stateful (hover/focus/empty/error), no stub.` })),
    layout_contract: `${style.hint}. ${sections.length} sections stacked: ${sections.join(' → ')}. Fluid type clamp() scale, 12-col grid under 1120px, all text wrap-safe, overflow-x clipped at every section root.`,
    palette_seed: pal.accent,
    style: style.name,
    sections: sections.map((k) => ({ key: k, purpose: (SECTIONS_BANK.find((s) => s.key === k) || SECTIONS_BANK[0]).ask })),
    risks: ['copy drift into generic marketing phrasing', 'hero art missing alt text', 'fixed positioning inside sections breaking mobile'],
  }, null, 2);
  return { system: SYS_PLAN, user, assistant };
}

function sectionTemplate(key, b, pal, fonts) {
  const { ink, accent, bg, surface, muted, line } = pal;
  const { display, body } = fonts;
  switch (key) {
    case 'hero': return `<section class="nc-hero" aria-label="Intro">
  <style>
    .nc-hero{position:relative;isolation:isolate;background:${bg};color:${ink};min-height:min(92svh,760px);display:grid;align-items:center;overflow-x:clip}
    .nc-hero__in{width:min(1120px,92%);margin-inline:auto;padding:clamp(4rem,10vh,7rem) 0}
    .nc-hero__kicker{font-family:${body};letter-spacing:.14em;text-transform:uppercase;color:${accent};font-size:.8rem}
    .nc-hero h1{font-family:${display};font-size:clamp(2.4rem,5.4vw,4.4rem);line-height:1.04;margin:.6rem 0 1rem;max-width:18ch;text-wrap:balance}
    .nc-hero p{font-family:${body};color:${muted};font-size:clamp(1rem,1.4vw,1.2rem);max-width:52ch}
    .nc-hero__row{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:1.8rem}
    .nc-btn{min-width:0;border:0;cursor:pointer;font-family:${body};font-size:1rem;padding:.9rem 1.5rem;border-radius:.6rem;background:${accent};color:${bg};transition:transform .18s ease, box-shadow .18s ease}
    .nc-btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px ${accent}33}
    .nc-btn:focus-visible{outline:2px solid ${accent};outline-offset:2px}
    @media (prefers-reduced-motion: reduce){.nc-btn{transition:none}}
  </style>
  <div class="nc-hero__in">
    <p class="nc-hero__kicker">${esc(b.kind)}</p>
    <h1>${esc(b.sell)} — done right, done once.</h1>
    <p>Built for ${esc(b.audience)}: clear pricing, honest process, and a team that answers. See how it works, then book in under a minute.</p>
    <div class="nc-hero__row">
      <button class="nc-btn" type="button">Book now</button>
      <button class="nc-btn nc-btn--ghost" type="button">How it works</button>
    </div>
  </div>
</section>`;
    case 'features': return `<section class="nc-feat" aria-label="What you get">
  <style>
    .nc-feat{background:${surface};color:${ink};padding:clamp(3.5rem,8vh,6rem) 0;overflow-x:clip}
    .nc-feat__in{width:min(1120px,92%);margin-inline:auto}
    .nc-feat h2{font-family:${display};font-size:clamp(1.7rem,3vw,2.4rem);margin:0 0 2rem;text-wrap:balance}
    .nc-feat__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1.1rem}
    .nc-feat article{min-width:0;background:${bg};border:1px solid ${line};border-radius:.9rem;padding:1.4rem;display:flex;flex-direction:column;gap:.5rem}
    .nc-feat h3{font-size:1.05rem;margin:0}
    .nc-feat p{font-family:${body};color:${muted};margin:0;font-size:.95rem;line-height:1.55}
    .nc-feat .ic{width:34px;height:34px;border-radius:8px;background:${accent}1a;color:${accent};display:grid;place-items:center}
  </style>
  <div class="nc-feat__in">
    <h2>Everything you came for</h2>
    <div class="nc-feat__grid">
      <article><div class="ic" aria-hidden="true">✓</div><h3>Fast, honest quotes</h3><p>Real numbers on the page — no "contact us for price" games that waste a week.</p></article>
      <article><div class="ic" aria-hidden="true">✓</div><h3>Book in 60 seconds</h3><p>Pick a slot, get a confirmation immediately. Reschedule any time, no calls needed.</p></article>
      <article><div class="ic" aria-hidden="true">✓</div><h3>Humans on support</h3><p>One message reaches a person who can actually decide things — not a bot maze.</p></article>
    </div>
  </div>
</section>`;
    case 'stats': return `<section class="nc-stats" aria-label="Track record">
  <style>
    .nc-stats{background:${ink};color:${bg};padding:clamp(2.5rem,6vh,4rem) 0;overflow-x:clip}
    .nc-stats__in{width:min(1120px,92%);margin-inline:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;text-align:center}
    .nc-stats b{font-family:${display};font-size:clamp(1.8rem,3.4vw,2.6rem);display:block}
    .nc-stats span{opacity:.75;font-size:.9rem}
  </style>
  <div class="nc-stats__in">
    <div><b>4,800+</b><span>${esc(b.audience)} served</span></div>
    <div><b>4.9/5</b><span>average rating</span></div>
    <div><b>&lt; 2 hrs</b><span>reply time</span></div>
  </div>
</section>`;
    case 'cta': return `<section class="nc-cta" aria-label="Get started">
  <style>
    .nc-cta{background:${accent};color:${bg};padding:clamp(3rem,7vh,5rem) 0;overflow-x:clip}
    .nc-cta__in{width:min(760px,92%);margin-inline:auto;text-align:center;display:grid;gap:1.1rem;justify-items:center}
    .nc-cta h2{font-family:${display};font-size:clamp(1.6rem,3vw,2.3rem);margin:0;text-wrap:balance}
    .nc-cta a,.nc-cta button{font-family:${body};font-size:1rem;padding:.9rem 1.7rem;border:0;border-radius:.6rem;background:${ink};color:${bg};cursor:pointer;text-decoration:none}
    .nc-cta a:focus-visible,.nc-cta button:focus-visible{outline:2px solid ${bg};outline-offset:3px}
  </style>
  <div class="nc-cta__in">
    <h2>Ready when you are — slots this week.</h2>
    <button type="button">Book your slot</button>
  </div>
</section>`;
    default: return `<section class="nc-${key}" aria-label="${esc(key)}">
  <style>.nc-${key}{background:${bg};color:${ink};padding:clamp(3rem,7vh,5rem) 0;overflow-x:clip}.nc-${key}__in{width:min(1120px,92%);margin-inline:auto}</style>
  <div class="nc-${key}__in"><h2>${esc(key)}</h2></div>
</section>`;
  }
}

function genSection(r) {
  const b = pick(r, BUSINESSES);
  const style = pick(r, STYLE_FAMILIES);
  const pal = paletteFor(r);
  const fonts = pick(r, FONT_PAIRINGS);
  const key = pick(r, ['hero', 'features', 'stats', 'cta']);
  const ask = (SECTIONS_BANK.find((s) => s.key === key) || SECTIONS_BANK[0]).ask;
  const user = [
    `Section: ${key}. Requirement: ${ask}.`,
    `Business: ${b.kind} (${b.audience}). Style: ${style.name} — ${style.hint}.`,
    `Brand tokens: bg ${pal.bg}, surface ${pal.surface}, ink ${pal.ink}, muted ${pal.muted}, accent ${pal.accent}, line ${pal.line}; display ${fonts.display || fonts.name || 'Sora'}, body ${fonts.body || fonts.name || 'Inter'}.`,
    `Output the complete <section> with scoped <style>. Mobile-first, wrap-safe, states included.`,
  ].join('\n');
  return { system: SYS_SECTION, user, assistant: sectionTemplate(key, b, pal, { display: `'${fonts.display || fonts.name || 'Sora'}'`, body: `'${fonts.body || fonts.name || 'Inter'}'` }) };
}

function genTokens(r) {
  const b = pick(r, BUSINESSES);
  const style = pick(r, STYLE_FAMILIES);
  const pal = paletteFor(r);
  const fonts = fontPairFor({ brief: `${b.kind} ${b.tone}`, theme: style.name, seed: Math.floor(r() * 1e6) });
  const motion = pick(r, ['balanced', 'calm', 'expressive']);
  const user = `Brand words: ${b.kind}, ${b.tone}, ${style.name}. Ground: ${style.hint}. Motion: ${motion}. Emit the design-token JSON.`;
  const assistant = JSON.stringify({
    palette: pal,
    fonts: { display: fonts.display || 'Sora', body: fonts.body || 'Inter', scale: 'clamp() fluid, 1.06 ratio on 1rem base' },
    radius: style.name === 'warm-minimal' ? '1rem cards / .6rem controls' : '.9rem cards / .5rem controls',
    shadow: '0 1px 2px rgb(0 0 0 / .06), 0 10px 24px rgb(0 0 0 / .08) on hover only',
    motion: `${motion}: opacity+12px translateY entrances, 180-240ms ease-out, disabled under prefers-reduced-motion`,
    rationale: `${pal.accent} carries the brand alone on a ${style.name} ground; ink/muted keep ${b.audience} reading comfortably; ${fonts.display || 'Sora'} gives the ${b.tone} voice.`,
  }, null, 2);
  return { system: SYS_TOKENS, user, assistant };
}

function genCopy(r) {
  const b = pick(r, BUSINESSES);
  const style = pick(r, STYLE_FAMILIES);
  const keys = pick(r, [['features', 'cta'], ['pricing', 'faq'], ['story', 'stats']]);
  const titles = { features: 'What you actually get', pricing: 'Simple, published prices', faq: 'Questions people really ask', story: 'Why we started', stats: 'The track record', cta: 'Slots this week' };
  const heads = [
    `${b.sell}, without the runaround.`,
    `The honest way to ${b.sell.toLowerCase()}.`,
    `${b.kind.split(' ').slice(0, 3).join(' ')} that actually shows up.`,
  ];
  const user = [
    `Write launch copy for ${b.kind}. Audience: ${b.audience}. Offer: ${b.sell}. Tone: ${b.tone}. Ground: ${style.hint}.`,
    `Sections to fill: hero, then ${keys.join(' and ')}.`,
    `Zero generic phrasing. Specific numbers and concrete promises only where any business could truthfully claim them.`,
  ].join('\n');
  const assistant = JSON.stringify({
    kicker: b.kind.toUpperCase().slice(0, 32),
    headline: pick(r, heads),
    sub: `${b.sell[0].toUpperCase() + b.sell.slice(1)} for ${b.audience} — transparent pricing, real humans, and a process you can see end to end.`,
    ctas: ['Book a slot', 'See how it works'],
    section_copy: keys.map((k) => ({
      key: k,
      title: titles[k],
      body: k === 'faq'
        ? 'Pricing, rescheduling, refunds and what happens if plans change — answered in plain words, no fine print.'
        : `Written for ${b.audience}: one clear claim, one proof point, one action. No adjectives doing the work of evidence.`,
    })),
  }, null, 2);
  return { system: SYS_COPY, user, assistant };
}

const QA_LAWS = [
  { law: 'position:fixed inside a section pins content to the VIEWPORT and stacks it over later sections — section roots must anchor their own children (position:relative + absolute children only).', mutate: 'position:relative;isolation:isolate', brokenAt: 'position:relative;isolation:isolate', replacement: 'position:fixed' },
  { law: '100vh overflows mobile URL bars; every 100vh-style hero needs an svh twin (min(92svh, ...)).', mutate: 'min-height:min(92svh,760px)', brokenAt: 'min-height:min(92svh,760px)', replacement: 'min-height:100vh' },
  { law: 'grid children need min-width:0 — long words and URLs blow out fixed columns otherwise.', mutate: 'min-width:0', brokenAt: 'min-width:0', replacement: 'min-width:auto' },
];

function genQaFix(r) {
  const base = sectionTemplate('hero', BUSINESSES[0], paletteFor(r), { display: "'Sora'", body: "'Inter'" });
  const law = pick(r, QA_LAWS);
  const broken = base.replace(law.brokenAt, law.replacement);
  const user = `Law violated: ${law.law}\nFix the snippet (preserve intent, change only what the law requires):\n\n${broken}`;
  return { system: SYS_QA, user, assistant: base };
}

function genDevops(r) {
  const jobs = [
    {
      ask: 'A GitHub Actions workflow that builds a Flutter APK on every push to main and uploads it as an artifact.',
      yaml: `# build-apk.yml
name: Build Android APK

on:
  push:
    branches: [main]
  workflow_dispatch: {}

jobs:
  apk:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true
      - run: flutter pub get
      - run: flutter analyze --fatal-infos
      - run: flutter test
      - run: flutter build apk --release
      - uses: actions/upload-artifact@v4
        with:
          name: app-release-apk
          path: build/app/outputs/flutter-apk/app-release.apk`,
    },
    {
      ask: 'A GitHub Actions workflow that deploys a static site to GitHub Pages on push.',
      yaml: `# deploy-pages.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch: {}

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4`,
    },
    {
      ask: 'A GitHub Actions workflow that deploys a Cloudflare Worker with wrangler, the API token coming from GitHub secrets.',
      yaml: `# deploy-worker.yml
name: Deploy Worker

on:
  push:
    branches: [master]
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: cloudflare/worker`,
    },
  ];
  const j = pick(r, jobs);
  return { system: SYS_DEVOPS, user: j.ask, assistant: j.yaml };
}

function genSkill(r) {
  const s = pick(r, SEED_SKILLS);
  const title = s.title || s.slug || 'craft';
  const domain = s.domain || 'engineering';
  const user = pick(r, [
    `Domain: ${domain}. Distill the working rules for: ${title}.`,
    `We keep losing quality on "${title}". Write the ${domain} skill that fixes it permanently.`,
  ]);
  const body = typeof s.body === 'string' ? s.body : JSON.stringify(s.body);
  return { system: SYS_SKILL, user, assistant: body };
}

const ASSIST_QA = [
  ['How do I point my custom domain at the site Nebula built?',
   'Two hops: (1) in your DNS panel add a CNAME for the subdomain to the hosting target (e.g. <user>.github.io for Pages, or the Workers route); (2) enable the domain in the hosting platform (Pages → Settings → Custom domain, or Cloudflare → Workers Routes). Propagation is usually minutes; verify in a browser before announcing.'],
  ['The mailer says "AI engine missing" — what do I do?',
   'That means no LLM engine is configured. The default path needs nothing paid: the deploy already includes the Workers AI binding. If status still lists it, redeploy once so wrangler creates the binding. To use our own model instead, set LLM_CUSTOM_BASE_URL (and optionally LLM_CUSTOM_MODEL) to your llama.cpp/HF endpoint — the router picks it up without a code redeploy.'],
  ['How do campaigns avoid emailing one person twice?',
   'Two guards: a per-contact frequency window (MAIL_FREQ_HOURS, default 20h) skips anyone contacted inside the window, and a dedup lock prevents overlapping runs. Naming a contact explicitly in the instruction overrides the window; nothing else does.'],
  ['Where do the site builds live and can I download the code?',
   'Every build is pushed to R2 under the owner account and served from /sites/<id>. You can push the full project to GitHub from the Studio publish sheet — private repo toggle, plus optional Pages deploy and APK build flows that are committed as real workflow files.'],
  ['What are the free-tier AI limits and how do I stay inside them?',
   'Workers AI includes a daily free allocation on the account; a full site build costs a few thousand tokens per agent call. To stretch it: keep builds focused (5-7 sections), route routine sections to the fine-tuned Nebula Core (self-hosted = unlimited), and leave Sarvam unset so nothing bills.'],
];

function genAssist(r) {
  const [q, a] = pick(r, ASSIST_QA);
  return { system: SYS_ASSIST, user: q, assistant: a };
}

/* ── Assemble ────────────────────────────────────────────────────── */

const FAMILIES = [
  ['plan', genPlan, 60],
  ['section', genSection, 220],
  ['tokens', genTokens, 60],
  ['copy', genCopy, 80],
  ['qa_fix', genQaFix, 12],
  ['devops', genDevops, 9],
  ['skill', genSkill, 48],   // 24 seed skills × 2 phrasings
  ['assistant', genAssist, 5], // exactly the 5 grounded answers — no synthetic filler
];

function main() {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > -1 ? process.argv[outIdx + 1] : ROOT;
  mkdirSync(outDir, { recursive: true });

  const r = rng(20260913); // stable seed — rebuilds are byte-identical
  const rows = [];
  const stats = { total: 0, by_family: {}, approx_tokens: 0 };

  for (const [name, gen, n] of FAMILIES) {
    for (let i = 0; i < n; i++) {
      let s;
      try { s = gen(r); } catch (e) { console.error(`[skip] ${name}#${i}: ${e.message}`); continue; }
      const messages = [
        { role: 'system', content: s.system },
        { role: 'user', content: s.user },
        { role: 'assistant', content: s.assistant },
      ];
      rows.push(JSON.stringify({ family: name, messages }));
      stats.by_family[name] = (stats.by_family[name] || 0) + 1;
      stats.approx_tokens += Math.round((s.system.length + s.user.length + s.assistant.length) / 3.6);
    }
  }
  stats.total = rows.length;

  writeFileSync(join(outDir, 'nebula-core.jsonl'), rows.join('\n') + '\n');
  writeFileSync(join(outDir, 'nebula-core.stats.json'), JSON.stringify(stats, null, 2));
  console.log(`nebula-core dataset: ${stats.total} samples, ~${Math.round(stats.approx_tokens / 1000)}k tokens`);
  console.log(JSON.stringify(stats.by_family));
}

main();
