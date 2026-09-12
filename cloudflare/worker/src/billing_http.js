/**
 * BILLING — REST surface for the multi-user subscription system (v12).
 *
 *   GET  /v1/billing/plans             → the plan catalog (public shape)
 *   GET  /v1/billing/usage             → this user's plan + usage snapshot
 *   POST /v1/billing/checkout          → {plan} creates a pending order
 *   GET  /v1/billing/orders            → this user's order history
 *   POST /v1/billing/grant             → {uid, plan, days?} OWNER-ONLY:
 *                                        activates/renews a subscription
 *                                        (manual UPI today; a PSP webhook
 *                                        can call the same function later)
 *
 * Auth: Firebase bearer (verified by index.js before we are called).
 */

import { createStore, stateBackendName } from './emailer/state.js';
import { loadUser } from './data.js';
import { PLANS, planIds, billingSnapshot, createOrder, listOrders, setPlan, clearPlan, planFor } from './emailer/plans.js';

const OWNER_ROLES = ['superAdmin', 'admin'];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function handleBillingRequest(request, env, { url, path, uid }) {
  try {
    return await billingInner(request, env, { url, path, uid });
  } catch (e) {
    console.error(`[billing] unhandled error on ${path}:`, e?.stack || e);
    return json({ error: `billing error: ${e?.message || e}` }, 500);
  }
}

async function billingInner(request, env, { url, path, uid }) {
  const store = stateBackendName(env) !== 'none' ? createStore(env) : null;
  if (!store) return json({ error: 'no state backend configured' }, 503);
  const user = env.DB ? await loadUser(env.DB, uid).catch(() => null) : null;
  const role = user?.role || 'viewer';

  /* ── plans catalog ── */
  if (request.method === 'GET' && path === '/v1/billing/plans') {
    return json({
      ok: true,
      plans: Object.values(PLANS).map((p) => ({
        id: p.id, name: p.name, price_inr: p.price_inr, tagline: p.tagline,
        perks: p.perks, limits: p.limits,
      })),
    });
  }

  /* ── my plan + usage ── */
  if (request.method === 'GET' && path === '/v1/billing/usage') {
    return json(await billingSnapshot(store, uid));
  }

  /* ── checkout (create a pending order; activation by the owner) ── */
  if (request.method === 'POST' && path === '/v1/billing/checkout') {
    const args = await body(request);
    const planId = String(args?.plan || '').trim();
    if (!planIds().includes(planId)) return json({ ok: false, error: `unknown plan "${planId}" — one of: ${planIds().join(', ')}` }, 400);
    const r = await createOrder(store, uid, planId);
    return json(r, r.ok ? 200 : 400);
  }

  /* ── my orders ── */
  if (request.method === 'GET' && path === '/v1/billing/orders') {
    return json({ ok: true, orders: await listOrders(store, uid) });
  }

  /* ── owner: grant / renew / clear a subscription ── */
  if (request.method === 'POST' && path === '/v1/billing/grant') {
    if (!OWNER_ROLES.includes(role)) return json({ ok: false, error: `your role (${role}) cannot grant subscriptions` }, 403);
    const args = await body(request);
    const targetUid = String(args?.uid || '').trim();
    if (!targetUid) return json({ ok: false, error: 'uid is required' }, 400);
    const action = String(args?.action || 'grant');
    if (action === 'clear') {
      const r = await clearPlan(store, targetUid);
      return json({ ...r, note: 'subscription cleared — the account rides Free' });
    }
    const planId = String(args?.plan || '').trim();
    if (!planIds().includes(planId)) return json({ ok: false, error: `unknown plan "${planId}"` }, 400);
    const days = Math.max(1, Math.min(Number(args?.days) || 30, 3650));
    const r = await setPlan(store, targetUid, planId, { days, actor: uid, note: args?.note || '' });
    return json({ ...r, plan: PLANS[planId], days });
  }

  /* ── who am I on (convenience for gates) ── */
  if (request.method === 'GET' && path === '/v1/billing/plan') {
    return json({ ok: true, ...(await planFor(store, uid)) });
  }

  return json({ error: `unknown billing route: ${path}` }, 404);
}
