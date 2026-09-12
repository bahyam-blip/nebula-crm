/**
 * AGENT V12 · MASTERY — the test suite.
 *
 * Covers instruction #17, as invariants:
 *   1. MASTERY KNOWLEDGE CORE — CSS-global / wiring / motion / policy /
 *      hosting / full-stack / languages packs exist, are expert-grade and
 *      bounded; masteryBlock enforces the budget (Sarvam-safe).
 *   2. MILLIONS OF COLOURS — expandPalette turns one seed hue into a full
 *      token set + 10-step ramp; harmony accents stay hue-derived; two
 *      different seeds ship different ramps; contrast discipline holds.
 *   3. MILLIONS OF FONTS — 40+ curated pairings; deterministic pick;
 *      DNA mood weighting actually biases the choice; every pairing has
 *      a real Google Fonts families string.
 *   4. POLICY SENSE — booking/commerce briefs demand privacy+legal;
 *      health/finance demand disclaimers; a plain brochure doesn't.
 *   5. ASSEMBLY v12 — SEO head (OG/Twitter/robots), JSON-LD, wiring JS,
 *      inline legal, NO tool credit, canonical injection.
 *   6. ENGINEER MASTERY — the section contract carries the mastery block
 *      and the ramp tokens.
 *   7. WEBAPP PLAN-BEFORE-CODE — planWebapp plans features + data model;
 *      the coding prompt carries the plan; the signature app no longer
 *      crashes (the `brand` ReferenceError).
 *   8. SUBSCRIPTIONS — plan catalog, quota gate before the build,
 *      consumption after the ship, expiry, checkout orders, owner grant.
 *   9. DESIGN DNA × MASTERY — designer attaches ramp + fontPair on BOTH
 *      the AI and fallback paths.
 */

import { strict as assert } from 'node:assert';
import * as MZ from '../cloudflare/worker/src/emailer/mastery.js';
import * as D from '../cloudflare/worker/src/emailer/designer.js';
import * as ST from '../cloudflare/worker/src/emailer/site_templates.js';
import * as CG from '../cloudflare/worker/src/emailer/codegen.js';
import * as BLD from '../cloudflare/worker/src/emailer/builder.js';
import * as PL from '../cloudflare/worker/src/emailer/plans.js';
import * as SB from '../cloudflare/worker/src/emailer/sitebrand.js';

