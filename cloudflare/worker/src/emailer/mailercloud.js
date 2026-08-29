/**
 * MailerCloud Marketing API client.
 * Docs: https://apidoc.mailercloud.com · Base: https://cloudapi.mailercloud.com/v1
 * Auth: plain API key in the Authorization header (NO Bearer prefix).
 * Rate limit: 50 req/s/IP → backoff on 429 handled in http.js.
 *
 * Endpoint map used here:
 *   POST /list                      create a list (auto-provisioned once)
 *   POST /contacts/batch            upsert ≤50 contacts per call
 *   POST /contacts/upsert           per-contact fallback when a batch 400s
 *   POST /templates/create          save each AI template
 *   POST /campaign/save             create + publish/schedule campaign (v2)
 *   POST /campaign/list             recent campaigns (analytics)
 *   POST /campaign/{id}/opens|clicks|unsubs
 *   POST /campaign/domain/report/{id}
 *   POST /inbox-tracking            inbox/spam placement
 */

import { fetchWithBackoff, htmlToText } from './http.js';
import { resolveSender } from './emailapi.js';

export class MailerCloud {
  constructor(env) {
    this.env = env;
    this.base = 'https://cloudapi.mailercloud.com/v1';
    this.headers = {
      Authorization: env.MAILERCLOUD_API_KEY, // plain key, per MailerCloud docs
      'Content-Type': 'application/json',
    };
  }

  async #req(path, { method = 'POST', body } = {}) {
    const res = await fetchWithBackoff(
      `${this.base}${path}`,
      { method, headers: this.headers, body: body ? JSON.stringify(body) : undefined },
      3
    );
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const msg = json?.errors?.map((e) => `${e.field || ''}: ${e.message}`).join('; ') || text.slice(0, 300);
      const err = new Error(`MailerCloud ${res.status} ${path} → ${msg}`);
      err.status = res.status;
      throw err;
    }
    return json ?? {};
  }

  /** Configured list id, creating + caching "Nebula CRM Contacts" once. */
  async ensureList(kv) {
    const wanted = this.env.MAILERCLOUD_LIST_ID;
    if (wanted) return wanted;

    const cached = kv ? await kv.get('mc:list_id') : null;
    if (cached) return cached;

    const created = await this.createList('Nebula CRM Contacts');
    const id = created?.id ?? created?.data?.id;
    if (!id) throw new Error('Could not auto-create MailerCloud list: ' + JSON.stringify(created).slice(0, 200));
    if (kv) await kv.put('mc:list_id', String(id));
    console.log(`[mailer] auto-created MailerCloud list ${id}`);
    return String(id);
  }

  /** Create a named list (used for per-campaign exact-audience lists). */
  async createList(name) {
    return this.#req('/list', {
      method: 'POST',
      body: { list_type: 1, name: String(name || 'AI Campaign').slice(0, 90) },
    });
  }

  /**
   * Upsert contacts in batches of 50 (MailerCloud's batch cap).
   * A single bad row can 400 the whole batch → fall back to per-contact
   * upserts so one malformed record never blocks a send.
   */
  async upsertContacts(listId, contacts) {
    let ok = 0;
    for (let i = 0; i < contacts.length; i += 50) {
      const batch = contacts.slice(i, i + 50).map((c) => ({
        email: c.email,
        first_name: c.first_name || '',
        last_name: c.last_name || '',
        company_name: c.company_name || '',
        phone: c.phone || '',
        list_id: listId,
        ...(Array.isArray(c.tags) && c.tags.length ? { tags: c.tags } : {}),
      }));
      try {
        await this.#req('/contacts/batch', { method: 'POST', body: { contacts: batch } });
        ok += batch.length;
      } catch (err) {
        console.warn(`[mailer] batch ${i / 50 + 1} failed (${err.message}) — single upserts`);
        for (const c of batch) {
          try {
            await this.#req('/contacts/upsert', { method: 'POST', body: c });
            ok++;
          } catch (e2) {
            console.warn(`[mailer] upsert failed for ${c.email}: ${e2.message}`);
          }
        }
      }
    }
    return ok;
  }

  /** Save an AI-generated email as a reusable template. */
  async createTemplate(name, html, plainText) {
    return this.#req('/templates/create', {
      method: 'POST',
      body: { name: name.slice(0, 140), html, plainText: plainText || htmlToText(html) },
    });
  }

  /**
   * Create + publish a campaign. scheduledAt: "YYYY-MM-DD HH:MM:SS" in the
   * account timezone → MailerCloud fires at that minute. Omit = send now.
   * brand (optional) — Business Profile branding: the campaign goes out as
   * the OWNER'S business (sender display name + permission reminder).
   */
  async createAndPublishCampaign({ name, subject, html, preheader, listId, scheduledAt, brand = null }) {
    const env = this.env;
    // Same verified identity as the transactional engine (das@aidraft.bond
    // unless overridden): the "from" of a campaign must be a verified sender.
    const sender = resolveSender(env, brand);
    const body = {
      name: name.slice(0, 150),
      subject,
      html,
      plain_text: htmlToText(html),
      email_preheader: (preheader || '').slice(0, 150),
      permission_reminder:
        brand?.permission ||
        env.MAIL_PERMISSION_REMINDER ||
        `You are receiving this because you subscribed to updates from ${brand?.name || env.MAIL_BUSINESS_NAME || 'Nebula CRM'}.`,
      list_ids: [listId],
      sender: {
        sender_email: sender.from,
        sender_name: sender.fromName,
      },
      reply_email: sender.replyTo || sender.from,
      is_publish: '1', // "1" → publish/schedule, "0" → draft
    };
    if (scheduledAt) body.scheduled_at = scheduledAt;
    return this.#req('/campaign/save', { method: 'POST', body });
  }

  /* ── Analytics ──────────────────────────────────────────────── */

  async listCampaigns({ dateFrom, dateTo, limit = 100 } = {}) {
    return this.#req('/campaign/list', {
      method: 'POST',
      body: { date_from: dateFrom, date_to: dateTo, limit, page: 1 },
    });
  }
  async campaignOpens(id) { return this.#req(`/campaign/${id}/opens`, { method: 'POST', body: { page: 1, limit: 100 } }); }
  async campaignClicks(id) { return this.#req(`/campaign/${id}/clicks`, { method: 'POST', body: { page: 1, limit: 100 } }); }
  async campaignUnsubs(id) { return this.#req(`/campaign/${id}/unsubs`, { method: 'POST', body: { page: 1, limit: 100 } }); }
  async campaignDomainReport(id) { return this.#req(`/campaign/domain/report/${id}`, { method: 'POST', body: {} }); }
  async inboxTracking(dateFrom, dateTo) {
    return this.#req('/inbox-tracking', { method: 'POST', body: { date_from: dateFrom, date_to: dateTo } });
  }
}
