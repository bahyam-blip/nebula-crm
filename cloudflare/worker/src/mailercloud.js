/**
 * MailerCloud integration for Nebula CRM.
 *
 * The CRM's contacts live in Firestore. MailerCloud's API key lives as a
 * Worker secret. This module bridges the two: it reads CRM data (contacts
 * with email addresses, pipeline stages, deal values) from Firestore,
 * asks the Sarvam AI to compose a daily marketing email about the
 * business, creates a campaign in MailerCloud, and schedules it to send
 * immediately.
 *
 * The API key never ships in the APK, never appears in CI logs, and is
 * never returned to the client. The Flutter app only sees the results
 * (campaign IDs, send counts) through the authenticated Worker routes.
 */

import { getAccessToken } from './push.js';

const MAILERCLOUD_BASE = 'https://cloudapi.mailercloud.com/v1';

// Re-use the service-account token from the push module — same Firebase
// service account, same Firestore read scope.

// ── MailerCloud REST helpers ─────────────────────────────────────

function mcHeaders(apiKey) {
  return {
    Authorization: apiKey,
    'Content-Type': 'application/json',
  };
}

/** Fetch all contact lists so we can pick one to send to. */
export async function getLists(apiKey) {
  const res = await fetch(`${MAILERCLOUD_BASE}/lists/search`, {
    method: 'POST',
    headers: mcHeaders(apiKey),
    body: JSON.stringify({ limit: 100, list_type: 1, page: 1 }),
  });
  if (!res.ok) {
    throw new Error(`MailerCloud list fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  // Response shape: { count: N, data: { "0": { id, name, ... }, "1": { ... } } }
  // or { data: [ { id, name, ... } ] } depending on version.
  const data = body.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
}

/** Fetch all verified senders. */
export async function getSenders(apiKey) {
  const res = await fetch(`${MAILERCLOUD_BASE}/senders`, {
    method: 'GET',
    headers: mcHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(`MailerCloud sender fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  const data = body.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
}

/**
 * Create a campaign via the v2 endpoint.
 * Returns the campaign ID.
 */
export async function createCampaign(apiKey, payload) {
  const res = await fetch(`${MAILERCLOUD_BASE}/campaign/save`, {
    method: 'POST',
    headers: mcHeaders(apiKey),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MailerCloud create campaign failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  return body.id;
}

/**
 * Schedule a campaign to send. If scheduledAt is omitted, sends immediately.
 */
export async function scheduleCampaign(apiKey, campaignId, scheduledAt) {
  const body = scheduledAt ? { scheduled_at: scheduledAt } : {};
  const res = await fetch(`${MAILERCLOUD_BASE}/campaign/schedule/${campaignId}`, {
    method: 'POST',
    headers: mcHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MailerCloud schedule campaign failed: ${res.status} ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

/** Get campaign details (for fetching stats after send). */
export async function getCampaign(apiKey, campaignId) {
  const res = await fetch(`${MAILERCLOUD_BASE}/campaign/${campaignId}`, {
    method: 'GET',
    headers: mcHeaders(apiKey),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.data || body;
}

/** List recent campaigns (for the Flutter app to display). */
export async function listCampaigns(apiKey, limit = 20) {
  const res = await fetch(`${MAILERCLOUD_BASE}/campaigns`, {
    method: 'POST',
    headers: mcHeaders(apiKey),
    body: JSON.stringify({ limit, page: 1 }),
  });
  if (!res.ok) return [];
  const body = await res.json();
  const data = body.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Object.values(data);
}

// ── Firestore helpers (reuse the service-account token from push.js) ──

/**
 * Fetch all contacts that have an email address.
 * Uses the service account token (same scope as push notifications).
 */
export async function fetchContacts(env, accessToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
  const url = `${base}/databases/(default)/documents:runQuery`;

  const body = {
    structuredQuery: {
      from: [{ collectionId: 'contacts' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'NOT_EQUAL',
          value: { stringValue: '' },
        },
      },
      limit: 500,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];

  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      return {
        id: r.document.name.split('/').pop(),
        name: f.name?.stringValue || '',
        email: f.email?.stringValue || '',
        company: f.company?.stringValue || '',
        status: f.status?.stringValue || 'lead',
        phone: f.phone?.stringValue || '',
      };
    })
    .filter((c) => c.email);
}

/**
 * Fetch pipeline summary — deal stages and values — so the AI can write
 * a meaningful daily email about what's happening in the business.
 */
export async function fetchPipelineSummary(env, accessToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
  const url = `${base}/databases/(default)/documents:runQuery`;

  const body = {
    structuredQuery: {
      from: [{ collectionId: 'deals' }],
      limit: 200,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { totalDeals: 0, stages: {}, totalValue: 0 };

  const rows = await res.json();
  const deals = rows.filter((r) => r.document).map((r) => {
    const f = r.document.fields || {};
    return {
      title: f.title?.stringValue || f.name?.stringValue || '',
      stage: f.stage?.stringValue || 'lead',
      value: f.value?.doubleValue || f.value?.integerValue || 0,
    };
  });

  const stages = {};
  let totalValue = 0;
  for (const d of deals) {
    stages[d.stage] = (stages[d.stage] || 0) + 1;
    totalValue += d.value;
  }

  return {
    totalDeals: deals.length,
    stages,
    totalValue,
  };
}

/**
 * Fetch recent activity so the AI email can reference what the team
 * accomplished (calls, deals, new contacts).
 */
export async function fetchRecentActivity(env, accessToken) {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}`;
  const url = `${base}/databases/(default)/documents:runQuery`;

  // Last 24 hours of activities
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'activities' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'timestamp' },
          op: 'GREATER_THAN_OR_EQUAL',
          value: { timestampValue: yesterday.toISOString() },
        },
      },
      limit: 50,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];

  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      return {
        type: f.type?.stringValue || '',
        title: f.title?.stringValue || '',
        description: f.description?.stringValue || '',
      };
    });
}

// ── AI content generation ────────────────────────────────────────

/**
 * Ask the Sarvam AI (already integrated in the Worker) to compose a
 * daily marketing email based on what's happening in the CRM.
 *
 * The AI sees:
 *   - How many contacts have emails
 *   - Pipeline summary (deals by stage, total value)
 *   - Recent activity (calls, deals, tasks)
 * And returns JSON with: subject, preheader, htmlBody, plainText.
 */
export async function generateEmailContent(env, crmContext) {
  if (!env.SARVAM_API_KEY) {
    throw new Error('SARVAM_API_KEY not configured — cannot generate email content');
  }

  const systemPrompt = `You are the marketing AI for Nebula CRM. Your job is to write a daily product update email that gets sent to the business's email subscribers.

You will receive a JSON summary of what happened in the CRM today (contacts, deals, pipeline, activity). Use this to write an engaging, professional marketing email that:
1. Highlights the value the CRM/product delivers
2. References real business metrics where appropriate (deal pipeline value, contacts growth, team activity)
3. Has a clear call-to-action encouraging engagement
4. Is warm, professional, and concise (300-500 words in the body)

The email is sent on behalf of the business using Nebula CRM. Frame it as coming from the business itself.

Reply with ONE JSON object and nothing else — no markdown, no code fences:
{
  "subject": "Engaging subject line (max 80 chars)",
  "preheader": "Short preview text shown in inbox (max 100 chars)",
  "htmlBody": "Full HTML email body with inline styles, <html><body> wrapper",
  "plainText": "Plain text version of the email"
}

Make the HTML email visually appealing with a header, content sections, and a footer. Use a clean, modern design with max-width 600px.`;

  const userPrompt = `Here is today's CRM snapshot. Write the daily email.\n\n${JSON.stringify(crmContext, null, 2)}`;

  const res = await fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': env.SARVAM_API_KEY,
    },
    body: JSON.stringify({
      model: 'sarvam-105b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sarvam AI failed: ${res.status} ${text.slice(0, 400)}`);
  }

  const body = JSON.parse(text);
  const choices = body.choices || [];
  const content = choices.length > 0
    ? (choices[0].message?.content || '')
    : '';

  // Extract JSON from the AI response (it may wrap in code fences)
  let cleaned = content.trim().replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('AI did not return valid JSON for email content');
  }

  const parsed = JSON.parse(cleaned.substring(start, end + 1));
  return {
    subject: parsed.subject || 'Daily Update from Nebula CRM',
    preheader: parsed.preheader || '',
    html: parsed.htmlBody || `<html><body><p>${parsed.plainText || ''}</p></body></html>`,
    plainText: parsed.plainText || '',
  };
}

// ── Orchestration: the full daily send flow ─────────────────────

/**
 * Run the complete daily email campaign:
 * 1. Gather CRM context (contacts, pipeline, activity)
 * 2. Use Sarvam AI to generate email content
 * 3. Resolve sender and list from MailerCloud
 * 4. Create and schedule the campaign
 * 5. Return a summary
 */
export async function runDailyCampaign(env) {
  if (!env.MAILERCLOUD_API_KEY) {
    throw new Error('MAILERCLOUD_API_KEY not configured');
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
  }

  const accessToken = await getAccessToken(env);

  // 1. Gather CRM context
  const [contacts, pipeline, activity] = await Promise.all([
    fetchContacts(env, accessToken),
    fetchPipelineSummary(env, accessToken),
    fetchRecentActivity(env, accessToken),
  ]);

  const emailContacts = contacts.filter((c) => c.email);
  const crmContext = {
    date: new Date().toISOString().split('T')[0],
    contacts: {
      total: contacts.length,
      withEmail: emailContacts.length,
      recent: emailContacts.slice(0, 10).map((c) => ({
        name: c.name,
        company: c.company,
        status: c.status,
      })),
    },
    pipeline,
    activity: {
      totalToday: activity.length,
      types: activity.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {}),
      recent: activity.slice(0, 5).map((a) => ({
        type: a.type,
        title: a.title,
      })),
    },
  };

  // 2. Generate email content with AI
  const emailContent = await generateEmailContent(env, crmContext);

  // 3. Resolve sender and list from MailerCloud
  const [senders, lists] = await Promise.all([
    getSenders(env.MAILERCLOUD_API_KEY),
    getLists(env.MAILERCLOUD_API_KEY),
  ]);

  if (!senders.length) {
    throw new Error('No verified senders found in MailerCloud account');
  }
  if (!lists.length) {
    throw new Error('No contact lists found in MailerCloud account');
  }

  // Pick the first verified sender and first list.
  const sender = {
    sender_email: senders[0].email || senders[0].sender_email,
    sender_name: senders[0].name || senders[0].sender_name || 'Nebula CRM',
  };
  const listId = lists[0].id;

  // 4. Create the campaign
  const campaignPayload = {
    name: `Daily Product Update — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    subject: emailContent.subject,
    email_preheader: emailContent.preheader,
    html: emailContent.html,
    plain_text: emailContent.plainText,
    sender,
    list_ids: [listId],
    is_publish: '1',
    reply_email: sender.sender_email,
  };

  const campaignId = await createCampaign(env.MAILERCLOUD_API_KEY, campaignPayload);

  // 5. Schedule for immediate send
  await scheduleCampaign(env.MAILERCLOUD_API_KEY, campaignId);

  return {
    ok: true,
    campaignId,
    campaignName: campaignPayload.name,
    subject: emailContent.subject,
    recipients: lists[0].contact_count || 0,
    listName: lists[0].name,
    sender: sender.sender_email,
    crmContext,
    sentAt: new Date().toISOString(),
  };
}