let passed = 0;
const failures = [];
function ok(cond, label, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${label} ${detail}`); }
}
function section(name) { console.log(`\n— ${name} —`); }

/* ══ harness ══ */
function memStore() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

// Scripted Sarvam + R2-style MEDIA — the same harness pattern as the
// v9/v10/v11 suites: globalThis.fetch is the seam.
let sarvamDown = false;
const sarvamSeen = [];
const sarvamScript = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';
  if (u.startsWith('https://api.sarvam.ai/')) {
    if (sarvamDown) throw new Error('network down');
    const parsed = JSON.parse(body);
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    sarvamSeen.push(text);
    for (const s of sarvamScript) {
      if (s.re.test(text)) {
        const reply = typeof s.reply === 'function' ? s.reply(text) : s.reply;
        const content = reply && reply.__raw !== undefined ? reply.__raw : JSON.stringify(reply);
        return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ error: 'no scripted reply' }), { status: 500 });
  }
  if (u.includes('wikipedia') || u.includes('openverse') || u.includes('duckduckgo')) {
    return new Response(u.includes('duckduckgo') ? '<html></html>' : JSON.stringify({ results: [], query: { pages: {} } }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: `unmocked ${u}` }), { status: 404 });
};

function makeEnv() {
  const MEDIA = new Map();
  return {
    SARVAM_API_KEY: 'sarvam_test',
    MEDIA: {
      put: async (k, v) => { MEDIA.set(k, String(v)); return { key: k }; },
      get: async (k) => (MEDIA.has(k) ? { text: async () => MEDIA.get(k) } : null),
      head: async (k) => (MEDIA.has(k) ? { size: MEDIA.get(k).length, customMetadata: {} } : null),
    },
    __MEDIA: MEDIA,
  };
}

/* ══ 1. MASTERY KNOWLEDGE CORE ══ */
section('MASTERY KNOWLEDGE CORE');
{
  const packs = {
    css: MZ.cssGlobalPack(),
    color: MZ.colorPack(),
    motion: MZ.motionPack('bold'),
    wiring: MZ.wiringPack(),
    hosting: MZ.hostingPack('landing'),
    fullstack: MZ.fullstackPack(),
    languages: MZ.languagesPack(),
  };
  for (const [name, pack] of Object.entries(packs)) {
    ok(typeof pack === 'string' && pack.length > 300, `pack "${name}" exists and is expert-grade (${pack.length} chars)`);
    ok(pack.length < 2200, `pack "${name}" is bounded (${pack.length} < 2200)`);
  }
  ok(/var\(--accent\)|color-mix|clamp\(/.test(packs.css), 'CSS pack teaches real modern CSS (custom props, color-mix, clamp)');
  ok(/details\.acc|data-tab|data-validate/.test(packs.wiring), 'wiring pack defines the behavior-layer contract');
  ok(/prefers-reduced-motion/.test(packs.motion), 'motion pack respects reduced motion');
  ok(/JSON-LD|canonical|loading="lazy"|display=swap/.test(packs.hosting), 'hosting pack covers SEO + performance rules');
  ok(/localStorage|schema/i.test(packs.fullstack), 'fullstack pack covers data modeling + offline');

  const block = MZ.masteryBlock([packs.css, packs.wiring, packs.motion, packs.languages], { maxChars: 3400 });
  ok(block.length <= 3400, `masteryBlock honors the budget (${block.length} <= 3400)`);
  ok(block.includes('CSS GLOBAL LAW') && block.includes('WIRING CONTRACT'), 'masteryBlock joins the selected packs');

  // The motion pack scales by intensity.
  ok(MZ.motionPack('calm') !== MZ.motionPack('bold'), 'motion grammar differs by intensity');
}

/* ══ 2. MILLIONS OF COLOURS ══ */
section('MILLIONS OF COLOURS (expandPalette)');
{
  const p1 = MZ.expandPalette('#15803d', { theme: 'swiss', seed: 7 });
  ok(/^#[0-9a-f]{6}$/i.test(p1.accent) && /^#[0-9a-f]{6}$/i.test(p1.bg), 'tokens are real hex');
  ok(Object.keys(p1.ramp).length >= 10, `10-step ramp generated (${Object.keys(p1.ramp).length} steps)`);
  ok(p1.accent2.toLowerCase() !== p1.accent.toLowerCase(), 'harmony second-accent differs from the primary');
  ok(MZ.HARMONIES[p1.harmony], `harmony is one of the five (${p1.harmony})`);
  // Same inputs → same palette (deterministic).
  const p1b = MZ.expandPalette('#15803d', { theme: 'swiss', seed: 7 });
  ok(p1b.accent === p1.accent && p1b.ramp[500] === p1.ramp[500], 'deterministic: same seed → same palette');
  // Different seeds explore the space (the "millions" half).
  const accents = new Set();
  for (let s = 0; s < 40; s++) accents.add(MZ.expandPalette('#15803d', { theme: 'onyx', seed: s }).accent);
  ok(accents.size >= 8, `40 seeds yield ${accents.size} distinct accents (exploration, not repetition)`);
  // Ramp descends in lightness.
  const lums = [200, 500, 800].map((k) => MZ.hexToHsl(p1.ramp[k]).l);
  ok(lums[0] > lums[1] && lums[1] > lums[2], `ramp lightness descends (${lums.map((x) => x.toFixed(0)).join(' > ')})`);
  // Dark theme neutrals carry a whisper of the hue, never dead gray.
  const dark = MZ.expandPalette('#7c3aed', { theme: 'onyx', seed: 3 });
  ok(MZ.hexToHsl(dark.bg).l < 15 && MZ.hexToHsl(dark.bg).s > 0, 'dark bg is deep AND hue-tinted');
  // HSL↔hex round trip.
  const rt = MZ.hslToHex(MZ.hexToHsl('#e11d48'));
  ok(MZ.hexToHsl(rt).h !== undefined, 'hex→hsl→hex stays well-formed');
}

/* ══ 3. MILLIONS OF FONTS ══ */
section('MILLIONS OF FONTS (pairing library)');
{
  ok(MZ.FONT_PAIRINGS.length >= 40, `${MZ.FONT_PAIRINGS.length} curated pairings (>=40)`);
  const ids = new Set(MZ.FONT_PAIRINGS.map((p) => p.id));
  ok(ids.size === MZ.FONT_PAIRINGS.length, 'all pairing ids unique');
  for (const p of MZ.FONT_PAIRINGS.slice(0, 50)) {
    assert.ok(p.display && p.body && p.google && Array.isArray(p.moods));
  }
  ok(MZ.FONT_PAIRINGS.every((p) => p.google.includes('+') || p.google.includes(':')), 'every pairing has a real Google Fonts families string');
  const bakery = MZ.fontPairFor({ dnaName: 'Sandstone', theme: 'editorial', brief: 'bakery menu with warm bread photos', kind: 'landing', seed: 2 });
  ok(bakery && bakery.display && bakery.body, `deterministic pairing picked (${bakery.display} × ${bakery.body})`);
  const bakery2 = MZ.fontPairFor({ dnaName: 'Sandstone', theme: 'editorial', brief: 'bakery menu with warm bread photos', kind: 'landing', seed: 2 });
  ok(bakery === bakery2 || (bakery.display === bakery2.display && bakery.body === bakery2.body), 'same inputs → same pairing');
  // Mood weighting: a food brief must rank food-mood pairings highly.
  const kids = MZ.fontPairFor({ dnaName: 'Coral Pop', theme: 'playful', brief: 'kids toy store playful', kind: 'landing', seed: 0 });
  ok(kids.moods.includes('playful') || kids.moods.includes('kids'), 'brief mood biases the pairing (kids/toy → playful family)');
}

/* ══ 4. POLICY SENSE ══ */
section('POLICY SENSE (reads the brief like a compliance officer)');
{
  const booking = MZ.policyNeeds('Dental clinic booking page with an appointment form and patient testimonials', 'landing');
  ok(booking.collectsData && booking.testimonials, 'detects data collection + testimonials');
  ok(booking.legalLinks, 'data collection → Privacy/Terms required');
  ok(booking.health, 'health topic → disclaimer');
  const sale = MZ.policyNeeds('Diwali sale 40% off, order online, UPI payment', 'promo');
  ok(sale.commerce && sale.legalLinks, 'commerce detected → legal row');
  const plain = MZ.policyNeeds('A simple portfolio of my pottery with photos', 'portfolio');
  ok(!plain.collectsData && !plain.legalLinks, 'plain brochure → no forced legal layer');
}

/* ══ 5. ASSEMBLY v12 ══ */
section('ASSEMBLY v12 (SEO + wiring + legal + identity)');
{
  const design = ST.normalizeDesign({ theme: 'onyx', palette: { accent: '#7c3aed' }, font: 'modern' }, { kind: 'landing', seedAccent: '#7c3aed' });
  design.fontPair = MZ.fontPairFor({ dnaName: 'Orchid', theme: 'onyx', brief: 'booking site', seed: 1 });
  design.ramp = MZ.expandPalette('#7c3aed', { theme: 'onyx', seed: 1 }).ramp;
  const brand = { name: 'Zenith Clinics' };
  const content = {
    title: 'Zenith Clinics — Book a Visit',
    headline: 'Care that shows up on time',
    sub: 'Book a dental visit in under a minute.',
    primary_cta: { label: 'Book now', href: 'https://zenith.example/book' },
    contact: { email: 'hi@zenith.example' },
  };
  const coded = [
    { id: 'hero', html: '<section id="sec-hero" data-rev><h1>Care that shows up on time</h1></section>', css: '#sec-hero{padding:40px}' },
    { id: 'contact', html: '<section id="sec-contact" data-rev><form data-validate><input type="email" required></form></section>', css: '#sec-contact{padding:20px}' },
  ];
  const html = CG.assembleSite({ design, brand, content, coded, plan: { sections: [{ id: 'hero', name: 'Top' }], nav: ['hero'] }, kind: 'landing', brief: 'dental clinic booking form' });

  ok(html.includes('property="og:title"') && html.includes('name="twitter:card"'), 'OG + Twitter meta assembled');
  ok(html.includes('name="robots" content="index,follow"'), 'robots meta present');
  ok(html.includes('application/ld+json') && html.includes('"@type":"LocalBusiness"'), 'JSON-LD structured data emitted');
  ok(html.includes('rel="canonical"') === false, 'canonical deferred to the builder (which knows the URL)');
  ok(html.includes('data-validate') && html.includes('field-err'), 'form validation layer attached');
  ok(html.includes('data-legal="privacy"') && html.includes('Privacy Policy'), 'inline legal (privacy/terms) attached for a booking brief');
  ok(!/crafted by/i.test(html), 'IDENTITY: zero tool credit anywhere');
  ok(html.includes('showModal'), 'wiring layer ships dialog behavior');
  ok(html.includes(`"${design.fontPair.display}"`), `real pairing fonts wired (${design.fontPair.display})`);

  // Canonical injection.
  const withCanonical = CG.injectCanonical(html, 'https://nebula.example/sites/s_abc');
  ok(withCanonical.includes('rel="canonical" href="https://nebula.example/sites/s_abc"'), 'canonical injected post-assembly');
  ok(CG.injectCanonical(withCanonical, 'https://other.example/x') === withCanonical, 'canonical is never duplicated');

  // Commerce brief → Store schema.
  const saleHtml = CG.assembleSite({ design, brand: { name: 'GlowMart' }, content, coded, plan: { sections: [{ id: 'hero' }], nav: [] }, kind: 'promo', brief: 'sale 40% off, UPI checkout' });
  ok(saleHtml.includes('"@type":"Store"'), 'commerce brief → Store schema');
}

/* ══ 6. ENGINEER MASTERY ══ */
section('ENGINEER MASTERY (the section contract carries the textbook)');
{
  const ramp = MZ.expandPalette('#15803d', { theme: 'swiss', seed: 2 }).ramp;
  const design = ST.normalizeDesign({ theme: 'swiss', palette: { accent: '#15803d' }, font: 'modern' }, { kind: 'landing', seedAccent: '#15803d' });
  design.ramp = ramp;
  design.fontPair = MZ.fontPairFor({ dnaName: 'Forest', theme: 'swiss', brief: 'organic store', seed: 2 });

  sarvamScript.length = 0;
  sarvamScript.push({
    re: /senior front-end engineer/,
    reply: () => ({
      __raw: '<section id="sec-hero" data-rev><div class="wrap"><h1>Fresh, honest food for Verde</h1><p data-rev data-rev-delay="1">Seasonal plates, honest prices, a warm room.</p><a class="btn btn-accent" href="#sec-contact">Book a table</a></div></section>\n<style>#sec-hero{padding:64px 0;background:linear-gradient(180deg,var(--bg),var(--surface));}#sec-hero h1{font-family:var(--display);font-size:clamp(2rem,4vw,3.4rem);letter-spacing:-0.02em;color:var(--ink)}#sec-hero .btn{margin-top:16px}</style>',
    }),
  });
  sarvamSeen.length = 0;
  const env = makeEnv();
  const ctx = {
    kind: 'landing',
    brief: 'organic food store, online booking',
    brand: { name: 'Verde' },
    thought: { design },
    design,
    content: { headline: 'Fresh, honest food' },
    section: { id: 'hero', name: 'Hero', goal: 'promise in one breath', layout: 'split', content_keys: ['headline'], motion: 'rise' },
    team: null,
    images: [],
    mastery: MZ.masteryBlock([MZ.cssGlobalPack(), MZ.wiringPack()], { maxChars: 2400 }),
  };
  let shipped = null;
  try { shipped = await CG.codeSection(env, ctx); } catch { /* prompt is what we assert */ }
  const promptText = sarvamSeen.join('\n');
  ok(shipped && shipped.html && shipped.css, 'engineer ships a valid section with mastery in context');
  ok(promptText.includes('WIRING CONTRACT') || promptText.includes('CSS GLOBAL LAW'), 'engineer prompt carries the mastery block');
  ok(/-500:#/.test(promptText), 'engineer prompt carries the ramp tokens');
  ok(promptText.includes('TYPE VOICE'), 'engineer prompt carries the font pairing');
}

/* ══ 7. WEBAPP PLAN-BEFORE-CODE ══ */
section('WEBAPP PLAN-BEFORE-CODE');
{
  // (a) Model down end-to-end: the signature app must ship a complete
  //     document (this also proves the old `brand` ReferenceError is dead).
  sarvamDown = true;
  const env = makeEnv();
  const r = await BLD.buildWebsite(env, memStore(), { uid: 'u_web', displayName: 'Owner' },
    { kind: 'webapp', title: 'Tip tracker', brief: 'A small tip-tracker web app my field team can use offline, record tips per day' },
    'https://w.example', { runId: `b_test${Date.now().toString(36)}` });
  ok(r.ok === true, 'webapp build never fails even with the model down');
  ok(typeof r.bytes === 'number' && r.bytes > 400, `signature app shipped (${r.bytes} bytes)`);
  ok(r.url?.startsWith('https://w.example/sites/s_'), 'public URL minted');
  ok(env.__MEDIA.get(`sites/${r.artifact_id}.html`)?.includes('</html>'), 'the app actually reached R2');
  sarvamDown = false;

  // (b) Model up: the PLAN (features + data model) must reach the
  //     coding prompt, and the app must ship on the AI path.
  sarvamScript.length = 0;
  sarvamScript.push({
    re: /lead engineer planning/,
    reply: () => ({
      app_name: 'TipJar',
      core_loop: 'record a tip',
      features: [{ name: 'Log', purpose: 'add tip' }],
      data: { entity: 'Tip', fields: ['id', 'amount', 'createdAt'] },
      screens: ['Home'],
      empty_state: 'No tips yet',
    }),
  });
  sarvamScript.push({
    re: /senior product engineer/,
    reply: () => ({
      __raw: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TipJar</title><style>body{font-family:system-ui;margin:0;background:#f6f7fb;color:#141826}header{padding:28px 20px;background:#141826;color:#fff}main{padding:16px;max-width:560px;margin:0 auto}.row{display:flex;gap:10px;padding:12px;background:#fff;border-radius:12px;margin-bottom:8px;border:1px solid #e4e6ef}button{border:0;background:#141826;color:#fff;border-radius:12px;padding:12px 18px;font-weight:700}input{flex:1;border:1px solid #dfe2ee;border-radius:12px;padding:12px}</style></head><body><header><h1>TipJar</h1><p>Record a tip for the field team</p></header><main><div class="add"><input id="amt" type="number" placeholder="Amount"><button onclick="add()">Add</button></div><div id="list"></div><p id="empty">No tips yet — add your first one above.</p></main><script>var store=[];function render(){var h="";for(var i=0;i<store.length;i++){h+='<div class="row">'+store[i].amount+"</div>"}document.getElementById("list").innerHTML=h}function add(){store.unshift({id:Date.now(),amount:50,createdAt:new Date().toISOString()});render()}render();</script></body></html>`,
    }),
  });
  sarvamSeen.length = 0;
  const env2 = makeEnv();
  const r2 = await BLD.buildWebsite(env2, memStore(), { uid: 'u_web2', displayName: 'Owner' },
    { kind: 'webapp', title: 'TipJar', brief: 'tip tracker for the field team' }, '', {});
  const webappPrompt = sarvamSeen.find((t) => /senior product engineer/.test(t)) || '';
  ok(r2.ok === true && r2.builder === 'ai', 'webapp AI path ships the plan-informed app');
  ok(webappPrompt.includes('ENGINEERING PLAN') && webappPrompt.includes('Tip { id, amount, createdAt }'), 'the plan (features + DATA MODEL) reached the coding prompt');
  ok(webappPrompt.includes('TYPOGRAPHY') && /display=swap/.test(webappPrompt), 'the app gets a real font pairing instruction');
}

