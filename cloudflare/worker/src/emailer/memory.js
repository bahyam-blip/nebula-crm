/**
 * Business Memory — the AI mailer's long-term brain.
 *
 * The mailer should not treat every campaign as its first. This module gives
 * it a persistent, self-updating memory of WHAT the business sells, WHO buys,
 * HOW it should sound, and WHICH creative plays have already worked:
 *
 *   facts     — business_type, industry, products[], audience, tone, offers[],
 *               language. Owner-taught facts ALWAYS win over AI-inferred ones
 *               (tracked in facts_origin).
 *   insights  — the creative playbook: distilled lessons from real campaign
 *               analytics ("questions in subjects lifted opens to 41%") and
 *               from the owner's own teachings. Each has a weight; repeated
 *               confirmations make an insight stronger.
 *   notes     — recent owner instructions/campaign focus (what the business
 *               is actively marketing right now).
 *
 * Storage: the same state store as tasks (Workers KV, else Firestore
 * mail_state/biz%3Amemory). Survives redeploys; no extra setup.
 *
 * App endpoints (see pipeline.js):
 *   GET  /v1/mail/memory        — what the AI currently knows
 *   POST /v1/mail/memory        — teach it ({facts:{...}, note:"free text"})
 *   POST /v1/mail/memory/reset  — wipe
 */

import { sarvamChat } from './sarvam.js';

const MEMORY_KEY = 'biz:memory';
const MAX_INSIGHTS = 40;
const MAX_NOTES = 20;
const MAX_LIST = 12;

/* ── Shape ──────────────────────────────────────────────────────── */

export function emptyMemory() {
  return {
    facts: {
      business_type: '',
      industry: '',
      products: [],
      audience: '',
      tone: '',
      offers: [],
      language: 'en',
    },
    facts_origin: {}, // field → 'owner' | 'ai' — owner always wins
    insights: [],     // { text, kind, weight, at }
    notes: [],        // recent owner instructions / campaign focus
    updatedAt: null,
  };
}

export async function getMemory(store) {
  if (!store) return emptyMemory();
  const raw = await store.get(MEMORY_KEY).catch(() => null);
  if (!raw) return emptyMemory();
  try {
    const mem = JSON.parse(raw);
    return { ...emptyMemory(), ...mem, facts: { ...emptyMemory().facts, ...(mem.facts || {}) } };
  } catch {
    return emptyMemory();
  }
}

export async function saveMemory(store, mem) {
  mem.updatedAt = new Date().toISOString();
  if (!store) return false;
  // await BEFORE comparing — store.put() is a Promise; `promise !== false`
  // would always be true and silently accept a failed write.
  return (await store.put(MEMORY_KEY, JSON.stringify(mem))) !== false;
}

export async function resetMemory(store) {
  if (store) await store.delete(MEMORY_KEY).catch(() => {});
  return emptyMemory();
}

/* ── Merging ────────────────────────────────────────────────────── */

function asList(v, cap = MAX_LIST) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim().slice(0, 160)).filter(Boolean).slice(0, cap);
  if (typeof v === 'string' && v.trim()) {
    return v.split(/[;,\n]/).map((x) => x.trim().slice(0, 160)).filter(Boolean).slice(0, cap);
  }
  return null;
}

function mergeList(existing, incoming, cap = MAX_LIST) {
  const seen = new Set(existing.map((x) => x.toLowerCase()));
  const out = [...existing];
  for (const item of incoming) {
    const k = item.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(item); }
  }
  return out.slice(0, cap);
}

