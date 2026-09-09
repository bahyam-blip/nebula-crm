/**
 * HOSTING FABRIC — external hosting/domain connectors + the publish
 * pipeline. This is the "build → host → keep the code → point a domain"
 * story, all from inside the app:
 *
 *   connect_platform   — store platform credentials in the encrypted vault
 *                        (GitHub PAT, Vercel token, Firebase service
 *                        account, GoDaddy key:secret, Hostinger token)
 *   connector_status   — what is connected + what each platform can do
 *   disconnect_platform— remove a stored connection
 *   list_platform_domains — domains you own on GoDaddy / Hostinger
 *   publish_site       — push a BUILT artifact (sites/<id>.html) to the
 *                        platform and return the real public URL:
 *                          github   → repo + Pages  (owner.github.io/repo)
 *                          vercel   → instant deploy (*.vercel.app)
 *                          firebase → Hosting release (*.web.app)
 *   + domain pointing  — CNAME a GoDaddy/Hostinger domain at the deployed
 *                        site (real custom-domain chain)
 *
 * Every connector driver is provider-REST, token comes from the VAULT
 * (never from the request), and deployments are recorded per artifact so
 * the app can show "where is this site live".
 */

import { readConnection, storeConnection, listConnectionMetas, deleteConnection } from './vault.js';

const DEPLOY_CAP = 20;

/* ══ Platform registry (what the app shows in Connect) ═══════════════ */

export const CONNECTORS = {
  github: {
    name: 'GitHub',
    kind: 'hosting+code',
    what: 'Keeps your code in a repo and publishes it free on GitHub Pages (username.github.io).',
    fields: [{ key: 'token', label: 'Personal access token (repo + pages scope)', secret: true }],
  },
  vercel: {
    name: 'Vercel',
    kind: 'hosting',
    what: 'Instant global deployment on *.vercel.app with CDN, HTTPS and previews.',
    fields: [{ key: 'token', label: 'Vercel access token', secret: true }],
  },
  firebase: {
    name: 'Firebase Hosting',
    kind: 'hosting',
    what: 'Publishes to your Firebase project (*.web.app) alongside the CRM auth.',
    fields: [{ key: 'service_account_json', label: 'Service account JSON (with Firebase Hosting enabled)', secret: true, multiline: true }],
  },
  godaddy: {
    name: 'GoDaddy',
    kind: 'domains',
    what: 'Your domains: point www.yourbrand.com at any site this agent deploys.',
    fields: [
      { key: 'key', label: 'API key', secret: true },
      { key: 'secret', label: 'API secret', secret: true },
    ],
  },
  hostinger: {
    name: 'Hostinger',
    kind: 'domains',
    what: 'Your domains: DNS control to point hosts at deployed sites.',
    fields: [{ key: 'token', label: 'Hostinger API token (domains scope)', secret: true }],
  },
  supabase: {
    name: 'Supabase',
    kind: 'backend',
    what: 'Your app database: the agent runs SQL, provisions tables and seeds data for the web apps it builds.',
    fields: [
      { key: 'access_token', label: 'Personal access token (api.supabase.com/account/tokens)', secret: true },
      { key: 'project_ref', label: 'Project ref (abcdefg.supabase.co → the abcdefg part)' },
    ],
  },
};

function normalizeCreds(connector, args = {}) {
  const c = {};
  if (connector === 'github' || connector === 'vercel' || connector === 'hostinger') {
    c.token = String(args.token || '').trim();
  } else if (connector === 'godaddy') {
    c.key = String(args.key || '').trim();
    c.secret = String(args.secret || '').trim();
  } else if (connector === 'supabase') {
    c.access_token = String(args.access_token || '').trim();
    c.project_ref = String(args.project_ref || '').trim().replace(/\.supabase\.co.*$/i, '');
  } else if (connector === 'firebase') {
    const raw = String(args.service_account_json || '').trim();
    try { Object.assign(c, JSON.parse(raw)); } catch { throw new Error('service_account_json must be valid JSON'); }
    for (const k of ['client_email', 'private_key', 'project_id']) {
      if (!c[k]) throw new Error(`service account JSON is missing "${k}"`);
    }
  }
  return c;
}