/* ══ 8. SUBSCRIPTIONS ══ */
section('SUBSCRIPTIONS (sell the Studio)');
{
  const store = memStore();
  const uid = 'u_bill';
  const catalog = Object.keys(PL.PLANS);
  ok(catalog.join(',') === 'free,pro,studio', `catalog: ${catalog.join(', ')}`);

  // Free tier: 3 builds/month.
  let q = await PL.checkQuota(store, uid, 'build');
  ok(q.ok && q.plan.id === 'free' && q.limits.builds_per_month === 3, 'free plan starts with 3 builds');
  for (let i = 0; i < 3; i++) await PL.consumeBuild(store, uid);
  q = await PL.checkQuota(store, uid, 'build');
  ok(!q.ok && q.upgradeRequired && /3 builds/.test(q.error), `over-quota refused: "${q.error.slice(0, 48)}…"`);

  // Refines meter separately.
  const q2 = await PL.checkQuota(store, uid, 'refine');
  ok(q2.ok, 'refines meter separately (still available)');

  // Owner grants Pro → quota unlocks with the Pro limits.
  const grant = await PL.setPlan(store, uid, 'pro', { days: 30, actor: 'owner' });
  ok(grant.ok && grant.grant.until, 'grant writes an expiry-dated subscription');
  const snap = await PL.billingSnapshot(store, uid);
  ok(snap.plan === 'pro' && snap.limits.builds_per_month === 50 && snap.remaining.builds === 47, `Pro unlocks 50 builds; month usage persists (remaining ${snap.remaining.builds})`);
  ok(snap.catalog.length === 3 && snap.catalog.find((p) => p.id === 'pro').current, 'snapshot marks the current plan');

  // Expiry honesty: an expired grant rides Free with an upgrade flag.
  await store.put(`billing:plan:${uid}`, JSON.stringify({ plan: 'pro', since: '2025-01-01T00:00:00Z', until: '2025-02-01T00:00:00Z', status: 'active' }));
  const expired = await PL.checkQuota(store, uid, 'build');
  ok(!expired.ok && expired.plan.id === 'free' && /expired/i.test(expired.error), 'expired grant → honest Free downgrade + upgrade prompt');

  // Checkout orders.
  const order = await PL.createOrder(store, 'u_buyer', 'studio');
  ok(order.ok && order.order.amount_inr === 1999 && order.order.status === 'pending', 'checkout creates a pending ₹1999 Studio order');
  ok((await PL.listOrders(store, 'u_buyer')).length === 1, 'order ledger persists');

  // clearPlan returns to Free.
  const store2 = memStore();
  await PL.setPlan(store2, 'u2', 'studio', { days: 5 });
  await PL.clearPlan(store2, 'u2');
  ok((await PL.planFor(store2, 'u2')).plan === 'free', 'clearPlan returns the account to Free');

  // The owner's internal team is exempt (they ARE the business selling
  // the subscriptions); paying subscribers (default roles) are metered.
  const internal = await PL.checkQuota(memStore(), 'u_staff', 'build', 'salesRep');
  ok(internal.ok && internal.exempt, 'internal team role (salesRep) exempt from quota');
  const external = await PL.checkQuota(memStore(), 'u_cust', 'build', 'viewer');
  ok(external.ok && !external.exempt, 'default-role accounts (viewers/subscribers) are metered');
}

