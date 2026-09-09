/**
 * SITE TEMPLATES — the deterministic render engine behind Studio builds.
 *
 * WHY THIS EXISTS: a one-shot "write me a website" LLM call inside a
 * ~2k-token completion budget produced the worst failure in the Studio —
 * markdown-fenced fragments, truncated <html>, and model chatter ("Want
 * it on GitHub, Vercel…") saved AS the website. So the pipeline flipped:
 *
 *   • the LLM THINKS (design brief) and WRITES (copy JSON) in small calls
 *   • THIS ENGINE RENDERS — hand-built, genuinely premium CSS/HTML that
 *     cannot truncate, cannot leak fences, cannot forget a viewport
 *
 * Six design systems (aurora / luxe / editorial / swiss / festive /
 * playful), one component library (glass nav, hero, stats, features,
 * showcase split, work grid, agenda timeline, offer card + real
 * countdown, FAQ accordion, testimonials, report table, CTA band,
 * footer), all mobile-first with scroll-reveal + reduced-motion respect.
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

const FONT_STACKS = {
  modern: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`,
  serif: `Georgia, 'Times New Roman', 'Playfair Display', serif`,
  rounded: `ui-rounded, 'SF Pro Rounded', -apple-system, 'Segoe UI', system-ui, sans-serif`,
  mono: `ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace`,
};

/* ══ Theme presets — each a complete, opinionated design system ══════ */

export const THEMES = {
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
      onAccent: lum(hex(p.accent, '#d3aa5e')) > 0.62 ? '#14120e' : '#14120e',
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
};

export function resolveTheme(name, fallback) {
  return THEMES[String(name || '').toLowerCase()] ? String(name).toLowerCase() : fallback;
}

/** Map a human style hint to a theme. */
export function themeForStyleHint(style, kind) {
  const s = String(style || '').toLowerCase();
  if (/dark|premium|luxur/.test(s)) return 'aurora';
  if (/luxe|gold|elegan/.test(s)) return 'luxe';
  if (/editorial|magazine|serif/.test(s)) return 'editorial';
  if (/minimal|clean|swiss|simple/.test(s)) return 'swiss';
  if (/festiv|bold|sale|diwali|offer|energ/.test(s)) return 'festive';
  if (/playful|colorful|fun|friendly/.test(s)) return 'playful';
  if (kind === 'promo') return 'festive';
  if (kind === 'portfolio') return 'editorial';
  if (kind === 'report') return 'swiss';
  if (kind === 'webapp' || kind === 'event') return 'aurora';
  return 'aurora';
}

const DEFAULT_PALETTES = {
  aurora: { accent: '#7c8cff', accent2: '#3dd8d8' },
  luxe: { accent: '#d3aa5e', accent2: '#8f7bd8' },
  editorial: { accent: '#c2492e', accent2: '#1f6f5b' },
  swiss: { accent: '#2454ff', accent2: '#e6412c' },
  festive: { accent: '#ffb03a', accent2: '#ff5c8a' },
  playful: { accent: '#ff6b6b', accent2: '#12b5a5' },
};

/** Normalize a design spec: valid theme, safe palette, sane fonts. */
export function normalizeDesign(design, { kind, styleHint, brandColor } = {}) {
  const fallbackTheme = themeForStyleHint(styleHint, kind);
  const theme = resolveTheme(design?.theme, fallbackTheme);
  const preset = THEMES[theme];
  const dp = DEFAULT_PALETTES[theme];
  const palette = {
    bg: hex(design?.palette?.bg, ''),
    surface: hex(design?.palette?.surface, ''),
    ink: hex(design?.palette?.ink, ''),
    muted: hex(design?.palette?.muted, ''),
    // Brand color wins for the accent only when the caller supplied one.
    accent: hex(design?.palette?.accent, brandColor && HEX_RE.test(brandColor) ? brandColor : dp.accent),
    accent2: hex(design?.palette?.accent2, dp.accent2),
  };
  return {
    theme,
    themeLabel: preset.label,
    palette,
    font: FONT_STACKS[design?.font] ? String(design.font) : theme === 'editorial' || theme === 'luxe' ? 'serif' : 'modern',
    voice: String(design?.voice || '').slice(0, 300),
    audience: String(design?.audience || '').slice(0, 300),
    radius: theme === 'playful' ? 22 : theme === 'swiss' ? 12 : 18,
  };
}

/* ══ Base CSS — shared component library, themed by variables ════════ */