function missingFields(connector, args = {}) {
  const need = CONNECTORS[connector]?.fields.map((f) => f.key) || [];
  const miss = need.filter((k) => {
    const v = args[k];
    return v === undefined || v === null || String(v).trim() === '';
  });
  return miss;
}

/* ══ Shared fetch helpers ════════════════════════════════════════════ */

async function apiFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': 'nebula-crm-agent',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
  return { status: res.status, ok: res.ok, body };
}

function b64encodeBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64encodeUtf8(str) {
  return b64encodeBytes(new TextEncoder().encode(str));
}

async function sha256B64(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return b64encodeBytes(new Uint8Array(d));
}

/* ══ GitHub ══════════════════════════════════════════════════════════ */

async function githubVerify(creds) {
  const r = await apiFetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!r.ok) return { ok: false, error: `GitHub rejected the token (HTTP ${r.status})` };
  return { ok: true, login: r.body?.login || '', name: r.body?.name || r.body?.login || '' };
}

async function githubPublish(creds, html, opts = {}) {
  const v = await githubVerify(creds);
  if (!v.ok) return v;
  const repo = String(opts.repo || `nebula-site-${opts.artifactId || Date.now().toString(36)}`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .slice(0, 90);

  // 1. create the repo (exists → reuse)
  let full = '';
  const created = await apiFetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: repo, private: false, description: opts.title || 'Site deployed by Nebula CRM agent' }),
  });
  if (created.ok && created.body?.full_name) {
    full = created.body.full_name;
  } else if (created.status === 422 || created.status === 409) {
    full = `${v.login}/${repo}`;
  } else {
    return { ok: false, error: `GitHub repo create failed (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 200)}` };
  }

  // 2. commit index.html
  const put = await apiFetch(`https://api.github.com/repos/${full}/contents/index.html`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Deploy via Nebula CRM agent',
      content: b64encodeUtf8(html),
    }),
  });
  if (!put.ok) {
    return { ok: false, error: `GitHub file commit failed (HTTP ${put.status}): ${JSON.stringify(put.body).slice(0, 200)}` };
  }

  // 3. optional custom domain: commit CNAME + register it with Pages
  if (opts.domain) {
    await apiFetch(`https://api.github.com/repos/${full}/contents/CNAME`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Custom domain via Nebula CRM agent', content: b64encodeUtf8(String(opts.domain)) }),
    });
    await apiFetch(`https://api.github.com/repos/${full}/pages`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cname: String(opts.domain), https_enforced: true }),
    });
  }

  // 4. enable Pages from main /
  const pages = await apiFetch(`https://api.github.com/repos/${full}/pages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
  });
  const pagesEnabled = pages.ok || pages.status === 409; // 409 = already enabled

  const url = opts.domain
    ? `https://${String(opts.domain).replace(/^https?:\/\//, '')}/`
    : `https://${v.login}.github.io/${repo}/`;
  return {
    ok: true,
    url,
    repo: full,
    repoUrl: `https://github.com/${full}`,
    live: 'building', // Pages takes ~1 min on first build
    pagesEnabled,
    note: `Code committed to ${full} and GitHub Pages publishing started. The site is usually live within a minute.`,
  };
}

/* ══ Vercel ══════════════════════════════════════════════════════════ */

async function vercelVerify(creds) {
  const r = await apiFetch('https://api.vercel.com/v2/user', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!r.ok) return { ok: false, error: `Vercel rejected the token (HTTP ${r.status})` };
  return { ok: true, login: r.body?.user?.username || r.body?.user?.email || 'vercel' };
}

