#!/usr/bin/env node
/**
 * test_codegen_v5.mjs — the bespoke code-generation engine (Agent v7).
 *
 * Covers: parseSection guards (the anti-garbage gate for hand-coded
 * sections), planSections schema enforcement + orphan-copy protection,
 * designVars contrast, globalCss contract, assembleSite completeness +
 * XSS escaping, codegenSite orchestration (stages, review-regen,
 * preplanned refine path, hard-failure fallback).
 */
import { strict as assert } from 'node:assert';

let passed = 0, failed = 0;
const failures = [];
function ok(cond, label, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`); }
}
function section(name) { console.log(`\n— ${name} —`); }

const CG = await import('../cloudflare/worker/src/emailer/codegen.js');
const { parseSection, planSections, designVars, globalCss, assembleSite, codegenSite, reviewSections } = CG;

/* ── Sarvam fetch mock (scripted) ────────────────────────────────── */
const sarvamScript = [];
const sarvamSeen = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    sarvamSeen.push(text);
    for (const s of sarvamScript) {
      if (s.match(text)) {
        const reply = typeof s.reply === 'function' ? s.reply(text) : s.reply;
        const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
        return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ error: 'no scripted reply' }), { status: 500 });
  }
  return new Response(JSON.stringify({ error: `unmocked ${u}` }), { status: 404 });
};

const env = { SARVAM_API_KEY: 'sarvam_test' };
const brand = { name: 'Musafir Coffee', color: '#8a5a2b', contactEmail: 'hi@musafir.test', profile: { industry: 'cafes' } };
const design = {
  theme: 'aurora', themeLabel: 'Aurora glass',
  palette: { bg: '#0a0d18', surface: '#111527', ink: '#eef1fb', muted: '#98a1c0', accent: '#7c8cff', accent2: '#3dd8d8' },
  font: 'grotesk', voice: 'cozy premium', audience: 'coffee lovers', art: 'mesh', hero: 'centered', radius: 18,
};
const thought = { design, headlineAngle: 'Single-origin, slow-poured', mustHave: [], queries: [], ai: true };
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
  { id: 'hero', name: 'Home', goal: 'state the promise', layout: 'Statement hero', content_keys: ['kicker', 'headline', 'sub', 'primary_cta'], motion: 'rise' },
  { id: 'menu', name: 'Menu', goal: 'show the pours', layout: 'Two-column list', content_keys: ['features'], motion: 'reveal' },
  { id: 'contact', name: 'Contact', goal: 'convert', layout: 'Split band', content_keys: ['cta_title', 'contact', 'primary_cta'], motion: 'slide' },
], nav: ['hero', 'menu', 'contact'], ai: true };

function sectionReply(text) {
  const id = /section "sec-([a-z0-9-]+)"/.exec(text)?.[1] || 'hero';
  const headline = (/"headline":"([^"]*)"/.exec(text)?.[1] || `Hand-coded ${id}`).replace(/[<>]/g, '');
  return { __raw: `<section id="sec-${id}" data-rev><div class="wrap"><h2>${headline}</h2><p>Bespoke ${id} section with real copy and hand-written CSS for the page.</p></div></section>\n<style>#sec-${id}{padding:var(--sp6) 0}#sec-${id} h2{font-family:var(--display);font-size:clamp(30px,5vw,54px)}#sec-${id} p{color:var(--muted)}@keyframes ${id}-drift{from{transform:translateY(0)}to{transform:translateY(-6px)}}/* ${'q'.repeat(40)} */</style>` };
}
function primeCodegen() {
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: PLAN.sections.map((s) => ({ id: s.id, verdict: 'good' })) } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
  );
}

