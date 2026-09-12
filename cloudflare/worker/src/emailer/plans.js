/**
 * PLANS — the multi-user subscription engine (Agent v12).
 *
 * The owner's directive: "plan it for multi-user account project because
 * I want to sell this for subscription so that they can build the
 * websites and apps."
 *
 * The Worker is already per-user (every artifact list, skill library and
 * run doc is keyed by the Firebase uid), so multi-tenancy foundations
 * exist. This module adds the COMMERCIAL layer on top:
 *
 *   • PLAN CATALOG  — free / pro / studio with real monthly limits.
 *   • QUOTA LEDGER  — per-user, per-month usage counters in the state
 *     store (KV or Firestore — the same backend every other module uses).
 *   • ENFORCEMENT   — build_website / refine_site check quota BEFORE the
 *     team runs (never burn compute for an over-quota user) and consume
 *     AFTER success (failed builds are free).
 *   • SUBSCRIPTIONS — expiry-dated grants (default 30 days), an owner
 *     activation route (manual UPI/bank today, Razorpay/Stripe later —
 *     the schema is payment-provider agnostic), and pending orders so
 *     the app can offer "upgrade" without a payment SDK yet.
 *
 * Keys (all in the shared state store):
 *   billing:plan:<uid>          → {plan, since, until, status, actor}
 *   billing:usage:<uid>:<Y-M>   → {builds, refines, notes, at}
 *   billing:orders:<uid>        → [{id, plan, at, status, note}]
 */

const PLAN_KEY = (uid) => `billing:plan:${uid || ''}`;
const USAGE_KEY = (uid, ym) => `billing:usage:${uid || ''}:${ym}`;
const ORDERS_KEY = (uid) => `billing:orders:${uid || ''}`;

/* ══ The catalog ═════════════════════════════════════════════════════ */

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price_inr: 0,
    tagline: 'Everything the team can do — sized to try.',
    limits: {
      builds_per_month: 3,
      refines_per_month: 10,
      sites_total: 10,
      hosting_connectors: 1,
      custom_domains: 0,
      team_seats: 1,
    },
    perks: [
      '3 site/app builds every month',
      'The full 13-agent team on every build',
      'Free nebula hosting link for every build',
      '1 hosting connector (GitHub, Vercel or Firebase)',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price_inr: 499,
    tagline: 'For businesses that ship every week.',
    limits: {
      builds_per_month: 50,
      refines_per_month: 150,
      sites_total: 200,
      hosting_connectors: 4,
      custom_domains: 2,
      team_seats: 3,
    },
    perks: [
      '50 builds every month',
      'Priority team (shorter queue, deeper research)',
      '4 hosting connectors + 2 custom domains',
      '3 team seats',
    ],
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    price_inr: 1999,
    tagline: 'Agencies building for many clients.',
    limits: {
      builds_per_month: 500,
      refines_per_month: 2000,
      sites_total: 2000,
      hosting_connectors: 10,
      custom_domains: 25,
      team_seats: 15,
    },
    perks: [
      '500 builds every month',
      'White-glove: every connector + 25 domains',
      '15 team seats — the whole studio builds',
      'Early access to every new agent capability',
    ],
  },
};

export const DEFAULT_PLAN = 'free';

export function planIds() {
  return Object.keys(PLANS);
}

/** 30-day default grant; `days` may shorten/lengthen it. */
function expiry(days) {
  const d = new Date(Date.now() + Math.max(1, Number(days) || 30) * 86400000);
  return d.toISOString();
}

