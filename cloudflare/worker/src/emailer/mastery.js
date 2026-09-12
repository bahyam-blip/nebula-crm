/**
 * MASTERY — Agent v12. The deep knowledge core.
 *
 * The owner's directive: the studies (the agents) need IMMENSE skills —
 * CSS GLOBAL, thinking, design, wiring, images, "millions of colours and
 * fonts", coding languages, logic, freedom to go out of the box,
 * understanding the problems, reading the policies, hosting rules,
 * database expertise, full-stack capacity to the max.
 *
 * This module is that directive, made executable. Three layers:
 *
 *   1. COLOR SCIENCE (expandPalette) — real HSL math that expands ONE
 *      seed hue into a complete, contrast-disciplined token palette with
 *      a 10-step ramp and a harmony second-accent. Twelve DNA families
 *      × 5 harmonies × continuous lightness/saturation = millions of
 *      distinct palettes. "Millions of colours" is math here, not prose.
 *
 *   2. TYPOGRAPHY LIBRARY (FONT_PAIRINGS) — 40+ curated Google Fonts
 *      PAIRINGS (display × body, weights, tracking, mood tags), chosen
 *      deterministically per build. Far beyond the old 7 stacks.
 *
 *   3. KNOWLEDGE PACKS — senior-level rule cards per discipline:
 *      cssGlobal, color, fonts, motion, wiring, policy, hosting,
 *      fullstack, languages. Injected into the matching agents' prompts
 *      on EVERY build so the whole team reads from the same textbook.
 *
 *   Plus POLICY SENSE (policyNeeds): a deterministic detector that reads
 *   the brief and decides what the LAW expects the page to carry —
 *   cookie consent band, privacy/terms links, disclaimers — so sites
 *   ship compliant by default.
 *
 * Everything is deterministic and outage-proof: mastery must never
 * depend on an AI call succeeding.
 */

/* ════════════════════════════════════════════════════════════════════
 * 1. COLOR SCIENCE — millions of palettes from one seed hue
 * ════════════════════════════════════════════════════════════════════ */

