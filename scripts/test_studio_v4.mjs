#!/usr/bin/env node
/**
 * Tests for the AGENT V4 wave — the HOSTING FABRIC:
 *   1. VAULT: AES-GCM credential sealing, ciphertext-at-rest, wrong-key
 *      isolation (rotate secret → reconnect required)
 *   2. CONNECTORS: connect_platform live-verifies before storing (GitHub /
 *      Vercel / Firebase / GoDaddy / Hostinger), rejects bad credentials,
 *      status + disconnect lifecycle
 *   3. PUBLISH: real deploy chains for github (+custom domain), vercel,
 *      firebase (JWT→token→version→upload→finalize→release); deployment
 *      history recorded per artifact; notes and unknown ids rejected
 *   4. DOMAINS: GoDaddy/Hostinger domain listing + CNAME pointing
 *   5. ROLES: viewer can read status but cannot connect/publish (tool AND
 *      REST layers)
 *   6. REST + MCP: /v1/studio/* through worker.fetch with a REAL RS256
 *      Firebase JWT (mocked Google JWKs); new tools visible over MCP
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 22+.
 *   node scripts/test_studio_v4.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createSign, createPublicKey } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ID = 'nebula-crm-70f58';

/* ── D1 stand-in (real SQLite on the shipped schema) ────────────── */
function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(here, '../cloudflare/worker/schema.sql'), 'utf8'));
  return {
    __sqlite: sqlite,
    prepare(sql) {
      let args = [];
      const b = {
        bind(...a) { args = a; return b; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() { const i = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(i.changes) } }; },
      };
      return b;
    },
    async batch(stmts) { for (const s of stmts) await s.run(); return {}; },
  };
}

function makeR2() {
  const m = new Map();
  return {
    __map: m,
    async put(key, value, opts = {}) { m.set(key, { value, opts }); return { key }; },
    async get(key) {
      const o = m.get(key);
      if (!o) return null;
      return {
        body: o.value,
        async text() { return typeof o.value === 'string' ? o.value : new TextDecoder().decode(o.value); },
        writeHttpMetadata(h) { h.set('Content-Type', o.opts?.httpMetadata?.contentType || 'application/octet-stream'); },
        httpEtag: '"shim"',
      };
    },
    async delete(key) { m.delete(key); },
  };
}

