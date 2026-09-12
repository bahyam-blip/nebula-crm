/**
 * Agent BUILDER v9 — the Studio build engine (AI code generation).
 *
 *   describe → LEAD (team plan) → THINK (art direction) → RESEARCH
 *            (intelligence) → WRITE (copy) → POLISH (copy review) →
 *            PLAN (architecture) → CODE (bespoke HTML+CSS per section,
 *            AI hand-written, parallel) → REVIEW (director) → WIRE
 *            (assembly) → REFLECT (self-evolution) → HOST (R2 + URL)
 *
 * v9 additions: the run can stream its team trace LIVE (sink → run doc
 * → GET /v1/studio/run), the Reflector distills every finished build
 * into a learned skill (the team gets measurably smarter per job), and
 * refine accepts a `sections` subset for SURGICAL re-codes — only the
 * named sections are re-written, the rest are byte-identical stored
 * fragments, so "fix the hero" takes seconds, not a full rebuild.
 *
 * v1 asked the model for a whole website in one call and saved whatever
 * came back — markdown fences, truncation and model chatter ended up
 * SERVED AS the site (see the user's screenshots). v2 fixed that with a
 * deterministic render engine — but then EVERY site shipped the same
 * theme skeleton ("building with templates", per the user). v3 keeps v2's
 * discipline and restores real authorship: the AI hand-writes each
 * section's HTML+CSS inside a strict contract (small calls, validated,
 * sanitized); site_templates.js is demoted to the fallback so a build
 * can never fail or serve garbage.
 *
 * Artifacts: sites/<id>.html (latest) + sites/<id>.v<n>.html snapshots,
 * plan stored at agent:siteplan:<id> so refine re-codes without a full
 * rebuild. Served publicly at GET /sites/<id> (?v=N for a snapshot).
 */

import { sarvamChat } from './sarvam.js';
import { createTeamRun, leadPlan, leadDeepThink, applyDeepThink, projectUnderstanding, runAgent, reflectOnBuild, researchAndLearnSkill } from './agents.js';
import { getBusinessProfile, brandFor, profileToFacts } from './business.js';
import { extractSiteBrand, siteIdentityBlock, scrubSiteHtml } from './sitebrand.js';
import { designBrief, researchIntelligence, writeCopy, defaultCopy, mergeCopy, applyCtaOverrides, applyRefinement, extractSiteHtml, sanitizeCopy } from './designer.js';
import { renderSite, normalizeDesign, themeForStyleHint } from './site_templates.js';
import { codegenSite, codeSection, reviewSections, assembleSite, injectCanonical } from './codegen.js';
import { fontPairFor, policyNeeds } from './mastery.js';
import { hashSeed } from './designer.js';
import { checkQuota, consumeBuild, consumeRefine } from './plans.js';
import { skillsForDomain } from './skills.js';
import { rateLimit, sha256Hex } from './guard.js';
import { esc } from './htmlutil.js';
import { buildReport } from './report.js';

const SITE_KINDS = ['landing', 'promo', 'event', 'portfolio', 'webapp', 'report'];
const ARTIFACT_LIST_CAP = 60;
const MAX_SITE_BYTES = 400_000;
const RESEARCH_KINDS = new Set(['landing', 'promo', 'event', 'portfolio', 'report']);
const RUN_TIMEOUT_MS = 300_000; // a live run older than this reports timeout
const CODED_CAP = 5; // stored coded fragments per plan (matches MAX_SECTIONS)

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

function webappSystemPrompt(site, factsLine, planBlock = '', fontLine = '') {
  return `You are a senior product engineer. Build a SMALL INTERACTIVE single-file web app. Respond with ONE complete HTML document only — no markdown fences, no commentary.

HARD RULES:
- Start with <!DOCTYPE html> and end with </html>. ALL CSS in one <style>; ALL JS in one inline <script> at the end of <body>.
- Mobile-first, feels native on a phone: sticky bottom tab bar or big touch targets, cards, rounded corners, system font stack.
- The app MUST work fully offline in one file. State persists in localStorage under ONE versioned key (e.g. "app.v1") with a tiny migrate() guard — records are flat objects with ISO dates so a backend can mirror the schema later.
- No network calls, no iframes. No images. ONE allowed external resource: a Google Fonts stylesheet (fonts.googleapis.com) for typography.
- Keep it SMALL: one core interaction done really well (tracker, checklist, calculator, quiz, notes, counter...). 2-3 screens max.
- ENGINEERING CRAFT: the store is the single source of truth (load → render → mutate → save → render); derived values computed in render(), never stored twice; destructive actions get a 3s undo toast instead of confirm(); empty states teach (one line + a big action), never a blank pane.
- Premium visual standard: consistent spacing, accessible contrast, subtle transitions, on-brand.
- IDENTITY LAW: the app belongs to "${site.name}" — its name, branding and footer are the client's ONLY. Never mention, credit or link any other business, brand, domain or the tool that built it.${factsLine ? ` Client facts: ${factsLine}.` : ''}
- No lorem ipsum. Real labels. Copy in the user's language if their brief is not English.${planBlock ? `\n\n${planBlock}` : ''}${fontLine ? `\n\n${fontLine}` : ''}`;
}

/**
 * v12 WEBAPP PLAN — one bounded architect call BEFORE coding: features,
 * data model, screens. The engineer then codes WITH this plan (real
 * full-stack thinking instead of a one-shot guess). Never throws.
 */
async function planWebapp(env, { title, brief, site, team = null }) {
  try {
    const j = await runAgent(
      env,
      team,
      'architect',
      'planning the app',
      [
        {
          role: 'system',
          content: `You are the lead engineer planning a small single-file web app. Respond with ONLY JSON:
{"app_name":"<=30 chars","core_loop":"the ONE core interaction in one sentence","features":[{"name":"","purpose":"one sentence"} (3-5 items)],"data":{"entity":"e.g. Task","fields":["id","title","done","createdAt"]},"screens":["Home"],"empty_state":"the line a brand-new user sees"}
Rules: ONE core interaction done really well; features serve THIS business; no accounts/auth (offline app); no backend.`,
        },
        { role: 'user', content: `APP FOR: ${site?.name || 'the client'}\nTITLE: ${title}\nBRIEF: ${String(brief).slice(0, 1200)}\nPlan it now.` },
      ],
      { json: true, maxTokens: 700, temperature: 0.5 },
      (out) => `planned: ${Array.isArray(out?.features) ? out.features.length : 0} features`
    );
    if (!j || !Array.isArray(j.features) || !j.features.length) return null;
    return {
      appName: String(j.app_name || title).slice(0, 40),
      coreLoop: String(j.core_loop || '').slice(0, 140),
      features: j.features.slice(0, 5).map((f) => ({ name: String(f?.name || '').slice(0, 40), purpose: String(f?.purpose || '').slice(0, 120) })),
      data: {
        entity: String(j.data?.entity || 'Item').slice(0, 24),
        fields: Array.isArray(j.data?.fields) ? j.data.fields.map((x) => String(x).slice(0, 20)).slice(0, 8) : ['id', 'title', 'createdAt'],
      },
      screens: Array.isArray(j.screens) ? j.screens.map((x) => String(x).slice(0, 24)).slice(0, 3) : ['Home'],
      emptyState: String(j.empty_state || '').slice(0, 100),
    };
  } catch {
    return null;
  }
}

