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
 * v15 GITHUB POWER CONNECTOR — GitHub is not just a publish target, it is
 * the user's own engineering pipeline:
 *   • PROJECT PUSH  — a publish now commits a real PROJECT (index.html +
 *     README.md + optional CI workflows), not a lone HTML file.
 *   • CI FLOWS      — the connector commits deploy-pages.yml / build-apk.yml
 *     and can TRIGGER any workflow (workflow_dispatch) on any repo of the
 *     connected account, then report run status — "push the code, build
 *     the APK, deploy the site" from inside the app.
 *   • list_repos / workflow_runs — the app shows real repos + run status.
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
    kind: 'hosting+code+flows',
    what: 'Your code in your repos, free GitHub Pages hosting, and CI flows: trigger APK builds or deploys on any of your repos. PAT needs repo + workflow scopes.',
    fields: [{ key: 'token', label: 'Personal access token (repo + workflow scope)', secret: true }],
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

/* ══ GitHub — CI workflow templates (v15 power connector) ════════════ */

/** The official Pages-via-Actions deploy workflow (dispatchable). */
export const PAGES_WORKFLOW_YML = `# Deploy the site to GitHub Pages (official Actions flow).
# Triggered on every push to main, or manually from Nebula.
name: Deploy to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Pages
        uses: actions/configure-pages@v5
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

/** The Flutter APK build workflow (dispatchable; runs when a Flutter app exists). */
export const APK_WORKFLOW_YML = `# Build a release APK from the Flutter app in this repo.
# Manual trigger from Nebula (workflow_dispatch) or on Flutter code pushes.
name: Build APK

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - 'pubspec.yaml'
      - 'lib/**'
      - 'android/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Set up Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - name: Set up Flutter
        uses: subosito/flutter-action@v2
        with:
          channel: stable
          cache: true
      - name: Pub get
        run: flutter pub get
      - name: Build release APK
        run: flutter build apk --release
      - name: Upload APK artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-release-apk
          path: build/app/outputs/flutter-apk/app-release.apk
`;

export const WORKFLOW_FILES = {
  pages: { path: '.github/workflows/deploy-pages.yml', yml: PAGES_WORKFLOW_YML, label: 'Pages deploy' },
  apk: { path: '.github/workflows/build-apk.yml', yml: APK_WORKFLOW_YML, label: 'APK build' },
};

/**
 * githubProjectFiles — the pure project builder. A publish commits a REAL
 * project the user owns and can extend, not a lone HTML file:
 *   index.html            the built page
 *   README.md             what this is, where it is live, how to deploy
 *   .github/workflows/*   the requested CI flows
 * Pure + exported: tests assert the exact project shape.
 */
export function githubProjectFiles({ title = 'Nebula site', html = '', workflows = [], repoUrl = '', liveUrl = '', kind = '' } = {}) {
  const files = new Map();
  files.set('index.html', String(html || ''));
  const flowLines = workflows.map((w) => WORKFLOW_FILES[w] ? `- \`${WORKFLOW_FILES[w].path}\` — ${WORKFLOW_FILES[w].label} flow (runs on push to main, or trigger it from the Nebula app)` : '').filter(Boolean);
  files.set('README.md', [
    `# ${title}`,
    '',
    kind ? `A ${kind} built with the Nebula AI agent — designed, researched, copywritten, hand-coded and QA-reviewed by a multi-agent studio.` : 'Built with the Nebula AI agent — a multi-agent studio (design, research, copy, code, QA).',
    '',
    '## Live',
    liveUrl ? `- Hosted build: ${liveUrl}` : '- Connect GitHub Pages (or run the deploy workflow) to take this live.',
    repoUrl ? `- Source: ${repoUrl}` : '',
    '',
    '## Structure',
    '- `index.html` — the complete page: semantic HTML, scoped CSS, motion system, zero build step. Open it in a browser and it works.',
    flowLines.length ? `- CI flows:\n${flowLines.join('\n')}` : '',
    '',
    '## Deploy',
    'Every push to `main` redeploys (Pages flow) — or trigger a build/deploy flow from the Nebula app, GitHub Actions, or `gh workflow run`.',
    '',
    '## License',
    'All rights reserved by the project owner.',
  ].filter((l) => l !== '').join('\n') + '\n');
  for (const w of workflows) {
    const wf = WORKFLOW_FILES[w];
    if (wf) files.set(wf.path, wf.yml);
  }
  return Object.fromEntries(files);
}