async function vercelPublish(creds, html, opts = {}) {
  const v = await vercelVerify(creds);
  if (!v.ok) return v;
  const project = String(opts.repo || `nebula-site-${opts.artifactId || Date.now().toString(36)}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 80);
  const r = await apiFetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: project,
      files: [{ file: 'index.html', data: b64encodeUtf8(html), encoding: 'base64' }],
      projectSettings: { framework: null },
      target: 'production',
    }),
  });
  if (!r.ok) {
    return { ok: false, error: `Vercel deploy failed (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 220)}` };
  }
  const host = r.body?.url || r.body?.alias;
  return {
    ok: true,
    url: `https://${host}`,
    project,
    live: 'building',
    note: `Deployed to Vercel as "${project}". The URL above goes live within seconds.`,
  };
}

/* ══ Firebase Hosting ════════════════════════════════════════════════ */

function pemToPkcs8(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const s = atob(body);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

async function firebaseAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => b64encodeUtf8(JSON.stringify(o)).replace(/=+$/, '');
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claims = enc({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.hosting',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(creds.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${head}.${claims}`)
  );
  const assertion = `${head}.${claims}.${b64encodeBytes(new Uint8Array(sig)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const r = await apiFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!r.ok || !r.body?.access_token) {
    return { ok: false, error: `Firebase token exchange failed (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 200)}` };
  }
  return { ok: true, token: r.body.access_token };
}

async function firebaseVerify(creds) {
  const t = await firebaseAccessToken(creds);
  if (!t.ok) return t;
  return { ok: true, login: creds.project_id, project_id: creds.project_id };
}

async function firebasePublish(creds, html, opts = {}) {
  const t = await firebaseAccessToken(creds);
  if (!t.ok) return t;
  const auth = { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/json' };
  const pid = creds.project_id;
  const sid = String(opts.site_id || `nebula-${opts.artifactId || Date.now().toString(36)}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 30);

  // 1. ensure the site exists (ALREADY_EXISTS → reuse)
  const createSite = await apiFetch(`https://firebasehosting.googleapis.com/v1beta1/projects/${pid}/sites?siteId=${sid}`, {
    method: 'POST', headers: auth, body: JSON.stringify({}),
  });
  if (!createSite.ok && createSite.status !== 409 && !/ALREADY_EXISTS/i.test(JSON.stringify(createSite.body))) {
    return { ok: false, error: `Firebase site create failed (HTTP ${createSite.status}): ${JSON.stringify(createSite.body).slice(0, 200)}` };
  }

  // 2. create a version — response carries fileUploadUrl
  const ver = await apiFetch(`https://firebasehosting.googleapis.com/v1beta1/projects/${pid}/sites/${sid}/versions`, {
    method: 'POST', headers: auth, body: JSON.stringify({ status: 'CREATED' }),
  });
  if (!ver.ok || !ver.body?.name) {
    return { ok: false, error: `Firebase version create failed (HTTP ${ver.status}): ${JSON.stringify(ver.body).slice(0, 200)}` };
  }
  const versionName = ver.body.name;
  const uploadBase = ver.body.fileUploadUrl || '';

  // 3. upload file bytes (hash is registered in the version)
  const bytes = new TextEncoder().encode(html);
  const hash = await sha256B64(bytes);
  if (uploadBase) {
    const up = await fetch(`${uploadBase}?file=${encodeURIComponent('/index.html')}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${t.token}`, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!up.ok) {
      const detail = await up.text().catch(() => '');
      return { ok: false, error: `Firebase file upload failed (HTTP ${up.status}): ${detail.slice(0, 200)}` };
    }
  }

  // 4. finalize the version with the file manifest
  const fin = await apiFetch(`https://firebasehosting.googleapis.com/v1beta1/${versionName}?update_mask=status,files`, {
    method: 'PATCH', headers: auth,
    body: JSON.stringify({ status: 'FINALIZED', files: [{ path: '/index.html', hash }] }),
  });
  if (!fin.ok) {
    return { ok: false, error: `Firebase version finalize failed (HTTP ${fin.status}): ${JSON.stringify(fin.body).slice(0, 200)}` };
  }

  // 5. release to the live channel
  const rel = await apiFetch(`https://firebasehosting.googleapis.com/v1beta1/projects/${pid}/sites/${sid}/releases`, {
    method: 'POST', headers: auth, body: JSON.stringify({ message: 'Deploy via Nebula CRM agent', versionName }),
  });
  if (!rel.ok) {
    return { ok: false, error: `Firebase release failed (HTTP ${rel.status}): ${JSON.stringify(rel.body).slice(0, 200)}` };
  }

  return {
    ok: true,
    url: `https://${sid}.web.app`,
    site: sid,
    live: 'building',
    note: `Released on Firebase Hosting. https://${sid}.web.app is live within seconds.`,
  };
}