/** Apply a patch ({facts, insights, notes}) to memory. Owner facts win. */
export function applyPatch(mem, patch = {}) {
  const f = patch.facts || {};
  const scalarFields = ['business_type', 'industry', 'audience', 'tone', 'language'];
  for (const key of scalarFields) {
    const v = typeof f[key] === 'string' ? f[key].trim().slice(0, 300) : '';
    if (v) {
      if (mem.facts_origin[key] !== 'owner' || patch.origin === 'owner') {
        mem.facts[key] = v;
        if (patch.origin) mem.facts_origin[key] = patch.origin;
      }
    }
  }
  for (const key of ['products', 'offers']) {
    const list = asList(f[key]);
    if (list?.length) {
      if (mem.facts_origin[key] !== 'owner' || patch.origin === 'owner') {
        mem.facts[key] = mergeList(mem.facts[key] || [], list);
        if (patch.origin) mem.facts_origin[key] = patch.origin;
      }
    }
  }

  for (const ins of patch.insights || []) {
    const text = String(ins?.text || '').trim().slice(0, 300);
    if (!text) continue;
    const dup = mem.insights.find((i) => i.text.toLowerCase() === text.toLowerCase());
    if (dup) {
      dup.weight = (dup.weight || 1) + 1;
      dup.at = new Date().toISOString();
    } else {
      mem.insights.push({
        text,
        kind: String(ins?.kind || 'observation').slice(0, 24),
        weight: 1,
        at: new Date().toISOString(),
      });
    }
  }
  mem.insights.sort((a, b) => (b.weight || 1) - (a.weight || 1));
  mem.insights = mem.insights.slice(0, MAX_INSIGHTS);

  for (const n of patch.notes || []) {
    const text = String(n || '').trim().slice(0, 300);
    if (!text) continue;
    if (!mem.notes.some((x) => x.toLowerCase() === text.toLowerCase())) mem.notes.unshift(text);
  }
  mem.notes = mem.notes.slice(0, MAX_NOTES);

  return mem;
}

/* ── Owner teaching (app → AI distillation) ─────────────────────── */

const DISTILL_SCHEMA = `Return ONLY a JSON object extracted from the owner's description:
{
 "business_type": "one line: what this business is/sells",
 "industry": "industry",
 "products": ["products or services offered"],
 "audience": "who the customers are",
 "tone": "desired brand voice in 3-6 words",
 "offers": ["current promotions/offers if any, else empty array"],
 "insights": [{"text": "a durable marketing lesson about THIS business", "kind": "positioning|audience|offer|style"}]
}
Keep every string short and concrete. Never invent facts that are not in the owner's text.`;

/**
 * Teach the memory: structured facts merge directly; a free-form `note` is
 * distilled by Sarvam into facts + insights. Works even without Sarvam
 * (the raw note is kept and applied as a lesson verbatim).
 */
export async function teach(env, store, { facts = {}, note = '', origin = 'owner' } = {}) {
  const mem = await getMemory(store);
  const patch = { facts, origin, insights: [], notes: [] };

  const clean = {};
  for (const k of ['business_type', 'industry', 'audience', 'tone', 'language']) {
    if (typeof facts?.[k] === 'string' && facts[k].trim()) clean[k] = facts[k].trim();
  }
  for (const k of ['products', 'offers']) {
    const l = asList(facts?.[k]);
    if (l) clean[k] = l;
  }
  patch.facts = clean;

  const noteText = String(note || '').trim().slice(0, 2000);
  if (noteText) {
    patch.notes = [`[owner] ${noteText.slice(0, 260)}`];
    if (env.SARVAM_API_KEY) {
      try {
        const distilled = await sarvamChat(
          env,
          [
            { role: 'system', content: 'You maintain the marketing memory of a business. Extract durable, concrete facts and lessons. Always reply with valid JSON.' },
            { role: 'user', content: `Owner says:\n"""\n${noteText}\n"""\n\nCurrent memory facts:\n${JSON.stringify(mem.facts)}\n\n${DISTILL_SCHEMA}` },
          ],
          { json: true, temperature: 0.3, maxTokens: 1200 }
        );
        patch.facts = { ...patch.facts };
        for (const k of ['business_type', 'industry', 'audience', 'tone']) {
          if (!patch.facts[k] && typeof distilled?.[k] === 'string' && distilled[k].trim()) {
            patch.facts[k] = distilled[k].trim();
          }
        }
        for (const k of ['products', 'offers']) {
          const l = asList(distilled?.[k]);
          if (l?.length && !patch.facts[k]) patch.facts[k] = l;
        }
        for (const i of distilled?.insights || []) {
          if (typeof i === 'string') patch.insights.push({ text: i, kind: 'positioning' });
          else if (i?.text) patch.insights.push({ text: i.text, kind: i.kind || 'positioning' });
        }
      } catch (e) {
        console.warn(`[mailer:memory] distill failed (keeping raw note): ${e.message}`);
      }
    }
  }

  applyPatch(mem, patch);
  // Owner-taught content is precious: a swallowed write must NEVER read back
  // as "Learned." — fail loudly so the app shows a real error and the owner
  // can retry instead of believing the AI remembered.
  const ok = await saveMemory(store, mem);
  if (!ok) {
    throw new Error('Could not save to the business memory (state store write failed). Nothing was lost — please try again.');
  }
  return mem;
}

