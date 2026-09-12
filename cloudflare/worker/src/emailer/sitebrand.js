/**
 * SITEBRAND — the IDENTITY FIREWALL (Agent v11).
 *
 * THE BUG THIS MODULE KILLS (user-reported, three times): every website
 * the Studio built came out branded "Ai Draft" / "Aidraft Legal" with
 * links to aidraft.bond and the owner's single brand color. Root cause:
 * buildWebsite resolved `brandFor(env, profile)` — the CRM OWNER's
 * business identity — and injected it into every AI prompt, the nav,
 * the footer, the favicon and the webapp shell. The owner's identity
 * hijacked every client's page.
 *
 * THE FIX, in three layers:
 *
 *   1. RESOLVE  extractSiteBrand() — the CLIENT's brand comes from the
 *      BRIEF (quoted names, "named X", the page title), never from the
 *      owner profile. The owner's website/email/phone/address/color are
 *      NOT inherited. Owner facts (industry, audience, products) flow
 *      into prompts ONLY when the brief is genuinely about the owner's
 *      own business — which also fixes the "legal copy for a coffee
 *      stall" drift observed in v10.
 *   2. PROMPT   siteIdentityBlock() — every specialist reads a locked
 *      identity: THE CLIENT is <name>, nobody else. The Lead's
 *      brand_name (AI-understood) refines the deterministic extraction.
 *   3. SCRUB    scrubSiteHtml() — a deterministic final pass over the
 *      served HTML: any owner-brand token that still leaks (prompt-side
 *      fixes can never be 100%) is replaced before the page is stored.
 *      The build response reports how many leaks were caught.
 *
 * Everything here is deterministic and outage-proof — identity must
 * never depend on an AI call succeeding.
 */

import { esc } from './htmlutil.js';

const HEX_RE = /^#[0-9a-f]{6}$/i;

/* ══ Name extraction — the client is named in the brief ══════════════ */

/** Words that start a generic title, not a brand name. */
const GENERIC_TITLE_WORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'website', 'web', 'site', 'page', 'landing',
  'promo', 'offer', 'event', 'portfolio', 'report', 'webapp', 'app', 'build',
  'create', 'make', 'new', 'small', 'simple', 'best', 'official',
]);

/**
 * Pull the client's business/brand name out of free text. Strategy, in
 * order of trust:
 *   1. Quoted name:  "Musafir"  'Musafir'  “Musafir” — anywhere in the text.
 *   2. Named:        named X / called X / for my X (up to 4 words, stops at
 *                    punctuation or a preposition).
 *   3. Title head:   the first 1-4 words of the title when they are not
 *                    generic ("A website for my cafe" → nothing generic).
 * Never returns an empty string when `fallback` is non-empty.
 */
export function extractBrandName({ title = '', brief = '' } = {}, fallback = 'Our Business') {
  const t = String(title || '');
  const b = String(brief || '');
  const text = `${t}\n${b}`;

  // 1. Quoted names win — the user put them there deliberately.
  const quoted = /["“”'‘’]([A-Za-z0-9][A-Za-z0-9&.\- ]{2,38})["“”'‘’]/.exec(text);
  if (quoted) {
    const name = quoted[1].trim().replace(/\s+/g, ' ');
    if (!/^(optional|e\.?g\.?|example|title|button|text)$/i.test(name)) return name;
  }

  // 2. "named X" / "called X".
  const named = /\b(?:named|called)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,3})/.exec(text);
  if (named) return named[1].trim();

  // 2b. "for my X" / "for our X" — capture up to 3 title-case or salient words.
  const forMy = /\bfor\s+(?:my|our)\s+((?:[A-Za-z][\w&'-]*\s+){0,2}[A-Za-z][\w&'-]*)/.exec(text);
  if (forMy) {
    const words = forMy[1].trim().split(/\s+/).filter(Boolean);
    const salient = words.filter((w) => !GENERIC_TITLE_WORDS.has(w.toLowerCase()));
    if (salient.length) return salient.slice(0, 3).join(' ');
  }

  // 3. Title head, skipping generic openers.
  const head = t.split(/(?:[.!?:\n]|\s[—-]\s)/)[0].trim().split(/\s+/);
  const salient = [];
  for (const w of head) {
    if (GENERIC_TITLE_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''))) continue;
    salient.push(w);
    if (salient.length >= 3) break;
  }
  if (salient.length) return salient.join(' ');

  return fallback;
}

