/**
 * AI copywriter (Sarvam) + branded responsive HTML email builder.
 *
 * Copy is optimised for opens/clicks using the MailerCloud learnings, then
 * rendered into one of FIVE mobile-safe templates — always in the OWNER'S
 * business brand (name, logo, colour, website, signature, footer address)
 * coming from the Business Profile (business.js). Every generated email is
 * also saved into MailerCloud's template library (POST /templates/create).
 */

import { sarvamChat } from './sarvam.js';
import { esc, htmlToText } from './http.js';
import { memoryContext } from './memory.js';
import { normalizeStyle } from './business.js';

const COPY_SCHEMA_PROMPT = `Return ONLY a JSON object:
{
 "subject": "max 55 chars, curiosity/value driven, no ALL CAPS, no excessive emojis, must feel human",
 "preheader": "max 85 chars, complements (never repeats) the subject",
 "headline": "in-email headline",
 "intro": "1-2 sentence opening that hooks the reader",
 "sections": [ { "title": "section heading", "body": "2-4 sentences, concrete and useful" } ],
 "cta_text": "max 22 chars, action verb first",
 "closing": "1 line sign-off (do NOT include the business/team name here — the signature adds it)",
 "ps": "short P.S. hook (can be empty)"
}
Rules: no fake statistics, no fake testimonials, no invented customer names, no false scarcity.
NEVER write a greeting/salutation (Hi …, Hello …, Dear …) anywhere — the template adds a
personalized "Hi {{first_name}}," line automatically. Start the intro straight into the hook.`;

/**
 * The creative playbook — what separates an elite email marketer from a
 * template-filler. Injected as system-level craft guidance for every email.
 */
const CREATIVE_PLAYBOOK = `CRAFT RULES (this is what gets opens and clicks):
- SUBJECT: open with a curiosity gap or a specific, concrete outcome. Proven formulas:
  question ("Still printing invoices by hand?"), specific number ("3 tweaks that lifted our demos 40%"),
  loss-avoidance ("Your leads are cooling off"), insider/news ("We just shipped something for you"),
  personal/story ("I almost quit. Then this happened"). Pick the formula that fits THIS email's angle.
- PREHEADER must ADD information, never repeat the subject. Think of subject+preheader as a 2-line ad.
- INTRO: first line must earn the second. No "Hope this email finds you well". Jump straight into the reader's world.
- BODY: ONE core idea per email. Concrete > abstract: paint the before/after, use the reader's vocabulary.
- CTA: one email, ONE action. Verb-first, low-friction ("See it in action" beats "Submit").
- P.S. is prime real estate: restate the payoff or add urgency honestly (a real deadline only).
- VOICE: match the brand voice from memory/brief. Write like a sharp human, not a marketer. Short sentences win.
- IDENTITY: you write FOR the owner's business (see the BUSINESS block) — sign nothing, brand nothing
  yourself; the template stamps the business name, logo and website. Never mention the CRM tool.
- AVOID: spam trigger words in subject (FREE!!!, guaranteed, act now), emoji carpets, ALL CAPS words,
  generic filler ("we are pleased to announce"), fake urgency, wall-of-text paragraphs.`;