async function seedDoc(db, col, id, data) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(col, id) DO UPDATE SET json = excluded.json`
  ).bind(col, id, typeof data.teamId === 'string' ? data.teamId : null,
         JSON.stringify(data), now, now).run();
}

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

/* ── Firebase signing keypair (real RS256, mocked JWKs) ─────────── */
const { publicKey: FB_PUB, privateKey: FB_PRIV } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const FB_JWK = FB_PUB.export({ format: 'jwk' }); // { kty, n, e }
const SA_PEM = FB_PRIV.export({ type: 'pkcs8', format: 'pem' }).toString();

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Mint a Firebase-shaped ID token for a uid. */
function fbToken(uid, { kid = 'test-kid', expiresIn = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const body = b64url(JSON.stringify({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: uid,
    iat: now,
    exp: now + expiresIn,
  }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(FB_PRIV);
  return `${head}.${body}.${b64url(sig)}`;
}

/* ── Fetch mock (every provider + Sarvam + Google JWKs) ─────────── */
const captured = { github: [], vercel: [], fhosting: [], godaddy: [], hostinger: [], sarvam: [] };
const flags = { githubUserOk: true, vercelUserOk: true, jwkKid: 'test-kid' };

const STUB_SITE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Nebula Stub</title>
<style>body{font-family:sans-serif;margin:0}.hero{padding:80px 20px;background:#101223;color:#fff;text-align:center}
.hero h1{font-size:40px;margin:0 0 10px}.hero p{opacity:.8;font-size:17px}.wrap{max-width:900px;margin:0 auto;padding:40px 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
</style></head><body><div class="hero"><h1>Diwali Mega Offer</h1><p>Flat 40% off across the store this week only.</p></div>
<div class="wrap"><div class="grid"><div class="card">Fast delivery</div><div class="card">Free returns</div><div class="card">24/7 support</div></div></div>
</body></html>`;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = (init.method || 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : '';
  const jsonRes = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  // Firebase ID-token verification keys (mocked Google JWKs)
  if (u.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) {
    return jsonRes(200, { keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: flags.jwkKid, n: FB_JWK.n, e: FB_JWK.e }] });
  }

  if (u.startsWith('https://api.sarvam.ai/')) {
    captured.sarvam.push(JSON.parse(body).messages?.map((m) => m.content).join('\n'));
    return jsonRes(200, { choices: [{ message: { content: STUB_SITE_HTML }, finish_reason: 'stop' }] });
  }

  // ── GitHub ──
  if (u.startsWith('https://api.github.com/')) {
    captured.github.push({ method, path: u.replace('https://api.github.com', ''), body });
    if (u === 'https://api.github.com/user') {
      if (!flags.githubUserOk) return jsonRes(401, { message: 'Bad credentials' });
      return jsonRes(200, { login: 'testowner', name: 'Test Owner' });
    }
    if (method === 'POST' && u === 'https://api.github.com/user/repos') {
      const name = JSON.parse(body).name;
      return jsonRes(201, { full_name: `testowner/${name}` });
    }
    if (method === 'PUT' && u.includes('/contents/index.html')) return jsonRes(201, { content: { path: 'index.html' } });
    if (method === 'PUT' && u.includes('/contents/CNAME')) return jsonRes(201, { content: { path: 'CNAME' } });
    if (method === 'PATCH' && u.endsWith('/pages')) return jsonRes(200, { cname: JSON.parse(body).cname });
    if (method === 'POST' && u.endsWith('/pages')) return jsonRes(201, { html_url: 'https://testowner.github.io/x/' });
    return jsonRes(404, { message: 'not found (github mock)' });
  }

  // ── Vercel ──
  if (u.startsWith('https://api.vercel.com/')) {
    captured.vercel.push({ method, path: u.replace('https://api.vercel.com', ''), body });
    if (u.startsWith('https://api.vercel.com/v2/user')) {
      if (!flags.vercelUserOk) return jsonRes(403, { error: { code: 'forbidden' } });
      return jsonRes(200, { user: { username: 'testowner-vercel' } });
    }
    if (method === 'POST' && u.startsWith('https://api.vercel.com/v13/deployments')) {
      return jsonRes(200, { url: 'nebula-site-abc1.vercel.app', alias: 'nebula-site-abc1.vercel.app' });
    }
    return jsonRes(404, { error: 'not found (vercel mock)' });
  }

  // ── Google OAuth + Firebase Hosting ──
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    return jsonRes(200, { access_token: 'fb_access_token', expires_in: 3600, token_type: 'Bearer' });
  }
  if (u.startsWith('https://firebasehosting.googleapis.com/')) {
    captured.fhosting.push({ method, path: u.replace('https://firebasehosting.googleapis.com', ''), body });
    if (method === 'POST' && u.includes('/sites?siteId=')) return jsonRes(200, { name: `projects/nebula-crm-70f58/sites/${u.split('siteId=')[1]}` });
    if (method === 'POST' && u.includes('/versions')) {
      return jsonRes(200, { name: 'projects/nebula-crm-70f58/sites/nebula-x/versions/abc', status: 'CREATED', fileUploadUrl: 'https://firebasehosting.googleapis.com/v1beta1/upload/deadbeef' });
    }
    if (method === 'PUT' && u.startsWith('https://firebasehosting.googleapis.com/v1beta1/upload/')) return new Response(null, { status: 200 });
    if (method === 'PATCH' && u.includes('/versions/')) return jsonRes(200, { name: u.split('/v1beta1/')[1], status: 'FINALIZED' });
    if (method === 'POST' && u.includes('/releases')) return jsonRes(200, { name: 'projects/nebula-crm-70f58/sites/nebula-x/releases/1' });
    return jsonRes(404, { error: { message: 'not found (fhosting mock)' } });
  }

  // ── GoDaddy ──
  if (u.startsWith('https://api.godaddy.com/')) {
    captured.godaddy.push({ method, path: u.replace('https://api.godaddy.com', ''), body });
    if (u === 'https://api.godaddy.com/v1/domains') return jsonRes(200, [{ domain: 'mybrand.com', status: 'ACTIVE', expires: '2027-01-01T00:00:00Z' }]);
    if (method === 'PUT' && u.includes('/records/CNAME/')) return new Response(null, { status: 204 });
    return jsonRes(404, {});
  }

  // ── Hostinger ──
  if (u.startsWith('https://developers.hostinger.com/')) {
    captured.hostinger.push({ method, path: u.replace('https://developers.hostinger.com', ''), body });
    if (u === 'https://developers.hostinger.com/api/domains/v1/domains') return jsonRes(200, [{ domain: { name: 'hbrand.com' }, status: 'active' }]);
    if (method === 'PUT' && u.includes('/api/domains/v1/dns/')) return jsonRes(200, {});
    return jsonRes(404, {});
  }

  return jsonRes(404, { error: `unmocked fetch: ${method} ${u}` });
};

