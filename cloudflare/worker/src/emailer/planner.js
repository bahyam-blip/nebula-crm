/**
 * AI brain (Sarvam) for the mailer:
 *   1. buildBusinessBrief — studies the owner's business profile (+ website
 *      text when reachable) into a reusable marketing brief (KV-cached 7d).
 *   2. planTask — converts a plain-language owner instruction into an
 *      executable plan: audience (status segment + cap), number of emails,
 *      exact send times, angle/tone per email.
 * Analytics learnings are injected into both, closing the feedback loop.
 */

import { sarvamChat } from './sarvam.js';
import { fetchWithBackoff } from './http.js';
import { getMemory, memoryContext } from './memory.js';
import { profileContext, TEMPLATE_STYLES } from './business.js';

const BRIEF_SCHEMA_PROMPT = `Return ONLY a JSON object:
{
 "business_type": "one-line what the business is",
 "industry": "industry name",
 "target_audience": "who the customers are",
 "value_props": ["3-5 core value propositions, short"],
 "tone": "recommended brand voice in 3-5 words",
 "topics_pool": ["8-12 evergreen email topics suited to this business"],
 "segment_hints": ["possible audience segments e.g. lead, customer"],
 "language": "en"
}`;

const PLAN_SCHEMA_PROMPT = `Return ONLY a JSON object:
{
 "understanding": "1-2 sentences: what the owner asked for",
 "audience": { "segment": "a status value to target (lead|customer|mql|sql|opportunity|subscriber) or null for everyone", "max_recipients": <number> },
 "explicit_recipients": ["email addresses EXPLICITLY named in the task, e.g. send to x@y.com — empty array if none"],
 "emails": [
   {
     "seq": 1,
     "sendAt": "YYYY-MM-DDTHH:MM:SS+05:30 (ISO 8601 with the business timezone offset)",
     "goal": "what this email should achieve",
     "angle": "the creative angle/hook",
     "tone": "tone for this email",
     "template_style": "modern|classic|bold|minimal|gradient|editorial|spotlight|aurora|promo|letter — pick what fits: offer/discount → promo, product/launch → spotlight, story/personal → letter, tip/how-to → gradient, news/announcement → modern, roundup → classic, premium/invite/event → aurora, magazine → editorial, quiet update → minimal",
     "design_notes": "styling/vibe the owner's own words demand (e.g. 'festive and energetic', 'dark premium', 'formal corporate', 'playful with emojis'). Omit when the owner gave no style direction.",
     "link_url": "OPTIONAL destination for the email's main button: the business website or main link from the brief. Omit to use the default."
   }
 ],
 "reasoning": "why this schedule and these angles will maximise opens & engagement"
}`;

/** Best-effort fetch of the business website's visible text. */
async function websiteText(env) {
  const url = env.MAIL_WEBSITE_URL;
  if (!url) return '';
  try {
    const res = await fetchWithBackoff(url, { method: 'GET' }, 1);
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3500);
  } catch {
    return '';
  }
}

/**
 * Step 1 — understand the business (cached ~7 days in the state store).
 *
 * Context priority: owner profile → website text → CRM data. Even when the
 * owner never filled MAIL_BUSINESS_PROFILE, the brief is inferred from what
 * the CRM itself knows (contact companies, segments, tags) and from the
 * owner's recent campaign instructions — so the AI always has a business
 * to write for.
 */
