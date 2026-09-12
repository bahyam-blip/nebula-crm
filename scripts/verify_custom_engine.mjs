#!/usr/bin/env node
/**
 * LIVE verification that NEBULA CORE (our own fine-tuned model) is wired in
 * and actually answering production AI calls.
 *
 *   1. GET /v1/health                 — worker alive
 *   2. GET /v1/ai/engine              — engine chain + what is ACTIVE
 *   3. POST /v1/ai (small build task) — the response's `engine` field proves
 *                                       which brain answered this exact call.
 *
 * Verdict:
 *   engine=custom      → NEBULA CORE IS LIVE (owned model answered a real call)
 *   engine=workers-ai  → custom not configured yet, or tunnel down (auto
 *                        fallback did its job — report which)
 *
 * Usage: node scripts/verify_custom_engine.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = `nebula.engine.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function main() {
  console.log('NEBULA CORE — live engine verification\n');

  // 0) Mint a probe token
  let token;
  const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
  });
  if (su.ok) token = (await su.json()).idToken;
  else {
    const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PW, returnSecureToken: true }),
    });
    if (!si.ok) { console.log('probe auth failed:', si.status, await si.text()); process.exit(1); }
    token = (await si.json()).idToken;
  }
  const AH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  ok(!!token, 'probe token minted', EMAIL);

  // 1) health
  const h = await fetch(`${WORKER}/v1/health`);
  ok(h.status === 200, 'GET /v1/health → 200', `got ${h.status}`);

  // 2) engine status
  const er = await fetch(`${WORKER}/v1/ai/engine`, { headers: AH });
  ok(er.status === 200, 'GET /v1/ai/engine → 200', `got ${er.status}`);
  const es = await er.json().catch(() => null);
  if (es) {
    console.log(`\n  engine status:`);
    console.log(`    ready  : ${es.ready}`);
    console.log(`    pinned : ${es.pinned || '(auto — chain walks custom → workers-ai → sarvam)'}`);
    console.log(`    active : ${es.active}`);
    console.log(`    chain  : ${(es.chain || []).join(' → ')}`);
    if (es.models?.custom) console.log(`    custom : ${es.models.custom.model} @ ${es.models.custom.base || '(no URL set)'}`);
  }
  ok(es && es.ready === true, 'engine chain ready', 'no engine configured');
  const customConfigured = !!(es && Array.isArray(es.chain) && es.chain.includes('custom'));

  // 3) real completion through the router
  const t0 = Date.now();
  const cr = await fetch(`${WORKER}/v1/ai`, {
    method: 'POST', headers: AH,
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are Nebula Core, the fine-tuned engineering model of the Nebula platform. Answer in exactly the format asked.' },
        { role: 'user', content: 'Section: cta. Requirement: one promise, one button, no clutter. Business: dental clinic group. Brand tokens: bg #faf7f2, ink #191919, accent #0e7c66. Output the complete <section> with scoped <style>.' },
      ],
      temperature: 0.4,
      max_tokens: 500,
    }),
  });
  const cj = await cr.json().catch(() => null);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  ok(cr.status === 200, `POST /v1/ai → 200 (${dt}s)`, `got ${cr.status}`);
  const content = cj?.choices?.[0]?.message?.content;
  const engine = cj?.engine || '(none)';
  ok(typeof content === 'string' && content.trim().length > 50,
    'completion content non-trivial', cj?.error ? `error=${cj.error} detail=${String(cj?.detail || '').slice(0, 160)}` : 'empty content');

  console.log(`\n  answering engine : ${engine}`);
  console.log(`  first 200 chars  : ${String(content || '').slice(0, 200).replace(/\n/g, ' ')}\n`);

  if (engine === 'custom') {
    ok(/<section|cta|style/i.test(String(content)), 'output looks like Nebula house-style section code');
    console.log('══════════════════════════════════════════════════');
    console.log('  VERDICT: NEBULA CORE IS LIVE.');
    console.log('  Our own fine-tuned model answered a production call.');
    console.log('  Zero third-party AI keys involved. Phase 3 complete.');
    console.log('══════════════════════════════════════════════════');
  } else if (engine === 'workers-ai') {
    if (customConfigured) {
      console.log('  VERDICT: custom engine is configured but FAILED this call —');
      console.log('  the router auto-fell back to Workers AI (that is by design).');
      console.log('  Most likely the Colab tunnel is closed. Re-open the serve');
      console.log('  notebook, get a fresh URL, paste it here.');
    } else {
      console.log('  VERDICT: LLM_CUSTOM_BASE_URL not wired yet — platform is');
      console.log('  running on the free Workers AI engine (also zero-key).');
    }
  } else {
    ok(false, 'unexpected engine', String(engine));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('verify crashed:', e); process.exit(1); });
