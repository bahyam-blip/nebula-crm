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
 *
 * ── Why this file is defensive ────────────────────────────────────
 * sarvam-105b is a REASONING model: thinking runs before the answer and
 * BOTH share one completion budget. When the thinking chain eats the
 * budget, the API returns finish_reason:"length" with an EMPTY content
 * and only reasoning_content filled — Sarvam documents this exact
 * failure mode ("Empty AI response" killed every campaign plan at
 * launch). Defenses, per Sarvam's own guidance:
 *   1. reasoning_effort: null  — DISABLE thinking (the string 'none' is
 *      not a legal enum value; explicit JSON null is the documented off
 *      switch). MAIL_AI_REASONING=low|medium|high re-enables it.
 *   2. max_tokens always explicit (defaults have changed under us once).
 *   3. Retry up to 3× on the empty/truncated signature — the budget is
 *      non-deterministic even with reasoning off.
 *   4. Last resort: recover the JSON from reasoning_content (the model
 *      often drafts the answer inside its thinking).
 */

import { fetchWithBackoff } from './http.js';

/** Signature of a budget-starved answer: HTTP 200 but no usable content. */
function starved(data) {
  const msg = data?.choices?.[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content : '';
  const finish = data?.choices?.[0]?.finish_reason;
  return { content, finish, reasoning: msg?.reasoning_content || '', empty: !content.trim() };
}

export async function sarvamChat(env, messages, opts = {}) {
  // Sarvam caps completion tokens per plan (Starter 4096); asking higher
  // is harmless, asking nothing falls back to a 2048 default that reason
  // chains can devour. Always send it explicitly.
  const maxTokens = Math.max(512, Math.min(opts.maxTokens || 4000, 4096));
  const forced = String(env.MAIL_AI_REASONING || '').toLowerCase();
  // Explicit null = thinking OFF (documented). Any low|medium|high = ON.
  const effort = ['low', 'medium', 'high'].includes(forced) ? forced : null;

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const body = {
      model: env.SARVAM_MODEL || 'sarvam-105b',
      messages,
      temperature: opts.temperature ?? 0.6,
      max_tokens: maxTokens,
      reasoning_effort: effort,
    };
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
    const { content, finish, reasoning, empty } = starved(data);

    if (opts.json) {
      try {
        return extractJson(content);
      } catch (e) {
        lastError = e;
        // 4th option: the drafted answer often lives inside the thinking
        // trace. Only trust it if it parses as the JSON we asked for.
        if (empty && reasoning) {
          try {
            return extractJson(reasoning);
          } catch { /* keep the honest error */ }
        }
        console.warn(`[sarvam] attempt ${attempt}: ${e.message} (finish=${finish}, reasoningChars=${reasoning.length})`);
        continue; // retry — budget outcome is non-deterministic
      }
    }

    if (!empty) return content;

    lastError = new Error(
      finish === 'length'
        ? 'AI spent its whole token budget thinking and returned no answer — retrying'
        : 'Empty AI response'
    );
    console.warn(`[sarvam] attempt ${attempt}: ${lastError.message}`);
  }

  throw new Error(
    `${lastError?.message || 'AI produced no answer'} (after 3 attempts` +
    `${effort ? `, reasoning=${effort}` : ', reasoning=off'})`
  );
}

/** Tolerant JSON extraction (handles stray fences / prose). */
export function extractJson(text) {
  if (!text || !String(text).trim()) throw new Error('Empty AI response');
  if (typeof text === 'object') return text;
  const cleaned = String(text).replace(/```json/gi, '```').split('```').join('\n');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in AI response');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)); // throws on truncation
  if (!parsed || typeof parsed !== 'object') throw new Error('AI JSON was not an object');
  return parsed;
}