async function githubPutFile(creds, full, path, content, message) {
  // Keep slashes literal (GitHub accepts encoded too, but clean paths read
  // better in logs and match the REST browser URLs).
  const enc = path.split('/').map(encodeURIComponent).join('/');
  return apiFetch(`https://api.github.com/repos/${full}/contents/${enc}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: b64encodeUtf8(content) }),
  });
}

/**
 * githubPublish — v15: push the full PROJECT (index.html + README +
 * requested CI workflow files), create the repo (private option), enable
 * Pages (branch-source, or workflow-source when the Pages flow ships).
 */
async function githubPublish(creds, html, opts = {}) {
  const v = await githubVerify(creds);
  if (!v.ok) return v;
  const repo = String(opts.repo || `nebula-site-${opts.artifactId || Date.now().toString(36)}`)
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .slice(0, 90);
  const workflows = Array.isArray(opts.workflows) ? opts.workflows.filter((w) => WORKFLOW_FILES[w]) : [];

  // 1. create the repo (exists → reuse)
  let full = '';
  const created = await apiFetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: repo,
      private: opts.private === true,
      description: opts.title ? `${opts.title} — built by the Nebula AI agent` : 'Site deployed by Nebula CRM agent',
      auto_init: false,
    }),
  });
  if (created.ok && created.body?.full_name) {
    full = created.body.full_name;
  } else if (created.status === 422 || created.status === 409) {
    full = `${v.login}/${repo}`;
  } else {
    return { ok: false, error: `GitHub repo create failed (HTTP ${created.status}): ${JSON.stringify(created.body).slice(0, 200)}` };
  }

  // 2. commit the full project (page + README + CI flows)
  const project = githubProjectFiles({
    title: opts.title || repo,
    html,
    workflows,
    repoUrl: `https://github.com/${full}`,
    liveUrl: opts.liveUrl || '',
    kind: opts.kind || '',
  });
  let committed = 0;
  for (const [path, content] of Object.entries(project)) {
    const put = await githubPutFile(creds, full, path, content, path === 'README.md' ? 'Project README via Nebula CRM agent' : path.startsWith('.github/') ? `${WORKFLOW_FILES[opts.workflows?.find((w) => WORKFLOW_FILES[w]?.path === path)]?.label || 'CI'} workflow via Nebula CRM agent` : 'Deploy via Nebula CRM agent');
    if (!put.ok) {
      return { ok: false, error: `GitHub commit failed for ${path} (HTTP ${put.status}): ${JSON.stringify(put.body).slice(0, 200)}` };
    }
    committed++;
  }

  // 3. optional custom domain: commit CNAME + register it with Pages
  if (opts.domain) {
    await githubPutFile(creds, full, 'CNAME', String(opts.domain), 'Custom domain via Nebula CRM agent');
    await apiFetch(`https://api.github.com/repos/${full}/pages`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cname: String(opts.domain), https_enforced: true }),
    });
  }

  // 4. enable Pages — workflow build when the Pages flow was committed
  //    (the official Actions deploy owns it), otherwise branch source.
  const pagesBody = workflows.includes('pages')
    ? { build_type: 'workflow' }
    : { source: { branch: 'main', path: '/' } };
  const pages = await apiFetch(`https://api.github.com/repos/${full}/pages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pagesBody),
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
    actionsUrl: `https://github.com/${full}/actions`,
    live: 'building', // Pages takes ~1 min on first build
    pagesEnabled,
    filesCommitted: committed,
    workflows,
    note: `Project committed to ${full} (${committed} files${workflows.length ? `, ${workflows.join(' + ')} flow${workflows.length > 1 ? 's' : ''} included` : ''}) and GitHub Pages publishing started. The site is usually live within a minute.`,
  };
}

