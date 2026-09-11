#!/usr/bin/env node
/**
 * smoke_v10_render.mjs — assembles a real v10 page through the mock
 * pipeline and verifies the served document: v10 tokens, motion system,
 * texture, nav/footer, sanitization. Writes the page to /tmp for
 * eyeballing and prints the key quality markers.
 */
const sarvamScript = [];
let ddgUp = true;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    const text = JSON.parse(body).messages?.map((m) => m.content).join('\n') || '';
    for (const s of sarvamScript) {
      if (s.match(text)) {
        const reply = typeof s.reply === 'function' ? s.reply(text) : s.reply;
        const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
        return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
      }
    }
    return new Response('{"error":"no script"}', { status: 500 });
  }
  if (u.startsWith('https://html.duckduckgo.com/html/')) {
    if (!ddgUp) return new Response('x', { status: 403 });
    const a = '<a class="result__a" href="https://e.com/1">Specialty coffee grows 15% in Mumbai</a><a class="result__snippet" href="#">2024 growth data</a>';
    return new Response(`<html>${a}</html>`, { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const A = await import('../cloudflare/worker/src/emailer/agents.js');
const D = await import('../cloudflare/worker/src/emailer/designer.js');
const B = await import('../cloudflare/worker/src/emailer/builder.js');

const brand = { name: 'Musafir Coffee', color: '#8a5a2b', contactEmail: 'hi@musafir.test', profile: { industry: 'cafes' } };
const content = {
  title: 'Musafir Coffee', kicker: 'Mumbai', headline: 'Coffee worth the trip',
  sub: 'Single-origin pours and weekend cuppings.', primary_cta: { label: 'Find us', href: 'mailto:hi@musafir.test' },
  secondary_cta: null, hero_badges: ['Since 2019'], marquee: [], stats: [],
  features: [{ icon: '☕', title: 'Single origin', text: 'Coorg beans.' }],
  testimonials: [], faq: [], offer: null, event: null, work: [], skills: [], report: null,
  contact: { email: 'hi@musafir.test', phone: '', address: '', hours: '' },
  cta_title: 'Come say hi', cta_sub: '', footer_note: 'Made with Nebula',
};
const PLAN = { sections: [
  { id: 'hero', name: 'Home', goal: 'state the promise', journey: 'land → promise', layout: 'Statement hero', content_keys: ['kicker', 'headline', 'sub', 'primary_cta'], motion: 'rise' },
  { id: 'menu', name: 'Menu', goal: 'show the pours', journey: 'scan → proof', layout: 'Two-column list', content_keys: ['features'], motion: 'reveal' },
  { id: 'contact', name: 'Contact', goal: 'convert', journey: 'act → booking', layout: 'Split band', content_keys: ['cta_title', 'contact', 'primary_cta'], motion: 'slide' },
], nav: ['hero', 'menu', 'contact'], ai: true };

function sectionReply(text) {
  const id = /section "sec-([a-z0-9-]+)"/.exec(text)?.[1] || 'hero';
  return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><h2>Hand-built ${id}</h2><p>Bespoke section copy with real craft and hand-written CSS for this business.</p></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:var(--step-4);letter-spacing:-.02em}#sec-${id} p{color:var(--muted)}#sec-${id} h2:hover{color:var(--accent)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'q'.repeat(40)} */</style>` };
}

sarvamScript.push(
  { match: (t) => t.includes('EXECUTION PLAN'), reply: { audience: 'coffee lovers in mumbai', page_goal: 'book tables', research_focus: 'market', queries: ['mumbai specialty coffee'], sections_target: 4, emphasis: ['menu tactile'], risks: ['generic'], tone_note: 'warm' } },
  { match: (t) => t.includes('DEEP-THINK'), reply: { verdict: 'sharpen', extra_emphasis: ['hero must smell of the roast'], extra_risks: [], angle: 'one origin, poured slowly', extra_query: 'cupping workshop prices mumbai', depth: 'deep' } },
  { match: (t) => t.includes('PROJECT UNDERSTANDING'), reply: { business_model: 'cafe sales', audience_psyche: 'ritual seekers', competitive_context: 'chains', voice_spec: 'warm specific', success_metric: 'workshop booked', objections: ['price'] } },
  { match: (t) => t.includes('MARKET INTELLIGENCE'), reply: { facts: ['15% specialty growth 2024', 'Cold brew ₹280-350'], implication: 'lead with origin', follow_up: '' } },
  { match: (t) => t.includes('Decide the design system'), reply: { theme: 'onyx', palette: { bg: '#050505', surface: '#101014', ink: '#e8e8f0', muted: '#9a9aa8', accent: '#c8a24a', accent2: '#7c8cff' }, font: 'grotesk', type_scale: 'dramatic', texture: 'grain', motion_intensity: 'bold', ux_flow: ['land → promise', 'scan → proof', 'act → booking'], voice: 'warm specific', audience: 'coffee ritualists', headline_angle: 'One origin, poured slowly', must_have: [], research_queries: [] } },
  { match: (t) => t.includes('conversion copywriter'), reply: { ...content, headline: 'One origin, poured slowly' } },
  { match: (t) => t.includes('FINAL review'), reply: { verdict: 'good' } },
  { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
  { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: PLAN.sections.map((s) => ({ id: s.id, verdict: 'good' })) } },
  { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
  { match: (t) => t.includes('After every finished build'), reply: { title: 'onyx heroes convert with restraint', domain: 'design', body: 'Keep one accent and huge type on onyx; hairline dividers beat boxes for premium reads.' } },
  { match: (t) => t.includes('DURABLE SKILLS'), reply: { title: 'Cafe heroes sell scent first', domain: 'copy', body: 'Lead cafe hero copy with roast and aroma words before price; visitors scan for freshness cues.', source: 'synthesis' } },
);

const store = (() => { const m = new Map(); return { async get(k) { return m.get(k) ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); }, __map: m }; })();
const MEDIA = { async put(k, v) { this.__map = this.__map || new Map(); this.__map.set(k, v); return { k }; }, async get(k) { const e = this.__map?.get(k); return e ? { text: async () => e.value } : null; }, async head() { return null; } };
const env = { SARVAM_API_KEY: 'k', MEDIA };

const res = await B.buildWebsite(env, store, { uid: 'u_smoke', displayName: 'Owner' },
  { title: 'Musafir Coffee', kind: 'landing', brief: 'A cozy specialty coffee shop in Mumbai with single-origin pours and weekend cupping workshops.' }, 'https://worker.test');

const html = (MEDIA.__map.get('sites/' + res.artifact_id + '.html') || '') + '';
const checks = [
  ['ok', res.ok === true],
  ['builder=ai', res.builder === 'ai'],
  ['deep run', res.deep === true],
  ['understanding artifact', !!res.understanding?.success_metric],
  ['complete doc', html.startsWith('<!DOCTYPE html>') && html.trim().endsWith('</html>')],
  ['v10 accent-soft', html.includes('--accent-soft:')],
  ['v10 step tokens', html.includes('--step-0:')],
  ['v10 shadow tokens', html.includes('--shadow-lift:')],
  ['bold motion 34px', html.includes('translateY(34px)')],
  ['dramatic scale', html.includes('--step-4:clamp(2.4rem')],
  ['grain texture', html.includes('feTurbulence')],
  ['nav + footer', html.includes('site-nav') && html.includes('site-footer')],
  ['reveal JS', html.includes('IntersectionObserver')],
  ['no remote scripts', !/<script[^>]*src/.test(html)],
  ['no inline handlers', !/\son\w+=/.test(html)],
  ['deep-think in prompts', html.length > 5000],
  ['team rows', (res.team || []).length >= 12],
  ['analyst traced', (res.team || []).some((r) => r.agent === 'Analyst')],
  ['skill researcher traced', (res.team || []).some((r) => r.agent === 'Skill Researcher')],
  ['library grew to 2', (() => { try { return JSON.parse(store.__map.get('skills:library:u_smoke')).length === 2; } catch { return false; } })()],
];
let bad = 0;
for (const [label, pass] of checks) { console.log(`  ${pass ? '✓' : '✗'} ${label}`); if (!pass) bad++; }
const fs = await import('node:fs');
fs.writeFileSync('/tmp/v10_smoke.html', html);
console.log(`\nwritten /tmp/v10_smoke.html (${html.length} bytes) · agents=${res.team_summary?.agents} ai_calls=${res.team_summary?.ai_calls} failed=${res.team_summary?.failed}`);
process.exit(bad ? 1 : 0);
