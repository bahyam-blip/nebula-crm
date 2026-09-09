/**
 * Shared HTML escaping helpers (used by templates, notes and mail views).
 */

export function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe-ish URL for href attributes: only http(s), mailto, tel, #anchors. */
export function safeHref(u) {
  const s = String(u || '').trim();
  if (!s) return '#';
  if (/^(https?:\/\/|mailto:|tel:|#)/i.test(s)) return esc(s);
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s) && !s.includes(' ')) return `https://${esc(s)}`;
  return '#';
}

/** First url found in free text, else ''. */
export function firstUrl(text) {
  const m = /https?:\/\/[^\s)"']+/i.exec(String(text || ''));
  return m ? m[0] : '';
}
