# Nebula CRM — Firebase Setup Guide

This guide walks you through the one-time setup steps to make Nebula CRM fully functional on Firebase. Most of the heavy lifting has already been done — you just need to do a 30-second manual step in the Firebase Console.

---

## ✅ What's Already Done

The following have been wired up automatically:

- ✅ **Firebase project created** — `nebula-crm-70f58`
- ✅ **Android app registered** with package name `com.nebula.nebula_crm`
- ✅ **Web app registered** (for browser testing, if you ever build for web)
- ✅ **Authentication providers enabled** — Email/Password + Google Sign-In (you confirmed this)
- ✅ **`google-services.json`** downloaded and stored as a GitHub Actions secret (`GOOGLE_SERVICES_JSON`) so CI can build the APK with the real Firebase config
- ✅ **`firebase_options.dart`** updated with the real API keys and project IDs for Android, iOS, macOS, and Web
- ✅ **`firestore.rules`** written with full role-based access control (Super Admin / Admin / Manager / Sales Rep / Support Agent / Viewer)
- ✅ **Service account JSON** stored as a GitHub Actions secret (`FIREBASE_SERVICE_ACCOUNT`) for the deploy-rules workflow
- ✅ **App logic updated** so the first user to sign up automatically becomes the Super Admin. Subsequent users get the Sales Rep role by default and are placed in their own team (the Super Admin can promote them later)
- ✅ **Profile screen** added showing the user's role, permissions, and team info
- ✅ **Team Management screen** added for admins to promote/demote/remove users

---

## ⚠️ One Manual Step Required

The Firebase Admin SDK service account you provided has **Editor** permissions, but **cannot enable Google Cloud APIs** on its own (that requires `serviceusage.services.enable`, which is an Owner-level permission). So Firestore API needs to be enabled manually once:

### Step 1: Enable Cloud Firestore (one click)

