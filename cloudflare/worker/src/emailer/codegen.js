/**
 * CODEGEN — the bespoke code-writing engine (Agent v7).
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

import { sarvamChat } from './sarvam.js';
import { hex, lum, mix, FONT_STACKS, DISPLAY_OF_FONT } from './site_templates.js';
import { esc, safeHref } from './htmlutil.js';

const SECTION_AI_TOKENS = 1900;
const PLAN_AI_TOKENS = 900;
const REVIEW_AI_TOKENS = 500;
const MAX_SECTIONS = 6;
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

const PLAN_SYSTEM = `You are the lead architect of a world-class web studio. A client wants a bespoke page. Plan its information architecture. Respond with ONLY JSON:

{"sections":[{"id":"short-id (a-z, 3-10 chars)","name":"Nav label, 1-2 words","goal":"what this section must make the visitor think or do","layout":"1-2 sentences describing the COMPOSITION you will hand-code for this content — asymmetry, columns, alignment, art placement. Decide like a designer, not a menu.","content_keys":["which copy JSON groups this section renders, e.g. headline, sub, primary_cta, features"],"motion":"the entrance/ambient motion idea, 5-12 words"}],"nav":["section ids to show in the navbar, 3-5, ending with a contact-ish section"]}

Rules:
- 4-6 sections total. First MUST be a hero (id "hero"). Last MUST convert (contact/booking/CTA band).
- Sections must serve THIS business — no generic "About us" filler unless the brief demands proof.
- Vary composition across sections: do not plan two identical column grids.
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

export async function planSections(env, { kind, brief, brand, thought, content, skillsBlock = '' }) {
  const vocabNote = `Available copy groups for THIS page: ${Object.keys(content).filter((k) => hasValue(content[k])).join(', ') || 'headline, sub'}`;
  try {
    const j = await sarvamChat(
      env,
      [
        { role: 'system', content: [PLAN_SYSTEM, skillsBlock].filter(Boolean).join('\n\n') },
        {
          role: 'user',
          content: [
            `PAGE KIND: ${kind}`,
            `BUSINESS: ${brand.name}`,
            `BRIEF: ${String(brief).slice(0, 900)}`,
            `DESIGN DIRECTION: theme ${thought.design.themeLabel}, voice "${thought.design.voice || 'clear, confident'}", audience "${thought.design.audience || 'general'}", hero style ${thought.design.hero}`,
            thought.mustHave.length ? `MUST INCLUDE: ${thought.mustHave.join('; ')}` : '',
            vocabNote,
          ].filter(Boolean).join('\n'),
        },
      ],
      { json: true, maxTokens: PLAN_AI_TOKENS, temperature: 0.65 }
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
        layout: String(sec?.layout || '').slice(0, 320),
        content_keys: Array.isArray(sec?.content_keys) ? sec.content_keys.map((k) => String(k).slice(0, 20)).filter((k) => k in content).slice(0, 6) : [],
        motion: String(sec?.motion || '').slice(0, 120),
      });
      if (sections.length >= MAX_SECTIONS) break;
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

function sectionSystemPrompt({ id, kind, brand }) {
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
- Exactly one <section id="sec-${id}"> root element. No <script>, no <html>/<head>/<body>, no <iframe>, no <img> with remote src, no inline on* handlers, no style="" attributes.
- Every CSS selector starts with #sec-${id}. Mobile-first: phone layout first, then ONE @media (min-width:768px) block.
- Use the page variables (given in the brief): colors, --r radius, --font body / --display display font, spacing scale --sp1..--sp6. Content sits inside .wrap (already centered, max-width var(--maxw)) — do NOT redefine .wrap.
- Typography: clamp() font sizes; headings use var(--display).
- MOTION IS REQUIRED: mark animatable children with data-rev (stagger with style-free data-rev-delay="1..4" attributes), add one :hover transition on interactive elements, and define at least one unique @keyframes (name it ${id}-*) — ambient or entrance.
- Accessibility: text contrast >= 4.5:1, :focus-visible outline on links/buttons, buttons are <a class="btn btn-accent"> (page provides .btn styles) or real <button>.
- Keep the whole answer under 100 lines. Every element earns its place; density and craft beat bloat.`;
}

function sectionUserPrompt({ design, section, content, brand, kind, brief }) {
  const v = designVars(design);
  return [
    `BUSINESS: ${brand.name} — ${String(brief).slice(0, 200)}`,
    `VOICE: "${design.voice || 'clear, confident'}" · AUDIENCE: ${design.audience || 'general'} · KIND: ${kind}`,
    `PAGE VARIABLES: --bg:${v.bg} --surface:${v.surface} --ink:${v.ink} --muted:${v.muted} --accent:${v.accent} (text on accent: ${v.onAccent}) --accent2:${v.accent2} --border:${v.border} --r:${design.radius}px --font:${DISPLAY_OF_FONT[design.font] || "'Inter', sans-serif"} / body ${FONT_STACKS[design.font]?.css || FONT_STACKS.modern.css}`,
    `SECTION: "${section.name}" — goal: ${section.goal || 'serve the visitor'}`,
    `COMPOSITION YOU DECIDED (make it real): ${section.layout || 'your best judgment'}`,
    `MOTION INTENT: ${section.motion || 'subtle reveal'}`,
    `COPY (use these words — do not invent facts): ${copyFragment(content, section.content_keys)}`,
    `NOW hand-code section "sec-${section.id}".`,
  ].join('\n');
}

function sanitizeSectionHtml(html, id) {
  let h = String(html || '');
  // Strip scripts/iframes whole, kill inline handlers and remote srcs.
  h = h
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/<iframe[\s\S]*?(<\/iframe\s*>|>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\ssrc\s*=\s*(['"]?)\s*(https?:)?\/\/[^'">\s]*\1/gi, '')
    // srcset/source src with remote URLs: strip the attribute (models try
    // to hotlink stock photos; hallucinated URLs render as broken images).
    .replace(/\ssrcset\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<source[^>]*>/gi, '');
  // Guarantee the section id on the root element.
  if (!new RegExp(`<section[^>]*id=["']?sec-${id}["']?`, 'i').test(h)) {
    h = h.replace(/<section/i, `<section id="sec-${id}"`);
  }
  return h.trim();
}

/** Validate + extract { html, css } from a model answer. Throws on garbage. */
export function parseSection(raw, id) {
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

  html = sanitizeSectionHtml(html, id);

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
  const messages = [
    { role: 'system', content: sectionSystemPrompt({ id: ctx.section.id, kind: ctx.kind, brand: ctx.brand }) },
    { role: 'user', content: attempt === 1
      ? sectionUserPrompt(ctx)
      : `${sectionUserPrompt(ctx)}\n\nIMPORTANT — your previous attempt was rejected: ${String(lastError || 'invalid output').slice(0, 180)}.\n${/truncat|not closed|too large/i.test(String(lastError)) ? 'You ran out of output space: make the section SHORTER (less CSS, fewer elements) while keeping the required motion. ' : ''}Respond with ONLY the <section>+<style> answer — no markdown fences, no commentary.` },
  ];
  const raw = await sarvamChat(env, messages, { maxTokens: SECTION_AI_TOKENS, temperature: attempt === 1 ? 0.7 : 0.5 });
  return parseSection(raw, ctx.section.id);
}

