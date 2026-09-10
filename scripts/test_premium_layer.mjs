#!/usr/bin/env node
/**
 * Verifies the site-engine PREMIUM POLISH LAYER (design language 2.0):
 * every rendered page must carry the new motion/polish system, and the
 * engine must stay deterministic + escape model copy.
 */
import { renderSite, normalizeDesign, themeForStyleHint } from '../cloudflare/worker/src/emailer/site_templates.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

const brand = { name: 'Test Cafe', color: '#7c8cff', contactEmail: 'hi@test.com' };
const design = normalizeDesign({ theme: 'aurora', palette: {}, font: 'modern' }, { kind: 'landing', styleHint: '', brandColor: '#7c8cff' });
const content = {
  title: 'Test Cafe — Landing',
  kicker: 'Test', headline: 'Great coffee, zero wait', sub: 'Order ahead and skip the line.',
  primary_cta: { label: 'Order now', href: 'https://order.test.com' },
  hero_badges: ['Fast pickup'],
  stats: [{ value: '1,200+', label: 'cups a day' }, { value: '4.9', label: 'rating' }],
  features: [{ icon: '☕', title: 'Fresh roasts', text: 'Ground daily.' }],
  faq: [{ q: 'Vegan milk?', a: 'Yes — oat, soy, almond.' }],
  footer_note: 'Made with Nebula Studio',
};

const html = renderSite({ kind: 'landing', design, content, brand });
const html2 = renderSite({ kind: 'landing', design, content, brand });

console.log('Premium polish layer:');
ok('scroll progress bar div present', html.includes('<div id="nb-progress"></div>'));
ok('scroll progress JS wired', html.includes("prog.style.width="));
ok('hero entrance choreography (blur-in rise reveals)', html.includes('.rev{opacity:0;translate:0 26px;filter:blur(6px)') && html.includes('.rev.in') && html.includes('.rev.d1{transition-delay:.08s}'));
ok('drifting aurora orbs', html.includes('@keyframes drift') && html.includes('animation:drift'));
ok('animated shine on primary buttons', html.includes('@keyframes shine') && html.includes('.btn.primary::after'));
ok('card glass-edge highlight', html.includes('.card::before'));
ok('accent selection + styled scrollbars', html.includes('::selection') && html.includes('::-webkit-scrollbar-thumb'));
ok('focus-visible accessibility ring', html.includes(':focus-visible'));
ok('stat counters runtime', html.includes('animated stat counters') && html.includes('requestAnimationFrame(step)'));
ok('orb parallax runtime', html.includes('orb parallax'));
ok('reduced-motion kills all new motion', html.includes('.rev{opacity:1;translate:0 0;filter:none}') && html.includes('animation-duration:.001s!important'));
ok('counter guards en-IN locale', html.includes("toLocaleString('en-IN'"));
ok('reduced-motion guard in counters', html.includes('&&!rm)'));
ok('deterministic render unchanged', html === html2);
ok('model copy escaped', html.includes('Great coffee, zero wait') && !html.includes('<script src'));
ok('document complete', html.startsWith('<!DOCTYPE html>') && html.trim().endsWith('</html>'));

// fallback theme sanity across all 6 themes still render with polish layer
for (const t of ['aurora', 'luxe', 'editorial', 'swiss', 'festive', 'playful']) {
  const d = normalizeDesign({ theme: t, palette: {}, font: '' }, { kind: 'promo', styleHint: '', brandColor: '' });
  const h = renderSite({ kind: 'promo', design: d, content: { title: 't', headline: 'h', sub: 's', primary_cta: { label: 'x', href: '#' }, offer: { badge: '40% OFF', price: '₹99', perks: ['a'] } }, brand });
  ok(`theme ${t} renders with polish layer`, h.includes('nb-progress') && h.includes('@keyframes drift') && h.includes('.rev.in'));
}

ok('style hint mapping intact', themeForStyleHint('dark premium', 'landing') === 'aurora' && themeForStyleHint('minimal clean', 'landing') === 'swiss');

console.log(`\n  PASSED: ${pass}   FAILED: ${fail}`);
process.exit(fail ? 1 : 0);
