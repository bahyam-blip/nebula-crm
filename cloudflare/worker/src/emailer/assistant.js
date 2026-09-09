/**
 * Agentic AI assistant v2 — the CRM's own operator.
 *
 * ONE unified agent loop on the Worker, with a formal TOOL REGISTRY:
 *
 *   1. Build a live CRM snapshot (counts, deal pipeline, contacts, campaigns,
 *      analytics, business profile, mailer status, team roster) — the
 *      assistant always KNOWS what is going on without being told.
 *   2. Sarvam answers with EITHER {"reply": "..."} for the human OR
 *      {"action": {"tool", "args"}} to DO something.
 *   3. The Worker executes the tool (same validated data layer the app
 *      uses — data.js putDoc/canWrite — so the agent can never escalate
 *      privileges) and feeds the result back into the loop — up to 5 rounds.
 *   4. Every tool call is written to an AUDIT LOG; every turn is written to
 *      per-user EPISODIC memory so the assistant remembers past exchanges
 *      beyond the client-sent chat history.
 *   5. CONSEQUENTIAL tools (mass email sends) go through an APPROVAL GATE:
 *      the action is stored, the chat shows an Approve/Decline card, and
 *      POST /v1/assistant/approve executes or cancels it.
 *
 * Tool registry (19 tools, three risk tiers):
 *   read           — direct D1 reads, always safe
 *   write          — create/update CRM records, role-checked server-side
 *   consequential  — affects the outside world (email to humans); needs
 *                    the owner's explicit approval when AGENT_APPROVAL_MODE
 *                    is 'always' (production default, set in wrangler.toml)
 *
 * POST /v1/assistant         {messages:[{role, content}...]} → {reply, actions[], approvals[]}
 * POST /v1/assistant/approve {id, decision}                  → {reply, actions[]}
 * Auth: any signed-in teammate (same policy as the AI mailer); individual
 * tools add their own role requirements on top.
 */

import { sarvamChat } from './sarvam.js';
import { createStore, stateBackendName, safeParse } from './state.js';
import { getMemory, teach, memoryContext } from './memory.js';
import { getBusinessProfile, saveBusinessProfile, brandFor, profileToFacts } from './business.js';
import { mailConfigState, runWhenFree } from './pipeline.js';
import { crmOverview, searchContacts, findMailerCampaigns } from './firestore.js';
import { getLatestAnalytics } from './analytics.js';
import { listTasks, newTask, putTask, progressOf, addEvent } from './tasks.js';
import { getDoc, putDoc, canWrite, isManagerUp, loadUser } from '../data.js';

const MAX_STEPS = 5;
const APPROVAL_TTL = 60 * 60 * 24; // approvals expire after 24h

/** Roles allowed to make the agent WRITE to the CRM. Viewers are read-only. */
const WRITE_ROLES = ['superAdmin', 'admin', 'manager', 'salesRep', 'telecaller', 'supportAgent'];
/** Roles allowed to manage TEAM resources (assignment, stages, brand). */
const MANAGER_ROLES = ['superAdmin', 'admin', 'manager'];

const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const CALL_OUTCOMES = ['connected', 'callback', 'interested', 'notInterested', 'wrongNumber', 'doNotCall', 'converted', 'attempted'];

/* ══ TOOL REGISTRY ══════════════════════════════════════════════════
 * name → { tier, roles, spec (model-facing one-liner) }
 * roles: undefined = any signed-in user; else array of allowed roles.
 */
