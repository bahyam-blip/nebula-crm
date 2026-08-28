/**
 * Sarvam AI client for the mailer (direct server-side call).
 *
 * The app talks to Sarvam through /v1/ai (see index.js) so the key never
 * reaches a phone. Inside the Worker we already hold the key in
 * env.SARVAM_API_KEY, so the mailer calls api.sarvam.ai directly — same
 * model, same header, plus JSON mode for structured plans and copy.
 *
 * Endpoint : POST https://api.sarvam.ai/v1/chat/completions
 * Auth     : api-subscription-key header
 * Models   : sarvam-105b (sarvam-m was retired)
 */

import { fetchWithBackoff } from './http.js';

export async function sarvamChat(env, messages, opts = {}) {
  const body = {
    model: env.SARVAM_MODEL || 'sarvam-105b',
    messages,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.maxTokens || 4000,
  };
  // sarvam-105b honours reasoning_effort (low|medium|high). Keep it low for
  // copy, medium for planning — high adds latency a cron does not need.
  body.reasoning_effort = opts.reasoningEffort || env.MAIL_AI_REASONING || 'low';
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetchWithBackoff(
    'https://api.sarvam.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'api-subscription-key': env.SARVAM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    3
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Sarvam ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return opts.json ? extractJson(content) : content;
}

/** Tolerant JSON extraction (handles stray fences / prose). */
export function extractJson(text) {
  if (!text) throw new Error('Empty AI response');
  if (typeof text === 'object') return text;
  const cleaned = String(text).replace(/```json/gi, '```').split('```').join('\n');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in AI response');
  return JSON.parse(cleaned.slice(start, end + 1));
}
