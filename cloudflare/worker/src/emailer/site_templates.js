/**
 * SITE TEMPLATES v3 — "ALIVE" — the deterministic render engine behind
 * Studio builds.
 *
 * WHY THIS EXISTS: a one-shot "write me a website" LLM call inside a
 * ~2k-token completion budget produced the worst failure in the Studio —
 * markdown-fenced fragments, truncated <html>, and model chatter saved
 * AS the website. So the pipeline flipped:
 *
 *   • the LLM THINKS (design brief) and WRITES (copy JSON) in small calls
 *   • THIS ENGINE RENDERS — hand-built, genuinely premium CSS/HTML that
 *     cannot truncate, cannot leak fences, cannot forget a viewport
 *
 * v3 ("ALIVE") closes the gap the user called out — "the designs have no
 * life" — at the engine level:
 *   • REAL TYPOGRAPHY: Google Fonts pairings per design system (Fraunces,
 *     Space Grotesk, Cormorant, Syne, Inter, JetBrains Mono) — the #1
 *     thing that separates premium sites from templates.
 *   • ART, NOT EMOJI: deterministic inline-SVG compositions (rings,
 *     waves, mesh, grid, blocks) — every page gets real art direction.
 *   • MOTION EVERYWHERE: staggered blur-in reveals, drifting mesh orbs,
 *     marquee band, animated counters, shine buttons, cursor glow,
 *     scroll progress — all disabled under prefers-reduced-motion.
 *   • TEXTURE: film-grain overlay (feTurbulence) so flat blacks look
 *     printed, not rendered.
 *   • TWO NEW DESIGN SYSTEMS: onyx (deep-black minimal — the owner's
 *     taste) and neo (neo-brutalist poster energy). Eight total.
 *   • NEW LAYOUTS: split hero + editorial hero, bento feature grids,
 *     giant-footer wordmark.
 *
 * Everything the LLM contributed is ESCAPED here — model output never
 * reaches the page as raw markup.
 */

import { esc, safeHref } from './htmlutil.js';

