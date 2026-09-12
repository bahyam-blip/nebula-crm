#!/usr/bin/env node
/**
 * AGENT V15 · GLM-FIRST + GITHUB POWER — the test suite.
 *
 * Covers the owner's #20 instruction ("first round should build the best
 * website with deep thinking… the code should go to GitHub… triggers flow
 * to build apk or deploy to any hosting"):
 *   1. MASTER PROMPT — the ADVANCED FULL-STACK AI BUILDER constitution is
 *      installed into the runtime: role blocks per agent, bounded, with
 *      the FIRST-ROUND law.
 *   2. FIRST-ROUND EXCELLENCE — the Lead plans FEATURES + LAYOUT
 *      commitments, sections 5-7 (never below), and every later
 *      specialist (architect, engineers, QA) carries the master block +
 *      the feature contract.
 *   3. SKILLS — the full-stack curriculum: new domains accepted, 24+
 *      seeded skills, domain adjacency.
 *   4. GITHUB POWER CONNECTOR — full-project push (index.html + README +
 *      CI workflow files), private repos, workflow dispatch (APK build /
 *      Pages deploy) on any repo, run status, repo listing, tool
 *      surfaces vault-backed, role-gated REST.
 *   5. MCP v8.0.0 — new tools advertised.
 *
 * Mocks every outbound fetch; drives the REAL worker modules. Node 22+.
 *   node scripts/test_agent_v15.mjs
 */

import { strict as assert } from 'node:assert';
import * as MP from '../cloudflare/worker/src/emailer/masterprompt.js';
import * as AG from '../cloudflare/worker/src/emailer/agents.js';
import * as CG from '../cloudflare/worker/src/emailer/codegen.js';
import * as SK from '../cloudflare/worker/src/emailer/skills.js';
import * as PB from '../cloudflare/worker/src/emailer/publish.js';
import { storeConnection } from '../cloudflare/worker/src/emailer/vault.js';
import { handleStudioRequest } from '../cloudflare/worker/src/studio_http.js';
import { SERVER_VERSION, TOOL_SCHEMAS } from '../cloudflare/worker/src/emailer/mcp.js';

