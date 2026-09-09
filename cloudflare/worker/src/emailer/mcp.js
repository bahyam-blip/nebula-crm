/**
 * MCP server for Nebula CRM — Model Context Protocol over Streamable HTTP.
 *
 * This is the "host them directly from the app" story: the CRM's ENTIRE
 * agent tool registry (23 tools — CRM reads/writes, email engine, the
 * website builder, live-web research) is exposed as MCP tools at:
 *
 *     POST /mcp      (JSON-RPC 2.0: initialize, tools/list, tools/call…)
 *     GET  /mcp      (human-readable capability advert)
 *
 * AUTH — no static API tokens, by design:
 *   • Inside the app, the agent uses the caller's own Firebase ID token.
 *   • External MCP clients (Claude Desktop, Cursor, any MCP host) use a
 *     SHORT-LIVED PAIRING GRANT the owner mints in the app:
 *       POST /v1/assistant/mcp/pair   → {url, token, expires_at}
 *       GET  /v1/assistant/mcp/pair   → list active grants
 *       DEL  /v1/assistant/mcp/pair   → revoke (one or all)
 *     A grant is a random 192-bit secret stored with a 24h TTL, bound to
 *     the owner's uid. It can be revoked at any moment; nothing long-lived
 *     ever exists to leak.
 *
 * Whatever the credential, tool calls run under the resolved user's ID
 * with the SAME server-side role enforcement the in-app agent has — MCP
 * confers no privilege escalation, and consequential tools still hit the
 * HITL approval gate.
 */

import { verifyIdToken } from '../auth.js';
import { createStore, stateBackendName, safeParse } from './state.js';
import { loadUser } from '../data.js';
import { TOOLS, runTool } from './assistant.js';

export { serveAgentSite } from './builder.js';

const GRANT_TTL_SECONDS = 60 * 60 * 24; // pairing grants live 24h
const GRANT_PREFIX = 'agent:mcp:grant:';
const MCP_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
const SERVER_VERSION = '3.0.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Mcp-Session-Id,MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders },
  });
}

function rpcResult(id, result) {
  return json({ jsonrpc: '2.0', id, result });
}

function rpcError(id, code, message, status = 200) {
  return json({ jsonrpc: '2.0', id, error: { code, message } }, status);
}

const ERR = {
  PARSE: -32700,
  METHOD: -32601,
  PARAMS: -32602,
  AUTH: -32001,
};

/* ══ JSON-Schema per tool (what MCP clients show their model) ═══════ */

const STR = { type: 'string' };
const NUM = { type: 'number' };
const ARR_STR = { type: 'array', items: { type: 'string' } };
const OBJ = { type: 'object' };