/* ══ Palette / font helpers ══════════════════════════════════════════ */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function hex(color, fallback) {
  const c = String(color || '').trim();
  if (HEX_RE.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
  return fallback;
}

/** Perceived luminance 0..1 — drives readable on-accent text. */
export function lum(c) {
  const n = parseInt(hex(c, '#000000').slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** Darken / lighten a hex color by amt (0..1). */
export function shade(c, amt) {
  const n = parseInt(hex(c, '#000000').slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`;
}

export function mix(a, b, t) {
  const x = parseInt(hex(a, '#000000').slice(1), 16);
  const y = parseInt(hex(b, '#ffffff').slice(1), 16);
  const f = (p, q) => Math.round(p + (q - p) * t);
  return `#${((f(x >> 16, y >> 16) << 16) | (f((x >> 8) & 255, (y >> 8) & 255) << 8) | f(x & 255, y & 255)).toString(16).padStart(6, '0')}`;
}

/* ══ Typography — real Google-Fonts pairings ═════════════════════════ */

export const FONT_STACKS = {
  modern: {
    css: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
    google: 'Inter:wght@400;500;600;700;800',
  },
  grotesk: {
    css: `'Space Grotesk', 'Inter', -apple-system, 'Segoe UI', sans-serif`,
    google: 'Space+Grotesk:wght@400;500;600;700',
  },
  serif: {
    css: `'Fraunces', Georgia, 'Times New Roman', serif`,
    google: 'Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600',
  },
  luxe: {
    css: `'Cormorant Garamond', Georgia, 'Times New Roman', serif`,
    google: 'Cormorant+Garamond:wght@400;500;600;700',
  },
  syne: {
    css: `'Syne', 'Inter', -apple-system, 'Segoe UI', sans-serif`,
    google: 'Syne:wght@500;600;700;800',
  },
  rounded: {
    css: `'DM Sans', ui-rounded, 'SF Pro Rounded', -apple-system, 'Segoe UI', sans-serif`,
    google: 'DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700',
  },
  mono: {
    css: `'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace`,
    google: 'JetBrains+Mono:wght@400;500;600;700',
  },
};

/** <link> tags for the chosen font (preconnect + css2). */
export function fontLinks(fontKey) {
  const f = FONT_STACKS[fontKey] || FONT_STACKS.modern;
  if (!f.google) return '';
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${f.google}&display=swap">`;
}

export const DISPLAY_OF_FONT = {
  modern: `'Inter', sans-serif`,
  grotesk: `'Space Grotesk', sans-serif`,
  serif: `'Fraunces', Georgia, serif`,
  luxe: `'Cormorant Garamond', Georgia, serif`,
  syne: `'Syne', sans-serif`,
  rounded: `'DM Sans', sans-serif`,
  mono: `'JetBrains Mono', monospace`,
};

/* ══ Theme presets — each a complete, opinionated design system ══════ */

export const THEMES = {
  onyx: {
    label: 'Onyx — deep black minimal',
    vars: (p) => ({
      bg: hex(p.bg, '#050505'), surface: hex(p.surface, '#0c0c0c'), card: hex(p.card, '#101010'),
      ink: hex(p.ink, '#f5f5f5'), muted: hex(p.muted, '#8f8f8f'), accent: hex(p.accent, '#ffffff'), accent2: hex(p.accent2, '#8f8f8f'),
      onAccent: lum(hex(p.accent, '#ffffff')) > 0.62 ? '#0a0a0a' : '#ffffff',
      border: 'rgba(255,255,255,.10)', heroStyle: 'onyx', navGlass: true,
    }),
  },
  aurora: {
    label: 'Aurora glass',
    vars: (p) => ({
      bg: hex(p.bg, '#0a0d18'), surface: hex(p.surface, '#111527'), card: mix(hex(p.surface, '#111527'), '#ffffff', 0.04),
      ink: hex(p.ink, '#eef1fb'), muted: hex(p.muted, '#98a1c0'), accent: hex(p.accent, '#7c8cff'), accent2: hex(p.accent2, '#3dd8d8'),
      onAccent: lum(hex(p.accent, '#7c8cff')) > 0.62 ? '#0a0d18' : '#ffffff',
      border: 'rgba(255,255,255,.09)', heroStyle: 'glow', navGlass: true,
    }),
  },
  luxe: {
    label: 'Luxe dark',
    vars: (p) => ({
      bg: hex(p.bg, '#0c0b09'), surface: hex(p.surface, '#14120e'), card: mix(hex(p.surface, '#14120e'), '#ffffff', 0.035),
      ink: hex(p.ink, '#f3ede2'), muted: hex(p.muted, '#a89f8d'), accent: hex(p.accent, '#d3aa5e'), accent2: hex(p.accent2, '#8f7bd8'),
      onAccent: '#14120e',
      border: 'rgba(211,170,94,.22)', heroStyle: 'serif', navGlass: true,
    }),
  },
  editorial: {
    label: 'Editorial',
    vars: (p) => ({
      bg: hex(p.bg, '#faf7f1'), surface: hex(p.surface, '#ffffff'), card: '#ffffff',
      ink: hex(p.ink, '#191714'), muted: hex(p.muted, '#6f6a61'), accent: hex(p.accent, '#c2492e'), accent2: hex(p.accent2, '#1f6f5b'),
      onAccent: '#ffffff', border: 'rgba(25,23,20,.12)', heroStyle: 'serif', navGlass: false,
    }),
  },
  swiss: {
    label: 'Swiss minimal',
    vars: (p) => ({
      bg: hex(p.bg, '#ffffff'), surface: hex(p.surface, '#f6f7f9'), card: '#ffffff',
      ink: hex(p.ink, '#101114'), muted: hex(p.muted, '#5d6470'), accent: hex(p.accent, '#2454ff'), accent2: hex(p.accent2, '#e6412c'),
      onAccent: '#ffffff', border: 'rgba(16,17,20,.1)', heroStyle: 'grid', navGlass: false,
    }),
  },
  festive: {
    label: 'Festive bold',
    vars: (p) => ({
      bg: hex(p.bg, '#160b2e'), surface: hex(p.surface, '#221244'), card: mix(hex(p.surface, '#221244'), '#ffffff', 0.06),
      ink: hex(p.ink, '#fdf6ff'), muted: hex(p.muted, '#b9a6e8'), accent: hex(p.accent, '#ffb03a'), accent2: hex(p.accent2, '#ff5c8a'),
      onAccent: '#221244', border: 'rgba(255,255,255,.12)', heroStyle: 'party', navGlass: true,
    }),
  },
  playful: {
    label: 'Playful pop',
    vars: (p) => ({
      bg: hex(p.bg, '#fff8ef'), surface: hex(p.surface, '#ffffff'), card: '#ffffff',
      ink: hex(p.ink, '#22243a'), muted: hex(p.muted, '#6f7290'), accent: hex(p.accent, '#ff6b6b'), accent2: hex(p.accent2, '#12b5a5'),
      onAccent: '#ffffff', border: 'rgba(34,36,58,.09)', heroStyle: 'party', navGlass: false,
    }),
  },
  neo: {
    label: 'Neo poster',
    vars: (p) => ({
      bg: hex(p.bg, '#f4efe6'), surface: hex(p.surface, '#fffdf7'), card: '#fffdf7',
      ink: hex(p.ink, '#141414'), muted: hex(p.muted, '#5c584f'), accent: hex(p.accent, '#ff4d00'), accent2: hex(p.accent2, '#141414'),
      onAccent: '#ffffff', border: 'rgba(20,20,20,.85)', heroStyle: 'neo', navGlass: false,
    }),
  },
};

export function resolveTheme(name, fallback) {
  return THEMES[String(name || '').toLowerCase()] ? String(name).toLowerCase() : fallback;
}

/** Map a human style hint to a theme. */
export function themeForStyleHint(style, kind) {
  const s = String(style || '').toLowerCase();
  if (/onyx|black|mono|minimal dark|deep black/.test(s)) return 'onyx';
  if (/dark|premium|luxur|glow/.test(s)) return 'aurora';
  if (/luxe|gold|elegan/.test(s)) return 'luxe';
  if (/editorial|magazine|serif/.test(s)) return 'editorial';
  if (/minimal|clean|swiss|simple/.test(s)) return 'swiss';
  if (/festiv|bold|sale|diwali|offer|energ/.test(s)) return 'festive';
  if (/playful|colorful|fun|friendly/.test(s)) return 'playful';
  if (/brutal|poster|street|loud|urban/.test(s)) return 'neo';
  if (kind === 'promo') return 'festive';
  if (kind === 'portfolio') return 'editorial';
  if (kind === 'report') return 'swiss';
  if (kind === 'webapp' || kind === 'event') return 'aurora';
  return 'aurora';
}

const DEFAULT_PALETTES = {
  onyx: { accent: '#ffffff', accent2: '#8f8f8f' },
  aurora: { accent: '#7c8cff', accent2: '#3dd8d8' },
  luxe: { accent: '#d3aa5e', accent2: '#8f7bd8' },
  editorial: { accent: '#c2492e', accent2: '#1f6f5b' },
  swiss: { accent: '#2454ff', accent2: '#e6412c' },
  festive: { accent: '#ffb03a', accent2: '#ff5c8a' },
  playful: { accent: '#ff6b6b', accent2: '#12b5a5' },
  neo: { accent: '#ff4d00', accent2: '#141414' },
};

/** Theme → default art motif + hero layout (the design director can override). */
const THEME_ART = {
  onyx: { art: 'rings', hero: 'split' },
  aurora: { art: 'mesh', hero: 'centered' },
  luxe: { art: 'waves', hero: 'editorial' },
  editorial: { art: 'blocks', hero: 'editorial' },
  swiss: { art: 'grid', hero: 'split' },
  festive: { art: 'mesh', hero: 'centered' },
  playful: { art: 'blocks', hero: 'centered' },
  neo: { art: 'blocks', hero: 'editorial' },
};

/** Normalize a design spec: valid theme, safe palette, sane fonts. */
export function normalizeDesign(design, { kind, styleHint, brandColor } = {}) {
  const fallbackTheme = themeForStyleHint(styleHint, kind);
  const theme = resolveTheme(design?.theme, fallbackTheme);
  const preset = THEMES[theme];
  const dp = DEFAULT_PALETTES[theme];
  const art = ['mesh', 'rings', 'waves', 'grid', 'blocks'].includes(String(design?.art))
    ? String(design.art)
    : THEME_ART[theme].art;
  const hero = ['centered', 'split', 'editorial'].includes(String(design?.hero))
    ? String(design.hero)
    : THEME_ART[theme].hero;
  return {
    theme,
    themeLabel: preset.label,
    palette: {
      bg: hex(design?.palette?.bg, ''),
      surface: hex(design?.palette?.surface, ''),
      ink: hex(design?.palette?.ink, ''),
      muted: hex(design?.palette?.muted, ''),
      // Brand color wins for the accent only when the caller supplied one
      // AND the theme is not onyx (onyx stays strictly monochrome).
      accent: theme === 'onyx' && !design?.palette?.accent
        ? dp.accent
        : hex(design?.palette?.accent, brandColor && HEX_RE.test(brandColor) ? brandColor : dp.accent),
      accent2: hex(design?.palette?.accent2, dp.accent2),
    },
    font: FONT_STACKS[design?.font] ? String(design.font)
      : theme === 'editorial' ? 'serif'
      : theme === 'luxe' ? 'luxe'
      : theme === 'onyx' ? 'grotesk'
      : theme === 'neo' ? 'syne'
      : theme === 'festive' ? 'syne'
      : theme === 'playful' ? 'rounded'
      : 'modern',
    voice: String(design?.voice || '').slice(0, 300),
    audience: String(design?.audience || '').slice(0, 300),
    art,
    hero,
    radius: theme === 'neo' ? 6 : theme === 'playful' ? 22 : theme === 'swiss' || theme === 'onyx' ? 12 : 18,
  };
}

/* ══ Base CSS — shared component library, themed by variables ════════ */

function baseCss(v, d) {
  const body = (FONT_STACKS[d.font] || FONT_STACKS.modern).css;
  const display = DISPLAY_OF_FONT[d.font] || body;
  const r = d.radius;
  const isNeo = d.theme === 'neo';
  const isOnyx = d.theme === 'onyx';
  return `
:root{--bg:${v.bg};--surface:${v.surface};--card:${v.card};--ink:${v.ink};--muted:${v.muted};--accent:${v.accent};--accent2:${v.accent2};--on-accent:${v.onAccent};--border:${v.border};--r:${r}px;--maxw:1120px;--font:${body};--display:${display}}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--font);background:var(--bg);color:var(--ink);line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
/* film grain — flat blacks read printed, not rendered */
body::after{content:"";position:fixed;inset:-50%;z-index:2000;pointer-events:none;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
img,svg{max-width:100%}
a{color:inherit;text-decoration:none}
::selection{background:var(--accent);color:var(--on-accent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
::-webkit-scrollbar{width:10px}::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--muted) 35%,transparent);border-radius:5px;border:2px solid var(--bg)}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
h1,h2,h3,.disp{font-family:var(--display);line-height:1.08;letter-spacing:-.02em}
/* cursor glow — desktop only, the page answers the hand */
#cursor-glow{position:fixed;width:520px;height:520px;border-radius:50%;pointer-events:none;z-index:1;translate:-50% -50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 7%,transparent),transparent 65%);opacity:0;transition:opacity .4s ease}
@media(pointer:fine){#cursor-glow{opacity:1}}
/* ── type helpers ── */
.kicker{display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.kicker::before{content:"";width:26px;height:2px;background:var(--accent)}
.mono-label{font-family:var(--font);font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
/* ── buttons ── */
.btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:9px;font-family:inherit;font-size:15px;font-weight:600;padding:15px 30px;border-radius:999px;border:0;cursor:pointer;transition:transform .2s cubic-bezier(.2,.9,.3,1.4),box-shadow .2s ease,background .2s ease,color .2s ease;white-space:nowrap;overflow:hidden}
.btn.primary{background:var(--accent);color:var(--on-accent);box-shadow:0 12px 30px color-mix(in srgb,var(--accent) 30%,transparent)}
.btn.primary::after{content:"";position:absolute;top:0;left:-80%;width:50%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-20deg);animation:shine 4.5s ease-in-out infinite}
@keyframes shine{0%,60%{left:-80%}90%,100%{left:130%}}
.btn.primary:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 18px 40px color-mix(in srgb,var(--accent) 42%,transparent)}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--border)}
.btn.ghost:hover{border-color:var(--accent);color:var(--accent);transform:translateY(-2px)}
.btn.small{padding:10px 20px;font-size:13px}
/* ── nav ── */
.nav{position:sticky;top:0;z-index:50;padding:15px 0;transition:background .25s ease,box-shadow .25s ease,backdrop-filter .25s ease}
.nav.scrolled{background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3);box-shadow:0 1px 0 var(--border)}
.nav .wrap{display:flex;align-items:center;gap:20px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16.5px;letter-spacing:-.01em}
.brand .dot{width:31px;height:31px;border-radius:${isNeo ? '4px' : '10px'};background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-size:15px;${isNeo ? 'border:2px solid var(--ink);box-shadow:3px 3px 0 var(--ink)' : ''}}
.nav-links{display:flex;gap:26px;margin-left:auto;font-size:14px;color:var(--muted);font-weight:600}
.nav-links a{position:relative;padding:4px 0}
.nav-links a::after{content:"";position:absolute;left:0;bottom:0;width:100%;height:1.5px;background:var(--accent);transform:scaleX(0);transform-origin:right;transition:transform .3s cubic-bezier(.4,0,.2,1)}
.nav-links a:hover{color:var(--ink)}
.nav-links a:hover::after{transform:scaleX(1);transform-origin:left}
.nav .btn{margin-left:8px}
.burger{display:none;margin-left:auto;background:none;border:0;color:var(--ink);font-size:24px;cursor:pointer;line-height:1}
.mobile-menu{display:none;flex-direction:column;gap:4px;padding:10px 24px 18px;background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:blur(16px)}
.mobile-menu a{padding:12px 4px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)}
.mobile-menu a:last-child{border:0}
.mobile-menu.open{display:flex}
/* ── hero (3 layouts) ── */
.hero{position:relative;padding:96px 0 88px;overflow:hidden}
.hero.centered{text-align:center}
.hero h1{font-size:clamp(36px,6.6vw,68px);font-weight:${isOnyx || d.font === 'grotesk' ? 700 : 800};max-width:840px;margin:0 auto 20px}
.hero:not(.centered) h1{margin:0 0 20px}
.hero .sub{font-size:clamp(16px,2.2vw,19px);color:var(--muted);max-width:640px;margin:0 auto 34px}
.hero:not(.centered) .sub{margin:0 0 34px}
.hero .ctas{display:flex;gap:12px;justify-content:${'centered' ? 'center' : 'inherit'};flex-wrap:wrap}
.hero.split .wrap{display:grid;grid-template-columns:1.08fr .92fr;gap:56px;align-items:center;text-align:left}
.hero.split .ctas{justify-content:flex-start}
.hero.split .hero-badges{justify-content:flex-start}
.hero-editorial-rule{display:flex;align-items:center;gap:14px;margin-bottom:26px}
.hero-editorial-rule .line{height:1px;flex:1;background:var(--border)}
.hero-editorial-rule .idx{font-family:var(--font);font-size:12px;letter-spacing:.2em;color:var(--muted)}
.hero-editorial-meta{display:flex;gap:22px;flex-wrap:wrap;margin-top:38px;padding-top:22px;border-top:1px solid var(--border);font-size:13px;color:var(--muted)}
.hero-editorial-meta b{color:var(--ink)}
.grad-text{background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero-badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:36px}
.hero-badges span{font-size:12.5px;font-weight:600;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:8px 15px;background:color-mix(in srgb,var(--surface) 60%,transparent)}
/* drifting mesh orbs (background life) */
.orb{position:absolute;border-radius:50%;filter:blur(100px);opacity:.45;pointer-events:none;z-index:0;animation:drift 16s ease-in-out infinite alternate}
.orb.a{width:460px;height:460px;background:color-mix(in srgb,var(--accent) 42%,transparent);top:-140px;left:-100px}
.orb.b{width:400px;height:400px;background:color-mix(in srgb,var(--accent2) 36%,transparent);bottom:-160px;right:-80px;animation-delay:-8s}
@keyframes drift{from{translate:0 0;scale:1}to{translate:36px 26px;scale:1.07}}
.hero .wrap{position:relative;z-index:2}
.hero-art{position:relative;border-radius:calc(var(--r) + 8px);overflow:hidden;border:1px solid var(--border);background:color-mix(in srgb,var(--surface) 80%,var(--bg));min-height:320px;display:grid;place-items:center;${isNeo ? 'border:2.5px solid var(--ink);box-shadow:8px 8px 0 var(--ink);' : ''}}
.hero-art svg{width:100%;height:100%;display:block}
/* ── marquee band ── */
.marquee{overflow:hidden;border-block:1px solid var(--border);padding:18px 0;display:flex;gap:0;user-select:none}
.marquee .track{display:flex;gap:54px;flex:0 0 auto;align-items:center;animation:marq 26s linear infinite;padding-right:54px}
.marquee:hover .track{animation-play-state:paused}
.marquee span{display:inline-flex;align-items:center;gap:54px;font-family:var(--display);font-size:15px;font-weight:600;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;white-space:nowrap}
.marquee span::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:.6}
@keyframes marq{to{transform:translateX(-100%)}}
/* ── sections ── */
section.block{padding:84px 0;position:relative}
section.block.alt{background:color-mix(in srgb,var(--surface) 55%,transparent)}
.sec-head{max-width:680px;margin:0 auto 52px;text-align:center}
.sec-head h2{font-size:clamp(27px,4.2vw,42px);margin-bottom:14px}
.sec-head p{color:var(--muted);font-size:16.5px}
/* ── grids & cards ── */
.grid{display:grid;gap:18px}
.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
/* bento — asymmetric, editorial */
.bento{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.bento .card:first-child{grid-column:span 2;grid-row:span 1}
.bento .card:first-child h3{font-size:clamp(20px,2.6vw,26px)}
@media(max-width:760px){.bento{grid-template-columns:1fr}.bento .card:first-child{grid-column:auto}}
.card{position:relative;background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:28px;transition:transform .25s cubic-bezier(.2,.7,.3,1),box-shadow .25s ease,border-color .25s ease;overflow:hidden}
.card::before{content:"";position:absolute;top:0;left:8%;right:8%;height:1px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--accent) 55%,transparent),transparent);opacity:0;transition:opacity .25s ease}
.card:hover{transform:translateY(-5px);box-shadow:0 22px 44px color-mix(in srgb,var(--ink) 10%,transparent);border-color:color-mix(in srgb,var(--accent) 40%,var(--border))}
.card:hover::before{opacity:1}
${isNeo ? `.card:hover{box-shadow:6px 6px 0 var(--ink);transform:translate(-3px,-3px)}` : ''}
.card .ico{width:48px;height:48px;border-radius:14px;background:color-mix(in srgb,var(--accent) 13%,transparent);color:var(--accent);display:grid;place-items:center;font-size:21px;margin-bottom:18px;border:1px solid color-mix(in srgb,var(--accent) 22%,transparent)}
.card h3{font-size:18px;margin-bottom:9px}
.card p{color:var(--muted);font-size:14.5px}
/* art panels (replaces emoji billboards) */
.art-panel{border-radius:var(--r);overflow:hidden;border:1px solid var(--border);background:color-mix(in srgb,var(--surface) 85%,var(--bg));display:grid;place-items:center;min-height:240px}
.art-panel svg{width:100%;height:100%}
/* stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.stat{text-align:center;padding:30px 12px;border-radius:var(--r);border:1px solid var(--border);background:color-mix(in srgb,var(--surface) 65%,transparent)}
.stat b{display:block;font-size:clamp(28px,4.4vw,40px);font-weight:800;background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums}
.stat span{color:var(--muted);font-size:13px;font-weight:600}
/* showcase split */
.split{display:grid;grid-template-columns:1.05fr .95fr;gap:52px;align-items:center}
.split h2{font-size:clamp(24px,3.6vw,36px);margin-bottom:14px}
.split p{color:var(--muted);margin-bottom:18px}
.ticks{list-style:none;display:grid;gap:12px}
.ticks li{display:flex;gap:12px;align-items:flex-start;font-size:15px}
.ticks li::before{content:"✓";flex:0 0 22px;height:22px;border-radius:50%;background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);display:grid;place-items:center;font-size:12px;font-weight:800;margin-top:2px}
/* work grid */
.work{border-radius:var(--r);overflow:hidden;border:1px solid var(--border);background:var(--card);transition:transform .25s cubic-bezier(.2,.7,.3,1),box-shadow .25s ease}
.work:hover{transform:translateY(-6px);box-shadow:0 24px 48px color-mix(in srgb,var(--ink) 11%,transparent)}
.work .art{height:170px;display:grid;place-items:center;overflow:hidden;border-bottom:1px solid var(--border)}
.work .art svg{width:100%;height:100%;transition:scale .5s cubic-bezier(.2,.7,.3,1)}
.work:hover .art svg{scale:1.05}
.work .body{padding:18px 20px 22px}
.work .tag{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.work h3{font-size:17px;margin:7px 0 6px}
.work p{color:var(--muted);font-size:14px}
/* quote */
.quote{border-radius:var(--r);border:1px solid var(--border);background:var(--card);padding:32px;transition:transform .25s ease,border-color .25s ease}
.quote:hover{transform:translateY(-4px);border-color:color-mix(in srgb,var(--accent) 35%,var(--border))}
.quote .mark{font-size:44px;line-height:1;color:var(--accent);font-family:Georgia,serif}
.quote p{font-size:16.5px;margin:12px 0 18px;font-style:italic}
.quote .who{display:flex;align-items:center;gap:12px}
.quote .ava{width:42px;height:42px;border-radius:50%;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;font-weight:800;font-size:15px}
.quote .who b{display:block;font-size:14.5px}
.quote .who span{color:var(--muted);font-size:12.5px}
/* faq */
.faq{max-width:780px;margin:0 auto;display:grid;gap:12px}
.faq details{border:1px solid var(--border);border-radius:calc(var(--r) - 4px);background:var(--card);padding:0;overflow:hidden;transition:border-color .2s ease}
.faq details[open]{border-color:color-mix(in srgb,var(--accent) 40%,var(--border))}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:19px 24px;font-weight:600;font-size:15.5px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:22px;color:var(--accent);transition:transform .25s cubic-bezier(.2,.7,.3,1.3);font-weight:400}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq .a{padding:0 24px 22px;color:var(--muted);font-size:14.5px;max-width:64ch}
/* offer / countdown */
.offer-wrap{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:stretch}
.offer-card{border-radius:calc(var(--r) + 4px);padding:38px 32px;background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 20%,var(--surface)),color-mix(in srgb,var(--accent2) 16%,var(--surface)));border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));text-align:center;display:flex;flex-direction:column;justify-content:center}
${isNeo ? `.offer-card{border:2.5px solid var(--ink);box-shadow:8px 8px 0 var(--ink)}` : ''}
.offer-card .badge{display:inline-block;margin:0 auto 16px;background:var(--accent);color:var(--on-accent);font-weight:800;font-size:14px;letter-spacing:.06em;border-radius:999px;padding:9px 19px}
.offer-card .price{font-size:clamp(42px,7vw,60px);font-weight:800;line-height:1;font-family:var(--display)}
.offer-card .old{color:var(--muted);text-decoration:line-through;font-size:19px;margin-bottom:6px}
.offer-card .note{color:var(--muted);font-size:13px;margin-top:12px}
.count{display:flex;gap:10px;justify-content:center;margin:22px 0 4px}
.count .cell{min-width:66px;padding:13px 8px;border-radius:14px;background:color-mix(in srgb,var(--ink) 7%,transparent);border:1px solid var(--border)}
.count b{display:block;font-size:27px;font-weight:800;font-variant-numeric:tabular-nums}
.count span{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700}
/* agenda */
.agenda{max-width:740px;margin:0 auto;display:grid;gap:0}
.agenda .slot{display:grid;grid-template-columns:112px 1fr;gap:18px;padding:19px 0;border-bottom:1px dashed var(--border)}
.agenda .slot:last-child{border-bottom:0}
.agenda .time{font-weight:800;color:var(--accent);font-size:14px;font-variant-numeric:tabular-nums;padding-top:2px}
.agenda .what b{display:block;font-size:15.5px;margin-bottom:3px}
.agenda .what span{color:var(--muted);font-size:13.5px}
.date-card{display:inline-grid;grid-template-columns:auto auto;gap:2px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px 26px;margin-bottom:28px;text-align:left}
.date-card .d{font-size:30px;font-weight:800;font-family:var(--display);color:var(--accent);grid-row:span 2;align-self:center}
.date-card .t{font-weight:700;font-size:15px}
.date-card .v{color:var(--muted);font-size:13.5px}
/* report */
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r);background:var(--card)}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
th{font-family:var(--font);text-align:left;padding:15px 18px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface) 70%,transparent)}
td{padding:14px 18px;border-bottom:1px solid var(--border)}
tbody tr:last-child td{border-bottom:0}
tbody tr{transition:background .15s ease}
tbody tr:hover{background:color-mix(in srgb,var(--accent) 5%,transparent)}
/* cta band + contact */
.cta-band{border-radius:calc(var(--r) + 8px);padding:64px 40px;text-align:center;background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 16%,var(--surface)),color-mix(in srgb,var(--accent2) 12%,var(--surface)));border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border));position:relative;overflow:hidden}
.cta-band::before{content:"";position:absolute;inset:0;background:radial-gradient(600px 240px at 50% -60px,color-mix(in srgb,var(--accent) 22%,transparent),transparent);pointer-events:none}
.cta-band h2{font-size:clamp(26px,4vw,40px);margin-bottom:12px;position:relative}
.cta-band p{color:var(--muted);margin-bottom:26px;position:relative}
.cta-band .btn{position:relative}
.contact-strip{display:flex;gap:22px;justify-content:center;flex-wrap:wrap;margin-top:26px;position:relative}
.contact-strip a{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:var(--muted);transition:color .2s ease}
.contact-strip a:hover{color:var(--accent)}
.contact-strip svg{width:15px;height:15px;stroke:var(--accent)}
/* footer — giant wordmark */
footer{border-top:1px solid var(--border);padding:44px 0 0;overflow:hidden}
footer .wrap{display:flex;justify-content:space-between;align-items:center;gap:14px;padding-bottom:26px;font-size:13px;color:var(--muted);flex-wrap:wrap}
footer .wrap a:hover{color:var(--accent)}
.wordmark{display:block;font-family:var(--display);font-weight:800;font-size:clamp(64px,14.5vw,190px);line-height:.86;letter-spacing:-.04em;color:transparent;-webkit-text-stroke:1px color-mix(in srgb,var(--muted) 42%,transparent);text-align:center;user-select:none;translate:0 14%}
/* ── scroll progress ── */
#nb-progress{position:fixed;top:0;left:0;height:2.5px;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));z-index:99;box-shadow:0 0 12px color-mix(in srgb,var(--accent) 60%,transparent)}
/* ── reveals ── */
.rev{opacity:0;translate:0 26px;filter:blur(6px);transition:opacity .8s cubic-bezier(.2,.6,.2,1),translate .8s cubic-bezier(.2,.6,.2,1),filter .8s ease}
.rev.in{opacity:1;translate:0 0;filter:blur(0)}
.rev.d1{transition-delay:.08s}.rev.d2{transition-delay:.16s}.rev.d3{transition-delay:.24s}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001s!important;animation-iteration-count:1!important;transition-duration:.001s!important}
  .rev{opacity:1;translate:0 0;filter:none}
  html{scroll-behavior:auto}
}
@media(max-width:860px){
  .hero.split .wrap{grid-template-columns:1fr;gap:36px}
  .split{grid-template-columns:1fr;gap:32px}
  .offer-wrap{grid-template-columns:1fr}
  .nav-links,.nav .btn.desktop{display:none}
  .burger{display:block}
  section.block{padding:60px 0}
  .hero{padding:72px 0 60px}
}
/*NEO-HARD*/
`;
}

/* ══ Base JS — motion that makes the page feel alive ═════════════════ */

function baseJs() {
  return `<script>
(function(){
  'use strict';
  var rm=(typeof matchMedia!=='undefined')&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* scroll reveals (blur + rise) */
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12});
    document.querySelectorAll('.rev').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});}
  /* smooth anchors */
  document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var t=document.querySelector(a.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'});}});});
  /* nav glass on scroll */
  var nav=document.querySelector('.nav');
  if(nav){var onS=function(){nav.classList.toggle('scrolled',(window.scrollY||0)>12);};addEventListener('scroll',onS,{passive:true});onS();}
  /* burger */
  var bg=document.querySelector('.burger'),mm=document.querySelector('.mobile-menu');
  if(bg&&mm){bg.addEventListener('click',function(){var open=mm.classList.toggle('open');bg.setAttribute('aria-expanded',open?'true':'false');bg.textContent=open?'\u2715':'\u2630';});}
  /* scroll progress bar */
  var prog=document.getElementById('nb-progress');
  if(prog){addEventListener('scroll',function(){var h=document.documentElement;var max=h.scrollHeight-h.clientHeight;if(max>0)prog.style.width=(scrollY/max*100)+'%';},{passive:true});}
  /* orb parallax — subtle depth on scroll */
  var orbs=document.querySelectorAll('.orb');
  if(orbs.length&&!rm){addEventListener('scroll',function(){var y=scrollY*.06;orbs.forEach(function(o,i){o.style.translate='0 '+(i%2?-y:y)+'px';});},{passive:true});}
  /* cursor glow — the page answers the hand */
  var glow=document.getElementById('cursor-glow');
  if(glow&&!rm&&(typeof matchMedia==='undefined'||matchMedia('(pointer:fine)').matches)){
    addEventListener('mousemove',function(e){glow.style.left=e.clientX+'px';glow.style.top=e.clientY+'px';},{passive:true});
  }
  /* animated stat counters */
  var stats=document.querySelectorAll('.stat b');
  if(stats.length&&'IntersectionObserver' in window&&!rm){
    var cio=new IntersectionObserver(function(es){es.forEach(function(e){
      if(!e.isIntersecting)return;cio.unobserve(e.target);
      var el=e.target,m=/^\s*([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(el.textContent||'');
      if(!m)return;var target=parseFloat(m[1].replace(/,/g,''));if(!isFinite(target)||target===0)return;
      var dec=(m[1].split('.')[1]||'').length,prefix=el.textContent.slice(0,m.index),suffix=el.textContent.slice(m.index+m[1].length),t0=null;
      var step=function(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/1100);p=1-Math.pow(1-p,3);
        var v=target*p,txt=dec?v.toFixed(dec):Math.round(v).toLocaleString('en-IN');
        el.textContent=prefix+txt+suffix;if(p<1)requestAnimationFrame(step);else el.textContent=prefix+target.toLocaleString('en-IN',{minimumFractionDigits:dec,maximumFractionDigits:dec})+suffix;};
      el.textContent=prefix+'0'+suffix;requestAnimationFrame(step);
    });},{threshold:.5});
    stats.forEach(function(el){cio.observe(el);});
  }
  /* countdown */
  var cd=document.querySelector('[data-countdown]');
  if(cd){
    var end=new Date(cd.getAttribute('data-countdown')).getTime();
    if(!isNaN(end)){
      var f=function(){
        var d=Math.max(0,end-Date.now()),n=Math.floor(d/864e5),h=Math.floor(d%864e5/36e5),m=Math.floor(d%36e5/6e4),s=Math.floor(d%6e4/1e3);
        var set=function(id,v){var el=cd.querySelector(id);if(el)el.textContent=String(v).padStart(2,'0');};
        set('[data-d]',n);set('[data-h]',h);set('[data-m]',m);set('[data-s]',s);
        if(d<=0){var w=cd.closest('.count-wrap');if(w)w.innerHTML='<b style="font-size:20px">Offer ended</b>';clearInterval(t);}
      };
      f();var t=setInterval(f,1000);
    }
  }
})();
</script>`;
}

/* ══ ART — deterministic inline-SVG compositions (no emoji billboards) ══ */

const ACCENTS = (v) => [v.accent, v.accent2, mix(v.accent, v.ink, 0.25)];

/** artSvg(motif, seed, vars) — deterministic inline SVG art per seed. */
export function artSvg(motif, seed, v) {
  const s = Math.abs(String(seed || 'x').split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const a1 = v.accent, a2 = v.accent2;
  const W = 600, H = 440;
  const open = () => `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid slice"><defs>
    <linearGradient id="g${s}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${a1}" stop-opacity=".85"/><stop offset="1" stop-color="${a2}" stop-opacity=".55"/>
    </linearGradient>
    <radialGradient id="r${s}" cx="30%" cy="20%" r="90%">
      <stop offset="0" stop-color="${a1}" stop-opacity=".30"/><stop offset="1" stop-color="${v.bg}" stop-opacity="0"/>
    </radialGradient>
  </defs><rect width="${W}" height="${H}" fill="${v.bg}"/><rect width="${W}" height="${H}" fill="url(#r${s})"/>`;

  switch (motif) {
    case 'rings': {
      let c = '';
      for (let i = 0; i < 6; i++) {
        const rad = 52 + i * 44;
        c += `<circle cx="${300 + (s % 60) - 30}" cy="${220 + (s % 40) - 20}" r="${rad}" fill="none" stroke="url(#g${s})" stroke-width="${i === 2 ? 2.4 : 1.1}" opacity="${0.85 - i * 0.11}"/>`;
      }
      c += `<circle cx="${300 + (s % 60) - 30}" cy="${220 + (s % 40) - 20}" r="18" fill="${a1}"/>`;
      return open() + c + '</svg>';
    }
    case 'waves': {
      let c = '';
      for (let i = 0; i < 5; i++) {
        const y = 110 + i * 56 + (s % 30);
        const amp = 34 + (i % 3) * 16;
        c += `<path d="M-20 ${y} C 120 ${y - amp}, 240 ${y + amp}, 380 ${y - amp / 2} S 620 ${y + amp / 2}, 640 ${y}" fill="none" stroke="url(#g${s})" stroke-width="${1.4 + (i % 2)}" opacity="${0.9 - i * 0.14}"/>`;
      }
      return open() + c + '</svg>';
    }
    case 'grid': {
      let c = '';
      for (let x = 0; x <= 12; x++) c += `<line x1="${x * 50}" y1="0" x2="${x * 50}" y2="${H}" stroke="${a2}" stroke-width=".6" opacity=".25"/>`;
      for (let y = 0; y <= 9; y++) c += `<line x1="0" y1="${y * 50}" x2="${W}" y2="${y * 50}" stroke="${a2}" stroke-width=".6" opacity=".25"/>`;
      const gx = (s % 9) * 50, gy = (s % 6) * 50;
      c += `<rect x="${gx + 4}" y="${gy + 4}" width="142" height="92" fill="url(#g${s})" opacity=".9" rx="4"/>`;
      c += `<rect x="${gx + 104}" y="${gy + 146}" width="92" height="92" fill="none" stroke="${a1}" stroke-width="2.4" rx="4"/>`;
      c += `<circle cx="${gx + 250}" cy="${gy + 60}" r="30" fill="${a1}" opacity=".85"/>`;
      return open() + c + '</svg>';
    }
    case 'blocks': {
      const rs = [
        [60, 70, 200, 150], [290, 40, 120, 120], [440, 100, 110, 190],
        [90, 260, 160, 120], [300, 200, 220, 130],
      ];
      let c = '';
      rs.forEach((rr, i) => {
        const f = i % 3 === 0;
        c += `<rect x="${rr[0]}" y="${rr[1]}" width="${rr[2]}" height="${rr[3]}" rx="6" ${f ? `fill="url(#g${s})"` : `fill="none" stroke="${i % 3 === 1 ? a1 : a2}" stroke-width="${i % 3 === 1 ? 2.2 : 1.2}"`} opacity="${f ? 0.92 : 0.8}"/>`;
      });
      return open() + c + '</svg>';
    }
    case 'mesh':
    default: {
      return open() + `
      <circle cx="${170 + (s % 80)}" cy="${150 + (s % 60)}" r="190" fill="${a1}" opacity=".28"/>
      <circle cx="${420 - (s % 60)}" cy="${280 - (s % 70)}" r="220" fill="${a2}" opacity=".22"/>
      <circle cx="320" cy="330" r="130" fill="${a1}" opacity=".18"/>
      <g stroke="${v.ink}" stroke-opacity=".16" stroke-width=".7">
        ${Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${(i + 1) * 44}" x2="${W}" y2="${(i + 1) * 44}"/>`).join('')}
      </g></svg>`;
    }
  }
}

/** Minimal stroke icon set for the contact strip (no emoji). */
const LINE_ICONS = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m22 7-10 6L2 7"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
};

/* ══ Section renderers — every LLM-contributed string is escaped ═════ */

function workCard(w, i, v, d, seedBase) {
  return `<article class="work rev d${(i % 3) + 1}">
    <div class="art">${artSvg(d.art, `${seedBase}-${i}-${w.title}`, v)}</div>
    <div class="body"><span class="tag">${esc(w.tag || 'Work')}</span><h3>${esc(w.title)}</h3><p>${esc(w.blurb || '')}</p></div>
  </article>`;
}

function quoteCard(t) {
  const initial = String(t.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="quote rev">
    <div class="mark">\u201C</div>
    <p>${esc(t.quote)}</p>
    <div class="who"><span class="ava">${esc(initial)}</span><span><b>${esc(t.name || '')}</b><span>${esc(t.role || '')}</span></span></div>
  </div>`;
}

function marqueeBlock(items, brand) {
  const list = (items || []).slice(0, 8).map((x) => String(x).slice(0, 40)).filter(Boolean);
  if (!list.length) return '';
  const seq = list.map((x) => `<span>${esc(x)}</span>`).join('');
  return `<div class="marquee" aria-hidden="true"><div class="track">${seq}</div><div class="track">${seq}</div></div>`;
}

function faqBlock(items, head) {
  if (!items?.length) return '';
  return `<section class="block alt" id="faq"><div class="wrap">
    <div class="sec-head rev"><span class="kicker">${esc(head?.kicker || 'Good to know')}</span><h2>${esc(head?.title || 'Questions, answered')}</h2></div>
    <div class="faq">${items.map((f) => `<details class="rev"><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join('')}</div>
  </div></section>`;
}

function statsBlock(stats) {
  if (!stats?.length) return '';
  return `<section class="block" style="padding-top:8px"><div class="wrap">
    <div class="stats">${stats.slice(0, 4).map((s, i) => `<div class="stat rev d${(i % 3) + 1}"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>
  </div></section>`;
}

/** Features — bento grid when there are 3+ (first card leads), else g3. */
function featuresBlock(features, head) {
  if (!features?.length) return '';
  const bento = features.length >= 3;
  const cards = features.slice(0, 6).map((f, i) =>
    `<div class="card rev d${(i % 3) + 1}"><div class="ico">${esc(f.icon || '\u2726')}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('');
  return `<section class="block" id="features"><div class="wrap">
    ${head ? `<div class="sec-head rev"><span class="kicker">${esc(head.kicker || 'Why us')}</span><h2>${esc(head.title)}</h2>${head.sub ? `<p>${esc(head.sub)}</p>` : ''}</div>` : ''}
    <div class="${bento ? 'bento' : 'grid g3'}">${cards}</div>
  </div></section>`;
}

function showcaseBlock(showcase, v, d, seedBase) {
  if (!showcase?.title && !showcase?.text) return '';
  return `<section class="block alt" id="showcase"><div class="wrap"><div class="split">
    <div class="rev"><span class="kicker">${esc(showcase.kicker || 'The difference')}</span>
      <h2>${esc(showcase.title || '')}</h2>
      ${showcase.text ? `<p>${esc(showcase.text)}</p>` : ''}
      <ul class="ticks">${(showcase.bullets || []).slice(0, 5).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    </div>
    <div class="art-panel rev d2" style="min-height:300px">${artSvg(d.art, `${seedBase}-showcase`, v)}</div>
  </div></div></section>`;
}

function testimonialsBlock(items) {
  if (!items?.length) return '';
  return `<section class="block"><div class="wrap">
    <div class="sec-head rev"><span class="kicker">Loved by people</span><h2>What they say</h2></div>
    <div class="grid g${items.length > 1 ? 3 : 2}" style="justify-content:center">${items.slice(0, 3).map(quoteCard).join('')}</div>
  </div></section>`;
}

function contactStrip(contact, cta) {
  const links = [];
  if (contact?.phone) links.push(`<a href="${safeHref(`tel:${contact.phone}`)}">${LINE_ICONS.phone} ${esc(contact.phone)}</a>`);
  if (contact?.email) links.push(`<a href="${safeHref(`mailto:${contact.email}`)}">${LINE_ICONS.mail} ${esc(contact.email)}</a>`);
  if (contact?.address) links.push(`<a target="_blank" rel="noopener" href="${safeHref(contact.maps || `https://www.google.com/maps/search/${encodeURIComponent(contact.address)}`)}">${LINE_ICONS.pin} ${esc(contact.address)}</a>`);
  if (contact?.hours) links.push(`<a href="#">${LINE_ICONS.clock} ${esc(contact.hours)}</a>`);
  if (!links.length) return '';
  return `${cta ? '' : `<div class="contact-strip">${links.join('')}</div>`}`;
}

function ctaBand(content, brand) {
  const cta = content.primary_cta || {};
  const href = safeHref(cta.href || contactHref(content) || '#');
  return `<section style="padding:34px 0 10px"><div class="wrap">
    <div class="cta-band rev">
      <h2>${esc(content.cta_title || `Ready to begin with ${brand.name}?`)}</h2>
      <p>${esc(content.cta_sub || content.hero_sub || '')}</p>
      <a class="btn" href="${href}">${esc(cta.label || 'Get started')}</a>
      ${contactStrip(content.contact)}
    </div>
  </div></section>`;
}

function contactHref(content) {
  const c = content.contact || {};
  if (c.email) return `mailto:${c.email}`;
  if (c.phone) return `tel:${c.phone}`;
  return '';
}

/* ══ Chrome: nav, hero (3 layouts), footer ═══════════════════════════ */

function nav(brand, links, cta) {
  const desktop = links.map((l) => `<a href="#${l.id}">${esc(l.label)}</a>`).join('');
  return `<nav class="nav"><div class="wrap">
    <a class="brand" href="#top"><span class="dot">${esc(brand.mark || '\u2726')}</span>${esc(brand.name)}</a>
    <div class="nav-links">${desktop}</div>
    <a class="btn primary small desktop" href="${safeHref(cta.href)}">${esc(cta.label)}</a>
    <button class="burger" aria-label="Menu" aria-expanded="false">\u2630</button>
  </div>
  <div class="mobile-menu">${links.map((l) => `<a href="#${l.id}">${esc(l.label)}</a>`).join('')}<a href="${safeHref(cta.href)}" style="color:var(--accent)">${esc(cta.label)} \u2192</a></div>
  </nav>`;
}

function heroHtml(content, brand, design, v) {
  const c1 = content.primary_cta || {};
  const c2 = content.secondary_cta || {};
  const layout = design.hero === 'split' ? 'split' : design.hero === 'editorial' ? 'editorial' : 'centered';
  const cls = `hero ${layout}`;
  const badges = (content.hero_badges || []).length
    ? `<div class="hero-badges">${content.hero_badges.slice(0, 4).map((b) => `<span>${esc(b)}</span>`).join('')}</div>`
    : '';
  const ctas = `<div class="ctas">
    ${c1.label ? `<a class="btn primary" href="${safeHref(c1.href || contactHref(content) || '#')}">${esc(c1.label)}</a>` : ''}
    ${c2.label ? `<a class="btn ghost" href="${safeHref(c2.href || '#')}">${esc(c2.label)}</a>` : ''}
  </div>`;

  if (layout === 'split') {
    return `<header class="${cls}" id="top">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="wrap">
        <div>
          ${content.kicker ? `<span class="kicker">${esc(content.kicker)}</span>` : ''}
          <h1>${esc(content.headline)}</h1>
          <p class="sub">${esc(content.sub)}</p>
          ${ctas}
          ${badges}
        </div>
        <div class="hero-art rev d2">${artSvg(design.art, `${brand.name}-hero`, v)}</div>
      </div>
    </header>`;
  }

  if (layout === 'editorial') {
    return `<header class="${cls}" id="top">
      <div class="orb a"></div><div class="orb b"></div>
      <div class="wrap">
        <div class="hero-editorial-rule rev"><span class="idx">${esc(String(content.kicker || brand.name).toUpperCase())}</span><span class="line"></span></div>
        <h1 class="rev d1">${esc(content.headline)}</h1>
        <p class="sub rev d2">${esc(content.sub)}</p>
        <div class="rev d2">${ctas}</div>
        <div class="hero-editorial-meta rev d3">
          ${(content.hero_badges || []).slice(0, 3).map((b) => `<span>${esc(b)}</span>`).join('')}
          ${content.contact?.phone ? `<span>${esc(content.contact.phone)}</span>` : ''}
          ${content.contact?.hours ? `<span>${esc(content.contact.hours)}</span>` : ''}
        </div>
      </div>
    </header>`;
  }

  return `<header class="${cls}" id="top">
    <div class="orb a"></div><div class="orb b"></div>
    <div class="wrap">
      ${content.kicker ? `<span class="kicker" style="justify-content:center">${esc(content.kicker)}</span>` : ''}
      <h1>${esc(content.headline)}</h1>
      <p class="sub">${esc(content.sub)}</p>
      ${ctas}
      ${badges}
    </div>
  </header>`;
}

function bigFooter(content, brand) {
  return `<footer>
  <span class="wordmark" aria-hidden="true">${esc(brand.name)}</span>
  <div class="wrap"><span>\u00A9 ${new Date().getFullYear()} ${esc(brand.name)} \u00B7 ${esc(content.footer_note || 'Made with Nebula Studio')}</span><span><a href="#top">Back to top \u2191</a></span></div>
</footer>`;
}

/* ══ Kind assemblies ═════════════════════════════════════════════════ */

function renderLanding(content, brand, v, d) {
  const seed = `${brand.name}-landing`;
  const links = [
    ...(content.features?.length ? [{ id: 'features', label: 'Highlights' }] : []),
    ...(content.showcase?.title ? [{ id: 'showcase', label: 'Why us' }] : []),
    ...(content.faq?.length ? [{ id: 'faq', label: 'FAQ' }] : []),
    { id: 'contact', label: 'Contact' },
  ];
  return [
    nav(brand, links, content.primary_cta || { label: 'Contact', href: contactHref(content) }),
    heroHtml(content, brand, d, v),
    marqueeBlock(content.marquee, brand),
    statsBlock(content.stats),
    featuresBlock(content.features, content.features_head),
    showcaseBlock(content.showcase, v, d, seed),
    testimonialsBlock(content.testimonials),
    faqBlock(content.faq, { kicker: 'Good to know', title: 'Questions, answered' }),
    ctaBand(content, brand),
  ];
}

function renderPromo(content, brand, v, d) {
  const offer = content.offer || {};
  const ends = String(offer.ends || '').trim();
  const countdown = ends
    ? `<div class="count-wrap"><div class="count" data-countdown="${esc(ends)}">
        <div class="cell"><b data-d>00</b><span>days</span></div><div class="cell"><b data-h>00</b><span>hrs</span></div>
        <div class="cell"><b data-m>00</b><span>min</span></div><div class="cell"><b data-s>00</b><span>sec</span></div>
      </div></div>`
    : '';
  const links = [{ id: 'offer', label: 'The offer' }, ...(content.faq?.length ? [{ id: 'faq', label: 'FAQ' }] : [])];
  return [
    nav(brand, links, content.primary_cta || { label: offer.claim || 'Claim offer', href: contactHref(content) }),
    `<header class="hero centered" id="top"><div class="orb a"></div><div class="orb b"></div><div class="wrap">
      ${offer.badge ? `<span style="display:inline-block;background:var(--accent);color:var(--on-accent);font-weight:800;font-size:14px;letter-spacing:.05em;border-radius:999px;padding:9px 20px;margin-bottom:20px;box-shadow:0 10px 26px color-mix(in srgb,var(--accent) 40%,transparent)">${esc(offer.badge)}</span>` : ''}
      <h1>${esc(content.headline)}</h1>
      <p class="sub">${esc(content.sub)}</p>
      <div class="ctas"><a class="btn primary" href="${safeHref((content.primary_cta || {}).href || contactHref(content) || '#')}">${esc((content.primary_cta || {}).label || 'Claim the offer')}</a></div>
    </div></header>`,
    marqueeBlock(content.marquee, brand),
    `<section class="block" id="offer" style="padding-top:34px"><div class="wrap"><div class="offer-wrap">
      <div class="offer-card rev">
        ${offer.badge ? `<span class="badge">${esc(offer.badge)}</span>` : ''}
        ${offer.old_price ? `<div class="old">${esc(offer.old_price)}</div>` : ''}
        <div class="price">${esc(offer.price || 'Special price')}</div>
        ${countdown}
        ${offer.note ? `<div class="note">${esc(offer.note)}</div>` : ''}
      </div>
      <div class="rev d2" style="align-self:center">
        <span class="kicker">What you get</span>
        <h2 style="font-size:clamp(22px,3.4vw,30px);margin-bottom:16px">${esc(offer.perks_title || 'Everything included')}</h2>
        <ul class="ticks">${(offer.perks || []).slice(0, 6).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      </div>
    </div></div></section>`,
    featuresBlock(content.features, content.features_head),
    testimonialsBlock(content.testimonials),
    faqBlock(content.faq, { kicker: 'Fine print, made friendly', title: 'Questions' }),
    `${offer.terms ? `<div class="wrap"><p style="text-align:center;color:var(--muted);font-size:12.5px;margin-top:18px">${esc(offer.terms)}</p></div>` : ''}`,
    ctaBand(content, brand),
  ];
}

function renderEvent(content, brand, v, d) {
  const ev = content.event || {};
  const links = [{ id: 'agenda', label: 'Agenda' }, ...(ev.speakers?.length ? [{ id: 'speakers', label: 'Speakers' }] : []), ...(ev.venue ? [{ id: 'venue', label: 'Venue' }] : []), { id: 'rsvp', label: 'RSVP' }];
  const rsvpMail = `mailto:${esc(content.contact?.email || brand.contactEmail || 'hello@example.com')}?subject=${encodeURIComponent(`RSVP \u2014 ${content.title || brand.name}`)}`;
  return [
    nav(brand, links, { label: 'RSVP now', href: rsvpMail }),
    heroHtml(content, brand, d, v),
    ev.agenda?.length ? `<section class="block" id="agenda"><div class="wrap"><div class="sec-head rev"><span class="kicker">The plan</span><h2>Agenda</h2></div>
      <div class="agenda">${ev.agenda.slice(0, 8).map((a, i) => `<div class="slot rev d${(i % 3) + 1}"><div class="time">${esc(a.time)}</div><div class="what"><b>${esc(a.item)}</b>${a.who ? `<span>${esc(a.who)}</span>` : ''}</div></div>`).join('')}</div>
    </div></section>` : '',
    ev.speakers?.length ? `<section class="block alt" id="speakers"><div class="wrap"><div class="sec-head rev"><span class="kicker">Meet them</span><h2>Speakers &amp; guests</h2></div>
      <div class="grid g3">${ev.speakers.slice(0, 6).map((s, i) => `<div class="card rev d${(i % 3) + 1}" style="text-align:center"><div style="width:64px;height:64px;border-radius:50%;margin:0 auto 12px;background:var(--accent);display:grid;place-items:center;font-size:24px;font-weight:800;color:var(--on-accent)">${esc(String(s.name || '?').charAt(0).toUpperCase())}</div><h3>${esc(s.name)}</h3><p>${esc(s.role || '')}</p></div>`).join('')}</div>
    </div></section>` : '',
    ev.venue ? `<section class="block" id="venue"><div class="wrap"><div class="split">
      <div class="rev"><span class="kicker">Getting there</span><h2>${esc(ev.venue)}</h2>${ev.venue_note ? `<p>${esc(ev.venue_note)}</p>` : ''}
      <a class="btn ghost" target="_blank" rel="noopener" href="${safeHref(ev.maps || `https://www.google.com/maps/search/${encodeURIComponent(ev.venue)}`)}">Open in Maps \u2192</a></div>
      <div class="art-panel rev d2" style="min-height:300px">${artSvg('grid', `${brand.name}-venue`, v)}</div></div></div></section>` : '',
    `<section class="block alt" id="rsvp"><div class="wrap" style="text-align:center">
      <div class="sec-head rev"><span class="kicker">Save your seat</span><h2>RSVP</h2><p>One tap \u2014 we\u2019ll hold your spot.</p></div>
      <a class="btn primary" href="${rsvpMail}">${esc((content.primary_cta || {}).label || 'RSVP now')}</a>
      ${contactStrip(content.contact)}
    </div></section>`,
  ];
}

function renderPortfolio(content, brand, v, d) {
  const seed = `${brand.name}-portfolio`;
  const links = [{ id: 'work', label: 'Work' }, ...(content.skills?.length ? [{ id: 'skills', label: 'Skills' }] : []), { id: 'contact', label: 'Contact' }];
  return [
    nav(brand, links, content.primary_cta || { label: 'Hire me', href: contactHref(content) }),
    heroHtml(content, brand, d, v),
    content.work?.length ? `<section class="block" id="work"><div class="wrap"><div class="sec-head rev"><span class="kicker">Selected work</span><h2>Things I\u2019ve made</h2></div>
      <div class="grid g3">${content.work.slice(0, 6).map((w, i) => workCard(w, i, v, d, seed)).join('')}</div></div></section>` : '',
    content.skills?.length ? `<section class="block alt" id="skills"><div class="wrap"><div class="sec-head rev"><span class="kicker">Toolbox</span><h2>Skills &amp; services</h2></div>
      <div class="hero-badges" style="margin-top:0">${content.skills.slice(0, 10).map((s) => `<span style="font-size:13.5px;padding:10px 18px">${esc(s)}</span>`).join('')}</div></div></section>` : '',
    testimonialsBlock(content.testimonials),
    `<section class="block alt" id="contact"><div class="wrap" style="text-align:center">
      <div class="sec-head rev"><span class="kicker">Let\u2019s talk</span><h2>${esc(content.cta_title || 'Have a project in mind?')}</h2><p>${esc(content.cta_sub || 'Tell me about it \u2014 I usually reply within a day.')}</p></div>
      <a class="btn primary" href="${safeHref(contactHref(content) || '#')}">${esc((content.primary_cta || {}).label || 'Start a conversation')}</a>
      ${contactStrip(content.contact)}
    </div></section>`,
  ];
}

function renderReport(content, brand, v, d) {
  const rep = content.report || {};
  return [
    nav(brand, [{ id: 'findings', label: 'Findings' }, ...(rep.table ? [{ id: 'data', label: 'Data' }] : []), ...(rep.sources?.length ? [{ id: 'sources', label: 'Sources' }] : [])], { label: 'Full report', href: '#findings' }),
    `<header class="hero editorial" id="top" style="padding:72px 0 40px"><div class="orb a"></div><div class="wrap" style="max-width:860px">
      <div class="hero-editorial-rule rev"><span class="idx">${esc(String(content.kicker || 'Research').toUpperCase())}</span><span class="line"></span></div>
      <h1 class="rev d1" style="margin:0 0 14px">${esc(content.headline)}</h1>
      <p class="sub rev d2" style="margin:0 0 8px">${esc(content.sub)}</p>
      <p style="color:var(--muted);font-size:13px" class="rev d3">${esc(rep.date_label || new Date().toISOString().slice(0, 10))} \u00B7 prepared by the ${esc(brand.name)} research agent</p>
    </div></header>`,
    rep.findings?.length ? `<section class="block" id="findings" style="padding-top:26px"><div class="wrap"><div class="sec-head rev"><span class="kicker">Key findings</span><h2>What the research says</h2></div>
      <div class="bento">${rep.findings.slice(0, 6).map((f, i) => `<div class="card rev d${(i % 3) + 1}"><div class="ico">${['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465'][i] || '\u2022'}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('')}</div></div></section>` : '',
    rep.table ? `<section class="block alt" id="data"><div class="wrap"><div class="sec-head rev"><span class="kicker">The data</span><h2>${esc(rep.table.title || 'At a glance')}</h2></div>
      <div class="table-wrap rev"><table><thead><tr>${(rep.table.head || []).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${(rep.table.rows || []).slice(0, 12).map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>` : '',
    showcaseBlock(rep.insights ? { ...rep.insights, kicker: 'So what' } : null, v, d, `${brand.name}-report`),
    rep.sources?.length ? `<section class="block" id="sources"><div class="wrap"><div class="sec-head rev"><span class="kicker">Receipts</span><h2>Sources</h2></div>
      <ul class="ticks" style="max-width:720px;margin:0 auto">${rep.sources.slice(0, 8).map((s) => `<li><a href="${safeHref(s.url)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">${esc(s.title || s.url)}</a></li>`).join('')}</ul></div></section>` : '',
    ctaBand(content, brand),
  ];
}

/* ══ The renderer entry point ════════════════════════════════════════ */

/**
 * renderSite({kind, design, content, brand}) — complete single-file HTML.
 * Deterministic: same inputs, same bytes. Any missing content simply
 * drops its section — the page can never be malformed.
 */
export function renderSite({ kind, design, content, brand }) {
  const v = THEMES[design.theme].vars(design.palette);
  const parts = {
    landing: renderLanding,
    promo: renderPromo,
    event: renderEvent,
    portfolio: renderPortfolio,
    report: renderReport,
    webapp: renderLanding, // webapps use the AI path; template is the fallback shell
  }[kind] || renderLanding;

  const body = parts(content, brand, v, design).filter(Boolean).join('\n');
  const title = esc(content.title || `${brand.name} \u2014 ${kind}`);
  const desc = esc(String(content.sub || content.headline || '').slice(0, 150));

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${v.bg}">
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<title>${title}</title>
${fontLinks(design.font)}
<style>${baseCss(v, design)}</style>
</head><body>
<div id="nb-progress"></div>
<div id="cursor-glow" aria-hidden="true"></div>
${body}
${bigFooter(content, brand)}
${baseJs()}
</body></html>`;
}
