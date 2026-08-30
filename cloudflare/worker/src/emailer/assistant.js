/**
 * Agentic AI assistant — the CRM's own operator.
 *
 * Unlike the plain /v1/ai proxy (which just relays a prompt), this module
 * runs an AGENT LOOP on the Worker:
 *
 *   1. Build a live CRM snapshot (counts, deal pipeline, contacts, campaigns,
 *      analytics, business profile, mailer status) — the assistant always
 *      KNOWS what is going on without being told.
 *   2. Sarvam answers with EITHER {"reply": "..."} for the human OR
 *      {"action": {"tool", "args"}} to DO something.
 *   3. The Worker executes the tool against the CRM (read tools are direct
 *      D1 queries; write tools go through the same validated paths the app
 *      uses) and feeds the result back into the loop — up to 4 rounds.
 *   4. The final reply reaches the chat.
 *
 * Tools (the assistant's hands):
 *   crm_overview          — fresh counts + pipeline value
 *   search_contacts       — find people by name/email/company/segment
 *   recent_campaigns      — last AI campaigns + delivery numbers
 *   email_analytics       — totals (delivered / opened / clicked / unsubbed)
 *   list_tasks            — AI email tasks + progress
 *   create_email_task     — QUEUE A REAL EMAIL CAMPAIGN (the AI mailer's
 *                           pipeline: plan → write → brand → send, with the
 *                           same dry-run + suppression gates as the app)
 *   get_business_profile  — the brand the emails go out with
 *   save_business_profile — update brand fields (validated + taught to memory)
 *   teach_memory          — persist an owner instruction into Business Memory
 *
 * POST /v1/assistant {messages:[{role, content}...]} → {reply, actions[]}
 * Auth: any signed-in teammate (same policy as the AI mailer).
 */

import { sarvamChat } from './sarvam.js';
import { createStore, stateBackendName } from './state.js';
import { getMemory, teach, memoryContext } from './memory.js';
import { getBusinessProfile, saveBusinessProfile, brandFor, profileToFacts } from './business.js';
import { mailConfigState, runWhenFree } from './pipeline.js';
import { crmOverview, searchContacts, findMailerCampaigns } from './firestore.js';
import { getLatestAnalytics } from './analytics.js';
import { listTasks, newTask, putTask, progressOf, addEvent } from './tasks.js';

const MAX_STEPS = 4;

const SYSTEM_PROMPT = `You are the CRM's built-in AI assistant — an autonomous operator with LIVE access to this business's CRM data and its AI email engine.

You SEE the current CRM snapshot below (contacts, pipeline, campaigns, analytics). You never say "I don't have access" — the data is in front of you, and for anything deeper you have TOOLS.

Reply with ONE JSON object and nothing else. Two shapes:

1) Answer directly:
{"reply": "your helpful answer"}

2) Use a tool first:
{"action": {"tool": "<name>", "args": { ... }}}

TOOLS:
- crm_overview            {}                                  fresh counts: contacts, open deals, pipeline value, tasks
- search_contacts         {query?, segment?, limit?}          find people by name/email/company ("what is Priya's email?")
- recent_campaigns        {limit?}                            last AI email campaigns + delivery/open numbers
- email_analytics         {}                                  totals: recipients, delivered, not delivered, opens, clicks, unsubs + AI recommendations
- list_tasks              {limit?}                            AI email tasks with progress
- create_email_task       {instruction}                       QUEUE A REAL EMAIL CAMPAIGN — write it like the owner would instruct a marketer, e.g. "send an announcement about <X> to all leads". The engine plans, writes on-brand copy and delivers. If the user asked for specific recipients, include their email addresses in the instruction.
- get_business_profile    {}                                  the brand emails are sent with
- save_business_profile   {patch:{...}}                       update brand fields (business_name, tagline, about, industry, products, audience, tone, offers, website, cta_url, address, phone, contact_email, sender_name, signature_name, brand_color, default_style)
- teach_memory            {note}                              remember a lasting fact or preference about the business

RULES:
- Prefer answering from the snapshot; use tools when the user asks for specifics, changes, or actions.
- One tool per step. After a tool runs you will see TOOL_RESULT — then reply, or chain ONE more tool if truly needed (max 4 steps).
- create_email_task: quote the user's intent faithfully, add the recipient target (segment or explicit emails). If the request is vague about WHAT to send, ask ONE short clarifying question instead of guessing.
- Money is in Indian rupees. Be concrete, warm, and brief — you are a colleague, not a chatbot.
- Never invent data. If a number is not in the snapshot or a tool result, say what you would need.`;

