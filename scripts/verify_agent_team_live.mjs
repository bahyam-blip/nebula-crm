#!/usr/bin/env node
/**
 * LIVE post-deploy verification for AGENT V8 — the MULTI-AGENT TEAM:
 *   1. /v1/health + /mcp advert (v4.0.0, multi-agent capability line)
 *   2. Probe user bootstrapped with a real Firebase token
 *   3. REAL build via /v1/studio/build (live Sarvam):
 *        - response carries the FULL team trace (Lead, Researcher,
 *          Art Director, Copywriter, Copy Chief, Architect, Engineer,
 *          QA Director, Builder) + team_summary
 *        - served HTML is a complete bespoke document (no fences/chatter)
 *   4. REAL refine via /v1/studio/refine: team trace on the refine path
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_agent_team_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = Date.now().toString(36);
const EMAIL = `nebula.v8.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

async function jfetch(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${WORKER}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* html */ }
  return { status: res.status, json, text: json ? '' : await res.text().catch(() => '') };
}

async function main() {
  console.log('— health + MCP advert —');
  const health = await jfetch('/v1/health');
  ok(health.status === 200 && health.json?.ok === true, 'worker healthy');
  const advert = await jfetch('/mcp');
  ok(advert.status === 200 && advert.json?.version === '4.0.0', `/mcp advert version 4.0.0 (got ${advert.json?.version})`);
  const caps = JSON.stringify(advert.json?.capabilities || []);
  ok(caps.includes('multi-agent build team'), 'advert names the multi-agent build team');
  ok(advert.json?.tools === 33, 'advert shows 33 tools', String(advert.json?.tools));

  console.log('— probe identity —');
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
  }).then((r) => r.json()).catch(() => null);
  let token = su?.idToken || null;
  if (!token) {
    const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
    }).then((r) => r.json()).catch(() => null);
    token = si?.idToken || null;
  }
  ok(!!token, 'probe token minted', EMAIL);
  if (!token) process.exit(1);

  // Bootstrap + role for studio access
  const boot = await jfetch('/v1/data/bootstrap', { method: 'POST', token, body: {} });
  ok(boot.status === 200 && !!boot.json?.user?.role, `probe bootstrapped (${boot.json?.user?.role})`, JSON.stringify(boot.json).slice(0, 140));

  console.log('— REAL build: the multi-agent team at work —');
  const brief = 'A specialty filter-coffee stall in Bengaluru called Kettle Theory. 20-seat patio, single-origin pours, weekend cupping workshops for beginners. Audience: young tech workers. CTA: reserve a cupping seat by email.';
  const t0 = Date.now();
  const build = await jfetch('/v1/studio/build', {
    method: 'POST', token,
    body: { title: 'Kettle Theory', kind: 'landing', brief },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(build.status === 200 && build.json?.ok === true, `live build ok in ${secs}s (team of agents)`, JSON.stringify(build.json).slice(0, 200));
  if (!build.json?.ok) { console.log('BUILD FAILED — aborting'); process.exit(1); }

  const team = build.json.team || [];
  const agents = team.map((r) => r.agent);
  console.log('  · team trace:', team.map((r) => `${r.emoji} ${r.agent} — ${r.action} (${r.ms}ms, ai=${r.ai})`).join(' | '));
  console.log('  · summary:', JSON.stringify(build.json.team_summary));

  for (const expected of ['Lead', 'Researcher', 'Art Director', 'Copywriter', 'Architect', 'Engineer', 'QA Director', 'Builder']) {
    ok(agents.includes(expected), `team trace includes ${expected}`, JSON.stringify(agents));
  }
  const sum = build.json.team_summary || {};
  ok(sum.agents >= 8, `team_summary counts >=8 distinct agents (${sum.agents})`);
  ok(sum.ai_calls >= 8, `team_summary counts >=8 AI calls (${sum.ai_calls})`);
  ok(team.every((r) => r.agent && r.action && typeof r.ms === 'number'), 'every team row display-ready');
  ok(build.json.builder === 'ai', 'builder=ai — engineers hand-coded the page', build.json.builder);
  ok(typeof build.json.url === 'string' && build.json.url.includes('/sites/'), 'public URL returned', build.json.url);

  console.log('— the hosted page —');
  const site = await fetch(build.json.url.replace(/^\//, WORKER + '/').replace(WORKER + '//', WORKER + '/'), { redirect: 'follow' });
  const html = await site.text();
  ok(site.status === 200 && html.startsWith('<!DOCTYPE html>') && html.includes('</html>'), 'served page is a complete document');
  ok(!html.includes('```') && !html.includes('MARKET FACTS'), 'no fences or scaffolding leak');
  ok(html.includes('data-rev') && html.includes('@keyframes'), 'bespoke motion system present');
  ok(html.includes('site-nav') && html.includes('site-footer'), 'nav + footer chrome wired');
  ok(html.length < 400000, 'within the size budget', `${html.length} bytes`);

  console.log('— REAL refine: the team iterates —');
  const ref = await jfetch('/v1/studio/refine', {
    method: 'POST', token,
    body: { artifact_id: build.json.artifact_id, instruction: 'make the headline bolder and add a workshop pricing FAQ' },
  });
  ok(ref.status === 200 && ref.json?.ok === true, 'refine ok', JSON.stringify(ref.json).slice(0, 160));
  const refAgents = (ref.json?.team || []).map((r) => r.agent);
  ok(refAgents.includes('Copywriter') && refAgents.includes('Engineer') && refAgents.includes('QA Director'), 'refine team traced (copywriter + engineers + QA)', JSON.stringify(refAgents));

  console.log(`\n══════════════════════════════════════`);
  console.log(`AGENT TEAM LIVE: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log(`\nProbe to delete in Firebase Auth: ${EMAIL}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