function signatureApp({ title, brief, site }) {
  const color = /^#[0-9a-fA-F]{6}$/.test(site.color || '') ? site.color : '#6C8CFF';
  const name = esc(site.name);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${color}"><title>${esc(title || `${site.name} Tracker`)}</title>
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
<header><h1>${esc(title || `${site.name} Tracker`)}</h1><p>${esc(String(brief || '').slice(0, 90)) || `A quick tracker for ${name}`} · works offline</p></header>
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
async function buildWebapp(env, { title, brief, style, brand, site, team = null }) {
  const s = site || brand;
  // Owner facts only when the app IS the owner's own business.
  const facts = s.isOwnerBusiness ? (profileToFacts(s.profile || {}).facts || {}) : {};
  const factsLine = Object.entries(facts).slice(0, 6).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' | ');

  // v12 MASTERY: PLAN before CODE. One bounded architect call decides
  // the app's name, core loop, features and DATA MODEL (entity/fields),
  // then the engineer codes with that plan — full-stack thinking, not a
  // one-shot guess. Falls back silently to plan-less coding.
  const plan = await planWebapp(env, { title, brief, site: s, team });
  let planBlock = '';
  if (plan) {
    planBlock = [
      `ENGINEERING PLAN (build exactly this):`,
      `Core loop: ${plan.coreLoop}`,
      `Data model: ${plan.data.entity} { ${plan.data.fields.join(', ')} } — one versioned localStorage key.`,
      `Screens: ${plan.screens.join(' → ')}`,
      `Features: ${plan.features.map((f) => `${f.name} — ${f.purpose}`).join(' | ')}`,
      plan.emptyState ? `Empty state: "${plan.emptyState}"` : '',
    ].filter(Boolean).join('\n');
  }
  // v12 MASTERY: the app ships real typography from the pairing library.
  const pair = fontPairFor({ brief, kind: 'webapp', seed: hashSeed(`${title}${brief.slice(0, 120)}`) });
  const fontLine = `TYPOGRAPHY: load ONE Google Fonts stylesheet for "${pair.display}" (headings, 600-800) + "${pair.body}" (body) with display=swap; no other font families.`;

  const messages = [
    { role: 'system', content: webappSystemPrompt(s, factsLine, planBlock, fontLine) },
    { role: 'user', content: `TITLE: ${title}\nBRIEF: ${brief}${style ? `\nSTYLE HINT: ${style}` : ''}\nProduce the complete single-file web app now. Keep it compact — it must fit in one response.` },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await sarvamChat(env, messages, { maxTokens: 1900, temperature: 0.55 });
      const { html, error } = extractSiteHtml(raw);
      if (!html) throw new Error(error);
      return { html: sanitizeSiteHtml(html), builder: 'ai', plan };
    } catch (e) {
      if (attempt === 1) {
        // Most likely truncation — force a smaller app and try once more.
        messages[1].content = `TITLE: ${title}\nBRIEF: ${brief}\nIMPORTANT: your previous attempt did not fit the response budget. Build a SMALLER app now: ONE screen, ONE core interaction, minimal CSS (under 60 lines). Start at <!DOCTYPE html> and finish at </html>.`;
      } else {
        console.warn('[builder] webapp AI path failed, using signature app:', e?.message || e);
      }
    }
  }
  return { html: signatureApp({ title, brief, site: s }), builder: 'signature', plan };
}

/* ── v3 build pipeline (marketing kinds) ────────────────────────────── */

/**
 * POLISH — the self-critique loop. One small AI call reviews the written
 * copy against the senior rubric; if material improvements exist, the
 * patched copy is merged and the page re-rendered. Bounded: exactly one
 * critique per build, never throws, falls back to the as-written copy.
 */
async function polishCopy(env, { kind, content, brand, skillsBlock, team = null }) {
  try {
    const j = await runAgent(
      env,
      team,
      'copy_chief',
      'reviewing every line of copy',
      [
        {
          role: 'system',
          content: `You are the design director doing the FINAL review of a ${kind} page before it ships. Review the copy JSON against the rubric: headline is a concrete payoff (4-9 words); every feature title is an outcome; sub answers what+why in one breath; FAQ pre-empts price/time/trust objections; no cliches ("unleash", "elevate", "discover"); no invented hard numbers. Respond with ONLY JSON:
{"verdict":"good"} — if it already meets the bar
{"verdict":"improve","content":{...ONLY the groups you improved, full schema...}} — otherwise${skillsBlock ? `\n\n${skillsBlock}` : ''}`,
        },
        { role: 'user', content: JSON.stringify(content).slice(0, 5200) },
      ],
      { json: true, maxTokens: 1300, temperature: 0.5 },
      (out) => (out?.verdict === 'improve' ? 'director tightened the copy' : 'copy passed as written')
    );
    if (j?.verdict !== 'improve' || !j.content || typeof j.content !== 'object') return { content, polished: false };
    const patched = sanitizeCopy(j.content, { kind, brand });
    const next = mergeCopy(patched, content);
    return { content: next, polished: true };
  } catch {
    return { content, polished: false };
  }
}

/**
 * MARKETING-KIND PIPELINE (Agent v10 · DEEPTHINK) — a MULTI-AGENT TEAM,
 * GLM-class agentic engineering on Nebula's runtime:
 *
 *   LEAD (orchestrator) forms the adaptive team plan from the brief
 *   → LEAD DEEP-THINK critiques its own plan and revises it (v10:
 *     planning is a reasoning loop, not a one-shot)
 *   → ANALYST builds the PROJECT UNDERSTANDING every specialist reads
 *     (business model, audience psyche, objections, success metric)
 *   → RESEARCHER scans the live web — and runs a SECOND round when the
 *     synthesis names a concrete gap (v10 two-round research)
 *   → ART DIRECTOR designs the full system (tokens, UX flow, type scale,
 *     motion intensity) — WCAG contrast enforced mathematically
 *   → COPYWRITER writes the words → COPY CHIEF reviews every line
 *   → ARCHITECT plans the information architecture journey-mapped to the
 *     design director's UX flow
 *   → ENGINEERS (parallel) hand-code each section's HTML+CSS+motion
 *   → QA DIRECTOR reviews the code → flagged sections re-coded WITH
 *     the critique attached (rework loop)
 *   → BUILDER wires + hosts deterministically
 *   → REFLECTOR distills the build into a learned skill (self-evolution)
 *   → SKILL RESEARCHER studies the craft on the live web and grows the
 *     skill library with a researched, sourced skill (v10)
 *
 * Every agent runs in an ISOLATED context (role prompt + artifacts only)
 * and every invocation lands in the team trace the app shows the user.
 * codegenSite() THROWS only when the code stage cannot produce a viable
 * page; then — and only then — renderSite() (the deterministic template
 * engine) ships the page so a build can never fail. Templates are the
 * safety net, never the product.
 */