/** Generate the email copy for one planned email. */
export async function writeEmail(env, task, planEmail, brief, learnings, memory = null) {
  const learn = learnings
    ? `Analytics learnings from past campaigns (maximise for):\n${JSON.stringify({
        recommendations: learnings.recommendations || [],
        best_subject_styles: learnings.best_subject_styles || [],
        best_send_hour: learnings.best_send_hour,
      }).slice(0, 1000)}`
    : 'No analytics yet — use proven email best practices.';

  const memoryBlock = memoryContext(memory);

  const user = [
    'Write ONE high-engagement marketing email.',
    '',
    'BUSINESS:',
    JSON.stringify(brief),
    '',
    memoryBlock ? `BUSINESS MEMORY (owner-taught facts + proven plays for THIS business — follow them):\n${memoryBlock}` : '',
    '',
    'THIS EMAIL:',
    JSON.stringify(planEmail),
    '',
    'CAMPAIGN CONTEXT:',
    `Owner task: ${task.instruction.slice(0, 500)}`,
    `Plan reasoning: ${String(task.plan?.reasoning || '').slice(0, 300)}`,
    `Email ${planEmail.seq} of ${task.plan?.emails?.length ?? '?'}.`,
    '',
    learn,
    '',
    COPY_SCHEMA_PROMPT,
  ].filter(Boolean).join('\n');

  const copy = await sarvamChat(
    env,
    [
      { role: 'system', content: `You are an elite direct-response email copywriter and creative strategist. Your emails get opened because they are specific, honest and human — never spammy. You invent fresh angles (story hooks, pattern interrupts, bold specific promises) instead of recycling generic marketing phrases. You always reply with valid JSON.\n\n${CREATIVE_PLAYBOOK}` },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.8, maxTokens: 2500 }
  );

  return {
    subject: String(copy.subject || `News from ${brief?.business_name || 'our business'}`).slice(0, 120),
    preheader: String(copy.preheader || '').slice(0, 150),
    headline: String(copy.headline || 'Hello!'),
    intro: String(copy.intro || ''),
    sections: Array.isArray(copy.sections)
      ? copy.sections.slice(0, 4).map((s) => ({ title: String(s?.title || '').slice(0, 120), body: String(s?.body || '') })).filter((s) => s.body)
      : [],
    cta_text: String(copy.cta_text || 'Learn more').slice(0, 40),
    // Per-email destination chosen by the planner (sanitized again at render).
    cta_url: String(planEmail.link_url || '').trim().slice(0, 500),
    closing: String(copy.closing || 'Talk soon,'),
    ps: String(copy.ps || '').slice(0, 300),
  };
}

/* ═══════════════════════ Template system ═══════════════════════ */

const BG_PAGE = '#f3f4f6';

/** Shared building blocks ──────────────────────────────────────── */

function headMeta(copy) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(copy.subject)}</title>`;
}

function hiddenPreheader(copy) {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(copy.preheader)}</div>`;
}

/** Logo (image or styled business name) on a dark or light surface. */
function brandMark(brand, { dark = false } = {}) {
  const color = dark ? '#ffffff' : brand.color;
  if (brand.logoUrl) {
    return `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" width="132" style="display:block;border:0;max-width:132px;height:auto;">`;
  }
  return `<div style="font-size:19px;font-weight:700;letter-spacing:.3px;color:${esc(color)};">${esc(brand.name)}</div>`;
}

function brandLogoRow(brand, { dark = false, pad = '26px 30px 10px 30px' } = {}) {
  return `<tr><td style="padding:${pad};" align="left">${brandMark(brand, { dark })}</td></tr>`;
}

function salutationRow(personalize) {
  if (!personalize) return '';
  return `<p style="margin:0 0 6px 0;font-size:15.5px;line-height:1.65;color:#374151;">Hi {{first_name}},</p>`;
}

function sectionsRows(copy) {
  return copy.sections.map((s) => `
      <tr><td style="padding:18px 8px 0 8px;">
        <h3 style="margin:0 0 8px 0;font-size:17px;line-height:1.35;color:#111827;">${esc(s.title)}</h3>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.65;color:#374151;">${esc(s.body)}</p>
      </td></tr>`).join('');
}

function psRow(copy) {
  if (!copy.ps) return '';
  return `
      <tr><td style="padding:16px 8px 0 8px;">
        <p style="margin:0;font-size:13.5px;line-height:1.6;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:14px;"><em>P.S. ${esc(copy.ps)}</em></p>
      </td></tr>`;
}

function signatureBlock(brand, copy) {
  return `<p style="margin:0 0 4px 0;font-size:15px;color:#374151;">${esc(copy.closing)}</p>
      <p style="margin:0;font-size:15px;color:#111827;font-weight:600;">${esc(brand.signature)}</p>`;
}

