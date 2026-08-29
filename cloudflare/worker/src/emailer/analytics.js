/**
 * Analytics engine.
 *
 * 1. Pulls MailerCloud campaign performance (opens/clicks/unsubs/domain/
 *    inbox placement) for recent AI campaigns.
 * 2. Writes the numbers back into the CRM — campaigns/{doc}.metrics — so
 *    the Flutter marketing screens show real opens & clicks with no app
 *    change (Campaign.fromFirestore parses the metrics map natively).
 * 3. Asks Sarvam to convert raw numbers into "learnings" injected into
 *    every future plan/copy prompt — the loop that makes it improve.
 */

import { sarvamChat } from './sarvam.js';
import { findMailerCampaigns, updateCampaignMetrics } from './firestore.js';
import { safeParse } from './state.js';
import { openStats } from './track.js';

const DAYS = 21;
const CAMPAIGN_STATUSES = { scheduled: 'running', running: 'completed' };

function ymd(d) { return d.toISOString().slice(0, 10); }

async function safe(promise, fallback) {
  try { return await promise; } catch (e) { console.warn(`[mailer:analytics] ${e.message}`); return fallback; }
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function countOf(res) {
  if (!res) return 0;
  return n(res.total ?? res.total_records ?? (Array.isArray(res.data) ? res.data.length : 0));
}

/** Pull stats for recent AI campaigns → snapshot + CRM write-back + learnings. */
export async function collectAnalytics(mc, env, kv) {
  const now = new Date();
  const from = new Date(now.getTime() - DAYS * 86400000);

  const crmCampaigns = env.FIREBASE_SERVICE_ACCOUNT
    ? await safe(findMailerCampaigns(env, { withinDays: DAYS + 10 }), [])
    : [];

  const snapshot = [];
  for (const doc of crmCampaigns.slice(0, 25)) {
    // REAL numbers, never invented ones. Transactional sends (the Email API)
    // have no MailerCloud campaign id — their truth lives in the delivery
    // summary recorded at send time plus our own open-tracking pixel. The
    // old code SKIPPED those campaigns entirely, which is why the analytics
    // tab stayed empty while emails were going out.
    const delivery = doc.delivery && typeof doc.delivery === 'object' ? doc.delivery : {};
    const tracked = await openStats(env, doc.__id || doc.id || '');

    let opensN = tracked.opens || 0;
    let clicksN = 0;
    let unsubsN = 0;
    let sent = n(doc.audienceCount);
    // pipeline stamps metrics.delivered/failed/deferred on the campaign doc
    // at SEND time for BOTH modes (transactional + campaign) — use it as the
    // floor so a missing/old `delivery` blob can never turn a fully
    // delivered blast into "0 delivered / N not delivered".
    let delivered = Math.max(n(delivery.sent), n(doc.metrics?.delivered));
    let failed = Math.max(n(delivery.failed), n(doc.metrics?.failed));
    let deferred = Math.max(n(delivery.deferred), n(doc.metrics?.deferred));
    const mcId = doc.mailercloudCampaignId;

    // Campaign-mode sends: merge MailerCloud's provider reports (opens,
    // clicks, unsubs) on top of whatever the pixel saw.
    if (mcId) {
      const [opens, clicks, unsubs] = await Promise.all([
        safe(mc.campaignOpens(mcId), null),
        safe(mc.campaignClicks(mcId), null),
        safe(mc.campaignUnsubs(mcId), null),
      ]);
      opensN = Math.max(opensN, countOf(opens));
      clicksN = Math.max(clicksN, countOf(clicks));
      unsubsN = Math.max(unsubsN, countOf(unsubs));
    }

    sent = Math.max(sent, delivered);
    const notDelivered = Math.max(0, sent - delivered);
    const recipients = sent;

    snapshot.push({
      crmCampaignId: doc.__id,
      mailercloudId: mcId ? String(mcId) : null,
      delivery_mode: String(doc.deliveryMode || (mcId ? 'campaign' : 'transactional')),
      name: String(doc.name || ''),
      subject: String(doc.subject || ''),
      scheduled_at: String(doc.scheduledAt || ''),
      status: String(doc.status || ''),
      recipients,
      delivered,
      not_delivered: notDelivered,
      opens: opensN,
      clicks: clicksN,
      unsubs: unsubsN,
      open_rate: recipients ? +(opensN / recipients * 100).toFixed(1) : null,
      delivery_rate: recipients ? +(delivered / recipients * 100).toFixed(1) : null,
    });

    // ── Write REAL metrics back into the CRM (native app visibility) ──
    // opens use max(): the pixel keeps incrementing live between pulls and
    // must never be rolled back to a provider snapshot.
    const prevMetrics = doc.metrics && typeof doc.metrics === 'object' ? doc.metrics : {};
    // Campaign-mode docs still need their lifecycle status (scheduled →
    // running → completed); transactional docs are already terminal.
    const nextStatus = mcId ? (CAMPAIGN_STATUSES[String(doc.status || '')] || null) : null;
    await updateCampaignMetrics(env, doc.__id, {
      metrics: {
        sent: recipients,
        delivered: Math.max(n(prevMetrics.delivered), delivered),
        opens: Math.max(n(prevMetrics.opens), opensN),
        clicks: Math.max(n(prevMetrics.clicks), clicksN),
        conversions: n(prevMetrics.conversions) || 0,
        bounces: Math.max(n(prevMetrics.bounces), failed + deferred),
        failed: Math.max(n(prevMetrics.failed), failed),
        deferred: Math.max(n(prevMetrics.deferred), deferred),
        unsubscribes: Math.max(n(prevMetrics.unsubscribes), unsubsN),
        revenue: n(prevMetrics.revenue) || 0,
      },
      status: nextStatus,
    });
  }

  // Inbox placement (optional endpoint; may be unavailable on some plans)
  const inbox = await safe(mc.inboxTracking(ymd(from), ymd(now)), null);

  const payload = {
    generatedAt: now.toISOString(),
    window_days: DAYS,
    campaigns: snapshot,
    totals: summariseTotals(snapshot),
    inbox_tracking: summariseInbox(inbox),
  };

  if (snapshot.length > 0 && env.SARVAM_API_KEY) {
    try {
      const learnings = await sarvamChat(
        env,
        [
          { role: 'system', content: 'You are an email marketing analyst. Study campaign metrics and extract short, concrete, actionable learnings. Always reply with valid JSON.' },
          {
            role: 'user',
            content:
              `Campaign metrics (last ${DAYS} days):\n${JSON.stringify(payload, null, 1).slice(0, 6000)}\n\n` +
              'Return ONLY JSON: {"best_subject_styles": ["style that got the highest open rate"], ' +
              '"recommendations": ["3-6 specific directives for future emails"], ' +
              '"best_send_hour": <0-23 hour with best engagement or null>, ' +
              '"observations": ["notable patterns"]}',
          },
        ],
        { json: true, temperature: 0.3, maxTokens: 1500 }
      );
      payload.learnings = {
        best_subject_styles: (learnings.best_subject_styles || []).slice(0, 5).map(String),
        recommendations: (learnings.recommendations || []).slice(0, 6).map(String),
        best_send_hour: Number.isFinite(+learnings.best_send_hour) ? +learnings.best_send_hour : null,
        observations: (learnings.observations || []).slice(0, 5).map(String),
      };
    } catch (e) {
      console.warn(`[mailer:analytics] learning extraction failed: ${e.message}`);
    }
  }

  if (kv) await kv.put('mail:analytics', JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 * 60 });
  return payload;
}

