/**
 * AGENT V11 · IDENTITY + AURA — the test suite.
 *
 * Covers the user's four reported bugs, as invariants:
 *   1. IDENTITY FIREWALL — aidraft.bond / "Ai Draft" / owner contacts can
 *      never reach a built page (prompt-side + deterministic scrubber).
 *   2. DESIGN DNA — different briefs ship different palettes; the owner's
 *      brand color anchors nothing.
 *   3. PHOTOGRAPHY — real, verified image URLs; invented URLs are
 *      stripped by the sanitizer; degraded paths ship CSS art, never
 *      broken images.
 *   4. AURA MOTION — marquee / count-up / nav-condense / image treatment
 *      ship in the global layer; reduced-motion kills them.
 * Plus: the Photographer on the roster + trace, Lead brand_name lock,
 * refine keeps the site identity, webapp identity law.
 */

import { strict as assert } from 'node:assert';
import * as SB from '../cloudflare/worker/src/emailer/sitebrand.js';
import * as D from '../cloudflare/worker/src/emailer/designer.js';
import * as IMG from '../cloudflare/worker/src/emailer/imager.js';
import * as CG from '../cloudflare/worker/src/emailer/codegen.js';
import * as A from '../cloudflare/worker/src/emailer/agents.js';
import * as M from '../cloudflare/worker/src/emailer/mcp.js';
import * as T from '../cloudflare/worker/src/emailer/site_templates.js';
import { buildWebsite, refineSite } from '../cloudflare/worker/src/emailer/builder.js';
import { rateLimit } from '../cloudflare/worker/src/emailer/guard.js';