export async function buildBusinessBrief(env, kv, { crmStats = null, recentInstructions = [], profile = null, force = false } = {}) {
  if (!force && kv) {
    const cached = await kv.get('biz:brief');
    if (cached) return JSON.parse(cached);
  }

  const site = await websiteText(env);
  const profileBlock = profileContext(profile);
  const profileGiven = !!profileBlock || !!(env.MAIL_BUSINESS_PROFILE && env.MAIL_BUSINESS_PROFILE.trim());
  const hasCrmContext = !!crmStats && (crmStats.total || 0) > 0;

  const crmContext = hasCrmContext
    ? [
        'CRM AUDIENCE DATA (who this business already sells/serves):',
        JSON.stringify({
          contacts: crmStats.total,
          lifecycle_segments: crmStats.segments,
          top_companies: (crmStats.top_companies || []).slice(0, 8),
          top_tags: (crmStats.top_tags || []).slice(0, 8),
        }),
      ].join('\n')
    : '';

  const instructionContext = recentInstructions.length
    ? ['RECENT CAMPAIGN INSTRUCTIONS FROM THE OWNER (what they ask the AI to email about):',
       ...recentInstructions.slice(0, 5).map((s) => `- ${String(s).slice(0, 220)}`)].join('\n')
    : '';

  const inferred = !profileGiven && !site && (hasCrmContext || recentInstructions.length);
  const businessName = profile?.business_name || env.MAIL_BUSINESS_NAME || 'Nebula CRM';

  const user = [
    'Analyse this business and build a marketing brief for its email campaigns.',
    `Business name: ${businessName}`,
    profileBlock
      ? `OWNER BUSINESS PROFILE (the brand these emails are sent for — authoritative):
${profileBlock}`
      : profileGiven
        ? `Owner-provided profile: ${env.MAIL_BUSINESS_PROFILE}`
        : 'Owner-provided profile: (not provided — infer the business from the context below)',
    site ? `Website content (truncated):\n${site}` : '',
    crmContext,
    instructionContext,
    inferred
      ? 'The business type MUST be inferred primarily from the CRM data and owner instructions above.'
      : '',
    '',
    BRIEF_SCHEMA_PROMPT,
  ].filter(Boolean).join('\n');

  const brief = await sarvamChat(
    env,
    [
      { role: 'system', content: 'You are a senior email marketing strategist. Understand a business deeply so you can write high-open-rate emails for it later.' },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.4, maxTokens: 2000 }
  );

  brief.generatedAt = new Date().toISOString();
  brief.business_name = businessName;
  brief.source = profileBlock ? 'business-profile' : profileGiven ? 'owner-profile' : site ? 'website' : inferred ? 'crm-inferred' : 'guess';

  // Owner-entered Business Profile fields are authoritative brand facts —
  // apply them straight onto the brief (memory owner-facts still merge below).
  if (profile) {
    if (profile.about) brief.business_type = profile.about;
    if (profile.industry) brief.industry = profile.industry;
    if (profile.audience) brief.target_audience = profile.audience;
    if (profile.tone) brief.tone = profile.tone;
    if (profile.products?.length) brief.products = profile.products;
    if (profile.offers?.length) brief.offers = profile.offers;
    if (profile.tagline) brief.tagline = profile.tagline;
  }

  // Owner-taught Business Memory always outranks AI inference.
  try {
    const mem = await getMemory(kv);
    const f = mem.facts || {};
    if (f.business_type) brief.business_type = f.business_type;
    if (f.industry) brief.industry = f.industry;
    if (f.audience) brief.target_audience = f.audience;
    if (f.tone) brief.tone = f.tone;
    if (f.products?.length) brief.products = f.products;
    if (f.offers?.length) brief.offers = f.offers;
    if (f.business_type) brief.source = 'business-memory';
  } catch { /* memory is best-effort */ }

  if (kv) await kv.put('biz:brief', JSON.stringify(brief), { expirationTtl: 60 * 60 * 24 * 7 });
  return brief;
}