/** Map a plain color word to a seed hue (used only as a starting point). */
const COLOR_WORDS = {
  red: '#c0392b', crimson: '#b3282d', orange: '#d35400', amber: '#d97706',
  yellow: '#ca8a04', gold: '#b8860b', lime: '#65a30d', green: '#15803d',
  emerald: '#047857', teal: '#0f766e', cyan: '#0e7490', sky: '#0369a1',
  blue: '#1d4ed8', indigo: '#4338ca', violet: '#7c3aed', purple: '#7e22ce',
  magenta: '#c026d3', pink: '#db2777', rose: '#e11d48', brown: '#92400e',
  maroon: '#7f1d1d', black: '#111111', white: '#f5f5f5', silver: '#9ca3af',
};

/** A color word or hex in the brief → seed hex, else null. */
export function brandColorWord(text) {
  const s = String(text || '');
  const hex = /#([0-9a-f]{6})\b/i.exec(s);
  if (hex) return `#${hex[1].toLowerCase()}`;
  for (const [w, hexv] of Object.entries(COLOR_WORDS)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(s)) return hexv;
  }
  return null;
}

/* ══ The site brand — what every specialist works from ═══════════════ */

/**
 * Resolve the CLIENT brand for one site build.
 *
 * @returns { name, tagline, color (seed hex|null), website, ctaUrl,
 *            contactEmail, phone, address, isOwnerBusiness, profile,
 *            nameSource } — `name` is the ONLY required identity; the
 *            contact fields are empty unless the caller passed them
 *            explicitly (Studio form) or the site IS the owner's own
 *            business.
 */
