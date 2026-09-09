/**
 * Agent RESEARCH — live-web tools so the assistant can look things up
 * beyond its training data and the CRM: market research, competitor
 * checks, industry news, venue/holiday/event facts, citation gathering.
 *
 *   web_search {query}   → titles, URLs, snippets (multi-provider chain)
 *   web_fetch  {url}     → readable text of one public page
 *
 * The search chain tries three independent providers so a single block
 * (a 403 from a datacenter IP, a layout change) never kills research:
 *   1. DuckDuckGo HTML results
 *   2. DuckDuckGo Lite results
 *   3. DuckDuckGo Instant Answer API (abstracts + related topics)
 * All parsing is defensive: a provider that returns nothing is skipped,
 * and the tool always reports honestly when the web could not be reached.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 9000;

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    });
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** DDG wraps outbound links: //duckduckgo.com/l/?uddg=<encoded>&rut=… */
function unwrapDdg(href) {
  let h = String(href || '');
  const m = /[?&]uddg=([^&]+)/.exec(h);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* keep raw */ }
  }
  if (h.startsWith('//')) h = `https:${h}`;
  return h;
}

async function ddgHtml(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const html = (await res.text()).slice(0, 900_000);
  const out = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [...html.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => stripTags(m[1]));
  let i = 0;
  for (const m of html.matchAll(re)) {
    const url = unwrapDdg(m[1]);
    const title = stripTags(m[2]);
    if (!/^https?:\/\//.test(url) || !title) continue;
    out.push({ title, url, snippet: (snippets[i] || '').slice(0, 320) });
    if (++i >= 8) break;
  }
  return out;
}

async function ddgLite(query) {
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  const html = (await res.text()).slice(0, 600_000);
  const out = [];
  // Attribute order and quote style vary — scan each <a …> tag for both.
  for (const tag of html.matchAll(/<a\s[^>]*>/gi)) {
    const t = tag[0];
    if (!/class\s*=\s*['"]result-link['"]/.test(t)) continue;
    const href = /href\s*=\s*['"]([^'"]+)['"]/i.exec(t)?.[1];
    const label = html.slice(tag.index + t.length, html.indexOf('</a>', tag.index));
    const title = stripTags(label);
    const url = unwrapDdg(href);
    if (!/^https?:\/\//.test(url) || !title) continue;
    out.push({ title, url, snippet: '' });
    if (out.length >= 8) break;
  }
  return out;
}

async function ddgInstant(query) {
  const res = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  if (!data) return [];
  const out = [];
  if (data.AbstractText && data.AbstractURL) {
    out.push({ title: data.Heading || query, url: data.AbstractURL, snippet: String(data.AbstractText).slice(0, 320) });
  }
  for (const t of (data.RelatedTopics || []).slice(0, 6)) {
    if (t?.FirstURL && t?.Text) out.push({ title: String(t.Text).split(' - ')[0].slice(0, 140), url: t.FirstURL, snippet: String(t.Text).slice(0, 320) });
  }
  return out;
}

/** The web_search tool body. */
export async function webSearch(args) {
  const query = String(args?.query || args?.q || '').trim().slice(0, 300);
  if (query.length < 2) return { ok: false, error: 'query is required' };

  const providers = [
    ['duckduckgo_html', ddgHtml],
    ['duckduckgo_lite', ddgLite],
    ['duckduckgo_answers', ddgInstant],
  ];
  const attempts = [];
  for (const [name, fn] of providers) {
    try {
      const results = await fn(query);
      if (results.length) {
        return {
          ok: true,
          query,
          provider: name,
          count: results.length,
          results,
          note: 'Search the web via the agent — verify anything load-bearing against the linked sources.',
        };
      }
      attempts.push(`${name}: no results`);
    } catch (e) {
      attempts.push(`${name}: ${String(e?.message || e).slice(0, 80)}`);
    }
  }
  return {
    ok: false,
    query,
    error: `web search unavailable right now (${attempts.join('; ')}) — answer from knowledge and say it is unverified.`,
  };
}

/** The web_fetch tool body — readable text of ONE public page. */
export async function webFetch(args) {
  const raw = String(args?.url || '').trim();
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'a full https:// URL is required' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'only http(s) URLs can be fetched' };
  }
  // Never let the agent be pointed at our own delivery/HMAC surface or
  // localhost-style targets (SSRF hygiene).
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(u.hostname) || u.hostname === '[::]') {
    return { ok: false, error: 'local addresses are not fetchable' };
  }

  let res;
  try {
    res = await fetch(u.toString(), {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `fetch failed: ${String(e?.message || e).slice(0, 120)}` };
  }
  if (!res.ok) return { ok: false, error: `page returned HTTP ${res.status}` };

  const type = res.headers.get('content-type') || '';
  if (!/^(text\/|application\/(json|xml|xhtml|html))/.test(type)) {
    return { ok: false, error: `unsupported content type: ${type || 'unknown'}` };
  }

  const buf = await res.arrayBuffer();
  const body = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, MAX_FETCH_BYTES));
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] || '').slice(0, 200);

  let text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

  if (!text) return { ok: false, error: 'page had no extractable text' };

  return {
    ok: true,
    url: u.toString().slice(0, 500),
    title: title || u.hostname,
    chars: text.length,
    truncated,
    text,
  };
}
