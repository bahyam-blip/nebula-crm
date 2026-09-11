/**
 * IMAGER — the Photographer agent (Agent v11 · AURA).
 *
 * THE GAP (user-reported): pages shipped with zero imagery — the code
 * sanitizer stripped every remote <img> and the prompts forbade them,
 * because a hallucinated URL renders as a broken image. The result: no
 * images relevant to the kind of website, ever.
 *
 * THE FIX: REAL, VERIFIED image sourcing — never hallucinated URLs.
 *
 *   1. QUERIES — derived deterministically from the brief (industry
 *      nouns, page kind, the Lead's image_ideas).
 *   2. SOURCE  — Wikimedia Commons' open search API (no key, CORS-open,
 *      hotlinkable via upload.wikimedia.org). Landscape bitmaps only.
 *   3. ASSIGN  — one small Photographer call picks which image serves
 *      which section (hero, showcase, work tiles) and writes real alt
 *      text. Degrades deterministically (hero gets the best candidate)
 *      when the AI is unreachable.
 *   4. ALLOWLIST — the codegen sanitizer now admits exactly these hosts,
 *      and engineers may reference ONLY the URLs given to them. An
 *      invented URL cannot survive: it is stripped, not served broken.
 *
 * Every step degrades to "no images" — CSS art remains the fallback and
 * a build never fails because photography is missing.
 */

import { runAgent } from './agents.js';

/** The ONLY remote image hosts the pipeline will ever serve. */
export const ALLOWED_IMAGE_HOSTS = ['upload.wikimedia.org', 'commons.wikimedia.org'];

const FETCH_TIMEOUT_MS = 12_000;
const COMMONS_UA = 'NebulaStudio/1.0 (https://nebula.app; builder@nebula.app)';
const KIND_SCENE = {
  landing: ['interior', 'workspace', 'storefront'],
  promo: ['product', 'display', 'offer'],
  event: ['audience', 'stage', 'venue'],
  portfolio: ['studio', 'workspace', 'craft'],
  report: ['cityscape', 'office', 'data'],
  webapp: [],
};