function baseCss(v, d) {
  const font = FONT_STACKS[d.font] || FONT_STACKS.modern;
  const displayFont = d.font === 'serif' ? `Georgia, 'Times New Roman', serif` : font;
  const r = d.radius;
  return `
:root{--bg:${v.bg};--surface:${v.surface};--card:${v.card};--ink:${v.ink};--muted:${v.muted};--accent:${v.accent};--accent2:${v.accent2};--on-accent:${v.onAccent};--border:${v.border};--r:${r}px;--maxw:1080px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:${font};background:var(--bg);color:var(--ink);line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
img,svg{max-width:100%}
a{color:inherit;text-decoration:none}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 22px}
h1,h2,h3{font-family:${displayFont};line-height:1.14;letter-spacing:-.015em}
.kicker{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
.kicker::before{content:"";width:22px;height:2px;background:var(--accent);border-radius:2px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;font-size:15px;font-weight:700;padding:14px 28px;border-radius:999px;border:0;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease;white-space:nowrap}
.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--on-accent);box-shadow:0 10px 26px color-mix(in srgb,var(--accent) 38%,transparent)}
.btn.primary:hover{transform:translateY(-2px);box-shadow:0 16px 34px color-mix(in srgb,var(--accent) 48%,transparent)}
.btn.ghost{background:transparent;color:var(--ink);border:1.5px solid var(--border)}
.btn.ghost:hover{border-color:var(--accent);color:var(--accent)}
.btn.small{padding:9px 18px;font-size:13px}
/* ── nav ── */
.nav{position:sticky;top:0;z-index:50;padding:14px 0;transition:background .25s ease,box-shadow .25s ease}
.nav.scrolled{background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 0 var(--border)}
.nav .wrap{display:flex;align-items:center;gap:18px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px}
.brand .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:var(--on-accent);font-size:15px}
.nav-links{display:flex;gap:22px;margin-left:auto;font-size:14px;color:var(--muted);font-weight:600}
.nav-links a:hover{color:var(--ink)}
.nav .btn{margin-left:6px}
.burger{display:none;margin-left:auto;background:none;border:0;color:var(--ink);font-size:24px;cursor:pointer;line-height:1}
.mobile-menu{display:none;flex-direction:column;gap:4px;padding:10px 22px 18px;background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:blur(14px)}
.mobile-menu a{padding:11px 4px;font-weight:600;color:var(--muted);border-bottom:1px solid var(--border)}
.mobile-menu a:last-child{border:0}
.mobile-menu.open{display:flex}
/* ── hero ── */
.hero{position:relative;padding:88px 0 84px;text-align:center}
.hero h1{font-size:clamp(34px,6.4vw,60px);font-weight:800;max-width:820px;margin:0 auto 18px}
.hero .sub{font-size:clamp(16px,2.2vw,19px);color:var(--muted);max-width:640px;margin:0 auto 30px}
.hero .ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.grad-text{background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero-badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.hero-badges span{font-size:12.5px;font-weight:600;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:7px 14px;background:color-mix(in srgb,var(--surface) 60%,transparent)}
/* aurora glow orbs */
.orb{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5;pointer-events:none;z-index:-1}
.orb.a{width:420px;height:420px;background:color-mix(in srgb,var(--accent) 55%,transparent);top:-120px;left:-80px}
.orb.b{width:380px;height:380px;background:color-mix(in srgb,var(--accent2) 45%,transparent);bottom:-140px;right:-60px}
/* ── sections ── */
section.block{padding:72px 0}
section.block.alt{background:color-mix(in srgb,var(--surface) 55%,transparent)}
.sec-head{max-width:640px;margin:0 auto 44px;text-align:center}
.sec-head h2{font-size:clamp(26px,4vw,38px);margin-bottom:12px}
.sec-head p{color:var(--muted);font-size:16px}
.grid{display:grid;gap:16px}
.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.g2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:26px;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.card:hover{transform:translateY(-4px);box-shadow:0 18px 40px color-mix(in srgb,var(--ink) 9%,transparent);border-color:color-mix(in srgb,var(--accent) 45%,var(--border))}
.card .ico{width:46px;height:46px;border-radius:14px;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);display:grid;place-items:center;font-size:21px;margin-bottom:16px}
.card h3{font-size:17.5px;margin-bottom:8px}
.card p{color:var(--muted);font-size:14.5px}
/* stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.stat{text-align:center;padding:26px 12px;border-radius:var(--r);border:1px solid var(--border);background:color-mix(in srgb,var(--surface) 65%,transparent)}
.stat b{display:block;font-size:clamp(26px,4vw,36px);font-weight:800;background:linear-gradient(120deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.stat span{color:var(--muted);font-size:13px;font-weight:600}
/* showcase split */
.split{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center}
.split .art{border-radius:calc(var(--r) + 6px);min-height:280px;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 30%,var(--surface)),color-mix(in srgb,var(--accent2) 30%,var(--surface)));display:grid;place-items:center;font-size:74px;border:1px solid var(--border)}
.split h2{font-size:clamp(24px,3.6vw,34px);margin-bottom:14px}
.split p{color:var(--muted);margin-bottom:18px}
.ticks{list-style:none;display:grid;gap:11px}
.ticks li{display:flex;gap:11px;align-items:flex-start;font-size:15px}
.ticks li::before{content:"✓";flex:0 0 22px;height:22px;border-radius:50%;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);display:grid;place-items:center;font-size:12px;font-weight:800;margin-top:2px}
/* work grid */
.work{border-radius:var(--r);overflow:hidden;border:1px solid var(--border);background:var(--card);transition:transform .2s ease,box-shadow .2s ease}
.work:hover{transform:translateY(-5px);box-shadow:0 20px 44px color-mix(in srgb,var(--ink) 10%,transparent)}
.work .art{height:150px;display:grid;place-items:center;font-size:52px}
.work .body{padding:18px 20px 22px}
.work .tag{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.work h3{font-size:17px;margin:6px 0 6px}
.work p{color:var(--muted);font-size:14px}
/* quote */
.quote{border-radius:var(--r);border:1px solid var(--border);background:var(--card);padding:30px}
.quote .mark{font-size:40px;line-height:1;color:var(--accent);font-family:Georgia,serif}
.quote p{font-size:16.5px;margin:12px 0 18px;font-style:italic}
.quote .who{display:flex;align-items:center;gap:12px}
.quote .ava{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:var(--on-accent);display:grid;place-items:center;font-weight:800;font-size:15px}
.quote .who b{display:block;font-size:14.5px}
.quote .who span{color:var(--muted);font-size:12.5px}
/* faq */
.faq{max-width:760px;margin:0 auto;display:grid;gap:10px}
.faq details{border:1px solid var(--border);border-radius:calc(var(--r) - 4px);background:var(--card);padding:0;overflow:hidden}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:18px 22px;font-weight:700;font-size:15.5px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:22px;color:var(--accent);transition:transform .2s ease;font-weight:400}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq .a{padding:0 22px 20px;color:var(--muted);font-size:14.5px}
/* offer / countdown */
.offer-wrap{display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:stretch}
.offer-card{border-radius:calc(var(--r) + 4px);padding:34px 30px;background:linear-gradient(150deg,color-mix(in srgb,var(--accent) 22%,var(--surface)),color-mix(in srgb,var(--accent2) 18%,var(--surface)));border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));text-align:center;display:flex;flex-direction:column;justify-content:center}
.offer-card .badge{display:inline-block;margin:0 auto 16px;background:var(--accent);color:var(--on-accent);font-weight:800;font-size:14px;letter-spacing:.06em;border-radius:999px;padding:8px 18px}
.offer-card .price{font-size:clamp(40px,7vw,58px);font-weight:800;line-height:1;font-family:${displayFont}}
.offer-card .old{color:var(--muted);text-decoration:line-through;font-size:19px;margin-bottom:6px}
.offer-card .note{color:var(--muted);font-size:13px;margin-top:12px}
.count{display:flex;gap:10px;justify-content:center;margin:20px 0 4px}
.count .cell{min-width:64px;padding:12px 8px;border-radius:14px;background:color-mix(in srgb,var(--ink) 8%,transparent);border:1px solid var(--border)}
.count b{display:block;font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
.count span{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700}
/* agenda */
.agenda{max-width:720px;margin:0 auto;display:grid;gap:0}
.agenda .slot{display:grid;grid-template-columns:110px 1fr;gap:18px;padding:18px 0;border-bottom:1px dashed var(--border)}
.agenda .slot:last-child{border-bottom:0}
.agenda .time{font-weight:800;color:var(--accent);font-size:14px;font-variant-numeric:tabular-nums;padding-top:2px}
.agenda .what b{display:block;font-size:15.5px;margin-bottom:3px}
.agenda .what span{color:var(--muted);font-size:13.5px}
.date-card{display:inline-grid;grid-template-columns:auto auto;gap:2px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px 26px;margin-bottom:26px;text-align:left}
.date-card .d{font-size:30px;font-weight:800;font-family:${displayFont};color:var(--accent);grid-row:span 2;align-self:center}
.date-card .t{font-weight:700;font-size:15px}
.date-card .v{color:var(--muted);font-size:13.5px}
/* report */
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--r);background:var(--card)}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
th{font-family:${font};text-align:left;padding:14px 18px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface) 70%,transparent)}
td{padding:13px 18px;border-bottom:1px solid var(--border);color:var(--ink)}
tr:last-child td{border-bottom:0}
tr:hover td{background:color-mix(in srgb,var(--accent) 5%,transparent)}
/* cta band */
.cta-band{margin:26px auto 0;max-width:calc(var(--maxw) - 44px);border-radius:calc(var(--r) + 8px);padding:56px 30px;text-align:center;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 92%,#000),color-mix(in srgb,var(--accent2) 88%,#000));color:var(--on-accent);position:relative;overflow:hidden}
.cta-band h2{font-size:clamp(26px,4.4vw,40px);margin-bottom:12px}
.cta-band p{opacity:.92;max-width:520px;margin:0 auto 26px;font-size:16px}
.cta-band .btn{background:var(--on-accent);color:color-mix(in srgb,var(--accent) 70%,#000)}
.cta-band::after{content:"";position:absolute;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,.14);filter:blur(60px);top:-140px;right:-60px}
/* footer */
footer{padding:44px 0 46px;color:var(--muted);font-size:13.5px}
footer .wrap{display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;border-top:1px solid var(--border);padding-top:28px}
footer a{color:var(--muted)}
footer a:hover{color:var(--accent)}
/* contact strip */
.contact-strip{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:26px}
.contact-strip a{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--border);background:var(--card);border-radius:999px;padding:10px 18px;font-size:13.5px;font-weight:600;color:var(--muted);transition:color .15s ease,border-color .15s ease}
.contact-strip a:hover{color:var(--accent);border-color:var(--accent)}
/* reveal animation */
.rev{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.2,.7,.3,1),transform .7s cubic-bezier(.2,.7,.3,1)}
.rev.in{opacity:1;transform:none}
.rev.d1{transition-delay:.08s}.rev.d2{transition-delay:.16s}.rev.d3{transition-delay:.24s}
/* ── premium polish layer ── */
::selection{background:color-mix(in srgb,var(--accent) 32%,transparent);color:var(--ink)}
html{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--accent) 45%,transparent) transparent}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--accent) 38%,transparent);border-radius:99px;border:2px solid var(--bg)}
::-webkit-scrollbar-track{background:transparent}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
/* hero entrance choreography — pure CSS, plays once on load */
@keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
.hero .kicker{animation:rise .7s cubic-bezier(.2,.7,.3,1) both}
.hero h1{animation:rise .75s .08s cubic-bezier(.2,.7,.3,1) both}
.hero .sub{animation:rise .75s .16s cubic-bezier(.2,.7,.3,1) both}
.hero .ctas{animation:rise .75s .24s cubic-bezier(.2,.7,.3,1) both}
.hero-badges{animation:rise .75s .32s cubic-bezier(.2,.7,.3,1) both}
/* drifting glow orbs */
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(3.5%,4%) scale(1.06)}}
.orb{animation:drift 16s ease-in-out infinite}
.orb.b{animation-delay:-8s}
/* animated shine on primary buttons */
.btn.primary{position:relative;overflow:hidden}
.btn.primary::before{content:"";position:absolute;top:0;left:-80%;width:55%;height:100%;background:linear-gradient(105deg,transparent,rgba(255,255,255,.32),transparent);transform:skewX(-20deg);animation:shine 5.5s ease-in-out infinite}
@keyframes shine{0%,55%{left:-80%}75%,100%{left:130%}}
/* top highlight on cards (glass edge catch) */
.card::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;border-radius:99px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--accent) 55%,transparent),transparent);opacity:.5;pointer-events:none}
.card{position:relative}
/* scroll progress bar */
#nb-progress{position:fixed;top:0;left:0;height:2.5px;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));z-index:99;box-shadow:0 0 10px color-mix(in srgb,var(--accent) 55%,transparent);transition:width .08s linear}
/* section eyebrow numbering (swiss/editorial flavor) */
.sec-head .idx{display:block;font-size:11.5px;font-weight:800;letter-spacing:.22em;color:var(--accent);margin-bottom:10px;opacity:.85}
@media (max-width:860px){
  .split{grid-template-columns:1fr;gap:26px}
  .offer-wrap{grid-template-columns:1fr}
  .nav-links,.nav .btn.desktop{display:none}
  .burger{display:block}
  section.block{padding:56px 0}
  .hero{padding:64px 0 58px}
}
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  .rev{opacity:1;transform:none;transition:none}
  .btn,.card,.work{transition:none}
  .hero .kicker,.hero h1,.hero .sub,.hero .ctas,.hero-badges,.orb{animation:none}
  .btn.primary::before{animation:none;display:none}
  #nb-progress{display:none}
}
`;
}

