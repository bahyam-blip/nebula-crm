/**
 * Agent BUILDER v2 — the Studio build engine (designer pipeline).
 *
 *   describe → THINK (design brief) → RESEARCH (live web) → WRITE (copy)
 *            → RENDER (deterministic premium templates) → HOST (R2 + URL)
 *
 * v1 asked the model for a whole website in one call and saved whatever
 * came back — markdown fences, truncation and model chatter ended up
 * SERVED AS the site (see the user's screenshots). v2 fixes that class
 * of failure permanently:
 *   • the model only ever writes small JSON (brief, copy) or a bounded
 *     webapp document — every path passes extractSiteHtml()
 *   • marketing-site kinds render through site_templates.js, which
 *     cannot produce malformed pages
 *   • refine_site() iterates an existing build (versioned, non-destructive)
 *
 * Artifacts: sites/<id>.html (latest) + sites/<id>.v<n>.html snapshots,
 * plan stored at agent:siteplan:<id> so refine re-renders without a full
 * rebuild. Served publicly at GET /sites/<id> (?v=N for a snapshot).
 */

import { sarvamChat } from './sarvam.js';
import { getBusinessProfile, brandFor, profileToFacts } from './business.js';
import { designBrief, researchFacts, writeCopy, defaultCopy, mergeCopy, applyCtaOverrides, applyRefinement, extractSiteHtml, sanitizeCopy } from './designer.js';
import { renderSite, normalizeDesign, themeForStyleHint } from './site_templates.js';
import { skillsForDomain } from './skills.js';
import { rateLimit, sha256Hex } from './guard.js';
import { esc } from './htmlutil.js';

const SITE_KINDS = ['landing', 'promo', 'event', 'portfolio', 'webapp', 'report'];
const ARTIFACT_LIST_CAP = 60;
const MAX_SITE_BYTES = 400_000;
const RESEARCH_KINDS = new Set(['landing', 'promo', 'event', 'portfolio', 'report']);

/* ── Sanitizer for AI-authored documents (webapps) ────────────────── */

/**
 * Block remote code/data surfaces in AI-written HTML, keep the page.
 * Remote-src scripts are removed WHOLE (tag + content + closing tag);
 * inline scripts survive — mini web apps need them, and they only ever
 * run inside the artifact's own page. Template-rendered pages never hit
 * this path (they contain no remote resources by construction).
 */
