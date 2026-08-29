/**
 * Nebula CRM media broker.
 *
 * The app never holds R2 credentials. This Worker binds the bucket directly
 * (env.MEDIA), so there are no S3 access keys anywhere in the system --
 * not in the app, not in CI. Callers prove who they are with their Firebase
 * ID token and the Worker enforces what they may touch.
 *
 * Routes
 *   POST   /v1/upload?path=<key>   auth required, body = raw bytes
 *   GET    /v1/file/<key>          public read (media is not secret)
 *   DELETE /v1/file/<key>          auth required, same ownership rules
 *   GET    /v1/health              liveness probe
 */

import {
  getAccessToken,
  deviceTokensFor,
  teamMemberIds,
  sendToTokens,
} from './push.js';
import { handleMail, runMailCron, mailConfigState } from './emailer/pipeline.js';
import { handleDataRequest } from './data_http.js';
import { recordOpen, PNG_1X1 } from './emailer/track.js';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_CONTENT = [
  /^image\//,
  /^application\/pdf$/,
  /^text\/plain$/,
  /^application\/msword$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── Firebase ID token verification ───────────────────────────────

let jwkCache = { keys: null, expires: 0 };

async function googleKeys() {
  const now = Date.now();
  if (jwkCache.keys && now < jwkCache.expires) return jwkCache.keys;

  const res = await fetch(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  );
  if (!res.ok) throw new Error('could not fetch Google signing keys');
  const body = await res.json();

  // Respect Google's cache header rather than refetching on every request.
  const cc = res.headers.get('cache-control') || '';
  const maxAge = /max-age=(\d+)/.exec(cc);
  jwkCache = {
    keys: body.keys,
    expires: now + (maxAge ? parseInt(maxAge[1], 10) : 3600) * 1000,
  };
  return jwkCache.keys;
}

function b64urlToBytes(input) {
  const pad = input.length % 4 ? 4 - (input.length % 4) : 0;
  const b64 = (input + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Verify an RS256 Firebase ID token. Returns its claims, or null.
 *
 * Checks the signature against Google's rotating public keys, then the
 * issuer, audience and expiry. A token that fails any of these is treated
 * as anonymous rather than trusted.
 */
async function verifyIdToken(token, projectId) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));

    if (header.alg !== 'RS256' || !header.kid) return null;

    const keys = await googleKeys();
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      signed
    );
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= now) return null;
    if (claims.aud !== projectId) return null;
    if (claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!claims.sub) return null;

    return claims;
  } catch (_) {
    return null;
  }
}

// ── Path rules ───────────────────────────────────────────────────

/** Reject traversal and absolute paths before they reach the bucket. */
function isSafeKey(key) {
  return (
    !!key &&
    key.length <= 512 &&
    !key.startsWith('/') &&
    !key.includes('..') &&
    !key.includes('//') &&
    /^[A-Za-z0-9._\-/]+$/.test(key)
  );
}

/**
 * Who may write where.
 *
 * Avatars are owner-scoped: the uid in the path must match the token, so
 * one user cannot overwrite another's photo. Shared CRM records are open
 * to any authenticated teammate, matching the Firestore rules.
 */
function mayWrite(key, uid) {
  if (key.startsWith('avatars/')) {
    return key.split('/')[1] === uid;
  }
  return (
    key.startsWith('contacts/') ||
    key.startsWith('deals/') ||
    key.startsWith('tickets/') ||
    key.startsWith('articles/') ||
    key.startsWith('teams/')
  );
}

// ── Handler ──────────────────────────────────────────────────────