/** Build the live snapshot the model sees every turn. */
async function buildSnapshot(env, store) {
  const [overview, campaigns, analytics, tasks, profile, mem, state] = await Promise.all([
    crmOverview(env).catch(() => null),
    findMailerCampaigns(env, { withinDays: 30 }).catch(() => []),
    getLatestAnalytics(store).catch(() => null),
    listTasks(store).catch(() => []),
    getBusinessProfile(store).catch(() => null),
    getMemory(store).catch(() => null),
    mailConfigState(env, store).catch(() => null),
  ]);

  const brand = brandFor(env, profile);
  return {
    now: new Date().toISOString(),
    crm: overview,
    business: {
      name: brand.name,
      branded: brand.branded,
      website: brand.website,
      memory_facts: mem ? mem.facts : null,
    },
    email_engine: state
      ? {
          ready: state.ready,
          dryRun: state.dryRun,
          from: state.sender,
          transactional_max: state.transactional_max,
          suppressions: store ? (safeCount(store)) : 0,
        }
      : null,
    recent_campaigns: campaigns.slice(0, 5).map((c) => ({
      name: c.name,
      subject: c.subject,
      status: c.status,
      recipients: c.audienceCount,
      metrics: c.metrics ? {
        delivered: c.metrics.delivered, opens: c.metrics.opens,
        clicks: c.metrics.clicks, unsubscribes: c.metrics.unsubscribes,
      } : null,
    })),
    analytics_totals: analytics?.totals ?? null,
    recommendations: analytics?.learnings?.recommendations?.slice(0, 4) ?? [],
    ai_email_tasks: tasks.slice(0, 5).map((t) => ({
      instruction: String(t.instruction || '').slice(0, 120),
      status: t.status,
      progress: progressOf(t),
    })),
  };
}

function safeCount(store) {
  return store?._suppressionCount ?? 0;
}

/** Execute one tool call. Returns a JSON-serialisable result for the model. */
async function runTool(action, env, store, uid, ctx = { waitUntil: () => {} }) {
  const tool = String(action?.tool || '').trim();
  const args = action?.args && typeof action.args === 'object' ? action.args : {};
  switch (tool) {
    case 'crm_overview':
      return { ok: true, crm: await crmOverview(env) };

    case 'search_contacts': {
      const rows = await searchContacts(env, {
        query: args.query,
        segment: args.segment,
        limit: Math.min(Number(args.limit) || 10, 25),
      });
      return { ok: true, count: rows.length, contacts: rows };
    }

    case 'recent_campaigns': {
      const rows = await findMailerCampaigns(env, { withinDays: 60 });
      return {
        ok: true,
        campaigns: rows.slice(0, Math.min(Number(args.limit) || 5, 10)).map((c) => ({
          name: c.name, subject: c.subject, status: c.status,
          recipients: c.audienceCount, metrics: c.metrics || null,
          scheduledAt: c.scheduledAt || null,
        })),
      };
    }

    case 'email_analytics': {
      const snap = await getLatestAnalytics(store);
      if (!snap) return { ok: true, message: 'No analytics pulled yet. The engine refreshes them automatically; trigger a campaign first.' };
      return { ok: true, totals: snap.totals ?? null, learnings: snap.learnings ?? null, campaigns: (snap.campaigns || []).slice(0, 8) };
    }

    case 'list_tasks': {
      const rows = await listTasks(store);
      return {
        ok: true,
        tasks: rows.slice(0, Math.min(Number(args.limit) || 5, 10)).map((t) => ({
          id: t.id, instruction: String(t.instruction || '').slice(0, 200), status: t.status, progress: progressOf(t),
        })),
      };
    }

    case 'create_email_task': {
      const instruction = String(args.instruction || '').trim().slice(0, 4000);
      if (instruction.length < 8) {
        return { ok: false, error: 'instruction is too short — describe what email to send and to whom.' };
      }
      const task = newTask(instruction, 'assistant', uid);
      addEvent(task, 'Queued by the AI assistant.', 'info');
      await putTask(store, task);
      // Start planning NOW (retry politely while another run holds the lock)
      // — a queued task that waits for the 5-min cron reads as "forgotten".
      try {
        ctx.waitUntil?.(runWhenFree(env, task.id).catch(() => {}));
      } catch { /* kick is best-effort; the cron still picks it up */ }
      return {
        ok: true,
        taskId: task.id,
        note: `Email task queued and starting (${task.id}). The AI mailer plans, writes on-brand copy and delivers in live-tracked batches; progress appears in the AI Email screen and via list_tasks.`,
      };
    }

    case 'get_business_profile': {
      const profile = await getBusinessProfile(store);
      const brand = brandFor(env, profile);
      return { ok: true, profile, brand: { name: brand.name, fromName: brand.fromName, website: brand.website, ctaUrl: brand.ctaUrl, branded: brand.branded } };
    }

    case 'save_business_profile': {
      const patch = args.patch && typeof args.patch === 'object' ? args.patch : args;
      const known = ['business_name', 'tagline', 'about', 'industry', 'products', 'audience', 'tone', 'offers', 'website', 'cta_url', 'address', 'phone', 'contact_email', 'sender_name', 'signature_name', 'brand_color', 'default_style'];
      const clean = {};
      for (const k of known) if (k in patch) clean[k] = patch[k];
      if (!Object.keys(clean).length) return { ok: false, error: 'no known profile fields in patch' };
      const profile = await saveBusinessProfile(store, clean);
      const facts = profileToFacts(clean);
      if (Object.keys(facts).length) {
        await teach(env, store, { facts, origin: 'owner' }).catch(() => {});
      }
      const brand = brandFor(env, profile);
      return { ok: true, saved: Object.keys(clean), brand: { name: brand.name, fromName: brand.fromName, branded: brand.branded } };
    }

    case 'teach_memory': {
      const note = String(args.note || '').trim().slice(0, 2000);
      if (!note) return { ok: false, error: 'note is required' };
      const mem = await teach(env, store, { note, origin: 'owner' });
      return { ok: true, learned: true, facts_known: Object.values(mem.facts).filter((v) => (Array.isArray(v) ? v.length : v)).length };
    }

    default:
      return { ok: false, error: `unknown tool "${tool}" — pick one from the TOOLS list` };
  }
}

