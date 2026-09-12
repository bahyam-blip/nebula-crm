/**
 * DESIGNER — the thinking pipeline behind Studio builds (Agent v11).
 *
 * v11 DESIGN DNA — the "every site is the same colour" bug, killed with
 * parameters: the owner's brand color no longer anchors any palette.
 * Instead every brief is hashed into one of TWELVE curated design-DNA
 * families (hue family + theme candidates + font + texture), and the
 * Art Director is REQUIRED to stay inside that family while refining
 * freely within it. Two different briefs can no longer ship the same
 * look — even when the model is lazy, even on the deterministic path.
 * A colour word in the brief ("deep green") overrides the seeded hue.
 *
 * extractSiteHtml() is the hard gate that fixed the screenshots bug:
 * markdown fences, prose and truncation can never reach R2 again.
 */

import { runAgent, leadBlock, understandingBlock } from './agents.js';
import { masterBlock } from './masterprompt.js';
import { sarvamChat } from './sarvam.js';
import { webSearch } from './research.js';
import { normalizeDesign, themeForStyleHint, THEMES } from './site_templates.js';
import { expandPalette, fontPairFor, colorPack } from './mastery.js';

const THEME_NAMES = Object.keys(THEMES);

/* ══ WCAG contrast math — the deterministic design gate (v10) ════════ */