/* ══ GitHub power connector — repos, workflow dispatch, run status ═══ */

/** The connected account's repos (newest activity first) — for pickers. */
export async function githubListRepos(creds) {
  const r = await apiFetch('https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc', {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!r.ok) return { ok: false, error: `GitHub rejected the request (HTTP ${r.status})` };
  const repos = (Array.isArray(r.body) ? r.body : []).slice(0, 100).map((x) => ({
    full_name: x.full_name || '',
    name: x.name || '',
    private: x.private === true,
    default_branch: x.default_branch || 'main',
    updated_at: x.updated_at || null,
    url: x.html_url || `https://github.com/${x.full_name}`,
  }));
  return { ok: true, repos, note: `${repos.length} repo(s) on the connected GitHub account` };
}

/** Accept "owner/repo" or a bare name (resolved against the account). */
function normalizeRepoInput(name, login) {
  const raw = String(name || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!raw) return '';
  return raw.includes('/') ? raw.slice(0, 160) : `${login ? `${login}/` : ''}${raw}`.slice(0, 160);
}

/**
 * githubTriggerWorkflow — dispatch a workflow (workflow_dispatch) on any
 * repo of the connected account and return the run that it started.
 * This is "the flow": build the APK, deploy the site — from the app.
 */
export async function githubTriggerWorkflow(creds, { repo, workflow, ref = '', inputs = {} } = {}) {
  const v = await githubVerify(creds);
  if (!v.ok) return v;
  const full = normalizeRepoInput(repo, v.login);
  if (!full || !full.includes('/')) return { ok: false, error: 'repo is required — "owner/repo" or a repo name on the connected account' };
  const wf = String(workflow || '').trim();
  if (!wf) return { ok: false, error: 'workflow is required — the workflow FILE name (e.g. build-apk.yml or deploy-pages.yml)' };
  const branch = String(ref || '').trim() || 'main';

  const disp = await apiFetch(`https://api.github.com/repos/${full}/actions/workflows/${encodeURIComponent(wf)}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: branch, inputs }),
  });
  if (!disp.ok) {
    const hint = disp.status === 404
      ? ' — check the repo name and that the workflow file exists (and the PAT has workflow scope)'
      : disp.status === 422
        ? ' — the workflow has no workflow_dispatch trigger or the ref does not exist'
        : '';
    return { ok: false, error: `workflow dispatch failed (HTTP ${disp.status})${hint}: ${JSON.stringify(disp.body).slice(0, 160)}` };
  }
  // The dispatch response is 204-empty; find the run it just created.
  await new Promise((r) => setTimeout(r, 1500));
  const runs = await apiFetch(`https://api.github.com/repos/${full}/actions/runs?per_page=3`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  const latest = (Array.isArray(runs.body?.workflow_runs) ? runs.body.workflow_runs : [])
    .find((x) => (x.path || '').endsWith(wf) || (x.name || '').toLowerCase().includes(wf.replace(/\.ya?ml$/i, '').replace(/[-_]/g, ' '))) || null;
  return {
    ok: true,
    repo: full,
    workflow: wf,
    ref: branch,
    run: latest ? {
      id: latest.id,
      status: latest.status || 'queued',
      conclusion: latest.conclusion || null,
      url: latest.html_url || `https://github.com/${full}/actions/runs/${latest.id}`,
      created_at: latest.created_at || null,
    } : null,
    runsUrl: `https://github.com/${full}/actions`,
    note: `Workflow "${wf}" dispatched on ${full} (${branch}). Watch it under Actions — an APK lands in the run's artifacts when it succeeds.`,
  };
}

/** Latest workflow runs on a repo — the app's status chips. */
export async function githubWorkflowRuns(creds, { repo, per_page = 5 } = {}) {
  const v = await githubVerify(creds);
  if (!v.ok) return v;
  const full = normalizeRepoInput(repo, v.login);
  if (!full || !full.includes('/')) return { ok: false, error: 'repo is required — "owner/repo" or a repo name on the connected account' };
  const r = await apiFetch(`https://api.github.com/repos/${full}/actions/runs?per_page=${Math.min(Number(per_page) || 5, 20)}`, {
    headers: { Authorization: `Bearer ${creds.token}` },
  });
  if (!r.ok) return { ok: false, error: `could not read workflow runs (HTTP ${r.status})` };
  const runs = (Array.isArray(r.body?.workflow_runs) ? r.body.workflow_runs : []).slice(0, 20).map((x) => ({
    id: x.id,
    name: x.name || '',
    workflow: String(x.path || '').split('/').pop() || '',
    status: x.status || '',
    conclusion: x.conclusion || null,
    branch: x.head_branch || '',
    event: x.event || '',
    url: x.html_url || '',
    created_at: x.created_at || null,
  }));
  return { ok: true, repo: full, runs };
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
  let liveUrl = '';
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(`sites/${artifactId}.html`).catch(() => null);
    if (obj) html = await obj.text();
  }
  if (!html) {
    return { ok: false, error: `artifact "${artifactId}" is not a hosted site (notes cannot be published) — build one with build_website` };
  }
  if (env.MEDIA) {
    // The hosted build URL goes into the README so the repo points at the
    // live site from day one.
    try {
      const meta = await env.MEDIA.get(`sites/${artifactId}.json`).catch(() => null);
      if (meta) {
        const doc = JSON.parse(await meta.text());
        liveUrl = doc?.publicUrl || doc?.url || '';
      }
    } catch { /* README lives without it */ }
  }

  // v15 GitHub power options: full project push + CI flows + privacy.
  const workflows = Array.isArray(args.workflows)
    ? args.workflows.map((w) => String(w)).filter((w) => ['pages', 'apk'].includes(w))
    : [];
  const opts = {
    artifactId,
    repo: args.repo,
    domain: args.domain,
    site_id: args.site_id,
    title: args.title,
    workflows,
    private: args.private === true,
    kind: String(args.kind || ''),
    liveUrl,
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

/* ══ GitHub power tool surfaces (called from runTool + /v1/studio) ═══ */

function githubConnError() {
  return { ok: false, error: 'GitHub is not connected yet — connect it once from Studio → Hosting (a PAT with repo + workflow scopes); after that pushing code and triggering flows needs no tokens' };
}

/** list_github_repos — the account's repos for the app's pickers. */
export async function listGithubRepos(env, store, user) {
  const conn = await readConnection(env, store, user?.uid || '', 'github');
  if (!conn) return githubConnError();
  try {
    return await githubListRepos(conn.credentials);
  } catch (e) {
    return { ok: false, error: `could not reach GitHub: ${String(e).slice(0, 140)}` };
  }
}

/** trigger_workflow — dispatch a CI flow (APK build, Pages deploy, …). */
export async function triggerWorkflow(env, store, user, args) {
  const conn = await readConnection(env, store, user?.uid || '', 'github');
  if (!conn) return githubConnError();
  try {
    return await githubTriggerWorkflow(conn.credentials, args);
  } catch (e) {
    return { ok: false, error: `could not reach GitHub: ${String(e).slice(0, 140)}` };
  }
}

/** workflow_runs — latest CI run status on a repo (the app's chips). */
export async function workflowRuns(env, store, user, args) {
  const conn = await readConnection(env, store, user?.uid || '', 'github');
  if (!conn) return githubConnError();
  try {
    return await githubWorkflowRuns(conn.credentials, args);
  } catch (e) {
    return { ok: false, error: `could not reach GitHub: ${String(e).slice(0, 140)}` };
  }
}