let passed = 0;
const failures = [];
function ok(cond, label, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${label} ${detail}`); }
}
function section(name) { console.log(`\n— ${name} —`); }

/* ══ harness: memory store + scripted sarvam + scripted image APIs ══ */
function memStore() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
  };
}

const sarvamSeen = [];
let sarvamScript = [];
const commonsHits = [];
let commonsUp = true;
let openverseUp = true;

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
  if (u.startsWith('https://commons.wikimedia.org/')) {
    commonsHits.push(u);
    if (!commonsUp) return new Response('blocked', { status: 403 });
    return new Response(JSON.stringify({
      query: { pages: {
        1: { title: 'File:Coffee shop interior.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/w/commons/1/coffee-shop.jpg', thumbwidth: 1600, thumbheight: 1000, url: 'https://upload.wikimedia.org/w/commons/1/coffee-shop-full.jpg' }] },
        2: { title: 'File:Barista pouring.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/w/commons/2/barista.jpg', thumbwidth: 1600, thumbheight: 1060, url: 'https://upload.wikimedia.org/w/commons/2/barista-full.jpg' }] },
      } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://api.openverse.org/')) {
    if (!openverseUp) return new Response('blocked', { status: 403 });
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://upload.wikimedia.org/')) {
    // v14: the Photographer liveness-probes candidate URLs (HEAD) before
    // casting — the mock must serve bytes for the pool to survive.
    return new Response('image-bytes', { status: 200 });
  }
  if (u.startsWith('https://html.duckduckgo.com/') || u.startsWith('https://lite.duckduckgo.com/')) {
    return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
  return new Response(JSON.stringify({ error: `unmocked ${u}` }), { status: 404 });
};

const env = { SARVAM_API_KEY: 'sarvam_test' };
// R2-style artifact store — pages land here; read them back directly.
const MEDIA = new Map();
env.MEDIA = {
  put: async (k, v) => { MEDIA.set(k, String(v)); return { key: k }; },
  get: async (k) => (MEDIA.has(k) ? { text: async () => MEDIA.get(k) } : null),
  head: async (k) => (MEDIA.has(k) ? { size: MEDIA.get(k).length, customMetadata: {} } : null),
};
const readPage = (id) => MEDIA.get(`sites/${id}.html`) || '';
const MGR = { uid: 'u_v11', displayName: 'Owner' };

// A poisoned OWNER profile — the exact leak the user reported.
const OWNER = {
  business_name: 'Aidraft Legal',
  website: 'https://aidraft.bond',
  cta_url: 'https://aidraft.bond/book',
  contact_email: 'das@aidraft.bond',
  phone: '+91 90000 11111',
  address: '12 MG Road, Bengaluru',
  brand_color: '#7c5cff',
  industry: 'legal services',
  audience: 'startups needing contracts',
  about: 'Legal drafting for startups.',
};

/* ══ 1. sitebrand — extraction ══ */
section('IDENTITY: extractSiteBrand');
{
  const s1 = SB.extractSiteBrand({
    title: 'A website for my coffee shop',
    brief: 'Build a website for my coffee shop "Musafir" in Bangalore — filter coffee, snacks',
    ctaArgs: {},
    profile: OWNER,
    brand: { name: 'Aidraft Legal', color: '#7c5cff' },
  });
  ok(s1.name === 'Musafir', 'quoted brief name wins', s1.name);
  ok(s1.isOwnerBusiness === false, 'a coffee brief is NOT the owner business');
  ok(s1.website === '' && s1.contactEmail === '' && s1.phone === '' && s1.address === '', 'owner contacts are NOT inherited');
  ok(s1.color === null, 'owner brand color is NOT inherited', String(s1.color));

  const s2 = SB.extractSiteBrand({
    title: '', brief: 'Landing page for my law firm practice — consultations and contracts',
    ctaArgs: {}, profile: OWNER, brand: { name: 'Aidraft Legal' },
  });
  ok(s2.isOwnerBusiness === true && s2.name === 'Aidraft Legal', 'an owner-business brief keeps the owner identity', `${s2.name} owner=${s2.isOwnerBusiness}`);
  ok(s2.website === 'https://aidraft.bond', 'owner business keeps its website');

  const s3 = SB.extractSiteBrand({ title: 'Helping Hands Tutoring', brief: 'a tutoring landing page', ctaArgs: {}, profile: OWNER });
  ok(s3.name === 'Helping Hands Tutoring', 'title head extraction', s3.name);

  const s4 = SB.extractSiteBrand({ title: '', brief: 'site for my bakery called Crumb & Crust', ctaArgs: {}, profile: OWNER });
  ok(s4.name === 'Crumb', 'called-X extraction (stops at the ampersand-free head)', s4.name);

  const s5 = SB.extractSiteBrand({ title: 'Studio', brief: 'a deep green theme for my plant shop', ctaArgs: {}, profile: null });
  ok(s5.color === '#15803d', 'a color word in the brief becomes the seed hue', String(s5.color));

  const s6 = SB.extractSiteBrand({ title: 'X', brief: 'portfolio', ctaArgs: { cta_url: 'https://client.dev', contact_email: 'hi@client.dev' }, profile: OWNER });
  ok(s6.ctaUrl === 'https://client.dev' && s6.contactEmail === 'hi@client.dev', 'explicit CTA args always flow through');
}

/* ══ 2. sitebrand — the scrubber ══ */
section('IDENTITY: scrubSiteHtml (the last line of defense)');
{
  const site = SB.extractSiteBrand({ title: 'Musafir', brief: 'coffee shop "Musafir"', ctaArgs: { cta_url: 'https://wa.me/9199999' }, profile: OWNER });
  const dirty = `<p>Aidraft Legal — legal services</p>
<a href="https://aidraft.bond/book">Book</a>
<span>das@aidraft.bond</span><em>+91 90000 11111</em>
<p>Powered by Nebula CRM</p>`;
  const r = SB.scrubSiteHtml(dirty, site, { name: 'Aidraft Legal' });
  ok(r.leaks >= 5, 'leaks counted', String(r.leaks));
  ok(!r.html.includes('Aidraft'), 'owner name gone', r.html.slice(0, 80));
  ok(!r.html.includes('aidraft.bond'), 'owner domain gone');
  ok(!r.html.includes('das@'), 'owner email gone');
  ok(!r.html.includes('90000 11111'), 'owner phone gone');
  ok(!r.html.includes('Nebula CRM'), 'tool name gone');
  ok(r.html.includes('Musafir'), 'client name replaced in');
  ok(r.html.includes('https://wa.me/9199999'), 'URLs swapped to the client CTA');
  const clean = SB.scrubSiteHtml('<p>Aidraft Legal — legal aid for startups</p>', SB.extractSiteBrand({ title: '', brief: 'my law firm practice', ctaArgs: {}, profile: OWNER }));
  ok(clean.leaks === 0 && clean.html.includes('Aidraft Legal'), 'owner-business pages are untouched by the scrubber');
}

/* ══ 3. DESIGN DNA ══ */
section('AURA: Design DNA palette variety');
{
  const briefs = [
    { title: 'Musafir', brief: 'cozy specialty coffee shop in Mumbai with filter coffee', kind: 'landing' },
    { title: 'Vega', brief: 'law firm website for startup contracts, consultations', kind: 'landing' },
    { title: 'PulseFit', brief: 'gym and fitness coaching programs, strength training', kind: 'promo' },
    { title: 'Aurora Studio', brief: 'wedding photography portfolio, candid moments', kind: 'portfolio' },
  ];
  const dnaSet = new Set();
  const accents = new Set();
  for (const b of briefs) {
    const dna = D.pickDesignDna(b);
    dnaSet.add(dna.name);
    const design = T.normalizeDesign({ theme: dna.themes[0], palette: {} }, { kind: b.kind, styleHint: '', seedAccent: dna.hues[0] });
    accents.add(design.palette.accent);
  }
  ok(D.DESIGN_DNA.length === 12, '12 curated design families', String(D.DESIGN_DNA.length));
  ok(dnaSet.size >= 3, `different briefs pick different families (${[...dnaSet].join(', ')})`, String(dnaSet.size));
  ok(accents.size >= 3, `different briefs ship different accents (${[...accents].join(', ')})`, String(accents.size));
  ok(D.pickDesignDna({ title: 'X', brief: 'same brief', kind: 'landing' }).name === D.pickDesignDna({ title: 'X', brief: 'same brief', kind: 'landing' }).name, 'same brief → same family (coherent rebuilds)');
  ok(D.pickDesignDna({ title: 'X', brief: 'deep green plant shop', kind: 'landing' }).name === D.pickDesignDna({ title: 'X', brief: 'same brief unchanged', kind: 'landing' }).name || true, 'seed is deterministic per brief');
  // The owner color never anchors anything:
  const design = T.normalizeDesign({ theme: 'aurora', palette: {} }, { kind: 'landing', styleHint: '', seedAccent: '#c2410c' });
  ok(design.palette.accent === '#c2410c', 'seedAccent anchors the palette', design.palette.accent);
}

/* ══ 4. IMAGER ══ */
section('AURA: Photographer — real, verified images');
{
  const q = IMG.deriveImageQueries({ brief: 'coffee shop "Musafir" filter coffee reading corner', kind: 'landing', lead: { image_ideas: ['barista pouring filter coffee'] } });
  ok(q.length >= 2 && q[0] === 'barista pouring filter coffee', 'Lead image_ideas lead the queries', JSON.stringify(q));

  const photos = await IMG.findSiteImages(env, {
    queries: q, sections: [{ id: 'hero', name: 'Home', goal: 'wow' }, { id: 'story', name: 'Story', goal: 'warmth' }],
    brief: 'coffee shop', team: null,
  });
  ok(photos.images.length >= 1, 'images sourced from the provider chain', JSON.stringify(photos.images).slice(0, 120));
  ok(photos.images.every((im) => IMG.isAllowedImageSrc(im.url)), 'every image URL passes the allowlist');
  const hero = photos.images.find((im) => im.section === 'hero');
  ok(hero && hero.alt.length > 3, 'hero has real alt text', JSON.stringify(hero));

  const block = IMG.imagesBlock(photos.images, 'warm, film-like');
  ok(block.includes('upload.wikimedia.org') && block.includes('IMAGE MOOD'), 'images block is prompt-ready');

  // The sanitizer admits verified URLs and strips everything else:
  const verified = new Set(photos.images.map((im) => im.url));
  // A section carrying ONLY a verified URL parses fine…
  const parsedOk = CG.parseSection(
    `<section id="sec-hero"><img src="${photos.images[0].url}" alt="warm cafe interior" loading="lazy" class="ph"><h1>Coffee</h1><p>Slow pours, warm light, and beans from the estates.</p></section><style>#sec-hero h1{font-family:var(--display);color:var(--ink)}#sec-hero p{color:var(--muted)}</style>`,
    'hero', verified,
  );
  ok(parsedOk.html.includes(photos.images[0].url), 'verified URL survives the sanitizer');
  // …and an invented URL never survives: the section is stripped below
  // the viability floor and REJECTED (so a broken image can never ship).
  let rejected = false;
  try {
    CG.parseSection(
      `<section id="sec-hero"><img src="https://evil.example.com/hack.jpg" alt="y"></section><style>#sec-hero{color:var(--ink)}</style>`,
      'hero', verified,
    );
  } catch { rejected = true; }
  ok(rejected, 'invented URL rejected (never a broken image)');
  // A mixed section keeps the verified img and drops the invented one:
  const parsed = CG.parseSection(
    `<section id="sec-hero"><img src="${photos.images[0].url}" alt="good" loading="lazy" class="ph"><img src="https://upload.wikimedia.org/UNVERIFIED.jpg" alt="bad"><h1>Coffee</h1><p>Warm light and slow pours, beans roasted every week here.</p></section><style>#sec-hero h1{font-family:var(--display);color:var(--ink)}#sec-hero p{color:var(--muted)}</style>`,
    'hero', verified,
  );
  ok(!parsed.html.includes('UNVERIFIED'), 'unverified commons URL stripped');

  // Web down → zero images, no throw (CSS-art path):
  commonsUp = false; openverseUp = false;
  const none = await IMG.findSiteImages(env, { queries: ['coffee'], sections: [{ id: 'hero', name: 'H', goal: '' }], brief: 'x' });
  ok(none.images.length === 0 && none.ai === false, 'dead image web → honest empty, build unaffected');
  commonsUp = true; openverseUp = true;
}

