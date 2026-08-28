/**
 * Shared HTTP helpers for the AI mailer module.
 */

const UA = 'nebula-crm-mailer';

export async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, {
      ...options,
      headers: { 'User-Agent': UA, ...(options.headers || {}) },
      signal: AbortSignal.timeout(90000),
    });
    const retryAfter = res.headers.get('retry-after');
    const quota = res.status === 429; // rate/quota — hammering harder is the one thing we must NOT do
    const retryable = quota || res.status >= 500;
    if (!retryable || attempt >= maxRetries) return res;
    // Quota replies get a generous floor (5s base): a retry must cool the
    // source down, not add fuel. Plain 5xx keeps the snappier 1s base.
    const base = quota ? 5000 : 1000;
    const delay = retryAfter && /^\d+$/.test(retryAfter)
      ? parseInt(retryAfter, 10) * 1000
      : Math.min(30000, base * 2 ** attempt) + Math.floor(Math.random() * 500);
    console.warn(`[mailer:http] ${res.status} from ${new URL(url).host} — retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
    await new Promise((r) => setTimeout(r, delay));
  }
}

/** Strip HTML → plain text (campaign plain_text part / template plainText). */
export function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Minimal HTML escaping for AI copy inserted into the template. */
export function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
