/**
 * CODEGEN — the bespoke code-writing engine (Agent v7 → v11).
 *
 * v11 AURA — pages finally LOOK alive and REAL:
 *   • IMAGES  — the Photographer (imager.js) sources and verifies real
 *     photography per section; engineers may reference ONLY those exact
 *     URLs; the sanitizer strips anything else. No invented URLs, no
 *     broken images — and no more image-less pages.
 *   • MOTION  — a marquee band component, count-up stat animation, nav
 *     condense-on-scroll, image treatment (.ph), ambient float and a
 *     sheen accent surface join the intensity-scaled reveal system.
 *   • IDENTITY — nav, footer and favicon render THE CLIENT's name from
 *     sitebrand.js; the owner's brand can no longer leak in.
 *
 * THE HONEST DIAGNOSIS: through v6 the final HTML of every marketing site
 * came from renderSite() — a deterministic template engine. The AI picked
 * the design system and wrote the words, but never wrote ONE line of the
 * page's actual HTML/CSS. Every business on the same theme got the same
 * skeleton. The user felt it instantly: "it's building with templates."
 *
 * v7 flips the last piece. The agent now does what a real engineer does
 * when a client asks for a website:
 *
 *   1. THINK      designBrief()   — art direction (designer.js, unchanged)
 *   2. RESEARCH   researchFacts() — live web facts (designer.js)
 *   3. WRITE      writeCopy()     — conversion copy (designer.js)
 *   4. PLAN       planSections()  — information architecture: which
 *                 sections, what each must achieve, what composition
 *                 fits THIS content, what motion language to use
 *   5. CODE       codeSection()   — hand-write each section's HTML +
 *                 scoped CSS, one AI call per section (fits the ~2k
 *                 token budget; the model chooses the composition)
 *   6. REVIEW     reviewSections() — a director pass over the written
 *                 code; weak sections get ONE regeneration
 *   7. WIRE       assembleSite()  — deterministic assembly: global CSS
 *                 token layer, fonts, nav, footer, reveal JS, sanitizing,
 *                 structure validation
 *
 * site_templates.js is DEMOTED to a safety net: if codegen fails at any
 * point the builder still ships the deterministic render — a build can
 * never fail — but successful builds are now genuinely bespoke.
 *
 * Safety: AI-authored fragments are sanitized (no remote scripts/iframes,
 * no inline handlers, no <script>), hrefs pass safeHref at assembly, and
 * the assembler guarantees a complete document (doctype → </html>).
 */

import { runAgent, understandingBlock } from './agents.js';
import { hex, lum, mix, FONT_STACKS, DISPLAY_OF_FONT } from './site_templates.js';
import { esc, safeHref } from './htmlutil.js';
import { isAllowedImageSrc } from './imager.js';
import { masteryBlock, cssGlobalPack, wiringPack, motionPack, policyNeeds, policyPack } from './mastery.js';

const SECTION_AI_TOKENS = 3400; // v14: room for real composition craft
const PLAN_AI_TOKENS = 900;
const REVIEW_AI_TOKENS = 650;
const MAX_SECTIONS = 7; // v14: richer pages — 5 was starving the story
const MAX_REGENS = 2;
const HTML_MIN = 150;
const HTML_MAX = 12000; // v14
const CSS_MIN = 60;
const CSS_MAX = 12000; // v14

/**
 * v13 CRAFT — a bounded code payload attached to engineer trace rows so
 * the app can show the code AS IT IS WRITTEN, expanded in a shell view.
 */
function codePayload(section, out) {
  const htmlHead = String(out.html || '').slice(0, 480);
  const cssHead = String(out.css || '').slice(0, 380);
  const lines = (String(out.html || '').match(/\n/g) || []).length + (String(out.css || '').match(/\n/g) || []).length + 3;
  return {
    lang: 'html',
    label: `sec-${section.id} · ${section.name}`,
    preview: `<section id="sec-${section.id}"> …\n${htmlHead}\n…\n<style>\n${cssHead}\n…</style>`,
    lines,
    chars: String(out.html || '').length + String(out.css || '').length,
  };
}

/* ══ Copy fragments — only the groups a section needs ═══════════════ */

function copyFragment(content, keys) {
  const out = {};
  for (const k of keys || []) {
    if (content[k] !== undefined && content[k] !== null && content[k] !== '') out[k] = content[k];
  }
  // Always available: brand + contact for CTAs.
  return JSON.stringify(out).slice(0, 1150);
}

/* ══ Stage 4 — PLAN ══════════════════════════════════════════════════ */

const PLAN_SYSTEM = `You are the lead architect of a world-class web studio. A client wants a bespoke page. Plan its information architecture — mapped to the design director's UX flow. Respond with ONLY JSON:

{"sections":[{"id":"short-id (a-z, 3-10 chars)","name":"Nav label, 1-2 words","goal":"what this section must make the visitor think or do","journey":"which UX-flow beat this section serves, 2-6 words","layout":"1-2 sentences describing the COMPOSITION you will hand-code for this content — asymmetry, columns, alignment, art placement. Decide like a designer, not a menu.","content_keys":["which copy JSON groups this section renders, e.g. headline, sub, primary_cta, features"],"motion":"the entrance/ambient motion idea, 5-12 words"}],"nav":["section ids to show in the navbar, 3-5, ending with a contact-ish section"]}

Rules:
- 4-6 sections total. First MUST be a hero (id "hero"). Last MUST convert (contact/booking/CTA band).
- Sections must serve THIS business — no generic "About us" filler unless the brief demands proof.
- Vary composition across sections: do not plan two identical column grids.
- journey: quote or compress the matching beat from the UX FLOW the Art Director gave you — every section must advance the journey; no dead sections.
- content_keys come from this vocabulary: kicker, headline, sub, primary_cta, secondary_cta, hero_badges, marquee, stats, features, showcase, testimonials, faq, offer, event, work, skills, report, contact, cta_title, cta_sub.
- Every content_key you list MUST be rendered by exactly one section (copy must not be dropped).`;

function defaultPlan(kind, content) {
  const s = (id, name, goal, layout, keys, motion) => ({ id, name, goal, layout, content_keys: keys, motion });
  const common = [
    s('hero', 'Home', 'instantly state the promise and win the first click', 'Full-bleed statement hero: oversized display headline, supporting line, primary CTA row with secondary ghost link; trust chips under the CTAs; ambient art behind on one side.', ['kicker', 'headline', 'sub', 'primary_cta', 'secondary_cta', 'hero_badges', 'marquee'], 'staggered rise on load, slow drift on the art'),
    s('features', 'Why us', 'turn interest into belief with concrete outcomes', 'Asymmetric two-column: sticky section title left, outcome cards in a staggered grid right, each card with icon, outcome title, proof line.', ['features', 'stats'], 'cards reveal on scroll with rising blur'),
  ];
  const close = [
    s('contact', 'Contact', 'convert — make acting effortless', 'Split band: bold call-to-action headline and CTA button left; contact details as a tidy definition list right; hairline frame.', ['cta_title', 'cta_sub', 'contact', 'primary_cta'], 'band slides up once on reveal'),
  ];
  if (kind === 'portfolio' && Array.isArray(content.work) && content.work.length) {
    return { sections: [...common, s('work', 'Work', 'show the craft with real artifacts', 'Editorial case grid: alternating wide/narrow tiles, title + tag + one-line blurb, generous whitespace.', ['work', 'skills'], 'tiles fade-rise with per-tile delay'), ...close], nav: ['hero', 'features', 'work', 'contact'], ai: false };
  }
  if (kind === 'event') {
    return { sections: [...common, s('agenda', 'Agenda', 'make the day concrete and worth attending', 'Timeline rail: time chips left, items right, speakers row at the end.', ['event'], 'items slide in along the rail'), ...close], nav: ['hero', 'features', 'agenda', 'contact'], ai: false };
  }
  if (Array.isArray(content.faq) && content.faq.length && Array.isArray(content.testimonials) && content.testimonials.length) {
    return { sections: [...common, s('proof', 'Proof', 'de-risk the decision with voices and answers', 'Two-tier proof: testimonial quote cards on top, FAQ accordion beneath.', ['testimonials', 'faq'], 'quote marks scale in; accordion expands smoothly'), ...close], nav: ['hero', 'features', 'proof', 'contact'], ai: false };
  }
  if (Array.isArray(content.testimonials) && content.testimonials.length) {
    return { sections: [...common, s('voices', 'Voices', 'let customers do the convincing', 'Horizontal quote cards, oversized quotation glyph, name + role row.', ['testimonials'], 'cards reveal left-to-right'), ...close], nav: ['hero', 'features', 'voices', 'contact'], ai: false };
  }
  if (Array.isArray(content.faq) && content.faq.length) {
    return { sections: [...common, s('faq', 'FAQ', 'answer the real objections', 'Single column accordion with plus glyphs, generous row spacing.', ['faq'], 'rows reveal sequentially'), ...close], nav: ['hero', 'features', 'faq', 'contact'], ai: false };
  }
  return { sections: [...common, ...close], nav: ['hero', 'features', 'contact'], ai: false };
}

const hasValue = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.values(v).some((x) => x !== null && x !== undefined && String(x).trim() !== '') : v !== null && v !== undefined && String(v).trim() !== '');