export function extractSiteBrand({ title = '', brief = '', kind = '', ctaArgs = {}, profile = null, brand = null } = {}) {
  const p = profile || {};
  const ownerName = String(p.business_name || brand?.name || '').trim();

  // Is the brief about the owner's own business? Only then may owner
  // facts (industry, audience, offers, contacts) reach the prompts.
  const ownerMentioned = ownerName.length > 2
    && new RegExp(ownerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(`${title}\n${brief}`);
  const ownerish = /\b(my|our)\s+(business|company|brand|firm|shop|store|studio|agency|clinic|practice|law|legal)\b/i.test(brief)
    && !quotedNameDiffers(brief, ownerName);
  const isOwnerBusiness = Boolean(ownerName) && (ownerMentioned || (ownerish && !hasExplicitClientName(brief)));

  const nameSource = isOwnerBusiness ? 'owner-profile' : 'brief';
  const name = isOwnerBusiness
    ? ownerName
    : extractBrandName({ title, brief }, ownerName && ownerMentioned ? ownerName : (String(title).split(/[.!?\n]/)[0].trim() || 'Our Business'));

  const site = {
    name: String(name).slice(0, 80),
    tagline: isOwnerBusiness ? String(p.tagline || '').slice(0, 160) : '',
    // Seed hue: a color the BRIEF names wins; otherwise null → the design
    // DNA picks the family (per-build variety, never the owner's color).
    color: isOwnerBusiness && HEX_RE.test(String(p.brand_color || '')) ? p.brand_color : brandColorWord(brief),
    website: '',
    ctaUrl: String(ctaArgs.cta_url || '').trim().slice(0, 300),
    contactEmail: String(ctaArgs.contact_email || '').trim().slice(0, 90),
    phone: '',
    address: '',
    isOwnerBusiness,
    profile: p,
    nameSource,
  };
  if (isOwnerBusiness) {
    site.website = String(p.website || '').trim().slice(0, 300);
    site.ctaUrl = site.ctaUrl || String(p.cta_url || p.website || '').trim().slice(0, 300);
    site.contactEmail = site.contactEmail || String(p.contact_email || '').slice(0, 90);
    site.phone = String(p.phone || '').slice(0, 24);
    site.address = String(p.address || '').slice(0, 120);
  }
  return site;
}

function quotedNameDiffers(brief, ownerName) {
  const quoted = /["“”'‘’]([A-Za-z0-9][A-Za-z0-9&.\- ]{2,38})["“”'‘’]/.exec(String(brief || ''));
  return Boolean(quoted && ownerName && quoted[1].trim().toLowerCase() !== String(ownerName).toLowerCase());
}

function hasExplicitClientName(brief) {
  return /["“”'‘’][A-Za-z0-9]/.test(String(brief || ''))
    || /\b(named|called)\s+[A-Z]/.test(String(brief || ''));
}

/**
 * The owner tokens the scrubber hunts for. Call AFTER the final name is
 * locked (the Lead may have refined it) so site.name is never scrubbed.
 */
export function forbiddenTokens(site, brand = null) {
  const out = new Set();
  const owner = site?.profile || {};
  const push = (v) => { const s = String(v || '').trim(); if (s.length > 3) out.add(s); };
  if (!site?.isOwnerBusiness) {
    push(owner.business_name);
    push(brand?.name);
    if (owner.website) push(owner.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
    if (owner.cta_url) push(owner.cta_url.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
    push(owner.contact_email);
    push(owner.phone);
  }
  // The tool must never leak into client pages either (v12: the footer
  // credit "crafted by the Nebula agent" shipped for months — now every
  // tool-credit phrasing is scrubbed, not just the product name).
  push('Nebula CRM');
  push('nebulacrm');
  push('Nebula agent');
  push('Nebula Studio');
  push('Nebula AI');
  return [...out];
}

/* ══ Prompt block — the identity every specialist reads ══════════════ */

/**
 * The locked identity block. Facts (owner profile) appear ONLY when this
 * build is genuinely the owner's own business — that single rule fixed
 * the "legal copy for a coffee stall" drift from the v10 live runs.
 */
export function siteIdentityBlock(site, { forWebapp = false } = {}) {
  if (!site) return '';
  const lines = [
    `THE CLIENT: "${site.name}"`,
    'IDENTITY LAW: every name, logo, link, contact and brand mention on this page belongs to THE CLIENT above — never any other business, brand, domain, email or phone. Never mention the tool that built the page.',
  ];
  const p = site.profile && site.isOwnerBusiness ? site.profile : null;
  const facts = [];
  if (p?.industry) facts.push(`industry: ${p.industry}`);
  if (p?.audience) facts.push(`audience: ${p.audience}`);
  if (p?.tone) facts.push(`voice: ${p.tone}`);
  if (p?.products?.length) facts.push(`products: ${p.products.slice(0, 5).join('; ')}`);
  if (p?.about) facts.push(`about: ${String(p.about).slice(0, 200)}`);
  if (facts.length) lines.push(`CLIENT FACTS (use what fits): ${facts.join(' | ')}`);
  if (site.tagline) lines.push(`TAGLINE: ${site.tagline}`);
  if (site.website) lines.push(`CLIENT WEBSITE: ${site.website}`);
  if (site.phone) lines.push(`CLIENT PHONE: ${site.phone}`);
  if (site.address) lines.push(`CLIENT ADDRESS: ${site.address}`);
  if (forWebapp && site.name) lines.push(`App shell branding: name "${site.name}"${site.color ? `, seed color ${site.color}` : ''}.`);
  return lines.join('\n');
}

/* ══ The scrubber — deterministic last line of defense ═══════════════ */

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove owner-brand leaks from a finished page. Returns
 * { html, leaks } — leaks is the number of tokens scrubbed (0 = clean).
 * Owner URLs (aidraft.bond) become the site's CTA when one exists, else
 * '#'. Owner name/email/phone collapse into the client's name or vanish.
 */
export function scrubSiteHtml(html, site, brand = null) {
  let out = String(html || '');
  let leaks = 0;
  // Most specific first: the full email scrubs before its domain, the
  // full name before a partial — otherwise one token mangles another.
  const tokens = forbiddenTokens(site, brand).sort((a, b) => b.length - a.length);
  const replacement = esc(site?.name || 'Our Business');
  const ctaHref = site?.ctaUrl ? esc(site.ctaUrl) : '#';
  const emailSwap = site?.contactEmail ? esc(site.contactEmail) : replacement;
  for (const token of tokens) {
    const isEmail = /.+@.+/.test(token);
    const isUrl = !isEmail && /^[\w.-]+\.[a-z]{2,}/i.test(token);
    // Whole-value matching: a domain token scrubs the entire URL it
    // appears inside (no "https://#/book" nonsense), an email token
    // scrubs the whole address (no "das@#" leftovers).
    const pattern = isEmail
      ? `[\\w.+-]*${escapeRe(token)}`
      : isUrl
        ? `(?:https?:\\/\\/)?[\\w.+-]*\\.?${escapeRe(token)}[^\\s"'<>]*`
        : escapeRe(token);
    const re = new RegExp(pattern, 'gi');
    if (!re.test(out)) continue;
    out = out.replace(re, (match) => {
      leaks++;
      // URL tokens most often live in href/src attributes — swap the
      // whole URL for the client's CTA (or a dead '#'). Email tokens
      // become the client's contact (or the client's name).
      return isUrl ? ctaHref : isEmail ? emailSwap : replacement;
    });
  }
  return { html: out, leaks };
}
