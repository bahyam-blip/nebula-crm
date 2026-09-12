#!/usr/bin/env node
/**
 * Tests for the Nebula LLM router (emailer/llm.js) — the engine chain
 * that made the platform key-free:
 *
 *   custom (Nebula Core, OpenAI-compatible) → workers-ai (free binding)
 *   → sarvam (paid legacy).
 *
 * Zero-dependency, mock-engine driven. No network calls leave the process:
 * Workers AI runs against a fake env.AI binding, custom + sarvam against
 * stubbed global fetch.
 *
 *   node scripts/test_llm_router.mjs
 */

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', 'cloudflare', 'worker', 'src', 'emailer');

const { llmChat, llmReady, engineStatus, availableEngines, openAiShape, ENGINES } = await import(
  `file://${join(root, 'llm.js')}`
);
const { sarvamChat } = await import(`file://${join(root, 'sarvam.js')}`);

const realFetch = globalThis.fetch;

/* ── helpers ─────────────────────────────────────────────────────── */

/** Fake Workers AI binding (marker-scans ALL message content). */
function fakeAI(log = []) {
  return {
    async run(model, input) {
      log.push({ model, input });
      const text = input.messages.map((m) => m?.content || '').join('\n');
      if (text.includes('__WAI_DOWN__')) return { errors: [{ code: 7001, message: 'capacity' }] };
      if (text.includes('__WAI_EMPTY__')) return { response: '   ' };
      if (text.includes('__JSON__')) return { response: '```json\n{"ok":true,"engine":"workers-ai"}\n```' };
      return { response: `wai:${text.slice(0, 24)}` };
    },
  };
}

/** Stub fetch for custom-engine + sarvam calls. */
function stubFetch(map) {
  globalThis.fetch = async (url, init = {}) => {
    for (const [prefix, handler] of Object.entries(map)) {
      if (String(url).startsWith(prefix)) return handler(String(url), init);
    }
    return new Response('unmocked', { status: 599 });
  };
}

const openaiJson = (content, { failFirst = 0 } = {}) => {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= failFirst) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
};

const SARVAM_URL = 'https://api.sarvam.ai/';

/* ══ 1. Engine availability matrix ═══════════════════════════════ */
console.log('\n— availability —');
{
  const none = {};
  ok(!llmReady(none), 'no engines configured → not ready');
  ok(availableEngines(none).length === 0, 'empty chain when nothing configured');

  const onlySarvam = { SARVAM_API_KEY: 'k' };
  ok(JSON.stringify(availableEngines(onlySarvam)) === '["sarvam"]', 'sarvam-only env → single engine');

  const full = { AI: fakeAI(), LLM_CUSTOM_BASE_URL: 'http://x/v1', SARVAM_API_KEY: 'k' };
  ok(JSON.stringify(availableEngines(full)) === '["custom","workers-ai","sarvam"]', 'full env → priority order custom→workers-ai→sarvam');

  const st = engineStatus(full);
  ok(st.ready && st.active === 'custom' && st.pinned === null, 'status: ready, active=custom, not pinned');
  ok(st.models.custom.model === 'nebula-core' && !!st.models.custom.base, 'status: custom model info present');
}

/* ══ 2. Workers AI engine ════════════════════════════════════════ */
console.log('\n— workers-ai engine —');
{
  const log = [];
  const env = { AI: fakeAI(log) };
  const out = await llmChat(env, [{ role: 'user', content: 'hello world' }]);
  ok(out === 'wai:hello world', 'basic completion returns response text', out);
  ok(log[0].model.includes('llama-3.3-70b'), 'prose default → 70b fast model', log[0].model);

  const log2 = [];
  await llmChat({ AI: fakeAI(log2) }, [{ role: 'user', content: 'build a section' }], { code: true });
  ok(log2[0].model.includes('qwen2.5-coder-32b'), 'code:true → 32b coder model', log2[0].model);

  const jenv = { AI: fakeAI([]) };
  const parsed = await llmChat(jenv, [{ role: 'user', content: '__JSON__' }], { json: true });
  ok(parsed && parsed.ok === true && parsed.engine === 'workers-ai', 'json mode parses fenced JSON');
}