1. Open this URL in your browser (you're already authenticated via your Google account that owns the Firebase project):
   👉 **https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=nebula-crm-70f58**

2. Click the blue **ENABLE** button.

3. Wait ~30 seconds for it to propagate.

### Step 2: Create the Firestore database

1. Open the Firebase Console:
   👉 **https://console.firebase.google.com/project/nebula-crm-70f58/firestore**

2. Click **Create database**.

3. Choose **Start in production mode** (the security rules we wrote will protect the data).

4. Pick a location close to you (e.g., `nam5` for US, `eur3` for EU).

5. Click **Enable**.

### Step 3: Deploy the security rules (automatic via GitHub Actions)

Once Firestore is enabled, the `Deploy Firestore Rules` workflow will run automatically on the next push. You can also trigger it manually:

1. Go to: https://github.com/bahyam-blip/nebula-crm/actions/workflows/deploy-rules.yml
2. Click **Run workflow** → select `main` branch → click green **Run workflow** button.
3. Wait ~2 minutes — the workflow will deploy `firestore.rules` to your Firebase project.

You can verify the rules are deployed at:
👉 https://console.firebase.google.com/project/nebula-crm-70f58/firestore/rules

The rules should show the content of `firestore.rules` from this repo.

---

## 🚀 Using the App

Once the above is set up:

### First signup = Super Admin

The first person to register in the app becomes the **Super Admin** automatically. They have god-mode access — can manage all teams, promote/demote any user, and access all data.

### Subsequent signups = Sales Rep

Every user who signs up after the Super Admin gets the **Sales Rep** role by default. They're placed in their own team (so their data is isolated). The Super Admin can:

- **Move them to the main team** (via the Team Management screen — accessible from More → Team Members)
- **Promote them** to Admin / Manager / Support Agent / Viewer (via the same screen — tap the ⋮ icon next to a user)

### Role hierarchy

| Role | Permissions |
|------|-------------|
| **Super Admin** | Full god-mode. Can manage admins and team settings across all teams. Sees all users. |
| **Admin** | Manages team members (invite, remove, change roles up to Manager). Full data access within their team. |
| **Manager** | Views/manages all team deals, tickets, and campaigns. Can edit knowledge base. Cannot manage users. |
| **Sales Rep** | Manages own contacts and deals. Read-only on rest of team data. |
| **Support Agent** | Manages assigned tickets. Read access to all contacts. |
| **Viewer** | Read-only access to all team data. |

---

## 📦 Installing the APK

After the APK build workflow finishes (10–12 minutes from any push to `main`), you can grab the APK from:

- **GitHub Releases**: https://github.com/bahyam-blip/nebula-crm/releases
- **Or as a workflow artifact**: https://github.com/bahyam-blip/nebula-crm/actions → click the latest successful run → scroll to "Artifacts"

The APK is ~160 MB (debug build). To produce a smaller release APK (~30 MB), add a signing config and change `--debug` to `--release` in `.github/workflows/build-apk.yml`.

---

## 🔄 Subsequent Updates

Any push to `main` triggers:

1. **Build APK** workflow — builds a fresh APK, uploads as artifact
2. **Deploy Firestore Rules** workflow — deploys `firestore.rules` (if changed)

Any push of a `v*` tag (e.g., `v1.0.1`) triggers:

1. Same as above, plus
2. **Create GitHub Release** with the APK as a downloadable asset

---

## 🛠️ Local Development

If you want to run the app locally (not just install the APK):

```bash
# Clone
git clone https://github.com/bahyam-blip/nebula-crm.git
cd nebula-crm

# Install Flutter
# (See https://docs.flutter.dev/get-started/install)

# Get dependencies
flutter pub get

# Restore google-services.json (the file is in .gitignore)
# You can grab it from the GitHub secret, or re-download from
# https://console.firebase.google.com → Project Settings → Your apps → Android app → google-services.json
# Place it at: android/app/google-services.json

# Run on connected device / emulator
flutter run
```

---

## 🆘 Troubleshooting

### App crashes on launch
- Check that `google-services.json` is present at `android/app/google-services.json`
- Check Logcat: `adb logcat` — look for Firebase-related errors
- Most likely cause: Firestore API not yet enabled (see Step 1 above)

### Sign-in fails with "network error"
- Make sure your device has internet access
- Check that Email/Password and Google providers are enabled in Firebase Console → Authentication → Sign-in method

### "Missing or insufficient permissions" when reading data
- The Firestore rules haven't been deployed yet — run the deploy-rules workflow manually
- Or, paste the contents of `firestore.rules` into the Firebase Console → Firestore → Rules → Publish

### Cannot promote a user
- Only Super Admin or Admin can promote
- Super Admin can promote to any role including Admin
- Admin can only promote to Manager, Sales Rep, Support Agent, or Viewer (cannot create other Admins)

---

## 🔐 Security Notes

- The service account JSON you provided is stored as a GitHub Actions encrypted secret (`FIREBASE_SERVICE_ACCOUNT`). GitHub encrypts secrets at rest and never logs them.
- The `google-services.json` is similarly stored as `GOOGLE_SERVICES_JSON`. These are public-by-design client config files (the API keys inside are restricted to your Android app's signing key by Google).
- The Firestore rules enforce role-based access at the database level. Even if someone decompiles your APK and extracts the Firebase config, they cannot read or write data without being a signed-in user with the appropriate role.
- The first user to sign up gets Super Admin. If you want to restrict signups further, enable Email Enumeration Protection or invite-only signup in Firebase Console → Authentication → Settings.

---

## 📞 Need help?

Open an issue: https://github.com/bahyam-blip/nebula-crm/issues

---

## 📧 AI Mailer (Sarvam + MailerCloud)

The Cloudflare Worker now includes an **autonomous email campaign engine**. You give it
plain-language tasks ("Send 3 emails this week to 500 leads about our monsoon sale");
Sarvam AI understands your business, writes the templates, syncs your Firestore contacts
into MailerCloud, and schedules the sends. Campaigns are written into the same Firestore
`campaigns` collection the app already renders — opens & clicks flow back automatically.

### One-time setup (2 minutes)

The email engine ships ready. It stores its state (tasks, locks, analytics
cache) in **Firestore** automatically — no KV namespace needed. The sending
identity is already pinned to the account's verified domain sender
**das@aidraft.bond**, so only one secret is required:

1. **Add GitHub secret** (Repo → Settings → Secrets and variables → Actions → New repository secret):
   | Secret | Where to get it | Required? |
   |---|---|---|
   | `MAILERCLOUD_API_KEY` | app.mailercloud.com → Account → API Integrations | **Yes — nothing can send without it** |
   | `MAILERCLOUD_SENDER_EMAIL` | A **verified** sender in MailerCloud | No — defaults to `das@aidraft.bond` (override only if you want a different verified sender) |
   (SARVAM_AI_API and FIREBASE_SERVICE_ACCOUNT are already set.)

2. **Re-run the "Deploy Storage Worker" workflow** (Actions → Deploy Storage
   Worker → Run workflow). Its summary page shows a readiness table — when
   `MAILERCLOUD_API_KEY` is green, the system is live. The workflow pushes
   the secrets to the Worker for you (and pushes `das@aidraft.bond` as the
   sender even when the optional secret is absent).

3. **Go-live check (30 seconds)** — open the app → **AI Email** → tap the
   **send (sample) icon** (or **Preview a sample campaign** on the status
   card) and enter your own address. One real email arrives immediately: a
   full sample campaign in your brand voice — exactly what your customers
   will receive (add an instruction like "festive Diwali offer for law
   firms" to steer the AI, or a `style` to demo any of the 10 templates).
   If the provider returns an error (e.g. `9011 sender not verified`), the
   app shows the exact code to report.

   Terminal equivalent:
   ```bash
   curl -X POST "$WORKER/v1/mail/test" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"to":"you@example.com","instruction":"festive Diwali offer","style":"aurora"}'
   ```

4. **Optional** — edit `cloudflare/worker/wrangler.toml` vars to give the AI
   more context: `MAIL_BUSINESS_PROFILE`, `MAIL_WEBSITE_URL`, `MAIL_CTA_URL`
   (the AI also infers the business from your CRM data and task instructions,
   so these can stay empty).

5. **Optional** — a Workers KV namespace is no longer required. If you prefer
   it, uncomment the `[[kv_namespaces]]` block in `wrangler.toml` after
   `npx wrangler kv namespace create NEBULA_EMAIL_KV`.

### Using it (no terminal needed)

Open the app → **Email** tab on the bottom navigation (or More → AI Email
Campaigns). Type what you want, e.g. *"Send 3 emails this week to leads about
our monsoon sale — build urgency but keep it classy"*, and press **Launch AI
campaign**. The task card tracks the AI live: planned → written → scheduled
(tap a task for its full AI activity log, cancel any time before it sends).
Toggle **LIVE / Safety mode** right on the status card. Every campaign also
appears in the normal Campaigns screen with opens & clicks flowing back.

**Business Brain (memory).** The AI keeps a persistent memory of your business —
what you sell, who buys, the brand voice, plus a creative playbook distilled from
real campaign results (winner/flop subjects, best send hour). Teach it once from
the app (**Email tab → Business Brain → Teach**) or let it learn from your CRM and
analytics. Every future campaign is planned and written against this memory.
Owner-taught facts always outrank AI inference. API: `GET/POST /v1/mail/memory`,
`POST /v1/mail/memory/reset`.

**Who can use it.** Every signed-in teammate (any role) can use the AI mailer —
creating tasks, sending tests, reading analytics. The Firebase ID token still
authenticates every call; the old superAdmin/admin/manager gate was removed.

Terminal equivalent:

```bash
WORKER="https://nebula-crm-storage.<your-subdomain>.workers.dev"
TOKEN="<Firebase ID token of any signed-in user>"   # from the app: user.getIdToken()

# Give the AI a task (it plans, writes, schedules — check progress with GET)
curl -X POST "$WORKER/v1/mail/tasks" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"instruction":"Send 2 emails this week to leads about our monsoon sale. Build urgency but keep it classy."}'

curl "$WORKER/v1/mail/tasks"     -H "Authorization: Bearer $TOKEN"   # progress & status
curl "$WORKER/v1/mail/preview?task=Introduce our CRM" -H "Authorization: Bearer $TOKEN" | jq .html -r > sample.html
curl "$WORKER/v1/mail/analytics?refresh=1" -H "Authorization: Bearer $TOKEN"
curl "$WORKER/v1/mail/status"    -H "Authorization: Bearer $TOKEN"   # config & health
curl -X POST "$WORKER/v1/mail/sync"   -H "Authorization: Bearer $TOKEN"   # contacts → MailerCloud only
curl -X POST "$WORKER/v1/mail/run?force=1" -H "Authorization: Bearer $TOKEN"  # run pipeline now
curl -X POST "$WORKER/v1/mail/test" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"to":"you@example.com"}'  # one REAL email — go-live check
curl -X POST "$WORKER/v1/mail/config" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"dry_run":true}'          # owner safety switch
```

### How it behaves

- **Audience = your Firestore `contacts`** (only rows with a valid email; optional
  `MAIL_TEAM_ID` filter). The AI targets segments by `status` (lead, customer, mql…).
- **Two delivery engines** (`MAIL_DELIVERY_MODE`, default `auto`):
  - **Transactional Email API** (`email-api.mailercloud.com/email-api`, mail merge) —
    audiences up to `MAIL_TRANSACTIONAL_MAX` (250) are delivered *immediately*,
    personalized per recipient (`Hi {{first_name}},`), with per-recipient outcomes.
    Hard bounces / unsubscribes / spam reports are auto-suppressed for future sends.
  - **Scheduled campaigns** (Marketing API) — larger audiences; opens/clicks/unsubs
    tracked per campaign, delivery at the AI-chosen minute.
- **Verified identity everywhere**: `from` is `das@aidraft.bond` (or your
  `MAILERCLOUD_SENDER_EMAIL` override) on both engines — never a Gmail/Yahoo address.
- **Every campaign appears in the app's Marketing screen** with live metrics
  (sent / opens / clicks / unsubscribes) written back from MailerCloud.
- **The AI learns**: each analytics pull turns numbers into directives that feed the
  next planning & copywriting prompts.
- **Safety**: `POST /v1/mail/config {"dry_run":true}` (owner toggle in the app) plans &
  writes copy but sends nothing — the **test send always sends for real** since it is
  the explicit go-live check; role-gated endpoints (superAdmin/admin/manager); run-lock
  prevents double sends; template/analytics failures are non-fatal.