function sanitizeSiteHtml(html) {
  return String(html)
    .replace(/<script[^>]*\ssrc\s*=\s*['"]?(https?:)?\/\/[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\ssrc\s*=\s*['"]?(https?:)?\/\/[^>]*>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/<iframe[^>]*>/gi, '')
    // Remote stylesheets: ONLY Google Fonts is allowlisted (real typography
    // is the #1 quality lift; it is a pure-CSS resource, no code surface).
    .replace(/<link[^>]*\shref\s*=\s*['"]?(https?:)?\/\/(?!fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)[^>]*>/gi,
      (m) => /fonts\.(googleapis|gstatic)\.com/.test(m) ? m : '');
}

/* ── Registry (per-user, in the state store) ────────────────────────── */

async function artifactList(store, uid) {
  if (!store || !uid) return [];
  return safeArr(await store.get(`agent:artifacts:${uid}`));
}

function safeArr(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function putArtifact(store, uid, meta) {
  if (!store || !uid) return;
  const list = await artifactList(store, uid);
  const idx = list.findIndex((a) => a.id === meta.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...meta };
  else list.unshift(meta);
  await store.put(`agent:artifacts:${uid}`, JSON.stringify(list.slice(0, ARTIFACT_LIST_CAP)));
}

export async function listArtifacts(store, uid, limit = 20) {
  const list = await artifactList(store, uid);
  return list.slice(0, Math.min(Number(limit) || 20, 40));
}

export async function getArtifactDoc(store, uid, id) {
  const list = await artifactList(store, uid);
  return list.find((a) => a.id === id) || null;
}

/* ── Notes (unchanged public behavior) ──────────────────────────────── */

export async function saveNote(store, user, args) {
  const uid = user?.uid || '';
  const title = String(args.title || '').trim().slice(0, 140) || 'Untitled note';
  const content = String(args.content || '').trim().slice(0, 40000);
  if (content.length < 10) return { ok: false, error: 'note content is too short' };
  const id = `n_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
  const doc = { id, uid, kind: 'note', title, content, at: new Date().toISOString() };
  if (store) await store.put(`agent:artifact:${id}`, JSON.stringify(doc));
  await putArtifact(store, uid, { id, kind: 'note', title, at: doc.at, by: user?.displayName || 'agent' });
  return { ok: true, artifact_id: id, kind: 'note', title, note: `saved "${title}" — viewable in the app and shareable as a page` };
}

/** Minimal markdown-ish rendering for note artifacts (safe: escaped). */
function noteToHtml(doc) {
  const body = String(doc.content || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .split(/\n{2,}/)
    .map((p) => {
      const lines = p.split('\n').map((l) => {
        if (/^#{1,3}\s/.test(l)) return `<h2>${l.replace(/^#{1,3}\s/, '')}</h2>`;
        if (/^[-*]\s/.test(l)) return `<li>${l.replace(/^[-*]\s/, '')}</li>`;
        return `<p>${l}</p>`;
      });
      const li = lines.filter((l) => l.startsWith('<li>'));
      return li.length ? `<ul>${li.join('')}</ul>` : lines.join('');
    })
    .join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.title)}</title>
<style>body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:0 auto;padding:40px 20px;color:#1a1d29;line-height:1.7}h1{font-size:30px;margin-bottom:6px}h2{font-size:20px;margin:18px 0 6px}.meta{color:#8a8fa3;font-size:13px;margin-bottom:26px}p{margin:10px 0}ul{margin:10px 0;padding-left:22px}li{margin:4px 0}</style></head>
<body><h1>${esc(doc.title)}</h1><div class="meta">${esc(doc.at || '')} · built by the CRM AI agent</div>${body}</body></html>`;
}

/* ── Webapp path (AI-authored, bounded + gated) ─────────────────────── */

function webappSystemPrompt(brand, factsLine) {
  return `You are a senior product engineer. Build a SMALL INTERACTIVE single-file web app. Respond with ONE complete HTML document only — no markdown fences, no commentary.

HARD RULES:
- Start with <!DOCTYPE html> and end with </html>. ALL CSS in one <style>; ALL JS in one inline <script> at the end of <body>.
- Mobile-first, feels native on a phone: sticky bottom tab bar or big touch targets, cards, rounded corners, system font stack.
- The app MUST work fully offline in one file. State persists in localStorage. No network calls, no iframes, no images. ONE allowed external resource: a Google Fonts stylesheet (fonts.googleapis.com) for typography.
- Keep it SMALL: one core interaction done really well (tracker, checklist, calculator, quiz, notes, counter...). 2-3 screens max.
- Premium visual standard: consistent spacing, accessible contrast, subtle transitions, on-brand.
- Branding: color ${brand.color}, name "${brand.name}"${factsLine ? `; facts: ${factsLine}` : ''}.
- No lorem ipsum. Real labels. Copy in the user's language if their brief is not English.`;
}

