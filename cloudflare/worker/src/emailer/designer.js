/**
 * DESIGNER — the thinking pipeline behind Studio builds (Agent v5).
 *
 * The v4 builder asked Sarvam for a whole website in ONE call and saved
 * whatever came back. Inside a ~2k-token completion budget that produced
 * markdown fences, truncated pages and model chatter served as "the
 * website" (the exact bug in the user's screenshots). v5 flips the split:
 *
 *   1. THINK    designBrief()  — one small JSON call picks the design
 *                system, palette, font pairing, voice and a section
 *                plan (+ up to 2 research queries).
 *   2. RESEARCH researchFacts() — live web facts via the DDG chain so
 *                copy is grounded in the business's real market.
 *   3. WRITE    writeCopy()    — one small JSON call writes the words
 *                (headline, features, FAQ…) against a strict schema.
 *   4. RENDER   renderSite()   — site_templates.js assembles premium
 *                HTML deterministically. CANNOT truncate or leak fences.
 *
 * Every stage degrades gracefully: AI failure at any point falls back to
 * a deterministic design/copy derived from the brief — a build NEVER
 * fails to produce a complete, on-brand site.
 *
 * extractSiteHtml() is the hard gate that fixed the screenshots bug:
 * markdown fences, prose and truncation can never reach R2 again.
 */

import { sarvamChat } from './sarvam.js';
import { webSearch } from './research.js';
import { normalizeDesign, themeForStyleHint, THEMES } from './site_templates.js';

const THEME_NAMES = Object.keys(THEMES);

/* ══ Stage 1 — THINK ═════════════════════════════════════════════════ */

function briefSystemPrompt(kind, brand, style) {
  return `You are the design director of a world-class web studio (Awwwards-tier). Respond with ONLY a JSON object.

A client described a ${kind} page. Decide the design direction.

Schema:
{
 "theme": "onyx|aurora|luxe|editorial|swiss|festive|playful|neo",
 "hero": "centered|split|editorial",
 "art": "mesh|rings|waves|grid|blocks",
 "palette": {"bg":"#hex","surface":"#hex","ink":"#hex","muted":"#hex","accent":"#hex","accent2":"#hex"},
 "font": "modern|grotesk|serif|luxe|syne|rounded|mono",
 "voice": "3-6 word tone of voice for all copy",
 "audience": "who this page must convince, 3-8 words",
 "headline_angle": "the single strongest promise to lead with, <=14 words",
 "must_have": ["3-5 section/content ideas specific to THIS brief"],
 "research_queries": ["0-2 short web searches that would surface real facts to enrich the copy"]
}

Design principles you apply (this is what separates premium from template):
- Theme meanings: onyx=DEEP BLACK minimal, white type, hairlines, one restrained accent (premium/tech/architecture/studio); aurora=dark glass glowing accents; luxe=dark+gold elegance; editorial=light magazine serif; swiss=white minimal grid (SaaS/corporate); festive=vivid celebration; playful=bright friendly; neo=neo-brutalist poster, thick borders, hard shadows, loud accent.
- hero: centered=statement hero; split=text left + art panel right (product/tech/onyx); editorial=huge left headline with rule lines (craft/food/portfolio/report).
- art: mesh=soft blobs; rings=concentric circles (premium); waves=flowing lines (wellness/music/luxe); grid=iso grid (tech/swiss); blocks=mondrian (editorial/neo/playful).
- ONE dominant accent; the second color only supports. Never rainbow.
- Ink-on-bg contrast >= 7:1 for headlines, >= 4.5:1 for body.
- Choose theme by AUDIENCE EMOTION, not habit: luxury/nightlife/tech -> aurora or luxe; craft/editorial/consulting -> editorial; SaaS/corporate -> swiss; sale/festival -> festive; kids/food/community -> playful.
- headline_angle must be a concrete promise or number when possible ("Custom thalis in 20 minutes" beats "Great food").
- must_have: think like the visitor — what proof do they need to act? (menu/pricing/proof/booking/FAQ).
- Palettes are ACCESSIBLE: muted text still readable on bg; accent readable as button text.
Rules: hex colors only.${style ? ` The client asked for this style: "${style}" — honor it in theme/palette.` : ''} Business context: brand "${brand.name}", color ${brand.color}${brand.profile?.industry ? `, industry ${brand.profile.industry}` : ''}${brand.profile?.audience ? `, audience ${brand.profile.audience}` : ''}.`;
}