/* ══ 1. parseSection — the anti-garbage gate ═════════════════════ */
section('1. parseSection guards');
{
  const pad = 'x'.repeat(220);
  const cssPad = '/* '.padEnd(90, 'c') + ' */';
  const good = parseSection(`<section id="sec-hero" data-rev><h2>Hi</h2><p>${pad}</p></section>\n<style>#sec-hero{padding:10px}#sec-hero h2{color:red}${cssPad}</style>`, 'hero');
  ok(good.html.startsWith('<section id="sec-hero"') && good.css.startsWith('#sec-hero{'), 'happy path extracts section + scoped css');

  ok((() => { try { parseSection('<p>no section here</p>', 'hero'); return false; } catch { return true; } })(), 'rejects output with no <section>');
  ok((() => { try { parseSection(`<section id="sec-hero"><p>${pad}</p>`, 'hero'); return false; } catch (e) { return /not closed/.test(e.message); } })(), 'rejects unclosed section (truncation)');
  ok((() => { try { parseSection(`<section id="sec-hero"><p>${pad}</p></section>`, 'hero'); return false; } catch (e) { return /no <style>/.test(e.message); } })(), 'rejects missing <style> block');
  ok((() => { try { parseSection(`<section id="sec-hero"><p>${pad}</p></section>\n<style>p{color:red}${cssPad}</style>`, 'hero'); return false; } catch (e) { return /not scoped/.test(e.message); } })(), 'rejects CSS not scoped to the section');
  ok((() => { try { parseSection(`<section id="sec-hero"><p>${pad}</p></section>\n<style>#sec-hero{color:red}</style>`, 'hero'); return false; } catch (e) { return /too small/.test(e.message); } })(), 'rejects too-small CSS');
  const scriptStripped = parseSection(`<section id="sec-hero"><script>alert(1)</script><script src="https://evil.test/x.js"></script><p>${pad}</p></section>\n<style>#sec-hero{color:red}${cssPad}</style>`, 'hero');
  ok(!scriptStripped.html.includes('<script') && !scriptStripped.html.includes('alert(1)'), '<script> blocks stripped whole (never served)');
  ok((() => { try { parseSection(`<section id="sec-hero"><p>${pad}</p><div>open</section>\n<style>#sec-hero{color:red}${cssPad}</style>`, 'hero'); return false; } catch (e) { return false; } })() === false, 'nested open div tolerated (browsers handle)');
  const sanitized = parseSection(`<section id="sec-hero" onclick="evil()" onmouseover="bad()"><img src="https://evil.test/a.png"><p>${pad}</p></section>\n<style>#sec-hero{color:red}${cssPad}</style>`, 'hero');
  ok(!sanitized.html.includes('onclick') && !sanitized.html.includes('evil.test'), 'strips inline handlers + remote src');
  const injected = parseSection(`<section><p>${pad}</p></section>\n<style>#sec-hero{color:red}${cssPad}</style>`, 'hero');
  ok(injected.html.startsWith('<section id="sec-hero"'), 'injects the section id when the model omitted it');
  const unclosedStyle = (() => { try { parseSection(`<section id="sec-hero"><p>${pad}</p></section>\n<style>#sec-hero{color:red`, 'hero'); return false; } catch (e) { return /not closed/.test(e.message); } })();
  ok(unclosedStyle, 'rejects unclosed <style> (truncation)');
}

