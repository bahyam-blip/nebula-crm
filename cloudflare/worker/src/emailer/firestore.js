/**
 * CRM data access for the mailer — now backed by Cloudflare D1.
 *
 * The email list lives HERE — the contacts docs are the single source of
 * truth; MailerCloud is only a sending relay, synced from this data.
 *
 * Reads  : contacts (team-filtered, paged), users/{uid} role
 * Writes : campaigns/{id}  — the SAME collection the Flutter marketing
 *          module reads, so every AI campaign shows up natively in the app.
 *          The Dart parser ignores unknown fields, so mailer-specific keys
 *          (mailercloudCampaignId, aiTaskId, …) are safe additions.
 *        : activities/{id} — one timeline entry per campaign.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ── Contacts (the CRM email list) ──────────────────────────────── */

/**
 * Stream the whole contacts collection. Returns MailerCloud-ready rows:
 *   { email, first_name, last_name, company_name, phone, tags[], _segment, _created }
 * Only contacts with a valid email are returned. teamId filter optional
 * (MAIL_TEAM_ID); superAdmin-style "all teams" when unset.
 */
export async function fetchCrmContacts(env, { max = 5000 } = {}) {
  if (!env.DB) return [];
  const teamFilter = env.MAIL_TEAM_ID || '';
  const out = [];
  const seen = new Set();
  let afterId = null;

  // Keyset pagination on (team_id, id) keeps pages stable and cheap.
  while (out.length < max) {
    const pageSize = Math.min(300, max - out.length + 100);
    let sql = "SELECT id, json FROM docs WHERE col = 'contacts'";
    const args = [];
    if (teamFilter) {
      sql += ' AND team_id = ?';
      args.push(teamFilter);
    }
    if (afterId) {
      sql += ' AND id > ?';
      args.push(afterId);
    }
    sql += ' ORDER BY id ASC LIMIT ?';
    args.push(pageSize);

    const { results } = await env.DB.prepare(sql).bind(...args).all();
    const rows = results || [];
    if (!rows.length) break;

    for (const row of rows) {
      afterId = row.id;
      let c;
      try { c = JSON.parse(row.json); } catch { continue; }
      const email = String(c.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || seen.has(email)) continue;

      const name = String(c.name || '');
      const tags = [
        ...(Array.isArray(c.tags) ? c.tags : []),
        ...(Array.isArray(c.segments) ? c.segments : []),
      ].map(String).filter(Boolean).slice(0, 5);

      out.push({
        email,
        first_name: name.split(' ')[0] || '',
        last_name: name.includes(' ') ? name.split(' ').slice(1).join(' ') : '',
        company_name: String(c.company || ''),
        phone: String(c.phone || ''),
        tags,
        _segment: String(c.status || 'lead').toLowerCase(),
        _created: isoOf(c.createdAt) || '',
        _leadScore: typeof c.leadScore === 'number' ? c.leadScore : null,
      });
      seen.add(email);
      if (out.length >= max) break;
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Storage marker | ISO string → ISO string. */
function isoOf(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.__type === 'ts') return v.v;
  return '';
}

/* ── Users / roles ──────────────────────────────────────────────── */

/** Role of a user, for canManageCampaigns-style permission checks. */
export async function getUserRole(env, uid) {
  if (!env.DB) return null;
  try {
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'users' AND id = ?")
      .bind(uid)
      .first();
    if (!row) return null;
    const data = JSON.parse(row.json);
    return data.role || 'viewer';
  } catch (e) {
    console.warn(`[mailer:d1] role lookup failed for ${uid}: ${e.message}`);
    return null;
  }
}

export function canManageCampaigns(role) {
  return ['superAdmin', 'admin', 'manager'].includes(role);
}

/* ── Campaign write-back (app-visible!) ─────────────────────────── */

/**
 * Create the campaign document the Flutter marketing module renders.
 * Document id is deterministic so a retried pipeline run overwrites rather
 * than duplicates: campaigns/ai_{taskId}_{seq}.
 */
export async function upsertCampaignDoc(env, { id, fields }) {
  if (!env.DB) return null;
  try {
    const now = Date.now();
    const existing = await env.DB
      .prepare("SELECT json, created_at FROM docs WHERE col = 'campaigns' AND id = ?")
      .bind(id)
      .first();
    const prev = existing ? JSON.parse(existing.json) : null;
    const payload = { ...(prev || {}), ...fields, updatedAt: new Date(now).toISOString() };
    if (!payload.createdAt && !prev?.createdAt) payload.createdAt = payload.updatedAt;
    const teamId = typeof payload.teamId === 'string' ? payload.teamId : null;
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES ('campaigns', ?, ?, ?, ?, ?)
         ON CONFLICT(col, id) DO UPDATE SET team_id = excluded.team_id, json = excluded.json, updated_at = excluded.updated_at`
      )
      .bind(id, teamId, JSON.stringify(payload), existing?.created_at ?? now, now)
      .run();
    return { id };
  } catch (e) {
    console.warn(`[mailer:d1] campaign doc write failed (non-fatal): ${e.message}`);
    return null;
  }
}

/** Update just metrics/status on a campaign doc after an analytics pull. */
export async function updateCampaignMetrics(env, id, { metrics, status }) {
  if (!env.DB) return false;
  try {
    const existing = await env.DB
      .prepare("SELECT json, created_at FROM docs WHERE col = 'campaigns' AND id = ?")
      .bind(id)
      .first();
    if (!existing) return false;
    const prev = JSON.parse(existing.json);
    const payload = {
      ...prev,
      ...(metrics ? { metrics } : {}),
      ...(status ? { status } : {}),
      updatedAt: new Date().toISOString(),
    };
    await env.DB
      .prepare("UPDATE docs SET json = ?, updated_at = ? WHERE col = 'campaigns' AND id = ?")
      .bind(JSON.stringify(payload), Date.now(), id)
      .run();
    return true;
  } catch (e) {
    console.warn(`[mailer:d1] metrics update failed for ${id}: ${e.message}`);
    return false;
  }
}

/** Timeline entry so the 360° view shows the send. */
export async function logActivity(env, { title, description, campaignId, metadata }) {
  if (!env.DB) return;
  try {
    const now = new Date();
    const payload = {
      type: 'email',
      ownerId: 'ai-mailer',
      campaignId: campaignId || null,
      title: title || 'AI email campaign',
      description: description || '',
      metadata: metadata || {},
      timestamp: { __type: 'ts', v: now.toISOString() },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await env.DB
      .prepare(
        `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
         VALUES ('activities', ?, ?, ?, ?, ?)`
      )
      .bind(crypto.randomUUID(), null, JSON.stringify(payload), now.getTime(), now.getTime())
      .run();
  } catch (e) {
    console.warn(`[mailer:d1] activity log failed (non-fatal): ${e.message}`);
  }
}

/** Find campaign docs previously created by the mailer (metrics write-back). */
export async function findMailerCampaigns(env, { withinDays = 30 } = {}) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare(
        "SELECT id, json FROM docs WHERE col = 'campaigns' AND json_extract(json, '$.source') = 'ai-mailer' LIMIT 100"
      )
      .all();
    const cutoff = Date.now() - withinDays * 86400000;
    return (results || [])
      .map((r) => {
        try {
          // __id rides along: the analytics write-back addresses campaign
          // docs by it. (It used to be missing, so every write-back silently
          // targeted `undefined` and no metrics ever moved.)
          return { __id: r.id, ...JSON.parse(r.json) };
        } catch { return null; }
      })
      .filter(Boolean)
      .filter((c) => {
        const t = Date.parse(isoOf(c.createdAt) || isoOf(c.updatedAt) || '');
        return !Number.isFinite(t) || t >= cutoff;
      });
  } catch (e) {
    console.warn(`[mailer:d1] findMailerCampaigns failed (non-fatal): ${e.message}`);
    return [];
  }
}
