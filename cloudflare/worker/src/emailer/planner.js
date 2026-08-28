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
 "emails": [
   {
     "seq": 1,
     "sendAt": "YYYY-MM-DDTHH:MM:SS+05:30 (ISO 8601 with the business timezone offset)",
     "goal": "what this email should achieve",
     "angle": "the creative angle/hook",
     "tone": "tone for this email",
     "template_style": "newsletter|announcement|offer|story|tip"
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
export async function buildBusinessBrief(env, kv, { crmStats = null, recentInstructions = [], force = false } = {}) {
  if (!force && kv) {
    const cached = await kv.get('biz:brief');
    if (cached) return JSON.parse(cached);
  }

  const site = await websiteText(env);
  const profileGiven = !!(env.MAIL_BUSINESS_PROFILE && env.MAIL_BUSINESS_PROFILE.trim());
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

  const user = [
    'Analyse this business and build a marketing brief for its email campaigns.',
    `Business name: ${env.MAIL_BUSINESS_NAME || 'Nebula CRM'}`,
    profileGiven
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
  brief.source = profileGiven ? 'owner-profile' : site ? 'website' : inferred ? 'crm-inferred' : 'guess';
  if (kv) await kv.put('biz:brief', JSON.stringify(brief), { expirationTtl: 60 * 60 * 24 * 7 });
  return brief;
}

/** Step 2 — turn an owner instruction into an executable multi-email plan. */
export async function planTask(env, kv, task, brief, learnings, contactStats) {
  const learn = learnings && (learnings.recommendations?.length || learnings.observations?.length)
    ? `Past-campaign learnings (apply them):\n${JSON.stringify(learnings).slice(0, 1200)}`
    : 'No past analytics yet — use marketing best practice.';

  const user = [
    `Current time: ${new Date().toISOString()} (business timezone: ${env.MAIL_TIMEZONE || 'Asia/Calcutta'}).`,
    '',
    'BUSINESS BRIEF:',
    JSON.stringify(brief),
    '',
    'CRM AUDIENCE (contacts collection):',
    JSON.stringify(contactStats),
    '',
    learn,
    '',
    'OWNER TASK (plain language — decide everything from it):',
    task.instruction,
    '',
    'RULES:',
    '- Respect any explicit email count, recipient count, dates or deadlines in the task.',
    '- If the task gives no count, choose 1-3 emails spaced 2-5 days apart.',
    `- If the task gives no recipient count, cap at ${contactStats.total}.`,
    `- sendAt must be in the future, between 08:00-20:00 in ${env.MAIL_TIMEZONE || 'Asia/Calcutta'}, never all at the same minute.`,
    '- Vary angles across emails (story → proof → urgency, etc.).',
    '- The audience.segment MUST be one of the CRM statuses shown in contact_stats.segments, or null for everyone.',
    '',
    PLAN_SCHEMA_PROMPT,
  ].join('\n');

  const plan = await sarvamChat(
    env,
    [
      { role: 'system', content: 'You are an autonomous email campaign planner. You convert owner instructions into precise, safe, executable campaign plans. You always output valid JSON.' },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.5, maxTokens: 2500, reasoningEffort: 'medium' }
  );

  // ── Sanitise (never trust the model blindly) ────────────────────
  const total = contactStats.total || 0;
  plan.audience = plan.audience || {};
  plan.audience.max_recipients = Math.max(1, Math.min(parseInt(plan.audience?.max_recipients, 10) || total, total || 1));
  if (Array.isArray(plan.audience.segment)) plan.audience.segment = plan.audience.segment[0];
  if (plan.audience.segment != null) {
    const seg = String(plan.audience.segment).toLowerCase().trim();
    const valid = ['subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer', 'churned'];
    plan.audience.segment = valid.includes(seg) ? seg : null;
  }

  const emails = Array.isArray(plan.emails) ? plan.emails.slice(0, 10) : [];
  const base = Date.now() + 30 * 60 * 1000; // earliest send: 30 min from now
  plan.emails = emails.map((e, i) => {
    const t = Date.parse(e?.sendAt);
    const safe = Number.isFinite(t) ? Math.max(t, base + i * 60 * 60 * 1000) : base + i * 24 * 60 * 60 * 1000;
    return {
      seq: i + 1,
      sendAt: new Date(safe).toISOString(),
      goal: String(e?.goal || 'Engage the audience').slice(0, 300),
      angle: String(e?.angle || 'Helpful update').slice(0, 300),
      tone: String(e?.tone || 'friendly, confident').slice(0, 120),
      template_style: String(e?.template_style || 'newsletter').slice(0, 40),
    };
  });
  if (plan.emails.length === 0) throw new Error('AI plan contained no emails');
  return plan;
}