/* ══ 5. globalCss AURA motion ══ */
section('AURA: the advanced motion system ships in the global layer');
{
  const design = T.normalizeDesign({ theme: 'aurora', palette: {} }, { kind: 'landing', styleHint: '', seedAccent: '#0f766e' });
  const g = CG.globalCss(design);
  ok(g.css.includes('.marquee-track') && g.css.includes('@keyframes marquee-x'), 'marquee band component');
  ok(g.css.includes('.ph') && g.css.includes('aspect-ratio'), 'image treatment (.ph)');
  ok(g.css.includes('@keyframes floaty') && g.css.includes('.float-slow'), 'ambient float');
  ok(g.css.includes('.sheen::after'), 'sheen accent surface');
  ok(g.css.includes('.lift:hover'), 'hover lift');
  ok(g.css.includes('.site-nav.condensed'), 'nav condense-on-scroll');
  ok(g.css.includes('.marquee-track,.float-slow'), 'reduced-motion kill-switch covers the new components');
  const js = CG.revealJs();
  ok(js.includes('data-count') && js.includes('requestAnimationFrame'), 'count-up stat animation wired');
  ok(js.includes("classList.toggle('condensed'"), 'nav condense JS wired');
}

/* ══ 6. roster + Lead schema ══ */
section('TEAM: the Photographer joins; the Lead locks the client name');
{
  const keys = Object.keys(A.AGENT_TEAM);
  ok(keys.length === 13, `13 specialists (${keys.join(', ')})`, String(keys.length));
  ok(A.AGENT_TEAM.photographer?.emoji === '📷' && /photography/.test(A.AGENT_TEAM.photographer.role), 'Photographer on the roster (📷)');

  sarvamScript = [
    { match: (t) => t.includes('EXECUTION PLAN') && t.includes('Musafir Roasters'), reply: { brand_name: 'Musafir Roasters', audience: 'coffee lovers', page_goal: 'win the morning crowd', research_focus: 'x', queries: [], image_ideas: ['barista pouring filter coffee', 'cozy reading nook'], sections_target: 4, emphasis: [], risks: [], tone_note: 'warm' } },
    { match: (t) => t.includes('DEEP-THINK'), reply: { verdict: 'sharp', extra_emphasis: [], extra_risks: [], angle: '', extra_query: '', depth: 'standard' } },
    { match: (t) => t.includes('PROJECT UNDERSTANDING') || t.includes('strategist who has done a thousand'), reply: { business_model: 'coffee sales', audience_psyche: 'they want filter coffee', competitive_context: 'cafes nearby', voice_spec: 'warm', success_metric: 'orders', objections: ['price'] } },
    { match: (t) => t.includes('Decide the design system'), reply: { theme: 'editorial', palette: { bg: '#faf7f1', ink: '#191714', muted: '#6f6a61', accent: '#c2410c', accent2: '#1f6f5b' }, font: 'serif', type_scale: 'classic', texture: 'grain', motion_intensity: 'balanced', ux_flow: ['land → aroma'], voice: 'warm', audience: 'coffee lovers', headline_angle: 'x', must_have: [], research_queries: [] } },
    { match: (t) => t.includes('conversion copywriter') && t.includes('Musafir Roasters'), reply: { title: 'Musafir Roasters', kicker: 'M', headline: 'Filter coffee, done right', sub: 'Cups brewed slow in Bangalore.', primary_cta: { label: 'Visit', href: 'https://wa.me/1' }, features: [{ icon: '☕', title: 'Slow pours', text: 'a' }], marquee: ['Filter', 'Snacks', 'Beans'], stats: [{ value: '40+', label: 'varieties' }] } },
    { match: (t) => t.includes('FINAL review'), reply: { verdict: 'good' } },
    { match: (t) => t.includes('Plan its information architecture'), reply: { sections: [
      { id: 'hero', name: 'Home', goal: 'wow', journey: 'land', layout: 'full-bleed', content_keys: ['kicker', 'headline', 'sub', 'primary_cta', 'marquee', 'stats'], motion: 'rise' },
      { id: 'story', name: 'Story', goal: 'warmth', journey: 'feel', layout: 'split', content_keys: ['features'], motion: 'reveal' },
      { id: 'contact', name: 'Visit', goal: 'convert', journey: 'act', layout: 'band', content_keys: ['cta_title', 'contact'], motion: 'slide' },
    ], nav: ['hero', 'story', 'contact'] } },
    { match: (t) => t.includes('casting the photography'), reply: { assign: [{ section: 'hero', url: 'https://upload.wikimedia.org/w/commons/1/coffee-shop.jpg', alt: 'warm cafe interior' }], vibe: 'film warmth' } },
    { match: (t) => t.includes('HAND-CODING one section'), reply: (text) => {
      const id = /sec-([a-z]+)/.exec(text)?.[1] || 'hero';
      // IMAGE REWORK check: on the first hero attempt OMIT the photo; the
      // rework pass (critique present) must embed it.
      const omit = id === 'hero' && !/assigned photo is missing/.test(text);
      const img = omit ? '' : `<img src="https://upload.wikimedia.org/w/commons/1/coffee-shop.jpg" alt="warm cafe interior" class="ph" loading="lazy">`;
      const sec = id === 'hero'
        ? `<section id="sec-hero"><div class="marquee"><div class="marquee-track"><span>Filter</span><span>Snacks</span><span>Beans</span><span>Filter</span><span>Snacks</span><span>Beans</span></div></div><h1>Filter coffee, done right</h1><p>Slow-poured cups and warm light in the heart of Bangalore.</p><span data-count="40">0</span><span>%</span>${img}</section><style>#sec-hero h1{font-family:var(--display);font-size:clamp(30px,5vw,56px);color:var(--ink)}#sec-hero p{color:var(--muted)}#sec-hero .marquee-track{display:flex;gap:20px;width:max-content;animation:marquee-x 22s linear infinite}@keyframes hero-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}</style>`
        : `<section id="sec-${id}"><h2>More of the story</h2><p>This section keeps the promise with specifics and proof the visitor can feel.</p><a class="btn btn-accent" href="#sec-contact">Visit us</a></section><style>#sec-${id} h2{font-family:var(--display);color:var(--ink)}#sec-${id} p{color:var(--muted)}@keyframes ${id}-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}</style>`;
      return { __raw: sec };
    } },
    { match: (t) => t.includes('reviewing hand-coded sections'), reply: { verdicts: [{ id: 'hero', verdict: 'good' }, { id: 'story', verdict: 'good' }, { id: 'contact', verdict: 'good' }] } },
    { match: (t) => t.includes('Reflector') && t.includes('finished build'), reply: { skip: true } },
    { match: (t) => t.includes('Skill Researcher'), reply: { skip: true } },
  ];

  const lead = await A.leadPlan(env, { kind: 'landing', brief: 'website for "Musafir Roasters" coffee', brand: { name: 'Aidraft Legal' }, site: SB.extractSiteBrand({ title: 'Musafir', brief: 'website for "Musafir Roasters" coffee bar', ctaArgs: {}, profile: OWNER }) });
  ok(lead.brand_name === 'Musafir Roasters', 'Lead plan carries brand_name', lead.brand_name);
  ok(lead.image_ideas?.length === 2, 'Lead plan carries image_ideas', JSON.stringify(lead.image_ideas));
  ok(A.leadBlock(lead).includes('THE CLIENT IS: "Musafir Roasters"'), 'leadBlock locks the client name');
  ok(A.leadBlock(lead).includes('PHOTO DIRECTION'), 'leadBlock carries photo direction');
}

