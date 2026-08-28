/**
 * Cross-user push, sent from Cloudflare rather than Cloud Functions.
 *
 * FCM itself is free — it is Cloud Functions that requires Blaze billing.
 * So the Worker takes the role Functions would have played: it holds the
 * Firebase service account, mints a Google OAuth token, reads the target
 * user's device tokens straight from Firestore over REST, and calls the
 * FCM v1 API. No Blaze, no Functions, and the credentials never leave the
 * server.
 */

// Access tokens last an hour; caching per isolate avoids re-signing a JWT
// on every notification.
let tokenCache = { value: null, expires: 0 };

function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

/**
 * Exchange the service account key for a Google access token.
 *
 * Scopes cover both sending messages and reading Firestore, because the
 * Worker needs to look up who to send to as well as how.
 */
export async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && now < tokenCache.expires - 60) {
    return tokenCache.value;
  }

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: [
      'https://www.googleapis.com/auth/firebase.messaging',
      'https://www.googleapis.com/auth/datastore',
    ].join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const unsigned =
    b64url(encoder.encode(JSON.stringify(header))) +
    '.' +
    b64url(encoder.encode(JSON.stringify(claim)));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsigned)
  );
  const jwt = unsigned + '.' + b64url(signature);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`token exchange failed ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  tokenCache = {
    value: body.access_token,
    expires: now + (body.expires_in || 3600),
  };
  return tokenCache.value;
}

/** Pull the device tokens recorded on a user document (D1). */
export async function deviceTokensFor(env, accessToken, uid) {
  if (!env.DB) return [];
  try {
    const row = await env.DB
      .prepare("SELECT json FROM docs WHERE col = 'users' AND id = ?")
      .bind(uid)
      .first();
    if (!row) return [];
    const data = JSON.parse(row.json);
    return Array.isArray(data.fcmTokens) ? data.fcmTokens.filter(Boolean) : [];
  } catch (e) {
    console.warn(`[push:d1] token lookup failed for ${uid}: ${e.message}`);
    return [];
  }
}

/** Everyone on a team, optionally narrowed to a role (D1). */
export async function teamMemberIds(env, accessToken, teamId, role) {
  if (!env.DB) return [];
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT id, json FROM docs WHERE col = 'users' AND team_id = ? LIMIT 500`
      )
      .bind(teamId)
      .all();
    return (results || [])
      .map((r) => {
        try { return { id: r.id, role: JSON.parse(r.json).role }; } catch { return null; }
      })
      .filter(Boolean)
      .filter((u) => !role || u.role === role)
      .map((u) => u.id);
  } catch (e) {
    console.warn(`[push:d1] team lookup failed for ${teamId}: ${e.message}`);
    return [];
  }
}

/**
 * Send one notification to a list of device tokens.
 *
 * FCM v1 has no multicast endpoint, so each token is a separate call.
 * Failures are collected rather than thrown: one stale token from an
 * uninstalled app must not stop the rest of the team being notified.
 */
export async function sendToTokens(env, accessToken, tokens, payload) {
  const endpoint =
    `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;

  let sent = 0;
  const stale = [];

  await Promise.all(
    tokens.map(async (token) => {
      const message = {
        message: {
          token,
          notification: { title: payload.title, body: payload.body },
          data: Object.fromEntries(
            Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
          ),
          android: {
            priority: 'HIGH',
            notification: { channel_id: payload.channel || 'tasks' },
          },
        },
      };

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });
        if (res.ok) {
          sent++;
        } else if (res.status === 404 || res.status === 400) {
          // The device uninstalled or the token rotated.
          stale.push(token);
        }
      } catch (_) {
        /* network blip; the next notification will try again */
      }
    })
  );

  return { sent, stale };
}