/* ── Learning from real outcomes ────────────────────────────────── */

/**
 * Feed analytics learnings + per-campaign results back into the memory so
 * every future plan/copy prompt is sharper. Dedupes by text; confirmations
 * strengthen an insight's weight instead of duplicating it.
 */
export async function learnFromResults(store, learnings, campaigns = []) {
  if (!store) return null;
  const mem = await getMemory(store);
  const insights = [];

  for (const r of learnings?.recommendations || []) insights.push({ text: String(r), kind: 'recommendation' });
  for (const s of learnings?.best_subject_styles || []) insights.push({ text: `Subject style that works: ${s}`, kind: 'subject' });
  for (const o of learnings?.observations || []) insights.push({ text: String(o), kind: 'observation' });
  const hour = Number(learnings?.best_send_hour);
  if (Number.isFinite(hour)) {
    insights.push({ text: `Send around ${String(hour).padStart(2, '0')}:00 local time — engagement peaks then`, kind: 'timing' });
  }

  for (const c of campaigns || []) {
    const open = Number(c.open_rate);
    if (!Number.isFinite(open) || !c.subject) continue;
    if (open >= 30) insights.push({ text: `WINNER (open ${open}%): "${String(c.subject).slice(0, 90)}" — reuse this angle`, kind: 'winner' });
    else if (open > 0 && open < 8) insights.push({ text: `FLOP (open ${open}%): "${String(c.subject).slice(0, 90)}" — avoid this angle`, kind: 'flop' });
  }

  applyPatch(mem, { insights });
  await saveMemory(store, mem);
  return mem;
}

/* ── Prompt context ─────────────────────────────────────────────── */

/** Compact memory block injected into planner + copywriter prompts. */
export function memoryContext(mem, { maxInsights = 10 } = {}) {
  const parts = [];
  const f = mem?.facts || {};
  const factLines = [];
  if (f.business_type) factLines.push(`What the business is: ${f.business_type}`);
  if (f.industry) factLines.push(`Industry: ${f.industry}`);
  if (f.products?.length) factLines.push(`Products/services: ${f.products.join('; ')}`);
  if (f.audience) factLines.push(`Customers: ${f.audience}`);
  if (f.tone) factLines.push(`Brand voice: ${f.tone}`);
  if (f.offers?.length) factLines.push(`Current offers: ${f.offers.join('; ')}`);
  if (factLines.length) parts.push(`WHAT THE BUSINESS IS (owner-taught + learned):\n${factLines.map((l) => `- ${l}`).join('\n')}`);

  const top = (mem?.insights || []).slice(0, maxInsights);
  if (top.length) {
    parts.push(`CREATIVE PLAYBOOK (what already works here — apply it):\n${top.map((i) => `- ${i.text}`).join('\n')}`);
  }
  if (mem?.notes?.length) {
    parts.push(`RECENT CAMPAIGN FOCUS (avoid repeating subjects/angles):\n${mem.notes.slice(0, 5).map((n) => `- ${n}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Sync an AI-inferred brief into memory WITHOUT overwriting owner facts. */
export function syncBriefToMemory(mem, brief) {
  const patch = { origin: 'ai', facts: {}, insights: [] };
  for (const k of ['business_type', 'industry', 'audience', 'tone']) {
    if (!mem.facts[k] && typeof brief?.[k] === 'string' && brief[k].trim()) patch.facts[k] = brief[k].trim();
  }
  const products = asList(brief?.topics_pool?.filter((t) => typeof t === 'string'), 8);
  if (!mem.facts.products?.length && products?.length) patch.facts.products = products;
  return applyPatch(mem, patch);
}