const TOOLS = {
  // ── read ──
  crm_overview: { tier: 'read', spec: 'fresh counts: contacts, open deals, pipeline value, tasks' },
  search_contacts: { tier: 'read', spec: 'find people by name/email/company ("what is Priya\'s email?")' },
  search_deals: { tier: 'read', spec: 'find deals by title/company/contact and stage, with values' },
  recent_campaigns: { tier: 'read', spec: 'last AI email campaigns + delivery/open numbers' },
  email_analytics: { tier: 'read', spec: 'totals: recipients, delivered, opened, clicked, unsubscribed + AI recommendations' },
  list_tasks: { tier: 'read', spec: 'AI email campaign tasks with progress' },
  list_crm_tasks: { tier: 'read', spec: 'the team\'s CRM tasks/reminders (title, assignee, due, priority)' },
  list_team: { tier: 'read', spec: 'team roster: who is on the team, their role and uid (needed before assigning anything)' },
  get_business_profile: { tier: 'read', spec: 'the brand the emails go out with' },
  // ── write (role-checked) ──
  create_contact: { tier: 'write', roles: WRITE_ROLES, spec: 'add a new contact {name, email?, phone?, company?, jobTitle?, notes?}' },
  create_task: { tier: 'write', roles: WRITE_ROLES, spec: 'create a task/reminder {title, description?, assigneeName?, due?: "YYYY-MM-DD", priority?, contactName?}' },
  log_call: { tier: 'write', roles: WRITE_ROLES, spec: 'record a call on a contact {contactQuery, outcome, notes?, followUpInDays?} — outcomes: connected|callback|interested|notInterested|wrongNumber|doNotCall|converted|attempted' },
  update_deal_stage: { tier: 'write', roles: MANAGER_ROLES, spec: 'move a deal to another stage {query, stage} — stages: lead|qualified|proposal|negotiation|won|lost' },
  assign_leads: { tier: 'write', roles: MANAGER_ROLES, spec: 'give N leads to one teammate {to: name, count?: int, query?: filter}' },
  distribute_leads: { tier: 'write', roles: MANAGER_ROLES, spec: 'share leads evenly (round robin) across named teammates {to: [names], count?: int, query?: filter}' },
  save_business_profile: { tier: 'write', roles: MANAGER_ROLES, spec: 'update brand fields {patch:{...}} (business_name, tagline, about, industry, products, audience, tone, offers, website, cta_url, address, phone, contact_email, sender_name, signature_name, brand_color, default_style)' },
  teach_memory: { tier: 'write', roles: WRITE_ROLES, spec: 'remember a lasting fact or preference about the business {note}' },
  // ── consequential ──
  create_email_task: { tier: 'consequential', spec: 'QUEUE A REAL EMAIL CAMPAIGN {instruction} — write it like the owner would instruct a marketer, e.g. "send an announcement about <X> to all leads". The engine plans, writes on-brand copy and delivers. May require the owner\'s approval first.' },
};

function approvalMode(env) {
  return String(env.AGENT_APPROVAL_MODE || 'off').toLowerCase() === 'always' ? 'always' : 'off';
}

const SYSTEM_PROMPT = `You are the CRM's built-in AI assistant — an autonomous operator with LIVE access to this business's CRM data, its team and its AI email engine.

You SEE the current CRM snapshot below (contacts, pipeline, team, campaigns, analytics). You never say "I don't have access" — the data is in front of you, and for anything deeper you have TOOLS.

Reply with ONE JSON object and nothing else. Two shapes:

1) Answer directly:
{"reply": "your helpful answer"}

2) Use a tool first:
{"action": {"tool": "<name>", "args": { ... }}}

TOOLS:
$TOOLS

RULES:
- Prefer answering from the snapshot; use tools when the user asks for specifics, changes, or actions.
- One tool per step. After a tool runs you will see TOOL_RESULT #n — then reply, or chain one more tool if truly needed (max 5 steps). When you quote a number a tool returned, keep it EXACT and mention which source it came from (e.g. "per the last analytics pull").
- The snapshot's "me" block is the CALLER. Respect their role: if a tool is outside their role, do not attempt it — explain in one line what they should ask a manager for. If a tool result says not-permitted, say it plainly.
- create_task / assign / distribute: match people against the snapshot team roster (or list_team). Never invent a teammate. If the user's request names no assignee and it is ambiguous, ask ONE short clarifying question.
- create_email_task: quote the user's intent faithfully, add the recipient target (segment or explicit emails). If the request is vague about WHAT to send, ask ONE short clarifying question instead of guessing. If the result is a pending approval, tell the user to confirm it with the Approve button.
- log_call and create_contact write real records — never use them to "test".
- Money is in Indian rupees. Be concrete, warm, and brief — you are a colleague, not a chatbot.
- Never invent data. If a number is not in the snapshot or a tool result, say what you would need.`;

/** Render the TOOLS block for the prompt, annotated with the caller's role. */
function toolsBlock(role) {
  return Object.entries(TOOLS)
    .map(([name, t]) => {
      const allowed = !t.roles || t.roles.includes(role);
      const tag = t.tier === 'consequential' ? ' [needs owner approval]' : (!allowed ? ' [not allowed for this role]' : '');
      return `- ${String(name).padEnd(20)} ${t.spec}${tag}`;
    })
    .join('\n');
}