function footerBlock(brand, year, unsub = '') {
  const contactBits = [
    brand.website ? `<a href="${esc(brand.website)}" style="color:#6b7280;text-decoration:underline;">${esc(brand.website)}</a>` : '',
    brand.address ? esc(brand.address) : '',
    brand.phone ? esc(brand.phone) : '',
    brand.contactEmail ? `<a href="mailto:${esc(brand.contactEmail)}" style="color:#6b7280;text-decoration:underline;">${esc(brand.contactEmail)}</a>` : '',
  ].filter(Boolean).join(' · ');
  // One-click unsubscribe (CAN-SPAM / GDPR compliance). Rendered only for
  // tracked personalized sends — the href carries the per-recipient token.
  const unsubLine = unsub
    ? `<br><a href="${esc(unsub)}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a> from these emails at any time.`
    : '';
  return `<p style="margin:0;font-size:11.5px;line-height:1.6;color:#9ca3af;">${esc(brand.permission)}<br>
      ${contactBits ? `${contactBits}<br>` : ''}© ${year} ${esc(brand.name)}. All rights reserved.${unsubLine}</p>`;
}

function openPixel(brand, copy, track) {
  if (!track?.campaignId) return '';
  const base = String(track.base || brand.publicBaseUrl || 'https://nebula-crm-storage.nebula-crm.workers.dev').replace(/\/+$/, '');
  const u = track.token || '{{open_uid}}';
  return `<img src="${base}/v1/t/o.png?c=${encodeURIComponent(track.campaignId)}&u=${encodeURIComponent(u)}" width="1" height="1" alt="" style="display:block;border:0;outline:none;">`;
}

/**
 * Click-tracked CTA href: the reader lands on a Worker redirect that counts
 * ONE click per unique (campaign, recipient) token, then 302s to the real
 * destination. Untracked renders (preview, campaign-mode sends with native
 * provider click reports) get the plain URL.
 */
function trackedCta(brand, track) {
  const dest = brand.ctaUrl || '';
  if (!dest) return '';
  if (!track?.campaignId || !track.wrap) return dest;
  const base = String(track.base || brand.publicBaseUrl || 'https://nebula-crm-storage.nebula-crm.workers.dev').replace(/\/+$/, '');
  const u = track.token || '{{open_uid}}';
  return `${base}/v1/t/c?c=${encodeURIComponent(track.campaignId)}&u=${encodeURIComponent(u)}&to=${encodeURIComponent(dest)}`;
}

function trackedUnsub(brand, track) {
  if (!track?.campaignId || !track.unsub) return '';
  const base = String(track.base || brand.publicBaseUrl || 'https://nebula-crm-storage.nebula-crm.workers.dev').replace(/\/+$/, '');
  const u = track.token || '{{open_uid}}';
  return `${base}/v1/t/u?c=${encodeURIComponent(track.campaignId)}&u=${encodeURIComponent(u)}`;
}

