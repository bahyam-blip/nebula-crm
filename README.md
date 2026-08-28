# Nebula CRM

An **advanced, AI-powered CRM** built with Flutter, Firebase, and Riverpod. Designed with a **dark-premium, mobile-first** aesthetic for modern sales teams. Production-ready architecture with offline support, real-time sync, and agentic AI features.

> Built per the requirements gathered from competitive research against Salesforce, HubSpot, Zoho, and Pipedrive. See [`CRM_Research_REPORT.md`](../CRM_Research_Report.md) for the feature matrix that drove this build.

---

## Highlights

| Module | What you get |
|---|---|
| Authentication | Email/password, Google Sign-In, biometric re-login, password reset |
| Contacts & Leads | 360° view, activity timeline, segmentation tags, enrichment-ready |
| Sales Pipeline | Drag-and-drop Kanban, weighted forecast, deal velocity, win/loss insights |
| Analytics Dashboard | KPI cards, revenue trend, conversion funnel, AI insight banner |
| Marketing Automation | Campaigns, drip sequences, A/B variants, audience builder |
| Customer Service | Ticketing with SLA, priority queues, knowledge base |
| AI Assistant | Conversational chat, next-best-action cards, deal insights, sentiment |

---

## Tech Stack

- **Flutter** ≥ 3.19 (Dart ≥ 3.3)
- **State management:** Riverpod 2 (`AsyncNotifier` pattern)
- **Backend:** Firebase (Auth, Firestore, Storage, FCM, Functions, Analytics)
- **Routing:** GoRouter 14 with shell routes + auth redirect
- **Charts:** fl_chart
- **Icons:** Phosphor Flutter
- **Local persistence:** Hive + SharedPreferences (offline-first)
- **Forms:** flutter_form_builder + form_builder_validators
- **Rich text:** FlutterQuill (knowledge base / notes)
- **AI:** Cloud Functions gateway pattern (LLM-agnostic; bring your own key)

---

## Project Structure

```
lib/
├── main.dart                      # Entry point + Firebase init
├── app.dart                       # MaterialApp.router + theme
├── firebase_options.dart          # Generated Firebase config
├── core/
│   ├── theme/                     # Dark premium theme, colors, typography
│   ├── router/                    # GoRouter config + route names
│   ├── services/                  # Auth, Firestore, AI, Notifications
│   ├── widgets/                   # KpiCard, GradientCard, EmptyState, ...
│   ├── constants/                 # App-wide constants
│   └── utils/                     # Extensions, formatters, validators
├── features/
│   ├── auth/                      # Login, Register, ForgotPassword
│   ├── dashboard/                 # KPI grid, charts, funnel
│   ├── contacts/                  # List, detail 360, form
│   ├── pipeline/                  # Kanban board, deal detail, form
│   ├── marketing/                 # Campaigns, builder, drip editor:│   ├── service/                   # Tickets, SLA, knowledge base
│   └── assistant/                 # AI chat, NBA cards, insights
└── shared/
    └── widgets/                   # MainScaffold (bottom nav), ProfileMenu
```

---

## Getting Started

### 1. Prerequisites
- Flutter 3.19+ (`flutter --version`)
- A Firebase project (https://console.firebase.google.com)
- Android Studio / Xcode for platform builds

### 2. Install dependencies
```bash
flutter pub get
```

### 3. Configure Firebase
```bash
# Install the FlutterFire CLI
dart pub global activate flutterfire_cli

# Generate firebase_options.dart for your project
flutterfire configure --project=your-firebase-project-id
```
This regenerates `lib/firebase_options.dart` with your platform-specific config.

Enable in Firebase Console:
- **Authentication** → Email/Password + Google providers
- **Firestore Database** (production mode, then deploy `firestore.rules`)
- **Cloud Storage** (deploy `storage.rules`)
- **Cloud Messaging** (Android: upload FCM key; iOS: upload APNs auth key)
- **Cloud Functions** (deploy `functions/` for AI gateway)

### 4. Run
```bash
# Debug
flutter run

# Profile mode
flutter run --profile

# Release APK
flutter build apk --release

# Release iOS
flutter build ipa --release
```

---

## Firestore Data Model

```
users/{uid}                 → AppUser (displayName, email, photoURL, role, teamId)
contacts/{contactId}        → Contact (name, email, phone, company, tags, ownerId, ...)
deals/{dealId}              → Deal (title, value, stage, contactRef, ownerId, expectedCloseDate, ...)
activities/{activityId}     → Activity (type, contactRef, dealRef, timestamp, notes, ...)
campaigns/{campaignId}      → Campaign (name, status, audience, variants, schedule, ...)
tickets/{ticketId}          → Ticket (subject, priority, status, slaDeadline, assigneeId, ...)
articles/{articleId}        → Knowledge base article (title, body, tags, views)
chat_threads/{threadId}     → AI assistant conversation (userId, messages[], context)
insights/{insightId}        → AI-generated insight cards (type, targetRef, confidence, ...)
```

Security rules enforce per-team ownership and role-based access. See `firestore.rules`.

---

## AI Integration Pattern

The app uses a **thin-client / thick-gateway** pattern:

1. Flutter app sends a structured intent (e.g. `{"action": "next_best_action", "dealId": "..."}`) to a Cloud Function.
2. Cloud Function orchestrates the LLM call (Vertex AI / OpenAI / Anthropic), RAG retrieval, and tool use.
3. Response streams back to the app as Server-Sent Events for chat, or as a single JSON payload for insights.
4. App renders AI output as **typed cards** (NBA, insight, sentiment) — never raw markdown blobs.

This keeps the LLM provider swappable and API keys server-side.

---

## MailerCloud Email Marketing Integration

Daily product-update emails are sent automatically through [MailerCloud](https://www.mailercloud.com). The integration works as follows:

1. **GitHub Actions cron** (`daily-email.yml`) triggers at 10:00 AM IST every day.
2. The cron calls the Cloudflare Worker's `/v1/mailercloud/send-daily` endpoint with a `CRON_SECRET`.
3. The Worker reads CRM data (contacts, pipeline, recent activity) from Firestore.
4. The existing **Sarvam AI** integration generates a personalised email about the business — subject, HTML body, plain text — based on what happened that day.
5. The Worker creates a MailerCloud campaign (using the first verified sender and first contact list) and schedules it to send immediately.
6. The Flutter app's campaigns screen shows live MailerCloud send metrics (opens, clicks, bounces) via `GET /v1/mailercloud/campaigns`.

### Required GitHub secrets

| Secret | What it is |
|---|---|
| `MAILERCLOUD_API_KEY` | Your MailerCloud API key (from Settings → API Integrations) |
| `CRON_SECRET` | A random string (generate with `openssl rand -hex 32`) shared between the GitHub Actions cron and the Worker |
| `CLOUDFLARE_API_TOKEN` | Already used by the deploy-worker workflow |
| `FIREBASE_SERVICE_ACCOUNT` | Already used by the push notification system |

The `deploy-worker.yml` workflow automatically pushes `MAILERCLOUD_API_KEY` and `CRON_SECRET` as Worker secrets on every deploy.

---

## Testing

```bash
# Unit + widget tests
flutter test

# Integration tests
flutter test integration_test/

# Coverage
flutter test --coverage
```

---

## License

Proprietary — © Nebula CRM. All rights reserved.