/* ══ Audit log ══════════════════════════════════════════════════════ */

async function auditTool(store, entry) {
  try {
    const log = safeParse(await store.get('agent:audit'), []);
    log.unshift(entry);
    await store.put('agent:audit', JSON.stringify(log.slice(0, 100)));
  } catch { /* audit must never break the assistant */ }
}

/* ══ Episodic memory (per-user, survives across sessions) ═══════════ */

async function loadEpisodes(store, uid) {
  if (!store || !uid) return [];
  return safeParse(await store.get(`agent:episodes:${uid}`), []);
}

async function saveEpisode(store, uid, { q, reply, tools }) {
  if (!store || !uid) return;
  try {
    const key = `agent:episodes:${uid}`;
    const eps = safeParse(await store.get(key), []);
    eps.push({
      at: new Date().toISOString(),
      q: String(q || '').slice(0, 160),
      a: String(reply || '').slice(0, 260),
      tools: (tools || []).slice(0, 4),
    });
    await store.put(key, JSON.stringify(eps.slice(-6)));
  } catch { /* best-effort */ }
}

function episodesContext(eps) {
  if (!eps || !eps.length) return '';
  return eps
    .slice(-6)
    .map((e) => `- (${(e.at || '').slice(0, 10)}) user asked: ${e.q} | you: ${e.a}${e.tools?.length ? ` [tools: ${e.tools.join(', ')}]` : ''}`)
    .join('\n');
}

/* ══ Approvals ══════════════════════════════════════════════════════ */

async function putApproval(store, a) {
  await store.put(`agent:approval:${a.id}`, JSON.stringify(a), { expirationTtl: APPROVAL_TTL });
}

async function getApproval(store, id) {
  if (!store || !id) return null;
  return safeParse(await store.get(`agent:approval:${id}`), null);
}

/* ══ Snapshot ═══════════════════════════════════════════════════════ */

/** Team roster for the snapshot + people-matching in write tools. */
async function listTeam(env, user) {
  if (!env.DB) return [];
  const { results } = await env.DB
    .prepare("SELECT id, json FROM docs WHERE col = 'users' LIMIT 300")
    .all();
  return (results || [])
    .map((r) => {
      try {
        const u = JSON.parse(r.json);
        return { uid: r.id, name: String(u.displayName || u.name || u.email || r.id), email: String(u.email || ''), role: String(u.role || 'salesRep'), teamId: String(u.teamId || '') };
      } catch { return null; }
    })
    .filter(Boolean)
    .filter((u) => user?.role === 'superAdmin' || !user?.teamId || u.teamId === user.teamId);
}

/** Find a user by display name (ci-substring, exact match preferred). */
function matchUser(roster, name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q) return null;
  const exact = roster.find((u) => u.name.toLowerCase() === q || u.email.toLowerCase() === q);
  if (exact) return exact;
  const partial = roster.filter((u) => u.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  return null; // 0 or ambiguous — never guess
}

/** Build the live snapshot the model sees every turn. */
async function buildSnapshot(env, store, user) {
  const [overview, campaigns, analytics, tasks, profile, mem, state, roster] = await Promise.all([
    crmOverview(env).catch(() => null),
    findMailerCampaigns(env, { withinDays: 30 }).catch(() => []),
    getLatestAnalytics(store).catch(() => null),
    listTasks(store).catch(() => []),
    getBusinessProfile(store).catch(() => null),
    getMemory(store).catch(() => null),
    mailConfigState(env, store).catch(() => null),
    listTeam(env, user).catch(() => []),
  ]);

  const brand = brandFor(env, profile);
  return {
    now: new Date().toISOString(),
    me: user ? { name: user.displayName || user.email || user.uid, role: user.role } : null,
    crm: overview,
    team: roster.slice(0, 12).map((u) => ({ name: u.name, role: u.role })),
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
          suppressions: store ? (store._suppressionCount ?? 0) : 0,
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
    open_crm_tasks: await openCrmTasks(env, user).catch(() => []),
    approval_gate: approvalMode(env),
  };
}