/** Step 2 — turn an owner instruction into an executable multi-email plan. */
export async function planTask(env, kv, task, brief, learnings, contactStats, memory = null) {
  const learn = learnings && (learnings.recommendations?.length || learnings.observations?.length)
    ? `Past-campaign learnings (apply them):\n${JSON.stringify(learnings).slice(0, 1200)}`
    : 'No past analytics yet — use marketing best practice.';

  const memoryBlock = memoryContext(memory);

  const user = [
    `Current time: ${new Date().toISOString()} (business timezone: ${env.MAIL_TIMEZONE || 'Asia/Calcutta'}).`,
    '',
    'BUSINESS BRIEF:',
    JSON.stringify(brief),
    '',
    memoryBlock ? `BUSINESS MEMORY (owner-taught facts + what already worked — this outranks the brief):\n${memoryBlock}` : '',
    '',
    'CRM AUDIENCE (contacts collection — real people you are writing to; the greeting uses each recipient\'s own name automatically, and you may reference companies/segments when it helps):',
    JSON.stringify(contactStats),
    '',
    learn,
    '',
    'OWNER TASK (plain language — decide everything from it):',
    task.instruction,
    '',
    'RULES:',
    '- Respect any explicit email count, recipient count, dates or deadlines in the task. The engine also enforces these deterministically — your numbers must match the owner\'s words, not your own preference.',
    '- SINGULAR MEANS ONE: "send a marketing email to 200 contacts" is ONE email to 200 people — plan exactly 1 email. Only plan a multi-email sequence when the owner asks for a series, follow-ups, or an email count of 2 or more.',
    '- "200 emails/contacts from the contacts" means 200 RECIPIENTS, not 200 separate campaigns. Set audience.max_recipients to the number the owner gave.',
    '- "from the contacts" / "from my contacts" (no status word) means the WHOLE contacts list — audience.segment MUST be null. Only set a segment when the owner names a status (leads/customers/subscribers…).',
    '- If the task names specific email addresses, list them in explicit_recipients EXACTLY as written (they are sent to directly, bypassing the segment).',
    '- URGENCY: if the task says "right away", "now", "immediately", "asap" or "today", the FIRST email must go out within 15 minutes of the current time. Never push an urgent task days into the future.',
    '- If the task does NOT mention a date/time/day/urgency, treat it as immediate: first sendAt within 10 minutes. Owners expect action, not a distant reservation.',
    '- Only schedule beyond 48 hours when the task explicitly says so ("next Monday", "3 emails over 2 weeks", a named date, "at 6pm", "tonight").',
    '- If the task gives no count, choose 1-2 emails spaced 2-5 days apart — when in doubt, 1.',
    `- If the task gives no recipient count, cap at ${contactStats.total}.`,
    `- sendAt must be in the future, between 08:00-20:00 in ${env.MAIL_TIMEZONE || 'Asia/Calcutta'}, never all at the same minute. EXCEPTION: urgent tasks (rule above) may send any time within the next 15 minutes.`,
    '- Vary angles across emails (story → proof → urgency, etc.).',
    '- Detect the campaign type (promotion, introduction, re-engagement, announcement, newsletter, follow-up) and let it shape the angles.',
    '- OBEY the owner\'s styling commands: words like "festive", "dark", "premium", "formal", "playful", "colorful", "simple", "luxury", "urgent" map to template_style and design_notes — the copy and layout must feel the way the owner asked.',
    '- Reuse angles from the CREATIVE PLAYBOOK that are marked WINNER. Never repeat subjects of FLOP emails or of the recent campaign focus list.',
    '- The audience.segment MUST be one of the CRM statuses shown in contact_stats.segments, or null for everyone.',
    `- template_style MUST be one of: ${TEMPLATE_STYLES.join('|')}. Pick per email goal (offer/discount → promo, product/launch → spotlight, story/personal → letter, tip → gradient, announcement → modern, roundup → classic, premium/invite/event → aurora) and vary across emails.`,
    '- link_url, when set, must be the business website / main link from the brief (https). Never invent domains that are not in the brief or memory.',
    '',
    PLAN_SCHEMA_PROMPT,
  ].filter(Boolean).join('\n');

  // NOTE: no reasoning_effort here — thinking is disabled by default in
  // sarvam.js (reasoning once devoured the token budget and left every
  // plan empty). Set MAIL_AI_REASONING=medium to re-enable deliberately.
  const plan = await sarvamChat(
    env,
    [
      { role: 'system', content: 'You are an autonomous email campaign planner. You convert owner instructions into precise, safe, executable campaign plans. You always output valid JSON.' },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.5, maxTokens: 2500 }
  );

  // ── Sanitise (never trust the model blindly) ────────────────────
  const total = contactStats.total || 0;
  plan.audience = plan.audience || {};
  plan.audience.max_recipients = Math.max(1, Math.min(parseInt(plan.audience?.max_recipients, 10) || total, total || 1));

  // ── Deterministic owner-intent extraction ─────────────────────
  // The model drifts on counts and segments; the owner's WORDS do not.
  // These overrides run after the model so "send a marketing email to 200
  // emails from the contacts now" ALWAYS resolves to 1 email × 200
  // recipients × everyone × immediate — whatever the model guessed.
  const intent = parseOwnerIntent(task.instruction);
  if (intent.recipients !== null) {
    if (intent.recipients === 'all') {
      plan.audience.max_recipients = Math.max(1, total || plan.audience.max_recipients);
      plan.audience.segment = null;
    } else {
      plan.audience.max_recipients = Math.max(1, Math.min(intent.recipients, total || intent.recipients));
      if (intent.segment !== undefined) plan.audience.segment = intent.segment;
    }
    // The owner's OWN WORDS named a count — the frequency cap yields to it
    // (recently-emailed contacts may be included to reach the number).
    plan.audience.owner_specified = true;
  }
  if (intent.emailCount) plan.emails = forceEmailCount(plan.emails, intent.emailCount);
  if (Array.isArray(plan.audience.segment)) plan.audience.segment = plan.audience.segment[0];
  if (plan.audience.segment != null) {
    const seg = String(plan.audience.segment).toLowerCase().trim();
    const valid = ['subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer', 'churned'];
    plan.audience.segment = valid.includes(seg) ? seg : null;
  }

  // Explicit recipients: validate + cap. Belt-and-braces sweep of the raw
  // instruction catches addresses the model forgot to copy — "send to
  // x@y.com" must NEVER silently degrade to a segment blast.
  const EMAIL_TEST = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  plan.explicit_recipients = [...new Set(
    (Array.isArray(plan.explicit_recipients) ? plan.explicit_recipients : [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => EMAIL_TEST.test(e))
  )];
  const mentioned = String(task.instruction || '')
    .match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
  for (const m of mentioned) {
    if (!plan.explicit_recipients.includes(m.toLowerCase())) {
      plan.explicit_recipients.push(m.toLowerCase());
    }
  }
  plan.explicit_recipients = plan.explicit_recipients.slice(0, 100);

  const emails = Array.isArray(plan.emails) ? plan.emails.slice(0, 10) : [];
  const base = Date.now() + 5 * 60 * 1000; // earliest send: 5 min from now
  const URGENT_RE = /right away|immediately|asap|urgent|send now|\bnow\b/i;
  const SCHEDULED_RE = /tomorrow|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this weekend|later|\d{4}-\d{2}-\d{2}|in \d+ (day|days|week|weeks|hour|hours|minute|minutes)|at \d{1,2}(:\d{2})?\s*(am|pm)|tonight|this (morning|afternoon|evening)/i;
  const instruction = String(task.instruction || '');
  const urgent = URGENT_RE.test(instruction);
  const explicitlyScheduled = SCHEDULED_RE.test(instruction);

  plan.emails = emails.map((e, i) => {
    let t = Date.parse(e?.sendAt);
    if (!Number.isFinite(t)) t = base + i * 48 * 3600 * 1000;
    // Urgent: the first email leaves within minutes, whatever the model chose.
    if (urgent && i === 0) t = Date.now() + (2 + Math.floor(Math.random() * 4)) * 60 * 1000;
    // No scheduling language and the model drifted days out → pull it back.
    // (Multi-day drift made owners believe sends were lost.) Later emails in
    // the sequence space 48h apart — matching the "spaced 2-5 days" rule and
    // staying OUTSIDE the runner's lookahead so a sequence never fires
    // as one blast.
    else if (!explicitlyScheduled && !intent.emailCount && t - Date.now() > 48 * 3600 * 1000) {
      t = base + i * 48 * 3600 * 1000;
    }
    // Floor: urgent first emails leave NOW (the old code floored them back
    // up to +30 min, which owners read as "queued and forgotten"); otherwise
    // 5 min + 5 min per sequence step. The pipeline executes any email whose
    // send time is within the lookahead window, so a near-time floor means
    // the campaign genuinely leaves within minutes of the ask.
    const floor = urgent && i === 0
      ? Date.now() + 2 * 60 * 1000
      : Date.now() + (5 + i * 5) * 60 * 1000;
    t = Math.max(t, floor);
    return {
      seq: i + 1,
      sendAt: new Date(t).toISOString(),
      goal: String(e?.goal || 'Engage the audience').slice(0, 300),
      angle: String(e?.angle || 'Helpful update').slice(0, 300),
      tone: String(e?.tone || 'friendly, confident').slice(0, 120),
      template_style: String(e?.template_style || 'newsletter').slice(0, 40),
      // Owner styling directives ("make it festive", "dark premium") flow
      // into the copywriter so the wording AND the layout energy match.
      design_notes: String(e?.design_notes || '').slice(0, 300),
      // Optional per-email button destination — only real http(s) URLs from
      // the owner's own links survive (renderHtml re-checks).
      link_url: /^https?:\/\//i.test(String(e?.link_url || '').trim()) ? String(e.link_url).trim().slice(0, 500) : '',
    };
  });
  if (plan.emails.length === 0) throw new Error('AI plan contained no emails');
  return plan;
}

/* ── Deterministic intent parsing ─────────────────────────────────────
 * Owners write "send a marketing email to 200 emails from the contacts
 * now". The model sometimes turns that into a 3-email sequence to 200
 * leads at +30 min. These regexes read the owner's literal words and the
 * pipeline enforces them AFTER the model — numbers win, every time. */

const UNIT_STATUS = {
  contacts: null, contact: null, emails: null, email: null, people: null,
  person: null, subscribers: 'subscriber', subscriber: 'subscriber',
  leads: 'lead', lead: 'lead', customers: 'customer', customer: 'customer',
  recipients: null, recipient: null, users: null, user: null, addresses: null, address: null,
};

/** number | 'all' | null; segment override when the unit names a status. */
export function parseOwnerIntent(instruction) {
  const t = String(instruction || '').toLowerCase().replace(/,/g, ' ');
  const out = { recipients: null, segment: undefined, emailCount: 0 };

  // "all contacts" / "everyone" / "entire list" / "hundreds of contacts"
  if (
    /\b(?:all|every|each|entire|whole)\s+(?:of\s+)?(?:my\s+|the\s+)?(?:contacts?|subscribers?|lists?|audience|people|database)\b/.test(t) ||
    /\beveryone\b/.test(t) ||
    /\bhundreds?\s+of\b/.test(t) ||
    /\bthousands?\s+of\b/.test(t)
  ) {
    if (/hundreds?\s+of/.test(t)) out.recipients = 500;
    else if (/thousands?\s+of/.test(t)) out.recipients = 5000;
    else out.recipients = 'all';
  }

  // "to 200 emails" / "to 200 contacts" / "200 leads" — recipient count.
  let unitWasEmail = false;
  if (out.recipients === null) {
    const m = t.match(
      /\b(?:to\s+)?(\d{1,5})\s*(?:\+)?\s*(emails?|contacts?|people|persons?|subscribers?|recipients?|customers?|leads?|users?|addresses?)\b/
    );
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      const contactsContext = /\b(?:contacts?|subscribers?|leads|customers?|list|audience|database|crm)\b/.test(t);
      const isRecipientMention =
        /\bto\s+\d+\b/.test(t) || // "send to 200 emails …"
        /\b(?:from|of|in)\s+(?:the\s+|my\s+)?(?:contacts?|crm|list|database)\b/.test(t) || // "… from the contacts"
        contactsContext || // "… to my contacts"
        (unit !== 'email' && unit !== 'emails'); // "500 leads", "200 contacts" are always recipients
      if (isRecipientMention) {
        out.recipients = n;
        unitWasEmail = unit === 'email' || unit === 'emails';
        if (unit in UNIT_STATUS) out.segment = UNIT_STATUS[unit];
      }
    }
  }

  // Email COUNT: "3 emails over 2 weeks", "send 2 emails" — but NOT
  // "to 200 emails" (that's recipients) and not singular phrasing here
  // (singular is handled below so "a marketing email" = 1).
  const countM = t.match(/(?<!\bto\s)(?<!\bto\s\s)(\d{1,2})\s*(?:more\s+)?emails?\b/);
  if (countM) out.emailCount = Math.max(1, Math.min(parseInt(countM[1], 10), 10));
  else if (
    /\b(?:a|an|one|single)\s+(?:marketing\s+|promotional\s+|introduct(?:ion|ory)\s+|follow[\s-]?up\s+|announcement\s+|welcome\s+|newsletter\s+)?emails?\b/.test(t) &&
    !/\b(?:and|then|after that|follow[\s-]?ups?|sequence|series|second|third|another)\b.{0,30}\bemails?\b/.test(t)
  ) {
    out.emailCount = 1;
  }
  // "send 10 emails to my contacts" — the N is RECIPIENTS; one blast,
  // unless the owner clearly asked for a series ("over 2 weeks", "sequence”).
  if (
    unitWasEmail && typeof out.recipients === 'number' &&
    !/\b(?:over|across|during|series|sequence|follow[\s-]?ups?)\b/.test(t)
  ) {
    out.emailCount = 1;
  }
  return out;
}

/** Trim or extend the AI's email list to exactly the owner's count. */
function forceEmailCount(emails, count) {
  const list = Array.isArray(emails) ? emails.filter(Boolean) : [];
  if (count <= 0) return list;
  if (list.length > count) return list.slice(0, count);
  while (list.length < count) {
    const last = list[list.length - 1];
    const i = list.length;
    const at = last?.sendAt ? Date.parse(last.sendAt) : Date.now() + i * 48 * 3600e3;
    list.push({
      seq: i + 1,
      sendAt: new Date(Number.isFinite(at) ? at + 48 * 3600e3 : Date.now() + i * 48 * 3600e3).toISOString(),
      goal: last?.goal || 'Continue the conversation',
      angle: last?.angle || 'Follow-up with a fresh angle',
      tone: last?.tone || 'friendly, confident',
      template_style: last?.template_style || 'modern',
      link_url: last?.link_url || '',
    });
  }
  return list;
}
