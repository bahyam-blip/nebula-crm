/**
 * Business Profile — the owner's brand identity, entered once in the app
 * and used EVERYWHERE emails are written and sent:
 *
 *   From name        "Aidraft Legal"  (was the hardcoded "Nebula CRM")
 *   Header/logo      business logo or styled business name
 *   Signature        "Team Aidraft Legal" (configurable)
 *   Footer           business name + address + website + permission line
 *   CTA              points at the business website
 *   AI context       planner + copywriter prompts carry the profile, and
 *                    saving the profile teaches the Business Memory with
 *                    owner authority (owner facts beat AI inference).
 *
 * Storage: the same state store as tasks/memory (Workers KV → D1 backend),
 * key `biz:profile`. Survives redeploys; no extra setup.
 *
 * Endpoints (see pipeline.js):
 *   GET  /v1/mail/business   — the current profile (+ what branding is live)
 *   POST /v1/mail/business   — save a partial patch; returns the merged profile
 */

const PROFILE_KEY = 'biz:profile';
const BRIEF_CACHE_KEY = 'biz:brief';

/** Canonical template styles the AI can pick from (see copywriter.js). */
export const TEMPLATE_STYLES = ['modern', 'classic', 'bold', 'minimal', 'gradient', 'editorial', 'spotlight', 'aurora', 'promo', 'letter'];

/** Legacy planner values → canonical render styles. */
const STYLE_ALIASES = {
  newsletter: 'classic',
  announcement: 'modern',
  offer: 'promo',
  discount: 'promo',
  sale: 'promo',
  story: 'letter',
  personal: 'letter',
  tip: 'gradient',
  magazine: 'editorial',
  product: 'spotlight',
  launch: 'spotlight',
  dark: 'aurora',
  neon: 'aurora',
  premium: 'aurora',
  invite: 'aurora',
};

export function normalizeStyle(style) {
  const s = String(style || '').toLowerCase().trim();
  if (TEMPLATE_STYLES.includes(s)) return s;
  if (STYLE_ALIASES[s]) return STYLE_ALIASES[s];
  return '';
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function emptyBusinessProfile() {
  return {
    // Identity
    business_name: '',
    tagline: '',
    about: '',           // 1-3 sentences: what the business does
    industry: '',
    logo_url: '',
    brand_color: '',     // hex like #7C5CFF
    // Offering & voice (synced into AI memory)
    products: [],        // products / services
    audience: '',
    tone: '',
    offers: [],          // current promos
    // Contact & compliance (footer + reply identity)
    website: '',
    cta_url: '',         // where the email's main button points (falls back to website)
    address: '',
    phone: '',
    contact_email: '',
    // Sending identity
    sender_name: '',     // From display name (defaults to business_name)
    signature_name: '',  // "See you in the inbox, ___" (defaults to "Team <name>")
    default_style: '',   // preferred template style (AI may still vary)
    updatedAt: null,
  };
}

function cleanList(v, cap = 12) {
  const list = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[;,\n]/)
      : [];
  return list.map((x) => String(x || '').trim().slice(0, 160)).filter(Boolean).slice(0, cap);
}

function cleanField(v, cap) {
  return typeof v === 'string' ? v.trim().slice(0, cap) : '';
}