/** POST /v1/assistant handler (auth already verified by index.js). */
export async function handleAssistant(request, env, { uid, ctx = { waitUntil: () => {} } }) {
  try {
    if (!env.SARVAM_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI is not configured on the server.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const incoming = Array.isArray(body?.messages) ? body.messages : [];
    const messages = incoming
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!messages.length) {
      return new Response(JSON.stringify({ error: 'messages:[{role,content}] is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
    if (store) {
      // Cheap suppression count for the snapshot (avoid import cycles by
      // reading the same key the mailer uses).
      try {
        const raw = await store.get('mail:suppressions');
        const list = raw ? JSON.parse(raw) : [];
        store._suppressionCount = Array.isArray(list) ? list.length : 0;
      } catch { store._suppressionCount = 0; }
    }
    const snapshot = await buildSnapshot(env, store);
    const mem = await getMemory(store).catch(() => null);
    const memoryBlock = memoryContext(mem);

    const convo = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nCURRENT CRM SNAPSHOT:\n${JSON.stringify(snapshot).slice(0, 6000)}${memoryBlock ? `\n\nBUSINESS MEMORY (owner-taught):\n${memoryBlock.slice(0, 1200)}` : ''}` },
      ...messages,
    ];

    const actions = [];
    let reply = '';
    for (let step = 0; step < MAX_STEPS; step++) {
      const out = await sarvamChat(env, convo, { json: true, temperature: 0.35, maxTokens: 2200 });
      if (out.action && out.action.tool) {
        const result = await runTool(out.action, env, store, uid, ctx);
        actions.push({ tool: String(out.action.tool), ok: !!result.ok, summary: summarize(result) });
        convo.push({ role: 'user', content: `TOOL_RESULT (${out.action.tool}): ${JSON.stringify(result).slice(0, 3000)}\n\nContinue: reply to the user now, or chain ONE more tool if strictly necessary.` });
        continue;
      }
      reply = String(out.reply || '').trim();
      if (!reply && typeof out === 'string') reply = out;
      break;
    }
    if (!reply) {
      reply = actions.length
        ? `Done — ${actions.map((a) => a.tool).join(', ')} completed. You can see the results in the app.`
        : 'I could not produce an answer this time — please try rephrasing.';
    }

    return new Response(JSON.stringify({ ok: true, reply, actions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[assistant] failed:', e?.stack || e);
    return new Response(JSON.stringify({ error: `assistant error: ${e?.message || e}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** One-line human-readable result summary (shown under the chat reply). */
function summarize(result) {
  if (!result || typeof result !== 'object') return '';
  if (result.error) return String(result.error).slice(0, 140);
  if (result.taskId) return `email task ${result.taskId} queued`;
  if (Array.isArray(result.contacts)) return `${result.contacts.length} contact(s) found`;
  if (result.crm) return 'CRM overview refreshed';
  if (result.brand) return `brand: ${result.brand.name}`;
  if (result.learned) return 'memory updated';
  if (result.saved) return `profile fields saved: ${result.saved.join(', ')}`;
  if (result.totals) return 'analytics fetched';
  if (Array.isArray(result.campaigns)) return `${result.campaigns.length} campaign(s)`;
  if (Array.isArray(result.tasks)) return `${result.tasks.length} task(s)`;
  return 'done';
}