/* ── Seed data ──────────────────────────────────────────────────── */
const USERS = [
  { id: 'u_mgr', displayName: 'Asha Rao', role: 'manager', teamId: 'default-team', email: 'asha@team.test' },
  { id: 'u_view', displayName: 'Ria M', role: 'viewer', teamId: 'default-team', email: 'ria@team.test' },
  { id: 'u_rep', displayName: 'Sam P', role: 'salesRep', teamId: 'default-team', email: 'sam@team.test' },
];
const MGR = { uid: 'u_mgr', role: 'manager', displayName: 'Asha Rao', teamId: 'default-team' };
const VIEWER = { uid: 'u_view', role: 'viewer', displayName: 'Ria M', teamId: 'default-team' };

/* ── Modules under test (import AFTER fetch mock installed) ─────── */
const { sealString, openString, storeConnection, readConnection, deleteConnection } =
  await import('../cloudflare/worker/src/emailer/vault.js');
const { connectPlatform, connectorStatus, disconnectPlatform, listPlatformDomains, pointDomain, publishSite, listDeployments } =
  await import('../cloudflare/worker/src/emailer/publish.js');
const { runTool, TOOLS } = await import('../cloudflare/worker/src/emailer/assistant.js');
const { TOOL_SCHEMAS, handleMcp, handleMcpPair } = await import('../cloudflare/worker/src/emailer/mcp.js');
const { saveNote } = await import('../cloudflare/worker/src/emailer/builder.js');
const worker = (await import('../cloudflare/worker/src/index.js')).default;

async function makeEnv(overrides = {}) {
  const db = makeD1();
  for (const u of USERS) {
    await seedDoc(db, 'users', u.id, { displayName: u.displayName, role: u.role, teamId: u.teamId, email: u.email });
  }
  const env = {
    DB: db,
    MEDIA: makeR2(),
    FIREBASE_PROJECT_ID: PROJECT_ID,
    SARVAM_API_KEY: 'sarvam_test',
    VAULT_KEY: 'vault-test-key',
    MAIL_BUSINESS_NAME: 'Nebula CRM',
    MAIL_BRAND_COLOR: '#6C8CFF',
    ...overrides,
  };
  return env;
}

const CTX = { waitUntil: () => {} };
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const store = (env) => createStore(env);

