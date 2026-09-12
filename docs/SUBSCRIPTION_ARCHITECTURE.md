# Nebula Multi-User Subscription Architecture (Agent v12)

The commercial layer that turns Nebula Studio from a single-owner tool
into a product you can SELL: customers sign up, build websites and apps
with the 13-agent team, and pay monthly for volume.

## 1. Tenancy model

- **Identity** stays Firebase Auth (Google Sign-In). Every authenticated
  Firebase account is a tenant candidate.
- **Isolation** is per-uid and already ships in the Worker: artifact
  lists (`agent:artifacts:<uid>`), site plans (`agent:siteplan:<id>` +
  owner check), skill libraries (`skills:library:<uid>`), run docs
  (`agent:run:<runId>` scoped by uid), hosting connectors (encrypted
  vault keyed by uid). One user can never read another user's sites,
  keys or runs.
- **The owner's internal team** (roles `superAdmin`, `admin`, `manager`,
  `salesRep`, `telecaller`, `supportAgent`) is EXEMPT from quotas — they
  are the business selling the subscriptions and operate the CRM.
- **Subscribers** are fresh Firebase accounts on default roles
  (`viewer` until upgraded) — every Studio build/refine is metered
  against their plan.

## 2. Plans (Worker: `src/emailer/plans.js`)

| Plan   | ₹/mo | Builds/mo | Refines/mo | Connectors | Custom domains | Seats |
|--------|------|-----------|------------|------------|----------------|-------|
| Free   | 0    | 3         | 10         | 1          | 0              | 1     |
| Pro    | 499  | 50        | 150        | 4          | 2              | 3     |
| Studio | 1999 | 500       | 2000       | 10         | 25             | 15    |

Limits live in ONE catalog (`PLANS`) — the enforcement gate, the
billing snapshot and the app's Plans sheet all read the same object.
Changing a price or limit is a one-line code change.

## 3. Enforcement flow (build → ship)

```
build_website / refine_site
  └─ rateLimit (existing per-tool guard)
  └─ checkQuota(store, uid, 'build'|'refine', user.role)   ← BEFORE any AI call
       ├─ internal role            → ok (exempt)
       ├─ plan expired             → refuse + upgradeRequired:true
       ├─ monthly quota exhausted  → refuse + upgradeRequired:true
       └─ ok                       → the team runs
  └─ build ships to R2, artifact recorded
  └─ consumeBuild / consumeRefine                          ← AFTER success only
```

Failed builds are FREE — the counter is consumed only when an artifact
actually lands. The gate runs before the Lead agent wakes, so over-quota
users never burn Sarvam compute.

## 4. Storage keys (shared state store: KV → Firestore fallback)

| Key | Shape |
|-----|-------|
| `billing:plan:<uid>` | `{plan, since, until, status, actor, note}` — expiry-dated grant |
| `billing:usage:<uid>:<YYYY-M>` | `{builds, refines, at}` — monthly ledger, UTC months |
| `billing:orders:<uid>` | `[{id, plan, amount_inr, status, at}]` — pending order history (cap 20) |

## 5. REST surface (`src/billing_http.js`, dispatched in `index.js`)

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /v1/billing/plans` | bearer | plan catalog (limits + perks) |
| `GET /v1/billing/usage` | bearer | this user's snapshot (plan, usage, remaining, catalog) |
| `GET /v1/billing/plan` | bearer | raw grant (plan, until, status) |
| `POST /v1/billing/checkout` | bearer | `{plan}` → pending order + payment note |
| `GET /v1/billing/orders` | bearer | the user's order history |
| `POST /v1/billing/grant` | owner (`superAdmin`/`admin`) | `{uid, plan, days?, action?: grant\|clear}` — activate/renew/clear |

## 6. Payments — today and tomorrow

- **Today (manual, zero fees):** the app's Plans sheet creates a pending
  order and shows the owner's UPI (`bahyamshop2@gmail.com`) with the
  order id. The owner verifies the payment and calls
  `POST /v1/billing/grant {uid, plan, days:30}` (owner token, from the
  CRM admin surface or curl). Activation lands in seconds.
- **Tomorrow (PSP):** a Razorpay/Stripe webhook verifies the payment and
  calls the SAME `setPlan()` — no schema change; the order row already
  carries `{plan, amount_inr, status}`. Add `payment_ref` when the PSP
  is chosen.

## 7. The app (Flutter)

- `StudioScreen 4.0 "COMMAND"` — command bar carries a live quota chip
  (ring + builds left + plan name; red when expired/low) → opens
  `PlansSheet` (usage bars + plan catalog + checkout).
- Upgrade errors from build/refine (`upgradeRequired: true`) surface the
  plan error verbatim — the copy already sells the upgrade.
- `studio_api_service.dart` → `fetchBilling()` / `createCheckout(plan)`.

## 8. Scale path (what changes when it grows)

1. **Metering:** the KV/Firestore ledger is atomic-enough per user at
   hobby scale. At thousands of subscribers, move the monthly counter to
   a D1 table (`usage(uid, ym, builds, refines)`) with `UPDATE …
   RETURNING` for atomic increment.
2. **Team seats:** `billing:plan:<uid>` becomes
   `billing:org:<orgId>` and `users.org_id` joins to it; checkQuota
   meters per org. The D1 `users` table already carries `teamId` — the
   same column pattern.
3. **Custom domains:** `limits.custom_domains` is already in the
   catalog; enforce in `publish.js pointDomain` the same way.
4. **Dunning:** a cron day-runner checks `billing:plan:*` for `until <
   now + 3d` and notifies (in-app + the existing email engine).
