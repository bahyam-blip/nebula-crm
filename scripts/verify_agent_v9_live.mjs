#!/usr/bin/env node
/**
 * LIVE post-deploy verification for AGENT V9 — the team gets MORE advanced:
 *   1. /v1/health + /mcp advert (v4.1.0, surgical refine capability line)
 *   2. Probe user bootstrapped with a real Firebase token
 *   3. LIVE RUN: POST /v1/studio/build {wait:false} → job id → poll
 *      GET /v1/studio/run — the trace GROWS while the run executes (the
 *      user literally watches the team work), lands with a result payload
 *   4. Served page: complete bespoke document
 *   5. SURGICAL refine: sections:["hero"] — hero re-coded, version bumped,
 *      Lead trace announces the scope
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_agent_v9_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = Date.now().toString(36);
const EMAIL = `nebula.v9.probe.${STAMP}@gmail.com`;
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
  ok(advert.status === 200 && advert.json?.version === '4.1.0', `/mcp advert version 4.1.0 (got ${advert.json?.version})`);
  const caps = JSON.stringify(advert.json?.capabilities || []);
  ok(/refine|surgical|hero/i.test(caps), 'advert mentions the surgical refine', caps.slice(0, 200));

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

  const boot = await jfetch('/v1/data/bootstrap', { method: 'POST', token, body: {} });
  ok(boot.status === 200 && !!boot.json?.user?.role, `probe bootstrapped (${boot.json?.user?.role})`, JSON.stringify(boot.json).slice(0, 140));

  console.log('— LIVE RUN: start + watch the team stream —');
  const brief = 'A specialty filter-coffee stall in Bengaluru called Kettle Theory. 20-seat patio, single-origin pours, weekend cupping workshops for beginners. Audience: young tech workers. CTA: reserve a cupping seat by email.';
  const runId = 'b_' + STAMP + 'live';
  // Fire the build (DO NOT await) and poll the run doc concurrently —
  // exactly what the app does. The doc must GROW while the request runs.
  const buildPromise = jfetch('/v1/studio/build', {
    method: 'POST', token,
    body: { title: 'Kettle Theory', kind: 'landing', brief, run_id: runId },
  });
  const t0 = Date.now();
  let firstCount = -1, lastCount = 0, grew = false, sawReflector = false, status = 'running';
  let finalDoc = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, i < 2 ? 2500 : 3000));
    const st = await jfetch(`/v1/studio/run?id=${runId}`, { token });
    if (st.status !== 200) continue; // doc appears once validation passes
    const n = (st.json?.trace || []).length;
    if (n > 0 && firstCount === -1) firstCount = n;
    if (n > lastCount) {
      if (lastCount > 0) grew = true;
      lastCount = n;
      console.log(`  · t=${((Date.now() - t0) / 1000).toFixed(0)}s trace=${n} rows`);
    }
    sawReflector = sawReflector || (st.json?.trace || []).some((r) => r.agent === 'Reflector');
    if (st.json?.status !== 'running') { status = st.json.status; finalDoc = st.json; break; }
    if (Date.now() - t0 > 260_000) { status = 'poll-budget-exhausted'; finalDoc = st.json; break; }
  }
  const build = await buildPromise;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(build.status === 200 && build.json?.ok === true, `watchable build ok in ${secs}s (same sync pipeline + run doc)`, JSON.stringify(build.json).slice(0, 200));
  ok(status === 'done', `run doc finalized to done at ${secs}s (status=${status})`, finalDoc?.error || '');
  ok(grew === true, `trace streamed LIVE during the request (grew from ${firstCount} to ${lastCount} rows across polls)`);
  const trace = finalDoc?.trace || [];
  ok(lastCount >= 10, `full team trace streamed (${lastCount} rows)`);
  ok(sawReflector, 'Reflector row streamed');
  const result = build.json?.ok ? build.json : {};
  ok(result.artifact_id && result.url, 'build payload carries the artifact + URL', JSON.stringify(result).slice(0, 160));
  ok(result.builder === 'ai', 'builder=ai — engineers hand-coded the page', result.builder);
  ok(result.team_summary?.ai_calls >= 9, `team_summary counts the AI calls (${result.team_summary?.ai_calls})`);
  ok(result.reflected, 'build reflected a learned skill', result.reflected || '');
  const runDoc = await jfetch(`/v1/studio/run?id=${runId}`, { token });
  ok(runDoc.json?.status === 'done' && runDoc.json?.result?.artifact_id === result.artifact_id, 'run doc result matches the build response');
  console.log('  · trace:', trace.map((r) => `${r.emoji} ${r.agent}(${r.ms}ms)`).join(' '));
  if (result.reflected) console.log('  · reflected:', result.reflected);

  console.log('— the hosted page —');
  const siteUrl = result.url.startsWith('http') ? result.url : WORKER + result.url;
  const site = await fetch(siteUrl, { redirect: 'follow' });
  const html = await site.text();
  ok(site.status === 200 && html.startsWith('<!DOCTYPE html>') && html.includes('</html>'), 'served page is a complete document');
  ok(!html.includes('```') && !html.includes('MARKET INTELLIGENCE'), 'no fences or scaffolding leak');
  ok(html.includes('data-rev') && html.includes('@keyframes'), 'bespoke motion system present');

  console.log('— run scoping —');
  const stranger = await jfetch(`/v1/studio/run?id=${runId}`); // no token
  ok(stranger.status === 404, 'runs without a token are not readable', String(stranger.status));

  console.log('— SURGICAL refine: re-code just the hero —');
  const t1 = Date.now();
  const ref = await jfetch('/v1/studio/refine', {
    method: 'POST', token,
    body: { artifact_id: result.artifact_id, instruction: 'make the hero statement bolder and punchier', sections: ['hero'] },
  });
  const refSecs = ((Date.now() - t1) / 1000).toFixed(1);
  ok(ref.status === 200 && ref.json?.ok === true, `surgical refine ok in ${refSecs}s`, JSON.stringify(ref.json).slice(0, 200));
  ok(ref.json?.version === 2, 'version bumped to 2', String(ref.json?.version));
  ok(/surgical re-code of hero/.test(ref.json?.note || ''), 'note names the surgical scope', ref.json?.note);
  ok((ref.json?.team || [])[0]?.detail?.includes('surgical: hero'), 'Lead trace announces the scope');
  const refAgents = (ref.json?.team || []).map((r) => r.agent);
  ok(refAgents.includes('Engineer') && refAgents.includes('QA Director'), 'engineer + QA traced on the surgical path', JSON.stringify(refAgents));
  const site2 = await fetch(ref.json.url.startsWith('http') ? ref.json.url : WORKER + ref.json.url, { redirect: 'follow' });
  const html2 = await site2.text();
  ok(site2.status === 200 && html2.startsWith('<!DOCTYPE html>') && html2.includes('</html>') && html2.includes('data-rev'), 'surgical v2 still serves a complete bespoke page');

  console.log(`\n══════════════════════════════════════`);
  console.log(`AGENT V9 LIVE: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  console.log(`\nProbe to delete in Firebase Auth: ${EMAIL}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