export const TOOL_SCHEMAS = {
  crm_overview: { type: 'object', properties: {} },
  search_contacts: { type: 'object', properties: { query: { ...STR, description: 'name / email / company text' }, segment: STR, limit: NUM }, required: ['query'] },
  search_deals: { type: 'object', properties: { query: STR, stage: { ...STR, description: 'lead|qualified|proposal|negotiation|won|lost' }, limit: NUM } },
  recent_campaigns: { type: 'object', properties: { limit: NUM } },
  email_analytics: { type: 'object', properties: {} },
  list_tasks: { type: 'object', properties: { limit: NUM } },
  list_crm_tasks: { type: 'object', properties: { status: { ...STR, description: 'open|all' }, limit: NUM } },
  list_team: { type: 'object', properties: {} },
  get_business_profile: { type: 'object', properties: {} },
  list_artifacts: { type: 'object', properties: { limit: NUM } },
  web_search: { type: 'object', properties: { query: { ...STR, description: 'what to search the public web for' } }, required: ['query'] },
  web_fetch: { type: 'object', properties: { url: { ...STR, description: 'full https:// URL of a public page' } }, required: ['url'] },
  create_contact: { type: 'object', properties: { name: STR, email: STR, phone: STR, company: STR, jobTitle: STR, notes: STR }, required: ['name'] },
  create_task: { type: 'object', properties: { title: STR, description: STR, assigneeName: STR, due: { ...STR, description: 'YYYY-MM-DD' }, priority: STR, contactName: STR }, required: ['title'] },
  log_call: { type: 'object', properties: { contactQuery: STR, outcome: { ...STR, description: 'connected|callback|interested|notInterested|wrongNumber|doNotCall|converted|attempted' }, notes: STR, followUpInDays: NUM }, required: ['contactQuery', 'outcome'] },
  update_deal_stage: { type: 'object', properties: { query: STR, stage: { ...STR, description: 'lead|qualified|proposal|negotiation|won|lost' } }, required: ['query', 'stage'] },
  assign_leads: { type: 'object', properties: { to: STR, count: NUM, query: STR }, required: ['to'] },
  distribute_leads: { type: 'object', properties: { to: ARR_STR, count: NUM, query: STR }, required: ['to'] },
  save_business_profile: { type: 'object', properties: { patch: OBJ }, required: ['patch'] },
  teach_memory: { type: 'object', properties: { note: { ...STR, description: 'a lasting fact or preference about the business' } }, required: ['note'] },
  build_website: { type: 'object', properties: { title: STR, kind: { ...STR, description: 'landing|promo|event|portfolio|webapp|report' }, brief: { ...STR, description: 'what the site is for, audience, key message, sections' }, style: STR, cta_text: STR, cta_url: STR }, required: ['title', 'brief'] },
  save_note: { type: 'object', properties: { title: STR, content: { ...STR, description: 'the note / research summary / report (markdown-ish text)' } }, required: ['title', 'content'] },
  create_email_task: { type: 'object', properties: { instruction: { ...STR, description: 'campaign instruction written like the owner would brief a marketer, incl. recipients' } }, required: ['instruction'] },
};

/** Model-facing one-liners for MCP clients (mirrors the agent prompt). */
const MCP_DESCRIPTIONS = {
  crm_overview: 'Fresh CRM counts: contacts, open deals, pipeline value, tasks',
  search_contacts: 'Find people in the CRM by name/email/company',
  search_deals: 'Find deals by title/company/contact and stage, with values',
  recent_campaigns: 'Last AI email campaigns with delivery/open numbers',
  email_analytics: 'Email totals: recipients, delivered, opened, clicked, unsubscribed + recommendations',
  list_tasks: 'AI email campaign tasks with progress',
  list_crm_tasks: "The team's CRM tasks/reminders (title, assignee, due, priority)",
  list_team: 'Team roster: names, roles, uids (needed before assigning anything)',
  get_business_profile: 'The brand the emails and sites go out with',
  list_artifacts: 'Websites, notes and reports this agent has built',
  web_search: 'Search the public web for current information (titles, urls, snippets)',
  web_fetch: 'Read one public web page and return its text (for research)',
  create_contact: 'Add a new contact to the CRM',
  create_task: 'Create a task/reminder with optional assignee, due date, priority',
  log_call: 'Record a call on a contact with outcome + optional follow-up',
  update_deal_stage: 'Move a deal to another pipeline stage',
  assign_leads: 'Give N unassigned leads to one named teammate',
  distribute_leads: 'Share leads evenly (round robin) across named teammates',
  save_business_profile: 'Update brand fields (name, tagline, industry, tone, colors…)',
  teach_memory: 'Remember a lasting fact or preference about the business',
  build_website: 'BUILD AND HOST a complete website or mini web app from a brief — returns a public URL. Kinds: landing, promo, event, portfolio, webapp, report',
  save_note: 'Save a note / research summary / report as a shareable artifact',
  create_email_task: 'QUEUE A REAL EMAIL CAMPAIGN (planning, on-brand copy, delivery, tracking). May wait for the owner in-app approval',
};