export async function getLatestAnalytics(kv) {
  const raw = kv ? await kv.get('mail:analytics') : null;
  return safeParse(raw, null);
}

/** True when a refresh is due (throttled by MAIL_ANALYTICS_INTERVAL_HOURS). */
export async function analyticsDue(kv, intervalHours) {
  if (!kv) return true;
  const last = Number(await kv.get('mail:analytics:last_pull') || 0);
  return Date.now() - last > intervalHours * 3600 * 1000;
}
export async function markAnalyticsPulled(kv) {
  if (kv) await kv.put('mail:analytics:last_pull', String(Date.now()));
}

function extractTopDomains(report) {
  const rows = report?.data ?? report?.domains ?? report?.report ?? (Array.isArray(report) ? report : []);
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 3).map((r) => ({
    domain: String(r.domain ?? r.email_domain ?? r.name ?? '?'),
    share: r.percentage ?? r.percent ?? r.share ?? null,
    opens: r.opens ?? r.unique_opens ?? null,
  }));
}

function summariseTotals(campaigns) {
  const sum = (k) => campaigns.reduce((a, c) => a + (Number(c[k]) || 0), 0);
  const recipients = sum('recipients');
  return {
    campaigns: campaigns.length,
    recipients,
    delivered: sum('delivered'),
    not_delivered: sum('not_delivered'),
    opens: sum('opens'),
    clicks: sum('clicks'),
    open_rate: recipients ? +(sum('opens') / recipients * 100).toFixed(1) : null,
    delivery_rate: recipients ? +(sum('delivered') / recipients * 100).toFixed(1) : null,
  };
}

function summariseInbox(inbox) {
  const rows = inbox?.data ?? inbox?.campaigns ?? (Array.isArray(inbox) ? inbox : []);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const avg = (k) => {
    const vals = rows.map((r) => Number(r[k])).filter(Number.isFinite);
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
  };
  return {
    campaigns_measured: rows.length,
    inbox_pct: avg('inbox_percentage') ?? avg('inbox'),
    spam_pct: avg('spam_percentage') ?? avg('spam'),
    missed_pct: avg('missed_percentage') ?? avg('missed'),
  };
}