/** Clean a Commons file title into alt text ("File:Espresso_...jpg" → "Espresso"). */
function titleToAlt(title) {
  return String(title || '')
    .replace(/^File:/i, '')
    .replace(/\.(jpe?g|png|gif|webp|tiff?)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

/**
 * One Commons search: landscape bitmaps matching the query, with real
 * thumbnail URLs sized for the page. Returns [] on anything unreachable.
 */
export async function searchCommons(query, { limit = 8 } = {}) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${String(query).slice(0, 180)}`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(12, Math.max(4, limit))),
    prop: 'imageinfo',
    iiprop: 'url|size|mime',
    iiurlwidth: '1600',
    format: 'json',
    origin: '*',
  }).toString();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': COMMONS_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});
    const out = [];
    const seen = new Set();
    for (const page of pages) {
      const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
      const raw = info?.thumburl || info?.url;
      if (!raw || seen.has(raw)) continue;
      // Landscape only — heroes and wide panels are the target use.
      const w = Number(info?.thumbwidth || info?.width || 0);
      const h = Number(info?.thumbheight || info?.height || 0);
      if (w && h && w <= h) continue;
      // Only allowlisted hosts can ever be served.
      if (!isAllowedHost(raw)) continue;
      seen.add(raw);
      out.push({ url: raw, title: titleToAlt(page.title), query: String(query).slice(0, 90) });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Openverse fallback — CC-licensed images when Commons is blocked. */
async function searchOpenverse(query, { limit = 8 } = {}) {
  const url = 'https://api.openverse.org/v1/images/?' + new URLSearchParams({
    q: String(query).slice(0, 180),
    page_size: String(Math.min(12, Math.max(4, limit))),
  }).toString();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': COMMONS_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out = [];
    const seen = new Set();
    for (const r of (Array.isArray(data?.results) ? data.results : [])) {
      const raw = String(r?.url || '');
      if (!raw || seen.has(raw)) continue;
      const w = Number(r?.width || 0);
      const h = Number(r?.height || 0);
      if (w && h && w <= h) continue;
      seen.add(raw);
      out.push({ url: raw, title: titleToAlt(r?.title || 'photo'), query: String(query).slice(0, 90) });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Salient words of the brief, for the deterministic relevance gate. */
function salientBriefWords(brief) {
  const STOP = new Set(['a', 'an', 'the', 'for', 'my', 'our', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'website', 'web', 'site', 'page', 'build', 'create', 'make', 'need', 'want', 'small', 'business', 'kind', 'app', 'landing', 'promo', 'portfolio', 'event', 'report', 'webapp', 'please', 'should', 'have', 'this', 'that', 'button', 'section', 'online']);
  return new Set(String(brief || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

/**
 * Relevance gate for DETERMINISTIC assignment (the AI path judges fit
 * itself): a candidate is relevant enough when its title or its query
 * shares a salient word with the brief. Keeps a random stock photo from
 * ever landing on a hero just because the pool was thin.
 */
function relevantPool(pool, brief) {
  const briefWords = salientBriefWords(brief);
  if (!briefWords.size) return pool;
  const scored = pool.filter((c) => {
    const words = String(`${c.title} ${c.query}`).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    return words.some((w) => briefWords.has(w));
  });
  return scored;
}
/**
 * Progressively simpler variants of a query — stock APIs are keyword
 * engines: "steaming metal kettle pouring dark filter coffee" finds
 * nothing, "kettle coffee" finds plenty. The AI assignment pass handles
 * relevance, so the SEARCH should stay broad.
 */
const SEARCH_STOP = new Set(['a', 'an', 'the', 'with', 'and', 'of', 'for', 'in', 'on', 'at', 'pouring', 'steaming', 'freshly', 'dark', 'warm', 'fresh', 'closeup', 'close-up', 'view', 'photo', 'picture', 'image', 'hot', 'cold', 'delicious', 'tasty', 'beautiful', 'modern', 'cozy', 'busy', 'evening', 'morning', 'night']);
function simplifyQuery(q) {
  const words = String(q || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !SEARCH_STOP.has(w));
  return { two: words.slice(0, 2).join(' '), one: words.slice(0, 1).join(' '), last: words[words.length - 1] || '' };
}

/** One image sourcing round: provider chain × simplifying cascade. */
async function searchImages(query, opts = {}) {
  const { two, one, last } = simplifyQuery(query);
  // The subject noun usually sits LAST ("…dark filter coffee") — the
  // last-word attempt is what finally lands a real, relevant pool.
  const attempts = [...new Set([String(query).trim(), two, one, last].filter((q) => q && q.length > 2))];
  for (const q of attempts) {
    const first = await searchCommons(q, opts);
    if (first.length) return first;
    const ov = await searchOpenverse(q, opts);
    if (ov.length) return ov;
  }
  return [];
}

/**
 * Deterministic photo queries for THIS brief: the Lead's image_ideas
 * (AI, specific) first, then brief keywords × kind scene words.
 */
export function deriveImageQueries({ brief = '', kind = '', lead = null } = {}) {
  const queries = [];
  for (const idea of (Array.isArray(lead?.image_ideas) ? lead.image_ideas : []).slice(0, 3)) {
    const q = String(idea || '').trim().slice(0, 80);
    if (q.length > 3) queries.push(q);
  }
  // Salient brief words (not stopwords) become topical queries.
  const STOP = new Set(['a', 'an', 'the', 'for', 'my', 'our', 'with', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'website', 'web', 'site', 'page', 'build', 'create', 'make', 'need', 'want', 'small', 'business', 'kind', 'app', 'landing', 'promo', 'portfolio', 'event', 'report', 'webapp', 'please', 'should', 'have', 'this', 'that', 'it', 'is', 'are', 'be', 'user', 'users', 'customers', 'section', 'sections', 'button', 'buttons']);
  const words = String(brief || '').toLowerCase().replace(/[^a-z0-9\s"']/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const salient = [...new Set(words)].slice(0, 4);
  if (salient.length) queries.push(salient.slice(0, 3).join(' '));
  const scenes = KIND_SCENE[kind] || [];
  if (salient.length && scenes.length) queries.push(`${salient[0]} ${scenes[0]}`);
  return [...new Set(queries)].slice(0, 4);
}

const PHOTOGRAPHER_SYSTEM = `You are the Photographer of an elite multi-agent web studio. You have REAL image candidates (sourced and verified — their URLs already work). Choose which image serves which section of the page and write honest alt text. Respond with ONLY JSON:

{"assign":[{"section":"section id from the list","url":"EXACTLY one candidate URL","alt":"what the image shows, <=70 chars, specific"}],"vibe":"one line of art direction: how imagery should feel on this page"}

Rules:
- Use ONLY the candidate URLs given. Never invent, shorten or edit a URL.
- One image per section, at most ${4} sections; prefer the hero first.
- The alt must describe the actual image content, not the business.
- If no candidate genuinely fits a section, skip that section — forcing a wrong photo is worse than clean typography.`;

/**
 * THE PHOTOGRAPHER — source, verify and assign real imagery for a page.
 * Returns { images:[{section,url,alt}], vibe, ai } — empty when the web
 * is unreachable or nothing fits (the page then ships with CSS art).
 * Never throws; photography is a bonus that must never cost a build.
 */
export async function findSiteImages(env, { queries = [], sections = [], team = null, brief = '' } = {}) {
  if (!queries.length || !sections.length) return { images: [], vibe: '', ai: false };
  const settled = await Promise.allSettled(queries.slice(0, 3).map((q) => searchImages(q, { limit: 6 })));
  const pool = [];
  const seen = new Set();
  for (const s of settled) {
    for (const img of (s.status === 'fulfilled' ? s.value : [])) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      pool.push(img);
    }
  }
  if (!pool.length) return { images: [], vibe: '', ai: false };

  const sectionList = sections.slice(0, 5).map((s) => `${s.id} (${s.name}${s.goal ? ` — ${String(s.goal).slice(0, 60)}` : ''})`).join('; ');
  const candidates = pool.slice(0, 8).map((c, i) => `${i + 1}. [${c.query}] "${c.title}" ${c.url}`).join('\n');
  try {
    const j = await runAgent(
      env,
      team,
      'photographer',
      'casting the photography',
      [
        { role: 'system', content: PHOTOGRAPHER_SYSTEM },
        {
          role: 'user',
          content: [
            `PAGE CONTEXT: ${String(brief).slice(0, 200)}`,
            `SECTIONS: ${sectionList}`,
            `CANDIDATES (verified, usable as-is):\n${candidates}`,
          ].join('\n'),
        },
      ],
      { json: true, maxTokens: 480, temperature: 0.4 },
      (out) => `${Array.isArray(out?.assign) ? out.assign.length : 0} image(s) placed`
    );
    const valid = new Map(pool.map((c) => [c.url, c]));
    const images = [];
    const usedSections = new Set();
    for (const a of (Array.isArray(j?.assign) ? j.assign : [])) {
      const section = String(a?.section || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 12);
      const url = String(a?.url || '');
      if (!section || usedSections.has(section) || !valid.has(url)) continue;
      usedSections.add(section);
      images.push({ section, url, alt: String(a?.alt || valid.get(url).title).slice(0, 90) });
      if (images.length >= 4) break;
    }
    if (!images.length) {
      // The AI skipped every section ("nothing fits") — assign a hero
      // photo only when one is genuinely RELEVANT to the brief (title/
      // query overlap). A random pretty picture is worse than clean type.
      const hero = sections.find((s) => s.id === 'hero');
      const relevant = relevantPool(pool, brief);
      if (hero && relevant[0]) {
        return {
          images: [{ section: 'hero', url: relevant[0].url, alt: relevant[0].title }],
          vibe: '', ai: true,
        };
      }
      return { images: [], vibe: '', ai: true };
    }
    return { images, vibe: String(j?.vibe || '').slice(0, 140), ai: true };
  } catch {
    // AI down → deterministic assignment with the same relevance gate:
    // best relevant candidate to the hero, the rest to the next sections.
    const relevant = relevantPool(pool, brief);
    const source = relevant.length ? relevant : [];
    const order = sections.slice(0, 4).map((s) => s.id);
    const heroFirst = [...order.filter((id) => id === 'hero'), ...order.filter((id) => id !== 'hero')];
    const images = heroFirst
      .slice(0, 4)
      .map((section, i) => (source[i] ? { section, url: source[i].url, alt: source[i].title } : null))
      .filter(Boolean);
    return { images, vibe: '', ai: false };
  }
}

/** Hostname allowlist check for an image URL (scheme-safe). */
export function isAllowedHost(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''), 'https://commons.wikimedia.org');
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_IMAGE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The sanitizer gate for <img src>: a URL is servable only when its host
 * is allowlisted AND the exact URL was verified by the Photographer for
 * THIS build (verifiedImages set). Nothing invented can pass.
 */
export function isAllowedImageSrc(rawUrl, verifiedImages = null) {
  const s = String(rawUrl || '').trim();
  if (!s || !isAllowedHost(s)) return false;
  if (verifiedImages && !verifiedImages.has(s)) return false;
  return true;
}
/** The IMAGES prompt block for the engineers — '' when no images. */
export function imagesBlock(images, vibe = '') {
  if (!images?.length) return '';
  const lines = [
    'REAL IMAGES for this page (verified URLs — use <img> ONLY with these exact URLs, never invent or alter any URL; loading="lazy", honest alt text, class="ph" for the built-in treatment):',
    ...images.map((im) => `- section ${im.section}: ${im.url} (alt: "${im.alt}")`),
  ];
  if (vibe) lines.push(`IMAGE MOOD: ${vibe}`);
  return lines.join('\n');
}
