/**
 * AI copywriter (Sarvam) + branded responsive HTML email builder.
 *
 * Copy is optimised for opens/clicks using the MailerCloud learnings, then
 * rendered into a mobile-safe template using Nebula CRM's brand (electric
 * indigo #6C8CFF primary, per lib/core/theme/app_colors.dart). Every
 * generated email is also saved into MailerCloud's template library
 * (POST /templates/create).
 */

import { sarvamChat } from './sarvam.js';
import { esc, htmlToText } from './http.js';
import { memoryContext } from './memory.js';

const COPY_SCHEMA_PROMPT = `Return ONLY a JSON object:
{
 "subject": "max 55 chars, curiosity/value driven, no ALL CAPS, no excessive emojis, must feel human",
 "preheader": "max 85 chars, complements (never repeats) the subject",
 "headline": "in-email headline",
 "intro": "1-2 sentence opening that hooks the reader",
 "sections": [ { "title": "section heading", "body": "2-4 sentences, concrete and useful" } ],
 "cta_text": "max 22 chars, action verb first",
 "closing": "1 line sign-off",
 "ps": "short P.S. hook (can be empty)"
}
Rules: no fake statistics, no fake testimonials, no invented customer names, no false scarcity.`;

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
    subject: String(copy.subject || `News from ${env.MAIL_BUSINESS_NAME || 'Nebula CRM'}`).slice(0, 120),
    preheader: String(copy.preheader || '').slice(0, 150),
    headline: String(copy.headline || 'Hello!'),
    intro: String(copy.intro || ''),
    sections: Array.isArray(copy.sections)
      ? copy.sections.slice(0, 4).map((s) => ({ title: String(s?.title || '').slice(0, 120), body: String(s?.body || '') })).filter((s) => s.body)
      : [],
    cta_text: String(copy.cta_text || 'Learn more').slice(0, 40),
    closing: String(copy.closing || 'Talk soon,'),
    ps: String(copy.ps || '').slice(0, 300),
  };
}

/**
 * Render copy into a branded, responsive HTML email (Nebula dark-premium palette).
 *
 * personalize: injects a `Hi {{first_name}},` salutation. The placeholder is
 * replaced per recipient by MailerCloud's mail merge (POST /email-api) —
 * ONLY use this when the message goes through the personalized endpoint;
 * on the plain /email endpoint the placeholder would be delivered literally.
 *
 * track: { campaignId, base } injects the open-tracking pixel. In merge
 * mode the per-recipient token travels as the {{open_uid}} merge var; for
 * single sends pass tokenFor to inline the real token.
 */
export function renderHtml(env, copy, { personalize = false, track = null } = {}) {
  const name = env.MAIL_BUSINESS_NAME || 'Nebula CRM';
  const brand = env.MAIL_BRAND_COLOR || '#6C8CFF';
  const logoUrl = env.MAIL_LOGO_URL || '';
  const ctaUrl = env.MAIL_CTA_URL || env.MAIL_WEBSITE_URL || '';
  const website = env.MAIL_WEBSITE_URL || '';
  const year = new Date().getUTCFullYear();

  const sections = copy.sections.map((s) => `
      <tr><td style="padding:18px 8px 0 8px;">
        <h3 style="margin:0 0 8px 0;font-size:17px;line-height:1.35;color:#111827;">${esc(s.title)}</h3>
        <p style="margin:0 0 12px 0;font-size:15px;line-height:1.65;color:#374151;">${esc(s.body)}</p>
      </td></tr>`).join('');

  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(name)}" width="132" style="display:block;border:0;max-width:132px;height:auto;">`
    : `<div style="font-size:19px;font-weight:700;letter-spacing:.3px;color:${esc(brand)};">${esc(name)}</div>`;

  const cta = ctaUrl ? `
      <tr><td style="padding:26px 8px 6px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" bgcolor="${esc(brand)}" style="border-radius:8px;">
            <a href="${esc(ctaUrl)}" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(copy.cta_text)}</a>
          </td>
        </tr></table>
      </td></tr>` : '';

  const ps = copy.ps ? `
      <tr><td style="padding:16px 8px 0 8px;">
        <p style="margin:0;font-size:13.5px;line-height:1.6;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:14px;"><em>P.S. ${esc(copy.ps)}</em></p>
      </td></tr>` : '';

  const permission =
    env.MAIL_PERMISSION_REMINDER ||
    `You are receiving this because you subscribed to updates from ${esc(name)}.`;

  const salutation = personalize
    ? `<p style="margin:0 0 6px 0;font-size:15.5px;line-height:1.65;color:#374151;">Hi {{first_name}},</p>`
    : '';

  // Open-tracking pixel: per-campaign id + per-recipient token. In merge
  // mode the token is a merge var ({{open_uid}}) resolved per recipient;
  // single sends pass `token` already resolved.
  let pixel = '';
  if (track?.campaignId) {
    const base = String(track.base || env.MAIL_PUBLIC_BASE_URL || 'https://nebula-crm-storage.nebula-crm.workers.dev').replace(/\/+$/, '');
    const u = track.token || '{{open_uid}}';
    pixel = `<img src="${base}/v1/t/o.png?c=${encodeURIComponent(track.campaignId)}&u=${encodeURIComponent(u)}" width="1" height="1" alt="" style="display:block;border:0;outline:none;">`;
  }

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6" style="margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
    <tr><td style="padding:26px 30px 10px 30px;" align="left">${logo}</td></tr>
    <tr><td style="padding:8px 30px 0 30px;">
      <h1 style="margin:14px 0 10px 0;font-size:24px;line-height:1.3;color:#111827;">${esc(copy.headline)}</h1>
      ${salutation}
      <p style="margin:0 0 6px 0;font-size:15.5px;line-height:1.65;color:#374151;">${esc(copy.intro)}</p>
    </td></tr>
    ${sections}${cta}${ps}
    <tr><td style="padding:26px 30px 18px 30px;">
      <p style="margin:0 0 4px 0;font-size:15px;color:#374151;">${esc(copy.closing)}</p>
      <p style="margin:0;font-size:15px;color:#111827;font-weight:600;">Team ${esc(name)}</p>
    </td></tr>
    <tr><td style="padding:0;">${pixel}</td></tr>
    <tr><td bgcolor="#f9fafb" style="padding:18px 30px;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:11.5px;line-height:1.6;color:#9ca3af;">${permission}<br>
      ${website ? `<a href="${esc(website)}" style="color:#6b7280;text-decoration:underline;">${esc(website)}</a><br>` : ''}© ${year} ${esc(name)}. All rights reserved.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
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
