/**
 * Firebase ID-token verification — shared by every authenticated surface.
 *
 * Extracted from index.js when the MCP endpoint arrived: /mcp must accept
 * EITHER a Firebase ID token (the in-app agent) OR a short-lived pairing
 * grant minted by the app (external MCP clients), so the verification code
 * needs to be importable without a circular dependency back into index.js.
 *
 * A token is trusted only when ALL of these hold:
 *   • RS256 signature verifies against Google's rotating public JWKs
 *   • issuer is this project's securetoken endpoint
 *   • audience is this project
 *   • not expired, and it carries a subject
 * Anything else reads as anonymous.
 */

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
 */
export async function verifyIdToken(token, projectId) {
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