export default {
  /** ── Cron entrypoint (every 30 min via wrangler.toml [triggers]) ──
   * Drives the AI mailer: refresh analytics, plan new owner tasks, create
   * scheduled MailerCloud campaigns. No-ops cheaply when the mailer is
   * not configured yet (see SETUP_INSTRUCTIONS → "AI mailer"). */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMailCron(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (path === '/v1/health') {
      return json({ ok: true, bucket: 'nebula-crm1' });
    }

    // ── Email open-tracking pixel ──
    // Deliberately BEFORE auth (mail clients can't send headers) and
    // deliberately boring: it can only bump metrics on a campaign doc that
    // already exists. Returns a 1x1 PNG so mail clients render nothing.
    if (request.method === 'GET' && path === '/v1/t/o.png') {
      const c = url.searchParams.get('c') || '';
      const u = (url.searchParams.get('u') || '').slice(0, 32);
      if (c && u) ctx.waitUntil(recordOpen(env, c, u));
      return new Response(PNG_1X1, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store, max-age=0',
        },
      });
    }

    // ── Read ──
    if (request.method === 'GET' && path.startsWith('/v1/file/')) {
      const key = decodeURIComponent(path.slice('/v1/file/'.length));
      if (!isSafeKey(key)) return json({ error: 'bad key' }, 400);

      const object = await env.MEDIA.get(key);
      if (!object) return json({ error: 'not found' }, 404);

      const headers = new Headers(CORS);
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(object.body, { headers });
    }

    // Everything below needs a valid Firebase ID token.
    const auth = request.headers.get('Authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!bearer) return json({ error: 'missing bearer token' }, 401);

    const claims = await verifyIdToken(bearer, env.FIREBASE_PROJECT_ID);
    if (!claims) return json({ error: 'invalid or expired token' }, 401);
    const uid = claims.sub;

    // ── CRM database (D1) — the Firestore replacement ──
    // Google Sign-In stays on Firebase; every byte of CRM data now lives in
    // Cloudflare D1 behind these routes. The token still proves identity;
    // the Worker enforces team/role rules (see src/data.js).
    if (path.startsWith('/v1/data/') || path === '/v1/admin/migrate-from-firestore') {
      return handleDataRequest(request, env, { path, claims });
    }

    // ── AI mailer (Sarvam + MailerCloud) ──
    // Every signed-in teammate can use the AI mailer: the Firebase ID token
    // was already verified above, and role gates here caused hard 403s for
    // the whole team whenever a user doc was missing or a role drifted
    // ("only superadmin and admin can manage the email" — fixed). Inert
    // until configured — /v1/mail/status reports exactly what is missing.
    if (path.startsWith('/v1/mail/')) {
      const url = new URL(request.url);
      return handleMail(request, env, { url, uid, ctx });
    }

    // ── AI proxy ──
    // Sarvam's key lives here as a Worker secret. It must never ship in the
    // APK: an APK can be decompiled, and a leaked key is billable to you.
    // The Worker only relays; it never decides what the AI may touch. The
    // app executes any resulting action with the signed-in user's own
    // permissions, so the AI cannot escalate privileges.
    //
    // sarvam-105b reasons before answering and reasoning shares the token
    // budget with the answer — an unlucky run returns finish_reason:"length"
    // with EMPTY content (this killed campaign planning; see sarvam.js).
    // Two defenses here:
    //   • thinking is DISABLED unless the caller explicitly asks for it
    //     (reasoning_effort: 'low'|'medium'|'high');
    //   • an empty answer is retried once server-side, so the app never
    //     has to parse a hollow 200.
    if (request.method === 'POST' && path === '/v1/ai') {
      if (!env.SARVAM_API_KEY) {
        return json({ error: 'AI is not configured on the server.' }, 503);
      }
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ error: 'invalid JSON body' }, 400);
      }

      const forcedEffort = ['low', 'medium', 'high'].includes(
        String(body.reasoning_effort || '').toLowerCase()
      )
        ? String(body.reasoning_effort).toLowerCase()
        : null; // null = thinking off (documented switch)

      const buildPayload = () =>
        JSON.stringify({
          // sarvam-m was retired; the API names sarvam-105b as the replacement.
          model: body.model || 'sarvam-105b',
          messages: body.messages || [],
          temperature: body.temperature ?? 0.2,
          // Keep the payload minimal beyond what the app asked for. Extra
          // parameters are the usual cause of a 400 from providers that
          // only accept a subset of the OpenAI shape.
          ...(Number.isFinite(Number(body.max_tokens)) && Number(body.max_tokens) > 0
            ? { max_tokens: Math.min(Number(body.max_tokens), 4096) }
            : {}),
          ...(body.response_format && body.response_format.type === 'json_object'
            ? { response_format: { type: 'json_object' } }
            : {}),
          reasoning_effort: forcedEffort,
        });

      const callUpstream = async () =>
        fetch('https://api.sarvam.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-subscription-key': env.SARVAM_API_KEY,
          },
          body: buildPayload(),
        });

      let upstream = await callUpstream();
      let text = await upstream.text();

      // Retry once when the model 200s but answers with nothing (its
      // thinking ate the budget). Any real HTTP error still surfaces.
      try {
        const parsed = JSON.parse(text);
        const content = parsed?.choices?.[0]?.message?.content;
        if (upstream.ok && (!content || !String(content).trim())) {
          upstream = await callUpstream();
          text = await upstream.text();
        }
      } catch (_) { /* non-JSON body — fall through */ }

      if (!upstream.ok) {
        // Surface what the provider actually said; "error (400)" is useless
        // for diagnosis.
        return json(
          {
            error: 'upstream',
            status: upstream.status,
            detail: text.slice(0, 600),
          },
          upstream.status
        );
      }
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── Cross-user push ──
    // The caller is already authenticated above. They may notify a specific
    // user, a role within their team, or the whole team. The Worker resolves
    // recipients server-side so a client cannot address arbitrary devices by
    // supplying tokens directly.
    if (request.method === 'POST' && path === '/v1/notify') {
      if (!env.FIREBASE_SERVICE_ACCOUNT) {
        return json({ error: 'push is not configured' }, 503);
      }

      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ error: 'invalid JSON body' }, 400);
      }

      const title = (body.title || '').toString().slice(0, 120);
      const message = (body.body || '').toString().slice(0, 400);
      if (!title) return json({ error: 'title required' }, 400);

      try {
        const accessToken = await getAccessToken(env);

        // Who the sender is allowed to speak for: their own team only.
        // Team identity lives in D1 now — the old Firestore lookup returned
        // "no team" 403s for every user created after the migration.
        const senderRow = env.DB
          ? await env.DB
              .prepare("SELECT json FROM docs WHERE col = 'users' AND id = ?")
              .bind(uid)
              .first()
          : null;
        const senderTeam = senderRow
          ? (JSON.parse(senderRow.json).teamId || '')
          : '';
        if (!senderTeam) return json({ error: 'no team' }, 403);

        let targets = [];
        if (Array.isArray(body.userIds) && body.userIds.length) {
          targets = body.userIds.slice(0, 200);
        } else if (body.role) {
          targets = await teamMemberIds(env, accessToken, senderTeam, body.role);
        } else if (body.everyone) {
          targets = await teamMemberIds(env, accessToken, senderTeam, null);
        } else {
          return json({ error: 'no recipients' }, 400);
        }

        // Never notify the sender about their own action.
        targets = targets.filter((t) => t !== uid);

        const tokens = [];
        for (const t of targets) {
          const list = await deviceTokensFor(env, accessToken, t);
          tokens.push(...list);
        }
        if (!tokens.length) return json({ ok: true, sent: 0, recipients: 0 });

        const result = await sendToTokens(env, accessToken, [...new Set(tokens)], {
          title,
          body: message,
          data: body.data || {},
          channel: body.channel || 'tasks',
        });

        return json({
          ok: true,
          recipients: targets.length,
          sent: result.sent,
          stale: result.stale.length,
        });
      } catch (e) {
        return json({ error: 'push failed', detail: String(e).slice(0, 300) }, 500);
      }
    }

    // ── Write ──
    if (request.method === 'POST' && path === '/v1/upload') {
      const key = url.searchParams.get('path');
      if (!isSafeKey(key)) return json({ error: 'bad path' }, 400);
      if (!mayWrite(key, uid)) return json({ error: 'forbidden path' }, 403);

      const type = request.headers.get('Content-Type') || 'application/octet-stream';
      if (!ALLOWED_CONTENT.some((re) => re.test(type))) {
        return json({ error: `content type not allowed: ${type}` }, 415);
      }

      const declared = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (declared > MAX_BYTES) {
        return json({ error: 'file too large (25 MB max)' }, 413);
      }

      // Buffer so the size limit is enforced on the real payload, not just
      // whatever Content-Length the client claimed.
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_BYTES) {
        return json({ error: 'file too large (25 MB max)' }, 413);
      }

      await env.MEDIA.put(key, bytes, {
        httpMetadata: { contentType: type },
        customMetadata: { uploadedBy: uid, uploadedAt: new Date().toISOString() },
      });

      return json({
        ok: true,
        key,
        url: `${url.origin}/v1/file/${encodeURIComponent(key)}`,
        size: bytes.byteLength,
      });
    }

    // ── Delete ──
    if (request.method === 'DELETE' && path.startsWith('/v1/file/')) {
      const key = decodeURIComponent(path.slice('/v1/file/'.length));
      if (!isSafeKey(key)) return json({ error: 'bad key' }, 400);
      if (!mayWrite(key, uid)) return json({ error: 'forbidden path' }, 403);

      await env.MEDIA.delete(key);
      return json({ ok: true, key });
    }

    return json({ error: 'not found' }, 404);
  },
};