function signatureApp({ title, brief, brand }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(brand.color || '') ? brand.color : '#6C8CFF';
  const name = esc(brand.name);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${color}"><title>${esc(title || `${brand.name} Tracker`)}</title>
<style>
:root{--b:${color};--ink:#101223;--mut:#6a7086;--bg:#f5f6fa}
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
body{background:var(--bg);color:var(--ink);min-height:100vh;display:flex;flex-direction:column}
header{background:linear-gradient(135deg,var(--b),color-mix(in srgb,var(--b) 55%,#101223));color:#fff;padding:34px 22px 28px}
header h1{font-size:24px;font-weight:800}
header p{opacity:.9;font-size:13.5px;margin-top:4px}
main{flex:1;padding:18px;max-width:560px;width:100%;margin:0 auto}
.add{display:flex;gap:10px;margin-bottom:16px}
.add input{flex:1;border:1.5px solid #e3e6ef;border-radius:14px;padding:14px 16px;font-size:15px;background:#fff;outline:none}
.add input:focus{border-color:var(--b)}
.add button{border:0;background:var(--b);color:#fff;font-weight:700;font-size:15px;border-radius:14px;padding:0 20px;cursor:pointer}
.item{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #ecedf3;border-radius:14px;padding:14px 16px;margin-bottom:10px;transition:opacity .2s}
.item .chk{width:24px;height:24px;border-radius:8px;border:2px solid var(--b);background:none;cursor:pointer;flex:0 0 24px;color:var(--b);font-weight:800;font-size:14px;line-height:1}
.item.done{opacity:.5}.item.done .chk{background:var(--b);color:#fff}
.item .txt{flex:1;font-size:15px;font-weight:600}
.item .del{background:none;border:0;color:#c2c6d4;font-size:18px;cursor:pointer}
.bar{position:sticky;bottom:0;background:#ffffffee;backdrop-filter:blur(10px);border-top:1px solid #ecedf3;padding:12px 18px;display:flex;justify-content:space-between;font-size:13px;color:var(--mut);font-weight:600}
</style></head><body>
<header><h1>${esc(title || `${brand.name} Tracker`)}</h1><p>${esc(String(brief || '').slice(0, 90)) || `A quick tracker for ${name}`} · works offline</p></header>
<main id="list"></main>
<div style="display:flex;gap:10px;padding:0 18px 18px;max-width:560px;margin:0 auto;width:100%">
<input id="new" placeholder="Add an item…" style="flex:1;border:1.5px solid #e3e6ef;border-radius:14px;padding:14px 16px;font-size:15px;outline:none">
<button onclick="add()" style="border:0;background:var(--b);color:#fff;font-weight:700;border-radius:14px;padding:0 22px;font-size:15px;cursor:pointer">Add</button></div>
<div class="bar"><span id="count">0 items</span><span>${name}</span></div>
<script>
var KEY='sigapp_v1';
function load(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch(e){return[]}}
function save(l){localStorage.setItem(KEY,JSON.stringify(l))}
function render(){var l=load(),h='';for(var i=0;i<l.length;i++){h+='<div class="item'+(l[i].d?' done':'')+'"><button class="chk" onclick="tog('+i+')">'+(l[i].d?'✓':'')+'</button><span class="txt">'+l[i].t.replace(/</g,'&lt;')+'</span><button class="del" onclick="del('+i+')">×</button></div>'}
document.getElementById('list').innerHTML=h||'<p style="text-align:center;color:#a7abc0;padding:40px 10px;font-size:14px">Nothing yet — add your first item above.</p>';
document.getElementById('count').textContent=l.length+' item'+(l.length===1?'':'s')+' · '+l.filter(function(x){return x.d}).length+' done';}
function add(){var i=document.getElementById('new'),v=i.value.trim();if(!v)return;var l=load();l.unshift({t:v,d:false});save(l);i.value='';render()}
function tog(i){var l=load();l[i].d=!l[i].d;save(l);render()}
function del(i){var l=load();l.splice(i,1);save(l);render()}
document.getElementById('new').addEventListener('keydown',function(e){if(e.key==='Enter')add()});
render();
</script></body></html>`;
}

/** AI-authored webapp with truncation retry + deterministic fallback. */
async function buildWebapp(env, { title, brief, style, brand }) {
  const facts = profileToFacts(brand.profile || {}).facts || {};
  const factsLine = Object.entries(facts).slice(0, 6).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ');
  const messages = [
    { role: 'system', content: webappSystemPrompt(brand, factsLine) },
    { role: 'user', content: `TITLE: ${title}\nBRIEF: ${brief}${style ? `\nSTYLE HINT: ${style}` : ''}\nProduce the complete single-file web app now. Keep it compact — it must fit in one response.` },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await sarvamChat(env, messages, { maxTokens: 1900, temperature: 0.55 });
      const { html, error } = extractSiteHtml(raw);
      if (!html) throw new Error(error);
      return { html: sanitizeSiteHtml(html), builder: 'ai' };
    } catch (e) {
      if (attempt === 1) {
        // Most likely truncation — force a smaller app and try once more.
        messages[1].content = `TITLE: ${title}\nBRIEF: ${brief}\nIMPORTANT: your previous attempt did not fit the response budget. Build a SMALLER app now: ONE screen, ONE core interaction, minimal CSS (under 60 lines). Start at <!DOCTYPE html> and finish at </html>.`;
      } else {
        console.warn('[builder] webapp AI path failed, using signature app:', e?.message || e);
      }
    }
  }
  return { html: signatureApp({ title, brief, brand }), builder: 'signature' };
}

/* ── v3 build pipeline (marketing kinds) ────────────────────────────── */

/**
 * POLISH — the self-critique loop. One small AI call reviews the written
 * copy against the senior rubric; if material improvements exist, the
 * patched copy is merged and the page re-rendered. Bounded: exactly one
 * critique per build, never throws, falls back to the as-written copy.
 */
async function polishCopy(env, { kind, content, brand, skillsBlock }) {
  try {
    const j = await sarvamChat(
      env,
      [
        {
          role: 'system',
          content: `You are the design director doing the FINAL review of a ${kind} page before it ships. Review the copy JSON against the rubric: headline is a concrete payoff (4-9 words); every feature title is an outcome; sub answers what+why in one breath; FAQ pre-empts price/time/trust objections; no cliches ("unleash", "elevate", "discover"); no invented hard numbers. Respond with ONLY JSON:
{"verdict":"good"} — if it already meets the bar
{"verdict":"improve","content":{...ONLY the groups you improved, full schema...}} — otherwise${skillsBlock ? `\n\n${skillsBlock}` : ''}`,
        },
        { role: 'user', content: JSON.stringify(content).slice(0, 5200) },
      ],
      { json: true, maxTokens: 1300, temperature: 0.5 }
    );
    if (j?.verdict !== 'improve' || !j.content || typeof j.content !== 'object') return { content, polished: false };
    const patched = sanitizeCopy(j.content, { kind, brand });
    const next = mergeCopy(patched, content);
    return { content: next, polished: true };
  } catch {
    return { content, polished: false };
  }
}

async function buildViaDesigner(env, store, uid, { kind, title, brief, style, ctaArgs, brand }) {
  const stages = [];

  // 0. SKILLS — load the expert skill pack (seeded + everything the agent
  //    has learned live). Every build gets smarter over time.
  const designSkills = await skillsForDomain(store, uid, 'design', { maxChars: 1100 });
  const copySkills = await skillsForDomain(store, uid, 'copy', { maxChars: 700 });

  // 1. THINK — design system + section plan + research queries.
  const thought = await designBrief(env, { kind, brief, style, brand, skillsBlock: designSkills.block });
  stages.push({
    stage: 'think',
    ok: true,
    ai: thought.ai,
    detail: `${thought.design.themeLabel}${thought.ai ? ' · AI art direction' : ' · classic direction'} · ${thought.design.hero} hero`,
  });

  // 2. RESEARCH — live facts (never fails the build).
  let facts = '';
  if (RESEARCH_KINDS.has(kind) && thought.queries.length) {
    facts = await researchFacts(thought.queries);
    stages.push({ stage: 'research', ok: true, ai: Boolean(facts), detail: facts ? thought.queries[0] : 'skipped (web unreachable)' });
  } else {
    stages.push({ stage: 'research', ok: true, ai: thought.ai, detail: 'not needed for this build' });
  }

  // 3. WRITE — copy JSON (falls back to brief-derived copy).
  const base = defaultCopy({ kind, title, brief, brand });
  const { content: aiCopy, ai: copyAi } = await writeCopy(env, { kind, title, brief, brand, thought, factsBlock: facts, skillsBlock: copySkills.block });
  let content = mergeCopy(aiCopy, base);
  content = applyCtaOverrides(content, ctaArgs);
  if (!content.headline) content.headline = title;
  stages.push({ stage: 'write', ok: true, ai: copyAi, detail: copyAi ? `${content.features?.length || 0} sections written` : 'from your brief' });

  // 4. POLISH — director's final review (skipped when copy fell back to
  //    deterministic; nothing to critique there).
  if (copyAi) {
    const polished = await polishCopy(env, { kind, content, brand, skillsBlock: designSkills.block });
    content = polished.content;
    stages.push({ stage: 'polish', ok: true, ai: polished.polished, detail: polished.polished ? 'director pass applied' : 'passed review as written' });
  } else {
    stages.push({ stage: 'polish', ok: true, ai: false, detail: 'deterministic copy — review skipped' });
  }

  // 5. RENDER — deterministic assembly (cannot fail malformed).
  const html = renderSite({ kind, design: thought.design, content, brand });
  stages.push({ stage: 'render', ok: true, ai: false, detail: `${thought.design.themeLabel} · ${thought.design.art} art` });

  return { html, content, design: thought.design, stages, researched: Boolean(facts), skills: designSkills.learnedCount };
}

/* ── The build_website tool / Studio build endpoint ─────────────────── */

export async function buildWebsite(env, store, user, args, origin = '') {
  const kind = SITE_KINDS.includes(String(args.kind)) ? String(args.kind) : 'landing';
  const title = String(args.title || '').trim().slice(0, 120);
  const brief = String(args.brief || args.instruction || '').trim().slice(0, 4000);
  if (brief.length < 12) {
    return { ok: false, error: 'brief is too short — describe what the site is for, its audience and the key message.' };
  }
  const effTitle = title || brief.split(/(?:[.!?]|\n)/)[0].trim().slice(0, 80) || `${kind} page`;

  const profile = store ? await getBusinessProfile(store).catch(() => null) : null;
  const brand = brandFor(env, profile);
  brand.profile = profile;

  const style = String(args.style || profile?.default_style || '').trim();
  const ctaArgs = { cta_text: args.cta_text, cta_url: args.cta_url, contact_email: args.contact_email };

  // Rate limit — extreme capability, guarded (applies to app + MCP + chat).
  const rl = await rateLimit(store, user?.uid || '', 'build_website');
  if (!rl.ok) return { ok: false, rateLimited: true, error: rl.error };

  let html, builder, stages = [], plan = null;
  try {
    if (kind === 'webapp') {
      const r = await buildWebapp(env, { title: effTitle, brief, style, brand });
      html = r.html;
      builder = r.builder;
      stages = [
        { stage: 'think', ok: true, ai: builder === 'ai', detail: 'app architecture' },
        { stage: 'write', ok: true, ai: builder === 'ai', detail: builder === 'ai' ? 'app coded by AI' : 'signature app shell' },
        { stage: 'render', ok: true, ai: false, detail: 'sanitized + hosted' },
      ];
    } else {
      const r = await buildViaDesigner(env, store, user?.uid || '', { kind, title: effTitle, brief, style, ctaArgs, brand });
      html = r.html;
      // 'ai' = the AI led design + copy. The polish stage's ai flag means
      // "director improved something", so it doesn't gate the label.
      const aiStage = (name) => r.stages.find((s) => s.stage === name)?.ai === true;
      builder = aiStage('think') && aiStage('write') ? 'ai' : 'ai+engine';
      stages = r.stages;
      plan = { kind, title: effTitle, brief: brief.slice(0, 4000), style, design: r.design, content: r.content };
    }
  } catch (e) {
    // The pipeline is designed not to throw; this is the last-resort net.
    console.error('[builder] pipeline error, using signature builder:', e?.stack || e);
    const design = normalizeDesign({ theme: themeForStyleHint(style, kind), palette: {} }, { kind, styleHint: style, brandColor: brand.color });
    const content = applyCtaOverrides(defaultCopy({ kind, title: effTitle, brief, brand }), ctaArgs);
    html = renderSite({ kind, design, content, brand });
    builder = 'signature';
    stages = [{ stage: 'render', ok: true, ai: false, detail: 'fallback template' }];
  }

  html = html.trim();
  if (html.length > MAX_SITE_BYTES) html = html.slice(0, MAX_SITE_BYTES) + '\n<!-- truncated -->';

  const digest = await sha256Hex(html);
  const id = `s_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
  const key = `sites/${id}.html`;
  const stored = await env.MEDIA.put(key, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { builtBy: user?.uid || 'agent', kind, title: effTitle, sha256: digest },
  });
  if (!stored) console.warn('[builder] R2 put returned falsy for', key); // record stays the source of truth

  if (plan && store) await store.put(`agent:siteplan:${id}`, JSON.stringify(plan)).catch(() => {});

  const finalUrl = origin ? `${origin}/sites/${id}` : `/sites/${id}`;
  await putArtifact(store, user?.uid || '', {
    id, kind, title: effTitle, url: finalUrl, builder, bytes: html.length, sha256: digest,
    version: 1, versions: [{ v: 1, at: new Date().toISOString(), bytes: html.length, sha256: digest }],
    at: new Date().toISOString(), by: user?.displayName || 'agent',
  });

  return {
    ok: true,
    artifact_id: id,
    kind,
    title: effTitle,
    url: finalUrl,
    builder,
    bytes: html.length,
    sha256: digest,
    version: 1,
    stages,
    note: `"${effTitle}" is LIVE at ${finalUrl} — share this link with anyone.`,
  };
}

/* ── refine_site — iterate on a build without starting over ─────────── */

export async function refineSite(env, store, user, args, origin = '') {
  const id = String(args.artifact_id || args.id || '').trim();
  const instruction = String(args.instruction || '').trim().slice(0, 600);
  if (!id || instruction.length < 3) return { ok: false, error: 'artifact_id and a short instruction are required.' };

  const doc = await getArtifactDoc(store, user?.uid || '', id);
  if (!doc) return { ok: false, error: `artifact ${id} not found in your builds` };
  if (doc.kind === 'note') return { ok: false, error: 'notes cannot be refined — ask me to build an updated one instead' };

  const rl = await rateLimit(store, user?.uid || '', 'refine_site');
  if (!rl.ok) return { ok: false, rateLimited: true, error: rl.error };

  const plan = safeParse(await store.get(`agent:siteplan:${id}`));
  const profile = store ? await getBusinessProfile(store).catch(() => null) : null;
  const brand = brandFor(env, profile);
  brand.profile = profile;

  const kind = plan?.kind || doc.kind || 'landing';
  const title = plan?.title || doc.title || effTitleFromDoc(doc);
  const brief = plan?.brief || '';
  const style = plan?.style || '';

  let html, version, note = 'updated from your instruction';
  let content, design;

  if (kind === 'webapp') {
    // Webapps are AI-coded documents — rebuild compact with the instruction.
    const r = await buildWebapp(env, {
      title,
      brief: `${plan?.brief || doc.title}\n\nUPDATE REQUEST: ${instruction}`,
      style,
      brand,
    });
    html = r.html;
    version = (Number(doc.version) || 1) + 1;
  } else {
    if (plan?.content) {
      // Fast path: re-render from the stored plan with the instruction applied.
      const r = await applyRefinement(env, { instruction, kind, content: plan.content, design: plan.design, brand });
      content = r.content;
      design = plan.design?.theme ? plan.design : normalizeDesign({ theme: themeForStyleHint(style, kind), palette: {} }, { kind, styleHint: style, brandColor: brand.color });
      if (!r.ai) note = 'AI did not respond — rebuilt with your instruction noted in the brief';
      content = applyCtaOverrides(content, { cta_text: args.cta_text, cta_url: args.cta_url });
    } else {
      // Legacy artifact (v1 build, no plan) → full pipeline with the
      // original brief + instruction folded in.
      const fullBrief = `${brief || doc.title}\n\nUPDATE REQUEST: ${instruction}`;
      const r = await buildViaDesigner(env, store, user?.uid || '', { kind, title, brief: fullBrief, style, ctaArgs: {}, brand });
      content = r.content;
      design = r.design;
    }
    html = renderSite({ kind, design, content, brand }).trim();
    version = (Number(doc.version) || 1) + 1;
  }
  if (html.length > MAX_SITE_BYTES) html = html.slice(0, MAX_SITE_BYTES) + '\n<!-- truncated -->';

  const digest = await sha256Hex(html);

  // Snapshot the previous render, then overwrite latest.
  if (env.MEDIA) {
    const prev = await env.MEDIA.get(`sites/${id}.html`).catch(() => null);
    if (prev) {
      const prevText = await prev.text();
      await env.MEDIA.put(`sites/${id}.v${version - 1}.html`, prevText, {
        httpMetadata: { contentType: 'text/html; charset=utf-8' },
        customMetadata: { builtBy: user?.uid || 'agent', kind, version: String(version - 1) },
      }).catch(() => {});
    }
    await env.MEDIA.put(`sites/${id}.html`, html, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
      customMetadata: { builtBy: user?.uid || 'agent', kind, title, version: String(version), sha256: digest },
    });
  }

  if (store) {
    const nextPlan = kind === 'webapp'
      ? { kind, title, brief: `${plan?.brief || ''}\n\nUPDATE REQUEST: ${instruction}`.trim(), style }
      : { kind, title, brief, style, design, content };
    await store.put(`agent:siteplan:${id}`, JSON.stringify(nextPlan)).catch(() => {});
    await putArtifact(store, user?.uid || '', {
      id, kind, title, url: doc.url || (origin ? `${origin}/sites/${id}` : `/sites/${id}`),
      builder: doc.builder || 'ai+engine', bytes: html.length, version, sha256: digest,
      versions: [...(doc.versions || []).slice(-9), { v: version, at: new Date().toISOString(), bytes: html.length, sha256: digest }],
      at: doc.at, updated_at: new Date().toISOString(), by: doc.by || user?.displayName || 'agent',
      last_refine: instruction.slice(0, 140),
    });
  }

  return {
    ok: true,
    artifact_id: id,
    kind,
    title,
    url: origin ? `${origin}/sites/${id}` : `/sites/${id}`,
    version,
    bytes: html.length,
    sha256: digest,
    note: `"${title}" updated to v${version} — ${note}. Same link, new look.`,
  };
}

function effTitleFromDoc(doc) {
  return String(doc.title || '').slice(0, 120) || 'site';
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

/* ── Public serving (index.js hands over /sites/* here) ─────────────── */

export async function serveAgentSite(request, env, path) {
  const segments = String(path.split('?')[0] || '').split('/').filter(Boolean); // ['sites', '<id>', maybe 'meta']
  const rawId = String(segments[1] || '');
  const wantsMeta = segments[2] === 'meta';
  if (!/^[a-z0-9_]+$/i.test(rawId)) return new Response('bad artifact id', { status: 400 });

  const store = env.DB || env.NEBULA_EMAIL_KV ? (await import('./state.js')).createStore(env) : null;

  // Integrity metadata: GET /sites/<id>/meta (public, CORS-open).
  if (wantsMeta) {
    const obj0 = env.MEDIA ? await env.MEDIA.head(`sites/${rawId}.html`).catch(() => null) : null;
    if (!obj0) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    const cm = obj0.customMetadata || {};
    return new Response(JSON.stringify({
      id: rawId, kind: cm.kind || null, title: cm.title || null,
      bytes: obj0.size || null, sha256: cm.sha256 || null,
      built_at: obj0.uploaded?.toISOString?.() || null,
    }, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  }

  // Optional version pin: /sites/<id>?v=2
  let id = rawId;
  const v = Number(new URL(request.url).searchParams.get('v') || 0);
  if (v > 0) id = `${rawId}.v${v}`;

  const obj = env.MEDIA ? await env.MEDIA.get(`sites/${id}.html`).catch(() => null) : null;
  if (obj) {
    const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    obj.writeHttpMetadata(headers);
    const metaSha = obj.customMetadata?.sha256 || null;
    if (metaSha) headers.set('X-Content-Sha256', metaSha);
    headers.set('X-Nebula-Artifact', rawId);
    return new Response(obj.body, { headers });
  }

  // Notes live in the state store.
  if (store) {
    const doc = safeParse(await store.get(`agent:artifact:${rawId}`));
    if (doc && doc.kind === 'note') {
      return new Response(noteToHtml(doc), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
  }
  return new Response(notFoundPage(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function notFoundPage() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not found</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px 20px;color:#333">
<h1>404</h1><p>This page does not exist (or was never built).</p></body></html>`;
}