function monthKey(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

/* ══ Subscription state ══════════════════════════════════════════════ */

/**
 * The user's ACTIVE plan. A stored grant wins while unexpired; after
 * expiry (or absence) the user rides the Free plan. Never throws.
 */
export async function planFor(store, uid) {
  const fallback = { plan: DEFAULT_PLAN, status: 'active', until: null, since: null };
  if (!store || !uid) return fallback;
  try {
    const rec = safeParse(await store.get(PLAN_KEY(uid)));
    if (!rec || !PLANS[rec.plan]) return fallback;
    if (rec.until && new Date(rec.until).getTime() < Date.now()) {
      return { ...fallback, status: 'expired', expired: rec };
    }
    return { ...rec, status: 'active' };
  } catch {
    return fallback;
  }
}

/**
 * Activate (or renew) a subscription. `actor` is recorded for the audit
 * trail. Returns the stored grant.
 */
export async function setPlan(store, uid, planId, { days = 30, actor = 'system', note = '' } = {}) {
  if (!store || !uid) return { ok: false, error: 'no store' };
  if (!PLANS[planId]) return { ok: false, error: `unknown plan "${planId}"` };
  const grant = {
    plan: planId,
    since: new Date().toISOString(),
    until: expiry(days),
    status: 'active',
    actor: String(actor).slice(0, 60),
    note: String(note).slice(0, 200),
  };
  await store.put(PLAN_KEY(uid), JSON.stringify(grant));
  return { ok: true, grant };
}

/** Owner override — back to Free immediately (e.g. a refund). */
export async function clearPlan(store, uid) {
  if (!store || !uid) return { ok: false };
  await store.put(PLAN_KEY(uid), JSON.stringify({ plan: DEFAULT_PLAN, since: new Date().toISOString(), until: null, status: 'active', actor: 'system', note: 'cleared' }));
  return { ok: true };
}

/* ══ Usage ledger ════════════════════════════════════════════════════ */

export async function usageFor(store, uid, ym = monthKey()) {
  const empty = { ym, builds: 0, refines: 0, at: null };
  if (!store || !uid) return empty;
  const rec = safeParse(await store.get(USAGE_KEY(uid, ym)));
  if (!rec || typeof rec !== 'object') return empty;
  return {
    ym,
    builds: Math.max(0, Number(rec.builds) || 0),
    refines: Math.max(0, Number(rec.refines) || 0),
    at: rec.at || null,
  };
}

async function bumpUsage(store, uid, field, ym = monthKey()) {
  if (!store || !uid) return;
  try {
    const cur = await usageFor(store, uid, ym);
    cur[field] = (cur[field] || 0) + 1;
    cur.at = new Date().toISOString();
    await store.put(USAGE_KEY(uid, ym), JSON.stringify(cur));
  } catch { /* metering must never fail a build */ }
}

/* ══ Quota — check BEFORE work, consume AFTER success ════════════════ */

/**
 * checkQuota — the gate the build/refine paths call first.
 * @param kind 'build' | 'refine'
 * @param role the caller's CRM role — the OWNER'S INTERNAL TEAM
 *        (superAdmin/admin/manager/…) is exempt: they ARE the business
 *        selling the subscriptions, and must never be quota-blocked.
 *        Paying subscribers sign in on the default roles → metered.
 * @returns {ok, error?, plan, limits, usage, upgradeRequired?}
 */
export const INTERNAL_ROLES = ['superAdmin', 'admin', 'manager', 'salesRep', 'telecaller', 'supportAgent'];

export async function checkQuota(store, uid, kind = 'build', role = '') {
  const grant = await planFor(store, uid);
  const plan = PLANS[grant.plan] || PLANS[DEFAULT_PLAN];
  const usage = await usageFor(store, uid);
  const limits = plan.limits;

  if (INTERNAL_ROLES.includes(String(role || ''))) {
    return { ok: true, plan, limits, usage, grant, exempt: true };
  }

  if (grant.status === 'expired') {
    return {
      ok: false,
      upgradeRequired: true,
      plan, usage, grant,
      error: `Your ${grant.expired?.plan || 'paid'} plan expired on ${String(grant.expired?.until || '').slice(0, 10)}. Renew to keep building, or continue on the Free plan (${limits.builds_per_month} builds/month).`,
    };
  }

  if (kind === 'build' && usage.builds >= limits.builds_per_month) {
    return {
      ok: false,
      upgradeRequired: true,
      plan, usage,
      error: `You have used all ${limits.builds_per_month} builds on the ${plan.name} plan this month. Upgrade for more — every build runs the full agent team.`,
    };
  }
  if (kind === 'refine' && usage.refines >= limits.refines_per_month) {
    return {
      ok: false,
      upgradeRequired: true,
      plan, usage,
      error: `You have used all ${limits.refines_per_month} refinements on the ${plan.name} plan this month. Upgrade for more.`,
    };
  }
  return { ok: true, plan, limits, usage, grant };
}

/** Consume AFTER a successful build/refine (never on failures). */
export async function consumeBuild(store, uid) { await bumpUsage(store, uid, 'builds'); }
export async function consumeRefine(store, uid) { await bumpUsage(store, uid, 'refines'); }

/* ══ Pending orders (manual payment today, PSP-ready schema) ════════ */

export async function createOrder(store, uid, planId) {
  if (!PLANS[planId]) return { ok: false, error: `unknown plan "${planId}"` };
  const order = {
    id: `o_${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`,
    plan: planId,
    amount_inr: PLANS[planId].price_inr,
    status: 'pending',
    at: new Date().toISOString(),
  };
  if (store) {
    try {
      const list = safeParse(await store.get(ORDERS_KEY(uid))) || [];
      list.unshift(order);
      await store.put(ORDERS_KEY(uid), JSON.stringify(list.slice(0, 20)));
    } catch { /* order ledger is best-effort */ }
  }
  return {
    ok: true,
    order,
    note: `Order ${order.id} created — ₹${order.amount_inr} for the ${PLANS[planId].name} plan. Pay via UPI to the Nebula owner (bahyamshop2@gmail.com) quoting this order id; activation lands within minutes.`,
  };
}

export async function listOrders(store, uid) {
  if (!store || !uid) return [];
  return safeParse(await store.get(ORDERS_KEY(uid))) || [];
}

/* ══ Snapshot — what the app's Plans screen renders ══════════════════ */

export async function billingSnapshot(store, uid) {
  const grant = await planFor(store, uid);
  const plan = PLANS[grant.plan] || PLANS[DEFAULT_PLAN];
  const usage = await usageFor(store, uid);
  const limits = plan.limits;
  return {
    ok: true,
    plan: plan.id,
    plan_name: plan.name,
    price_inr: plan.price_inr,
    status: grant.status,
    until: grant.until || null,
    usage,
    limits,
    remaining: {
      builds: Math.max(0, limits.builds_per_month - usage.builds),
      refines: Math.max(0, limits.refines_per_month - usage.refines),
    },
    catalog: Object.values(PLANS).map((p) => ({
      id: p.id, name: p.name, price_inr: p.price_inr, tagline: p.tagline, perks: p.perks,
      current: p.id === plan.id,
    })),
  };
}