async function buildViaAgent(env, store, uid, { kind, title, brief, style, ctaArgs, brand, site, sink = null }) {
  const team = createTeamRun({ kind, title }, sink);

  // 0. LEAD — the orchestrator reads the brief and plans the run (the
  //    AI call + its fallback both land in the team trace)...
  let lead = await leadPlan(env, { kind, brief, brand, site, style, team });
  // 0b-identity: the Lead may have understood the client's name better
  // than the deterministic extraction (e.g. an unquoted brand). Accept
  // it when it is a real name and not a forbidden token.
  if (lead?.ai && String(lead.brand_name || '').trim().length >= 3
      && lead.brand_name.toLowerCase() !== String(brand?.name || '').toLowerCase()) {
    const leadName = String(lead.brand_name).replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim().slice(0, 80);
    if (leadName.length >= 3) site = { ...site, name: leadName, nameSource: 'lead' };
  }
  team.record('lead', 'locking the identity', { ok: true, ai: false, detail: `the client is "${site.name}" — every specialist brands with this` });
  // 0c. LEAD DEEP-THINK — ...then critiques and sharpens its own plan
  //     (v10: think → self-critique → revise). One bounded pass.
  const rev = await leadDeepThink(env, { kind, brief, brand, site, plan: lead, team });
  lead = applyDeepThink(lead, rev);
  team.stage('lead', true, lead.ai, lead.ai ? `deep-thought plan: ${lead.sections_target} sections · ${String(lead.audience || '').slice(0, 50)}` : 'classic plan');

  // 0d. ANALYST — the Project Understanding artifact every specialist
  //     reads (v10: the team shares ONE model of the business). Never
  //     throws; on failure everyone proceeds on the brief.
  const understanding = await projectUnderstanding(env, { kind, brief, brand, site, team });
  team.stage('understand', true, Boolean(understanding), understanding ? `mapped: ${String(understanding.success_metric || understanding.business_model || 'project').slice(0, 70)}` : 'brief-only understanding');

  // 1. SKILLS — load the expert skill pack (seeded + everything the agent
  //    has learned live, INCLUDING lessons the Reflector stored after
  //    earlier builds). Every build starts smarter than the last.
  const designSkills = await skillsForDomain(store, uid, 'design', { maxChars: 1100 });
  const copySkills = await skillsForDomain(store, uid, 'copy', { maxChars: 700 });

  // 2. THINK — the Art Director's design system + research queries.
  const thought = await designBrief(env, { kind, brief, style, brand, site, skillsBlock: designSkills.block, lead, understanding, team });
  team.stage('think', true, thought.ai, `${thought.design.themeLabel}${thought.ai ? ' · AI art direction' : ' · classic direction'} · ${thought.design.hero} hero${thought.design.motion_intensity ? ` · ${thought.design.motion_intensity} motion` : ''}`);
  // v13 TRANSPARENCY: the design system ships as a visible artifact.
  if (team) {
    const d = thought.design;
    team.record('director', 'locking the design system', {
      ok: true, ai: thought.ai,
      detail: `${d.themeLabel || d.theme} · ${d.palette?.accent || ''} · ${d.fontPair ? `${d.fontPair.display} × ${d.fontPair.body}` : d.font || ''}`,
      artifact: {
        type: 'design',
        label: `${d.themeLabel || d.theme} design system`,
        detail: [d.palette?.accent ? `accent ${d.palette.accent}` : '', d.palette?.bg ? `bg ${d.palette.bg}` : '', d.fontPair ? `${d.fontPair.display} × ${d.fontPair.body}` : '', d.harmony ? `${d.harmony} harmony` : '', d.motion_intensity ? `${d.motion_intensity} motion` : ''].filter(Boolean).join(' · '),
      },
    });
  }

  // 3. RESEARCH — the Researcher gathers live facts and SYNTHESIZES them
  //    into market intelligence (v10: up to 4 queries and a SECOND round
  //    when the synthesis names a concrete gap). Lead queries + deep-think
  //    queries + director queries merge (deduped, capped). Never fails
  //    the build: web down or synthesis down → raw facts → brief.
  const queries = [...new Set([...(lead.queries || []), ...thought.queries])].slice(0, 4);
  let facts = '';
  let researchAi = false;
  if (RESEARCH_KINDS.has(kind) && queries.length) {
    const ri = await researchIntelligence(env, { queries, brief, brand, site, team });
    facts = ri.block;
    researchAi = ri.ai;
    team.record('researcher', 'scanning the live web', {
      ok: true,
      ai: false, // synthesis already recorded its own runAgent row
      detail: facts ? (researchAi ? `${queries.length} search(es) distilled into intelligence` : `raw market facts found for "${queries[0]}"`) : 'web unreachable — proceeding on the brief',
    });
    team.stage('research', true, Boolean(facts), facts ? (researchAi ? 'market intelligence synthesized' : queries[0]) : 'skipped (web unreachable)');
  } else {
    team.record('researcher', 'scanning the live web', { ok: true, ai: false, detail: 'not needed for this build' });
    team.stage('research', true, thought.ai, 'not needed for this build');
  }

  // 4. WRITE — the Copywriter drafts (falls back to brief-derived copy).
  const base = defaultCopy({ kind, title, brief, brand: site });
  const { content: aiCopy, ai: copyAi } = await writeCopy(env, { kind, title, brief, brand, site, thought, factsBlock: facts, skillsBlock: copySkills.block, lead, understanding, team });
  let content = mergeCopy(aiCopy, base);
  content = applyCtaOverrides(content, ctaArgs);
  if (!content.headline) content.headline = title;
  team.stage('write', true, copyAi, copyAi ? `${content.features?.length || 0} sections written` : 'from your brief');

  // 5. POLISH — the Copy Chief's final review (skipped when copy fell
  //    back to deterministic; nothing to critique there).
  if (copyAi) {
    const polished = await polishCopy(env, { kind, content, brand, skillsBlock: designSkills.block, team });
    content = polished.content;
    team.stage('polish', true, polished.polished, polished.polished ? 'director pass applied' : 'passed review as written');
  } else {
    team.stage('polish', true, false, 'deterministic copy — review skipped');
  }

  // 6-9. PLAN → CODE → REVIEW → WIRE — Architect, Engineers (parallel),
  //       QA Director (rework loop), Builder (deterministic assembly).
  try {
    const cg = await codegenSite(env, {
      kind,
      brief,
      brand,
      site,
      thought,
      content,
      skillsBlock: designSkills.block,
      lead,
      understanding,
      team,
    });

    // IDENTITY SCRUB (v11) — the deterministic firewall pass: any owner
    // token that still leaked (aidraft.bond, the owner's name, email…)
    // is replaced before the page ships. Reported in the trace.
    let html = cg.html;
    let leakCount = 0;
    try {
      const scrubbed = scrubSiteHtml(html, site, brand);
      html = scrubbed.html;
      leakCount = scrubbed.leaks;
      team.record('builder', 'identity integrity pass', { ok: true, ai: false, detail: leakCount ? `${leakCount} foreign brand token(s) scrubbed` : 'page is 100% the client\'s brand' });
    } catch { html = cg.html; }

    // 10. REFLECT — the Reflector distills this finished build into a
    //     learned skill so the NEXT build starts smarter (self-evolution;
    //     skipped on fallback renders — nothing bespoke to learn from
    //     there). Never throws, never blocks the return.
    let reflected = '';
    if (store) {
      reflected = await reflectOnBuild(env, store, uid, {
        lead,
        plan: cg.plan,
        brand,
        verdicts: cg.stages?.verdicts || {},
        team,
      });
      team.stage('reflect', true, Boolean(reflected), reflected || 'reflection skipped');

      // 11. SKILL RESEARCHER — the team studies its craft: one live web
      //     search on the most relevant topic from THIS brief, distilled
      //     into a sourced skill the library keeps (v10). Genuinely
      //     research-built skills, not name-sake entries. Never throws.
      let skillNote = '';
      try {
        const topic = pickSkillTopic({ kind, brand, lead, understanding, design: thought.design });
        skillNote = await researchAndLearnSkill(env, store, uid, { topic, brief, brand, team });
        if (skillNote) team.record('skill_researcher', 'studying the craft', { ok: true, ai: false, detail: skillNote.slice(0, 120) });
      } catch { /* growth is a bonus */ }
      team.stage('skill', true, Boolean(skillNote), skillNote || 'skill research skipped');
    }

    return {
      html,
      content,
      design: thought.design,
      stages: team.stages,
      team: team.trace,
      teamSummary: team.summary(),
      researched: Boolean(facts),
      researchQueries: queries,
      researchAi: researchAi,
      researchFacts: facts ? facts.length : 0,
      skills: designSkills.learnedCount,
      engine: 'codegen',
      sections: cg.plan.sections,
      nav: cg.plan.nav,
      coded: cg.coded,
      images: cg.images || [],
      siteName: site.name,
      leaksScrubbed: leakCount,
      reflected,
      understanding,
      qaVerdicts: cg.stages?.verdicts || {},
      reworked: cg.stages?.reviewed || 0,
      deep: lead.deep === true,
    };
  } catch (e) {
    console.warn('[builder] codegen → engine fallback:', e?.message || e);
    team.record('builder', 'shipping the engine render', { ok: true, ai: false, detail: 'AI page unviable — deterministic engine shipped the build' });
    team.stage('render', true, false, 'engine fallback — deterministic render');
    let html = renderSite({ kind, design: thought.design, content, brand: site });
    let fbLeaks = 0;
    try {
      const scrubbed = scrubSiteHtml(html, site, brand);
      html = scrubbed.html;
      fbLeaks = scrubbed.leaks;
    } catch { /* keep raw */ }
    return {
      html,
      content,
      design: thought.design,
      stages: team.stages,
      team: team.trace,
      teamSummary: team.summary(),
      researched: Boolean(facts),
      researchQueries: queries,
      researchAi: researchAi,
      researchFacts: facts ? facts.length : 0,
      skills: designSkills.learnedCount,
      engine: 'template',
      sections: null,
      nav: null,
      images: [],
      siteName: site.name,
      leaksScrubbed: fbLeaks,
      understanding,
      qaVerdicts: {},
      reworked: 0,
      deep: lead.deep === true,
    };
  }
}