/* ══ Domain registrars (GoDaddy / Hostinger) ═════════════════════════ */

async function godaddyHeaders(creds) {
  return { Authorization: `sso-key ${creds.key}:${creds.secret}` };
}

async function godaddyListDomains(creds) {
  const h = await godaddyHeaders(creds);
  const r = await apiFetch('https://api.godaddy.com/v1/domains', { headers: h });
  if (!r.ok) return { ok: false, error: `GoDaddy rejected the key pair (HTTP ${r.status})` };
  const domains = (Array.isArray(r.body) ? r.body : [])
    .map((d) => ({ domain: d.domain, expires: d.expires || null, status: d.status || null }));
  return { ok: true, domains };
}

async function godaddyUpsertCname(creds, domain, name, target) {
  const h = await godaddyHeaders(creds);
  const r = await apiFetch(`https://api.godaddy.com/v1/domains/${encodeURIComponent(domain)}/records/CNAME/${encodeURIComponent(name || 'www')}`, {
    method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ data: target, ttl: 3600 }]),
  });
  if (!r.ok) return { ok: false, error: `GoDaddy DNS update failed (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 200)}` };
  return { ok: true, note: `CNAME ${name || 'www'}.${domain} → ${target} set. DNS propagates within minutes to an hour.` };
}

async function hostingerListDomains(creds) {
  const r = await apiFetch('https://developers.hostinger.com/api/domains/v1/domains', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!r.ok) return { ok: false, error: `Hostinger rejected the token (HTTP ${r.status})` };
  const list = Array.isArray(r.body) ? r.body : (r.body?.data || []);
  const domains = list
    .map((d) => ({ domain: d.domain?.name || d.name || d.domain, expires: d.expires_at || null, status: d.status || null }))
    .filter((d) => d.domain);
  return { ok: true, domains };
}

async function hostingerUpsertCname(creds, domain, name, target) {
  const r = await apiFetch(`https://developers.hostinger.com/api/domains/v1/dns/${encodeURIComponent(domain)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overwrite: true,
      records: [{ type: 'CNAME', name: name || 'www', content: target, ttl: 3600 }],
    }),
  });
  if (!r.ok) return { ok: false, error: `Hostinger DNS update failed (HTTP ${r.status}): ${JSON.stringify(r.body).slice(0, 200)}` };
  return { ok: true, note: `CNAME ${name || 'www'}.${domain} → ${target} set. DNS propagates within minutes to an hour.` };
}

/* ══ Supabase (backend for the apps the agent builds) ═══════════════ */

async function supabaseVerify(creds) {
  const r = await apiFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(creds.project_ref)}`, {
    headers: { Authorization: `Bearer ${creds.access_token}` },
  });
  if (!r.ok) {
    return {
      ok: false,
      error: r.status === 401 || r.status === 403
        ? `Supabase rejected the access token (HTTP ${r.status})`
        : `Supabase project "${creds.project_ref}" not reachable (HTTP ${r.status})`,
    };
  }
  return { ok: true, name: r.body?.name || creds.project_ref };
}

/** Run SQL through the Supabase Management API (DDL + DML both allowed). */
async function supabaseRunSql(creds, query) {
  const r = await apiFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(creds.project_ref)}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: String(query || '').slice(0, 20000) }),
  });
  if (!r.ok) {
    const msg = typeof r.body === 'string' ? r.body.slice(0, 300) : JSON.stringify(r.body)?.slice(0, 300);
    return { ok: false, error: `Supabase SQL failed (HTTP ${r.status}): ${msg}` };
  }
  return { ok: true, rows: r.body, note: 'SQL executed.' };
}