/** #rrggbb → {h,s,l} (h: 0-360, s/l: 0-100). */
export function hexToHsl(hex) {
  const n = String(hex || '').replace('#', '');
  const v = parseInt(n.length === 3 ? n.split('').map((c) => c + c).join('') : (n || '000000').slice(0, 6), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

const f2 = (n) => {
  const x = Math.max(0, Math.min(255, Math.round(n)));
  return x.toString(16).padStart(2, '0');
};

/** {h,s,l} → #rrggbb. */
export function hslToHex({ h, s, l }) {
  const H = ((Number(h) % 360) + 360) % 360;
  const S = Math.max(0, Math.min(100, Number(s))) / 100;
  const L = Math.max(0, Math.min(100, Number(l))) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (H < 60) [r, g, b] = [c, x, 0];
  else if (H < 120) [r, g, b] = [x, c, 0];
  else if (H < 180) [r, g, b] = [0, c, x];
  else if (H < 240) [r, g, b] = [0, x, c];
  else if (H < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `#${f2((r + m) * 255)}${f2((g + m) * 255)}${f2((b + m) * 255)}`;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * The five classic harmonies. Each maps the seed hue to the SECOND
 * accent hue (and, for tetradic/split, a tertiary used sparingly).
 */
export const HARMONIES = {
  analogous: (h) => ({ a2: h + 28, a3: h - 28 }),
  complementary: (h) => ({ a2: h + 180, a3: h + 30 }),
  split: (h) => ({ a2: h + 150, a3: h - 150 }),
  triadic: (h) => ({ a2: h + 120, a3: h + 240 }),
  tetradic: (h) => ({ a2: h + 90, a3: h + 180 }),
};

/**
 * expandPalette — ONE seed hue in, a complete design token set out.
 *
 * @param {string} seedHex   the family's seed accent (or the client's own color)
 * @param {object} o
 *   - dark       boolean  theme polarity (default: derive from theme name)
 *   - theme      string   theme label (onyx/aurora/luxe → dark, swiss/editorial → light)
 *   - seed       number   deterministic variety seed (hash of the brief)
 *   - harmony    string   force a harmony (else picked by seed)
 * @returns full token palette + 10-step ramp + harmony label.
 *
 * This is the "millions of colours" engine: the hue stays in the DNA
 * family; lightness/saturation/harmony explore the space around it.
 */
export function expandPalette(seedHex, o = {}) {
  const { h, s } = hexToHsl(seedHex || '#4f46e5');
  const seed = (Number(o.seed) || 0) >>> 0;
  // mulberry32 — a tiny deterministic PRNG so every seed explores the
  // lightness/saturation space WELL-distributed (not just its high bits).
  let t = seed ^ 0x9e3779b9;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const dark = o.dark !== undefined ? Boolean(o.dark)
    : ['onyx', 'aurora', 'luxe', 'festive'].includes(String(o.theme || '').toLowerCase());
  const harmonyName = HARMONIES[o.harmony] ? o.harmony
    : ['analogous', 'complementary', 'split', 'triadic', 'tetradic'][seed % 5];
  const { a2 } = HARMONIES[harmonyName](h);
  const jitter = (amp = 1) => (rnd() - 0.5) * 2 * amp; // -amp..+amp

  // Accent: keep the family hue, explore saturation/lightness around it.
  const accent = hslToHex({
    h: h + jitter(6),
    s: clamp(s + jitter(10), 58, 92),
    l: clamp((dark ? 62 : 46) + jitter(9), 40, 72),
  });
  // Second accent: the harmony hue, quieter chroma.
  const accent2 = hslToHex({ h: a2, s: clamp(s * 0.82, 30, 78), l: clamp(dark ? 58 : 50, 35, 66) });

  // Neutral field: the seed hue is tinted INTO the neutrals at very low
  // chroma — this is what makes palettes feel designed instead of gray.
  const bgHue = h + jitter(4);
  const bg = dark
    ? hslToHex({ h: bgHue, s: clamp(s * 0.16, 3, 12), l: clamp(7 + Math.abs(jitter(3)), 5, 11) })
    : hslToHex({ h: bgHue, s: clamp(s * 0.12, 2, 9), l: clamp(97 + jitter(1.6), 94.5, 98.5) });
  const surface = dark
    ? hslToHex({ h: bgHue, s: clamp(s * 0.14, 3, 11), l: 11.5 })
    : hslToHex({ h: bgHue, s: clamp(s * 0.10, 2, 8), l: 99 });
  const card = dark
    ? hslToHex({ h: bgHue, s: clamp(s * 0.12, 2, 10), l: 14.5 })
    : hslToHex({ h: bgHue, s: clamp(s * 0.09, 2, 7), l: 100 });
  const border = dark
    ? hslToHex({ h: bgHue, s: clamp(s * 0.1, 2, 9), l: 22 })
    : hslToHex({ h: bgHue, s: clamp(s * 0.12, 2, 10), l: 89 });
  const ink = dark
    ? hslToHex({ h: bgHue, s: clamp(s * 0.1, 2, 8), l: 96 })
    : hslToHex({ h: bgHue, s: clamp(s * 0.3, 6, 20), l: 12 });
  const muted = dark
    ? hslToHex({ h: bgHue, s: clamp(s * 0.09, 2, 7), l: 68 })
    : hslToHex({ h: bgHue, s: clamp(s * 0.14, 3, 12), l: 38 });

  // 10-step ramp of the accent hue (100 → 1000 lightness descends).
  const ramp = {};
  const rampSat = clamp(s, 45, 90);
  for (let i = 1; i <= 10; i++) {
    const l = clamp(94 - (i - 1) * 9.2, 12, 94);
    ramp[i * 100] = hslToHex({ h, s: rampSat * (1 - Math.abs(l - 55) / 220), l });
  }
  ramp.onAccent = dark ? '#0b0b0d' : '#ffffff';

  return {
    harmony: harmonyName, dark,
    bg, surface, card, border, ink, muted,
    accent, accent2, onAccent: ramp.onAccent,
    ramp, // {100..1000, onAccent}
  };
}

/* ════════════════════════════════════════════════════════════════════
 * 2. TYPOGRAPHY LIBRARY — 40+ curated Google Fonts pairings
 * ════════════════════════════════════════════════════════════════════ */

/**
 * Each pairing: display face + body face + weights + tracking + mood
 * tags + the families the design DNA / theme can select from.
 * `google` is the exact fonts.googleapis.com/css2 families param.
 */
export const FONT_PAIRINGS = [
  // ── Editorial serif voice ─────────────────────────────────────────
  { id: 'fraunces-inter', display: 'Fraunces', body: 'Inter', moods: ['editorial', 'craft', 'food', 'warm'], google: 'Fraunces:opsz,wght@9..144,500;9..144,700|Inter:wght@400;500;600;700', tracking: '-0.015em' },
  { id: 'playfair-lato', display: 'Playfair Display', body: 'Lato', moods: ['luxe', 'elegant', 'fashion'], google: 'Playfair+Display:wght@500;600;700;800|Lato:wght@400;700', tracking: '-0.01em' },
  { id: 'cormorant-jost', display: 'Cormorant Garamond', body: 'Jost', moods: ['luxe', 'beauty', 'jewelry'], google: 'Cormorant+Garamond:wght@500;600;700|Jost:wght@400;500;600', tracking: '0' },
  { id: 'libre-source', display: 'Libre Baskerville', body: 'Source Sans 3', moods: ['editorial', 'law', 'academic'], google: 'Libre+Baskerville:wght@400;700|Source+Sans+3:wght@400;600;700', tracking: '0' },
  { id: 'crimson-karla', display: 'Crimson Pro', body: 'Karla', moods: ['editorial', 'story', 'blog'], google: 'Crimson+Pro:wght@500;600;700|Karla:wght@400;600;700', tracking: '0' },
  { id: 'dmserif-dmsans', display: 'DM Serif Display', body: 'DM Sans', moods: ['editorial', 'modern', 'startup'], google: 'DM+Serif+Display:wght@400|DM+Sans:wght@400;500;700', tracking: '-0.01em' },
  { id: 'bitter-worksans', display: 'Bitter', body: 'Work Sans', moods: ['craft', 'coffee', 'bakery'], google: 'Bitter:wght@500;700;800|Work+Sans:wght@400;500;700', tracking: '0' },
  { id: 'newsreader-manrope', display: 'Newsreader', body: 'Manrope', moods: ['report', 'journal', 'analysis'], google: 'Newsreader:opsz,wght@6..72,500;6..72,700|Manrope:wght@400;600;700', tracking: '-0.01em' },
  // ── Modern geometric ──────────────────────────────────────────────
  { id: 'spaceg-inter', display: 'Space Grotesk', body: 'Inter', moods: ['tech', 'saas', 'modern', 'grotesk'], google: 'Space+Grotesk:wght@500;600;700|Inter:wght@400;500;600;700', tracking: '-0.02em' },
  { id: 'sora-ibmplex', display: 'Sora', body: 'IBM Plex Sans', moods: ['tech', 'engineering', 'saas'], google: 'Sora:wght@600;700;800|IBM+Plex+Sans:wght@400;500;600', tracking: '-0.02em' },
  { id: 'outfit-nunito', display: 'Outfit', body: 'Nunito Sans', moods: ['startup', 'friendly', 'app'], google: 'Outfit:wght@600;700;800|Nunito+Sans:wght@400;600;700', tracking: '-0.01em' },
  { id: 'urbanist-inter', display: 'Urbanist', body: 'Inter', moods: ['modern', 'clean', 'wellness'], google: 'Urbanist:wght@600;700;800|Inter:wght@400;500;600', tracking: '-0.01em' },
  { id: 'lexend-figtree', display: 'Lexend', body: 'Figtree', moods: ['education', 'accessible', 'readable'], google: 'Lexend:wght@600;700|Figtree:wght@400;600;700', tracking: '0' },
  { id: 'plusjakarta-inter', display: 'Plus Jakarta Sans', body: 'Inter', moods: ['saas', 'fintech', 'professional'], google: 'Plus+Jakarta+Sans:wght@600;700;800|Inter:wght@400;500;600', tracking: '-0.015em' },
  { id: 'epilogue-mulish', display: 'Epilogue', body: 'Mulish', moods: ['agency', 'modern', 'portfolio'], google: 'Epilogue:wght@600;700;800|Mulish:wght@400;600;700', tracking: '-0.01em' },
  // ── Characterful display ──────────────────────────────────────────
  { id: 'syne-inter', display: 'Syne', body: 'Inter', moods: ['creative', 'art', 'gallery', 'bold'], google: 'Syne:wght@600;700;800|Inter:wght@400;500;600', tracking: '-0.01em' },
  { id: 'clash-etc', display: 'Unbounded', body: 'Space Grotesk', moods: ['bold', 'event', 'music'], google: 'Unbounded:wght@600;700;800|Space+Grotesk:wght@400;500;700', tracking: '0' },
  { id: 'archivo-hind', display: 'Archivo Black', body: 'Hind', moods: ['sport', 'bold', 'sale'], google: 'Archivo+Black:wght@400|Hind:wght@400;600;700', tracking: '0' },
  { id: 'chivo-montserrat', display: 'Chivo', body: 'Montserrat', moods: ['industrial', 'tech', 'utility'], google: 'Chivo:wght@600;700;800|Montserrat:wght@400;600;700', tracking: '0' },
  { id: 'anton-oswald', display: 'Anton', body: 'Public Sans', moods: ['poster', 'sale', 'gym'], google: 'Anton:wght@400|Public+Sans:wght@400;600;700', tracking: '0.01em' },
  { id: 'bebas-barlow', display: 'Bebas Neue', body: 'Barlow', moods: ['event', 'sport', 'ticket'], google: 'Bebas+Neue:wght@400|Barlow:wght@400;600;700', tracking: '0.02em' },
  // ── Warm & humanist ───────────────────────────────────────────────
  { id: 'quicksand-nunito', display: 'Quicksand', body: 'Nunito', moods: ['playful', 'kids', 'friendly'], google: 'Quicksand:wght@600;700|Nunito:wght@400;600;700', tracking: '0' },
  { id: 'baloo-hind', display: 'Baloo 2', body: 'Hind', moods: ['playful', 'india', 'kids'], google: 'Baloo+2:wght@600;700;800|Hind:wght@400;600', tracking: '0' },
  { id: 'fredoka-nunito', display: 'Fredoka', body: 'Nunito Sans', moods: ['playful', 'toy', 'candy'], google: 'Fredoka:wght@500;600;700|Nunito+Sans:wght@400;600', tracking: '0' },
  { id: 'comfortaa-quicksand', display: 'Comfortaa', body: 'Quicksand', moods: ['soft', 'wellness', 'spa'], google: 'Comfortaa:wght@600;700|Quicksand:wght@400;600', tracking: '0' },
  { id: 'poppins-nunito', display: 'Poppins', body: 'Nunito Sans', moods: ['friendly', 'saas', 'india'], google: 'Poppins:wght@600;700;800|Nunito+Sans:wght@400;600;700', tracking: '0' },
  { id: 'cabin-rubik', display: 'Cabin', body: 'Rubik', moods: ['community', 'local', 'warm'], google: 'Cabin:wght@600;700|Rubik:wght@400;500;600', tracking: '0' },
  // ── Luxury & premium ──────────────────────────────────────────────
  { id: 'marcellus-jost', display: 'Marcellus', body: 'Jost', moods: ['luxe', 'hotel', 'premium'], google: 'Marcellus:wght@400|Jost:wght@400;500;600', tracking: '0.01em' },
  { id: 'cormorant-avenir', display: 'Cormorant', body: 'Avenir Next', moods: ['luxe', 'spa', 'jewelry'], google: 'Cormorant:wght@500;600;700|Jost:wght@400;500;600', tracking: '0' },
  { id: 'italiana-mulish', display: 'Italiana', body: 'Mulish', moods: ['luxe', 'fashion', 'atelier'], google: 'Italiana:wght@400|Mulish:wght@400;600', tracking: '0.04em' },
  { id: 'bodoni-lato', display: 'Bodoni Moda', body: 'Lato', moods: ['luxe', 'magazine', 'fashion'], google: 'Bodoni+Moda:opsz,wght@6..96,500;6..96,700|Lato:wght@400;700', tracking: '-0.005em' },
  { id: 'gilda-jost', display: 'Gilda Display', body: 'Jost', moods: ['luxe', 'wedding', 'event'], google: 'Gilda+Display:wght@400|Jost:wght@400;500', tracking: '0' },
  // ── Tech / mono accents ───────────────────────────────────────────
  { id: 'ibmplexmono-ibmplexsans', display: 'IBM Plex Mono', body: 'IBM Plex Sans', moods: ['engineering', 'dev', 'data'], google: 'IBM+Plex+Mono:wght@500;600|IBM+Plex+Sans:wght@400;500;600', tracking: '-0.01em' },
  { id: 'jetbrains-inter', display: 'JetBrains Mono', body: 'Inter', moods: ['dev', 'tool', 'api'], google: 'JetBrains+Mono:wght@600;700|Inter:wght@400;500;600;700', tracking: '-0.01em' },
  { id: 'spacemono-worksans', display: 'Space Mono', body: 'Work Sans', moods: ['tech', 'research', 'report'], google: 'Space+Mono:wght@700|Work+Sans:wght@400;600;700', tracking: '0' },
  // ── Indian scripts & subcontinental brands ────────────────────────
  { id: 'tiro-inter', display: 'Tiro Devanagari Hindi', body: 'Inter', moods: ['india', 'hindi', 'culture'], google: 'Tiro+Devanagari+Hindi:wght@400|Inter:wght@400;600;700', tracking: '0' },
  { id: 'yantra-kalam', display: 'Yantramanav', body: 'Kalam', moods: ['india', 'handmade', 'market'], google: 'Yantramanav:wght@500;700|Kalam:wght@400;700', tracking: '0' },
  // ── Health / calm ─────────────────────────────────────────────────
  { id: 'lora-opensans', display: 'Lora', body: 'Open Sans', moods: ['health', 'clinic', 'care'], google: 'Lora:wght@500;600;700|Open+Sans:wght@400;600;700', tracking: '0' },
  { id: 'montserrat-merriweather', display: 'Montserrat', body: 'Merriweather', moods: ['trust', 'finance', 'insurance'], google: 'Montserrat:wght@600;700;800|Merriweather:wght@400;700', tracking: '0' },
  { id: 'raleway-lora', display: 'Raleway', body: 'Lora', moods: ['wellness', 'yoga', 'calm'], google: 'Raleway:wght@600;700;800|Lora:wght@400;500;600', tracking: '0.01em' },
  // ── Food & appetite ───────────────────────────────────────────────
  { id: 'youngserif-nunito', display: 'Young Serif', body: 'Nunito Sans', moods: ['food', 'restaurant', 'menu'], google: 'Young+Serif:wght@400|Nunito+Sans:wght@400;600;700', tracking: '0' },
  { id: 'gloock-inter', display: 'Gloock', body: 'Inter', moods: ['food', 'bistro', 'premium-menu'], google: 'Gloock:wght@400|Inter:wght@400;600', tracking: '0' },
  { id: 'marko-opensans', display: 'Marko One', body: 'Open Sans', moods: ['food', 'bakery', 'cafe'], google: 'Marko+One:wght@400|Open+Sans:wght@400;600', tracking: '0' },
];

const DNA_FONT_MOODS = {
  Ember: ['craft', 'food', 'warm', 'editorial'],
  Glacier: ['tech', 'saas', 'professional', 'grotesk'],
  Forest: ['editorial', 'health', 'care', 'craft'],
  Citrus: ['playful', 'friendly', 'startup'],
  Orchid: ['creative', 'art', 'bold', 'modern'],
  Rosewood: ['luxe', 'elegant', 'fashion'],
  Tide: ['wellness', 'calm', 'modern', 'clean'],
  'Ink & Gold': ['luxe', 'premium', 'jewelry'],
  Sandstone: ['craft', 'coffee', 'bakery', 'handmade'],
  'Coral Pop': ['playful', 'kids', 'social', 'sale'],
  'Olive Market': ['food', 'market', 'community', 'india'],
  Midnight: ['tech', 'bold', 'event', 'saas'],
};

/**
 * fontPairFor — deterministic pairing for THIS build. DNA family moods
 * rank first, theme refines, brief text can promote a matching mood
 * (e.g. "bakery" promotes food moods). Same inputs → same pairing;
 * different briefs → different voices.
 */
export function fontPairFor({ dnaName = '', theme = '', brief = '', kind = '', seed = 0 } = {}) {
  const text = `${brief} ${theme} ${kind}`.toLowerCase();
  const scored = FONT_PAIRINGS.map((p, i) => {
    let score = 0;
    for (const m of p.moods) if (text.includes(m)) score += 4;
    for (const m of DNA_FONT_MOODS[dnaName] || []) if (p.moods.includes(m)) score += 3;
    if (String(theme).toLowerCase() === 'editorial' && p.moods.includes('editorial')) score += 2;
    if (String(theme).toLowerCase() === 'luxe' && p.moods.includes('luxe')) score += 2;
    if (String(theme).toLowerCase() === 'onyx' && p.moods.includes('tech')) score += 1;
    score += (i % 3) * 0.1 + (seed % 7) * 0.01; // tiny deterministic spread
    return { p, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].p;
}

/* ════════════════════════════════════════════════════════════════════
 * 3. KNOWLEDGE PACKS — senior rule cards per discipline
 * ════════════════════════════════════════════════════════════════════ */

/** CSS GLOBAL — how a professional global stylesheet is architected. */
export function cssGlobalPack() {
  return `CSS GLOBAL LAW (how the global layer is architected):
• Tokens first: every decision is a custom property (--bg, --surface, --ink, --muted, --accent, --accent2, --border, --r, --maxw, spacing --sp1..--sp6, type steps --step-0..--step-5, durations --dur-1/2, --ease-out). Sections consume tokens; they never hardcode colors or sizes.
• Fluid everything: type via clamp() steps; section padding via clamp(48px, 8vw, 96px); never fixed px type.
• Grid systems: .wrap max-width container; bento grids use grid-template-columns:repeat(12,1fr) with spans; every grid collapses to 1 column under 760px. Prefer 12-col spans over uniform 3-col rows.
• Modern selectors: :has() for parent-reactive states, :is() to shorten lists, color-mix(in srgb, var(--accent) 16%, transparent) for tints — never precomputed hex tints.
• Layering: base → layout → components → utilities; z-scale only 3 levels (content < nav 900 < overlay 1000).
• Logical properties: margin-inline, padding-block, inset-inline — pages can be mirrored.
• States: :focus-visible rings (2px accent, 3px offset), :hover lifts 4-6px max, :active compresses scale .98. prefers-reduced-motion kills all motion.
• Print: @media print — hide nav/marquee/ambient, black on white, links print their href.`;
}

/** COLOR — the theory the Art Director and engineers apply. */
export function colorPack() {
  return `COLOR LAW (millions of palettes, one discipline):
• 60/30/10: ~60% background field, ~30% surface/card, ≤10% accent. The accent is ONE hue; accent2 only supports (gradients, highlights, marquee strokes). Never rainbow.
• Tints, not new colors: derive softer variants with color-mix() against bg/surface — a ramp token (--accent-300..800) already exists; use it instead of inventing hexes.
• Temperature: warm accent on cool-neutral field (and vice versa) reads premium; neutrals carry a WHISPER of the brand hue (4-10% saturation) so gray never looks dead.
• Contrast is math: ink≥7:1 on bg, muted≥4.5:1, accent≥3:1 for UI. The pipeline enforces it — pick hues close to passing, don't fight the gate.
• Dark themes elevate with lightness (surface > bg), never with gray text below #6b6b6b on black. Light themes darken text with hue-tinted ink, never pure #000.
• Emotion mapping: red-orange appetite/urgency; blue trust/tech; green growth/health; violet creative/luxury; gold exclusivity; teal calm/clinical; pink young/social. Choose by the emotion the AUDIENCE needs.`;
}

/** FONTS — usage rules for THIS build's chosen pairing. */
export function fontPack(pair) {
  if (!pair) return '';
  return `TYPOGRAPHY (this build's voice: ${pair.display} × ${pair.body}):
• ${pair.display} is the display voice — headlines, nav brand, stats, kickers. Weight 600-800, letter-spacing ${pair.tracking}, line-height 1.05-1.15.
• ${pair.body} is the workhorse — body, buttons, forms, captions. Weight 400/600, line-height 1.6+.
• Never a third family. Numerals in stats get font-variant-numeric: tabular-nums.
• Scale by ratio (~1.25 classic, ~1.4 dramatic): --step tokens already encode it; never arbitrary sizes.
• Optical discipline: measure 60-70ch for paragraphs; headline length ≤ 9 words; uppercase only for kickers/overlines (letter-spacing +0.14em).`;
}

/** MOTION — choreography grammar scaled by intensity. */
export function motionPack(intensity = 'balanced') {
  const level = intensity === 'bold' ? 'BOLD' : intensity === 'calm' ? 'CALM' : 'BALANCED';
  return `MOTION CHOREOGRAPHY (${level}):
• Grammar: entrances rise+unblur with stagger 60-120ms; exits are quick fades (150ms); ambient loops SLOW (14s+); interactions respond <120ms.
• Timing sheet: 0ms content paints → 80ms hero headline → 170ms sub+CTA → 260ms badges/art → 400ms+ scroll sections as they intersect (data-rev handles this — trust the global layer, add data-rev-delay="1..4" to stagger siblings).
• ${level === 'CALM' ? 'Fades and 8px rises only. No ambient loops beyond one slow texture.' : level === 'BOLD' ? 'Full vocabulary: floaty ambient art, sheen sweeps, marquee band, count-up stats, hover tilt ≤2deg. Two springs max.' : 'Reveals + one ambient element (float or sheen) + hover lifts.'}
• Only transform/opacity/filter animate (GPU-safe); never width/height/top/left.
• prefers-reduced-motion: everything static (the global layer already handles it — never fight it).`;
}

/** WIRING — structure contracts the global behavior layer attaches to. */
export function wiringPack() {
  return `WIRING CONTRACT (the page has a global behavior layer — build the STRUCTURE with these exact hooks, never a <script>):
• Tabs: nav as <div class="tabs" role="tablist"><button data-tab="id" aria-selected="true|false">…</button></div>, panels as <div data-panel="id" hidden>…</div>. The layer toggles hidden + aria-selected.
• Accordion: <details class="acc"><summary>Question</summary><div class="acc-body">…</div></details> — styled natively; add data-single on a wrapper when only one may open.
• Modal/dialog: <button data-dialog="id"> + <dialog id="id">…</dialog> — the layer wires showModal/close/Escape.
• Carousel: <div class="snap-row"> with children; scroll-snap comes from the global CSS; optional dots via <div class="snap-dots" data-for="sec-id">.
• Forms: <form data-validate> — fields with required + type=email/tel get inline errors (the layer injects <p class="field-err" role="alert">) and a success state on submit; add data-success="Thank you message".
• Counters: <span data-count="1200">0</span> with suffix OUTSIDE the span (the layer counts up on reveal).
• Lightbox: any <img class="ph"> opens in a dialog automatically.
• Copy buttons: <button data-copy="text or #selector">.
• Pricing toggle: <label class="switch"><input type="checkbox" data-price-toggle></label> + elements carrying data-monthly="₹499" data-yearly="₹4990".
RULES: no inline on* handlers, no remote libraries, semantic buttons/links only. The behavior layer ships with the page.`;
}

/** POLICY — what the law and trust expect the page to carry. */
export function policyPack(needs = {}) {
  const bits = [];
  if (needs.cookieBand) bits.push('A cookie/consent note is REQUIRED (the assembler attaches a dismissible band — do not build your own).');
  if (needs.collectsData) bits.push('The page collects personal data (forms/booking/newsletter): include a one-line privacy promise near the form ("We use your details only to respond — never sold, never spammed") and a Privacy link in the footer.');
  if (needs.legalLinks) bits.push('Footer carries Privacy · Terms links (assembler renders the legal row; sections must not invent their own legal pages).');
  if (needs.commerce) bits.push('Commerce: show price currency clearly, honest offer terms (valid-until), no dark patterns (no fake countdowns, no hidden fees), refund/contact line near CTA.');
  if (needs.health) bits.push('Health claims: add a care disclaimer ("Consult a professional — this page is informational") — the assembler can host it in the footer note.');
  if (needs.finance) bits.push('Finance/investment content: neutral, no guaranteed-return claims, add "Investments carry risk" footer note.');
  if (needs.kids) bits.push('Children audience: no data collection beyond first name, playful but safe wording, parental-contact path visible.');
  if (needs.testimonials) bits.push('Testimonials must carry a real-looking name + role + context; never invent celebrities or certifications.');
  return bits.length ? `POLICY & TRUST (compliance is design):\n• ${bits.join('\n• ')}` : '';
}

/** HOSTING — the rules a shipped page must satisfy (SEO/meta/perf). */
export function hostingPack(kind = 'landing') {
  return `HOSTING RULES (the page ships to a public URL — make it rank and load):
• Meta completeness is assembled for you (title, description, theme-color, OG/Twitter, canonical, favicon, JSON-LD) — write copy that FITS: title ≤60 chars, meta-description-worthy sub (140-160 chars), one h1 only.
• JSON-LD: the assembler emits ${kind === 'event' ? 'Event schema (fill dates from the offer/event copy)' : kind === 'portfolio' ? 'Person/Organization schema' : 'LocalBusiness/Organization schema'} — keep name/city/service lines factual in the copy so the structured data is true.
• Images: loading="lazy" decoding="async" width/height set, explicit alt text describing the SCENE (not "image of"). The .ph class already handles treatment.
• Fonts arrive preconnected with display=swap — never import fonts in section CSS.
• Performance budget: a section ≤ ~9KB HTML+CSS; no render-blocking anything; JS is progressive enhancement only (page must read perfectly with JS off).
• Semantics: <section id="sec-…"> with aria-labelledby where a heading exists; nav landmarks come from the assembler.`;
}

/** FULL-STACK — data modeling & app engineering for webapp builds. */
export function fullstackPack() {
  return `FULL-STACK LAW (web apps):
• Data model first: name entities and fields BEFORE coding (e.g. Task{id,title,done,createdAt}); persist ONE versioned key in localStorage ("app.v1") with a tiny migrate() guard.
• Offline-first: every action works with zero network; state renders from the store; the store is the single source of truth (load → render → mutate → save → render).
• Sync-ready shape: keep records as arrays of flat objects with ISO dates so a future backend (Supabase/Firebase/D1) can mirror the schema 1:1.
• State patterns: derived values are computed in render(), never stored twice; filters are view state, not data.
• CRUD + undo: destructive actions get a 3s undo toast instead of confirm().
• Empty/loading/error states are DESIGNED: an empty list teaches (one line + a big action), never a blank pane.`;
}

/** LANGUAGES — coding-language expertise the team writes with. */
export function languagesPack() {
  return `LANGUAGES & STACKS (choose like an engineer):
• Client pages/apps TODAY: semantic HTML5 + modern CSS (custom properties, color-mix, :has, clamp, container queries) + vanilla ES2020+ JS (const/let, arrow fns, template literals, IntersectionObserver, <dialog>). No frameworks in single-file artifacts — zero build step, instant load.
• Flutter/Dart powers the Nebula app itself (riverpod state, screens in lib/features). React/Next is the choice when a client needs an SSR site repo; Node/Workers (this runtime) for APIs; SQL (D1) for relational CRM data; R2 for blobs.
• When the brief says "app", ship a single-file web app (works offline, installable via manifest later) — not a fake "download my app" page.
• Write code a senior reviewer respects: small pure functions, one responsibility per module (IIFE per feature), named constants, no magic numbers, guard clauses first.`;
}

/* ════════════════════════════════════════════════════════════════════
 * 4. POLICY SENSE — deterministic detector
 * ════════════════════════════════════════════════════════════════════ */

const has = (text, re) => re.test(text);

/**
 * policyNeeds — read the brief like a compliance officer.
 * @returns {collectsData, commerce, event, health, finance, kids,
 *           testimonials, cookieBand, legalLinks, disclaimer}
 */
export function policyNeeds(brief = '', kind = '') {
  const t = String(brief || '').toLowerCase();
  const collectsData = has(t, /\b(contact|enquiry|inquiry|form|booking|book|appointment|reserv|newsletter|subscribe|sign\s?up|register|registrat|lead|callback|quote|order|checkout)\b/);
  const commerce = has(t, /\b(sale|discount|offer|price|pricing|buy|shop|store|order|cart|checkout|payment|upi|gpay|emi|rs\.?|₹|percent|%\s?off|deal)\b/);
  const event = kind === 'event' || has(t, /\b(event|conference|wedding|concert|workshop|seminar|meetup|festival|exhibition|launch)\b/);
  const health = has(t, /\b(clinic|doctor|hospital|health|medical|therapy|yoga|ayurved|dental|skin|hair|fitness|gym|nutrition|diet)\b/);
  const finance = has(t, /\b(invest|mutual|stock|trading|loan|insurance|crypto|finance|wealth|tax|gst)\b/);
  const kids = has(t, /\b(kids|children|child|school|tuition|toy|daycare|preschool)\b/);
  const testimonials = has(t, /\b(testimonials?|reviews?|ratings?|what .* say|loved by)/) || kind === 'portfolio';
  const legalLinks = collectsData || commerce;
  const cookieBand = false; // v12.1: only when a backend/cookie surface exists — single-file pages set no cookies
  const disclaimer = health || finance;
  return { collectsData, commerce, event, health, finance, kids, testimonials, cookieBand, legalLinks, disclaimer };
}

/* ════════════════════════════════════════════════════════════════════
 * 5. ASSEMBLY — the bounded prompt block
 * ════════════════════════════════════════════════════════════════════ */

/**
 * masteryBlock — one bounded prompt block from selected packs.
 * Packs are joined with hard budget discipline (Sarvam-safe).
 */
export function masteryBlock(packs = [], { maxChars = 2400 } = {}) {
  const parts = [];
  let used = 0;
  for (const p of packs) {
    const s = String(p || '').trim();
    if (!s) continue;
    if (used + s.length > maxChars) continue;
    parts.push(s);
    used += s.length + 2;
  }
  return parts.join('\n\n');
}