/* ══ 3. Custom engine (Nebula Core) ══════════════════════════════ */
console.log('\n— custom engine (Nebula Core) —');
{
  stubFetch({
    'http://gguf.local/v1/': openaiJson('core says hi'),
  });
  const env = { LLM_CUSTOM_BASE_URL: 'http://gguf.local/v1' };
  const out = await llmChat(env, [{ role: 'user', content: 'hi' }]);
  ok(out === 'core says hi', 'custom endpoint answer routed through', out);

  const st = engineStatus(env);
  ok(st.active === 'custom', 'custom configured → it leads the chain');
}

/* ══ 4. Fallback chain ═══════════════════════════════════════════ */
console.log('\n— fallback chain —');
{
  stubFetch({
    [SARVAM_URL]: openaiJson('{"ok":true}'),
  });
  // Workers AI fails → falls through to sarvam.
  const env = { AI: fakeAI([]), SARVAM_API_KEY: 'k' };
  const out = await llmChat(env, [{ role: 'user', content: '__WAI_DOWN__' }]);
  ok(typeof out === 'string' && out.length > 0, 'workers-ai down → sarvam answers');

  const env2 = { AI: fakeAI([]) };
  let threw = '';
  try { await llmChat(env2, [{ role: 'user', content: '__WAI_DOWN__' }]); } catch (e) { threw = e.message; }
  ok(threw.includes('All LLM engines failed') && threw.includes('workers-ai'), 'all engines failing → aggregated honest error', threw.slice(0, 60));
}

/* ══ 5. Custom empty-content retry ═══════════════════════════════ */
console.log('\n— resilience —');
{
  stubFetch({
    'http://flaky.local/v1/': openaiJson('recovered', { failFirst: 1 }),
  });
  const out = await llmChat({ LLM_CUSTOM_BASE_URL: 'http://flaky.local/v1' }, [{ role: 'user', content: 'q' }]);
  ok(out === 'recovered', 'custom empty content retries once then succeeds', out);
}

/* ══ 6. Pinning ══════════════════════════════════════════════════ */
console.log('\n— pinning —');
{
  const pinned = { LLM_ENGINE: 'workers-ai', AI: fakeAI([]) };
  ok(engineStatus(pinned).pinned === 'workers-ai', 'LLM_ENGINE var pins the engine');
  ok(engineStatus(pinned).active === 'workers-ai', 'pinned engine becomes active');

  const pinned2 = { LLM_ENGINE: 'workers-ai' };
  let threw = '';
  try { await llmChat(pinned2, [{ role: 'user', content: 'x' }]); } catch (e) { threw = e.message; }
  ok(threw.includes('workers-ai') && !threw.includes('sarvam'), 'pinned engine does NOT fall back to sarvam', threw.slice(0, 60));

  const perCall = { LLM_CUSTOM_BASE_URL: 'http://x/v1', AI: fakeAI([]) };
  stubFetch({});
  const out = await llmChat(perCall, [{ role: 'user', content: 'x' }], { engine: 'workers-ai' });
  ok(String(out).startsWith('wai:'), 'opts.engine forces one engine for one call', out);
}

/* ══ 7. Drop-in compatibility with sarvam.js ═════════════════════ */
console.log('\n— drop-in compatibility —');
{
  ok(typeof sarvamChat === 'function' && typeof llmChat === 'function', 'both entry points exported');
  ok(typeof openAiShape({}) === 'object' && openAiShape('x').choices[0].message.content === 'x', 'openAiShape keeps choices[0].message.content contract');
  ok(Object.keys(ENGINES).length === 3 && ENGINES.custom.cost === 'free (our model)', 'engine catalog: 3 engines, custom is free');

  // json mode through the sarvam engine still works (legacy behavior intact).
  stubFetch({
    [SARVAM_URL]: async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '{"planned":true}' }, finish_reason: 'stop' }] }),
      { status: 200 }
    ),
  });
  const parsed = await sarvamChat({ SARVAM_API_KEY: 'k' }, [{ role: 'user', content: 'plan' }], { json: true });
  ok(parsed && parsed.planned === true, 'sarvam engine json mode unchanged');
}

globalThis.fetch = realFetch;

/* ══ report ══════════════════════════════════════════════════════ */
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error('FAILURES:\n - ' + failures.join('\n - '));
  process.exit(1);
}