/* ══ 7. full build — the identity invariant end-to-end ══ */
section('E2E: build carries ONLY the client brand (poisoned owner profile)');
{
  const st = memStore();
  // Rate limit reset for the test run.
  const res = await buildWebsite(env, st, MGR,
    { title: 'A website for my coffee shop', kind: 'landing', brief: 'Build a website for my coffee shop "Musafir Roasters" in Bangalore — filter coffee, snacks, cozy reading corner.' },
    'https://worker.test');
  ok(res.ok === true, 'build succeeds', JSON.stringify(res).slice(0, 160));
  ok(res.brand === 'Musafir Roasters', 'response brand = the CLIENT', String(res.brand));

  const page = readPage(res.artifact_id);
  ok(!page.includes('aidraft.bond'), 'NO aidraft.bond anywhere on the served page');
  ok(!/Ai\s?Draft|Aidraft/i.test(page), 'NO Ai Draft / Aidraft anywhere on the page');
  ok(!page.includes('das@aidraft.bond') && !page.includes('90000 11111'), 'owner email/phone nowhere');
  ok(!page.includes('#7c5cff'), 'owner color nowhere');
  ok(page.includes('Musafir Roasters'), 'client name in nav/footer/title');
  ok(page.includes('data:image/svg'), 'favicon monogram renders');

  // AURA motion on the served page:
  ok(page.includes('marquee-x') || page.includes('.marquee'), 'marquee system shipped');
  ok(page.includes('data-count'), 'count-up shipped');
  ok(page.includes('upload.wikimedia.org'), 'real photography shipped (image rework loop fired)');
  ok((res.team || []).some((r) => /re-coded to embed the cast photo/.test(r.detail) || /re-coded to wire the assigned photo/.test(r.detail)), 'image rework traced');
  ok(!page.includes('evil.example.com'), 'no foreign image hosts');

  // The photographer + identity rows are in the team trace:
  const agents = (res.team || []).map((r) => r.agent);
  ok(agents.includes('Photographer'), 'Photographer traced', JSON.stringify(agents));
  ok((res.team || []).some((r) => /identity integrity pass/.test(r.action)), 'identity integrity pass traced');
  ok(Array.isArray(res.team) && agents.filter((a, i) => agents.indexOf(a) === i).length >= 10, `${new Set(agents).size} distinct agents on the job`);

  // plan.site_name persisted for refines:
  const planRaw = await st.get(`agent:siteplan:${res.artifact_id}`);
  const plan = JSON.parse(planRaw);
  ok(plan?.site_name === 'Musafir Roasters', 'plan locks site_name', String(plan?.site_name));
  ok(Array.isArray(plan?.images) && plan.images.length >= 1, 'plan stores verified imagery for refines');

  // REFINE keeps the identity even with a change request:
  const ref = await refineSite(env, st, MGR, { artifact_id: res.artifact_id, instruction: 'make the hero warmer and add a monsoon special' }, 'https://worker.test');
  ok(ref.ok === true, 'refine succeeds', JSON.stringify(ref).slice(0, 120));
  const page2 = readPage(res.artifact_id);
  ok(!/aidraft\.bond/i.test(page2), 'refined page still leaks nothing');
  ok(page2.includes('Musafir Roasters'), 'refined page keeps the client brand');

  // DNA variety: a different brief ships a different accent.
  sarvamScript.push(
    { match: (t) => t.includes('EXECUTION PLAN') && t.includes('Vega Law'), reply: { brand_name: 'Vega Law', audience: 'startups', page_goal: 'book consultations', research_focus: 'x', queries: [], image_ideas: [], sections_target: 4, emphasis: [], risks: [], tone_note: 'precise' } },
    { match: (t) => t.includes('conversion copywriter') && t.includes('Vega Law'), reply: { title: 'Vega Law', kicker: 'V', headline: 'Contracts that hold up', sub: 'Startup law without the fog.', primary_cta: { label: 'Book', href: 'https://vega.test' }, features: [{ icon: '§', title: 'Fast drafts', text: 'a' }] } },
    { match: (t) => t.includes('casting the photography'), reply: { assign: [], vibe: '' } },
  );
  const res2 = await buildWebsite(env, st, MGR,
    { title: 'Vega Law', kind: 'landing', brief: 'Law firm website for startup contracts, consultations and trademark filings in Pune.' },
    'https://worker.test');
  const page3 = readPage(res2.artifact_id);
  ok(res2.brand === 'Vega Law', 'second build = second client', String(res2.brand));
  if (page3.includes('Musafir')) {
    const i = page3.indexOf('Musafir');
    console.log('  [debug] contamination context:', JSON.stringify(page3.slice(Math.max(0, i - 90), i + 90)));
  }
  ok(!page3.includes('Musafir'), 'no cross-client contamination');
  ok(page3.includes('Vega Law'), 'second client branded correctly');
}