/* ══ Pairing grants ═════════════════════════════════════════════════ */

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // The mcp_ prefix is how resolveCaller tells grants apart from Firebase
  // tokens without a store round-trip on every request.
  return 'mcp_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getGrant(store, token) {
  if (!store || !token) return null;
  const raw = await store.get(GRANT_PREFIX + token);
  const g = safeParse(raw, null);
  if (!g || !g.uid) return null;
  if (g.expiresAt && Date.parse(g.expiresAt) < Date.now()) return null;
  return g;
}

/** Active grants for a uid (D1 backend can enumerate; KV cannot). */
async function listGrants(env, uid) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare("SELECT id, json FROM docs WHERE col = 'mail_state' AND id LIKE ?")
      .bind(`${GRANT_PREFIX}%`)
      .all();
    const now = Date.now();
    return (results || [])
      .map((r) => {
        try {
          const g = JSON.parse(JSON.parse(r.json)?.value || r.json);
          return g && g.uid === uid
            ? { grant_id: r.id.slice(GRANT_PREFIX.length), label: g.label || '', createdAt: g.createdAt, expiresAt: g.expiresAt }
            : null;
        } catch { return null; }
      })
      .filter(Boolean)
      .filter((g) => !g.expiresAt || Date.parse(g.expiresAt) > now);
  } catch {
    return [];
  }
}

/**
 * POST/GET/DELETE /v1/assistant/mcp/pair — the in-app pairing surface
 * (Firebase auth already verified by index.js).
 */
export async function handleMcpPair(request, env, { uid }) {
  try {
    const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
    if (!store) return json({ error: 'no state backend configured' }, 503);

    if (request.method === 'POST') {
      let body = {};
      try { body = await request.json(); } catch { /* empty body ok */ }
      const label = String(body?.label || '').trim().slice(0, 80) || 'AI connection';
      const token = randomToken();
      const expiresAt = new Date(Date.now() + GRANT_TTL_SECONDS * 1000).toISOString();
      await store.put(
        GRANT_PREFIX + token,
        JSON.stringify({ uid, label, createdAt: new Date().toISOString(), expiresAt }),
        { expirationTtl: GRANT_TTL_SECONDS }
      );
      const origin = new URL(request.url).origin;
      return json({
        ok: true,
        url: `${origin}/mcp`,
        token,
        grant_id: token,
        label,
        expires_at: expiresAt,
        header: { Authorization: `Bearer ${token}` },
        instructions:
          'Add an MCP server in your AI client with this URL. For the Authorization header use: Bearer <token>. The grant expires in 24h and can be revoked from the app at any time. All tools run with YOUR CRM role and permissions.',
      });
    }

    if (request.method === 'GET') {
      const grants = await listGrants(env, uid);
      return json({ ok: true, grants });
    }

    if (request.method === 'DELETE') {
      let body = {};
      try { body = await request.json(); } catch { /* body optional */ }
      if (body?.all) {
        const grants = await listGrants(env, uid);
        for (const g of grants) await store.delete(GRANT_PREFIX + g.grant_id);
        return json({ ok: true, revoked: grants.length });
      }
      const id = String(body?.grant_id || '').trim();
      if (!id) return json({ error: 'grant_id (or all:true) is required' }, 400);
      const g = await getGrant(store, id);
      if (!g || g.uid !== uid) return json({ error: 'grant not found' }, 404);
      await store.delete(GRANT_PREFIX + id);
      return json({ ok: true, revoked: 1 });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error('[mcp:pair] failed:', e?.stack || e);
    return json({ error: `pairing error: ${e?.message || e}` }, 500);
  }
}

/* ══ MCP endpoint ═══════════════════════════════════════════════════ */

/** Resolve the caller: pairing grant first, then Firebase ID token. */
async function resolveCaller(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!bearer) return null;

  const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
  if (store && bearer.startsWith('mcp_')) {
    const grant = await getGrant(store, bearer);
    if (grant) return { uid: grant.uid, via: 'grant', label: grant.label };
  }
  const claims = await verifyIdToken(bearer, env.FIREBASE_PROJECT_ID);
  if (claims) return { uid: claims.sub, via: 'firebase' };
  return null;
}

