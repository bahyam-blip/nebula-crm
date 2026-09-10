#!/usr/bin/env node
/** Render sample pages from the v3 engine for visual inspection. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderSite, normalizeDesign } from '../cloudflare/worker/src/emailer/site_templates.js';

const outDir = '/home/z/my-project/scripts/site_previews';
mkdirSync(outDir, { recursive: true });

const brand = { name: 'Musafir', color: '#c98a4b', contactEmail: 'hello@musafir.cafe', mark: 'M' };
const content = {
  title: 'Musafir Cafe — Specialty Coffee, Mumbai',
  kicker: 'Musafir',
  headline: 'Coffee worth slowing down for',
  sub: 'Single-origin pours, slow mornings and weekend cuppings at our Bandra bar.',
  primary_cta: { label: 'Reserve a table', href: 'https://wa.me/919999999999' },
  secondary_cta: { label: 'See the menu', href: '#menu' },
  hero_badges: ['Since 2019', '4.9 rated', 'Bandra West'],
  marquee: ['Single Origin', 'Slow Brews', 'Weekend Cuppings', 'Fresh Bakes'],
  stats: [{ value: '12', label: 'single origins on the bar' }, { value: '40k+', label: 'cups poured' }, { value: '4.9', label: 'Google rating' }],
  features: [
    { icon: '☕', title: 'Beans from Coorg', text: 'Estate-direct lots, roasted every Monday and rested to day five before they hit the grinder.' },
    { icon: '🥐', title: 'Bakes at 8am', text: 'Croissants, sourdough toasts and a rotating bake case — out of the oven before the first pour.' },
    { icon: '🎧', title: 'Room to stay', text: 'Laptop-friendly nooks, vinyl on weekends and a no-rush policy we actually mean.' },
  ],
  testimonials: [{ quote: 'The best flat white I have had outside Melbourne. The cupping sessions are worth the wake-up.', name: 'Aisha K.', role: 'Regular, Bandra' }],
  faq: [
    { q: 'Do you take reservations?', a: 'Walk-ins always; tables of 4+ can reserve on WhatsApp.' },
    { q: 'Vegan milk?', a: 'Oat, soy and almond at no extra charge.' },
  ],
  contact: { email: 'hello@musafir.cafe', phone: '+91 98200 00000', address: '12 Hill Road, Bandra West, Mumbai', hours: '8am – 11pm daily' },
  cta_title: 'Come slow down with us',
  cta_sub: 'Walk in, or save a table for the weekend.',
  footer_note: 'Musafir Cafe · Made with Nebula',
};

const themes = ['onyx', 'aurora', 'editorial', 'swiss'];
for (const theme of themes) {
  const design = normalizeDesign({ theme, palette: {}, font: '', hero: theme === 'onyx' ? 'split' : '', art: theme === 'onyx' ? 'rings' : '' }, { kind: 'landing', styleHint: '', brandColor: brand.color });
  const html = renderSite({ kind: 'landing', design, content, brand });
  writeFileSync(`${outDir}/${theme}.html`, html);
  console.log(theme, '→', `${outDir}/${theme}.html`, `(${(html.length / 1024).toFixed(1)} KB)`);
}