/* ══ 9. DESIGN DNA × MASTERY ══ */
section('DESIGN DNA × MASTERY (ramp + fontPair on both paths)');
{
  // Fallback path (model down): designBrief must still attach ramp + pair.
  sarvamDown = true;
  const env = makeEnv();
  const site = { name: 'Musafir', isOwnerBusiness: false, profile: null };
  const r = await D.designBrief(env, { kind: 'landing', brief: 'cozy coffee shop menu and story', style: '', brand: site, site });
  ok(r.design.ramp && Object.keys(r.design.ramp).length >= 10, 'fallback path attaches the 10-step ramp');
  ok(r.design.fontPair && r.design.fontPair.display, `fallback path attaches a font pairing (${r.design.fontPair?.display})`);
  ok(r.dna, 'DNA family still resolved');

  // Different briefs → different font voices at a meaningful rate.
  const briefs = ['tax consultant corporate site', 'kids birthday party planner', 'luxury jewelry boutique', 'yoga and wellness studio', 'street food joint', 'photography portfolio', 'saas analytics product', 'dental clinic'];
  const voices = new Set();
  for (const b of briefs) {
    const rr = await D.designBrief(env, { kind: 'landing', brief: b, style: '', brand: site, site });
    voices.add(rr.design.fontPair?.display);
  }
  ok(voices.size >= 3, `${briefs.length} briefs → ${voices.size} distinct display voices (variety, not monoculture)`);
  sarvamDown = false;
}

/* ══ identity regression: the scrubber also kills tool credits ══ */
section('IDENTITY REGRESSION (tool credits)');
{
  const site = SB.extractSiteBrand({ title: 'Zenith', brief: 'A landing page for "Zenith" dental clinic', kind: 'landing' });
  const dirty = '<footer>© 2026 Zenith · crafted by the Nebula agent</footer><a href="https://x.com">Built with Nebula Studio</a>';
  const clean = SB.scrubSiteHtml(dirty, site, null);
  ok(!/Nebula agent/i.test(clean.html) && !/Nebula Studio/i.test(clean.html), 'scrubber removes tool credits the prompt may leak');
  ok(clean.leaks >= 2, `${clean.leaks} tokens scrubbed`);
}

console.log(`\n════════════════════════════════`);
console.log(`V12 MASTERY: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