async function studioFetch(env, method, path, token, payload) {
  const req = new Request(`https://worker.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  const res = await worker.fetch(req, env, CTX);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/empty */ }
  return { res, json, text };
}

/* ══ 1. Vault primitives ══════════════════════════════════════════ */
console.log('\n— 1. Vault (AES-GCM credential sealing) —');
const venv = await makeEnv();
const vstore = await store(venv);
{
  const sealed = await sealString(venv, 'ghp_supersecret123');
  ok(sealed.iv && sealed.ct && sealed.iv !== 'ghp_supersecret123', 'seal produces iv + ciphertext');
  ok(await openString(venv, sealed) === 'ghp_supersecret123', 'seal → open roundtrip');

  await storeConnection(venv, vstore, 'u_mgr', 'github', { token: 'ghp_supersecret123' }, 'My GitHub');
  const rawRow = venv.DB.__sqlite.prepare(
    "SELECT json FROM docs WHERE col = 'mail_state' AND id LIKE 'vault:u_mgr:github%'"
  ).get();
  const rawJson = JSON.parse(rawRow.json).value;
  ok(!!rawRow, 'connection record written to state store');
  ok(!rawJson.includes('ghp_supersecret123'), 'ciphertext at rest — token NOT in plaintext storage');

  const conn = await readConnection(venv, vstore, 'u_mgr', 'github');
  ok(conn?.credentials?.token === 'ghp_supersecret123', 'readConnection decrypts');
  ok(conn.label === 'My GitHub', 'connection label preserved');

  // Wrong vault key (rotated secret) must NOT decrypt into garbage.
  const rotenv = { ...venv, VAULT_KEY: 'a-different-secret' };
  const rotstore = await store(rotenv);
  const broken = await readConnection(rotenv, rotstore, 'u_mgr', 'github');
  ok(broken === null, 'rotated vault key → connection reads as disconnected (reconnect required)');

  const missing = await readConnection(venv, vstore, 'u_mgr', 'vercel');
  ok(missing === null, 'unconnected platform reads as null');
  await deleteConnection(vstore, 'u_mgr', 'github');
  ok((await readConnection(venv, vstore, 'u_mgr', 'github')) === null, 'delete destroys the record');
}

/* ══ 2. connect_platform — verify before store ════════════════════ */
console.log('\n— 2. Connectors (live-verified, vault-stored) —');
const env = await makeEnv();
const st = await store(env);
{
  const unknown = await runTool({ tool: 'connect_platform', args: { connector: 'digitalocean', token: 'x' } }, env, st, MGR, CTX);
  ok(unknown.ok === false && /unknown platform/.test(unknown.error), 'unknown platform rejected');

  const missing = await connectPlatform(env, st, MGR, { connector: 'github' });
  ok(missing.ok === false && /missing credential/.test(missing.error), 'missing credential fields rejected');

  flags.githubUserOk = false;
  const bad = await runTool({ tool: 'connect_platform', args: { connector: 'github', token: 'ghp_bad' } }, env, st, MGR, CTX);
  ok(bad.ok === false && /rejected the token/.test(bad.error), 'GitHub bad token rejected by live verify');
  ok((await readConnection(env, st, 'u_mgr', 'github')) === null, 'failed verify stores nothing');

  flags.githubUserOk = true;
  const gh = await runTool({ tool: 'connect_platform', args: { connector: 'github', token: 'ghp_good' } }, env, st, MGR, CTX);
  ok(gh.ok === true && gh.verified_as === 'testowner', 'GitHub connected + verified', JSON.stringify(gh));
  ok((await readConnection(env, st, 'u_mgr', 'github')).credentials.token === 'ghp_good', 'GitHub creds in vault');

  flags.vercelUserOk = false;
  const badv = await runTool({ tool: 'connect_platform', args: { connector: 'vercel', token: 'v_bad' } }, env, st, MGR, CTX);
  ok(badv.ok === false && /rejected/.test(badv.error), 'Vercel bad token rejected');
  flags.vercelUserOk = true;
  const vc = await runTool({ tool: 'connect_platform', args: { connector: 'vercel', token: 'vcl_good' } }, env, st, MGR, CTX);
  ok(vc.ok === true && vc.verified_as === 'testowner-vercel', 'Vercel connected + verified');

  const SA = JSON.stringify({ client_email: 'sa@nebula-crm-70f58.iam.gserviceaccount.com', private_key: SA_PEM, project_id: 'nebula-crm-70f58' });
  const fb = await runTool({ tool: 'connect_platform', args: { connector: 'firebase', service_account_json: SA } }, env, st, MGR, CTX);
  ok(fb.ok === true && fb.verified_as === 'nebula-crm-70f58', 'Firebase service account verified (JWT exchange)', JSON.stringify(fb));

  const badSa = await runTool({ tool: 'connect_platform', args: { connector: 'firebase', service_account_json: '{nope' } }, env, st, MGR, CTX);
  ok(badSa.ok === false && /valid JSON/.test(badSa.error), 'malformed service account JSON rejected');

  const gd = await runTool({ tool: 'connect_platform', args: { connector: 'godaddy', key: 'gk', secret: 'gs' } }, env, st, MGR, CTX);
  ok(gd.ok === true && /1 domain/.test(gd.verified_as), 'GoDaddy key:secret verified via domain list', JSON.stringify(gd));

  const hs = await runTool({ tool: 'connect_platform', args: { connector: 'hostinger', token: 'hs_tok' } }, env, st, MGR, CTX);
  ok(hs.ok === true, 'Hostinger token verified');

  // Empty-credential chat path teaches the user where to connect.
  const teach = await runTool({ tool: 'connect_platform', args: { connector: 'github' } }, env, st, MGR, CTX);
  ok(teach.ok === false && /Studio/.test(teach.error), 'chat connect without creds points at Studio');

  const status = await runTool({ tool: 'connector_status', args: {} }, env, st, MGR, CTX);
  ok(status.ok === true && status.platforms.length === 5, 'status lists 5 platforms');
  ok(status.platforms.filter((p) => p.connected).length === 5,
    '5 platforms connected (github/vercel/firebase/godaddy/hostinger)',
    JSON.stringify(status.platforms.filter((p) => p.connected).map((p) => p.connector)));
  ok(status.platforms.find((p) => p.connector === 'github')?.connectedLabel === 'testowner', 'connectedLabel carries verified identity');

  // A different user sees the same platform list, but none of THIS user's connections.
  const statusOther = await runTool({ tool: 'connector_status', args: {} }, env, st, VIEWER, CTX);
  ok(statusOther.ok === true && statusOther.platforms.every((p) => !p.connected), 'connections are per-user (viewer sees none connected)');
}

/* ══ 3. Build + REST sites surface (real RS256 JWT) ═══════════════ */
console.log('\n— 3. Studio REST: build, sites, serving —');
const mgrTok = fbToken('u_mgr');
let siteId = '';
{
  const noAuth = await studioFetch(env, 'GET', '/v1/studio/connectors', null);
  ok(noAuth.res.status === 401, '/v1/studio behind auth (401 without token)');

  const badTok = await studioFetch(env, 'GET', '/v1/studio/connectors', fbToken('u_mgr', { kid: 'wrong-kid' }));
  ok(badTok.res.status === 401, 'garbage kid → 401 (JWK mismatch)');

  const built = await studioFetch(env, 'POST', '/v1/studio/build', mgrTok, {
    title: 'Diwali Mega Offer', kind: 'promo', brief: 'Flat 40% off across the store for Diwali week. Urgency, offers grid, WhatsApp CTA.',
  });
  ok(built.res.status === 200 && built.json.ok === true, 'POST /v1/studio/build (AI path)', JSON.stringify(built.json).slice(0, 160));
  ok(/^https:\/\/worker\.test\/sites\//.test(built.json.url || ''), 'build returns public URL', built.json.url);
  siteId = built.json.artifact_id;
  ok(captured.sarvam.length === 1, 'Sarvam called once for the build');

  const served = await studioFetch(env, 'GET', `/sites/${siteId}`, null);
  ok(served.res.status === 200 && served.text.includes('Diwali Mega Offer'), 'site publicly served at /sites/<id>');

  const sites = await studioFetch(env, 'GET', '/v1/studio/sites', mgrTok);
  ok(sites.json?.sites?.length === 1 && sites.json.sites[0].id === siteId, 'GET /v1/studio/sites lists the artifact');
  ok(Array.isArray(sites.json.sites[0].deployments), 'sites list carries deployments array');

  const viewerBuild = await studioFetch(env, 'POST', '/v1/studio/build', fbToken('u_view'), { title: 'x', brief: 'y'.repeat(20) });
  ok(viewerBuild.res.status === 403, 'viewer denied building (REST role gate)');

  const nope = await studioFetch(env, 'GET', '/v1/studio/does-not-exist', mgrTok);
  ok(nope.res.status === 404, 'unknown studio route → 404');
}

/* ══ 4. Publish chains ════════════════════════════════════════════ */
console.log('\n— 4. Publish (GitHub / Vercel / Firebase) —');
{
  const notConn = await runTool({ tool: 'publish_site', args: { artifact_id: 'nope', connector: 'vercel' } }, env, st, MGR, CTX);
  // vercel IS connected at this point; use hostinger as the unconnected publish attempt
  const wrongKind = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'hostinger' } }, env, st, MGR, CTX);
  ok(wrongKind.ok === false && /not a publish target/.test(wrongKind.error), 'hostinger is not a publish target', wrongKind.error);

  const ghost = await runTool({ tool: 'publish_site', args: { artifact_id: 's_ghost', connector: 'vercel' } }, env, st, MGR, CTX);
  ok(ghost.ok === false && /not a hosted site/.test(ghost.error), 'unknown artifact rejected');

  const saved = await saveNote(st, MGR, { title: 'Research note', content: 'A '.repeat(300) });
  ok(saved.ok === true, 'note artifact saved for the negative test');
  const notePub = await runTool({ tool: 'publish_site', args: { artifact_id: saved.artifact_id, connector: 'vercel' } }, env, st, MGR, CTX);
  ok(notePub.ok === false && /not a hosted site/.test(notePub.error), 'notes are not publishable');

  // GitHub
  const gh = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'github' } }, env, st, MGR, CTX);
  ok(gh.ok === true && gh.url === 'https://testowner.github.io/nebula-site-' + siteId + '/', 'GitHub Pages URL returned', gh.url);
  ok(gh.repo === `testowner/nebula-site-${siteId}`, 'repo created under verified account');
  ok(captured.github.some((c) => c.method === 'PUT' && c.path.includes('/contents/index.html')), 'index.html committed');
  ok(captured.github.some((c) => c.method === 'POST' && c.path.endsWith('/pages')), 'Pages enabled');
  ok(gh.live === 'building', 'github reports building (first Pages build ~1 min)');
  ok((await listDeployments(st, 'u_mgr', siteId)).length === 1, 'deployment recorded');

  // GitHub with custom domain
  captured.github.length = 0;
  const ghDom = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'github', domain: 'offers.mybrand.com', repo: 'nebula-offers' } }, env, st, MGR, CTX);
  ok(ghDom.ok === true && ghDom.url === 'https://offers.mybrand.com/', 'custom domain publish URL', ghDom.url);
  ok(captured.github.some((c) => c.method === 'PUT' && c.path.includes('/contents/CNAME')), 'CNAME file committed');
  ok(captured.github.some((c) => c.method === 'PATCH' && c.path.endsWith('/pages')), 'Pages cname updated');

  // Vercel
  const vc = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'vercel', repo: 'nebula-offers' } }, env, st, MGR, CTX);
  ok(vc.ok === true && vc.url === 'https://nebula-site-abc1.vercel.app', 'Vercel deployment URL', vc.url);
  ok(captured.vercel.some((c) => c.method === 'POST' && c.path.startsWith('/v13/deployments') && c.body.includes('index.html')), 'inline file deployment sent');
  ok((await listDeployments(st, 'u_mgr', siteId)).length === 3, '3 deployments recorded');

  // Firebase
  captured.fhosting.length = 0;
  const fb = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'firebase', site_id: 'nebula-x' } }, env, st, MGR, CTX);
  ok(fb.ok === true && fb.url === 'https://nebula-x.web.app', 'Firebase Hosting release URL', fb.url);
  ok(captured.fhosting.some((c) => c.method === 'POST' && c.path.includes('/versions') && c.body.includes('CREATED')), 'version created');
  ok(captured.fhosting.some((c) => c.method === 'PUT' && c.path.startsWith('/v1beta1/upload/')), 'file bytes uploaded');
  ok(captured.fhosting.some((c) => c.method === 'PATCH' && c.path.includes('/versions/') && c.body.includes('FINALIZED')), 'version finalized');
  ok(captured.fhosting.some((c) => c.method === 'POST' && c.path.includes('/releases')), 'released to live channel');
  ok((await listDeployments(st, 'u_mgr', siteId)).length === 4, '4 deployments recorded');

  // Deployments REST
  const dep = await studioFetch(env, 'GET', `/v1/studio/deployments?artifact_id=${siteId}`, mgrTok);
  ok(dep.json?.deployments?.length === 4, 'GET deployments returns history');
  ok(dep.json.deployments.every((d) => d.ok === true && d.url), 'history entries carry url + ok');
}

/* ══ 5. Domains: list + point ═════════════════════════════════════ */
console.log('\n— 5. Domains (GoDaddy / Hostinger) —');
{
  const gd = await runTool({ tool: 'list_platform_domains', args: { connector: 'godaddy' } }, env, st, MGR, CTX);
  ok(gd.ok === true && gd.domains[0].domain === 'mybrand.com', 'GoDaddy domains listed');
  const hs = await runTool({ tool: 'list_platform_domains', args: { connector: 'hostinger' } }, env, st, MGR, CTX);
  ok(hs.ok === true && hs.domains[0].domain === 'hbrand.com', 'Hostinger domains listed');
  const bad = await runTool({ tool: 'list_platform_domains', args: { connector: 'github' } }, env, st, MGR, CTX);
  ok(bad.ok === false, 'github is not a registrar');

  const pd = await pointDomain(env, st, MGR, { connector: 'godaddy', domain: 'mybrand.com', name: 'www', target: 'testowner.github.io' });
  ok(pd.ok === true && /CNAME www\.mybrand\.com → testowner\.github\.io/.test(pd.note), 'GoDaddy CNAME pointed', pd.note);
  ok(captured.godaddy.some((c) => c.method === 'PUT' && c.path.includes('/records/CNAME/www')), 'GoDaddy DNS API called');
  const pdh = await pointDomain(env, st, MGR, { connector: 'hostinger', domain: 'hbrand.com', target: 'nebula-site-abc1.vercel.app' });
  ok(pdh.ok === true, 'Hostinger CNAME pointed');
  ok(captured.hostinger.some((c) => c.method === 'PUT' && c.path.includes('/dns/hbrand.com')), 'Hostinger DNS API called');

  const invalid = await pointDomain(env, st, MGR, { connector: 'godaddy', domain: 'not a domain', target: 'x' });
  ok(invalid.ok === false && /not a valid domain/.test(invalid.error), 'invalid domain rejected');

  const rest = await studioFetch(env, 'POST', '/v1/studio/point-domain', mgrTok, { connector: 'godaddy', domain: 'mybrand.com', name: 'shop', target: 'nebula-site-abc1.vercel.app' });
  ok(rest.res.status === 200 && rest.json.ok === true, 'POST /v1/studio/point-domain works');
}

/* ══ 6. Roles (tool + REST) ═══════════════════════════════════════ */
console.log('\n— 6. Role enforcement —');
{
  const viewPub = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'github' } }, env, st, VIEWER, CTX);
  ok(viewPub.ok === false && viewPub.notPermitted === true, 'viewer denied publish (tool layer)');
  const viewConn = await runTool({ tool: 'connect_platform', args: { connector: 'github', token: 'x' } }, env, st, VIEWER, CTX);
  ok(viewConn.ok === false && viewConn.notPermitted === true, 'viewer denied connect (tool layer)');
  const viewStatus = await runTool({ tool: 'connector_status', args: {} }, env, st, VIEWER, CTX);
  ok(viewStatus.ok === true, 'viewer CAN read connector status');
  const restPub = await studioFetch(env, 'POST', '/v1/studio/publish', fbToken('u_view'), { artifact_id: siteId, connector: 'github' });
  ok(restPub.res.status === 403, 'viewer denied publish (REST layer)');
  const restConn = await studioFetch(env, 'POST', '/v1/studio/connect', fbToken('u_view'), { connector: 'github', token: 'x' });
  ok(restConn.res.status === 403, 'viewer denied connect (REST layer)');

  // salesRep CAN build but CANNOT publish
  const repBuild = await studioFetch(env, 'POST', '/v1/studio/build', fbToken('u_rep'), { title: 'Rep page', kind: 'landing', brief: 'A landing page for rep demos, clean and bold.' });
  ok(repBuild.res.status === 200 && repBuild.json.ok === true, 'salesRep can build');
  const repPub = await studioFetch(env, 'POST', '/v1/studio/publish', fbToken('u_rep'), { artifact_id: siteId, connector: 'github' });
  ok(repPub.res.status === 403, 'salesRep denied publish');
}

/* ══ 7. MCP surface carries the new tools ═════════════════════════ */
console.log('\n— 7. MCP: new tools exposed + callable —');
{
  const names = Object.keys(TOOLS);
  for (const t of ['connector_status', 'connect_platform', 'disconnect_platform', 'list_platform_domains', 'publish_site']) {
    ok(names.includes(t) && !!TOOL_SCHEMAS[t], `MCP schema present: ${t}`);
  }
  ok(names.length === 28, 'tool registry is 28 tools', String(names.length));

  // Pair a grant and call connector_status + publish over MCP.
  const pairReq = new Request('https://worker.test/v1/assistant/mcp/pair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Cursor' }),
  });
  const pairRes = await handleMcpPair(pairReq, env, { uid: 'u_mgr' });
  const grant = (await pairRes.json()).token;

  async function rpc(method, params, id = 1) {
    const req = new Request('https://worker.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${grant}` },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }),
    });
    const res = await handleMcp(req, env, CTX);
    return { res, json: await res.json() };
  }

  await rpc('initialize', { protocolVersion: '2025-03-26' });
  const list = await rpc('tools/list');
  const listed = list.json.result.tools.map((t) => t.name);
  ok(['connector_status', 'connect_platform', 'disconnect_platform', 'list_platform_domains', 'publish_site'].every((t) => listed.includes(t)),
    'tools/list shows all 5 hosting tools');
  ok(listed.length === 28, 'tools/list count is 28', String(listed.length));

  const stCall = await rpc('tools/call', { name: 'connector_status', arguments: {} });
  const stPayload = JSON.parse(stCall.json.result.content[0].text);
  ok(stPayload.ok === true && stPayload.platforms.length === 5, 'connector_status executes over MCP');

  const pub = await rpc('tools/call', { name: 'publish_site', arguments: { artifact_id: siteId, connector: 'vercel', repo: 'mcp-deploy' } });
  const pubPayload = JSON.parse(pub.json.result.content[0].text);
  ok(pubPayload.ok === true && pubPayload.external_url === 'https://nebula-site-abc1.vercel.app', 'publish_site executes over MCP', pubPayload.external_url);

  flags.githubUserOk = false; // force verify failure for this attempt
  const denied2 = await rpc('tools/call', { name: 'connect_platform', arguments: { connector: 'github', token: 'ghp_x' } });
  flags.githubUserOk = true;
  const deniedPayload = JSON.parse(denied2.json.result.content[0].text);
  ok(deniedPayload.ok === false && /rejected/.test(deniedPayload.error), 'MCP connect still live-verifies credentials');

  const rev = new Request('https://worker.test/v1/assistant/mcp/pair', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
  });
  const revRes = await handleMcpPair(rev, env, { uid: 'u_mgr' });
  ok((await revRes.json()).ok === true, 'grants revoked (vault untouched — platform connections persist)');
  const connAfter = await readConnection(env, st, 'u_mgr', 'github');
  ok(connAfter?.credentials?.token === 'ghp_good', 'platform connection survives MCP grant revoke');
}