/* ══ Tool surfaces (called from runTool + /v1/studio) ════════════════ */

export async function connectPlatform(env, store, user, args) {
  const connector = String(args.connector || '').trim();
  const spec = CONNECTORS[connector];
  if (!spec) return { ok: false, error: `unknown platform "${connector}" — one of: ${Object.keys(CONNECTORS).join(', ')}` };
  const miss = missingFields(connector, args);
  if (miss.length) return { ok: false, error: `missing credential field(s): ${miss.join(', ')}` };

  let creds;
  try {
    creds = normalizeCreds(connector, args);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  // LIVE verification before storing — no broken connections saved.
  let verify;
  try {
    verify = connector === 'github' ? await githubVerify(creds)
      : connector === 'vercel' ? await vercelVerify(creds)
      : connector === 'firebase' ? await firebaseVerify(creds)
      : connector === 'godaddy' ? await godaddyListDomains(creds)
      : connector === 'supabase' ? await supabaseVerify(creds)
      : await hostingerListDomains(creds);
  } catch (e) {
    verify = { ok: false, error: `could not reach ${spec.name}: ${String(e).slice(0, 140)}` };
  }
  if (!verify.ok) return { ok: false, error: verify.error || `could not verify ${spec.name}` };

  await storeConnection(env, store, user?.uid || '', connector, creds, args.label || verify.login || verify.name || spec.name);
  const verifiedAs = verify.login
    || verify.name
    || (Array.isArray(verify.domains) && verify.domains.length ? `${verify.domains.length} domain(s)` : '')
    || spec.name;
  return {
    ok: true,
    connector,
    verified_as: verifiedAs,
    note: `${spec.name} connected and verified. Publish to it any time — no tokens needed in chat.`,
  };
}

export async function connectorStatus(env, store, user) {
  const metas = await listConnectionMetas(env, store, user?.uid || '');
  const byConn = Object.fromEntries(metas.map((m) => [m.connector, m]));
  return {
    ok: true,
    platforms: Object.entries(CONNECTORS).map(([id, spec]) => ({
      connector: id,
      name: spec.name,
      kind: spec.kind,
      what: spec.what,
      connected: !!byConn[id],
      connectedLabel: byConn[id]?.label || null,
      connectedAt: byConn[id]?.createdAt || null,
    })),
  };
}

export async function disconnectPlatform(env, store, user, args) {
  const connector = String(args.connector || '').trim();
  if (!CONNECTORS[connector]) return { ok: false, error: `unknown platform "${connector}"` };
  const existing = await readConnection(env, store, user?.uid || '', connector);
  if (!existing) return { ok: false, error: `${CONNECTORS[connector].name} was not connected` };
  await deleteConnection(store, user?.uid || '', connector);
  return { ok: true, note: `${CONNECTORS[connector].name} disconnected. Stored credentials destroyed.` };
}

/**
 * supabase_sql — run SQL against the connected Supabase project.
 * This is how a built web app gets a REAL backend: "create the orders
 * table my new app uses" → CREATE TABLE lands in the owner's database.
 * Manager-gated at the registry; credentials come from the vault.
 */
export async function supabaseQuery(env, store, user, args) {
  const query = String(args.query || args.sql || '').trim();
  if (!query) return { ok: false, error: 'query (SQL) is required' };
  const conn = await readConnection(env, store, user?.uid || '', 'supabase');
  if (!conn) {
    return { ok: false, error: 'Supabase is not connected — connect it once from Studio → Hosting (access token + project ref); after that SQL needs no tokens' };
  }
  try {
    return await supabaseRunSql(conn.credentials, query);
  } catch (e) {
    return { ok: false, error: `could not reach Supabase: ${String(e).slice(0, 140)}` };
  }
}

export async function listPlatformDomains(env, store, user, args) {
  const connector = String(args.connector || '').trim();
  if (!['godaddy', 'hostinger'].includes(connector)) {
    return { ok: false, error: 'list_platform_domains works with godaddy or hostinger connections' };
  }
  const conn = await readConnection(env, store, user?.uid || '', connector);
  if (!conn) return { ok: false, error: `${CONNECTORS[connector].name} is not connected yet — connect it first` };
  return connector === 'godaddy' ? godaddyListDomains(conn.credentials) : hostingerListDomains(conn.credentials);
}

/** Point a domain host at a target (CNAME). Used for custom-domain chains. */
export async function pointDomain(env, store, user, args) {
  const connector = String(args.connector || '').trim();
  const domain = String(args.domain || '').trim();
  const target = String(args.target || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!['godaddy', 'hostinger'].includes(connector)) {
    return { ok: false, error: 'point_domain works with godaddy or hostinger connections' };
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return { ok: false, error: `"${domain}" is not a valid domain` };
  if (!target) return { ok: false, error: 'target host is required (e.g. you.github.io or your-site.vercel.app)' };
  const conn = await readConnection(env, store, user?.uid || '', connector);
  if (!conn) return { ok: false, error: `${CONNECTORS[connector].name} is not connected yet — connect it first` };
  return connector === 'godaddy'
    ? godaddyUpsertCname(conn.credentials, domain, args.name || 'www', target)
    : hostingerUpsertCname(conn.credentials, domain, args.name || 'www', target);
}

export async function listDeployments(store, uid, artifactId) {
  if (!store || !uid) return [];
  const raw = await store.get(`agent:deploys:${uid}:${artifactId}`);
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function recordDeployment(store, uid, artifactId, entry) {
  if (!store || !uid || !artifactId) return;
  const list = await listDeployments(store, uid, artifactId);
  list.unshift(entry);
  await store.put(`agent:deploys:${uid}:${artifactId}`, JSON.stringify(list.slice(0, DEPLOY_CAP)));
}

/**
 * publish_site — push a BUILT site artifact to a connected platform.
 * args: {artifact_id, connector, repo?, domain?, site_id?, title?}
 */
export async function publishSite(env, store, user, args) {
  const artifactId = String(args.artifact_id || '').trim();
  const connector = String(args.connector || '').trim();
  if (!artifactId) return { ok: false, error: 'artifact_id is required (use list_artifacts)' };
  if (!['github', 'vercel', 'firebase'].includes(connector)) {
    return { ok: false, error: `"${connector}" is not a publish target — publish works with github, vercel or firebase; use point-domain for registrar DNS` };
  }
  if (!CONNECTORS[connector]) return { ok: false, error: `unknown platform "${connector}"` };

  const conn = await readConnection(env, store, user?.uid || '', connector);
  if (!conn) return { ok: false, error: `${CONNECTORS[connector].name} is not connected yet — connect it first (Studio → Hosting)` };

  // Load the built site: R2 first, notes are not publishable.
  let html = null;
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(`sites/${artifactId}.html`).catch(() => null);
    if (obj) html = await obj.text();
  }
  if (!html) {
    return { ok: false, error: `artifact "${artifactId}" is not a hosted site (notes cannot be published) — build one with build_website` };
  }

  const opts = {
    artifactId,
    repo: args.repo,
    domain: args.domain,
    site_id: args.site_id,
    title: args.title,
  };
  let result;
  try {
    result = connector === 'github' ? await githubPublish(conn.credentials, html, opts)
      : connector === 'vercel' ? await vercelPublish(conn.credentials, html, opts)
      : await firebasePublish(conn.credentials, html, opts);
  } catch (e) {
    result = { ok: false, error: `${CONNECTORS[connector].name} publish error: ${String(e).slice(0, 200)}` };
  }
  const entry = {
    connector,
    at: new Date().toISOString(),
    ok: result.ok,
    url: result.url || null,
    repo: result.repo || null,
    domain: args.domain || null,
    error: result.error || null,
  };
  await recordDeployment(store, user?.uid || '', artifactId, entry);

  if (!result.ok) return result;
  return {
    ...result,
    artifact_id: artifactId,
    connector,
    external_url: result.url,
    note: `${result.note}${args.domain ? ` Custom domain ${args.domain} will work once DNS points at the host.` : ''}`,
  };
}