/* ── Shared runtime JS (tiny, inline, no dependencies) ─────────────── */

function baseJs() {
  return `<script>
(function(){
  var nav=document.querySelector('.nav');
  if(nav){addEventListener('scroll',function(){nav.classList.toggle('scrolled',scrollY>10)},{passive:true});}
  var b=document.querySelector('.burger'),m=document.querySelector('.mobile-menu');
  if(b&&m){b.addEventListener('click',function(){var o=m.classList.toggle('open');b.setAttribute('aria-expanded',o);});m.addEventListener('click',function(e){if(e.target.tagName==='A')m.classList.remove('open');});}
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.12});
    document.querySelectorAll('.rev').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('.rev').forEach(function(el){el.classList.add('in');});}
  document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var t=document.querySelector(a.getAttribute('href'));if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth',block:'start'});}});});
  var rm=(typeof matchMedia!=='undefined')&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* scroll progress bar */
  var prog=document.getElementById('nb-progress');
  if(prog){addEventListener('scroll',function(){var h=document.documentElement;var max=h.scrollHeight-h.clientHeight;if(max>0)prog.style.width=(scrollY/max*100)+'%';},{passive:true});}
  /* orb parallax — subtle depth on scroll */
  var orbs=document.querySelectorAll('.orb');
  if(orbs.length&&!rm){addEventListener('scroll',function(){var y=scrollY*.06;orbs.forEach(function(o,i){o.style.translate='0 '+(i%2?-y:y)+'px';});},{passive:true});}
  /* animated stat counters — counts up when revealed */
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
  var cd=document.querySelector('[data-countdown]');
  if(cd){
    var end=new Date(cd.getAttribute('data-countdown')).getTime();
    if(!isNaN(end)){
      var f=function(){
        var d=Math.max(0,end-Date.now()),n=Math.floor(d/864e5),h=Math.floor(d%864e5/36e5),m=Math.floor(d%36e5/6e4),s=Math.floor(d%6e4/1e3);
        var set=function(id,v){var el=cd.querySelector(id);if(el)el.textContent=String(v).padStart(2,'0');};
        set('[data-d]',n);set('[data-h]',h);set('[data-m]',m);set('[data-s]',s);
        if(d<=0){cd.closest('.count-wrap').innerHTML='<b style="font-size:20px">Offer ended</b>';clearInterval(t);}
      };
      f();var t=setInterval(f,1000);
    }
  }
})();
</script>`;
}