export async function designBrief(env, { kind, brief, style, brand, skillsBlock = '' }) {
  const fallback = () => ({
    design: normalizeDesign(
      { theme: themeForStyleHint(style, kind), palette: {}, font: '' },
      { kind, styleHint: style, brandColor: brand.color }
    ),
    headlineAngle: '',
    mustHave: [],
    queries: [],
    ai: false,
  });
  try {
    const j = await sarvamChat(
      env,
      [
        { role: 'system', content: [briefSystemPrompt(kind, brand, style), skillsBlock].filter(Boolean).join('\n\n') },
        { role: 'user', content: String(brief).slice(0, 2200) },
      ],
      { json: true, maxTokens: 900, temperature: 0.7 }
    );
    const theme = THEME_NAMES.includes(String(j.theme)) ? String(j.theme) : themeForStyleHint(style, kind);
    const design = normalizeDesign(
      { theme, palette: j.palette || {}, font: String(j.font || ''), voice: j.voice, audience: j.audience, hero: j.hero, art: j.art },
      { kind, styleHint: style, brandColor: brand.color }
    );
    return {
      design,
      headlineAngle: String(j.headline_angle || '').slice(0, 160),
      mustHave: Array.isArray(j.must_have) ? j.must_have.map((m) => String(m).slice(0, 140)).slice(0, 5) : [],
      queries: Array.isArray(j.research_queries) ? j.research_queries.map((q) => String(q).slice(0, 120)).filter(Boolean).slice(0, 2) : [],
      ai: true,
    };
  } catch {
    return fallback();
  }
}

/* ══ Stage 2 — RESEARCH ══════════════════════════════════════════════ */

/** Live-web facts block for the copywriter. '' when unreachable. */
export async function researchFacts(queries, { maxResults = 4, maxChars = 1300 } = {}) {
  if (!queries?.length) return '';
  try {
    const res = await webSearch({ query: queries[0] });
    const items = (res?.results || []).slice(0, maxResults);
    if (!items.length) return '';
    let facts = items
      .map((r, i) => `${i + 1}. ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`)
      .join('\n')
      .slice(0, maxChars);
    return `MARKET FACTS (from a live web search for "${queries[0]}"):\n${facts}`;
  } catch {
    return '';
  }
}

/* ══ Stage 3 — WRITE ═════════════════════════════════════════════════ */

const COPY_SCHEMA = `{
 "title": "browser tab title, <=60 chars",
 "kicker": "tiny label above the headline, 1-3 words",
 "headline": "the H1. Bold, specific, no quotes around it",
 "sub": "1-2 sentence supporting line under the headline",
 "primary_cta": {"label": "<=24 chars", "href": "https://... or mailto:... or tel:..."},
 "secondary_cta": {"label": "", "href": ""},
 "hero_badges": ["0-4 short trust chips"],
 "marquee": ["3-6 scrolling-band words — offer keywords, specialties, client names"],
 "stats": [{"value": "40%", "label": "what it measures"}],
 "features": [{"icon": "one emoji", "title": "<=5 words", "text": "1-2 sentences"}],
 "showcase": {"kicker": "", "title": "", "text": "", "art": "one emoji", "bullets": ["0-5 proof points"]},
 "testimonials": [{"quote": "1-2 sentences", "name": "Full Name", "role": "role, city"}],
 "faq": [{"q": "...", "a": "1-2 sentences"}],
 "offer": {"badge": "40% OFF", "price": "₹599", "old_price": "₹999", "note": "", "terms": "", "ends": "YYYY-MM-DDTHH:MM:SS", "perks_title": "", "perks": ["what's included"]},
 "event": {"date_label": "Sat, 12 Oct", "time_label": "6:30 PM", "venue": "place, city", "venue_note": "", "agenda": [{"time": "6:30 PM", "item": "...", "who": ""}], "speakers": [{"name": "...", "role": "..."}]},
 "work": [{"title": "project", "tag": "category", "blurb": "1 sentence", "art": "emoji"}],
 "skills": ["skill chips"],
 "report": {"date_label": "10 Sep 2026", "findings": [{"title": "", "text": "2-3 sentences"}], "table": {"title": "", "head": ["col"], "rows": [["cell"]]}, "insights": {"title": "", "text": "", "bullets": []}, "sources": [{"title": "", "url": "https://..."}]},
 "contact": {"email": "", "phone": "", "address": "", "hours": ""},
 "cta_title": "", "cta_sub": "", "footer_note": ""
}`;