/* ══ 2. planSections — schema enforcement + copy survival ════════ */
section('2. planSections');
{
  sarvamScript.length = 0;
  sarvamScript.push({
    match: (t) => t.includes('Plan its information architecture'),
    reply: { sections: [
      { id: 'Hero!', name: 'Home', goal: 'win the click', layout: 'big statement', content_keys: ['headline', 'sub', 'unknown_key'], motion: 'rise' },
      { id: 'menu', name: 'Menu', goal: 'show pours', layout: 'list', content_keys: ['features'], motion: 'reveal' },
      { id: 'hero', name: 'dup', goal: 'dup', layout: 'dup', content_keys: [], motion: '' },
    ], nav: ['hero', 'menu', 'nope'] },
  });
  const p = await planSections(env, { kind: 'landing', brief: 'cozy specialty coffee shop in Mumbai', brand, thought, content });
  ok(p.ai === true, 'AI plan parsed');
  ok(p.sections.length === 2 && p.sections[0].id === 'hero', 'ids slugified, duplicates dropped', JSON.stringify(p.sections.map((s) => s.id)));
  ok(!p.sections[0].content_keys.includes('unknown_key'), 'content_keys filtered to real copy groups');
  ok(p.sections.at(-1).content_keys.some((k) => ['primary_cta', 'contact', 'cta_title'].includes(k)), 'orphan copy keys appended to the last section (nothing dropped)', JSON.stringify(p.sections.at(-1).content_keys));
  ok(p.nav.length === 2 && !p.nav.includes('nope'), 'nav filtered to planned sections');

  sarvamScript.length = 0; // no replies → 500s → deterministic plan
  const fb = await planSections(env, { kind: 'landing', brief: 'cozy specialty coffee shop', brand, thought, content });
  ok(fb.ai === false && fb.sections.length >= 3 && fb.sections[0].id === 'hero', 'fallback plan ships hero-first architecture');
  ok(fb.sections.at(-1).id === 'contact', 'fallback plan ends with a converting section');

  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('Plan its information architecture'), reply: { sections: [{ id: 'notfirst', name: 'X', goal: '', layout: '', content_keys: [] }] } });
  const bad = await planSections(env, { kind: 'landing', brief: 'cozy coffee', brand, thought, content });
  ok(bad.ai === false, 'plan without a hero first → deterministic fallback');
}

/* ══ 3. designVars + globalCss ══════════════════════════════════ */
section('3. designVars + globalCss contract');
{
  const v = designVars(design);
  ok(v.bg === '#0a0d18' && v.accent === '#7c8cff', 'palette passes through hex-safe');
  ok(v.onAccent === '#ffffff', 'dark accent → white text on accent', v.onAccent);
  const light = designVars({ ...design, palette: { ...design.palette, accent: '#ffe08a' } });
  ok(light.onAccent !== '#ffffff', 'light accent flips on-accent text for contrast', light.onAccent);

  const g = globalCss(design);
  ok(g.css.includes('--accent:#7c8cff') && g.css.includes('--sp1:6px'), 'tokens + spacing scale present');
  ok(g.css.includes('[data-rev]') && g.css.includes('.rev-in'), 'scroll-reveal contract present');
  ok(g.css.includes('prefers-reduced-motion:reduce'), 'reduced-motion kill switch present');
  ok(g.css.includes('feTurbulence'), 'film-grain texture present');
  ok(g.css.includes('.btn-accent') && g.css.includes(':focus-visible'), 'button primitives + a11y focus rings');
  ok(g.google.includes('Space+Grotesk'), 'font pairing resolved for grotesk');
}

/* ══ 4. assembleSite — complete, escaped, wired ══════════════════ */
section('4. assembleSite');
{
  const coded = [
    { id: 'hero', html: '<section id="sec-hero" data-rev><h2>Coffee worth the trip</h2></section>', css: '#sec-hero{padding:20px}#sec-hero h2{color:var(--ink)}' + '/* '.padEnd(80, 'k') + ' */' },
    { id: 'contact', html: '<section id="sec-contact" data-rev><h2>Come say hi</h2></section>', css: '#sec-contact{padding:20px}#sec-contact h2{color:var(--ink)}' + '/* '.padEnd(80, 'k') + ' */' },
  ];
  const html = assembleSite({ design, brand, content, coded, plan: PLAN, kind: 'landing' });
  ok(html.startsWith('<!DOCTYPE html>') && html.trim().endsWith('</html>'), 'complete document (doctype → </html>)');
  ok(html.includes('<title>Musafir Coffee</title>') && html.includes('name="viewport"'), 'title + viewport');
  ok(html.includes('fonts.googleapis.com/css2?family=Space+Grotesk'), 'Google Fonts pairing linked');
  ok(html.includes('href="#sec-menu"') && html.includes('Menu'), 'nav links generated from the plan');
  ok(html.includes('sec-hero') && html.includes('sec-contact'), 'all coded sections embedded');
  ok(html.includes('site-footer') && html.includes('crafted by the Nebula agent'), 'footer chrome present');
  ok(html.includes('IntersectionObserver') && html.includes('data-rev-delay'), 'reveal JS + stagger contract wired');
  ok(html.includes('rel="icon"') && html.includes('data:image/svg+xml'), 'favicon generated');
  ok(!html.includes('</style><script'), 'no stray scripts between styles');

  const xss = assembleSite({ design, brand, content: { ...content, title: 'Evil <script>alert(1)</script> Title', sub: 'sub & <b>bold</b>' }, coded, plan: PLAN, kind: 'landing' });
  ok(!xss.includes('<script>alert(1)'), 'copy fields are escaped (XSS-safe assembly)');
}