let passed = 0;
const failures = [];
function ok(cond, label, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${label} ${detail}`); }
}
function section(name) { console.log(`\n— ${name} —`); }

/* ══ harness ══ */
const env = { SARVAM_API_KEY: 'k-test', VAULT_KEY: 'v15-test-vault-key' };

// KV-style state store (vault + skills + artifacts all ride on it).
env.NEBULA_EMAIL_KV = (() => {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async put(k, v) { m.set(k, String(v)); },
    async delete(k) { m.delete(k); },
  };
})();

// R2 stand-in with one built site.
env.MEDIA = (() => {
  const m = new Map([['sites/art1.html', '<!doctype html><html><h1>My Site</h1></html>']]);
  return {
    async get(k) { return m.has(k) ? { async text() { return m.get(k); } } : null; },
    async put(k, v) { m.set(k, String(v)); },
  };
})();

const sarvamSeen = [];
const sarvamScript = [];
function sarvamReplyFor(text) {
  for (const s of sarvamScript) {
    if (s.re.test(text)) {
      const reply = typeof s.reply === 'function' ? s.reply(text) : s.reply;
      return reply === null || reply === undefined ? null : JSON.stringify(reply);
    }
  }
  return null;
}

const fetchLog = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const method = String(init.method || 'GET').toUpperCase();
  fetchLog.push({ u: u.slice(0, 300), method, body: init.body ? String(init.body).slice(0, 400) : '' });
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(init.body);
    const text = parsed.messages?.map((m) => m.content).join('\n') || '';
    sarvamSeen.push(text);
    const reply = sarvamReplyFor(text);
    if (reply === null) return new Response(JSON.stringify({ error: 'no scripted reply' }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }), { status: 200 });
  }
  if (u.startsWith('https://api.github.com/')) {
    // /user — token check
    if (u === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login: 'octocat', name: 'Octo Cat' }), { status: 200 });
    }
    // repo listing
    if (u.startsWith('https://api.github.com/user/repos?')) {
      return new Response(JSON.stringify([
        { full_name: 'octocat/my-app', name: 'my-app', private: true, default_branch: 'main', html_url: 'https://github.com/octocat/my-app', updated_at: '2026-09-10T00:00:00Z' },
      ]), { status: 200 });
    }
    // repo create
    if (u === 'https://api.github.com/user/repos' && method === 'POST') {
      return new Response(JSON.stringify({ full_name: 'octocat/my-repo', name: 'my-repo' }), { status: 201 });
    }
    // contents PUT
    if (u.includes('/contents/') && method === 'PUT') {
      return new Response(JSON.stringify({ commit: { sha: 'abc123' } }), { status: 200 });
    }
    // pages enable
    if (u.endsWith('/pages') && method === 'POST') {
      return new Response(JSON.stringify({ html_url: 'https://octocat.github.io/my-repo/' }), { status: 201 });
    }
    // workflow dispatch
    if (u.includes('/dispatches') && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    // runs listing
    if (u.includes('/actions/runs')) {
      return new Response(JSON.stringify({
        workflow_runs: [
          { id: 9, name: 'Build APK', path: '.github/workflows/build-apk.yml', status: 'in_progress', conclusion: null, head_branch: 'main', event: 'workflow_dispatch', html_url: 'https://github.com/octocat/my-repo/actions/runs/9', created_at: '2026-09-11T10:00:00Z' },
          { id: 8, name: 'Deploy to Pages', path: '.github/workflows/deploy-pages.yml', status: 'completed', conclusion: 'success', head_branch: 'main', event: 'push', html_url: 'https://github.com/octocat/my-repo/actions/runs/8', created_at: '2026-09-10T10:00:00Z' },
        ],
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }
  return new Response('{}', { status: 404 });
};

/* ══ 1. MASTER PROMPT ══ */
section('MASTER PROMPT — the constitution is installed, role-bounded');

ok(MP.MASTER_ROLES.length === 5 && ['orchestrator', 'designer', 'architect', 'engineer', 'qa'].every((r) => MP.MASTER_ROLES.includes(r)),
  'five role slices exist', MP.MASTER_ROLES.join(','));
for (const role of MP.MASTER_ROLES) {
  const block = MP.masterBlock(role);
  ok(block.includes('PRODUCTION-QUALITY software') || block.includes('production-quality software'), `${role}: carries the build-it constitution`);
  ok(block.includes('FIRST ROUND IS THE PRODUCT'), `${role}: carries the first-round law`);
  ok(block.length > 400 && block.length < 2600, `${role}: bounded (${block.length} chars)`);
}
ok(MP.masterBlock('orchestrator').includes('ARCHITECT → IMPLEMENT'), 'orchestrator: the delivery workflow');
ok(MP.masterBlock('engineer').includes('Accessibility'), 'engineer: accessibility + performance laws');
ok(MP.masterBlock('qa').includes('senior engineer'), 'qa: quality gate as a release gate');
ok(MP.masterBlock('nope') === '', 'unknown role → empty block (safe append)');
const comm = MP.commitmentsBlock({ features: ['booking form with validation', 'gallery lightbox'], layout: 'editorial story with bento grid' });
ok(comm.includes('FEATURE CONTRACT') && comm.includes('booking form with validation') && comm.includes('LAYOUT CONCEPT: editorial story'),
  'commitmentsBlock turns the Lead plan into a contract');
ok(MP.commitmentsBlock(null) === '' && MP.commitmentsBlock({}) === '', 'commitmentsBlock tolerates empty plans');
ok(MP.FIRST_ROUND_LAW.includes('FIRST ROUND IS THE PRODUCT'), 'FIRST_ROUND_LAW exported');

/* ══ 2. FIRST-ROUND EXCELLENCE ══ */
section('FIRST ROUND — Lead plans features + layout, 5-7 sections, contracts flow');

const dflt = AG.defaultLeadPlan({ kind: 'landing', brief: 'x', brand: {} });
ok(dflt.sections_target === 6, 'deterministic plan: 6 sections (4 was starving it)');
ok(Array.isArray(dflt.features) && dflt.features.length >= 2, 'deterministic plan: concrete features');
ok(typeof dflt.layout === 'string' && dflt.layout.length > 10, 'deterministic plan: layout concept');
const dfltApp = AG.defaultLeadPlan({ kind: 'webapp', brief: 'x', brand: {} });
ok(dfltApp.features.some((f) => /localStorage|core create/i.test(f)), 'webapp plan: persistence feature');

sarvamScript.length = 0;
sarvamSeen.length = 0;
sarvamScript.push({
  re: /EXECUTION PLAN/,
  reply: {
    brand_name: 'Kettle Theory', audience: 'specialty coffee drinkers', page_goal: 'book a tasting',
    features: ['tasting booking form with date + party-size validation', 'roast library with filter chips'],
    layout: 'editorial one-column story with a full-bleed hero and a bento proof grid',
    research_focus: 'specialty coffee tasting price points', queries: ['specialty coffee tasting prices'],
    image_ideas: ['barista pouring latte art'], sections_target: 7, emphasis: ['menu must feel tactile'],
    risks: ['generic stock phrasing'], tone_note: 'warm and specific',
  },
});
const lead = await AG.leadPlan(env, { kind: 'landing', brief: 'Kettle Theory tasting room in Kochi — book tastings', brand: { name: 'Kettle Theory' }, site: null, style: '', team: null });
ok(lead.ai === true, 'Lead plan is AI-planned');
ok(lead.sections_target === 7, 'Lead can target 7 sections (was capped at 5)');
ok(lead.features.length === 2 && /booking form/.test(lead.features[0]), 'Lead plan carries concrete FEATURES');
ok(lead.layout.includes('bento'), 'Lead plan carries the LAYOUT concept');
const leadSys = sarvamSeen.find((t) => t.includes('EXECUTION PLAN')) || '';
ok(leadSys.includes('FIRST ROUND IS THE PRODUCT'), 'Lead system prompt carries the first-round law');
ok(leadSys.includes('"features"') && leadSys.includes('"layout"'), 'Lead JSON schema asks for features + layout');
ok(leadSys.includes('Never below 5'), 'Lead cannot undershoot 5 sections');
ok(leadSys.includes('YOUR ROLE — the Orchestrator'), 'Lead wakes up as the master-prompt orchestrator');

const block = AG.leadBlock(lead);
ok(block.includes('FEATURE CONTRACT') && block.includes('roast library with filter chips'), 'leadBlock: feature contract travels');
ok(block.includes('LAYOUT CONCEPT'), 'leadBlock: layout travels');

// Architect: plans against the contract, master block installed.
sarvamScript.length = 0;
sarvamSeen.length = 0;
sarvamScript.push({
  re: /lead architect/,
  reply: {
    sections: [
      { id: 'hero', name: 'Home', goal: 'state the promise', journey: 'land', layout: 'full-bleed statement hero', content_keys: ['kicker', 'headline', 'sub', 'primary_cta'], motion: 'staggered rise' },
      { id: 'roasts', name: 'Roasts', goal: 'show the library', journey: 'scan', layout: 'filter chips + bento grid', content_keys: ['features', 'stats'], motion: 'chip reveal' },
      { id: 'proof', name: 'Proof', goal: 'win trust', journey: 'feel', layout: 'quote feature', content_keys: ['testimonials'], motion: 'quote scale' },
      { id: 'book', name: 'Book', goal: 'convert', journey: 'act', layout: 'booking band with form', content_keys: ['cta_title', 'contact'], motion: 'band rise' },
    ],
    nav: ['hero', 'roasts', 'proof', 'book'],
  },
});
const content = { kicker: 'Kettle Theory', headline: 'Taste the roast', sub: 'Book a tasting in Kochi', primary_cta: 'Book a tasting', features: [{ title: 'Single origin', desc: 'Small lots' }], stats: [{ value: '12' }], testimonials: [{ quote: 'Best in Kochi', name: 'Ana' }], cta_title: 'Book', contact: { phone: 'x' } };
const plan = await CG.planSections(env, {
  kind: 'landing', brief: 'Kettle Theory tasting room', brand: { name: 'Kettle Theory' }, site: null,
  thought: { design: { themeLabel: 'onyx', voice: 'warm', audience: 'coffee drinkers', hero: 'editorial', motion_intensity: 'balanced', type_scale: 'dramatic', ux_flow: ['land', 'scan', 'act'] }, mustHave: ['booking form'] },
  content, skillsBlock: '', lead, understanding: null, team: null,
});
ok(plan.ai === true && plan.sections.length === 4, 'architect plans the sections');
const archUser = sarvamSeen.find((t) => t.includes('PLAN EXACTLY')) || '';
ok(archUser.includes('PLAN EXACTLY 7 SECTIONS'), 'architect plans to the Lead\'s 7-section target');
ok(archUser.includes('FEATURE CONTRACT') && archUser.includes('party-size validation'), 'architect reads the feature contract');
ok(archUser.includes('LAYOUT CONCEPT'), 'architect reads the layout concept');
const archSys = sarvamSeen.find((t) => t.includes('lead architect')) || '';
ok(archSys.includes('YOUR ROLE — the Software Architect'), 'architect carries the master block');
ok(archSys.includes('5-7 sections total'), 'architect law: 5-7 sections, never thin');
ok(archSys.includes('FEATURE CONTRACT'), 'architect law: features must be realized');

// Engineer: master block + first-round law in the section prompt.
sarvamScript.length = 0;
sarvamSeen.length = 0;
sarvamScript.push({
  re: /sec-hero/,
  reply: [
    '<section id="sec-hero"><div class="wrap"><p class="kicker" data-rev>Specialty roastery</p>',
    '<h1 data-rev>Taste the roast</h1><p data-rev data-rev-delay="1">Book a tasting in Kochi — single-origin lots poured slow.</p>',
    '<div class="cta-row"><a class="btn btn-accent" href="#book">Book a tasting</a><a class="btn btn-ghost" href="#roasts">See the roasts</a></div></div></section>',
    '<style>@keyframes hero-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}',
    '#sec-hero{padding:var(--sp6) 0}#sec-hero h1{font-family:var(--display);font-size:clamp(40px,7vw,84px);line-height:1.05}',
    '#sec-hero .kicker{letter-spacing:.2em;text-transform:uppercase;color:var(--accent)}',
    '#sec-hero .cta-row{display:flex;gap:12px;margin-top:var(--sp4)}',
    '#sec-hero .btn-accent{transition:transform .2s}#sec-hero .btn-accent:hover{transform:translateY(-3px)}</style>',
  ].join(''),
});
const codedHero = await CG.codeSection(env, {
  kind: 'landing', brand: { name: 'Kettle Theory' }, brief: 'Kettle Theory',
  design: {
    radius: 16, font: 'modern', fontPair: { display: 'Fraunces', body: 'Inter' }, ramp: { '100': '#fff' }, motion_intensity: 'balanced',
    palette: { bg: '#0a0d18', surface: '#121527', ink: '#eef1fb', muted: '#98a1c0', accent: '#ff2d55', accent2: '#ffb3c7' },
  },
  section: plan.sections[0], content, images: null, mastery: '', critique: '',
});
ok(Boolean(codedHero && codedHero.html), 'engineer codes the section');
const engSys = sarvamSeen.find((t) => t.includes('sec-hero')) || '';
ok(engSys.includes('YOUR ROLE — the Senior Frontend Engineer'), 'engineer carries the master block');
ok(engSys.includes('FIRST ROUND IS THE PRODUCT'), 'engineer carries the first-round law');

// QA: release-gate review.
sarvamScript.length = 0;
sarvamSeen.length = 0;
sarvamScript.push({ re: /reviewing/, reply: { verdicts: [{ id: 'hero', verdict: 'good', note: 'sharp' }] } });
const review = await CG.reviewSections(env, {
  kind: 'landing', brand: { name: 'Kettle Theory' },
  sections: [{ id: 'hero', name: 'Home', goal: 'state the promise', html: '<section id="sec-hero"><h1 data-rev>x</h1></section>', css: '#sec-hero h1{animation:hero-rise .5s}' }],
  team: null,
});
ok(review.ai === true && review.verdicts.hero === 'good', 'QA reviews the code');
const qaSys = sarvamSeen.find((t) => t.includes('verdicts')) || '';
ok(qaSys.includes('gating a release') && qaSys.includes('CRAFT'), 'QA carries the master quality gate');

/* ══ 3. SKILLS — full-stack curriculum ══ */
section('SKILLS — engineering domains, 24 seeds, adjacency');

ok(SK.SKILL_DOMAINS.includes('backend') && SK.SKILL_DOMAINS.includes('database') && SK.SKILL_DOMAINS.includes('security')
   && SK.SKILL_DOMAINS.includes('testing') && SK.SKILL_DOMAINS.includes('devops') && SK.SKILL_DOMAINS.includes('mobile')
   && SK.SKILL_DOMAINS.includes('research') && SK.SKILL_DOMAINS.includes('documentation'),
  'full-stack skill domains accepted', SK.SKILL_DOMAINS.join(','));
ok(SK.SEED_SKILLS.length >= 24, `${SK.SEED_SKILLS.length} seeded skills (was 12)`);
const slugs = new Set(SK.SEED_SKILLS.map((s) => s.slug));
for (const want of ['api-design-contracts', 'data-modeling-first', 'secure-by-default', 'test-the-risk-first', 'debugging-method', 'performance-budgets', 'git-github-flow', 'deploy-pipeline-discipline', 'flutter-product-craft', 'component-architecture', 'primary-source-research', 'readme-that-ships']) {
  ok(slugs.has(want), `seed skill "${want}" exists`);
}
const learn = await SK.learnSkill(env.NEBULA_EMAIL_KV, 'u1', { title: 'D1 batch discipline', domain: 'database', body: 'Batch D1 reads per request; a worker invocation gets ~50 subrequests, so one query per row dies on list screens. Use IN() batches and cache hot lists.' }, { source: 'test' });
ok(learn.ok && learn.domain === 'database', 'learnSkill accepts the new domains');
const pack = await SK.skillsForDomain(env.NEBULA_EMAIL_KV, 'u1', 'backend', { maxSkills: 8, maxChars: 2400 });
ok(pack.block.includes('APIs are contracts') || pack.block.includes('API contract'), 'backend pack pulls the backend seed');
ok(pack.block.includes('D1 batch discipline'), 'learned skills win their domain pack');
const devops = await SK.skillsForDomain(env.NEBULA_EMAIL_KV, 'u1', 'devops', { maxSkills: 4, maxChars: 1800 });
ok(devops.block.includes('pipelines ship'), 'devops pack pulls the devops seeds');

/* ══ 4. GITHUB POWER CONNECTOR ══ */
section('GITHUB POWER — project push, CI flows, dispatch, run status');

// Project builder (pure).
const base = PB.githubProjectFiles({ title: 'My Site', html: '<h1>x</h1>' });
ok(base['index.html'] === '<h1>x</h1>', 'project: index.html is the built page');
ok(base['README.md'].includes('# My Site') && base['README.md'].includes('Nebula AI agent'), 'project: README generated');
ok(!Object.keys(base).some((p) => p.startsWith('.github/')), 'project: no workflow files unless asked');
const withFlows = PB.githubProjectFiles({ title: 'My Site', html: '<h1>x</h1>', workflows: ['apk', 'pages'], repoUrl: 'https://github.com/octocat/my-repo' });
ok(Object.keys(withFlows).includes('.github/workflows/build-apk.yml'), 'project: APK workflow committed on request');
ok(Object.keys(withFlows).includes('.github/workflows/deploy-pages.yml'), 'project: Pages workflow committed on request');
ok(withFlows['.github/workflows/build-apk.yml'].includes('flutter build apk --release') && withFlows['.github/workflows/build-apk.yml'].includes('workflow_dispatch'), 'APK workflow builds a release APK and is dispatchable');
ok(withFlows['.github/workflows/deploy-pages.yml'].includes('actions/deploy-pages@v4') && withFlows['.github/workflows/deploy-pages.yml'].includes('workflow_dispatch'), 'Pages workflow is the official Actions flow and is dispatchable');
ok(withFlows['README.md'].includes('build-apk.yml'), 'README documents the CI flows');

// Full publish through the vault with workflows + private repo.
await storeConnection(env, env.NEBULA_EMAIL_KV, 'u1', 'github', { token: 'pat-123' }, 'octocat');
const user = { uid: 'u1' };
fetchLog.length = 0;
const pub = await PB.publishSite(env, env.NEBULA_EMAIL_KV, user, {
  artifact_id: 'art1', connector: 'github', repo: 'my-repo',
  workflows: ['apk', 'pages'], private: true, title: 'My Site', kind: 'landing',
});
ok(pub.ok === true, 'github publish succeeds', pub.error || '');
ok(pub.repo === 'octocat/my-repo' && pub.repoUrl === 'https://github.com/octocat/my-repo', 'publish returns the repo', pub.repo);
ok(pub.actionsUrl === 'https://github.com/octocat/my-repo/actions', 'publish returns the Actions URL');
ok(pub.filesCommitted === 4, 'full project committed (page + README + 2 workflows)', String(pub.filesCommitted));
const createCall = fetchLog.find((f) => f.u === 'https://api.github.com/user/repos' && f.method === 'POST');
ok(createCall && JSON.parse(createCall.body).private === true, 'repo created PRIVATE on request');
ok(fetchLog.some((f) => f.u.includes('/contents/.github/workflows/build-apk.yml') && f.method === 'PUT'), 'APK workflow PUT to the repo');
ok(fetchLog.some((f) => f.u.includes('/contents/.github/workflows/deploy-pages.yml') && f.method === 'PUT'), 'Pages workflow PUT to the repo');
ok(fetchLog.some((f) => f.u.includes('/contents/README.md') && f.method === 'PUT'), 'README PUT to the repo');
const pagesCall = fetchLog.find((f) => f.u.endsWith('/pages') && f.method === 'POST');
ok(pagesCall && JSON.parse(pagesCall.body).build_type === 'workflow', 'Pages enabled in workflow mode when the flow ships');

// Default publish stays lean (no workflows → branch-mode Pages).
fetchLog.length = 0;
const pub2 = await PB.publishSite(env, env.NEBULA_EMAIL_KV, user, { artifact_id: 'art1', connector: 'github', repo: 'my-repo' });
ok(pub2.ok === true && pub2.filesCommitted === 2, 'lean publish still works (page + README)', String(pub2.filesCommitted));
const pagesCall2 = fetchLog.find((f) => f.u.endsWith('/pages') && f.method === 'POST');
ok(pagesCall2 && JSON.parse(pagesCall2.body).source?.branch === 'main', 'Pages branch-source when no flows requested');

// Repos listing.
const repos = await PB.listGithubRepos(env, env.NEBULA_EMAIL_KV, user);
ok(repos.ok === true && repos.repos[0].full_name === 'octocat/my-app' && repos.repos[0].private === true, 'repo listing mapped for pickers');

// Workflow dispatch — the "build the APK" flow.
const trig = await PB.triggerWorkflow(env, env.NEBULA_EMAIL_KV, user, { repo: 'my-repo', workflow: 'build-apk.yml' });
ok(trig.ok === true && trig.repo === 'octocat/my-repo', 'bare repo name resolves to owner/repo');
ok(trig.run && trig.run.id === 9 && trig.run.status === 'in_progress', 'dispatch returns the started run', JSON.stringify(trig.run));
ok(trig.run.url.includes('/actions/runs/9'), 'run URL returned');
ok(fetchLog.some((f) => f.u.includes('/actions/workflows/build-apk.yml/dispatches') && f.method === 'POST'), 'dispatch POST actually fired');

// Run status.
const runs = await PB.workflowRuns(env, env.NEBULA_EMAIL_KV, user, { repo: 'octocat/my-repo' });
ok(runs.ok === true && runs.runs.length === 2 && runs.runs[0].workflow === 'build-apk.yml', 'run status mapped (workflow file name, conclusion)');
ok(runs.runs[1].conclusion === 'success', 'green deploy run readable');

// Not connected → teaches the connect path, never a raw crash.
const noConn = await PB.listGithubRepos(env, env.NEBULA_EMAIL_KV, { uid: 'u-nobody' });
ok(noConn.ok === false && /not connected/.test(noConn.error), 'unconnected user gets the connect guidance');
const trigNoConn = await PB.triggerWorkflow(env, env.NEBULA_EMAIL_KV, { uid: 'u-nobody' }, { repo: 'x/y', workflow: 'w.yml' });
ok(trigNoConn.ok === false && /not connected/.test(trigNoConn.error), 'trigger without a connection is guided too');

// Validation.
const noWf = await PB.triggerWorkflow(env, env.NEBULA_EMAIL_KV, user, { repo: 'octocat/my-repo' });
ok(noWf.ok === false && /workflow is required/.test(noWf.error), 'dispatch without a workflow file is rejected');

/* ══ 5. REST + MCP ══ */
section('REST + MCP — role-gated github routes, v8.0.0 advertisement');

const req403 = new Request('https://w.test/v1/studio/github/repos', { headers: { authorization: 'Bearer t' } });
const res403 = await handleStudioRequest(req403, env, { url: new URL('https://w.test/v1/studio/github/repos'), path: '/v1/studio/github/repos', uid: 'u-nobody', ctx: { waitUntil: () => {} } });
ok(res403.status === 403, 'REST github routes are manager-gated (viewer → 403)');

ok(SERVER_VERSION === '8.0.0', 'MCP v8.0.0');
ok(TOOL_SCHEMAS.trigger_workflow && TOOL_SCHEMAS.trigger_workflow.required.includes('workflow'), 'MCP schema: trigger_workflow');
ok(TOOL_SCHEMAS.list_github_repos && TOOL_SCHEMAS.workflow_runs, 'MCP schema: list_github_repos + workflow_runs');
ok(TOOL_SCHEMAS.publish_site.properties.workflows && TOOL_SCHEMAS.publish_site.properties.private, 'MCP schema: publish_site carries workflows + private');

/* ══ summary ══ */
console.log(`\n══════════════════════════════════`);
console.log(`AGENT V15: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