function copyPromptContext({ kind, title, brief, brand, thought }) {
  const facts = [];
  if (brand.profile?.tagline) facts.push(`tagline: ${brand.profile.tagline}`);
  if (brand.profile?.about) facts.push(`about: ${String(brand.profile.about).slice(0, 220)}`);
  if (brand.profile?.industry) facts.push(`industry: ${brand.profile.industry}`);
  if (brand.profile?.audience) facts.push(`audience: ${brand.profile.audience}`);
  if (brand.profile?.tone) facts.push(`tone: ${brand.profile.tone}`);
  if (brand.phone) facts.push(`phone: ${brand.phone}`);
  if (brand.contactEmail) facts.push(`email: ${brand.contactEmail}`);
  if (brand.address) facts.push(`address: ${brand.address}`);
  if (brand.ctaUrl || brand.profile?.website) facts.push(`main link: ${brand.ctaUrl || brand.profile.website}`);
  return [
    `PAGE KIND: ${kind}`,
    `BRAND: ${brand.name} (brand color ${brand.color})`,
    facts.length ? `BUSINESS FACTS: ${facts.join(' | ')}` : '',
    `CLIENT BRIEF: ${String(brief).slice(0, 1600)}`,
    thought.headlineAngle ? `LEAD ANGLE: ${thought.headlineAngle}` : '',
    thought.mustHave.length ? `MUST INCLUDE: ${thought.mustHave.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function writeCopy(env, { kind, title, brief, brand, thought, factsBlock, skillsBlock = '' }) {
  const sys = `You are a senior conversion copywriter (top 1%) writing for a ${kind} page. Respond with ONLY a JSON object matching this schema (omit groups that make no sense for this kind; never write "lorem" or placeholders; keep the WHOLE JSON compact — short strings, total under 220 words — truncation destroys the page):

${COPY_SCHEMA}

Craft rules — this is what makes copy convert:
- Specific to THIS business and brief. Concrete nouns, numbers, names. No clichés ("unleash", "revolutionize", "elevate").
- Headline: lead with the payoff. Plain words, strong verbs. 4-9 words is ideal.
- Sub: answer "what exactly do I get and why you?" in one breath.
- Features: each title = an outcome ("Fitted in 30 minutes"), text = proof/how.
- FAQ: pre-empt the real objections (price, time, trust, availability).
- Never invent facts you were not given — keep numbers generic ("50+", "since 2019") unless the brief or MARKET FACTS state them.
- "primary_cta.href": use the business's main link if given, else mailto:${brand.contactEmail || 'hello@example.com'}.
- If MARKET FACTS are provided, weave real specifics from them into copy and, for report kind, into report.findings/table/sources.
- marquee: 3-6 punchy keywords for a scrolling band (cafes, studios, offers) — omit for reports.
- Respect the design voice: "${thought.design.voice || 'clear, confident'}" for audience "${thought.design.audience || 'general'}".`;
  try {
    const j = await sarvamChat(
      env,
      [
        { role: 'system', content: skillsBlock ? `${sys}

${skillsBlock}` : sys },
        { role: 'user', content: [copyPromptContext({ kind, title, brief, brand, thought }), factsBlock].filter(Boolean).join('\n\n') },
      ],
      { json: true, maxTokens: 2000, temperature: 0.75 }
    );
    return { content: sanitizeCopy(j, { kind, brand }), ai: true };
  } catch {
    return { content: defaultCopy({ kind, title, brief, brand }), ai: false };
  }
}

/** Enforce shapes/limits on whatever the model produced. */
export function sanitizeCopy(j, { kind, brand }) {
  const arr = (v, n, shape) => {
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
      .map(shape)
      .filter(Boolean)
      .slice(0, n);
  };
  const out = {
    title: String(j.title || '').slice(0, 70),
    kicker: String(j.kicker || '').slice(0, 40),
    headline: String(j.headline || '').slice(0, 140),
    sub: String(j.sub || '').slice(0, 320),
    primary_cta: j.primary_cta && typeof j.primary_cta === 'object' ? { label: String(j.primary_cta.label || '').slice(0, 30), href: String(j.primary_cta.href || '') } : null,
    secondary_cta: j.secondary_cta && typeof j.secondary_cta === 'object' ? { label: String(j.secondary_cta.label || '').slice(0, 30), href: String(j.secondary_cta.href || '') } : null,
    hero_badges: Array.isArray(j.hero_badges) ? j.hero_badges.map((b) => String(b).slice(0, 40)).slice(0, 4) : [],
    marquee: Array.isArray(j.marquee) ? j.marquee.map((m) => String(m).slice(0, 40)).filter(Boolean).slice(0, 6) : [],
    stats: arr(j.stats, 4, (s) => ({ value: String(s.value || '').slice(0, 12), label: String(s.label || '').slice(0, 60) })).filter((s) => s.value),
    features: arr(j.features, 6, (f) => ({ icon: String(f.icon || '✦').slice(0, 4), title: String(f.title || '').slice(0, 60), text: String(f.text || '').slice(0, 220) })).filter((f) => f.title),
    testimonials: arr(j.testimonials, 3, (t) => ({ quote: String(t.quote || '').slice(0, 260), name: String(t.name || '').slice(0, 60), role: String(t.role || '').slice(0, 70) })).filter((t) => t.quote),
    faq: arr(j.faq, 6, (f) => ({ q: String(f.q || '').slice(0, 120), a: String(f.a || '').slice(0, 320) })).filter((f) => f.q && f.a),
    offer:
      j.offer && typeof j.offer === 'object'
        ? {
            badge: String(j.offer.badge || '').slice(0, 30),
            price: String(j.offer.price || '').slice(0, 20),
            old_price: String(j.offer.old_price || '').slice(0, 20),
            note: String(j.offer.note || '').slice(0, 120),
            terms: String(j.offer.terms || '').slice(0, 220),
            ends: String(j.offer.ends || '').slice(0, 30),
            perks_title: String(j.offer.perks_title || '').slice(0, 60),
            perks: Array.isArray(j.offer.perks) ? j.offer.perks.map((p) => String(p).slice(0, 90)).slice(0, 6) : [],
          }
        : null,
    event:
      j.event && typeof j.event === 'object'
        ? {
            date_label: String(j.event.date_label || '').slice(0, 40),
            time_label: String(j.event.time_label || '').slice(0, 40),
            venue: String(j.event.venue || '').slice(0, 90),
            venue_note: String(j.event.venue_note || '').slice(0, 160),
            agenda: arr(j.event.agenda, 8, (a) => ({ time: String(a.time || '').slice(0, 20), item: String(a.item || '').slice(0, 90), who: String(a.who || '').slice(0, 60) })).filter((a) => a.item),
            speakers: arr(j.event.speakers, 6, (s) => ({ name: String(s.name || '').slice(0, 60), role: String(s.role || '').slice(0, 80) })).filter((s) => s.name),
          }
        : null,
    work: arr(j.work, 6, (w) => ({ title: String(w.title || '').slice(0, 60), tag: String(w.tag || '').slice(0, 24), blurb: String(w.blurb || '').slice(0, 140), art: String(w.art || '✦').slice(0, 4) })).filter((w) => w.title),
    skills: Array.isArray(j.skills) ? j.skills.map((s) => String(s).slice(0, 30)).slice(0, 10) : [],
    contact:
      j.contact && typeof j.contact === 'object'
        ? {
            email: String(j.contact.email || '').slice(0, 90),
            phone: String(j.contact.phone || '').slice(0, 24),
            address: String(j.contact.address || '').slice(0, 120),
            hours: String(j.contact.hours || '').slice(0, 60),
          }
        : null,
    cta_title: String(j.cta_title || '').slice(0, 100),
    cta_sub: String(j.cta_sub || '').slice(0, 200),
    footer_note: String(j.footer_note || '').slice(0, 100),
  };
  if (kind === 'report' && j.report && typeof j.report === 'object') {
    out.report = {
      date_label: String(j.report.date_label || '').slice(0, 40),
      findings: arr(j.report.findings, 6, (f) => ({ title: String(f.title || '').slice(0, 80), text: String(f.text || '').slice(0, 320) })).filter((f) => f.title),
      table:
        j.report.table && typeof j.report.table === 'object' && Array.isArray(j.report.table.head)
          ? {
              title: String(j.report.table.title || '').slice(0, 70),
              head: j.report.table.head.map((h) => String(h).slice(0, 30)).slice(0, 6),
              rows: Array.isArray(j.report.table.rows)
                ? j.report.table.rows.slice(0, 12).map((r) => (Array.isArray(r) ? r.map((c) => String(c).slice(0, 60)).slice(0, 6) : [])).filter((r) => r.length)
                : [],
            }
          : null,
      insights: j.report.insights && typeof j.report.insights === 'object' ? { title: String(j.report.insights.title || '').slice(0, 80), text: String(j.report.insights.text || '').slice(0, 260), bullets: Array.isArray(j.report.insights.bullets) ? j.report.insights.bullets.map((b) => String(b).slice(0, 90)).slice(0, 5) : [] } : null,
      sources: arr(j.report.sources, 8, (s) => ({ title: String(s.title || '').slice(0, 90), url: String(s.url || '') })).filter((s) => /^https?:\/\//.test(s.url)),
    };
  }
  if (kind === 'report' && !out.report) out.report = null;
  return out;
}

/** Deterministic copy from the brief alone (AI-free fallback). */
export function defaultCopy({ kind, title, brief, brand }) {
  const sentences = String(brief || '')
    .split(/(?:\.\s*|\n+|;\s*)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  const head = title || sentences[0] || `${brand.name}`;
  const icons = ['✦', '◆', '●', '▲', '★', '✧'];
  const featureTitles = ['Built around you', 'Fast to start', 'Made to impress', 'Ready today'];
  const kindLabel = { landing: 'landing page', promo: 'offer', event: 'event', portfolio: 'portfolio', report: 'report', webapp: 'web app' }[kind] || 'page';
  const out = {
    title: head.slice(0, 60),
    kicker: brand.name,
    headline: head,
    sub: sentences[1] || sentences[0] || `The ${kindLabel} for ${brand.name}, built and hosted by the Nebula agent.`,
    primary_cta: { label: brand.ctaUrl ? 'Learn more' : brand.contactEmail ? 'Email us' : 'Get in touch', href: brand.ctaUrl || (brand.contactEmail ? `mailto:${brand.contactEmail}` : '#') },
    secondary_cta: null,
    hero_badges: [`${brand.name}`, 'Built & hosted by AI'],
    stats: [],
    features: sentences.slice(0, 4).map((s, i) => ({ icon: icons[i % icons.length], title: featureTitles[i % featureTitles.length], text: s })),
    testimonials: [],
    faq: [],
    offer: kind === 'promo' ? { badge: 'Limited time', price: 'Special price', old_price: '', note: '', terms: '', ends: '', perks_title: 'What you get', perks: sentences.slice(0, 5) } : null,
    event:
      kind === 'event'
        ? { date_label: '', time_label: '', venue: '', venue_note: '', agenda: sentences.slice(0, 5).map((s, i) => ({ time: `${i + 1}`, item: s.slice(0, 80), who: '' })), speakers: [] }
        : null,
    work: [],
    skills: [],
    report: null,
    contact: { email: brand.contactEmail || '', phone: brand.phone || '', address: brand.address || '', hours: '' },
    cta_title: '',
    cta_sub: '',
    footer_note: 'Made with Nebula Studio',
  };
  if (kind === 'report') {
    out.report = {
      date_label: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      findings: sentences.slice(0, 5).map((s, i) => ({ title: `Finding ${i + 1}`, text: s })),
      table: null,
      insights: null,
      sources: [],
    };
  }
  return out;
}

/** Merge AI copy over deterministic defaults so every field exists. */
export function mergeCopy(aiCopy, base) {
  const m = { ...base };
  for (const [k, v] of Object.entries(aiCopy || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length) m[k] = v;
    } else if (typeof v === 'object') {
      const merged = { ...(base[k] || {}), ...v };
      if (Object.values(merged).some((x) => x !== '' && x !== null)) m[k] = merged;
    } else if (String(v).trim() !== '') {
      m[k] = v;
    }
  }
  return m;
}

/** Apply caller CTA overrides (from the Studio form / tool args). */
export function applyCtaOverrides(content, { cta_text, cta_url, contact_email } = {}) {
  const c = { ...content };
  if (cta_text || cta_url) {
    c.primary_cta = {
      label: String(cta_text || c.primary_cta?.label || 'Get started').slice(0, 30),
      href: String(cta_url || c.primary_cta?.href || '').slice(0, 300),
    };
  }
  if (contact_email && !c.contact?.email) c.contact = { ...(c.contact || {}), email: String(contact_email).slice(0, 90) };
  return c;
}

/* ══ Stage 3b — REFINE ═══════════════════════════════════════════════ */

/**
 * Apply a refinement instruction to an existing plan (design + content).
 * One JSON call: the model returns the UPDATED content object. Falls
 * back to the unchanged plan when the call fails (caller still re-renders).
 */
export async function applyRefinement(env, { instruction, kind, content, design, brand }) {
  try {
    const j = await sarvamChat(
      env,
      [
        {
          role: 'system',
          content: `You are updating the content of a ${kind} page after client feedback. Respond with ONLY the UPDATED JSON content object (same schema you originally wrote — include unchanged groups unchanged). Current content JSON:\n${JSON.stringify(content).slice(0, 6000)}\n\nRules: apply EVERY instruction; keep everything else identical; hex colors only if a palette is included; never output markdown.`,
        },
        { role: 'user', content: `INSTRUCTION: ${String(instruction).slice(0, 600)}\n\nBrand: ${brand.name}. Return the full updated content JSON now.` },
      ],
      { json: true, maxTokens: 1600, temperature: 0.6 }
    );
    const merged = sanitizeCopy(j, { kind, brand });
    // The model may legitimately drop groups — start from the old content
    // and only overwrite what it sent back non-empty.
    const next = mergeCopy(merged, content);
    return { content: next, ai: true };
  } catch {
    return { content, ai: false };
  }
}

/* ══ The hard HTML gate (fixes the raw-markdown bug) ═════════════════ */

/**
 * Extract a clean HTML document from raw model output.
 * Returns { html } or { error } — never passes fences/prose through.
 */
export function extractSiteHtml(raw) {
  let text = String(raw || '').trim();

  // 1. Prefer a fenced block: ```html … ``` (or ``` … ```)
  const fence = /```(?:html|HTML)?\s*\n?([\s\S]*?)```/.exec(text);
  if (fence && /<!doctype html|<html[\s>]/i.test(fence[1])) {
    text = fence[1].trim();
  }

  // 2. Slice to the document itself, dropping any prose around it.
  const doctype = /<!doctype html>/i.exec(text);
  const htmlOpen = /<html[\s>]/i.exec(text);
  const start = doctype ? doctype.index : htmlOpen ? htmlOpen.index : -1;
  if (start === -1) return { error: 'no HTML document found in AI output' };

  const close = text.toLowerCase().lastIndexOf('</html>');
  if (close === -1 || close < start) return { error: 'HTML document is truncated (no </html>) — output hit the token ceiling' };

  const html = text.slice(start, close + 7).trim();

  // 3. Sanity: a real page has a title and a closed body.
  if (html.length < 400) return { error: 'HTML document is too small to be a real page' };
  if (!/<title[\s>]/i.test(html)) return { error: 'HTML document has no <title>' };
  if (!/<\/body>/i.test(html)) return { error: 'HTML document has no </body>' };

  return { html };
}