/** Code one section with the single retry+regen policy. Returns null on failure. */
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

export async function reviewSections(env, { kind, brand, sections }) {
  try {
    const digest = sections
      .map((s) => `#${s.id} (${s.name}) — goal: ${s.goal}\nCSS head: ${s.css.slice(0, 180)}`)
      .join('\n\n')
      .slice(0, 2600);
    const j = await sarvamChat(
      env,
      [
        {
          role: 'system',
          content: `You are the design director reviewing hand-coded sections of a ${kind} page for ${brand.name} before it ships. A section is "fix" ONLY if it is broken for a live page: unstyled, contradicts the design direction, empty shell, or unusable on mobile. Stylistic taste is NOT a fix reason. Respond with ONLY JSON: {"verdicts":[{"id":"...","verdict":"good"|"fix","note":"<=10 words"}]}`,
        },
        { role: 'user', content: digest },
      ],
      { json: true, maxTokens: REVIEW_AI_TOKENS, temperature: 0.3 }
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
  return {
    google,
    css: `
:root{--bg:${v.bg};--surface:${v.surface};--card:${v.card};--ink:${v.ink};--muted:${v.muted};--accent:${v.accent};--accent2:${v.accent2};--on-accent:${v.onAccent};--border:${v.border};--r:${r}px;--maxw:1120px;--font:${body};--display:${display};--sp1:6px;--sp2:12px;--sp3:20px;--sp4:32px;--sp5:52px;--sp6:84px}
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
/* scroll-reveal contract */
[data-rev]{opacity:0;transform:translateY(26px);filter:blur(6px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1),filter .7s ease}
[data-rev][data-rev-delay="1"]{transition-delay:.09s}[data-rev][data-rev-delay="2"]{transition-delay:.18s}[data-rev][data-rev-delay="3"]{transition-delay:.27s}[data-rev][data-rev-delay="4"]{transition-delay:.36s}
.rev-in[data-rev]{opacity:1;transform:none;filter:none}
/* nav + footer chrome */
.site-nav{position:sticky;top:0;z-index:900;backdrop-filter:blur(14px);background:color-mix(in srgb,var(--bg) 78%,transparent);border-bottom:1px solid var(--border)}
.site-nav .wrap{display:flex;align-items:center;gap:var(--sp3);height:62px}
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
/* film grain — flat blacks read printed, not rendered */
body::after{content:"";position:fixed;inset:-50%;z-index:2000;pointer-events:none;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@media (prefers-reduced-motion:reduce){[data-rev]{opacity:1;transform:none;filter:none;transition:none}*{animation-duration:.001s !important;animation-iteration-count:1 !important;transition-duration:.001s !important}html{scroll-behavior:auto}}`,
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

function revealJs() {
  return `(function(){
var m=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var els=[].slice.call(document.querySelectorAll('[data-rev]'));
if(m||!('IntersectionObserver' in window)){els.forEach(function(e){e.setAttribute('data-rev','');e.classList.add('rev-in')});return}
var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('rev-in');io.unobserve(en.target)}})},{threshold:.14,rootMargin:'0px 0px -6% 0px'});
els.forEach(function(e){io.observe(e)});
var bar=document.getElementById('rev-progress');
addEventListener('scroll',function(){var h=document.documentElement;var p=h.scrollTop/(h.scrollHeight-h.clientHeight||1);if(bar)bar.style.width=(p*100).toFixed(2)+'%'},{passive:true});
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
 * The full codegen pipeline. Throws only when the CODE stage cannot
 * produce a viable page — the caller then falls back to the template
 * engine (site_templates.js) so a build never fails.
 *
 * @param preplanned optional stored section plan (refine path) — skips
 *        the PLAN call and keeps the page architecture stable.
 * @param onStage optional (stage, ok, ai, detail) => void trace callback
 */
export async function codegenSite(env, { kind, brief, brand, thought, content, skillsBlock = '', preplanned = null, onStage = () => {} }) {
  const trace = (stage, ok, ai, detail) => onStage({ stage, ok, ai, detail });

  // 1. PLAN — information architecture (or reuse the stored plan).
  const plan = preplanned || (await planSections(env, { kind, brief, brand, thought, content, skillsBlock }));
  trace('plan', true, plan.ai, `${plan.sections.length} sections planned${plan.ai ? '' : ' · classic plan'}`);

  // 2. CODE — hand-write every section. The hero MUST be AI-coded (it is
  //    the page's identity); any other section that fails twice degrades
  //    to a clean engine block rather than discarding the bespoke page.
  const coded = [];
  const ctxBase = { kind, brief, brand, thought, content, design: thought.design };
  let regensLeft = MAX_REGENS;
  for (const section of plan.sections) {
    const ctx = { ...ctxBase, section };
    let out = await codeSection(env, ctx);
    if (!out && regensLeft > 0) {
      // One director-forced redo with a tighter brief before giving up.
      regensLeft--;
      ctx.section = { ...section, layout: `${section.layout} Keep it SIMPLER: fewer elements, cleaner grid.` };
      out = await codeSection(env, ctx);
    }
    if (!out) {
      if (section.id === 'hero') throw new Error('codegen failed at the hero — falling back to the engine');
      out = engineFallbackSection(section, content, thought.design);
      trace(`code:${section.id}`, true, false, `${section.name} — engine section (AI output unusable)`);
    } else {
      trace(`code:${section.id}`, true, true, `${section.name} coded (${out.html.length + out.css.length} chars)`);
    }
    coded.push({ id: section.id, ...out });
  }

  // 3. REVIEW — director pass; flagged sections get one real regen.
  let reviewed = 0;
  if (coded.length >= 2) {
    const review = await reviewSections(env, { kind, brand, sections: coded.map((c) => ({ ...c, ...plan.sections.find((s) => s.id === c.id) })) });
    trace('review', true, review.ai, review.ai ? 'director reviewed the code' : 'review skipped');
    for (const c of coded) {
      if (review.verdicts[c.id] !== 'fix' || regensLeft <= 0) continue;
      regensLeft--;
      const section = plan.sections.find((s) => s.id === c.id);
      const ctx = { ...ctxBase, section, _lastError: review.notes[c.id] || 'director flagged this section' };
      const redo = await codeSection(env, ctx);
      if (redo) {
        reviewed++;
        coded[coded.indexOf(c)] = { id: c.id, ...redo };
        trace(`code:${c.id}`, true, true, `${section.name} re-coded after review`);
      }
    }
  } else {
    trace('review', true, false, 'single section — review skipped');
  }

  // 4. WIRE — deterministic assembly (cannot produce a malformed page).
  const html = assembleSite({ design: thought.design, brand, content, coded, plan, kind });
  trace('wire', true, false, `${coded.length} sections wired · fonts + reveal + nav`);

  return { html, plan, coded, stages: { reviewed } };
}