export async function planSections(env, { kind, brief, brand, site = null, thought, content, skillsBlock = '', lead = null, understanding = null, team = null }) {
  const vocabNote = `Available copy groups for THIS page: ${Object.keys(content).filter((k) => hasValue(content[k])).join(', ') || 'headline, sub'}`;
  const cap = Math.min(MAX_SECTIONS, Number(lead?.sections_target) || MAX_SECTIONS);
  const uxFlow = Array.isArray(thought?.design?.ux_flow) && thought.design.ux_flow.length
    ? `UX FLOW the visitor travels (map every section to its beat): ${thought.design.ux_flow.join(' | ')}`
    : '';
  try {
    const j = await runAgent(
      env,
      team,
      'architect',
      'planning the sections',
      [
        { role: 'system', content: [PLAN_SYSTEM, skillsBlock].filter(Boolean).join('\n\n') },
        {
          role: 'user',
          content: [
            `PAGE KIND: ${kind}`,
            `BUSINESS: ${site?.name || brand?.name || 'the client'}`,
            `BRIEF: ${String(brief).slice(0, 900)}`,
            understandingBlock(understanding),
            `DESIGN DIRECTION: theme ${thought.design.themeLabel}, voice "${thought.design.voice || 'clear, confident'}", audience "${thought.design.audience || 'general'}", hero style ${thought.design.hero}${thought.design.motion_intensity ? `, motion ${thought.design.motion_intensity}` : ''}${thought.design.type_scale ? `, type scale ${thought.design.type_scale}` : ''}`,
            uxFlow,
            thought.mustHave.length ? `MUST INCLUDE: ${thought.mustHave.join('; ')}` : '',
            lead?.risks?.length ? `THE LEAD FLAGGED THESE RISKS — design against them: ${lead.risks.join('; ')}` : '',
            lead?.emphasis?.length ? `THE LEAD WANTS EXTRA CRAFT ON: ${lead.emphasis.join('; ')}` : '',
            `PLAN EXACTLY ${cap} SECTIONS (or fewer if the page is tighter for it).`,
            vocabNote,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: PLAN_AI_TOKENS, temperature: 0.65 },
      (out) => `${Math.min(cap, Array.isArray(out?.sections) ? out.sections.length : 0)} sections architected`
    );
    const raw = Array.isArray(j.sections) ? j.sections : [];
    const seen = new Set();
    const sections = [];
    for (const sec of raw) {
      const id = String(sec?.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      sections.push({
        id,
        name: String(sec?.name || id).slice(0, 24),
        goal: String(sec?.goal || '').slice(0, 160),
        journey: String(sec?.journey || '').slice(0, 60),
        layout: String(sec?.layout || '').slice(0, 320),
        content_keys: Array.isArray(sec?.content_keys) ? sec.content_keys.map((k) => String(k).slice(0, 20)).filter((k) => k in content).slice(0, 6) : [],
        motion: String(sec?.motion || '').slice(0, 120),
      });
      if (sections.length >= cap) break;
    }
    if (!sections.length || sections[0].id !== 'hero') throw new Error('plan rejected: needs a hero first');
    // Guarantee the copy survives: hero copy is pinned to the hero; every
    // other unclaimed key lands on the closest section (never drop the
    // model's written words). v14 BUGFIX: headline/sub/kicker used to be
    // dumped onto the LAST section — a testimonial band suddenly re-rendered
    // the hero over a photo (the "duplicated hero" users reported).
    const HERO_ONLY = new Set(['kicker', 'headline', 'sub']);
    const claimed = new Set(sections.flatMap((x) => x.content_keys));
    const heroSec = sections.find((s) => s.id === 'hero');
    if (heroSec) {
      const pin = [...HERO_ONLY].filter((k) => !claimed.has(k) && hasValue(content[k]));
      if (pin.length) heroSec.content_keys = [...new Set([...heroSec.content_keys, ...pin])].slice(0, 8);
    }
    const orphanKeys = Object.keys(content).filter((k) => !claimed.has(k) && !HERO_ONLY.has(k) && !['title', 'footer_note'].includes(k));
    if (orphanKeys.length) {
      const keys = orphanKeys.slice(0, 4);
      sections[sections.length - 1].content_keys = [...new Set([...sections[sections.length - 1].content_keys, ...keys])].slice(0, 8);
    }
    const nav = Array.isArray(j.nav) ? j.nav.map((n) => String(n).toLowerCase().replace(/[^a-z0-9-]/g, '')).filter((n) => seen.has(n)).slice(0, 5) : sections.map((x) => x.id).slice(0, 4);
    return { sections, nav: nav.length ? nav : sections.map((x) => x.id).slice(0, 4), ai: true };
  } catch {
    const fb = defaultPlan(kind, content);
    return { ...fb, nav: fb.sections.map((x) => x.id).slice(0, 4) };
  }
}

/* ══ Stage 5 — CODE (per section) ════════════════════════════════════ */

function sectionSystemPrompt({ id, kind, brand, hasImages, mastery = '' }) {
  return `You are a senior front-end engineer at an award-winning web studio. You are HAND-CODING one section of a bespoke ${kind} page for ${brand.name}. There is no template — every line is written for this business.

COMPOSITION LIBRARY (pick per content — never repeat the same composition twice on a page):
• bento — 12-col grid, tiles spanning 2-3 cols, ONE dominant tile, others supporting
• split-feature — 7/5 asymmetric split, media bleeding toward the section edge
• sticky-rail — title column sticky, content column scrolls (features, menus, services)
• overlap — cards overlap the previous section's edge (negative margin), depth via shadow
• mosaic — editorial media grid with varied tile heights, caption overlays
• stat-band — full-width row of 3-4 oversized tabular-number stats separated by hairlines
• timeline — vertical rail with time chips and alternating rows
• quote-feature — ONE testimonial spotlighted with an oversized quotation glyph
• parallax-band — full-bleed media band with layered content and gradient scrim
CRAFT LAWS (the difference between premium and template):
• ONE focal point per section; everything else supports it
• scale CONTRAST: oversized display element beside small precise caption; never all-same-size
• asymmetric beats symmetric; overlap beats floating; hairlines beat boxes
• whitespace is a material — density comes from typography, not cramming
• never render 3+ identical cards in a row — vary spans, offsets, media, or rhythm
LAYOUT SAFETY (this page is served on real phones — violations get caught):
• position:absolute is for DECORATIVE art layers and scrims ONLY (pointer-events:none, z-index:-1 or 0) — NEVER for text blocks, cards or CTAs; no position:fixed
• every grid/flex child that holds text gets min-width:0 so long words wrap, never overflow
• viewport-height art uses 100svh (never bare 100vh — mobile URL bars eat it)
• card rows: equal heights via grid; headings clamp() so nothing sticks out of a card

Respond with ONLY this format (no markdown fences, no commentary):

<section id="sec-${id}" ...>
...semantic HTML...
</section>
<style>
/* CSS scoped to #sec-${id} */
...
</style>

HARD RULES
- Exactly one <section id="sec-${id}"> root element. No <script>, no <html>/<head>/<body>, no <iframe>, no inline on* handlers, no style="" attributes.
- IMAGES CONTRACT: when the user message contains an IMAGES list, the section MUST embed that photo as <img src="EXACT-URL" alt="..." class="ph" loading="lazy"> and build the composition AROUND it (framed panel, split layout, overlay, mask). Ignoring the assigned photo fails review. No IMAGES list → NO <img> at all; build the atmosphere with pure CSS (gradients, layered shapes, the page art variables).
- Every CSS selector starts with #sec-${id}. Mobile-first: phone layout first, then ONE @media (min-width:768px) block.
- Use the page variables (given in the brief): colors, --r radius, --font body / --display display font, spacing scale --sp1..--sp6. Content sits inside .wrap (already centered, max-width var(--maxw)) — do NOT redefine .wrap.
- Typography: clamp() font sizes; headings use var(--display).
- MOTION IS REQUIRED (the page must feel alive):
  · mark animatable children with data-rev (stagger with data-rev-delay="1..4"),
  · one :hover transition on interactive elements (lift/scale/glow),
  · at least one unique @keyframes named ${id}-* (entrance or ambient — e.g. slow drift, sheen, float),
  · when your copy includes "marquee": render <div class="marquee"><div class="marquee-track"><span>word</span>…</div></div> with the words TWICE inside .marquee-track for a seamless loop (the page provides the animation),
  · when your copy includes "stats": render the value element as <span data-count="40">0</span> (keep the suffix like % or + OUTSIDE the span) — the page counts up on reveal.${hasImages ? '\n  · your IMAGES list is below — wire the photo into the composition with craft (mask, frame, overlay, parallax depth).' : ''}
- Accessibility: text contrast >= 4.5:1, :focus-visible outline on links/buttons, buttons are <a class="btn btn-accent"> (page provides .btn styles) or real <button>.
- Glass surfaces may use .glass, gradient text .text-gradient, glow fields .glow, bento grids .bento (page provides them).
- Keep the whole answer under 220 lines. Every element earns its place; density and craft beat bloat.${mastery ? `\n\n${mastery}` : ''}`;
}

function sectionUserPrompt({ design, section, content, brand, kind, brief, images = null }) {
  const v = designVars(design);
  const rampLine = design.ramp
    ? ` RAMP: ${Object.entries(design.ramp).filter(([k]) => k !== 'onAccent').map(([k, hexv]) => `-${k}:${hexv}`).join(' ')}`
    : '';
  const motionLine = design.motion_intensity === 'bold'
    ? 'MOTION INTENSITY: bold — confident choreographed entrances and visible ambient motion are wanted.'
    : design.motion_intensity === 'calm'
      ? 'MOTION INTENSITY: calm — restrained fades and small translations only; no dramatic movement.'
      : 'MOTION INTENSITY: balanced — clear reveals plus one subtle ambient motif.';
  const myImage = images?.find((im) => im.section === section.id) || null;
  const imageLines = myImage
    ? `IMAGES (verified for THIS section — the only <img> URLs you may use):\n${myImage.url}\nalt: "${myImage.alt}"`
    : '';
  return [
    `BUSINESS: ${brand.name} — ${String(brief).slice(0, 200)}`,
    `VOICE: "${design.voice || 'clear, confident'}" · AUDIENCE: ${design.audience || 'general'} · KIND: ${kind}`,
    `PAGE VARIABLES: --bg:${v.bg} --surface:${v.surface} --ink:${v.ink} --muted:${v.muted} --accent:${v.accent} (text on accent: ${v.onAccent}) --accent2:${v.accent2} --accent-soft (translucent accent tint) --border:${v.border} --r:${design.radius}px --font:${DISPLAY_OF_FONT[design.font] || "'Inter', sans-serif"} / body ${FONT_STACKS[design.font]?.css || FONT_STACKS.modern.css}${rampLine}`,
    design.fontPair ? `TYPE VOICE (page fonts already loaded): display ${design.fontPair.display} · body ${design.fontPair.body} — use var(--display)/var(--font), never @import.` : '',
    `TYPE SCALE: ${design.type_scale || 'classic'} — dramatic sizes must JUMP between levels; keep the rhythm intentional.`,
    motionLine,
    `SECTION: "${section.name}" — goal: ${section.goal || 'serve the visitor'}`,
    section.journey ? `JOURNEY STAGE (serve exactly this beat): ${section.journey}` : '',
    `COMPOSITION YOU DECIDED (make it real): ${section.layout || 'your best judgment'}`,
    `MOTION INTENT: ${section.motion || 'subtle reveal'}`,
    imageLines,
    `COPY (use these words — do not invent facts): ${copyFragment(content, section.content_keys)}`,
    `NOW hand-code section "sec-${section.id}".`,
  ].filter(Boolean).join('\n');
}

function sanitizeSectionHtml(html, id, allowedImages = null) {
  let h = String(html || '');
  // Strip scripts/iframes whole, kill inline handlers and remote srcs.
  h = h
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/<iframe[\s\S]*?(<\/iframe\s*>|>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remote srcs: ONLY the Photographer's verified URLs survive (v11).
    // Everything else — hotlinked stock, hallucinated URLs — is stripped
    // so a broken image can never be served.
    .replace(/\ssrc\s*=\s*(['"]?)\s*((https?:)?\/\/[^'">\s]*)\1/gi, (m, q, url) =>
      isAllowedImageSrc(url, allowedImages) ? m : '')
    // srcset/source src with remote URLs: strip the attribute.
    .replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<source[^>]*>/gi, '');
  // Guarantee the section id on the root element.
  if (!new RegExp(`<section[^>]*id=["']?sec-${id}["']?`, 'i').test(h)) {
    h = h.replace(/<section/i, `<section id="sec-${id}"`);
  }
  return h.trim();
}

/**
 * v14 LAYOUT HARDENER — deterministic repairs applied to EVERY section's
 * CSS before it ships. The AI's layout mistakes (viewport-fixed elements,
 * bare 100vh, unwrappable text, unpositioned section roots) are the ones
 * that rendered as overlapping heroes and ragged cards; these classes are
 * now structurally impossible to ship.
 */
export function hardenSectionCss(id, css) {
  let c = String(css || '');
  // 1. Nothing in a section may pin itself to the viewport (the rogue
  //    fixed bars/marquees that slid over the hero).
  c = c.replace(/position\s*:\s*fixed/gi, 'position:absolute');
  // 2. 100vh → keep the declaration but add the small-viewport twin, so
  //    phone URL bars can't push art under the fold (invalid svh on old
  //    browsers is dropped, leaving the vh fallback intact).
  c = c.replace(/(min-height|height)\s*:\s*100vh/gi, (m) => `${m};${m.replace(/100vh/i, '100svh')}`);
  // 3. Anchor root + wrap safety: a positioned section root (so any
  //    absolute art layers anchor to the SECTION, not the page), zero-min
  //    grid/flex children (cards can shrink instead of overflowing), and
  //    break-word on every text element (long words wrap, never stick out).
  c += `\n#sec-${id}{position:relative;overflow-x:clip}#sec-${id} *{min-width:0}#sec-${id} h1,#sec-${id} h2,#sec-${id} h3,#sec-${id} h4,#sec-${id} h5,#sec-${id} p,#sec-${id} li,#sec-${id} span,#sec-${id} a,#sec-${id} b,#sec-${id} strong{overflow-wrap:break-word;hyphens:auto}`;
  return c;
}

/** Validate + extract { html, css } from a model answer. Throws on garbage. */
export function parseSection(raw, id, allowedImages = null) {
  let text = String(raw || '').trim();

  // 0. Prefer a fenced block containing the section — sarvam-105b loves
  //    markdown fences even when told not to use them.
  const fences = [...text.matchAll(/```(?:html|HTML)?\s*\n?([\s\S]*?)```/g)];
  for (const f of fences) {
    if (/<section[\s>]/i.test(f[1])) {
      text = f[1].trim();
      break;
    }
  }

  const secOpen = /<section[\s>]/i.exec(text);
  if (!secOpen) throw new Error('no <section> element');
  const secClose = text.toLowerCase().lastIndexOf('</section>');
  if (secClose === -1 || secClose < secOpen.index) throw new Error('section not closed (truncation)');
  let html = text.slice(secOpen.index, secClose + 10).trim();

  const styleOpen = /<style[^>]*>/i.exec(text);
  if (!styleOpen) throw new Error('no <style> block');
  const afterOpen = text.slice(styleOpen.index);
  const styleClose = /<\/style\s*>/i.exec(afterOpen);
  let css;
  if (styleClose) {
    css = afterOpen.slice(text.indexOf('>', styleOpen.index) - styleOpen.index + 1, styleClose.index).trim();
  } else {
    // Truncated mid-CSS: salvage complete rules up to the last '}' —
    // safe (a rule boundary) and often rescues an otherwise good section.
    const rawCss = afterOpen.slice(text.indexOf('>', styleOpen.index) - styleOpen.index + 1);
    const lastBrace = rawCss.lastIndexOf('}');
    if (lastBrace === -1) throw new Error('style block not closed (truncation)');
    css = rawCss.slice(0, lastBrace + 1).trim();
  }

  html = sanitizeSectionHtml(html, id, allowedImages);

  // v14: validate the ENGINEER'S raw CSS first (scope + size gates must
  // judge what the model wrote — the hardener appends scoped rules and
  // would otherwise mask unscoped/too-small output), then harden.
  if (html.length < HTML_MIN) throw new Error('section HTML too small');
  if (html.length > HTML_MAX) throw new Error('section HTML too large');
  if (css.length < CSS_MIN) throw new Error('section CSS too small');
  if (css.length > CSS_MAX) throw new Error('section CSS too large');
  if (/<(html|head|body|iframe|script)[\s>]/i.test(html)) throw new Error('forbidden tag in section');
  if (!new RegExp(`#sec-${id}[\\s,{.:]`).test(css)) {
    throw new Error('CSS is not scoped to the section');
  }
  const opens = (html.match(/<section[\s>]/gi) || []).length;
  const closes = (html.match(/<\/section\s*>/gi) || []).length;
  if (opens !== closes) throw new Error('unbalanced <section> tags');
  css = hardenSectionCss(id, css);
  if (css.length > CSS_MAX + 500) throw new Error('section CSS too large');
  return { html, css };
}

async function codeSectionOnce(env, ctx, attempt, lastError) {
  const critique = String(ctx.critique || '').slice(0, 200);
  const allowed = ctx.allowedImages || null;
  const messages = [
    { role: 'system', content: sectionSystemPrompt({ id: ctx.section.id, kind: ctx.kind, brand: ctx.brand, hasImages: Boolean(ctx.images?.some((im) => im.section === ctx.section.id)), mastery: ctx.mastery || '' }) },
    { role: 'user', content: attempt === 1 && !critique
      ? sectionUserPrompt(ctx)
      : [
          sectionUserPrompt(ctx),
          critique ? `QA REWORK NOTE from the review pass: "${critique}" — fix exactly this while keeping what already works.` : '',
          lastError && !critique ? `IMPORTANT — your previous attempt was rejected: ${String(lastError).slice(0, 180)}.` : '',
          /truncat|not closed|too large/i.test(String(lastError)) ? 'You ran out of output space: make the section SHORTER (less CSS, fewer elements) while keeping the required motion. ' : '',
          'Respond with ONLY the <section>+<style> answer — no markdown fences, no commentary.',
        ].filter(Boolean).join('\n\n') },
  ];
  const raw = await runAgent(
    env,
    ctx.team,
    'engineer',
    `hand-coding "${ctx.section.name}"`,
    messages,
    { maxTokens: SECTION_AI_TOKENS, temperature: attempt === 1 && !critique ? 0.7 : 0.5 },
    () => `sec-${ctx.section.id} written for ${ctx.brand.name}`
  );
  return parseSection(raw, ctx.section.id, allowed);
}

/** Code one section with the retry + rework policy. Returns null on failure. */
export async function codeSection(env, ctx) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const out = await codeSectionOnce(env, ctx, attempt, ctx._lastError);
      return { ...out, ai: true };
    } catch (e) {
      ctx._lastError = e?.message || String(e);
      console.warn(`[codegen] section ${ctx.section.id} attempt ${attempt}: ${ctx._lastError}`);
    }
  }
  return null;
}

/**
 * Engine-built section for a section the AI could not code. Deterministic,
 * on-brand, uses the same variables + reveal contract — so one stubborn
 * section degrades to a clean engine block instead of throwing away the
 * whole bespoke page.
 */
export function engineFallbackSection(section, content, design) {
  const title = esc(String(section.name || section.id).slice(0, 40));
  const items = [];
  for (const k of section.content_keys || []) {
    const g = content[k];
    if (Array.isArray(g)) {
      for (const it of g.slice(0, 4)) {
        if (it?.title) items.push(`<li><strong>${esc(String(it.title).slice(0, 60))}</strong><span>${esc(String(it.text || '').slice(0, 120))}</span></li>`);
        else if (typeof it === 'string') items.push(`<li>${esc(it.slice(0, 90))}</li>`);
      }
    } else if (k === 'cta_title' && typeof g === 'string' && g) {
      items.push(`<li><strong>${esc(g.slice(0, 60))}</strong></li>`);
    }
  }
  const list = items.length ? `<ul class="s-list">${items.join('')}</ul>` : `<p class="s-sub">${esc(String(content.sub || '').slice(0, 160))}</p>`;
  const cta = content.primary_cta?.href
    ? `<a class="btn btn-accent" href="${safeHref(content.primary_cta.href)}">${esc(content.primary_cta.label || 'Get started')}</a>`
    : '';
  const html = `<section id="sec-${section.id}" data-rev><div class="wrap"><span class="kicker">${esc(String(section.id).slice(0, 16))}</span><h2>${title}</h2>${list}${cta}</div></section>`;
  const css = `#sec-${section.id}{padding:var(--sp6) 0}#sec-${section.id} h2{font-family:var(--display);font-size:clamp(28px,4.5vw,48px);margin:var(--sp2) 0 var(--sp4)}#sec-${section.id} .s-list{list-style:none;display:grid;gap:var(--sp3)}@media(min-width:768px){#sec-${section.id} .s-list{grid-template-columns:1fr 1fr}}#sec-${section.id} .s-list li{border:1px solid var(--border);border-radius:var(--r);padding:var(--sp3);display:grid;gap:6px;background:var(--card)}#sec-${section.id} .s-list strong{font-size:16px}#sec-${section.id} .s-list span{color:var(--muted);font-size:14px}#sec-${section.id} .s-sub{color:var(--muted)}#sec-${section.id} .btn{margin-top:var(--sp4)}@keyframes sec-${section.id}-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}/* engine section */`;
  return { html, css };
}

/* ══ Stage 6 — REVIEW ════════════════════════════════════════════════ */

export async function reviewSections(env, { kind, brand, sections, team = null }) {
  try {
    // v14: the director now reviews a real STRUCTURAL DIGEST (tags, motion
    // contract counts, image wiring, positioning audit) — CSS text alone
    // is how overlapping heroes and empty shells slipped through before.
    const digest = sections
      .map((s) => {
        const html = String(s.html || '');
        const css = String(s.css || '');
        const tags = [...new Set((html.match(/<(h1|h2|h3|p|ul|ol|img|a|button|details|form|figure|blockquote)[\s>]/gi) || []).map((t) => t.slice(1, -1).toLowerCase()))].join(',');
        const revs = (html.match(/data-rev/g) || []).length;
        const kfs = (css.match(/@keyframes/g) || []).length;
        const abs = (css.match(/position\s*:\s*(absolute|fixed)/gi) || []).length;
        const fixed = /position\s*:\s*fixed/i.test(css);
        const imgOk = !s.image || /class=["'][^"']*ph/.test(html);
        return [
          `#${s.id} (${s.name}) — goal: ${s.goal}`,
          `html ${html.length}ch · css ${css.length}ch · tags[${tags}] · data-rev:${revs} · keyframes:${kfs} · abs/fixed:${abs}${fixed ? ' ⚠ position:fixed survived' : ''}${s.image ? ` · image:${imgOk ? 'wired as .ph' : '⚠ not class="ph"'}` : ''}`,
          `CSS head: ${css.slice(0, 320)}`,
        ].join('\n');
      })
      .join('\n\n')
      .slice(0, 3400);
    const j = await runAgent(
      env,
      team,
      'qa',
      'reviewing the hand-written code',
      [
        {
          role: 'system',
          content: `You are the design director reviewing hand-coded sections of a ${kind} page for ${brand.name} before it ships. Judge CRAFT as well as correctness. A section is "fix" if ANY of: broken for a live page (unstyled, empty shell, unusable on mobile, shows a foreign brand name, references an image not in its verified list); FLAT DESIGN (one boring stack of identical cards, no clear focal point, no hierarchy between display and body, wall-of-text with no visual relief); IGNORES THE DESIGN DIRECTION (composition contradicts the planned layout, motion contract missing — no data-rev, no hover state, no unique keyframes); or WASTED SPACE (giant empty regions, content hugging one edge). Stylistic taste ALONE is not a fix reason. Respond with ONLY JSON: {"verdicts":[{"id":"...","verdict":"good"|"fix","note":"<=10 words"}]}`,
        },
        { role: 'user', content: digest },
      ],
      { json: true, maxTokens: REVIEW_AI_TOKENS, temperature: 0.3 },
      (out) => `${(Array.isArray(out?.verdicts) ? out.verdicts : []).filter((v) => v?.verdict === 'fix').length} section(s) flagged for rework`
    );
    const verdicts = {};
    let notes = {};
    const known = new Set((sections || []).map((s) => s.id));
    for (const v of Array.isArray(j.verdicts) ? j.verdicts : []) {
      const id = String(v?.id || '').toLowerCase();
      if (!id || !known.has(id)) continue;
      verdicts[id] = v.verdict === 'fix' ? 'fix' : 'good';
      if (v.note) notes[id] = String(v.note).slice(0, 80);
    }
    return { verdicts, notes, ai: true };
  } catch {
    return { verdicts: {}, notes: {}, ai: false };
  }
}

/* ══ Stage 7 — WIRE (deterministic assembly) ═════════════════════════ */

export function designVars(design) {
  const p = design.palette;
  const bg = hex(p.bg, '#0a0d18') || '#0a0d18';
  const accent = hex(p.accent, '#7c8cff');
  const surface = hex(p.surface, mix(bg, '#ffffff', 0.05));
  return {
    bg,
    surface,
    card: mix(surface, '#ffffff', 0.04),
    ink: hex(p.ink, lum(bg) > 0.5 ? '#16181f' : '#eef1fb'),
    muted: hex(p.muted, lum(bg) > 0.5 ? '#5d6470' : '#98a1c0'),
    accent,
    accent2: hex(p.accent2, mix(accent, '#ffffff', 0.35)),
    onAccent: lum(accent) > 0.62 ? '#0a0d18' : '#ffffff',
    border: lum(bg) > 0.5 ? 'rgba(10,10,15,.12)' : 'rgba(255,255,255,.10)',
  };
}

/** Global CSS: tokens + base + component primitives + reveal system. */
export function globalCss(design) {
  const v = designVars(design);
  const body = FONT_STACKS[design.font]?.css || FONT_STACKS.modern.css;
  const display = DISPLAY_OF_FONT[design.font] || "'Inter', sans-serif";
  // v12 MASTERY: the build's locked Google Fonts pairing (display × body)
  // overrides the generic stack — real typography from a 40+ pairing
  // library, chosen per brief.
  const pair = design.fontPair || null;
  const google = pair?.google || FONT_STACKS[design.font]?.google || FONT_STACKS.modern.google;
  const bodyCss = pair ? `"${pair.body}",${FONT_STACKS[design.font]?.css || FONT_STACKS.modern.css}` : body;
  const displayCss = pair ? `"${pair.display}",${display}` : display;
  const ramp = design.ramp || null;
  const rampVars = ramp
    ? Object.entries(ramp).map(([k, hexv]) => k === 'onAccent' ? '' : `--accent-${k}:${hexv}`).filter(Boolean).join(';') + ';'
    : '';
  const r = design.radius || 16;
  // v10 design-system tokens: motion intensity scales the reveal system,
  // type scale sets the fluid steps, texture picks the page treatment.
  const motion = design.motion_intensity || 'balanced';
  const revShift = motion === 'bold' ? '34px' : motion === 'calm' ? '16px' : '26px';
  const revBlur = motion === 'bold' ? '9px' : motion === 'calm' ? '4px' : '6px';
  const revDur = motion === 'bold' ? '.8s' : motion === 'calm' ? '.55s' : '.7s';
  const steps = design.type_scale === 'dramatic'
    ? '--step-0:clamp(.95rem,.92rem + .3vw,1.05rem);--step-1:clamp(1.15rem,1.05rem + .6vw,1.4rem);--step-2:clamp(1.45rem,1.2rem + 1.4vw,2.1rem);--step-3:clamp(1.9rem,1.4rem + 2.6vw,3.4rem);--step-4:clamp(2.4rem,1.5rem + 4.6vw,5.2rem);--step-5:clamp(3rem,1.6rem + 7.2vw,7.6rem)'
    : design.type_scale === 'compact'
      ? '--step-0:clamp(.9rem,.88rem + .2vw,1rem);--step-1:clamp(1.05rem,1rem + .35vw,1.25rem);--step-2:clamp(1.25rem,1.15rem + .7vw,1.7rem);--step-3:clamp(1.5rem,1.35rem + 1.2vw,2.2rem);--step-4:clamp(1.8rem,1.5rem + 2vw,2.9rem);--step-5:clamp(2.2rem,1.7rem + 3vw,3.8rem)'
      : '--step-0:clamp(.95rem,.9rem + .25vw,1.05rem);--step-1:clamp(1.1rem,1.02rem + .5vw,1.35rem);--step-2:clamp(1.35rem,1.18rem + 1vw,1.9rem);--step-3:clamp(1.7rem,1.4rem + 2vw,2.8rem);--step-4:clamp(2.1rem,1.55rem + 3.4vw,4rem);--step-5:clamp(2.6rem,1.7rem + 5.4vw,5.6rem)';
  const texture = design.texture === 'grid'
    ? `body::before{content:"";position:fixed;inset:0;z-index:1990;pointer-events:none;opacity:.05;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(ellipse at 50% 0%,black 30%,transparent 75%)}`
    : design.texture === 'clean'
      ? ''
      : `body::after{content:"";position:fixed;inset:-50%;z-index:2000;pointer-events:none;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}`;
  return {
    google,
    css: `
:root{--bg:${v.bg};--surface:${v.surface};--card:${v.card};--ink:${v.ink};--muted:${v.muted};--accent:${v.accent};--accent2:${v.accent2};--on-accent:${v.onAccent};--accent-soft:color-mix(in srgb,var(--accent) 16%,transparent);--border:${v.border};--r:${r}px;--maxw:1120px;--font:${bodyCss};--display:${displayCss};--sp1:6px;--sp2:12px;--sp3:20px;--sp4:32px;--sp5:52px;--sp6:84px;--dur-1:.25s;--dur-2:${revDur};--ease-out:cubic-bezier(.2,.7,.2,1);--shadow-rest:0 10px 30px -18px color-mix(in srgb,var(--accent) 55%,transparent);--shadow-lift:0 18px 44px -18px color-mix(in srgb,var(--accent) 70%,transparent);${rampVars}${steps}
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--font);background:var(--bg);color:var(--ink);line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
main{overflow-x:clip}
img,svg{max-width:100%}
h1,h2,h3,h4,h5,h6,p,li,span,a,b,strong{overflow-wrap:break-word}
a{color:inherit;text-decoration:none}
::selection{background:var(--accent);color:var(--on-accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 var(--sp4)}
.btn{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:15px;padding:14px 26px;border-radius:calc(var(--r) * .8);cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease;border:1px solid transparent}
.btn:active{transform:scale(.98)}
.btn-accent{background:var(--accent);color:var(--on-accent);box-shadow:0 10px 30px -12px color-mix(in srgb,var(--accent) 70%,transparent)}
.btn-accent:hover{transform:translateY(-2px);box-shadow:0 16px 36px -12px color-mix(in srgb,var(--accent) 80%,transparent)}
.btn-ghost{border-color:var(--border);color:var(--ink);background:transparent}
.btn-ghost:hover{background:color-mix(in srgb,var(--ink) 6%,transparent)}
.kicker{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
/* scroll-reveal contract — intensity-scaled by the design system */
[data-rev]{opacity:0;transform:translateY(${revShift});filter:blur(${revBlur});transition:opacity ${revDur} var(--ease-out),transform ${revDur} var(--ease-out),filter ${revDur} ease}
[data-rev][data-rev-delay="1"]{transition-delay:.09s}[data-rev][data-rev-delay="2"]{transition-delay:.18s}[data-rev][data-rev-delay="3"]{transition-delay:.27s}[data-rev][data-rev-delay="4"]{transition-delay:.36s}
.rev-in[data-rev]{opacity:1;transform:none;filter:none}
/* v11 AURA — the advanced motion system */
.marquee{overflow:hidden;position:relative;border-block:1px solid var(--border);padding:var(--sp3) 0;mask-image:linear-gradient(90deg,transparent,black 8%,black 92%,transparent)}
.marquee-track{display:flex;gap:var(--sp5);width:max-content;animation:marquee-x var(--marquee-dur,22s) linear infinite}
.marquee-track span{font-family:var(--display);font-size:clamp(1.1rem,1rem + 1.6vw,1.9rem);font-weight:800;letter-spacing:.02em;color:var(--muted);white-space:nowrap}
.marquee-track span:nth-child(even){color:var(--accent);-webkit-text-stroke:1px var(--accent);-webkit-text-fill-color:transparent}
.marquee:hover .marquee-track{animation-play-state:paused}
@keyframes marquee-x{to{transform:translateX(-50%)}}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
@keyframes sheen-x{0%{transform:translateX(-120%) skewX(-18deg)}100%{transform:translateX(240%) skewX(-18deg)}}
.float-slow{animation:floaty 7s ease-in-out infinite}
.float-slower{animation:floaty 11s ease-in-out infinite}
.sheen{position:relative;overflow:hidden}
.sheen::after{content:'';position:absolute;top:0;bottom:0;width:34%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent);animation:sheen-x 6s ease-in-out infinite;pointer-events:none}
.ph{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r);filter:saturate(.94) contrast(1.03);transition:transform .5s var(--ease-out),filter .5s var(--ease-out),box-shadow .5s var(--ease-out);box-shadow:var(--shadow-rest);background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 22%,var(--surface)),color-mix(in srgb,var(--accent2) 14%,var(--surface)))}
.ph:hover{transform:scale(1.02) translateY(-3px);filter:saturate(1.05) contrast(1.05);box-shadow:var(--shadow-lift)}
.lift{transition:transform .3s var(--ease-out),box-shadow .3s var(--ease-out)}
.lift:hover{transform:translateY(-4px);box-shadow:var(--shadow-lift)}
/* v13 CRAFT primitives — sections compose with these like a design system */
.glass{background:color-mix(in srgb,var(--surface) 74%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--border)}
.text-gradient{background:linear-gradient(100deg,var(--ink) 25%,var(--accent) 65%,var(--accent2) 95%);-webkit-background-clip:text;background-clip:text;color:transparent}
.glow{position:relative}
.glow::before{content:"";position:absolute;inset:-22%;background:radial-gradient(50% 50% at 50% 50%,color-mix(in srgb,var(--accent) 24%,transparent),transparent 72%);filter:blur(42px);z-index:0;pointer-events:none}
.glow>*{position:relative;z-index:1}
.bento{display:grid;gap:var(--sp3);grid-template-columns:repeat(12,1fr)}
.bento>*{grid-column:span 4}
.bento>.span-6{grid-column:span 6}.bento>.span-8{grid-column:span 8}.bento>.span-12{grid-column:span 12}
@media(max-width:760px){.bento>*{grid-column:1/-1}}
.duo{position:relative;isolation:isolate}
.duo::after{content:"";position:absolute;inset:0;border-radius:inherit;background:color-mix(in srgb,var(--accent) 22%,transparent);mix-blend-mode:multiply;pointer-events:none}
.arch{border-radius:calc(var(--r) * 8) calc(var(--r) * 8) var(--r) var(--r);overflow:hidden}
.hairline{border-top:1px solid var(--border)}
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum"}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted) 34%,transparent);border-radius:99px;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--accent) 55%,transparent)}
/* v12 WIRING component layer — tabs, accordions, dialogs, forms, snap rows */
.tabs{display:flex;gap:var(--sp2);flex-wrap:wrap;border-bottom:1px solid var(--border)}
.tabs [data-tab]{appearance:none;background:none;border:0;border-bottom:2px solid transparent;padding:10px 14px;font:inherit;font-weight:600;color:var(--muted);cursor:pointer;transition:color .15s ease,border-color .15s ease}
.tabs [data-tab][aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
details.acc{border:1px solid var(--border);border-radius:var(--r);margin-bottom:10px;background:var(--surface);overflow:hidden}
details.acc summary{cursor:pointer;padding:15px 18px;font-weight:600;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px}
details.acc summary::-webkit-details-marker{display:none}
details.acc summary::after{content:"+";font-weight:700;color:var(--accent);transition:transform .2s var(--ease-out)}
details.acc[open] summary::after{transform:rotate(45deg)}
details.acc .acc-body{padding:0 18px 15px;color:var(--muted)}
dialog{border:1px solid var(--border);border-radius:calc(var(--r) * 1.2);background:var(--surface);color:var(--ink);max-width:min(92vw,720px);padding:0}
dialog::backdrop{background:color-mix(in srgb,var(--bg) 62%,transparent);backdrop-filter:blur(6px)}
dialog .dlg-close{position:absolute;top:10px;right:10px;appearance:none;background:var(--surface-high,transparent);border:1px solid var(--border);color:var(--ink);width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px}
.snap-row{display:flex;gap:var(--sp3);overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding:var(--sp3);padding-bottom:8px;scrollbar-width:none}
.snap-row::-webkit-scrollbar{display:none}
.snap-row>*{scroll-snap-align:start;flex:0 0 min(84vw,340px)}
form[data-validate] .field-err{color:#e5484d;font-size:12.5px;margin:5px 0 0}
form[data-validate] input,form[data-validate] textarea,form[data-validate] select{width:100%;background:var(--surface);border:1px solid var(--border);border-radius:calc(var(--r) * .55);padding:12px 14px;color:var(--ink);font:inherit;transition:border-color .15s ease}
form[data-validate] input:focus,form[data-validate] textarea:focus{outline:none;border-color:var(--accent)}
form[data-validate] .ok-msg{color:var(--accent);font-weight:600}
.switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-weight:600}
.switch input{appearance:none;width:44px;height:24px;border-radius:999px;background:var(--border);position:relative;transition:background .2s ease;cursor:pointer}
.switch input::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:var(--ink);transition:transform .2s var(--ease-out)}
.switch input:checked{background:var(--accent)}
.switch input:checked::after{transform:translateX(20px)}
/* cookie / policy band (assembler attaches when the brief demands it) */
.policy-band{position:fixed;inset-inline:0;bottom:0;z-index:950;display:none;gap:var(--sp3);align-items:center;justify-content:space-between;padding:12px var(--sp4);background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-top:1px solid var(--border);font-size:13px;color:var(--muted)}
.policy-band.show{display:flex;flex-wrap:wrap}
.policy-band .btn{padding:9px 16px;font-size:13px}
.foot-legal{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted);margin-top:10px}
.foot-legal a{text-decoration:underline;text-underline-offset:3px}
/* nav + footer chrome */
.site-nav{position:sticky;top:0;z-index:900;backdrop-filter:blur(14px);background:color-mix(in srgb,var(--bg) 78%,transparent);border-bottom:1px solid var(--border);transition:box-shadow .3s ease}
.site-nav .wrap{display:flex;align-items:center;gap:var(--sp3);height:62px;transition:height .3s var(--ease-out)}
.site-nav.condensed{box-shadow:0 12px 30px -18px rgba(0,0,0,.55)}
.site-nav.condensed .wrap{height:50px}
.brand-mark{font-family:var(--display);font-weight:800;font-size:17px;letter-spacing:-.01em}
.nav-links{display:flex;gap:var(--sp3);margin-left:auto;font-size:13.5px;font-weight:600;color:var(--muted);overflow-x:auto;scrollbar-width:none}
.nav-links::-webkit-scrollbar{display:none}
.nav-links a{white-space:nowrap;padding:6px 2px;transition:color .15s ease}
.nav-links a:hover{color:var(--ink)}
.nav-cta{margin-left:var(--sp2)}
.site-nav .btn{padding:9px 18px;font-size:13.5px}
@media (max-width:640px){.nav-links{display:none}.site-nav .wrap{height:58px}}
.site-footer{border-top:1px solid var(--border);margin-top:var(--sp6)}
.site-footer .wrap{padding-top:var(--sp5);padding-bottom:var(--sp5);display:flex;flex-wrap:wrap;gap:var(--sp4);align-items:flex-end;justify-content:space-between}
.foot-brand{font-family:var(--display);font-weight:800;font-size:20px}
.foot-meta{color:var(--muted);font-size:13px;line-height:1.8}
.foot-note{color:var(--muted);font-size:12.5px}
/* scroll progress */
#rev-progress{position:fixed;top:0;left:0;height:2.5px;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));z-index:1000;transition:width .1s linear}
${texture === '' ? '/* clean texture — flat, no overlay */' : texture}
@media (prefers-reduced-motion:reduce){[data-rev]{opacity:1;transform:none;filter:none;transition:none}.marquee-track,.float-slow,.float-slower,.sheen::after{animation:none !important}*{animation-duration:.001s !important;animation-iteration-count:1 !important;transition-duration:.001s !important}html{scroll-behavior:auto}}`,
  };
}

function navHtml(brand, plan, content) {
  const links = (plan.nav || [])
    .map((id) => plan.sections.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => `<a href="#sec-${esc(s.id)}">${esc(s.name)}</a>`)
    .join('');
  const cta = content.primary_cta?.href
    ? `<a class="btn btn-accent nav-cta" href="${safeHref(content.primary_cta.href)}">${esc(content.primary_cta.label || 'Get started')}</a>`
    : '';
  return `<nav class="site-nav"><div class="wrap"><a class="brand-mark" href="#sec-hero">${esc(brand.name)}</a><div class="nav-links">${links}</div>${cta}</div></nav>`;
}

function footerHtml(brand, content, policy = null) {
  const c = content.contact || {};
  const lines = [
    c.phone ? `Phone ${esc(c.phone)}` : '',
    c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '',
    c.address ? esc(c.address) : '',
    c.hours ? esc(c.hours) : '',
  ].filter(Boolean);
  // v12 IDENTITY: the page is 100% the client's — no tool credit ever.
  // v12 POLICY: legal row renders when the brief implies data/commerce.
  const legal = policy?.legalLinks
    ? `<div class="foot-legal"><a href="#sec-hero" data-legal="privacy">Privacy</a><a href="#sec-hero" data-legal="terms">Terms</a>${policy.disclaimer ? '<span data-legal-note></span>' : ''}</div>`
    : '';
  const note = policy?.disclaimer
    ? `${policy.health ? 'Informational only — consult a professional. ' : ''}${policy.finance ? 'Investments carry risk. ' : ''}`
    : '';
  return `<footer class="site-footer"><div class="wrap">
<div><div class="foot-brand">${esc(brand.name)}</div><div class="foot-meta">${lines.join('<br>') || esc(content.footer_note || '')}</div>${legal}</div>
<div class="foot-note">© ${new Date().getFullYear()} ${esc(brand.name)}${note ? ` · ${note.trim()}` : ''}</div>
</div></footer>`;
}

/* v14 note: the resilience layer (image heal + overlap guard) is injected
   in assembleSite right after the wiring script. */

/**
 * v12 WIRING LAYER — the global behavior layer. Sections declare
 * STRUCTURE (data-tab, details.acc, data-dialog, form[data-validate],
 * data-price-toggle, data-copy); this script attaches the behavior.
 * Passive listeners, IIFE-guarded, zero dependencies.
 */
export function wiringJs() {
  return `(function(){
function qsa(s,c){return [].slice.call((c||document).querySelectorAll(s))}
/* tabs */
qsa('.tabs').forEach(function(tabs){
  var btns=qsa('[data-tab]',tabs),scope=tabs.closest('[id]')||document;
  function act(id){btns.forEach(function(b){var on=b.getAttribute('data-tab')===id;b.setAttribute('aria-selected',on?'true':'false');var p=document.querySelector('[data-panel="'+id+'"]');if(p)p.hidden=!on})}
  btns.forEach(function(b){b.addEventListener('click',function(){act(b.getAttribute('data-tab'))})});
  if(btns.length)act(btns[0].getAttribute('data-tab'));
});
/* single-open accordions */
qsa('[data-single]').forEach(function(w){qsa('details.acc',w).forEach(function(d){d.addEventListener('toggle',function(){if(d.open)qsa('details.acc',w).forEach(function(o){if(o!==d)o.open=false})})})});
/* dialogs */
qsa('[data-dialog]').forEach(function(btn){var dlg=document.getElementById(btn.getAttribute('data-dialog'));if(!dlg)return;btn.addEventListener('click',function(){try{dlg.showModal()}catch(e){}})});
qsa('dialog').forEach(function(d){d.addEventListener('click',function(e){if(e.target===d)d.close()});var x=d.querySelector('.dlg-close');if(x)x.addEventListener('click',function(){d.close()})});
/* lightbox for .ph images */
var lb=document.createElement('dialog');lb.style.padding='0';lb.innerHTML='<img alt="" style="display:block;max-width:92vw;max-height:88vh">';document.body.appendChild(lb);
qsa('img.ph').forEach(function(img){img.addEventListener('click',function(){lb.querySelector('img').src=img.src;try{lb.showModal()}catch(e){}})});
lb.addEventListener('click',function(){lb.close()});
/* copy buttons */
qsa('[data-copy]').forEach(function(btn){btn.addEventListener('click',function(){var v=btn.getAttribute('data-copy')||'';var el=v&&v.charAt(0)==='#'?document.querySelector(v):null;var text=el?(el.textContent||'').trim():v;try{navigator.clipboard.writeText(text);var old=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=old},1400)}catch(e){}})});
/* pricing toggle */
qsa('[data-price-toggle]').forEach(function(t){t.addEventListener('change',function(){var yr=t.checked;document.querySelectorAll('[data-monthly]').forEach(function(el){el.textContent=yr?(el.getAttribute('data-yearly')||''):(el.getAttribute('data-monthly')||'')})})});
/* form validation + success (offline; logs nothing, sends nothing) */
qsa('form[data-validate]').forEach(function(f){
  f.setAttribute('novalidate','');
  f.addEventListener('submit',function(e){
    e.preventDefault();var bad=null;
    qsa('input,textarea,select',f).forEach(function(el){
      var err=el.parentElement.querySelector('.field-err');if(err)err.remove();
      var msg='';
      if(el.hasAttribute('required')&&!el.value.trim())msg='Please fill this in.';
      else if(el.type==='email'&&el.value&&!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(el.value))msg='That email does not look right.';
      else if(el.type==='tel'&&el.value&&!/^[+0-9()\\-\\s]{7,}$/.test(el.value))msg='That phone number does not look right.';
      if(msg){bad=bad||el;var p=document.createElement('p');p.className='field-err';p.setAttribute('role','alert');p.textContent=msg;el.parentElement.appendChild(p)}
    });
    if(bad){bad.focus();return}
    var okMsg=f.getAttribute('data-success')||'Thank you — we will be in touch soon.';
    f.innerHTML='<p class="ok-msg">'+okMsg+'</p>';
  });
});
})();`;
}

/**
 * v12 LEGAL — the inline privacy/terms pages the footer links point to.
 * Deterministic, brand-factual, dialog-rendered (no extra pages).
 */
export function legalJs(brand, policy) {
  const y = new Date().getFullYear();
  const privacy = `${brand.name} respects your privacy. Details you share through this page (such as your name, contact details or booking preferences) are used only to respond to your request and to provide the services you asked for. ${brand.name} does not sell your personal information, does not send unrelated marketing without your consent, and removes your details on request. Questions about your data: reach us through the contact details on this page. Last updated ${y}.`;
  const terms = `By using this page you agree to use the information and services of ${brand.name} responsibly. Prices, availability and offer terms shown are honest at the time of publishing and may change; confirmed orders or bookings are governed by the confirmation you receive from ${brand.name}. Content, photographs and branding on this page belong to ${brand.name}. Questions: use the contact details on this page. Last updated ${y}.`;
  return `(function(){
var P=${JSON.stringify(privacy)};var T=${JSON.stringify(terms)};
function show(title,body){
  var d=document.createElement('dialog');d.style.padding='0';
  var w=document.createElement('div');w.style.cssText='padding:26px;max-width:640px;max-height:80vh;overflow:auto';
  var h=document.createElement('h2');h.textContent=title;h.style.marginBottom='10px';
  var p=document.createElement('p');p.textContent=body;p.style.whiteSpace='pre-line';
  var b=document.createElement('button');b.textContent='Close';b.className='btn btn-accent';b.style.marginTop='16px';
  b.addEventListener('click',function(){d.close()});d.addEventListener('click',function(e){if(e.target===d)d.close()});
  w.appendChild(h);w.appendChild(p);w.appendChild(b);d.appendChild(w);document.body.appendChild(d);
  try{d.showModal()}catch(e){}d.addEventListener('close',function(){d.remove()});
}
qsa2('[data-legal="privacy"]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();show('Privacy Policy',P)})});
qsa2('[data-legal="terms"]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();show('Terms of Service',T)})});
function qsa2(s){return [].slice.call(document.querySelectorAll(s))}
})();`;
}

/**
 * v12 SEO — JSON-LD structured data from the page's own facts.
 * Deterministic; only true statements (name, description, contact).
 */
export function jsonLd({ brand, content, kind, policy }) {
  const c = content.contact || {};
  const base = {
    '@context': 'https://schema.org',
    '@type': kind === 'event' ? 'Event' : (policy?.commerce ? 'Store' : 'LocalBusiness'),
    name: brand.name,
    description: String(content.sub || content.headline || '').slice(0, 220),
  };
  if (c.phone) base.telephone = c.phone;
  if (c.address) base.address = { '@type': 'PostalAddress', streetAddress: c.address };
  if (c.email) base.email = c.email;
  const ev = content.event;
  if (kind === 'event' && ev) {
    if (ev.date_label) base.startDate = ev.ends || ev.date_label;
    if (ev.venue) base.location = { '@type': 'Place', name: ev.venue };
  }
  if (content.primary_cta?.href && /^https?:\/\//.test(content.primary_cta.href)) base.url = content.primary_cta.href;
  return JSON.stringify(base).replace(/</g, '\\u003c');
}

/** Canonical + OG URL injection post-assembly (builder knows the URL). */
export function injectCanonical(html, url) {
  if (!url || !/https?:\/\//.test(String(url))) return html;
  const tag = `<link rel="canonical" href="${esc(String(url))}">`;
  const og = `<meta property="og:url" content="${esc(String(url))}">`;
  if (html.includes('rel="canonical"')) return html;
  return html.replace('</title>', `</title>\n${tag}\n${og}`);
}

export function revealJs() {
  return `(function(){
var m=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var els=[].slice.call(document.querySelectorAll('[data-rev]'));
if(m||!('IntersectionObserver' in window)){els.forEach(function(e){e.setAttribute('data-rev','');e.classList.add('rev-in')});return}
var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('rev-in');io.unobserve(en.target)}})},{threshold:.14,rootMargin:'0px 0px -6% 0px'});
els.forEach(function(e){io.observe(e)});
var bar=document.getElementById('rev-progress');
var nav=document.querySelector('.site-nav');
addEventListener('scroll',function(){var h=document.documentElement;var p=h.scrollTop/(h.scrollHeight-h.clientHeight||1);if(bar)bar.style.width=(p*100).toFixed(2)+'%';if(nav)nav.classList.toggle('condensed',h.scrollTop>120)},{passive:true});
var cio=new IntersectionObserver(function(es){es.forEach(function(en){
if(!en.isIntersecting)return;cio.unobserve(en.target);
var el=en.target,target=parseFloat(el.getAttribute('data-count')||'0');
if(m){el.textContent=target;return}
var dec=(String(target).split('.')[1]||'').length,t0=null,dur=1300;
function tick(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/dur),e=1-Math.pow(1-p,3);
el.textContent=(target*e).toFixed(dec);if(p<1)requestAnimationFrame(tick)}
requestAnimationFrame(tick);
})},{threshold:.5});
[].slice.call(document.querySelectorAll('[data-count]')).forEach(function(e){cio.observe(e)});
})();`;
}

function faviconSvg(brand, design) {
  const v = designVars(design);
  const initial = esc(String(brand.name || 'N').trim().charAt(0).toUpperCase() || 'N');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${v.accent}"/><text x="32" y="43" font-family="Arial,sans-serif" font-size="34" font-weight="800" text-anchor="middle" fill="${v.onAccent}">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * v14 RESILIENCE LAYER — the two runtime guards that make layout bugs
 * non-events on the served page:
 *   1. IMAGE HEAL — any <img> that fails to load (dead CDN, airplane
 *      mode, stripped host) is swapped to a brand-coloured art tile built
 *      at assembly. A visitor can never see a broken-image glyph again.
 *   2. TEXT OVERLAP GUARD — after load (and on reflow), text-bearing
 *      elements that physically collide (the overlapping-hero class of
 *      bugs) are detected and the offender is reset into the flow.
 *      Intentional overlays are respected: pairs involving media, or
 *      ancestor/descendant pairs, are never touched.
 */
export function resilienceJs(artDataUri) {
  return `(function(){
var ART=${JSON.stringify(artDataUri)};
document.addEventListener('error',function(e){
  var t=e.target;
  if(!t||!t.tagName||t.tagName!=='IMG'||t.getAttribute('data-nb-heal'))return;
  t.setAttribute('data-nb-heal','1');t.src=ART;
},true);
function run(){
  var secs=[].slice.call(document.querySelectorAll('main [id]'));
  var els=[];
  secs.forEach(function(sec){
    if(sec.closest('dialog'))return;
    [].slice.call(sec.querySelectorAll('*')).forEach(function(el){
      if(els.length>420)return;
      if(el.closest('.marquee-track'))return;
      var hasText=false,nodes=el.childNodes;
      for(var i=0;i<nodes.length;i++){if(nodes[i].nodeType===3&&nodes[i].textContent.trim()){hasText=true;break}}
      if(!hasText)return;
      if(el.querySelector('img,video,canvas,svg,picture,iframe'))return;
      var r=el.getBoundingClientRect();
      if(r.width<24||r.height<14)return;
      els.push({el:el,x1:r.left,y1:r.top,x2:r.right,y2:r.bottom,area:r.width*r.height});
    });
  });
  function anchored(a){var p=getComputedStyle(a.el).position;return p==='absolute'||p==='fixed'}
  function ancestorOf(a,b){return a.el.contains(b.el)||b.el.contains(a.el)}
  for(var i=0;i<els.length;i++)for(var j=i+1;j<els.length;j++){
    var a=els[i],b=els[j];
    if(ancestorOf(a,b))continue;
    var ox=Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1);if(ox<=0)continue;
    var oy=Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1);if(oy<=0)continue;
    var inter=ox*oy,small=Math.min(a.area,b.area);
    if(inter/small<0.42)continue;
    var off=anchored(a)!==anchored(b)?(anchored(a)?a:b):(a.area<=b.area?a:b);
    if(off.el.getAttribute('data-nb-fix'))continue;
    off.el.setAttribute('data-nb-fix','');
    var cs=getComputedStyle(off.el);
    if(cs.position==='absolute'||cs.position==='fixed'){off.el.style.position='static';off.el.style.inset='auto'}
    off.el.style.transform='none';off.el.style.marginTop='14px';
  }
}
if(!document.documentElement.hasAttribute('data-nb-guard')){
  document.documentElement.setAttribute('data-nb-guard','1');
  var t=null;
  addEventListener('load',run);addEventListener('resize',function(){clearTimeout(t);t=setTimeout(run,350)},{passive:true});
  if('IntersectionObserver' in window)setTimeout(run,900);
}
})();`;
}

/** Brand art tile for the image-heal fallback (built from the palette). */
export function healArtSvg(design) {
  const v = designVars(design);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${v.surface}"/><stop offset="1" stop-color="${mix(v.accent, v.bg, 0.35)}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="640" cy="140" r="220" fill="${v.accent}" opacity="0.18"/><circle cx="140" cy="500" r="180" fill="${v.accent2}" opacity="0.14"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Assemble the final document from coded sections.
 * v12: full SEO head (OG/Twitter/robots), JSON-LD structured data,
 * the wiring behavior layer, inline legal (privacy/terms) and the
 * policy layer — assembled from the brief's policyNeeds.
 */
export function assembleSite({ design, brand, content, coded, plan, kind, brief = '' }) {
  const g = globalCss(design);
  const sectionsHtml = coded.map((s) => s.html).join('\n');
  const sectionsCss = coded.map((s) => `/* ── sec-${s.id} ── */\n${s.css}`).join('\n');
  const description = String(content.sub || content.headline || `${brand.name} — ${kind}`).slice(0, 160);
  const policy = policyNeeds(brief || String(content.headline || ''), kind);
  const ld = jsonLd({ brand, content, kind, policy });
  const legal = policy.legalLinks ? `<script>${legalJs(brand, policy)}</script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(content.title || brand.name)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${designVars(design).bg}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(brand.name)}">
<meta property="og:title" content="${esc(content.title || brand.name)}">
<meta property="og:description" content="${esc(description)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(content.title || brand.name)}">
<meta name="twitter:description" content="${esc(description)}">
<script type="application/ld+json">${ld}</script>
<link rel="icon" href="${faviconSvg(brand, design)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${g.google}&display=swap">
<style>${g.css}</style>
<style>${sectionsCss}</style>
</head>
<body>
<div id="rev-progress"></div>
${navHtml(brand, plan, content)}
<main>
${sectionsHtml}
</main>
${footerHtml(brand, content, policy)}
<script>${revealJs()}</script>
<script>${wiringJs()}</script>
<script>${resilienceJs(healArtSvg(design))}</script>
${legal}
</body>
</html>`;
}

/* ══ Orchestration ═══════════════════════════════════════════════════ */

/**
 * The full codegen pipeline (v11: + Photographer stage). Throws only when
 * the CODE stage cannot produce a viable page — the caller then falls
 * back to the template engine (site_templates.js) so a build never fails.
 *
 * @param preplanned optional stored section plan (refine path) — skips
 *        the PLAN call and keeps the page architecture stable.
 * @param onStage optional (stage, ok, ai, detail) => void trace callback
 */
export async function codegenSite(env, { kind, brief, brand, site = null, thought, content, skillsBlock = '', lead = null, understanding = null, preplanned = null, onStage = () => {}, team = null }) {
  const trace = (stage, ok, ai, detail) => {
    onStage({ stage, ok, ai, detail });
    if (team) team.stage(stage, ok, ai, detail);
  };
  const identity = site || brand; // what nav/footer/favicon render

  // 1. PLAN — information architecture (or reuse the stored plan).
  const plan = preplanned || (await planSections(env, { kind, brief, brand: identity, site, thought, content, skillsBlock, lead, understanding, team }));
  trace('plan', true, plan.ai, `${plan.sections.length} sections planned${plan.ai ? '' : ' · classic plan'}`);
  if (team) {
    team.record('architect', 'section plan locked', {
      ok: true, ai: false,
      detail: plan.sections.map((s) => s.name).join(' · ').slice(0, 120),
      artifact: { type: 'plan', label: `${plan.sections.length}-section architecture`, detail: plan.sections.map((s) => `${s.id}: ${s.name}`).join(' · ') },
    });
  }

  // 1b. PHOTOGRAPHY (v11) — the Photographer sources and verifies real
  //     imagery for the sections that need it. Deterministic queries from
  //     the brief + the Lead's image_ideas; one AI assignment call when
  //     candidates exist; degrades to CSS art when the web is down.
  let photography = { images: [], vibe: '', ai: false };
  if (kind !== 'webapp') {
    try {
      const { deriveImageQueries, findSiteImages } = await import('./imager.js');
      const queries = deriveImageQueries({ brief, kind, lead });
      if (queries.length) {
        if (team) team.record('photographer', 'scouting real photography', { ok: true, ai: false, detail: `searching: ${queries.slice(0, 2).join(' · ').slice(0, 90)}` });
        photography = await findSiteImages(env, { queries, sections: plan.sections, team, brief });
      }
    } catch { /* photography is a bonus */ }
  }
  const imageCount = photography.images.length;
  if (imageCount || photography.ai) {
    if (team) {
      team.record('photographer', 'casting the photography', {
        ok: true, ai: photography.ai,
        detail: imageCount ? `${imageCount} verified image(s) placed${photography.vibe ? ` · ${photography.vibe.slice(0, 60)}` : ''}` : 'nothing fit — clean typography wins',
        artifact: imageCount ? { type: 'photos', label: `${imageCount} photograph${imageCount === 1 ? '' : 's'} cast`, detail: photography.images.map((im) => im.alt || im.section).filter(Boolean).slice(0, 4).join(' · ') } : null,
      });
    }
  } else if (team) {
    team.record('photographer', 'scouting real photography', { ok: true, ai: false, detail: 'no verified imagery — pure CSS art direction' });
  }
  trace('images', true, photography.ai, imageCount ? `${imageCount} verified image(s) cast` : 'CSS art only');

  // Verified image URLs — the ONLY remote srcs the sanitizer will keep.
  const verifiedImages = new Set(photography.images.map((im) => im.url));
  const imagesBySection = photography.images;

  // v12 MASTERY — the engineers read from the same textbook: global CSS
  // law, the wiring contract, the build's motion grammar and the brief's
  // policy duties — packed into one bounded block for every section call.
  const sectionMastery = masteryBlock([
    cssGlobalPack(),
    wiringPack(),
    motionPack(thought.design?.motion_intensity),
    policyPack(policyNeeds(brief, kind)),
  ], { maxChars: 2600 });

  // 2. CODE — hand-write every section, IN PARALLEL (sections are
  //    independent: each gets the full design contract + its own copy).
  //    The hero MUST be AI-coded (it is the page's identity); any other
  //    section that fails twice degrades to a clean engine block rather
  //    than discarding the bespoke page. One simpler-redo per failed
  //    section; wall time ≈ one section, not the sum of all sections.
  const ctxBase = { kind, brief, brand: identity, thought, content, design: thought.design, team, images: imagesBySection, allowedImages: verifiedImages, mastery: sectionMastery };
  const results = await Promise.all(
    plan.sections.map(async (section) => {
      const ctx = { ...ctxBase, section };
      let out = await codeSection(env, ctx);
      if (!out) {
        // One director-forced redo with a tighter brief before degrading.
        ctx.section = { ...section, layout: `${section.layout} Keep it SIMPLER: fewer elements, cleaner grid.` };
        out = await codeSection(env, ctx);
      }
      if (!out) {
        if (section.id === 'hero') throw new Error('codegen failed at the hero — falling back to the engine');
        return { section, out: null };
      }
      return { section, out };
    })
  );
  const coded = [];
  let engineSections = 0;
  for (const { section, out } of results) {
    if (!out) {
      coded.push({ id: section.id, ...engineFallbackSection(section, content, thought.design) });
      trace(`code:${section.id}`, true, false, `${section.name} — engine section (AI output unusable)`);
      engineSections++;
    } else {
      coded.push({ id: section.id, ...out });
      trace(`code:${section.id}`, true, true, `${section.name} coded (${out.html.length + out.css.length} chars)`);
      // v13 TRANSPARENCY: the row carries the actual code — the app
      // expands it in a shell view while the build is still running.
      if (team) {
        team.record('engineer', `shipped "${section.name}"`, {
          ok: true, ai: false,
          detail: `${out.html.length + out.css.length} chars hand-written`,
          code: codePayload(section, out),
        });
      }
    }
  }

  // 2b. IMAGE REWORK (v11) — a section that was cast a photo but shipped
  //     without <img> gets ONE engineer re-code with the omission named.
  //     Bounded (≤3 re-codes): a missing photo degrades to CSS art, it
  //     never blocks the build.
  let imageRetries = 0;
  for (const c of coded) {
    if (imageRetries >= 3) break;
    const assigned = imagesBySection.find((im) => im.section === c.id);
    if (!assigned || /<img[\s>]/i.test(c.html)) continue;
    const section = plan.sections.find((s) => s.id === c.id);
    if (!section) continue;
    const ctx = {
      ...ctxBase,
      section,
      critique: `the assigned photo is missing — embed <img src="${assigned.url}" alt="${assigned.alt}" class="ph" loading="lazy"> as a central part of the composition`,
    };
    const redo = await codeSection(env, ctx);
    if (redo && /<img[\s>]/i.test(redo.html)) {
      imageRetries++;
      coded[coded.indexOf(c)] = { id: c.id, ...redo };
      trace(`code:${c.id}`, true, true, `${section.name} re-coded to wire the assigned photo`);
    }
  }
  if (imageCount && imageRetries) {
    if (team) team.record('photographer', 'wiring the photography', { ok: true, ai: false, detail: `${imageRetries} section(s) re-coded to embed the cast photo(s)` });
  }

  // 3. REVIEW — director pass; flagged sections get one real regen
  //    (at most MAX_REGENS re-codes, sequential to keep the budget honest).
  let regensLeft = MAX_REGENS;
  let reviewed = 0;
  let qaVerdicts = {};
  if (coded.length >= 2) {
    const review = await reviewSections(env, { kind, brand: identity, sections: coded.map((c) => ({ ...c, image: c.html.match(/src="([^"]+)"/i)?.[1] || '', ...plan.sections.find((s) => s.id === c.id) })), team });
    qaVerdicts = review.verdicts || {};
    trace('review', true, review.ai, review.ai ? 'director reviewed the code' : 'review skipped');
    for (const c of coded) {
      if (review.verdicts[c.id] !== 'fix' || regensLeft <= 0) continue;
      regensLeft--;
      const section = plan.sections.find((s) => s.id === c.id);
      // REWORK LOOP — the QA verdict goes back to the engineer WITH the
      // critique attached (ctx.critique), the GLM-class review→fix cycle.
      const ctx = { ...ctxBase, section, critique: review.notes[c.id] || 'director flagged this section' };
      const redo = await codeSection(env, ctx);
      if (redo) {
        reviewed++;
        coded[coded.indexOf(c)] = { id: c.id, ...redo };
        trace(`code:${c.id}`, true, true, `${section.name} re-coded after QA rework`);
      }
    }
  } else {
    trace('review', true, false, 'single section — review skipped');
  }

  // 4. WIRE — deterministic assembly (cannot produce a malformed page).
  const html = assembleSite({ design: thought.design, brand: identity, content, coded, plan, kind, brief });
  trace('wire', true, false, `${coded.length} sections wired · fonts + motion + identity`);
  if (team) {
    team.record('builder', 'wiring & hosting the page', {
      ok: true, ai: false,
      detail: `${coded.length} sections assembled with fonts + motion`,
      artifact: { type: 'site', label: `${(html.length / 1024).toFixed(1)} KB page assembled`, detail: `${coded.length} sections · ${thought.design.fontPair ? `${thought.design.fontPair.display} × ${thought.design.fontPair.body}` : 'font pairing'} · ${photography.images.length} photo(s)` },
    });
  }

  return { html, plan, coded, images: photography.images, stages: { reviewed, verdicts: qaVerdicts } };
}