/**
 * The Skill Researcher's topic for THIS build: the most valuable craft
 * question this specific brief raises, derived deterministically (no
 * extra AI call). Uses the business industry when known so the library
 * grows along the domains this user actually builds in.
 */
function pickSkillTopic({ kind, brand, lead, understanding, design }) {
  const industry = String(brand?.profile?.industry || '').trim().slice(0, 60);
  const focus = String(lead?.research_focus || '').trim().slice(0, 80);
  const kindTopic = {
    landing: 'landing page design best practices that convert visitors',
    promo: 'promo page design patterns that drive urgency honestly',
    event: 'event page design best practices that drive registrations',
    portfolio: 'portfolio website design patterns that win clients',
    report: 'report page design best practices for credibility and readability',
    webapp: 'single page web app ux best practices',
  }[kind] || 'landing page design best practices';
  return industry ? `${industry} website design best practices` : (focus || kindTopic);
}

/* ── The build_website tool / Studio build endpoint ─────────────────── */

export async function buildWebsite(env, store, user, args, origin = '', { sink = null, runId = null } = {}) {
  const kind = SITE_KINDS.includes(String(args.kind)) ? String(args.kind) : 'landing';
  const title = String(args.title || '').trim().slice(0, 120);
  const brief = String(args.brief || args.instruction || '').trim().slice(0, 4000);
  if (brief.length < 12) {
    return { ok: false, error: 'brief is too short — describe what the site is for, its audience and the key message.' };
  }
  const effTitle = title || brief.split(/(?:[.!?]|\n)/)[0].trim().slice(0, 80) || `${kind} page`;

  // LIVE RUN (v9.1): a client-supplied run id turns this build into a
  // watchable run — the run doc streams team rows while the request runs.
  let liveSink = sink;
  let finalizeRun = null;
  const cleanRunId = String(runId || '').trim();
  if (!liveSink && store && /^[a-z0-9_]{4,24}$/i.test(cleanRunId)) {
    const runKey = `agent:run:${cleanRunId}`;
    let latest = {
      id: cleanRunId, uid: user?.uid || '', kind, title: effTitle,
      at: new Date().toISOString(), status: 'running', trace: [], stages: [], summary: null, result: null, error: null,
    };
    await store.put(runKey, JSON.stringify(latest)).catch(() => {});
    const persist = async (patch = {}) => {
      try {
        latest = { ...latest, ...patch };
        await store.put(runKey, JSON.stringify(latest));
      } catch { /* telemetry must never fail the build */ }
    };
    liveSink = (doc) => persist({ trace: Array.isArray(doc?.trace) ? doc.trace : [], stages: Array.isArray(doc?.stages) ? doc.stages : [], summary: doc?.summary || null });
    finalizeRun = (patch) => persist(patch);
  }

  const profile = store ? await getBusinessProfile(store).catch(() => null) : null;
  const brand = brandFor(env, profile);
  brand.profile = profile;
  const style = String(args.style || profile?.default_style || '').trim();
  const ctaArgs = { cta_text: args.cta_text, cta_url: args.cta_url, contact_email: args.contact_email };
  // IDENTITY FIREWALL (v11): the site's brand is the CLIENT's, resolved
  // from the brief — never the CRM owner's business. aidraft.bond, the
  // owner's name/color/contacts can no longer reach any page.
  const site = extractSiteBrand({ title: effTitle, brief, kind, ctaArgs, profile, brand });

  // Rate limit — extreme capability, guarded (applies to app + MCP + chat).
  const rl = await rateLimit(store, user?.uid || '', 'build_website');
  if (!rl.ok) {
    if (finalizeRun) await finalizeRun({ status: 'error', error: String(rl.error || 'rate limited').slice(0, 200) });
    return { ok: false, rateLimited: true, error: rl.error };
  }

  // v12 SUBSCRIPTION: the plan gate runs BEFORE the team wakes up —
  // an over-quota user never burns agent compute. Failed builds are
  // free (the counter is consumed only after the artifact ships).
  const quota = await checkQuota(store, user?.uid || '', 'build', user?.role || '');
  if (!quota.ok) {
    if (finalizeRun) await finalizeRun({ status: 'error', error: String(quota.error || 'quota exceeded').slice(0, 240) });
    return { ok: false, upgradeRequired: true, plan: quota.plan?.id, usage: quota.usage, error: quota.error };
  }

  const t0 = Date.now();
  let html, builder, stages = [], plan = null, teamTrace = [], teamSummary = null, reflected = '', deep = false, understanding = null, siteName = site.name, leaksScrubbed = 0, images = [], design = null, qaVerdicts = {}, reworked = 0, researchMeta = null, webappPlan = null;
  try {
    if (kind === 'webapp') {
      // v13: the webapp path runs a REAL live team too — the run sink
      // streams architect/engineer/builder rows while the request runs.
      const team = createTeamRun({ kind, title: effTitle }, liveSink);
      team.record('lead', 'reading the app brief', { ok: true, ai: false, detail: `${effTitle.slice(0, 50)} · ${String(brief).slice(0, 70)}` });
      const r = await buildWebapp(env, { title: effTitle, brief, style, brand, site, team });
      html = r.html;
      builder = r.builder;
      webappPlan = r.plan || null;
      if (r.plan) {
        team.record('architect', 'app plan locked', {
          ok: true, ai: true,
          detail: r.plan.coreLoop || 'core loop planned',
          artifact: { type: 'plan', label: `${r.plan.features.length} features · ${(r.plan.screens || ['Home']).join(', ')}`, detail: `data model: ${r.plan.data.entity} { ${(r.plan.data.fields || []).join(', ')} }` },
        });
      }
      team.record('engineer', 'hand-coding the single-file app', {
        ok: builder === 'ai', ai: builder === 'ai',
        detail: builder === 'ai' ? `${html.length} chars, works offline` : 'deterministic app shell',
        code: { lang: 'html', label: effTitle.slice(0, 40), preview: String(html).slice(0, 860), lines: (String(html).match(/\n/g) || []).length, chars: html.length },
      });
      try {
        const scrubbed = scrubSiteHtml(html, site, brand);
        html = scrubbed.html;
        leaksScrubbed = scrubbed.leaks;
      } catch { /* keep raw */ }
      team.record('builder', 'wiring & hosting the app', {
        ok: true, ai: false,
        detail: 'sanitized + hosted',
        artifact: { type: 'site', label: `${(html.length / 1024).toFixed(1)} KB app assembled`, detail: 'offline data layer · single file' },
      });
      stages = [
        { stage: 'think', ok: true, ai: builder === 'ai', detail: 'app architecture' },
        { stage: 'write', ok: true, ai: builder === 'ai', detail: builder === 'ai' ? 'app coded by AI' : 'signature app shell' },
        { stage: 'render', ok: true, ai: false, detail: 'sanitized + hosted' },
      ];
      teamTrace = team.trace;
      teamSummary = team.summary();
      plan = {
        kind, title: effTitle, brief: brief.slice(0, 4000), style,
        site_name: site.name, design: null, engine: 'webapp',
        sections: null, nav: null, coded: null, images: [],
      };
    } else {
      const r = await buildViaAgent(env, store, user?.uid || '', { kind, title: effTitle, brief, style, ctaArgs, brand, site, sink: liveSink });
      html = r.html;
      // 'ai' = the AI led design + copy AND hand-wrote the page code.
      // 'ai+engine' = AI design/copy with the deterministic engine render
      // (codegen fallback). The polish stage's ai flag means "director
      // improved something", so it doesn't gate the label.
      const aiStage = (name) => r.stages.find((s) => s.stage === name)?.ai === true;
      builder = r.engine === 'codegen' ? 'ai' : aiStage('think') && aiStage('write') ? 'ai+engine' : 'signature';
      stages = r.stages;
      teamTrace = r.team || [];
      teamSummary = r.teamSummary || null;
      reflected = r.reflected || '';
      deep = r.deep === true;
      understanding = r.understanding || null;
      siteName = r.siteName || site.name;
      leaksScrubbed = r.leaksScrubbed || 0;
      images = r.images || [];
      design = r.design || null;
      qaVerdicts = r.qaVerdicts || {};
      reworked = r.reworked || 0;
      researchMeta = r.researched
        ? { queries: r.researchQueries || [], ai: r.researchAi === true, facts: r.researchFacts || 0 }
        : null;
      plan = {
        kind, title: effTitle, brief: brief.slice(0, 4000), style,
        site_name: siteName,
        design: r.design, content: r.content,
        engine: r.engine, sections: r.sections, nav: r.nav,
        // Coded fragments (v9) — the raw material for surgical refines:
        // "recode just the hero" re-uses every other fragment as-is.
        coded: Array.isArray(r.coded)
          ? r.coded.slice(0, CODED_CAP).map((c) => ({ id: c.id, html: c.html, css: c.css }))
          : null,
        // Verified imagery (v11) — refines may re-cast or reuse these.
        images: images.slice(0, 8),
      };
    }
  } catch (e) {
    // The pipeline is designed not to throw; this is the last-resort net.
    console.error('[builder] pipeline error, using signature builder:', e?.stack || e);
    design = normalizeDesign({ theme: themeForStyleHint(style, kind), palette: {} }, { kind, styleHint: style, seedAccent: site.color || undefined });
    const content = applyCtaOverrides(defaultCopy({ kind, title: effTitle, brief, brand: site }), ctaArgs);
    html = renderSite({ kind, design, content, brand: site });
    try {
      const scrubbed = scrubSiteHtml(html, site, brand);
      html = scrubbed.html;
      leaksScrubbed = scrubbed.leaks;
    } catch { /* keep raw */ }
    builder = 'signature';
    stages = [{ stage: 'render', ok: true, ai: false, detail: 'fallback template' }];
  }

  html = html.trim();

  // v12 SEO: mint the id first so the public URL can be baked into the
  // page as canonical + og:url BEFORE storage (both build paths).
  const id = `s_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
  const finalUrl = origin ? `${origin}/sites/${id}` : `/sites/${id}`;
  try {
    html = injectCanonical(html, finalUrl);
  } catch { /* SEO is a bonus, never a failure */ }

  if (html.length > MAX_SITE_BYTES) html = html.slice(0, MAX_SITE_BYTES) + '\n<!-- truncated -->';

  const digest = await sha256Hex(html);
  const key = `sites/${id}.html`;
  const stored = await env.MEDIA.put(key, html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { builtBy: user?.uid || 'agent', kind, title: effTitle, sha256: digest },
  });
  if (!stored) console.warn('[builder] R2 put returned falsy for', key); // record stays the source of truth

  if (plan && store) await store.put(`agent:siteplan:${id}`, JSON.stringify(plan)).catch(() => {});

  // v13 TRANSPARENCY — the deterministic BUILD REPORT: what was built,
  // the stack, the technology, front end, back end, quality gates, the
  // crew that made it. Stored with the artifact, returned in the
  // response and streamed into the run doc so the app renders it as the
  // build's final deliverable sheet.
  let report = null;
  try {
    report = buildReport({
      kind,
      title: effTitle,
      brand: siteName,
      url: finalUrl,
      html,
      builder,
      plan,
      coded: Array.isArray(plan?.coded) ? plan.coded : null,
      design: design || {},
      images,
      team: teamTrace,
      teamSummary,
      understanding,
      lead: webappPlan ? { page_goal: webappPlan.coreLoop, audience: '' } : null,
      research: researchMeta,
      verdicts: qaVerdicts,
      reworked,
      leaks: leaksScrubbed,
      skills: [reflected].filter(Boolean),
      buildMs: Date.now() - t0,
      policy: policyNeeds(brief, kind),
    });
    if (store) await store.put(`agent:report:${id}`, JSON.stringify(report)).catch(() => {});
  } catch { /* the report is a deliverable, never a failure */ }

  await putArtifact(store, user?.uid || '', {
    id, kind, title: effTitle, url: finalUrl, builder, bytes: html.length, sha256: digest,
    version: 1, versions: [{ v: 1, at: new Date().toISOString(), bytes: html.length, sha256: digest }],
    at: new Date().toISOString(), by: user?.displayName || 'agent',
  });

  // v12 SUBSCRIPTION: the build SHIPPED — consume one unit of quota.
  try { await consumeBuild(store, user?.uid || ''); } catch { /* metering best-effort */ }

  if (finalizeRun) {
    await finalizeRun({
      status: 'done',
      result: {
        artifact_id: id,
        kind,
        title: effTitle,
        url: finalUrl,
        builder,
        bytes: html.length,
        sha256: digest,
        version: 1,
        team: teamTrace,
        team_summary: teamSummary,
        reflected,
        deep,
        understanding,
        report,
        note: `"${effTitle}" is LIVE at ${finalUrl} — share this link with anyone.`,
      },
    });
  }

  return {
    ok: true,
    artifact_id: id,
    kind,
    title: effTitle,
    url: finalUrl,
    builder,
    brand: siteName,
    leaks_scrubbed: leaksScrubbed,
    images,
    bytes: html.length,
    sha256: digest,
    version: 1,
    stages,
    team: teamTrace,
    team_summary: teamSummary,
    reflected,
    deep,
    understanding,
    report,
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

  // v12 SUBSCRIPTION: refines meter against the plan too (a refine runs
  // real AI calls; surgical ones meter 1 like any other).
  const quota = await checkQuota(store, user?.uid || '', 'refine', user?.role || '');
  if (!quota.ok) {
    return { ok: false, upgradeRequired: true, plan: quota.plan?.id, usage: quota.usage, error: quota.error };
  }

  const plan = safeParse(await store.get(`agent:siteplan:${id}`));
  const profile = store ? await getBusinessProfile(store).catch(() => null) : null;
  const brand = brandFor(env, profile);
  brand.profile = profile;

  const kind = plan?.kind || doc.kind || 'landing';
  const title = plan?.title || doc.title || effTitleFromDoc(doc);
  const brief = plan?.brief || '';
  const style = plan?.style || '';
  // IDENTITY (v11): the site keeps ITS name across refines — the stored
  // site_name wins; a fresh extraction only fills the gaps.
  const ctaArgs = { cta_text: args.cta_text, cta_url: args.cta_url, contact_email: args.contact_email };
  const site = extractSiteBrand({ title, brief, kind, ctaArgs, profile, brand });
  if (plan?.site_name) site.name = String(plan.site_name).slice(0, 80);

  let html, version, note = 'updated from your instruction';
  let content, design;
  let nextEngine = plan?.engine || null;
  let nextSections = plan?.sections || null;
  let nextNav = plan?.nav || null;
  let nextCoded = Array.isArray(plan?.coded) ? plan.coded : null;
  const team = createTeamRun({ kind, title: `refine: ${title}` });

  // v9 SURGICAL REFINE — the caller may name a subset of sections to
  // re-code ("fix just the hero"). Everything not named is re-used from
  // the stored coded fragments byte-identical, so a targeted change
  // costs one section's AI calls, not a whole page rebuild.
  const storedCoded = Array.isArray(plan?.coded) ? plan.coded : null;
  const targetsRaw = Array.isArray(args.sections)
    ? args.sections.map((s) => String(s).toLowerCase().replace(/[^a-z0-9-]/g, '')).filter(Boolean)
    : [];
  const targets = [...new Set(targetsRaw)]
    .filter((t) => Array.isArray(plan?.sections) && plan.sections.some((s) => s.id === t))
    .slice(0, 3);
  const surgical = Boolean(
    targets.length &&
    storedCoded &&
    plan?.engine === 'codegen' &&
    targets.every((t) => storedCoded.some((c) => c.id === t))
  );
  if (surgical) {
    team.record('lead', 'reading the change request', { ok: true, ai: false, detail: `surgical: ${targets.join(', ')} · ${instruction.slice(0, 70)}` });
  } else {
    team.record('lead', 'reading the change request', { ok: true, ai: false, detail: instruction.slice(0, 90) });
  }

  if (kind === 'webapp') {
    // Webapps are AI-coded documents — rebuild compact with the instruction.
    const r = await buildWebapp(env, {
      title,
      brief: `${plan?.brief || doc.title}\n\nUPDATE REQUEST: ${instruction}`,
      style,
      brand,
      site,
    });
    html = r.html;
    nextCoded = null;
    version = (Number(doc.version) || 1) + 1;
  } else if (plan?.engine === 'codegen' && Array.isArray(plan?.sections) && plan?.design?.theme) {
    // CODEGEN site: apply the instruction to the copy, then RE-CODE the
    // page — SURGICALLY when a valid `sections` subset is given (only
    // named sections are re-written; the rest come from the stored
    // fragments byte-identical), otherwise as a full re-code with the
    // SAME section architecture. Both are real iterations, not
    // re-renders; the template engine remains the never-fail net.
    const r = await applyRefinement(env, { instruction, kind, content: plan.content, design: plan.design, brand: site, team });
    content = r.content;
    design = plan.design;
    if (!r.ai) note = 'AI did not respond — rebuilt with your instruction noted in the brief';
    content = applyCtaOverrides(content, { cta_text: args.cta_text, cta_url: args.cta_url });
    const thought = { design, headlineAngle: '', mustHave: [], queries: [], ai: false };
    const updateBrief = `${brief || title}\n\nUPDATE REQUEST: ${instruction}`;
    try {
      if (surgical) {
        const coded = storedCoded.map((c) => ({ ...c }));
        const recoded = [];
        let viable = true;
        for (const t of targets) {
          const section = plan.sections.find((s) => s.id === t);
          const ctx = { kind, brief: updateBrief, brand: site, site, thought, content, design, team, section, allowedImages: new Set((plan.images || []).map((im) => im.url)) };
          let out = await codeSection(env, ctx);
          if (!out) {
            // One director-forced simpler redo before giving up on surgical.
            ctx.section = { ...section, layout: `${section.layout} Keep it SIMPLER: fewer elements, cleaner grid.` };
            out = await codeSection(env, ctx);
          }
          if (!out) { viable = false; break; }
          recoded.push({ id: t, out });
        }
        if (viable) {
          // QA review scoped to the re-coded subset, one bounded rework each.
          const review = await reviewSections(env, {
            kind,
            brand: site,
            sections: recoded.map(({ id, out }) => {
              const sec = plan.sections.find((s) => s.id === id) || {};
              return { id, name: sec.name || id, goal: sec.goal || '', css: out.css };
            }),
            team,
          });
          for (const { id } of recoded) {
            if (review.verdicts[id] !== 'fix') continue;
            const section = plan.sections.find((s) => s.id === id);
            const ctx = { kind, brief: updateBrief, brand: site, site, thought, content, design, team, section, critique: review.notes[id] || 'director flagged this section', allowedImages: new Set((plan.images || []).map((im) => im.url)) };
            const redo = await codeSection(env, ctx);
            if (!redo) continue;
            const at = recoded.findIndex((x) => x.id === id);
            recoded[at] = { id, out: redo };
          }
          for (const { id, out } of recoded) {
            const idx = coded.findIndex((c) => c.id === id);
            if (idx >= 0) coded[idx] = { id, html: out.html, css: out.css };
          }
          html = assembleSite({
            design,
            brand: site,
            content,
            coded,
            plan: { sections: plan.sections, nav: plan.nav || plan.sections.map((s) => s.id).slice(0, 4) },
            kind,
            brief: updateBrief, // v13 fix: the policy layer must see the update brief too
          }).trim();
          nextSections = plan.sections;
          nextNav = plan.nav || plan.sections.map((s) => s.id).slice(0, 4);
          nextCoded = coded;
          note = `surgical re-code of ${targets.join(' + ')} — every other section untouched`;
          team.record('builder', 'wiring the surgical update', { ok: true, ai: false, detail: `${recoded.length} section(s) re-coded · rest byte-identical` });
          team.stage('wire', true, false, `surgical: ${recoded.length} re-coded, ${coded.length - recoded.length} reused`);
        }
      }
      if (!html) {
        const cg = await codegenSite(env, {
          kind,
          brief: updateBrief,
          brand,
          site,
          thought,
          content,
          preplanned: { sections: plan.sections, nav: plan.nav || plan.sections.map((s) => s.id).slice(0, 4), ai: false },
          team,
        });
        html = cg.html;
        nextSections = cg.plan.sections;
        nextNav = cg.plan.nav;
        nextCoded = Array.isArray(cg.coded) ? cg.coded.slice(0, CODED_CAP).map((c) => ({ id: c.id, html: c.html, css: c.css })) : null;
        note = 're-coded from your instruction';
      }
    } catch (e) {
      console.warn('[builder] refine codegen → engine fallback:', e?.message || e);
      html = renderSite({ kind, design, content, brand: site }).trim();
      nextEngine = 'template';
      nextSections = null;
      nextNav = null;
      nextCoded = null;
    }
    version = (Number(doc.version) || 1) + 1;
  } else {
    if (plan?.content) {
      // Fast path: re-render from the stored plan with the instruction applied.
      const r = await applyRefinement(env, { instruction, kind, content: plan.content, design: plan.design, brand: site, team });
      content = r.content;
      design = plan.design?.theme ? plan.design : normalizeDesign({ theme: themeForStyleHint(style, kind), palette: {} }, { kind, styleHint: style, seedAccent: site.color || undefined });
      if (!r.ai) note = 'AI did not respond — rebuilt with your instruction noted in the brief';
      content = applyCtaOverrides(content, { cta_text: args.cta_text, cta_url: args.cta_url });
      nextCoded = null;
    } else {
      // Legacy artifact (pre-codegen build, no plan) → full pipeline with
      // the original brief + instruction folded in.
      const fullBrief = `${brief || doc.title}\n\nUPDATE REQUEST: ${instruction}`;
      const r = await buildViaAgent(env, store, user?.uid || '', { kind, title, brief: fullBrief, style, ctaArgs, brand, site });
      content = r.content;
      design = r.design;
      nextEngine = r.engine;
      nextSections = r.sections;
      nextNav = r.nav;
      nextCoded = Array.isArray(r.coded) ? r.coded.slice(0, CODED_CAP).map((c) => ({ id: c.id, html: c.html, css: c.css })) : null;
      if (r.engine === 'codegen') html = r.html.trim(); // already a final coded page
    }
    if (!html) html = renderSite({ kind, design, content, brand: site }).trim();
    version = (Number(doc.version) || 1) + 1;
  }
  // IDENTITY SCRUB (v11): the firewall runs on refines too.
  try {
    const scrubbed = scrubSiteHtml(html, site, brand);
    html = scrubbed.html;
  } catch { /* keep raw */ }
  if (html.length > MAX_SITE_BYTES) html = html.slice(0, MAX_SITE_BYTES) + '\n<!-- truncated -->';

  // v12 SEO: refines keep the canonical/og:url pointing at the SAME
  // public URL (the stored artifact's url wins over a fresh origin).
  try {
    const keepUrl = doc.url && /^https?:\/\//.test(doc.url) ? doc.url : (origin ? `${origin}/sites/${id}` : '');
    html = injectCanonical(html, keepUrl);
  } catch { /* SEO is a bonus */ }

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
      ? { kind, title, brief: `${plan?.brief || ''}\n\nUPDATE REQUEST: ${instruction}`.trim(), style, site_name: site.name }
      : { kind, title, brief, style, site_name: site.name, design, content, engine: nextEngine, sections: nextSections, nav: nextNav, coded: nextCoded, images: plan?.images || [] };
    await store.put(`agent:siteplan:${id}`, JSON.stringify(nextPlan)).catch(() => {});
    await putArtifact(store, user?.uid || '', {
      id, kind, title, url: doc.url || (origin ? `${origin}/sites/${id}` : `/sites/${id}`),
      builder: doc.builder || 'ai+engine', bytes: html.length, version, sha256: digest,
      versions: [...(doc.versions || []).slice(-9), { v: version, at: new Date().toISOString(), bytes: html.length, sha256: digest }],
      at: doc.at, updated_at: new Date().toISOString(), by: doc.by || user?.displayName || 'agent',
      last_refine: instruction.slice(0, 140),
    });
    // v12 SUBSCRIPTION: the refine shipped — consume one refinement unit.
    try { await consumeRefine(store, user?.uid || ''); } catch { /* metering best-effort */ }
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
    team: team.trace,
    team_summary: team.summary(),
    report: refreshReport(env, store, user, { id, html, kind, title, plan: { ...plan, content, engine: nextEngine, sections: nextSections, nav: nextNav, coded: nextCoded }, site, version, note }),
    note: `"${title}" updated to v${version} — ${note}. Same link, new look.`,
  };
}

/**
 * v13 — regenerate + persist the build report after a refine (best-effort;
 * a report failure never fails the refine). Returns the fresh report.
 */
function refreshReport(env, store, user, { id, html, kind, title, plan, site, version, note }) {
  try {
    const report = buildReport({
      kind,
      title,
      brand: plan?.site_name || site.name,
      url: plan?.url || '',
      html,
      builder: kind === 'webapp' ? 'ai' : (plan?.engine === 'codegen' ? 'ai' : 'ai+engine'),
      plan,
      coded: Array.isArray(plan?.coded) ? plan.coded : null,
      design: plan?.design || {},
      images: Array.isArray(plan?.images) ? plan.images : [],
      team: [],
      teamSummary: null,
      understanding: null,
      lead: null,
      research: null,
      verdicts: {},
      reworked: 0,
      leaks: 0,
      skills: [],
      buildMs: 0,
      policy: policyNeeds(plan?.brief || '', kind),
    });
    if (store) {
      store.put(`agent:report:${id}`, JSON.stringify(report)).catch(() => {});
    }
    return report;
  } catch {
    return null;
  }
}

/**
 * v13 — READ a stored build report (the deterministic handover sheet:
 * stack, technology, front end, back end, quality, crew). Owner-scoped:
 * the artifact must belong to the caller.
 */
export async function getBuildReport(store, uid, artifactId) {
  const id = String(artifactId || '').trim();
  if (!store || !/^[a-z0-9_]+$/i.test(id)) return { ok: false, error: 'report not found' };
  const doc = await getArtifactDoc(store, uid, id);
  if (!doc || doc.kind === 'note') return { ok: false, error: 'report not found' };
  const report = safeParse(await store.get(`agent:report:${id}`));
  if (!report) return { ok: false, error: 'no report stored for this artifact (built before v13)' };
  return { ok: true, id, report };
}

/* ── Live runs (v9.1) — watch the team work, in real time ─────────── */

/**
 * HOW LIVE RUNS WORK (v9.1): the CLIENT generates the run id and sends it
 * with the build request. buildWebsite then persists a run doc
 * (agent:run:<runId>) and the team's sink streams every agent row into it
 * WHILE THE BUILD REQUEST IS IN FLIGHT - the app (or any client) polls
 * GET /v1/studio/run?id=<runId> and watches the real team work. The final
 * write (result payload) lands in the same request, so the run doc is
 * always complete when the POST response arrives.
 *
 * WHY NOT waitUntil: a background promise only survives ~30s after the
 * response - a 60-90s bespoke build gets killed mid-flight (verified
 * live). Streaming inside the synchronous request is unbounded by that
 * cap and keeps the proven pipeline, rate limits and fallbacks untouched.
 */

/**
 * READ A LIVE RUN — status + the team trace so far. Owner-scoped: a run
 * doc belongs to exactly one uid. A 'running' doc older than the run
 * budget reports 'timeout' honestly instead of hanging the app forever.
 */
export async function getRunStatus(store, uid, id) {
  const runId = String(id || '').trim();
  if (!store || !/^[a-z0-9_]+$/i.test(runId)) return { ok: false, error: 'run not found' };
  const doc = safeParse(await store.get(`agent:run:${runId}`));
  if (!doc || !doc.uid || doc.uid !== uid) return { ok: false, error: 'run not found' };

  const startedMs = Date.parse(doc.at || '') || 0;
  const ageMs = Math.max(0, Date.now() - startedMs);
  let status = doc.status === 'done' || doc.status === 'error' ? doc.status : 'running';
  if (status === 'running' && ageMs > RUN_TIMEOUT_MS) status = 'timeout';

  return {
    ok: true,
    id: runId,
    status,
    kind: doc.kind || null,
    title: doc.title || null,
    age_seconds: Math.round(ageMs / 1000),
    trace: Array.isArray(doc.trace) ? doc.trace : [],
    stages: Array.isArray(doc.stages) ? doc.stages : [],
    summary: doc.summary || null,
    result: doc.result || null,
    error: doc.error || null,
    ...(status === 'timeout'
      ? { note: 'the run exceeded its time budget — check your sites list; the build may still have landed' }
      : {}),
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