/* ══ 8. Disconnect lifecycle ══════════════════════════════════════ */
console.log('\n— 8. Disconnect —');
{
  const gone = await runTool({ tool: 'disconnect_platform', args: { connector: 'github' } }, env, st, MGR, CTX);
  ok(gone.ok === true, 'disconnect succeeds');
  const again = await runTool({ tool: 'disconnect_platform', args: { connector: 'github' } }, env, st, MGR, CTX);
  ok(again.ok === false && /was not connected/.test(again.error), 'double disconnect reports not connected');
  const pubAfter = await runTool({ tool: 'publish_site', args: { artifact_id: siteId, connector: 'github' } }, env, st, MGR, CTX);
  ok(pubAfter.ok === false && /not connected/.test(pubAfter.error), 'publish after disconnect fails cleanly');

  const restDel = await studioFetch(env, 'DELETE', '/v1/studio/connect?connector=vercel', mgrTok);
  ok(restDel.res.status === 200 && restDel.json.ok === true, 'DELETE /v1/studio/connect works');
  const status = await runTool({ tool: 'connector_status', args: {} }, env, st, MGR, CTX);
  ok(status.platforms.filter((p) => p.connected).length === 3, 'only firebase + godaddy + hostinger remain connected');
}

/* ══ Summary ══════════════════════════════════════════════════════ */
console.log(`\n══════════════════════════════════════`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
if (failed) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  • ' + f);
  process.exit(1);
}