/* ══ Section renderers — every LLM-contributed string is escaped ═════ */

const ART_GRADS = [
  ['rgba(124,140,255,.28)', 'rgba(61,216,216,.22)'],
  ['rgba(255,176,58,.26)', 'rgba(255,92,138,.22)'],
  ['rgba(61,216,160,.26)', 'rgba(61,140,216,.22)'],
  ['rgba(176,124,255,.28)', 'rgba(255,140,180,.2)'],
];

function workCard(w, i) {
  const g = ART_GRADS[i % ART_GRADS.length];
  return `<article class="work rev d${(i % 3) + 1}">
    <div class="art" style="background:linear-gradient(135deg,${g[0]},${g[1]})">${esc(w.art || '✦')}</div>
    <div class="body"><span class="tag">${esc(w.tag || 'Work')}</span><h3>${esc(w.title)}</h3><p>${esc(w.blurb || '')}</p></div>
  </article>`;
}

function quoteCard(t) {
  const initial = String(t.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<div class="quote rev">
    <div class="mark">“</div>
    <p>${esc(t.quote)}</p>
    <div class="who"><span class="ava">${esc(initial)}</span><span><b>${esc(t.name || '')}</b><span>${esc(t.role || '')}</span></span></div>
  </div>`;
}

function faqBlock(items) {
  if (!items?.length) return '';
  return `<section class="block alt"><div class="wrap">
    <div class="sec-head rev"><span class="kicker">Good to know</span><h2>Questions, answered</h2></div>
    <div class="faq">${items.map((f) => `<details class="rev"><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join('')}</div>
  </div></section>`;
}

function statsBlock(stats) {
  if (!stats?.length) return '';
  return `<section class="block" style="padding-top:8px"><div class="wrap">
    <div class="stats">${stats.slice(0, 4).map((s, i) => `<div class="stat rev d${(i % 3) + 1}"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('')}</div>
  </div></section>`;
}

function featuresBlock(features, head) {
  if (!features?.length) return '';
  return `<section class="block"><div class="wrap">
    ${head ? `<div class="sec-head rev"><span class="kicker">${esc(head.kicker || 'Why us')}</span><h2>${esc(head.title)}</h2>${head.sub ? `<p>${esc(head.sub)}</p>` : ''}</div>` : ''}
    <div class="grid g3">${features.slice(0, 6).map((f, i) => `<div class="card rev d${(i % 3) + 1}"><div class="ico">${esc(f.icon || '✦')}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('')}</div>
  </div></section>`;
}

function showcaseBlock(showcase) {
  if (!showcase?.title && !showcase?.text) return '';
  return `<section class="block alt"><div class="wrap"><div class="split">
    <div class="rev"><span class="kicker">${esc(showcase.kicker || 'The difference')}</span>
      <h2>${esc(showcase.title || '')}</h2>
      ${showcase.text ? `<p>${esc(showcase.text)}</p>` : ''}
      <ul class="ticks">${(showcase.bullets || []).slice(0, 5).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    </div>
    <div class="art rev d2">${esc(showcase.art || '✨')}</div>
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
  if (contact?.phone) links.push(`<a href="${safeHref(`tel:${contact.phone}`)}">📞 ${esc(contact.phone)}</a>`);
  if (contact?.email) links.push(`<a href="${safeHref(`mailto:${contact.email}`)}">✉️ ${esc(contact.email)}</a>`);
  if (contact?.address) links.push(`<a target="_blank" rel="noopener" href="${safeHref(contact.maps || `https://www.google.com/maps/search/${encodeURIComponent(contact.address)}`)}">📍 ${esc(contact.address)}</a>`);
  if (contact?.hours) links.push(`<a href="#">🕐 ${esc(contact.hours)}</a>`);
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

/* ══ Kind assemblies ═════════════════════════════════════════════════ */

function nav(brand, links, cta) {
  const desktop = links.map((l) => `<a href="#${l.id}">${esc(l.label)}</a>`).join('');
  return `<nav class="nav"><div class="wrap">
    <a class="brand" href="#top"><span class="dot">${esc(brand.mark || '✦')}</span>${esc(brand.name)}</a>
    <div class="nav-links">${desktop}</div>
    <a class="btn primary small desktop" href="${safeHref(cta.href)}">${esc(cta.label)}</a>
    <button class="burger" aria-label="Menu" aria-expanded="false">☰</button>
  </div>
  <div class="mobile-menu">${links.map((l) => `<a href="#${l.id}">${esc(l.label)}</a>`).join('')}<a href="${safeHref(cta.href)}" style="color:var(--accent)">${esc(cta.label)} →</a></div>
  </nav>`;
}

function heroHtml(content, { orb }) {
  const c1 = content.primary_cta || {};
  const c2 = content.secondary_cta || {};
  return `<header class="hero" id="top">
    ${orb ? '<div class="orb a"></div><div class="orb b"></div>' : ''}
    <div class="wrap">
      ${content.kicker ? `<span class="kicker" style="justify-content:center">${esc(content.kicker)}</span>` : ''}
      <h1>${esc(content.headline)}</h1>
      <p class="sub">${esc(content.sub)}</p>
      <div class="ctas">
        ${c1.label ? `<a class="btn primary" href="${safeHref(c1.href || contactHref(content) || '#')}">${esc(c1.label)}</a>` : ''}
        ${c2.label ? `<a class="btn ghost" href="${safeHref(c2.href || '#')}">${esc(c2.label)}</a>` : ''}
      </div>
      ${(content.hero_badges || []).length ? `<div class="hero-badges">${content.hero_badges.slice(0, 4).map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    </div>
  </header>`;
}

function renderLanding(content, brand) {
  const links = [
    ...(content.features?.length ? [{ id: 'features', label: 'Highlights' }] : []),
    ...(content.showcase?.title ? [{ id: 'showcase', label: 'Why us' }] : []),
    ...(content.faq?.length ? [{ id: 'faq', label: 'FAQ' }] : []),
    { id: 'contact', label: 'Contact' },
  ];
  return [
    nav(brand, links, content.primary_cta || { label: 'Contact', href: contactHref(content) }),
    heroHtml(content, { orb: true }),
    statsBlock(content.stats),
    featuresBlock(content.features, content.features_head),
    content.showcase?.title || content.showcase?.text ? `<section class="block alt" id="showcase"><div class="wrap"><div class="split">
      <div class="rev"><span class="kicker">${esc(content.showcase.kicker || 'The difference')}</span><h2>${esc(content.showcase.title || '')}</h2>${content.showcase.text ? `<p>${esc(content.showcase.text)}</p>` : ''}
      <ul class="ticks">${(content.showcase.bullets || []).slice(0, 5).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>
      <div class="art rev d2">${esc(content.showcase.art || '✨')}</div></div></div></section>` : '',
    testimonialsBlock(content.testimonials),
    content.faq?.length ? `<section class="block alt" id="faq"><div class="wrap"><div class="sec-head rev"><span class="kicker">Good to know</span><h2>Questions, answered</h2></div><div class="faq">${content.faq.slice(0, 6).map((f) => `<details class="rev"><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join('')}</div></div></section>` : '',
    ctaBand(content, brand),
  ];
}

function renderPromo(content, brand) {
  const offer = content.offer || {};
  const ends = String(offer.ends || '').trim();
  const countdown = ends
    ? `<div class="count-wrap"><div class="count" data-countdown="${esc(ends)}">
        <div class="cell"><b data-d>00</b><span>days</span></div><div class="cell"><b data-h>00</b><span>hrs</span></div>
        <div class="cell"><b data-m>00</b><span>min</span></div><div class="cell"><b data-s>00</b><span>sec</span></div>
      </div></div>`
    : '';
  return [
    nav(brand, [{ id: 'offer', label: 'The offer' }, ...(content.faq?.length ? [{ id: 'faq', label: 'FAQ' }] : [])], content.primary_cta || { label: offer.claim || 'Claim offer', href: contactHref(content) }),
    `<header class="hero" id="top"><div class="orb a"></div><div class="orb b"></div><div class="wrap">
      ${offer.badge ? `<span style="display:inline-block;background:linear-gradient(120deg,var(--accent),var(--accent2));color:var(--on-accent);font-weight:800;font-size:14px;letter-spacing:.05em;border-radius:999px;padding:9px 20px;margin-bottom:20px;box-shadow:0 10px 26px color-mix(in srgb,var(--accent) 40%,transparent)">${esc(offer.badge)}</span>` : ''}
      <h1>${esc(content.headline)}</h1>
      <p class="sub">${esc(content.sub)}</p>
      <div class="ctas"><a class="btn primary" href="${safeHref((content.primary_cta || {}).href || contactHref(content) || '#')}">${esc((content.primary_cta || {}).label || 'Claim the offer')}</a></div>
    </div></header>`,
    `<section class="block" id="offer" style="padding-top:10px"><div class="wrap"><div class="offer-wrap">
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
    content.faq?.length ? `<section class="block alt" id="faq"><div class="wrap"><div class="sec-head rev"><span class="kicker">Fine print, made friendly</span><h2>Questions</h2></div><div class="faq">${content.faq.slice(0, 5).map((f) => `<details class="rev"><summary>${esc(f.q)}</summary><div class="a">${esc(f.a)}</div></details>`).join('')}</div></div></section>` : '',
    `${offer.terms ? `<div class="wrap"><p style="text-align:center;color:var(--muted);font-size:12.5px;margin-top:18px">${esc(offer.terms)}</p></div>` : ''}`,
    ctaBand(content, brand),
  ];
}

function renderEvent(content, brand) {
  const ev = content.event || {};
  const links = [{ id: 'agenda', label: 'Agenda' }, ...(ev.speakers?.length ? [{ id: 'speakers', label: 'Speakers' }] : []), ...(ev.venue ? [{ id: 'venue', label: 'Venue' }] : []), { id: 'rsvp', label: 'RSVP' }];
  const rsvpMail = `mailto:${esc(content.contact?.email || brand.contactEmail || 'hello@example.com')}?subject=${encodeURIComponent(`RSVP — ${content.title || brand.name}`)}`;
  return [
    nav(brand, links, { label: 'RSVP now', href: rsvpMail }),
    `<header class="hero" id="top"><div class="orb a"></div><div class="orb b"></div><div class="wrap">
      ${content.kicker ? `<span class="kicker" style="justify-content:center">${esc(content.kicker)}</span>` : ''}
      <h1>${esc(content.headline)}</h1>
      <p class="sub">${esc(content.sub)}</p>
      ${(ev.date_label || ev.venue) ? `<div class="date-card"><span class="d">📅</span><span class="t">${esc([ev.date_label, ev.time_label].filter(Boolean).join(' · '))}</span><span class="v">📍 ${esc(ev.venue || '')}</span></div>` : ''}
      <div class="ctas"><a class="btn primary" href="${rsvpMail}">${esc((content.primary_cta || {}).label || 'RSVP now — it’s free')}</a></div>
    </div></header>`,
    ev.agenda?.length ? `<section class="block" id="agenda"><div class="wrap"><div class="sec-head rev"><span class="kicker">The plan</span><h2>Agenda</h2></div>
      <div class="agenda">${ev.agenda.slice(0, 8).map((a, i) => `<div class="slot rev d${(i % 3) + 1}"><div class="time">${esc(a.time)}</div><div class="what"><b>${esc(a.item)}</b>${a.who ? `<span>${esc(a.who)}</span>` : ''}</div></div>`).join('')}</div>
    </div></section>` : '',
    ev.speakers?.length ? `<section class="block alt" id="speakers"><div class="wrap"><div class="sec-head rev"><span class="kicker">Meet them</span><h2>Speakers &amp; guests</h2></div>
      <div class="grid g3">${ev.speakers.slice(0, 6).map((s, i) => `<div class="card rev d${(i % 3) + 1}" style="text-align:center"><div style="width:64px;height:64px;border-radius:50%;margin:0 auto 12px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-size:26px;font-weight:800;color:var(--on-accent)">${esc(String(s.name || '?').charAt(0).toUpperCase())}</div><h3>${esc(s.name)}</h3><p>${esc(s.role || '')}</p></div>`).join('')}</div>
    </div></section>` : '',
    ev.venue ? `<section class="block" id="venue"><div class="wrap"><div class="split">
      <div class="rev"><span class="kicker">Getting there</span><h2>${esc(ev.venue)}</h2>${ev.venue_note ? `<p>${esc(ev.venue_note)}</p>` : ''}
      <a class="btn ghost" target="_blank" rel="noopener" href="${safeHref(ev.maps || `https://www.google.com/maps/search/${encodeURIComponent(ev.venue)}`)}">Open in Maps →</a></div>
      <div class="art rev d2">📍</div></div></div></section>` : '',
    `<section class="block alt" id="rsvp"><div class="wrap" style="text-align:center">
      <div class="sec-head rev"><span class="kicker">Save your seat</span><h2>RSVP</h2><p>One tap — we’ll hold your spot.</p></div>
      <a class="btn primary" href="${rsvpMail}">${esc((content.primary_cta || {}).label || 'RSVP now')}</a>
      ${contactStrip(content.contact)}
    </div></section>`,
  ];
}

function renderPortfolio(content, brand) {
  const links = [{ id: 'work', label: 'Work' }, ...(content.skills?.length ? [{ id: 'skills', label: 'Skills' }] : []), { id: 'contact', label: 'Contact' }];
  return [
    nav(brand, links, content.primary_cta || { label: 'Hire me', href: contactHref(content) }),
    heroHtml(content, { orb: true }),
    content.work?.length ? `<section class="block" id="work"><div class="wrap"><div class="sec-head rev"><span class="kicker">Selected work</span><h2>Things I’ve made</h2></div>
      <div class="grid g3">${content.work.slice(0, 6).map(workCard).join('')}</div></div></section>` : '',
    content.skills?.length ? `<section class="block alt" id="skills"><div class="wrap"><div class="sec-head rev"><span class="kicker">Toolbox</span><h2>Skills &amp; services</h2></div>
      <div class="hero-badges" style="margin-top:0">${content.skills.slice(0, 10).map((s) => `<span style="font-size:13.5px;padding:10px 18px">${esc(s)}</span>`).join('')}</div></div></section>` : '',
    testimonialsBlock(content.testimonials),
    `<section class="block alt" id="contact"><div class="wrap" style="text-align:center">
      <div class="sec-head rev"><span class="kicker">Let’s talk</span><h2>${esc(content.cta_title || 'Have a project in mind?')}</h2><p>${esc(content.cta_sub || 'Tell me about it — I usually reply within a day.')}</p></div>
      <a class="btn primary" href="${safeHref(contactHref(content) || '#')}">${esc((content.primary_cta || {}).label || 'Start a conversation')}</a>
      ${contactStrip(content.contact)}
    </div></section>`,
  ];
}

function renderReport(content, brand) {
  const rep = content.report || {};
  return [
    nav(brand, [{ id: 'findings', label: 'Findings' }, ...(rep.table ? [{ id: 'data', label: 'Data' }] : []), ...(rep.sources?.length ? [{ id: 'sources', label: 'Sources' }] : [])], { label: 'Full report', href: '#findings' }),
    `<header class="hero" id="top" style="text-align:left;padding:72px 0 40px"><div class="wrap" style="max-width:860px">
      ${content.kicker ? `<span class="kicker">${esc(content.kicker)}</span>` : ''}
      <h1 style="margin:0 0 14px">${esc(content.headline)}</h1>
      <p class="sub" style="margin:0 0 8px">${esc(content.sub)}</p>
      <p style="color:var(--muted);font-size:13px">${esc(rep.date_label || new Date().toISOString().slice(0, 10))} · prepared by the ${esc(brand.name)} research agent</p>
    </div></header>`,
    rep.findings?.length ? `<section class="block" id="findings" style="padding-top:26px"><div class="wrap"><div class="sec-head rev"><span class="kicker">Key findings</span><h2>What the research says</h2></div>
      <div class="grid g3">${rep.findings.slice(0, 6).map((f, i) => `<div class="card rev d${(i % 3) + 1}"><div class="ico">${['①', '②', '③', '④', '⑤', '⑥'][i] || '•'}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('')}</div></div></section>` : '',
    rep.table ? `<section class="block alt" id="data"><div class="wrap"><div class="sec-head rev"><span class="kicker">The data</span><h2>${esc(rep.table.title || 'At a glance')}</h2></div>
      <div class="table-wrap rev"><table><thead><tr>${(rep.table.head || []).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${(rep.table.rows || []).slice(0, 12).map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>` : '',
    showcaseBlock(rep.insights ? { ...rep.insights, kicker: 'So what' } : null),
    rep.sources?.length ? `<section class="block" id="sources"><div class="wrap"><div class="sec-head rev"><span class="kicker">Receipts</span><h2>Sources</h2></div>
      <ul class="ticks" style="max-width:720px;margin:0 auto">${rep.sources.slice(0, 8).map((s) => `<li><a href="${safeHref(s.url)}" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">${esc(s.title || s.url)}</a></li>`).join('')}</ul></div></section>` : '',
    ctaBand(content, brand),
  ];
}

/* ══ The renderer entry point ════════════════════════════════════════ */

/**
 * renderSite({kind, design, content, brand}) → complete single-file HTML.
 * Deterministic: same inputs, same bytes. Any missing content simply
 * drops its section — the page can never be malformed.
 */
export function renderSite({ kind, design, content, brand }) {
  const v = THEMES[design.theme].vars(design.palette);
  const dNorm = { ...design, radius: design.radius };
  const parts = {
    landing: renderLanding,
    promo: renderPromo,
    event: renderEvent,
    portfolio: renderPortfolio,
    report: renderReport,
    webapp: renderLanding, // webapps use the AI path; template is the fallback shell
  }[kind] || renderLanding;

  const body = parts(content, brand).filter(Boolean).join('\n');
  const title = esc(content.title || `${brand.name} — ${kind}`);
  const desc = esc(String(content.sub || content.headline || '').slice(0, 150));

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${v.accent}">
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<title>${title}</title>
<style>${baseCss(v, dNorm)}</style>
</head><body>
<div id="nb-progress"></div>
${body}
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(brand.name)} · ${esc(content.footer_note || 'Made with Nebula Studio')}</span><span><a href="#top">Back to top ↑</a></span></div></footer>
${baseJs()}
</body></html>`;
}