/** Validate + merge a patch onto the stored profile. Unknown keys dropped. */
export function mergeProfilePatch(current, patch = {}) {
  const p = { ...current };
  for (const k of ['business_name', 'tagline', 'about', 'industry', 'audience', 'tone', 'address', 'sender_name', 'signature_name']) {
    if (k in patch) p[k] = cleanField(patch[k], 300);
  }
  for (const k of ['website', 'logo_url', 'cta_url']) {
    if (k in patch) p[k] = cleanField(patch[k], 500);
  }
  if ('contact_email' in patch) p.contact_email = cleanField(patch.contact_email, 200).toLowerCase();
  if ('phone' in patch) p.phone = cleanField(patch.phone, 40);
  for (const k of ['products', 'offers']) {
    if (k in patch) p[k] = cleanList(patch[k]);
  }
  if ('brand_color' in patch) {
    const c = cleanField(patch.brand_color, 9);
    p.brand_color = HEX_RE.test(c) ? c.toLowerCase() : '';
  }
  if ('default_style' in patch) {
    p.default_style = normalizeStyle(patch.default_style);
  }
  // Website sanity: keep the scheme so links in emails always work.
  for (const k of ['website', 'cta_url']) {
    if (p[k] && !/^https?:\/\//i.test(p[k])) p[k] = `https://${p[k]}`;
  }
  p.updatedAt = new Date().toISOString();
  return p;
}

export async function getBusinessProfile(store) {
  if (!store) return emptyBusinessProfile();
  const raw = await store.get(PROFILE_KEY).catch(() => null);
  if (!raw) return emptyBusinessProfile();
  try {
    const saved = JSON.parse(raw);
    return { ...emptyBusinessProfile(), ...saved, updatedAt: saved?.updatedAt || null };
  } catch {
    return emptyBusinessProfile();
  }
}

/**
 * Save a patch. Also: invalidate the AI brief cache (so the very next
 * plan/write sees the new brand) — the caller teaches the Business Memory.
 * Returns the merged profile.
 */
export async function saveBusinessProfile(store, patch = {}) {
  const current = await getBusinessProfile(store);
  const merged = mergeProfilePatch(current, patch);
  await store.put(PROFILE_KEY, JSON.stringify(merged));
  // The brief is brand-aware and cached ~7d — drop it so the AI rebuilds.
  await store.delete(BRIEF_CACHE_KEY).catch(() => {});
  return merged;
}

/** True when enough identity exists to brand an email differently from the defaults. */
export function profileHasBrand(p) {
  return !!(p && (p.business_name || p.sender_name));
}

/**
 * The resolved brand used by rendering + sending. Everything falls back
 * through profile → env → Nebula defaults, so a half-filled profile still
 * renders a coherent email.
 */
export function brandFor(env, profile) {
  const p = profile || emptyBusinessProfile();
  const name = p.business_name || env.MAIL_BUSINESS_NAME || 'Nebula CRM';
  const website = p.website || env.MAIL_WEBSITE_URL || '';
  return {
    name,
    tagline: p.tagline || '',
    color: p.brand_color || env.MAIL_BRAND_COLOR || '#6C8CFF',
    logoUrl: p.logo_url || env.MAIL_LOGO_URL || '',
    website,
    ctaUrl: p.cta_url || env.MAIL_CTA_URL || website,
    address: p.address || '',
    phone: p.phone || '',
    contactEmail: p.contact_email || '',
    signature: p.signature_name || `Team ${name}`,
    fromName: p.sender_name || p.business_name || env.MAILERCLOUD_SENDER_NAME || env.MAIL_FROM_NAME || name,
    permission:
      env.MAIL_PERMISSION_REMINDER ||
      `You are receiving this because you subscribed to updates from ${name}.`,
    defaultStyle: p.default_style || 'modern',
    branded: profileHasBrand(p),
  };
}

/**
 * Map a profile patch onto Business Memory facts so saving the profile
 * instantly teaches the AI (origin: 'owner' — beats every AI inference).
 */
export function profileToFacts(patch) {
  const facts = {};
  const about = cleanField(patch.about ?? '', 300);
  const name = cleanField(patch.business_name ?? '', 300);
  if (about) facts.business_type = name ? `${name} — ${about}` : about;
  const industry = cleanField(patch.industry ?? '', 300);
  if (industry) facts.industry = industry;
  const audience = cleanField(patch.audience ?? '', 300);
  if (audience) facts.audience = audience;
  const tone = cleanField(patch.tone ?? '', 300);
  if (tone) facts.tone = tone;
  const products = cleanList(patch.products ?? []);
  if (products.length) facts.products = products;
  const offers = cleanList(patch.offers ?? []);
  if (offers.length) facts.offers = offers;
  return facts;
}

/**
 * A compact owner-profile block for the planner/copywriter prompts — the
 * AI should speak AS this business and never mention the CRM tool itself.
 */
export function profileContext(p) {
  if (!p) return '';
  const lines = [];
  if (p.business_name) lines.push(`Business name: ${p.business_name}`);
  if (p.tagline) lines.push(`Tagline: ${p.tagline}`);
  if (p.about) lines.push(`What they do: ${p.about}`);
  if (p.industry) lines.push(`Industry: ${p.industry}`);
  if (p.products?.length) lines.push(`Products/services: ${p.products.join('; ')}`);
  if (p.audience) lines.push(`Customers: ${p.audience}`);
  if (p.tone) lines.push(`Brand voice: ${p.tone}`);
  if (p.offers?.length) lines.push(`Current offers: ${p.offers.join('; ')}`);
  if (p.website) lines.push(`Website: ${p.website}`);
  if (p.cta_url && p.cta_url !== p.website) lines.push(`Main link for email buttons: ${p.cta_url}`);
  return lines.length ? lines.join('\n') : '';
}
