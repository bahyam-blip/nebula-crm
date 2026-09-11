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

const SECTION_AI_TOKENS = 1900;
const PLAN_AI_TOKENS = 900;
const REVIEW_AI_TOKENS = 500;
const MAX_SECTIONS = 5;
const MAX_REGENS = 2;
const HTML_MIN = 150;
const HTML_MAX = 9500;
const CSS_MIN = 60;
const CSS_MAX = 9500;

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
    // Guarantee the copy survives: append keys no section claimed onto the
    // closest section (never drop the model's written words).
    const claimed = new Set(sections.flatMap((x) => x.content_keys));
    const orphanKeys = Object.keys(content).filter((k) => !claimed.has(k) && !['title', 'footer_note'].includes(k));
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

function sectionSystemPrompt({ id, kind, brand, hasImages }) {
  return `You are a senior front-end engineer at an award-winning web studio. You are HAND-CODING one section of a bespoke ${kind} page for ${brand.name}. There is no template — every line is written for this business.

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
- Keep the whole answer under 100 lines. Every element earns its place; density and craft beat bloat.`;
}

function sectionUserPrompt({ design, section, content, brand, kind, brief, images = null }) {
  const v = designVars(design);
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
    `PAGE VARIABLES: --bg:${v.bg} --surface:${v.surface} --ink:${v.ink} --muted:${v.muted} --accent:${v.accent} (text on accent: ${v.onAccent}) --accent2:${v.accent2} --accent-soft (translucent accent tint) --border:${v.border} --r:${design.radius}px --font:${DISPLAY_OF_FONT[design.font] || "'Inter', sans-serif"} / body ${FONT_STACKS[design.font]?.css || FONT_STACKS.modern.css}`,
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
  return { html, css };
}