/** Newest open CRM tasks for the snapshot (the assistant knows the to-do list). */
async function openCrmTasks(env, user) {
  if (!env.DB) return [];
  const { results } = await env.DB
    .prepare("SELECT json FROM docs WHERE col = 'tasks' LIMIT 400")
    .all();
  const rows = (results || [])
    .map((r) => { try { return JSON.parse(r.json); } catch { return null; } })
    .filter(Boolean)
    .filter((t) => !(t.completed === true || String(t.status || '').toLowerCase() === 'done' || String(t.status || '').toLowerCase() === 'completed'))
    .filter((t) => user?.role === 'superAdmin' || !user?.teamId || String(t.teamId || '') === user.teamId)
    .slice(0, 5)
    .map((t) => ({
      title: String(t.title || '').slice(0, 80),
      assignee: t.assignedToName || '',
      due: t.dueAt?.v || t.dueAt || null,
      priority: t.priority || 'medium',
    }));
  return rows;
}

/* ══ Raw contact scan (no email filter — telecalling needs phones too) */

async function scanRawContacts(env, { query = '', max = 800 } = {}) {
  if (!env.DB) return [];
  const { results } = await env.DB
    .prepare("SELECT id, json FROM docs WHERE col = 'contacts' LIMIT ?")
    .bind(max)
    .all();
  const q = String(query || '').trim().toLowerCase();
  return (results || [])
    .map((r) => { try { return { id: r.id, ...JSON.parse(r.json) }; } catch { return null; } })
    .filter(Boolean)
    .filter((c) => {
      if (!q) return true;
      const hay = `${c.name || ''} ${c.email || ''} ${c.company || ''} ${c.phone || ''}`.toLowerCase();
      return hay.includes(q);
    });
}

/* ══ Tool execution ═════════════════════════════════════════════════ */