/** GET /mcp — public capability advert (no secrets, no data). */
export function mcpServerInfo(request, _env) {
  const origin = new URL(request.url).origin;
  return json({
    server: 'nebula-crm-mcp',
    title: 'Nebula CRM Agent',
    version: SERVER_VERSION,
    protocol: 'MCP (Model Context Protocol) over Streamable HTTP',
    endpoint: `${origin}/mcp`,
    transport: 'JSON-RPC 2.0 (initialize, tools/list, tools/call, ping)',
    tools: Object.keys(TOOLS).length,
    capabilities: [
      'live CRM reads/writes (role-enforced)',
      'AI email campaign engine with HITL approval',
      'website & mini web-app builder with public hosting (/sites/<id>)',
      'live-web research (search + fetch)',
      'business memory',
    ],
    auth: {
      mode: 'short-lived pairing grants (no static API tokens)',
      how: 'open the Nebula CRM app → Assistant → Connect an AI → create a 24h revocable grant, then point any MCP client at this endpoint',
    },
  });
}

/** POST /mcp — the JSON-RPC surface. */
export async function handleMcp(request, env, ctx = { waitUntil: () => {} }) {
  let rpc;
  try {
    rpc = await request.json();
  } catch {
    return rpcError(null, ERR.PARSE, 'invalid JSON body', 400);
  }
  const id = rpc?.id ?? null;
  const method = String(rpc?.method || '');

  // Notifications carry no id and expect no response body.
  if (method.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: CORS });
  }

  const caller = await resolveCaller(request, env);
  if (!caller) {
    return rpcError(id, ERR.AUTH, 'unauthorized — send a pairing grant or Firebase ID token as Bearer <token> (mint one in the app: Assistant → Connect an AI)', 401);
  }

  const user = env.DB ? await loadUser(env.DB, caller.uid).catch(() => null) : null;
  const role = user?.role || null;

  switch (method) {
    case 'initialize': {
      const requested = String(rpc?.params?.protocolVersion || '');
      const version = MCP_VERSIONS.includes(requested) ? requested : '2025-03-26';
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'nebula-crm-mcp', title: 'Nebula CRM Agent', version: SERVER_VERSION },
        instructions:
          'Tools run against the live CRM with YOUR permissions and role. ' +
          'Consequential actions (mass email) may return a pending approval that is confirmed in the app. ' +
          'build_website returns a public URL on this server.',
      });
    }

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list': {
      const tools = Object.entries(TOOLS)
        .filter(([, spec]) => !spec.roles || (role && spec.roles.includes(role)))
        .map(([name, spec]) => ({
          name,
          description: `${MCP_DESCRIPTIONS[name] || spec.spec}${spec.tier === 'consequential' ? ' (may require in-app owner approval)' : ''}`,
          inputSchema: TOOL_SCHEMAS[name] || { type: 'object', properties: {} },
        }));
      return rpcResult(id, { tools });
    }

    case 'tools/call': {
      const name = String(rpc?.params?.name || '');
      const args = rpc?.params?.arguments && typeof rpc.params.arguments === 'object' ? rpc.params.arguments : {};
      const spec = TOOLS[name];
      if (!spec || !TOOL_SCHEMAS[name]) {
        return rpcError(id, ERR.PARAMS, `unknown tool "${name}" — use tools/list`, 200);
      }
      const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
      const origin = new URL(request.url).origin;
      const result = await runTool({ tool: name, args }, env, store, user, { waitUntil: ctx.waitUntil, origin });
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result).slice(0, 20000) }],
        isError: result?.ok === false,
      });
    }

    default:
      return rpcError(id, ERR.METHOD, `method "${method}" is not supported (initialize, tools/list, tools/call, ping)`);
  }
}