async function codeSectionOnce(env, ctx, attempt, lastError) {
  const critique = String(ctx.critique || '').slice(0, 200);
  const allowed = ctx.allowedImages || null;
  const messages = [
    { role: 'system', content: sectionSystemPrompt({ id: ctx.section.id, kind: ctx.kind, brand: ctx.brand, hasImages: Boolean(ctx.images?.some((im) => im.section === ctx.section.id)) }) },
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
  const css = `#sec-${section.id}{padding:var(--sp6) 0}#sec-${section.id} h2{font-family:var(--display);font-size:clamp(28px,4.5vw,48px);margin:var(--sp2) 0 var(--sp4)}#sec-${section.id} .s-list{list-style:none;display:grid;gap:var(--sp3)}@media(min-width:768px){#sec-${section.id} .s-list{grid-template-columns:1fr 1fr}}#sec-${section.id} .s-list li{border:1px solid var(--border);border-radius:var(--r);padding:var(--sp3);display:grid;gap:6px;background:var(--card)}#sec-${section.id} .s-list strong{font-size:16px}#sec-${section.id} .s-list span{color:var(--muted);font-size:14px}#sec-${section.id} .s-sub{color:var(--muted)}#sec-${section.id} .btn{margin-top:var(--sp4)}@keyframes ${section.id}-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}/* engine section */`;
  return { html, css };
}

/* ══ Stage 6 — REVIEW ════════════════════════════════════════════════ */

export async function reviewSections(env, { kind, brand, sections, team = null }) {
  try {
    const digest = sections
      .map((s) => `#${s.id} (${s.name}) — goal: ${s.goal}\nCSS head: ${s.css.slice(0, 180)}${s.image ? `\nImage used: ${s.image}` : ''}`)
      .join('\n\n')
      .slice(0, 2600);
    const j = await runAgent(
      env,
      team,
      'qa',
      'reviewing the hand-written code',
      [
        {
          role: 'system',
          content: `You are the design director reviewing hand-coded sections of a ${kind} page for ${brand.name} before it ships. A section is "fix" ONLY if it is broken for a live page: unstyled, contradicts the design direction, empty shell, unusable on mobile, shows a foreign brand name, or references an image not in its verified list. Stylistic taste is NOT a fix reason. Respond with ONLY JSON: {"verdicts":[{"id":"...","verdict":"good"|"fix","note":"<=10 words"}]}`,
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
  const google = FONT_STACKS[design.font]?.google || FONT_STACKS.modern.google;
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
:root{--bg:${v.bg};--surface:${v.surface};--card:${v.card};--ink:${v.ink};--muted:${v.muted};--accent:${v.accent};--accent2:${v.accent2};--on-accent:${v.onAccent};--accent-soft:color-mix(in srgb,var(--accent) 16%,transparent);--border:${v.border};--r:${r}px;--maxw:1120px;--font:${body};--display:${display};--sp1:6px;--sp2:12px;--sp3:20px;--sp4:32px;--sp5:52px;--sp6:84px;--dur-1:.25s;--dur-2:${revDur};--ease-out:cubic-bezier(.2,.7,.2,1);--shadow-rest:0 10px 30px -18px color-mix(in srgb,var(--accent) 55%,transparent);--shadow-lift:0 18px 44px -18px color-mix(in srgb,var(--accent) 70%,transparent);${steps}
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--font);background:var(--bg);color:var(--ink);line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img,svg{max-width:100%}
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
.ph{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r);filter:saturate(.94) contrast(1.03);transition:transform .5s var(--ease-out),filter .5s var(--ease-out),box-shadow .5s var(--ease-out);box-shadow:var(--shadow-rest)}
.ph:hover{transform:scale(1.02) translateY(-3px);filter:saturate(1.05) contrast(1.05);box-shadow:var(--shadow-lift)}
.lift{transition:transform .3s var(--ease-out),box-shadow .3s var(--ease-out)}
.lift:hover{transform:translateY(-4px);box-shadow:var(--shadow-lift)}
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

function footerHtml(brand, content) {
  const c = content.contact || {};
  const lines = [
    c.phone ? `Phone ${esc(c.phone)}` : '',
    c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '',
    c.address ? esc(c.address) : '',
    c.hours ? esc(c.hours) : '',
  ].filter(Boolean);
  return `<footer class="site-footer"><div class="wrap">
<div><div class="foot-brand">${esc(brand.name)}</div><div class="foot-meta">${lines.join('<br>') || esc(content.footer_note || '')}</div></div>
<div class="foot-note">© ${new Date().getFullYear()} ${esc(brand.name)} · crafted by the Nebula agent</div>
</div></footer>`;
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

/** Assemble the final document from coded sections. */
export function assembleSite({ design, brand, content, coded, plan, kind }) {
  const g = globalCss(design);
  const sectionsHtml = coded.map((s) => s.html).join('\n');
  const sectionsCss = coded.map((s) => `/* ── sec-${s.id} ── */\n${s.css}`).join('\n');
  const description = String(content.sub || content.headline || `${brand.name} — ${kind}`).slice(0, 160);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(content.title || brand.name)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="${designVars(design).bg}">
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
${footerHtml(brand, content)}
<script>${revealJs()}</script>
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
    if (team) team.record('photographer', 'casting the photography', { ok: true, ai: photography.ai, detail: imageCount ? `${imageCount} verified image(s) placed${photography.vibe ? ` · ${photography.vibe.slice(0, 60)}` : ''}` : 'nothing fit — clean typography wins' });
  } else if (team) {
    team.record('photographer', 'scouting real photography', { ok: true, ai: false, detail: 'no verified imagery — pure CSS art direction' });
  }
  trace('images', true, photography.ai, imageCount ? `${imageCount} verified image(s) cast` : 'CSS art only');

  // Verified image URLs — the ONLY remote srcs the sanitizer will keep.
  const verifiedImages = new Set(photography.images.map((im) => im.url));
  const imagesBySection = photography.images;

  // 2. CODE — hand-write every section, IN PARALLEL (sections are
  //    independent: each gets the full design contract + its own copy).
  //    The hero MUST be AI-coded (it is the page's identity); any other
  //    section that fails twice degrades to a clean engine block rather
  //    than discarding the bespoke page. One simpler-redo per failed
  //    section; wall time ≈ one section, not the sum of all sections.
  const ctxBase = { kind, brief, brand: identity, thought, content, design: thought.design, team, images: imagesBySection, allowedImages: verifiedImages };
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
    }
  }

  // 2b. IMAGE REWORK (v11) — a section that was cast a photo but shipped
  //     without <img> gets ONE engineer re-code with the omission named.
  //     Bounded (≤2 re-codes): a missing photo degrades to CSS art, it
  //     never blocks the build.
  let imageRetries = 0;
  for (const c of coded) {
    if (imageRetries >= 2) break;
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
  const html = assembleSite({ design: thought.design, brand: identity, content, coded, plan, kind });
  trace('wire', true, false, `${coded.length} sections wired · fonts + motion + identity`);
  if (team) team.record('builder', 'wiring & hosting the page', { ok: true, ai: false, detail: `${coded.length} sections assembled with fonts + motion` });

  return { html, plan, coded, images: photography.images, stages: { reviewed, verdicts: qaVerdicts } };
}