/** Execute one tool call. Returns a JSON-serialisable result for the model. */
async function runTool(action, env, store, user, ctx = { waitUntil: () => {} }) {
  const tool = String(action?.tool || '').trim();
  const args = action?.args && typeof action.args === 'object' ? action.args : {};
  const spec = TOOLS[tool];
  if (!spec) return { ok: false, error: `unknown tool "${tool}" — pick one from the TOOLS list` };

  // Server-side role enforcement (the model was TOLD its limits; this ENFORCES them).
  if (spec.roles && !spec.roles.includes(user?.role)) {
    return { ok: false, notPermitted: true, error: `your role (${user?.role || 'unknown'}) does not allow ${tool} — a manager can do this` };
  }

  switch (tool) {
    /* ── read ── */
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

    case 'search_deals': {
      const { results } = await env.DB
        .prepare("SELECT id, json FROM docs WHERE col = 'deals' LIMIT 600")
        .all();
      const q = String(args.query || '').trim().toLowerCase();
      const stage = String(args.stage || '').trim().toLowerCase();
      const rows = (results || [])
        .map((r) => { try { return { id: r.id, ...JSON.parse(r.json) }; } catch { return null; } })
        .filter(Boolean)
        .filter((d) => {
          if (stage && String(d.stage || '').toLowerCase() !== stage) return false;
          if (!q) return true;
          const hay = `${d.title || ''} ${d.company || ''} ${d.contactName || ''}`.toLowerCase();
          return hay.includes(q);
        })
        .slice(0, Math.min(Number(args.limit) || 8, 20))
        .map((d) => ({ id: d.id, title: d.title, stage: d.stage, value: Number(d.value || 0), company: d.company || '', contact: d.contactName || '' }));
      return { ok: true, count: rows.length, deals: rows };
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

    case 'list_crm_tasks': {
      if (!env.DB) return { ok: true, tasks: [] };
      const { results } = await env.DB
        .prepare("SELECT id, json FROM docs WHERE col = 'tasks' LIMIT 400")
        .all();
      const status = String(args.status || 'open').toLowerCase();
      const rows = (results || [])
        .map((r) => { try { return { id: r.id, ...JSON.parse(r.json) }; } catch { return null; } })
        .filter(Boolean)
        .filter((t) => {
          const done = t.completed === true || ['done', 'completed'].includes(String(t.status || '').toLowerCase());
          return status === 'all' ? true : !done;
        })
        .filter((t) => user?.role === 'superAdmin' || !user?.teamId || String(t.teamId || '') === user.teamId)
        .slice(0, Math.min(Number(args.limit) || 8, 15))
        .map((t) => ({
          id: t.id, title: t.title, status: t.status || 'pending',
          priority: t.priority || 'medium', assignee: t.assignedToName || '',
          due: t.dueAt?.v || t.dueAt || null,
        }));
      return { ok: true, count: rows.length, tasks: rows };
    }

    case 'list_team': {
      const roster = await listTeam(env, user);
      return { ok: true, count: roster.length, team: roster.slice(0, 15).map((u) => ({ name: u.name, role: u.role, uid: u.uid })) };
    }

    case 'get_business_profile': {
      const profile = await getBusinessProfile(store);
      const brand = brandFor(env, profile);
      return { ok: true, profile, brand: { name: brand.name, fromName: brand.fromName, website: brand.website, ctaUrl: brand.ctaUrl, branded: brand.branded } };
    }

    /* ── write ── */
    case 'create_contact': {
      const name = String(args.name || '').trim().slice(0, 120);
      if (name.length < 2) return { ok: false, error: 'contact needs a name' };
      const email = String(args.email || '').trim().toLowerCase();
      if (email) {
        const existing = await searchContacts(env, { query: email, limit: 1 });
        if (existing.length) return { ok: false, error: `a contact with email ${email} already exists (${existing[0].name}) — no duplicate created` };
      }
      const doc = {
        name,
        ...(email ? { email } : {}),
        ...(args.phone ? { phone: String(args.phone).slice(0, 24) } : {}),
        ...(args.company ? { company: String(args.company).slice(0, 120) } : {}),
        ...(args.jobTitle ? { jobTitle: String(args.jobTitle).slice(0, 120) } : {}),
        ...(args.notes ? { notes: String(args.notes).slice(0, 1000) } : {}),
        status: 'lead',
        callStatus: 'notCalled',
        callAttempts: 0,
        activityCount: 0,
        openDealsCount: 0,
        lifetimeValue: 0,
        leadScore: 0,
        tags: [],
        segments: [],
        customFields: {},
        source: 'ai-assistant',
      };
      const res = await putDoc(env.DB, 'contacts', crypto.randomUUID(), doc, { actor: user });
      return { ok: true, contactId: res.id, name, note: `contact "${name}" created and visible in the Contacts screen` };
    }

    case 'create_task': {
      const title = String(args.title || '').trim().slice(0, 160);
      if (title.length < 3) return { ok: false, error: 'task needs a title' };
      let assignee = null;
      if (args.assigneeName) {
        const roster = await listTeam(env, user);
        assignee = matchUser(roster, args.assigneeName);
        if (!assignee) return { ok: false, error: `no teammate matching "${args.assigneeName}" — check the team roster` };
      }
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(args.due || ''))
        ? { __type: 'ts', v: `${args.due}T09:30:00.000Z` }
        : null;
      const priority = ['low', 'medium', 'high'].includes(String(args.priority)) ? String(args.priority) : 'medium';
      const doc = {
        title,
        ...(args.description ? { description: String(args.description).slice(0, 1000) } : {}),
        teamId: user?.teamId || '',
        status: 'pending',
        priority,
        kind: 'other',
        ...(assignee ? { assignedTo: assignee.uid, assignedToName: assignee.name } : {}),
        createdBy: user?.uid || 'ai-assistant',
        createdByName: user?.displayName || 'AI assistant',
        acknowledged: false,
        audienceEveryone: false,
        ...(due ? { dueAt: due } : {}),
      };
      const res = await putDoc(env.DB, 'tasks', crypto.randomUUID(), doc, { actor: user });
      return { ok: true, crmTaskId: res.id, title, note: `task "${title}" created${assignee ? ` and assigned to ${assignee.name}` : ''}${due ? ` (due ${args.due})` : ''}` };
    }

    case 'log_call': {
      const outcome = String(args.outcome || '').trim();
      if (!CALL_OUTCOMES.includes(outcome)) return { ok: false, error: `outcome must be one of: ${CALL_OUTCOMES.join('|')}` };
      const rows = await scanRawContacts(env, { query: args.contactQuery, max: 400 });
      const contact = rows[0];
      if (!contact) return { ok: false, error: `no contact matching "${args.contactQuery}"` };
      const followUpDays = Number(args.followUpInDays) > 0 ? Math.min(Number(args.followUpInDays), 90) : 0;
      const callDoc = {
        contactId: contact.id,
        callerId: user?.uid || '',
        teamId: user?.teamId || '',
        outcome,
        contactName: contact.name || '',
        callerName: user?.displayName || 'AI assistant',
        ...(args.notes ? { notes: String(args.notes).slice(0, 1000) } : {}),
        durationSeconds: 0,
        ...(followUpDays ? { followUpAt: { __type: 'ts', v: new Date(Date.now() + followUpDays * 86400000).toISOString() } } : {}),
      };
      await putDoc(env.DB, 'call_logs', crypto.randomUUID(), callDoc, { actor: user });
      await putDoc(env.DB, 'contacts', contact.id, {
        callStatus: outcome,
        callAttempts: { __type: 'inc', n: 1 },
        lastCallAt: { __type: 'ts', v: new Date().toISOString() },
        ...(followUpDays ? { followUpAt: { __type: 'ts', v: callDoc.followUpAt.v } } : {}),
      }, { merge: true, actor: user });
      return { ok: true, contact: contact.name, outcome, note: `call logged on ${contact.name} (${outcome})${followUpDays ? `, follow-up in ${followUpDays} day(s)` : ''}` };
    }

    case 'update_deal_stage': {
      const stage = String(args.stage || '').trim().toLowerCase();
      if (!DEAL_STAGES.includes(stage)) return { ok: false, error: `stage must be one of: ${DEAL_STAGES.join('|')}` };
      const { results } = await env.DB
        .prepare("SELECT id, json FROM docs WHERE col = 'deals' LIMIT 600")
        .all();
      const q = String(args.query || '').trim().toLowerCase();
      const deal = (results || [])
        .map((r) => { try { return { id: r.id, ...JSON.parse(r.json) }; } catch { return null; } })
        .filter(Boolean)
        .find((d) => q && `${d.title || ''} ${d.company || ''} ${d.contactName || ''}`.toLowerCase().includes(q));
      if (!deal) return { ok: false, error: `no deal matching "${args.query}"` };
      const merged = { ...deal, stage, ...(stage === 'won' ? { actualCloseDate: new Date().toISOString() } : {}) };
      if (!canWrite(user, 'deals', deal, merged)) return { ok: false, notPermitted: true, error: 'write denied by policy' };
      await putDoc(env.DB, 'deals', deal.id, { stage, ...(stage === 'won' ? { actualCloseDate: { __type: 'ts', v: new Date().toISOString() } } : {}) }, { merge: true, actor: user });
      return { ok: true, deal: deal.title, stage, note: `"${deal.title}" moved to ${stage}` };
    }

    case 'assign_leads':
    case 'distribute_leads': {
      const roster = await listTeam(env, user);
      const targets = tool === 'distribute_leads'
        ? (Array.isArray(args.to) ? args.to : [args.to]).map((n) => matchUser(roster, n))
        : [matchUser(roster, args.to)];
      if (targets.some((t) => !t)) {
        const bad = (Array.isArray(args.to) ? args.to : [args.to]).filter((n, i) => !targets[i]);
        return { ok: false, error: `no (unique) teammate matching: ${bad.join(', ')} — use list_team` };
      }
      const count = Math.min(Math.max(Number(args.count) || 10, 1), 200);
      const rows = await scanRawContacts(env, { query: args.query, max: 1500 });
      const pool = rows
        .filter((c) => !c.assignedTo)
        .sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))
        .slice(0, count);
      if (!pool.length) return { ok: true, assigned: 0, note: 'no unassigned leads matched — everyone already has an owner' };
      let i = 0;
      const byUser = {};
      for (const c of pool) {
        const target = targets[i % targets.length];
        i++;
        await putDoc(env.DB, 'contacts', c.id, {
          assignedTo: target.uid,
          assignedBy: user?.uid || '',
          assignedAt: { __type: 'ts', v: new Date().toISOString() },
        }, { merge: true, actor: user });
        byUser[target.name] = (byUser[target.name] || 0) + 1;
      }
      return {
        ok: true,
        assigned: pool.length,
        split: byUser,
        note: `${pool.length} lead(s) ${tool === 'distribute_leads' ? 'distributed' : 'assigned'}: ${Object.entries(byUser).map(([n, k]) => `${n} +${k}`).join(', ')}`,
      };
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

    /* ── consequential ── */
    case 'create_email_task':
      return queueEmailTask(args, env, store, user, ctx);
  }
  return { ok: false, error: 'unhandled tool' };
}

