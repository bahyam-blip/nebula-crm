/**
 * Nebula STUDIO — REST surface for the app's build → preview → publish
 * experience (Agent v4 hosting fabric).
 *
 * The assistant chat and MCP expose the same powers as tools; this module
 * gives the Studio UI purpose-built endpoints:
 *
 *   POST   /v1/studio/build           {title, kind, brief, style?, cta_text?, cta_url?}
 *   GET    /v1/studio/sites           → artifacts (sites first) + per-site deployments
 *   GET    /v1/studio/connectors      → platform registry + connected state
 *   POST   /v1/studio/connect         {connector, ...credentials, label?}
 *   DELETE /v1/studio/connect         ?connector=<id>
 *   POST   /v1/studio/publish         {artifact_id, connector, repo?, domain?, site_id?}
 *   POST   /v1/studio/point-domain    {connector: godaddy|hostinger, domain, name?, target}
 *   GET    /v1/studio/deployments     ?artifact_id=<id>
 *
 * Auth: Firebase bearer (verified by index.js before we are called).
 * Role gates mirror the tool registry: building = WRITE_ROLES, platform
 * connect/publish/domain = MANAGER_ROLES.
 */

import { createStore, stateBackendName } from './emailer/state.js';
import { loadUser } from './data.js';
import { buildWebsite, refineSite, listArtifacts } from './emailer/builder.js';
import {
  connectPlatform,
  connectorStatus,
  disconnectPlatform,
  listPlatformDomains,
  listDeployments,
  pointDomain,
  publishSite,
} from './emailer/publish.js';

const WRITE_ROLES = ['superAdmin', 'admin', 'manager', 'salesRep', 'telecaller', 'supportAgent'];
const MANAGER_ROLES = ['superAdmin', 'admin', 'manager'];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function handleStudioRequest(request, env, { url, path, uid, ctx }) {
  try {
    return await handleStudioInner(request, env, { url, path, uid, ctx });
  } catch (e) {
    console.error(`[studio] unhandled error on ${path}:`, e?.stack || e);
    return json({ error: `studio error: ${e?.message || e}` }, 500);
  }
}

async function handleStudioInner(request, env, { url, path, uid, ctx }) {
  const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
  if (!store) return json({ error: 'no state backend configured' }, 503);

  const user = env.DB ? await loadUser(env.DB, uid).catch(() => null) : null;
  const role = user?.role || 'viewer';
  const origin = url.origin;

  /* ── build (any teammate who may write) ── */
  if (request.method === 'POST' && path === '/v1/studio/build') {
    if (!WRITE_ROLES.includes(role)) return json({ error: `your role (${role}) cannot build sites` }, 403);
    const args = await body(request);
    const result = await buildWebsite(env, store, user, args, origin);
    return json(result, result.ok ? 200 : 400);
  }

  /* ── refine an existing build (any teammate who may write) ── */
  if (request.method === 'POST' && path === '/v1/studio/refine') {
    if (!WRITE_ROLES.includes(role)) return json({ error: `your role (${role}) cannot refine sites` }, 403);
    const args = await body(request);
    const result = await refineSite(env, store, user, args, origin);
    return json(result, result.ok ? 200 : 400);
  }

  /* ── my sites + deployments ── */
  if (request.method === 'GET' && path === '/v1/studio/sites') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 40);
    const artifacts = await listArtifacts(store, uid, limit);
    const withDeploys = await Promise.all(
      artifacts.map(async (a) => ({
        ...a,
        deployments: a.kind === 'note' ? [] : await listDeployments(store, uid, a.id),
      }))
    );
    return json({ ok: true, sites: withDeploys });
  }

  /* ── platform registry + status ── */
  if (request.method === 'GET' && path === '/v1/studio/connectors') {
    return json(await connectorStatus(env, store, user));
  }

  /* ── connect / disconnect (manager+) ── */
  if (request.method === 'POST' && path === '/v1/studio/connect') {
    if (!MANAGER_ROLES.includes(role)) return json({ error: `your role (${role}) cannot connect hosting platforms — a manager can` }, 403);
    const args = await body(request);
    const result = await connectPlatform(env, store, user, args);
    return json(result, result.ok ? 200 : 400);
  }

  if (request.method === 'DELETE' && path === '/v1/studio/connect') {
    if (!MANAGER_ROLES.includes(role)) return json({ error: `your role (${role}) cannot disconnect hosting platforms` }, 403);
    const result = await disconnectPlatform(env, store, user, { connector: url.searchParams.get('connector') });
    return json(result, result.ok ? 200 : 400);
  }

  /* ── publish (manager+) ── */
  if (request.method === 'POST' && path === '/v1/studio/publish') {
    if (!MANAGER_ROLES.includes(role)) return json({ error: `your role (${role}) cannot publish to hosting platforms — a manager can` }, 403);
    const args = await body(request);
    const result = await publishSite(env, store, user, args);
    return json(result, result.ok ? 200 : 400);
  }

  /* ── point a registrar domain at a deployed host (manager+) ── */
  if (request.method === 'POST' && path === '/v1/studio/point-domain') {
    if (!MANAGER_ROLES.includes(role)) return json({ error: `your role (${role}) cannot edit DNS` }, 403);
    const args = await body(request);
    const result = await pointDomain(env, store, user, args);
    return json(result, result.ok ? 200 : 400);
  }

  /* ── deployment history ── */
  if (request.method === 'GET' && path === '/v1/studio/deployments') {
    const artifactId = String(url.searchParams.get('artifact_id') || '').trim();
    if (!artifactId) return json({ error: 'artifact_id is required' }, 400);
    return json({ ok: true, deployments: await listDeployments(store, uid, artifactId) });
  }

  return json({ error: `unknown studio route: ${path}` }, 404);
}