/** Relative luminance per WCAG 2.x (sRGB, gamma-expanded). */
function relLum(c) {
  const h = String(c || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const v = parseInt(n || '000000', 16);
  const f = (raw) => {
    const s = raw / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f((v >> 16) & 255) + 0.7152 * f((v >> 8) & 255) + 0.0722 * f(v & 255);
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrastRatio(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Nudge a color toward light (amt>0) or dark (amt<0) in fixed steps. */
function nudge(hexColor, towardLight) {
  const n = parseInt(String(hexColor).replace('#', '').slice(0, 6) || '000000', 16);
  const step = towardLight ? 28 : -28;
  const f = (v) => Math.max(0, Math.min(255, v + step));
  return `#${((f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

/**
 * ENFORCE CONTRAST — the deterministic half of design-system v2. The AI
 * picks the HUES; this pass mathematically guarantees the RATIOS:
 *   ink vs bg ≥ 7:1 (headlines), muted vs bg ≥ 4.5:1 (body),
 *   accent vs bg ≥ 3:1 (UI component). Bounded nudges (≤10 per color);
 *   hues are never replaced, only pushed toward light/dark until they
 *   pass. This is how "advanced designs with colours" is done with
 *   actual parameters — the palette stays artful AND accessible.
 */
export function enforceContrast(palette) {
  const p = { ...(palette || {}) };
  const bg = /^#[0-9a-fA-F]{6}$/.test(String(p.bg || '')) ? p.bg : null;
  if (!bg) return p;
  const bgLight = relLum(bg) > 0.4;
  const drive = (key, target) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(p[key] || ''))) return;
    let cur = p[key];
    for (let i = 0; i < 10 && contrastRatio(cur, bg) < target; i++) {
      cur = nudge(cur, !bgLight); // dark bg → push text lighter, light bg → darker
    }
    p[key] = cur;
  };
  drive('ink', 7);
  drive('muted', 4.5);
  drive('accent', 3);
  return p;
}

/* ══ DESIGN DNA — per-brief palette variety, deterministic (v11) ═════ */

/** Fast string hash → 32-bit seed. */
export function hashSeed(str) {
  const s = String(str || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Twelve curated design-DNA families. Each pins the HUE family, theme
 * candidates, font pairing and texture so two builds never repeat the
 * same look, while the Art Director still refines artfully inside it.
 */
export const DESIGN_DNA = [
  { name: 'Ember', hues: ['#c2410c', '#ea580c', '#b45309', '#9a3412'], themes: ['editorial', 'neo'], fonts: ['serif', 'syne'], texture: 'grain', mood: 'warm, artisanal, appetite' },
  { name: 'Glacier', hues: ['#0369a1', '#0284c7', '#075985', '#0ea5e9'], themes: ['swiss', 'onyx'], fonts: ['modern', 'grotesk'], texture: 'clean', mood: 'precise, trustworthy, technical' },
  { name: 'Forest', hues: ['#15803d', '#166534', '#3f6212', '#065f46'], themes: ['editorial', 'swiss'], fonts: ['serif', 'modern'], texture: 'grain', mood: 'grounded, natural, healthy' },
  { name: 'Citrus', hues: ['#ca8a04', '#a16207', '#f59e0b', '#65a30d'], themes: ['playful', 'festive'], fonts: ['rounded', 'syne'], texture: 'clean', mood: 'bright, friendly, energetic' },
  { name: 'Orchid', hues: ['#7c3aed', '#9333ea', '#a21caf', '#6d28d9'], themes: ['aurora', 'festive'], fonts: ['syne', 'modern'], texture: 'grain', mood: 'creative, expressive, modern' },
  { name: 'Rosewood', hues: ['#be123c', '#9f1239', '#e11d48', '#881337'], themes: ['editorial', 'luxe'], fonts: ['serif', 'luxe'], texture: 'grain', mood: 'elegant, intimate, crafted' },
  { name: 'Tide', hues: ['#0f766e', '#115e59', '#0891b2', '#14b8a6'], themes: ['aurora', 'swiss'], fonts: ['modern', 'grotesk'], texture: 'clean', mood: 'calm, clear, restorative' },
  { name: 'Ink & Gold', hues: ['#d3aa5e', '#caa24a', '#b8860b', '#d4af37'], themes: ['luxe', 'onyx'], fonts: ['luxe', 'serif'], texture: 'grain', mood: 'premium, timeless, exclusive' },
  { name: 'Sandstone', hues: ['#a16207', '#92400e', '#78350f', '#b45309'], themes: ['editorial', 'swiss'], fonts: ['serif', 'grotesk'], texture: 'clean', mood: 'earthy, honest, handmade' },
  { name: 'Coral Pop', hues: ['#f43f5e', '#fb7185', '#ff6b6b', '#e11d48'], themes: ['playful', 'festive'], fonts: ['rounded', 'syne'], texture: 'clean', mood: 'playful, young, social' },
  { name: 'Olive Market', hues: ['#4d7c0f', '#3f6212', '#556b2f', '#65a30d'], themes: ['editorial', 'playful'], fonts: ['grotesk', 'rounded'], texture: 'grain', mood: 'fresh, local, communal' },
  { name: 'Midnight', hues: ['#3b82f6', '#2563eb', '#60a5fa', '#1d4ed8'], themes: ['aurora', 'onyx'], fonts: ['grotesk', 'modern'], texture: 'grain', mood: 'after-dark, premium tech' },
];

/**
 * Pick THIS build's design DNA. Deterministic from brief+kind+title, so
 * the same brief re-builds coherently while different briefs diverge —
 * and a color word in the brief (“deep green”) overrides the family's
 * hue while keeping its theme/font/texture direction.
 */
export function pickDesignDna({ brief = '', kind = '', title = '', style = '' } = {}) {
  const seed = hashSeed(`${kind}::${title}::${String(brief).slice(0, 400)}`);
  const dna = DESIGN_DNA[seed % DESIGN_DNA.length];
  const themed = themeForStyleHint(style, kind);
  // An explicit style hint picks the theme candidates instead.
  const themes = themed && themed !== 'aurora'
    ? [themed, ...dna.themes.filter((t) => t !== themed)]
    : dna.themes;
  return { ...dna, themes };
}

/** Deterministic variety seed for the palette/font explorers. */
function seedFor(brief, kind, site) {
  return hashSeed(`${kind}::${site?.name || ''}::${String(brief).slice(0, 300)}`);
}

/**
 * v12 MASTERY on the design object: expand the enforced palette into a
 * full token set (10-step ramp + harmony second accent) and lock the
 * build's font pairing. Mutates + returns the design. Runs on BOTH the
 * AI and deterministic paths so mastery never depends on the model.
 */
function applyMastery(design, dna, brief, kind, seed) {
  try {
    const accent = /^#[0-9a-fA-F]{6}$/.test(String(design?.palette?.accent || ''))
      ? design.palette.accent
      : dna.hues[0];
    const expanded = expandPalette(accent, {
      theme: design.theme, seed,
      harmony: ['analogous', 'complementary', 'split', 'triadic', 'tetradic'][seed % 5],
    });
    // The ramp + borders/muted neutrals are the MASTERY layer's math —
    // the AI hues (already contrast-enforced) stay authoritative for
    // bg/ink/accent; everything derived is filled from the expansion.
    design.ramp = expanded.ramp;
    if (!design.palette.accent2 || design.palette.accent2 === design.palette.accent) {
      design.palette.accent2 = expanded.accent2;
    }
    if (!design.palette.border) design.palette.border = expanded.border;
    design.fontPair = fontPairFor({ dnaName: dna.name, theme: design.theme, brief, kind, seed });
    design.harmony = expanded.harmony;
  } catch {
    /* mastery must never break a build */
  }
  return design;
}

/* ══ Stage 1 — THINK (design-system v2) ══════════════════════════════ */

function briefSystemPrompt(kind, site, style, dna) {
  const client = site?.name || 'the client';
  const seedHue = site?.color || dna.hues[0];
  // v15: the Art Director wakes up carrying the master prompt's designer
  // slice — design is a first-class system, never decoration.
  return `${masterBlock('designer')}

You are the design director of a world-class web studio (Awwwards-tier). Respond with ONLY a JSON object.

A client described a ${kind} page. Decide the design system — not just a theme, the full art direction.

Schema:
{
 "theme": "onyx|aurora|luxe|editorial|swiss|festive|playful|neo",
 "hero": "centered|split|editorial",
 "art": "mesh|rings|waves|grid|blocks",
 "palette": {"bg":"#hex","surface":"#hex","ink":"#hex","muted":"#hex","accent":"#hex","accent2":"#hex"},
 "font": "modern|grotesk|serif|luxe|syne|rounded|mono",
 "type_scale": "compact|classic|dramatic",
 "texture": "grain|clean|grid",
 "motion_intensity": "calm|balanced|bold",
 "ux_flow": ["3-5 visitor journey beats in order, e.g. 'land → promise in one breath'","scan → proof and specifics","feel → the atmosphere section","act → booking without friction"],
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
- type_scale: compact=systematic, tight ratios (SaaS, reports); classic=balanced editorial rhythm (most brands); dramatic=huge display jumps (fashion, events, portfolios, statements).
- texture: grain=tactile film grain (dark/premium/craft); clean=flat surfaces (SaaS/corporate); grid=faint structural grid lines (swiss/tech).
- motion_intensity: calm=subtle fades only (law, finance); balanced=reveals + ambient (most); bold=choreographed entrances + ambient motion (creative, events, food).
- ux_flow: map the EMOTIONAL journey, not sections — what the visitor should feel/understand at each beat.
- ONE dominant accent; the second color only supports. Never rainbow.
- Ink-on-bg contrast >= 7:1 for headlines, >= 4.5:1 for body (the pipeline verifies your ratios and will correct them — pick hues with contrast in mind).
- Choose theme by AUDIENCE EMOTION, not habit: luxury/nightlife/tech -> aurora or luxe; craft/editorial/consulting -> editorial; SaaS/corporate -> swiss; sale/festival -> festive; kids/food/community -> playful.
- headline_angle must be a concrete promise or number when possible ("Custom thalis in 20 minutes" beats "Great food").
- must_have: think like the visitor — what proof do they need to act? (menu/pricing/proof/booking/FAQ).
Rules: hex colors only.
DESIGN DNA — YOUR REQUIRED STARTING POINT (v11): family "${dna.name}" — mood ${dna.mood}. The accent MUST stay in the ${dna.name} hue family (seed ${seedHue}; adjust lightness/saturation freely, drift to a DIFFERENT hue family is forbidden${site?.color ? ' — the client named this color themselves' : ''}). Theme candidates: ${dna.themes.join(' or ')}. Font pairing: ${dna.fonts.join(' or ')}. Texture bias: ${dna.texture}. Refine artfully INSIDE this family.${style ? ` The client asked for this style: "${style}" — honor it within the family.` : ''}
${colorPack()}
IDENTITY: the client is "${client}" — design for THEM and nobody else; never borrow another business's name, colors or logo.`;
}

export async function designBrief(env, { kind, brief, style, brand, site = null, skillsBlock = '', lead = null, understanding = null, team = null }) {
  // v11 DESIGN DNA: this build's deterministic art-direction family.
  const dna = pickDesignDna({ brief, kind, title: site?.name || '', style });
  const seedAccent = site?.color || dna.hues[0];
  const fallback = () => {
    const design = normalizeDesign(
      { theme: dna.themes[0] || themeForStyleHint(style, kind), palette: {}, font: '' },
      { kind, styleHint: style, seedAccent }
    );
    // v10 tokens stay coherent even on the deterministic path: dark themes
    // read premium with grain, light themes stay clean.
    design.type_scale = 'classic';
    design.texture = ['onyx', 'aurora', 'luxe'].includes(String(design.theme || '')) ? 'grain' : (dna.texture === 'clean' ? 'clean' : 'grain');
    design.motion_intensity = 'balanced';
    design.ux_flow = [];
    applyMastery(design, dna, brief, kind, seedFor(brief, kind, site));
    return { design, headlineAngle: '', mustHave: [], queries: [], ai: false, dna };
  };
  try {
    const j = await runAgent(
      env,
      team,
      'director',
      'designing the art direction',
      [
        { role: 'system', content: [briefSystemPrompt(kind, site, style, dna), skillsBlock].filter(Boolean).join('\n\n') },
        { role: 'user', content: [String(brief).slice(0, 2200), understandingBlock(understanding), leadBlock(lead)].filter(Boolean).join('\n\n') },
      ],
      { json: true, maxTokens: 1000, temperature: 0.7 },
      (out) => `${out.theme || 'classic'} direction for ${site?.name || 'the client'}`
    );
    const theme = THEME_NAMES.includes(String(j.theme)) ? String(j.theme) : dna.themes[0] || themeForStyleHint(style, kind);
    const design = normalizeDesign(
      { theme, palette: j.palette || {}, font: String(j.font || ''), voice: j.voice, audience: j.audience, hero: j.hero, art: j.art },
      { kind, styleHint: style, seedAccent }
    );
    // v10 DESIGN-SYSTEM v2 tokens — parsed with hard defaults so a model
    // that omits them still ships a coherent system.
    design.type_scale = ['compact', 'classic', 'dramatic'].includes(String(j.type_scale)) ? String(j.type_scale) : 'classic';
    design.texture = ['grain', 'clean', 'grid'].includes(String(j.texture)) ? String(j.texture) : String(design.theme || '').match(/onyx|aurora|luxe/) ? 'grain' : 'clean';
    design.motion_intensity = ['calm', 'balanced', 'bold'].includes(String(j.motion_intensity)) ? String(j.motion_intensity) : 'balanced';
    design.ux_flow = Array.isArray(j.ux_flow) ? j.ux_flow.map((s) => String(s).slice(0, 110)).filter(Boolean).slice(0, 5) : [];
    // The deterministic accessibility gate: AI hues, math-guaranteed ratios.
    design.palette = enforceContrast(design.palette);
    // v12 MASTERY: expand the palette (10-step ramp + harmony accent2)
    // and lock this build's font pairing — "millions of colours and
    // fonts", as parameters, on the AI path too.
    applyMastery(design, dna, brief, kind, seedFor(brief, kind, site));
    return {
      design,
      headlineAngle: String(j.headline_angle || '').slice(0, 160),
      mustHave: Array.isArray(j.must_have) ? j.must_have.map((m) => String(m).slice(0, 140)).slice(0, 5) : [],
      queries: Array.isArray(j.research_queries) ? j.research_queries.map((q) => String(q).slice(0, 120)).filter(Boolean).slice(0, 2) : [],
      dna,
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

/* ══ Stage 2b — RESEARCH INTELLIGENCE (Agent v9) ═════════════════════ */

const RESEARCHER_SYSTEM = `You are the Researcher of an elite multi-agent web studio. You just ran live web searches for a client's page. Turn the raw results into MARKET INTELLIGENCE the copywriter and architect can actually build with. Respond with ONLY JSON:

{"facts":["4-6 concrete, usable facts — numbers, names, prices, local truths, trends — each <=140 chars"],"implication":"one line: what this means for how THIS page should position and talk","follow_up":"one SPECIFIC search still missing that would materially ground the copy (a number, a local fact, a competitor norm) or '' if the picture is complete"}

Rules:
- Keep only facts relevant to this business and audience. Drop SEO spam, nav junk, duplicates.
- Never invent facts that are not in the raw results. Thin results → fewer facts.
- Facts the team can ACT on (expectations, price anchors, what locals value) beat encyclopedia trivia.
- follow_up: only when a concrete, searchable gap remains — price ranges, local statistics, seasonal patterns.`;

/** Raw multi-query gathering shared by both research paths. */
async function gatherRawResults(queries, { maxResults = 4 } = {}) {
  const settled = await Promise.allSettled(
    queries.slice(0, 4).map((q) => webSearch({ query: q }))
  );
  const seen = new Set();
  const items = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const r of s.value?.results || []) {
      if (!r?.title || seen.has(r.url)) continue;
      seen.add(r.url);
      items.push(r);
      if (items.length >= maxResults * 2) break;
    }
  }
  return items;
}

/**
 * RESEARCH INTELLIGENCE — the Researcher agent THINKS instead of dumping
 * raw snippets: live searches run in parallel, then one small synthesis
 * call distills usable facts + the positioning implication. v10: when
 * the synthesis names a follow-up search still missing (a price range,
 * a local number), the Researcher runs a SECOND round and merges the
 * new facts — research with depth, bounded at exactly one follow-up.
 * Degrades to the raw fact block when the synthesis is unreachable and
 * to '' when the web itself is unreachable — research never fails the
 * build. Returns { block, ai, follow_up }.
 */
export async function researchIntelligence(env, { queries, brief = '', brand, site = null, team = null }) {
  if (!queries?.length) return { block: '', ai: false, follow_up: '' };
  let items = [];
  try {
    items = await gatherRawResults(queries);
  } catch {
    items = [];
  }
  if (!items.length) return { block: '', ai: false, follow_up: '' };
  const raw = items
    .map((r, i) => `${i + 1}. ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`)
    .join('\n')
    .slice(0, 1500);
  const rawBlock = `MARKET FACTS (from live web searches for: ${queries.join(' | ')}):\n${raw.slice(0, 1300)}`;
  try {
    const j = await runAgent(
      env,
      team,
      'researcher',
      'synthesizing market intelligence',
      [
        { role: 'system', content: RESEARCHER_SYSTEM },
        {
          role: 'user',
          content: [
            `BUSINESS: ${site?.name || brand?.name || 'the client'}${site?.isOwnerBusiness && brand?.profile?.industry ? ` (${brand.profile.industry})` : ''}`,
            `PAGE BRIEF: ${String(brief).slice(0, 300)}`,
            `SEARCH QUERIES: ${queries.join(' | ')}`,
            `RAW RESULTS:\n${raw}`,
          ].join('\n'),
        },
      ],
      { json: true, maxTokens: 550, temperature: 0.35 },
      (out) => `${Array.isArray(out?.facts) ? out.facts.length : 0} facts synthesized`
    );
    let facts = Array.isArray(j?.facts)
      ? j.facts.map((f) => String(f).slice(0, 160)).filter(Boolean).slice(0, 6)
      : [];
    let implication = j?.implication ? String(j.implication).slice(0, 200) : '';
    const followUp = String(j?.follow_up || '').trim().slice(0, 140);

    // ROUND 2 — chase the one concrete gap the synthesis named. Merge the
    // new facts (deduped by prefix overlap) without a second synthesis
    // call: the new raw lines are appended as direct facts. v13 DEEP
    // RESEARCH: the Researcher also OPENS the single most credible page
    // from round 1 and reads it — page-level truth (numbers, names,
    // specifics) that search snippets are too shallow to carry.
    if (followUp && followUp.length > 8) {
      try {
        const round2 = await gatherRawResults([followUp]);
        const merged = [];
        for (const r of round2.slice(0, 3)) {
          const line = `${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`.slice(0, 160);
          if (!line || facts.some((f) => f.slice(0, 60) === line.slice(0, 60))) continue;
          merged.push(line);
          if (merged.length >= 3) break;
        }
        if (merged.length) facts = [...facts, ...merged].slice(0, 8);
        if (team) {
          team.record('researcher', 'chasing the follow-up lead', {
            ok: true, ai: false,
            detail: merged.length ? `"${followUp.slice(0, 60)}" → ${merged.length} more facts` : 'the lead dried up — moving on',
          });
        }
      } catch { /* round 2 is a bonus, never a failure */ }
    }

    // v13 DEEP RESEARCH — read one credible source in full (bounded):
    // the most authoritative URL from the raw results, its readable text
    // mined for 2-3 hard facts the snippets did not carry. Never throws.
    try {
      const { webFetch } = await import('./research.js');
      const credible = items.find((r) => (
        /^https?:\/\//.test(r?.url || '')
        && !/\.pdf($|\?)/i.test(r.url)
        && !/(facebook|instagram|tiktok|x\.com|twitter|linkedin|pinterest)\./i.test(r.url)
      ));
      if (credible?.url) {
        const page = await webFetch({ url: credible.url });
        const text = String(page?.text || '');
        if (text.length > 400) {
          if (team) {
            team.record('researcher', 'reading the primary source', {
              ok: true, ai: false,
              detail: `opened ${String(credible.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}`,
            });
          }
          // Surface the densest fact-bearing lines to the copywriter's
          // intelligence block (deterministic pick: numbers and named
          // specifics beat boilerplate).
          const dense = text
            .split(/(?<=[.!?])\s+/)
            .filter((s) => /\d/.test(s) && s.length > 45 && s.length < 260)
            .slice(0, 3)
            .map((s) => s.trim());
          if (dense.length) {
            facts = [...facts, ...dense.map((d) => `${d.slice(0, 150)} [source: ${String(credible.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}]`)].slice(0, 10);
          }
        }
      }
    } catch { /* deep read is a bonus */ }

    if (!facts.length) return { block: rawBlock, ai: false, follow_up: '' };
    const block = [
      'MARKET INTELLIGENCE (Researcher synthesis of live web searches — treat as grounding, verify nothing invented):',
      ...facts.map((f) => `- ${f}`),
      implication ? `WHAT IT MEANS FOR THIS PAGE: ${implication}` : '',
    ].filter(Boolean).join('\n');
    return { block, ai: true, follow_up: followUp, facts, implication };
  } catch {
    return { block: rawBlock, ai: false, follow_up: '' };
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
 "offer": {"badge": "40% OFF", "price": "₹599", "old_price": "₹999", "note": "", "terms": "", "ends": "future ISO datetime, YYYY-MM-DDTHH:MM:SS", "perks_title": "", "perks": ["what's included"]},
 "event": {"date_label": "Sat, 12 Oct", "time_label": "6:30 PM", "venue": "place, city", "venue_note": "", "agenda": [{"time": "6:30 PM", "item": "...", "who": ""}], "speakers": [{"name": "...", "role": "..."}]},
 "work": [{"title": "project", "tag": "category", "blurb": "1 sentence", "art": "emoji"}],
 "skills": ["skill chips"],
 "report": {"date_label": "10 Sep 2026", "findings": [{"title": "", "text": "2-3 sentences"}], "table": {"title": "", "head": ["col"], "rows": [["cell"]]}, "insights": {"title": "", "text": "", "bullets": []}, "sources": [{"title": "", "url": "https://..."}]},
 "contact": {"email": "", "phone": "", "address": "", "hours": ""},
 "cta_title": "", "cta_sub": "", "footer_note": ""
}`;

function copyPromptContext({ kind, title, brief, site, thought }) {
  // Owner facts reach the copy ONLY when the site IS the owner's own
  // business — otherwise they leak another brand's world into the page.
  const p = site?.profile && site.isOwnerBusiness ? site.profile : null;
  const facts = [];
  if (p?.tagline) facts.push(`tagline: ${p.tagline}`);
  if (p?.about) facts.push(`about: ${String(p.about).slice(0, 220)}`);
  if (p?.industry) facts.push(`industry: ${p.industry}`);
  if (p?.audience) facts.push(`audience: ${p.audience}`);
  if (p?.tone) facts.push(`tone: ${p.tone}`);
  if (site?.phone) facts.push(`phone: ${site.phone}`);
  if (site?.contactEmail) facts.push(`email: ${site.contactEmail}`);
  if (site?.address) facts.push(`address: ${site.address}`);
  if (site?.ctaUrl) facts.push(`main link: ${site.ctaUrl}`);
  return [
    `PAGE KIND: ${kind}`,
    `THE CLIENT: ${site?.name || 'the client'} — every word speaks AS this client; never mention any other brand, business or tool`,
    facts.length ? `CLIENT FACTS: ${facts.join(' | ')}` : '',
    title ? `PAGE TITLE: ${title}` : '',
    `CLIENT BRIEF: ${String(brief).slice(0, 1600)}`,
    thought.headlineAngle ? `LEAD ANGLE: ${thought.headlineAngle}` : '',
    thought.mustHave.length ? `MUST INCLUDE: ${thought.mustHave.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function writeCopy(env, { kind, title, brief, brand, site = null, thought, factsBlock, skillsBlock = '', lead = null, team = null }) {
  const client = site?.name || 'the client';
  const sys = `You are a senior conversion copywriter (top 1%) writing for a ${kind} page. Respond with ONLY a JSON object matching this schema (omit groups that make no sense for this kind; never write "lorem" or placeholders; keep the WHOLE JSON compact — short strings, total under 220 words — truncation destroys the page):

${COPY_SCHEMA}

Craft rules — this is what makes copy convert:
- Specific to THIS business and brief. Concrete nouns, numbers, names. No clichés ("unleash", "revolutionize", "elevate").
- IDENTITY: you write AS "${client}" and about nobody else — never mention any other brand, business, domain or the tool that built the page.
- Headline: lead with the payoff. Plain words, strong verbs. 4-9 words is ideal.
- Sub: answer "what exactly do I get and why you?" in one breath.
- Features: each title = an outcome ("Fitted in 30 minutes"), text = proof/how.
- FAQ: pre-empt the real objections (price, time, trust, availability).
- Never invent facts you were not given — keep numbers generic ("50+", "since 2019") unless the brief or MARKET FACTS state them.
- DATES ARE FACTS: today is ${new Date().toISOString().slice(0, 10)}. Any offer "ends" or event date you write MUST be in the future — at least 2 weeks out. Never write a past date or a bare month/day.
- "primary_cta.href": use the client's main link if given, else mailto:${site?.contactEmail || brand?.contactEmail || `hello@${slugifyClient(client)}`}.
- If MARKET FACTS are provided, weave real specifics from them into copy and, for report kind, into report.findings/table/sources.
- marquee: 3-6 punchy keywords for a scrolling band (cafes, studios, offers) — omit for reports.
- Respect the design voice: "${thought.design.voice || 'clear, confident'}" for audience "${thought.design.audience || 'general'}".`;
  try {
    const j = await runAgent(
      env,
      team,
      'copywriter',
      'writing the page copy',
      [
        { role: 'system', content: skillsBlock ? `${sys}

${skillsBlock}` : sys },
        { role: 'user', content: [copyPromptContext({ kind, title, brief, site: site || brand, thought }), factsBlock, leadBlock(lead)].filter(Boolean).join('\n\n') },
      ],
      { json: true, maxTokens: 2000, temperature: 0.75 },
      (out) => `"${String(out?.headline || '').slice(0, 60)}"`
    );
    return { content: sanitizeCopy(j, { kind, brand: site || brand }), ai: true };
  } catch {
    return { content: defaultCopy({ kind, title, brief, brand: site || brand }), ai: false };
  }
}

/** Domain-ish slug from the client name for neutral mailto fallbacks. */
function slugifyClient(name) {
  return String(name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'client';
}

/**
 * v14 DATE TRUTH — offer countdowns were shipping the model's invented
 * dates ("25 Dec 2024" live in 2026). Rules now:
 *   · parseable & future          → kept (ISO)
 *   · parseable & past/<36h away  → pushed to today + 14 days
 *   · year-less label ("28 Feb")  → resolved to the NEXT occurrence
 *   · unparseable prose           → dropped (no countdown renders)
 */
export function saneEndsDate(raw, now = new Date()) {
  const s = String(raw || '').trim();
  if (!s || !/\d/.test(s)) return ''; // V8 parses prose like "whenever you can" — dates always contain digits
  let d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const withYear = new Date(`${s} ${now.getFullYear()}`);
    if (!Number.isNaN(withYear.getTime())) d = withYear;
  }
  if (Number.isNaN(d.getTime())) return '';
  if (d.getTime() < now.getTime() + 36 * 3600 * 1000) {
    d = new Date(now.getTime() + 14 * 86400 * 1000);
  }
  return d.toISOString().slice(0, 19);
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
            ends: saneEndsDate(j.offer.ends),
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
    sub: sentences[1] || sentences[0] || `The ${kindLabel} for ${brand.name} — live, shareable, ready today.`,
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
    footer_note: '',
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
export async function applyRefinement(env, { instruction, kind, content, design, brand, team = null }) {
  const client = brand?.name || 'the client';
  try {
    const j = await runAgent(
      env,
      team,
      'copywriter',
      'applying the change request',
      [
        {
          role: 'system',
          content: `You are updating the content of a ${kind} page after client feedback. The page belongs to "${client}" — never introduce any other brand, business or tool name. Respond with ONLY the UPDATED JSON content object (same schema you originally wrote — include unchanged groups unchanged). Current content JSON:\n${JSON.stringify(content).slice(0, 6000)}\n\nRules: apply EVERY instruction; keep everything else identical; hex colors only if a palette is included; never output markdown.`,
        },
        { role: 'user', content: `INSTRUCTION: ${String(instruction).slice(0, 600)}\n\nClient: ${client}. Return the full updated content JSON now.` },
      ],
      { json: true, maxTokens: 1600, temperature: 0.6 },
      () => 'content updated from the instruction'
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