/** The ONLY consequential tool: queue a real email campaign.
 * With AGENT_APPROVAL_MODE=always it parks as a pending approval the owner
 * confirms in chat; otherwise it starts immediately (legacy behaviour). */
async function queueEmailTask(args, env, store, user, ctx) {
  const instruction = String(args.instruction || '').trim().slice(0, 4000);
  if (instruction.length < 8) {
    return { ok: false, error: 'instruction is too short — describe what email to send and to whom.' };
  }

  if (approvalMode(env) !== 'always') {
    return startEmailTask(instruction, env, store, user, ctx);
  }

  const approval = {
    id: `ap_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    tool: 'create_email_task',
    args: { instruction },
    requestedBy: user?.uid || '',
    requestedByName: user?.displayName || 'teammate',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await putApproval(store, approval);
  return {
    ok: true,
    approvalId: approval.id,
    status: 'pending_approval',
    note: `Email campaign prepared and WAITING FOR APPROVAL (${approval.id}). Tell the user to press Approve — nothing sends until they do.`,
  };
}

/** Start the real mailer pipeline for an instruction (shared by direct mode
 * and the approve route). */
async function startEmailTask(instruction, env, store, user, ctx) {
  const task = newTask(instruction, 'assistant', user?.uid || '');
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

/** One-line human-readable result summary (shown under the chat reply). */
function summarize(result) {
  if (!result || typeof result !== 'object') return '';
  if (result.error) return String(result.error).slice(0, 140);
  if (result.status === 'pending_approval') return 'awaiting your approval';
  if (result.taskId) return `email task ${result.taskId} queued`;
  if (result.contactId) return `contact created: ${result.name}`;
  if (result.crmTaskId) return result.note || 'task created';
  if (result.outcome && result.contact) return result.note || `call on ${result.contact}: ${result.outcome}`;
  if (result.stage && result.deal) return result.note || `${result.deal} → ${result.stage}`;
  if (typeof result.assigned === 'number') return `${result.assigned} lead(s) → ${Object.entries(result.split || {}).map(([n, k]) => `${n} +${k}`).join(', ') || 'nobody'}`;
  if (Array.isArray(result.contacts)) return `${result.contacts.length} contact(s) found`;
  if (Array.isArray(result.deals)) return `${result.deals.length} deal(s) found`;
  if (Array.isArray(result.team)) return `${result.team.length} teammate(s)`;
  if (Array.isArray(result.tasks) && result.tasks[0]?.instruction !== undefined) return `${result.tasks.length} email task(s)`;
  if (Array.isArray(result.tasks)) return `${result.tasks.length} task(s)`;
  if (result.crm) return 'CRM overview refreshed';
  if (result.brand) return `brand: ${result.brand.name}`;
  if (result.learned) return 'memory updated';
  if (result.saved) return `profile fields saved: ${result.saved.join(', ')}`;
  if (result.totals) return 'analytics fetched';
  if (Array.isArray(result.campaigns)) return `${result.campaigns.length} campaign(s)`;
  return 'done';
}

/* ══ The agent loop ═════════════════════════════════════════════════ */

async function runAgentLoop(env, store, user, messages, ctx) {
  const snapshot = await buildSnapshot(env, store, user);
  const mem = await getMemory(store).catch(() => null);
  const memoryBlock = memoryContext(mem);
  const episodes = await loadEpisodes(store, user?.uid);
  const episodeBlock = episodesContext(episodes);

  const convo = [
    { role: 'system', content: `${SYSTEM_PROMPT.replace('$TOOLS', toolsBlock(user?.role))}\n\nCURRENT CRM SNAPSHOT:\n${JSON.stringify(snapshot).slice(0, 6000)}${memoryBlock ? `\n\nBUSINESS MEMORY (owner-taught):\n${memoryBlock.slice(0, 1200)}` : ''}${episodeBlock ? `\n\nRECENT CONVERSATIONS WITH THIS USER (oldest first):\n${episodeBlock.slice(0, 1200)}` : ''}` },
    ...messages,
  ];

  const actions = [];
  const approvals = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const out = await sarvamChat(env, convo, { json: true, temperature: 0.35, maxTokens: 2200 });
    if (out.action && out.action.tool) {
      const tool = String(out.action.tool);
      const t0 = Date.now();
      const result = await runTool(out.action, env, store, user, ctx);
      await auditTool(store, {
        at: new Date().toISOString(),
        uid: user?.uid || '',
        tool,
        ok: !!result.ok,
        ms: Date.now() - t0,
        digest: summarize(result).slice(0, 140),
      });
      actions.push({ tool, ok: !!result.ok, summary: summarize(result) });
      if (result.approvalId) {
        approvals.push({ id: result.approvalId, tool, summary: summarize(result) });
      }
      convo.push({ role: 'user', content: `TOOL_RESULT (${tool}) #${step + 1}: ${JSON.stringify(result).slice(0, 3000)}\n\nContinue: reply to the user now, or chain ONE more tool if strictly necessary.` });
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
  return { reply, actions, approvals };
}

/* ══ Route handlers ═════════════════════════════════════════════════ */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

/** POST /v1/assistant handler (auth already verified by index.js). */
export async function handleAssistant(request, env, { uid, ctx = { waitUntil: () => {} } }) {
  try {
    if (!env.SARVAM_API_KEY) {
      return jsonResponse({ error: 'AI is not configured on the server.' }, 503);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400);
    }
    const incoming = Array.isArray(body?.messages) ? body.messages : [];
    const messages = incoming
      .filter((m) => m && typeof m.content === 'string' && ['user', 'assistant'].includes(m.role))
      .slice(-12)
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
    if (!messages.length) {
      return jsonResponse({ error: 'messages:[{role,content}] is required' }, 400);
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
    const user = env.DB ? await loadUser(env.DB, uid).catch(() => null) : null;
    const { reply, actions, approvals } = await runAgentLoop(env, store, user, messages, ctx);
    await saveEpisode(store, uid, { q: messages[messages.length - 1].content, reply, tools: actions.map((a) => a.tool) });

    return jsonResponse({ ok: true, reply, actions, ...(approvals.length ? { approvals } : {}) });
  } catch (e) {
    console.error('[assistant] failed:', e?.stack || e);
    return jsonResponse({ error: `assistant error: ${e?.message || e}` }, 500);
  }
}

/** POST /v1/assistant/approve {id, decision:'approved'|'rejected'} —
 * the human half of the HITL gate. The requester or a manager decides;
 * approving executes the stored consequential action for real. */
export async function handleAssistantApproval(request, env, { uid, ctx = { waitUntil: () => {} } }) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON body' }, 400);
    }
    const id = String(body?.id || '').trim();
    const decision = String(body?.decision || '').toLowerCase();
    if (!id) return jsonResponse({ error: 'id is required' }, 400);
    if (!['approved', 'rejected'].includes(decision)) {
      return jsonResponse({ error: "decision must be 'approved' or 'rejected'" }, 400);
    }

    const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
    const approval = await getApproval(store, id);
    if (!approval) return jsonResponse({ error: 'approval not found or expired' }, 404);
    if (approval.status !== 'pending') {
      return jsonResponse({ error: `already ${approval.status}` }, 409);
    }

    const user = env.DB ? await loadUser(env.DB, uid).catch(() => null) : null;
    const isRequester = approval.requestedBy === uid;
    if (!isRequester && !isManagerUp(user)) {
      return jsonResponse({ error: 'only the requester or a manager can decide this' }, 403);
    }

    if (decision === 'rejected') {
      approval.status = 'rejected';
      approval.decidedAt = new Date().toISOString();
      approval.decidedBy = uid;
      await putApproval(store, approval);
      await auditTool(store, { at: new Date().toISOString(), uid, tool: approval.tool, ok: true, ms: 0, digest: `approval ${id} rejected` });
      return jsonResponse({ ok: true, status: 'rejected', reply: 'Declined — nothing was sent.' });
    }

    // Execute the stored action with the ORIGINAL requester's identity.
    const requester = approval.requestedBy === user?.uid
      ? user
      : (env.DB ? await loadUser(env.DB, approval.requestedBy).catch(() => null) : null) || user;
    const result = await startEmailTask(approval.args.instruction, env, store, requester, ctx);
    approval.status = 'approved';
    approval.decidedAt = new Date().toISOString();
    approval.decidedBy = uid;
    approval.taskId = result.taskId || null;
    await putApproval(store, approval);
    await auditTool(store, { at: new Date().toISOString(), uid, tool: approval.tool, ok: !!result.ok, ms: 0, digest: `approval ${id} approved → ${result.taskId || 'failed'}` });
    return jsonResponse({ ok: !!result.ok, status: 'approved', taskId: result.taskId || null, reply: result.note || 'Approved and queued.' });
  } catch (e) {
    console.error('[assistant:approve] failed:', e?.stack || e);
    return jsonResponse({ error: `approval error: ${e?.message || e}` }, 500);
  }
}