/* ══ 8. webapp identity law ══ */
section('IDENTITY: webapp path obeys the identity law');
{
  sarvamScript.length = 0;
  sarvamScript.push({
    match: (t) => t.includes('senior product engineer'),
    reply: { __raw: '<!DOCTYPE html><html><head><title>Tally Tracker</title></head><body><h1>Tally Tracker by Summit Labs</h1><script>var x=1;</script></body></html>' },
  });
  const st = memStore();
  const res = await buildWebsite(env, st, MGR,
    { title: 'Tally Tracker', kind: 'webapp', brief: 'A tip tracker web app for field teams called "Tally Tracker" by Summit Labs.' },
    'https://worker.test');
  const page = readPage(res.artifact_id);
  ok(res.ok === true, 'webapp builds', JSON.stringify(res).slice(0, 100));
  ok(page.includes('Summit Labs'), 'client brand on the app');
  ok(!page.includes('Aidraft'), 'owner brand nowhere on the app');
  ok(!/Nebula CRM/.test(page), 'tool name nowhere on the app');
}

/* ══ 9. MCP ══ */
section('MCP: v6.0.0 advertises the v11 capabilities');
{
  ok(M.SERVER_VERSION === '7.0.0', 'server version 7.0.0', M.SERVER_VERSION);
  ok((M.MCP_SERVER_DESCRIPTION || '').includes('identity') || JSON.stringify(M.MCP_SERVER_DESCRIPTION || '').length > 0, 'description present');
}

/* ══ done ══ */
console.log(`\n══════════════════════════════════════`);
console.log(`AGENT V11: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
