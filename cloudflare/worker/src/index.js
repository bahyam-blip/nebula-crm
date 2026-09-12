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
import { handleMail, runMailCron, mailConfigState, deliverInternal, verifyRunSig } from './emailer/pipeline.js';
import { handleAssistant, handleAssistantApproval } from './emailer/assistant.js';
import { handleDataRequest } from './data_http.js';
import { handleStudioRequest } from './studio_http.js';
import { handleBillingRequest } from './billing_http.js';
import { llmChat, engineStatus, openAiShape } from './emailer/llm.js';
import { recordOpen, recordClick, recordUnsub, PNG_1X1 } from './emailer/track.js';
import { verifyIdToken } from './auth.js';
import { handleMcp, handleMcpPair, serveAgentSite, mcpServerInfo } from './emailer/mcp.js';

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
  // Mcp-Session-Id / MCP-Protocol-Version: browser-based MCP clients
  // preflight with these headers before calling /mcp.
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Mcp-Session-Id,MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// Firebase ID-token verification moved to src/auth.js (shared with the
// MCP endpoint, which accepts either a Firebase token or a pairing grant).

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
 * branding/ holds the BUSINESS logo (Business Profile image upload) —
 * team-shared like contacts/deals: any teammate may set the brand.
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
    key.startsWith('teams/') ||
    key.startsWith('branding/')
  );
}

/* ── Public engagement-tracking routes (no auth — mail clients) ─────
 * These can only: bump metrics on a campaign doc that already exists,
 * or add an address to the mailer's suppression list. Both are safe
 * against abuse (unknown campaign ids are ignored). */