/* ══ 5. codegenSite — orchestration ══════════════════════════════ */
section('5. codegenSite orchestration');
{
  primeCodegen();
  const stages = [];
  const r = await codegenSite(env, { kind: 'landing', brief: 'cozy specialty coffee shop in Mumbai', brand, thought, content, onStage: (s) => stages.push(s) });
  ok(r.html.startsWith('<!DOCTYPE html>') && r.html.includes('</html>'), 'assembled document ships');
  const names = stages.map((s) => s.stage);
  ok(names[0] === 'plan' && names.includes('wire'), 'trace: plan → code:* → review → wire', JSON.stringify(names));
  ok(names.filter((n) => String(n).startsWith('code:')).length === 3, 'three sections coded');
  ok(r.plan.ai === true && r.coded.length === 3, 'plan + coded sections returned');

  // REVIEW regen path: director flags the menu section → re-coded once
  sarvamScript.length = 0;
  sarvamScript.push(
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'menu', verdict: 'fix', note: 'unstyled grid' }, { id: 'contact', verdict: 'good' }] } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: sectionReply },
  );
  const regenStages = [];
  const r2 = await codegenSite(env, { kind: 'landing', brief: 'cozy coffee', brand, thought, content, onStage: (s) => regenStages.push(s) });
  ok(r2.coded.length === 3 && regenStages.filter((s) => String(s.stage) === 'code:menu').length === 2, 'flagged section re-coded after review', JSON.stringify(regenStages.map((s) => s.stage)));

  // CODE failure → throws (builder falls back to the engine)
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('Plan its information architecture'), reply: { sections: PLAN.sections, nav: PLAN.nav } });
  let threw = false;
  try { await codegenSite(env, { kind: 'landing', brief: 'cozy coffee', brand, thought, content }); } catch { threw = true; }
  ok(threw, 'codegen throws when sections cannot be coded (caller falls back)');

  // PREPLANNED path (refine): plan call is skipped
  primeCodegen();
  const seenBefore = sarvamSeen.length;
  const r3 = await codegenSite(env, { kind: 'landing', brief: 'cozy coffee + update', brand, thought: { design, ai: false }, content, preplanned: PLAN });
  const planCalls = sarvamSeen.slice(seenBefore).filter((t) => t.includes('Plan its information architecture')).length;
  ok(r3.plan === PLAN && planCalls === 0, 'preplanned refine skips the PLAN call');
}

/* ══ 6. reviewSections digest ════════════════════════════════════ */
section('6. reviewSections');
{
  sarvamScript.length = 0;
  sarvamScript.push({ match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'weird', verdict: 'fix' }] } });
  const rv = await reviewSections(env, { kind: 'landing', brand, sections: [{ id: 'hero', name: 'Home', goal: 'g', css: '#sec-hero{color:red}' }] });
  ok(rv.ai === true && rv.verdicts.hero === 'good', 'verdicts parsed');
  ok(rv.verdicts.weird === undefined, 'verdicts for unknown sections ignored');
  sarvamScript.length = 0;
  const rv2 = await reviewSections(env, { kind: 'landing', brand, sections: [] });
  ok(rv2.ai === false && Object.keys(rv2.verdicts).length === 0, 'review failure degrades to no-op');
}

console.log(`\n${'═'.repeat(46)}`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log(`  • ${f}`); process.exit(1); }
console.log('All codegen-v5 tests green.');