/** A darker shade of the brand colour for gradients/hovers. */
function shade(hex, amt = 0.25) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * (1 - amt))));
  const r = ch((n >> 16) & 255).toString(16).padStart(2, '0');
  const g = ch((n >> 8) & 255).toString(16).padStart(2, '0');
  const b = ch(n & 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/** Tint (mix with white) for soft backgrounds. */
function tint(hex, amt = 0.9) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return BG_PAGE;
  const n = parseInt(m[1], 16);
  const mix = (v) => Math.round(v + (255 - v) * amt);
  const r = mix((n >> 16) & 255).toString(16).padStart(2, '0');
  const g = mix((n >> 8) & 255).toString(16).padStart(2, '0');
  const b = mix(n & 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/* ── Style 1: modern — dark brand hero, light body (default) ──── */
function tplModern(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const hero = `
    <tr><td bgcolor="${esc(brand.color)}" style="padding:30px 30px 26px 30px;" align="left">
      ${brandMark(brand, { dark: true })}
      <h1 style="margin:16px 0 0 0;font-size:25px;line-height:1.28;color:#ffffff;">${esc(copy.headline)}</h1>
      ${brand.tagline ? `<p style="margin:8px 0 0 0;font-size:13px;color:rgba(255,255,255,.75);">${esc(brand.tagline)}</p>` : ''}
    </td></tr>`;
  const ctaBtn = cta ? `
      <tr><td style="padding:26px 8px 6px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${esc(brand.color)}" style="border-radius:8px;">
            <a href="${esc(cta)}" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(copy.cta_text)}</a>
          </td>
        </tr></table>
      </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:${BG_PAGE};">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG_PAGE}" style="margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
    ${hero}
    <tr><td style="padding:22px 30px 0 30px;">
      ${salutationRow(personalize)}
      <p style="margin:0 0 6px 0;font-size:15.5px;line-height:1.65;color:#374151;">${esc(copy.intro)}</p>
    </td></tr>
    ${sectionsRows(copy)}${ctaBtn}${psRow(copy)}
    <tr><td style="padding:26px 30px 18px 30px;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td bgcolor="#0f1115" style="padding:18px 30px;">${footerBlock(brand, year, unsub).replace(/color:#9ca3af;/g, 'color:#8b91a0;')}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Style 2: classic — clean light newsletter ────────────────── */
function tplClassic(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const ctaBtn = cta ? `
      <tr><td style="padding:24px 8px 6px 8px;">
        <a href="${esc(cta)}" style="display:inline-block;padding:12px 26px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;background-color:${esc(brand.color)};">${esc(copy.cta_text)}</a>
      </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:${BG_PAGE};">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG_PAGE}">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <tr><td style="padding:24px 30px;border-bottom:3px solid ${esc(brand.color)};" align="left">${brandMark(brand)}</td></tr>
    <tr><td style="padding:24px 30px 0 30px;">
      <h1 style="margin:0 0 12px 0;font-size:23px;line-height:1.3;color:#111827;">${esc(copy.headline)}</h1>
      ${salutationRow(personalize)}
      <p style="margin:0 0 6px 0;font-size:15.5px;line-height:1.7;color:#374151;">${esc(copy.intro)}</p>
    </td></tr>
    ${sectionsRows(copy)}${ctaBtn}${psRow(copy)}
    <tr><td style="padding:24px 30px 16px 30px;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td bgcolor="#f9fafb" style="padding:18px 30px;border-top:1px solid #e5e7eb;">${footerBlock(brand, year, unsub)}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Style 3: bold — promo / offer, huge colour blocks ────────── */
function tplBold(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const dark = shade(brand.color, 0.35);
  const ctaBtn = cta ? `
    <tr><td align="center" style="padding:28px 30px 8px 30px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#ffffff" style="border-radius:999px;">
          <a href="${esc(cta)}" style="display:inline-block;padding:15px 40px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;color:${esc(brand.color)};text-decoration:none;border-radius:999px;">${esc(copy.cta_text)} →</a>
        </td>
      </tr></table>
    </td></tr>` : '';
  const sections = copy.sections.map((s) => `
    <tr><td style="padding:14px 30px 0 30px;">
      <p style="margin:0 0 4px 0;font-size:15px;font-weight:700;color:#111827;">${esc(s.title)}</p>
      <p style="margin:0 0 10px 0;font-size:14.5px;line-height:1.6;color:#374151;">${esc(s.body)}</p>
    </td></tr>`).join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:${esc(dark)};">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${esc(dark)}">
<tr><td align="center" style="padding:0;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${esc(brand.color)};">
    <tr><td style="padding:26px 30px 6px 30px;" align="center">${brandMark(brand, { dark: true })}</td></tr>
    <tr><td align="center" style="padding:18px 34px 0 34px;">
      <h1 style="margin:0;font-size:31px;line-height:1.22;color:#ffffff;letter-spacing:-.3px;">${esc(copy.headline)}</h1>
      <p style="margin:12px 0 0 0;font-size:16px;line-height:1.6;color:rgba(255,255,255,.88);">${esc(copy.intro)}</p>
    </td></tr>
    ${ctaBtn}
    <tr><td style="padding:20px 0 30px 0;">${salutationRow(personalize).replace('color:#374151', 'color:rgba(255,255,255,.85)').replace('margin:0 0 6px 0;font-size:15.5px', 'margin:0;font-size:14.5px').replace('<p ', '<p align="center" style="padding:0 30px;" ')}</td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px 16px 0 0;">
    ${sections}${psRow(copy)}
    <tr><td style="padding:22px 30px 14px 30px;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td bgcolor="#0f1115" style="padding:18px 30px;border-radius:0 0 16px 16px;">${footerBlock(brand, year, unsub).replace(/color:#9ca3af;/g, 'color:#8b91a0;')}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Style 4: minimal — quiet, text-first, hairline rules ─────── */
function tplMinimal(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const sections = copy.sections.map((s) => `
    <tr><td style="padding:16px 0 0 0;border-top:1px solid #eeeeee;">
      <p style="margin:14px 0 4px 0;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${esc(brand.color)};">${esc(s.title)}</p>
      <p style="margin:0 0 8px 0;font-size:15px;line-height:1.7;color:#374151;">${esc(s.body)}</p>
    </td></tr>`).join('');
  const ctaBtn = cta ? `
    <tr><td style="padding:22px 0 4px 0;">
      <a href="${esc(cta)}" style="font-size:15px;font-weight:700;color:${esc(brand.color)};text-decoration:none;">${esc(copy.cta_text)} →</a>
    </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">
<tr><td align="center" style="padding:36px 20px;">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
    <tr><td style="padding:0 0 18px 0;border-bottom:1px solid #111827;" align="left">
      <span style="font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#111827;">${esc(brand.name)}</span>
      ${brand.tagline ? `<span style="font-size:12px;color:#6b7280;">&nbsp;· ${esc(brand.tagline)}</span>` : ''}
    </td></tr>
    <tr><td style="padding:26px 0 0 0;">
      <h1 style="margin:0 0 14px 0;font-size:24px;line-height:1.32;color:#111827;font-weight:600;">${esc(copy.headline)}</h1>
      ${salutationRow(personalize)}
      <p style="margin:0 0 8px 0;font-size:15.5px;line-height:1.75;color:#374151;">${esc(copy.intro)}</p>
    </td></tr>
    ${sections}${ctaBtn}${psRow(copy).replace('border-top:1px solid #e5e7eb;', 'border-top:1px solid #eeeeee;')}
    <tr><td style="padding:24px 0 6px 0;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td style="padding:26px 0 6px 0;border-top:1px solid #eeeeee;">${footerBlock(brand, year, unsub)}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Style 5: gradient — soft hero card, pill CTA ─────────────── */
function tplGradient(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const soft = tint(brand.color, 0.88);
  const dark = shade(brand.color, 0.3);
  const ctaBtn = cta ? `
      <tr><td style="padding:24px 8px 6px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${esc(dark)}" style="border-radius:999px;">
            <a href="${esc(cta)}" style="display:inline-block;padding:13px 34px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(copy.cta_text)}</a>
          </td>
        </tr></table>
      </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:${esc(soft)};">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${esc(soft)}">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:linear-gradient(135deg,${esc(brand.color)} 0%,${esc(dark)} 100%);border-radius:18px;">
    <tr><td style="padding:30px 32px 28px 32px;" align="left">
      ${brandMark(brand, { dark: true })}
      <h1 style="margin:18px 0 0 0;font-size:26px;line-height:1.26;color:#ffffff;">${esc(copy.headline)}</h1>
      <p style="margin:10px 0 0 0;font-size:15.5px;line-height:1.62;color:rgba(255,255,255,.9);">${esc(copy.intro)}</p>
      ${salutationRow(personalize).replace('color:#374151', 'color:rgba(255,255,255,.85)').replace('margin:0 0 6px 0', 'margin:14px 0 0 0')}
    </td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:0 0 18px 18px;">
    ${sectionsRows(copy)}${ctaBtn}${psRow(copy)}
    <tr><td style="padding:24px 30px 14px 30px;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td bgcolor="#f9fafb" style="padding:18px 30px;border-top:1px solid #e5e7eb;border-radius:0 0 18px 18px;">${footerBlock(brand, year, unsub)}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Style 6: editorial — serif magazine feel, hairline kickers ── */
function tplEditorial(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const serif = "Georgia,'Times New Roman',Times,serif";
  const sections = copy.sections.map((s) => `
    <tr><td style="padding:22px 0 0 0;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 6px 0;font-family:${serif};font-size:11px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:${esc(brand.color)};">${esc(s.title)}</p>
      <p style="margin:0;font-family:${serif};font-size:15.5px;line-height:1.8;color:#1f2937;">${esc(s.body)}</p>
    </td></tr>`).join('');
  const ctaBtn = cta ? `
    <tr><td style="padding:26px 0 4px 0;border-top:1px solid #e5e7eb;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" style="border:1.5px solid ${esc(brand.color)};border-radius:2px;">
          <a href="${esc(cta)}" style="display:inline-block;padding:12px 34px;font-family:${serif};font-size:14px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:${esc(brand.color)};text-decoration:none;">${esc(copy.cta_text)}</a>
        </td>
      </tr></table>
    </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff">
<tr><td align="center" style="padding:34px 18px;">
  <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:580px;">
    <tr><td style="padding:0 0 20px 0;border-bottom:2px solid #111827;" align="left">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="left">${brandMark(brand)}</td>
        <td align="right" style="font-family:${serif};font-size:10.5px;letter-spacing:1.8px;text-transform:uppercase;color:#9ca3af;">${esc(brand.tagline || copy.preheader.slice(0, 40))}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:30px 0 0 0;">
      <h1 style="margin:0 0 14px 0;font-family:${serif};font-size:30px;line-height:1.24;color:#111827;font-weight:700;letter-spacing:-.4px;">${esc(copy.headline)}</h1>
      ${salutationRow(personalize)}
      <p style="margin:6px 0 0 0;font-family:${serif};font-size:16.5px;line-height:1.75;color:#111827;">${esc(copy.intro)}</p>
    </td></tr>
    ${sections}${ctaBtn}${psRow(copy).replace('border-top:1px solid #e5e7eb;padding-top:14px;', 'border-top:1px solid #e5e7eb;padding-top:16px;')}
    <tr><td style="padding:28px 0 6px 0;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td style="padding:26px 0 8px 0;border-top:2px solid #111827;">${footerBlock(brand, year, unsub)}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/* ── Style 7: spotlight — product/launch showcase, feature cards ─ */
function tplSpotlight(brand, copy, { personalize, pixel, cta, unsub }) {
  const year = new Date().getUTCFullYear();
  const dark = shade(brand.color, 0.55);
  const glow = tint(brand.color, 0.86);
  const pairs = [];
  for (let i = 0; i < copy.sections.length; i += 2) {
    const pair = copy.sections.slice(i, i + 2);
    pairs.push(`
      <tr><td style="padding:6px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${pair.map((s) => `
        <td width="50%" align="top" style="padding:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${esc(glow)};border-radius:12px;">
            <tr><td style="padding:16px 16px 14px 16px;">
              <p style="margin:0 0 6px 0;font-size:14.5px;font-weight:700;color:#111827;">${esc(s.title)}</p>
              <p style="margin:0;font-size:13px;line-height:1.6;color:#4b5563;">${esc(s.body)}</p>
            </td></tr>
          </table>
        </td>`).join('')}
        ${pair.length === 1 ? '<td width="50%">&nbsp;</td>' : ''}
      </tr></table></td></tr>`);
  }
  const ctaBtn = cta ? `
      <tr><td align="center" style="padding:26px 30px 6px 30px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="#ffffff" style="border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.18);">
            <a href="${esc(cta)}" style="display:inline-block;padding:15px 42px;font-family:Arial,Helvetica,sans-serif;font-size:15.5px;font-weight:800;color:${esc(dark)};text-decoration:none;border-radius:12px;">${esc(copy.cta_text)}</a>
          </td>
        </tr></table>
      </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>${headMeta(copy)}</head>
<body style="margin:0;padding:0;background-color:${esc(dark)};">
${hiddenPreheader(copy)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${esc(dark)}">
<tr><td align="center" style="padding:0;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:linear-gradient(160deg,${esc(brand.color)} 0%,${esc(dark)} 78%);">
    <tr><td align="center" style="padding:38px 40px 10px 40px;">${brandMark(brand, { dark: true })}</td></tr>
    <tr><td align="center" style="padding:16px 44px 6px 44px;">
      <h1 style="margin:0;font-size:33px;line-height:1.2;color:#ffffff;letter-spacing:-.5px;">${esc(copy.headline)}</h1>
      <p style="margin:14px 0 0 0;font-size:15.5px;line-height:1.65;color:rgba(255,255,255,.88);">${esc(copy.intro)}</p>
      ${salutationRow(personalize).replace('color:#374151', 'color:rgba(255,255,255,.85)').replace('margin:0 0 6px 0', 'margin:16px 0 0 0')}
    </td></tr>
    ${ctaBtn}
    <tr><td style="padding:16px 0 34px 0;"></td></tr>
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:20px 20px 0 0;">
    <tr><td style="padding:24px 24px 0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pairs.join('')}</table>
    </td></tr>
    ${psRow(copy)}
    <tr><td align="center" style="padding:22px 30px 10px 30px;">${signatureBlock(brand, copy)}</td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td bgcolor="#0f1115" style="padding:18px 30px;border-radius:0 0 20px 20px;">${footerBlock(brand, year, unsub).replace(/color:#9ca3af;/g, 'color:#8b91a0;')}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

const RENDERERS = {
  modern: tplModern,
  classic: tplClassic,
  bold: tplBold,
  minimal: tplMinimal,
  gradient: tplGradient,
  editorial: tplEditorial,
  spotlight: tplSpotlight,
};

/**
 * Render copy into a branded, responsive HTML email.
 *
 * brand   — resolved Business Profile branding (business.js brandFor()).
 * style   — 'modern' | 'classic' | 'bold' | 'minimal' | 'gradient' |
 *           'editorial' | 'spotlight' (legacy planner values are mapped
 *           by normalizeStyle).
 * personalize — injects a `Hi {{first_name}},` salutation. The placeholder is
 *           replaced per recipient by MailerCloud's mail merge — ONLY use this
 *           when the message goes through the personalized endpoint.
 * track   — { campaignId, base, token, wrap, unsub } injects engagement
 *           tracking: the open pixel ALWAYS when campaignId is present; the
 *           click-redirect wrap applies to CTA links when `wrap` is true; the
 *           one-click unsubscribe footer link renders when `unsub` is true.
 *           In merge mode the per-recipient token travels as the {{open_uid}}
 *           merge var; single sends pass token already resolved.
 */
export function renderHtml(env, copy, { personalize = false, track = null, brand = null, style = '' } = {}) {
  const b = brand || {
    name: env.MAIL_BUSINESS_NAME || 'Nebula CRM',
    tagline: '',
    color: env.MAIL_BRAND_COLOR || '#6C8CFF',
    logoUrl: env.MAIL_LOGO_URL || '',
    website: env.MAIL_WEBSITE_URL || '',
    ctaUrl: env.MAIL_CTA_URL || env.MAIL_WEBSITE_URL || '',
    address: '', phone: '', contactEmail: '',
    signature: `Team ${env.MAIL_BUSINESS_NAME || 'Nebula CRM'}`,
    fromName: env.MAIL_BUSINESS_NAME || 'Nebula CRM',
    permission: env.MAIL_PERMISSION_REMINDER || `You are receiving this because you subscribed to updates from ${env.MAIL_BUSINESS_NAME || 'Nebula CRM'}.`,
    defaultStyle: 'modern',
    publicBaseUrl: env.MAIL_PUBLIC_BASE_URL || '',
  };
  // Per-email destination override (the planner/copywriter may point this
  // email at a specific page of the business) — sanitized to http(s).
  let ctaOverride = String(copy.cta_url || '').trim();
  if (ctaOverride && !/^https?:\/\//i.test(ctaOverride)) ctaOverride = '';
  const effective = ctaOverride ? { ...b, ctaUrl: ctaOverride } : b;
  const chosen = normalizeStyle(style) || normalizeStyle(b.defaultStyle) || 'modern';
  const pixel = openPixel(b, copy, track);
  const cta = trackedCta(effective, track);
  const unsub = trackedUnsub(effective, track);
  return (RENDERERS[chosen] || tplModern)(effective, copy, { personalize, pixel, cta, unsub });
}

/** Save the generated email into MailerCloud's template library (non-fatal). */
export async function saveTemplate(mc, env, copy, html, tag = '') {
  const enabled = (env.MC_CREATE_TEMPLATES ?? 'true') !== 'false';
  if (!enabled) return null;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const name = `AI ${tag ? '[' + tag + '] ' : ''}| ${copy.subject.slice(0, 60)} | ${stamp}`;
  try {
    return await mc.createTemplate(name, html, htmlToText(html));
  } catch (err) {
    console.warn(`[mailer] template save failed (non-fatal): ${err.message}`);
    return null;
  }
}