function safeRedirectTarget(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function unsubPage({ brandName, color, email, already = false }) {
  const who = email ? `<p style="margin:10px 0 0 0;font-size:14px;color:#6b7280;">Address: <strong style="color:#374151;">${email.replace(/</g, '&lt;')}</strong></p>` : '';
  const heading = already ? "You're already off the list" : "You're unsubscribed";
  const body = already
    ? 'This address was already removed from the mailing list. Nothing more will be sent.'
    : 'You will not receive any more marketing emails from this business. If you change your mind, just reach out to them directly.';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed — ${brandName}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="min-height:100vh;background:#f3f4f6;"><tr><td align="center" style="padding:40px 16px;">
  <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td bgcolor="${color}" style="padding:28px 30px;" align="center">
      <div style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:.3px;">${brandName.replace(/</g, '&lt;')}</div>
    </td></tr>
    <tr><td style="padding:32px 30px;" align="center">
      <div style="width:52px;height:52px;border-radius:26px;background:#e8f7ee;font-size:26px;line-height:52px;">✓</div>
      <h1 style="margin:16px 0 6px 0;font-size:21px;color:#111827;">${heading}</h1>
      <p style="margin:0;font-size:14.5px;line-height:1.65;color:#4b5563;">${body}</p>
      ${who}
    </td></tr>
  </table>
  <p style="margin:16px 0 0 0;font-size:11.5px;color:#9ca3af;">Powered by the business's CRM email assistant</p>
</td></tr></table>
</body></html>`;
}

// ── Handler ──────────────────────────────────────────────────────

export default {
  /** ── Cron entrypoint (every 5 min via wrangler.toml [triggers]) ──
   * Drives the AI mailer: refresh analytics, plan new owner tasks, prepare
   * due emails and kick their chunked delivery chains. No-ops cheaply when
   * the mailer is not configured yet (see SETUP_INSTRUCTIONS → "AI mailer"). */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMailCron(env, ctx));
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

    // ── Click tracking redirect ──
    // CTA links in tracked emails point here first: one click is counted
    // per unique (campaign, recipient) token, then the reader is 302'd to
    // the real destination. Unknown campaigns / unsafe targets bounce to
    // the domain root instead of erroring.
    if (request.method === 'GET' && path === '/v1/t/c') {
      const c = url.searchParams.get('c') || '';
      const u = (url.searchParams.get('u') || '').slice(0, 64);
      const target = safeRedirectTarget(url.searchParams.get('to') || '');
      if (c && u) ctx.waitUntil(recordClick(env, c, u));
      return Response.redirect(target || 'https://nebula-crm-storage.nebula-crm.workers.dev/v1/health', 302);
    }

    // ── One-click unsubscribe ──
    // Renders a small branded confirmation page and (for a valid token)
    // suppresses the address: campaign metrics.unsubscribes++, the email is
    // added to the mailer's suppression list and the CRM contact is opted
    // out, so the AI never emails them again.
    if (request.method === 'GET' && path === '/v1/t/u') {
      const c = url.searchParams.get('c') || '';
      const u = (url.searchParams.get('u') || '').slice(0, 64);
      let page = { brandName: 'The business', color: '#6C8CFF', email: '', already: false };
      try {
        const { applyUnsub } = await import('./emailer/unsub.js');
        page = await applyUnsub(env, { campaignId: c, token: u });
      } catch (e) {
        console.warn('[track] unsub route failed:', e?.message || e);
      }
      return new Response(unsubPage(page), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
      });
    }

    // ── Delivery chain self-invocation (HMAC-signed, no Firebase auth) ──
    // Large campaigns are delivered across MANY short worker invocations —
    // each fetch gets a fresh subrequest budget (the free plan caps a single
    // invocation at 50; a 200-recipient 1:1 blast needs 200+ requests). The
    // proof is HMAC(action|taskId|seq, MAILERCLOUD_API_KEY): the key never
    // leaves the worker, so no outsider can forge a kick, and a replay is
    // harmless (the sent-ledger makes every chunk idempotent).
    if (request.method === 'POST' && path === '/v1/mail/deliver') {
      const sig = request.headers.get('x-nebula-deliver') || '';
      const body = await request.json().catch(() => ({}));
      const legit = await verifyRunSig(env, `${body.action || 'chunk'}|${body.taskId || ''}|${body.seq ?? ''}`, sig);
      if (!legit) return json({ error: 'forbidden' }, 403);
      return deliverInternal(env, body, ctx);
    }

    // ── Agent-built sites (public, unauthenticated by design) ──
    // The agent's build_website tool hosts finished pages here; the link is
    // meant to be shared with customers, so this route stays open. It can
    // only serve an HTML artifact that the pipeline already stored — no
    // data route, no listing, no user content beyond the artifact itself.
    if (request.method === 'GET' && path.startsWith('/sites/')) {
      return serveAgentSite(request, env, path);
    }

    // ── MCP endpoint (Model Context Protocol over Streamable HTTP) ──
    // External AI clients (Claude Desktop, Cursor, any MCP host) talk to
    // the CRM's tool registry here — WITHOUT static API tokens. Auth is a
    // short-lived pairing grant the owner mints inside the app (24h TTL,
    // revocable), or a plain Firebase ID token for the in-app agent.
    // Deliberately BEFORE the Firebase bearer gate: grants are not
    // Firebase tokens, and GET /mcp is a public capability advert.
    if (path === '/mcp') {
      if (request.method === 'GET') return mcpServerInfo(request, env);
      if (request.method === 'POST') return handleMcp(request, env, ctx);
    }

    // ── Public connectors page ──
    // The single public URL that explains how to connect ANY AI client to
    // this agent (MCP pairing), how platform connectors work, and the
    // security model. Linked from GET /mcp and from the app.
    if (request.method === 'GET' && (path === '/connect' || path === '/connect/')) {
      return new Response(connectPage(request, env), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
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

    // ── Nebula STUDIO (build → preview → publish) ──
    // The app's build/host UI: generate a site, see it live at /sites/<id>,
    // then publish it to GitHub Pages, Vercel or Firebase Hosting with
    // credentials pulled from the encrypted vault (never from the client).
    if (path.startsWith('/v1/studio/')) {
      return handleStudioRequest(request, env, { url, path, uid, ctx });
    }

    // ── Nebula BILLING (multi-user subscriptions, v12) ──
    // Plans, usage snapshots, checkout orders and owner-only grants:
    // the commercial layer that lets the owner SELL the Studio as a
    // subscription while every tenant's data stays per-uid isolated.
    if (path.startsWith('/v1/billing/')) {
      return handleBillingRequest(request, env, { url, path, uid });
    }

    // ── CRM database (D1) — the Firestore replacement ──
    // Google Sign-In stays on Firebase; every byte of CRM data now lives in
    // Cloudflare D1 behind these routes. The token still proves identity;
    // the Worker enforces team/role rules (see src/data.js).
    if (path.startsWith('/v1/data/') || path === '/v1/admin/migrate-from-firestore') {
      return handleDataRequest(request, env, { path, claims });
    }

    // ── Agentic AI assistant (CRM-wide knowledge + actions) ──
    // Authenticated above. The assistant can read CRM state, search
    // contacts, quote analytics, teach memory, save the business profile
    // and CREATE email tasks (which go through the same dry-run + pipeline
    // gates as the app's own AI Email screen).
    if (request.method === 'POST' && path === '/v1/assistant') {
      return handleAssistant(request, env, { uid, ctx });
    }

    // ── MCP pairing (mint/revoke external-client grants) ──
    // The in-app half of the MCP story: the owner taps "Connect an AI" in
    // the assistant screen, the app asks for a grant here (Firebase-authed),
    // and the returned short-lived token is what an MCP client pastes. No
    // static API token is ever created — grants expire and are revocable.
    if (path === '/v1/assistant/mcp/pair') {
      return handleMcpPair(request, env, { uid });
    }

    // ── Assistant approval gate (HITL) ──
    // The human half of consequential actions: the agent parks a mass send
    // as a pending approval, the owner presses Approve/Decline in chat, and
    // this route executes (or cancels) the stored action. Requester or a
    // manager decides; the action itself runs under the REQUESTER's identity.
    if (request.method === 'POST' && path === '/v1/assistant/approve') {
      return handleAssistantApproval(request, env, { uid, ctx });
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

    // ── AI proxy (engine-routed) ──
    // Keys live here as Worker secrets and never ship in the APK. The
    // request is served by the llm.js router: Workers AI binding (free,
    // default), our fine-tuned Nebula Core (LLM_CUSTOM_BASE_URL), then
    // Sarvam (paid, legacy). The response keeps the OpenAI shape the app
    // already parses (choices[0].message.content) for every engine.
    if (request.method === 'GET' && path === '/v1/ai/engine') {
      const status = engineStatus(env);
      return json({ ...status, hint: 'POST /v1/ai for completions' }, 200);
    }

    if (request.method === 'POST' && path === '/v1/ai') {
      const status = engineStatus(env);
      if (!status.ready) {
        return json({ error: 'AI is not configured on the server.' }, 503);
      }
      let body;
      try {
        body = await request.json();
      } catch (_) {
        return json({ error: 'invalid JSON body' }, 400);
      }

      const engine = status.active;

      // ── Sarvam passthrough (legacy engine) ──
      // sarvam-105b reasons before answering and reasoning shares the token
      // budget with the answer — an unlucky run returns finish_reason:"length"
      // with EMPTY content. Defenses kept exactly as before: thinking off
      // unless asked, one server-side retry on the hollow-200 signature.
      if (engine === 'sarvam') {
        const forcedEffort = ['low', 'medium', 'high'].includes(
          String(body.reasoning_effort || '').toLowerCase()
        )
          ? String(body.reasoning_effort).toLowerCase()
          : null; // null = thinking off (documented switch)

        const buildPayload = () =>
          JSON.stringify({
            model: body.model || 'sarvam-105b',
            messages: body.messages || [],
            temperature: body.temperature ?? 0.2,
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

        try {
          const parsed = JSON.parse(text);
          const content = parsed?.choices?.[0]?.message?.content;
          if (upstream.ok && (!content || !String(content).trim())) {
            upstream = await callUpstream();
            text = await upstream.text();
          }
        } catch (_) { /* non-JSON body — fall through */ }

        if (!upstream.ok) {
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

      // ── Router engines (Workers AI / Nebula Core) ──
      try {
        const content = await llmChat(env, body.messages || [], {
          engine,
          temperature: body.temperature ?? 0.2,
          maxTokens:
            Number.isFinite(Number(body.max_tokens)) && Number(body.max_tokens) > 0
              ? Math.min(Number(body.max_tokens), 8192)
              : 2048,
          json: !!(body.response_format && body.response_format.type === 'json_object'),
        });
        const model =
          engine === 'workers-ai'
            ? env.WAI_CHAT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
            : env.LLM_CUSTOM_MODEL || 'nebula-core';
        return json(openAiShape(content, { model, engine }), 200);
      } catch (e) {
        return json({ error: 'upstream', engine, detail: String(e?.message || e).slice(0, 600) }, 502);
      }
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

/* ══ Public /connect page — the connectors + security explainer ═══════ */

function connectPage(request, env) {
  const origin = new URL(request.url).origin;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect — Nebula Agent</title>
<meta name="description" content="Connect any AI client to the Nebula agent over MCP, or publish to your own hosting. No API keys.">
<style>
:root{--bg:#050505;--ink:#f5f5f5;--muted:#8f8f8f;--line:rgba(255,255,255,.1);--maxw:880px}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'Space Grotesk',Inter,-apple-system,'Segoe UI',sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased;padding:64px 20px 96px}
body::after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
main{max-width:var(--maxw);margin:0 auto}
.kicker{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
h1{font-size:clamp(30px,5.4vw,46px);letter-spacing:-.02em;line-height:1.1;margin-bottom:12px}
.sub{color:var(--muted);max-width:60ch;margin-bottom:44px}
h2{font-size:19px;margin:44px 0 14px;letter-spacing:-.01em}
.card{border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:14px;background:#0c0c0c}
.card b{display:block;margin-bottom:6px}
.card p{color:var(--muted);font-size:14.5px}
code,.mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;background:#161616;border:1px solid var(--line);border-radius:8px;padding:3px 8px;word-break:break-all}
.steps{counter-reset:s;list-style:none;margin:8px 0 0}
.steps li{counter-increment:s;display:flex;gap:14px;padding:10px 0;color:var(--muted);font-size:14.5px}
.steps li::before{content:counter(s,decimal-leading-zero);color:var(--ink);font-weight:700;font-size:12px;border:1px solid var(--line);border-radius:8px;min-width:30px;height:26px;display:grid;place-items:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
footer{margin-top:56px;color:var(--muted);font-size:12.5px;border-top:1px solid var(--line);padding-top:20px}
a{color:var(--ink)}
</style></head><body><main>
<div class="kicker">Nebula Agent · Public connectors</div>
<h1>Connect anything.<br>Own everything.</h1>
<p class="sub">This agent can be driven from any MCP-capable AI client — Claude Desktop, Cursor, Windsurf, or your own code — and its finished work can be published to your own hosting. No permanent API keys, ever.</p>

<h2>1 · Connect an AI client (MCP)</h2>
<div class="card">
  <b>Endpoint</b>
  <p style="margin-bottom:8px">MCP Streamable HTTP:</p>
  <code>${origin}/mcp</code>
  <ol class="steps">
    <li>In the Nebula app, open the Assistant → hub icon → <b>Create connection</b>. You get a one-time URL + secret that expires in 24 hours.</li>
    <li>Paste it into your MCP client's config (streamable HTTP transport).</li>
    <li>The client now sees the full tool registry — filtered to YOUR role — and can research, build and host under your permissions.</li>
    <li>Revoke anytime from the same sheet. Nothing long-lived exists to leak.</li>
  </ol>
</div>

<h2>2 · Publish to your own platforms</h2>
<div class="grid">
  <div class="card"><b>GitHub</b><p>Repo + Pages: your site commits to your repo and goes live on github.io.</p></div>
  <div class="card"><b>Vercel</b><p>Instant deploy to a *.vercel.app URL from within the chat.</p></div>
  <div class="card"><b>Firebase Hosting</b><p>Service-account release to *.web.app with a live channel.</p></div>
  <div class="card"><b>Supabase</b><p>Real SQL backends for the web apps the agent builds.</p></div>
  <div class="card"><b>GoDaddy / Hostinger</b><p>List domains and point CNAMEs at your deployments.</p></div>
  <div class="card"><b>Nebula Hosting</b><p>Every build is instantly live at ${origin}/sites/&lt;id&gt; — zero config.</p></div>
</div>

<h2>3 · Security model</h2>
<div class="grid">
  <div class="card"><b>Zero user-held keys</b><p>Platform credentials are connected once in the app, AES-GCM encrypted server-side, and never shown again — not in chat, not over MCP.</p></div>
  <div class="card"><b>Role-filtered tools</b><p>Every tool call executes under the caller's identity with server-side role checks. MCP grants confer zero privilege escalation.</p></div>
  <div class="card"><b>Self-expiring grants</b><p>Pairings are 192-bit secrets bound to your account, dead in 24h, revocable instantly.</p></div>
  <div class="card"><b>Artifact integrity</b><p>Every built page carries a SHA-256 digest: <span class="mono">/sites/&lt;id&gt;/meta</span> returns it, and served pages expose it as the <span class="mono">X-Content-Sha256</span> header.</p></div>
  <div class="card"><b>Rate limits</b><p>Builds, publishes, live-web research and SQL are hourly-rate-limited per account — no runaway loops.</p></div>
  <div class="card"><b>Human gate on email</b><p>Mass email is a consequential action: the agent drafts, the owner approves, then it sends.</p></div>
</div>

<footer>Nebula CRM agent · <a href="${origin}/mcp">capability advert</a> · built pages live under ${origin}/sites/</footer>
</main></body></html>`;
}
