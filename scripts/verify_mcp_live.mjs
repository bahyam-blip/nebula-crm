#!/usr/bin/env node
/**
 * LIVE post-deploy verification for the AGENT V3 release (3f993a0):
 *   1. GET /mcp capability advert (public)
 *   2. Pairing grant minted with a Firebase token (no static API tokens)
 *   3. MCP handshake: initialize → tools/list (23 tools) → tools/call
 *   4. Role enforcement over MCP is implicit (probe user has no role yet →
 *      role-gated tools hidden from tools/list)
 *   5. REAL WEBSITE built by the agent (live Sarvam) and served publicly
 *      from /sites/<id>
 *   6. Live-web research attempt (search) — informational, provider-side
 *      blocks on datacenter IPs are reported honestly, not failed hard
 *   7. Grant revoke → MCP access gone (401)
 *
 * Creates ONE throwaway probe user (delete in Firebase Auth afterwards).
 * Usage: node scripts/verify_mcp_live.mjs
 */
const KEY = 'AIzaSyAmI0s71dkSfGrDo2mOrmgCUXk8UUYK2Fs';
const WORKER = 'https://nebula-crm-storage.nebula-crm.workers.dev';
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const EMAIL = `nebula.mcp.probe.${STAMP}@gmail.com`;
const PW = 'Nebula!Probe' + STAMP;

let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

async function mcpRpc(rpc, token) {
  const res = await fetch(`${WORKER}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(rpc),
  });
  let body = null;
  try { body = await res.json(); } catch { /* notifications */ }
  return { status: res.status, body };
}

async function main() {
  // 0) Probe token
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
    token = si.ok ? (await si.json()).idToken : null;
  }
  ok(!!token, 'probe token minted', EMAIL);

  // 0b) Bootstrap the probe's profile (the app does this on first launch;
  // a fresh probe claims salesRep — a writing role, not a manager). MCP
  // tools always run under THIS role enforcement.
  const boot = await fetch(`${WORKER}/v1/data/bootstrap`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const bootJson = await boot.json().catch(() => ({}));
  ok(boot.status === 200 && bootJson?.user?.role === 'salesRep', 'probe profile bootstrapped (salesRep)', JSON.stringify(bootJson).slice(0, 140));

  // 1) Public capability advert
  const info = await (await fetch(`${WORKER}/mcp`)).json();
  ok(info.server === 'nebula-crm-mcp' && info.tools === 33, 'GET /mcp advert live', JSON.stringify(info).slice(0, 120));
  ok(String(info.auth?.mode || '').includes('pairing'), 'advert documents grant auth');

  // 2) Pairing grant from the app's identity
  const pairRes = await fetch(`${WORKER}/v1/assistant/mcp/pair`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'live-verify' }),
  });
  const pair = await pairRes.json();
  ok(pairRes.status === 200 && typeof pair.token === 'string' && pair.token.startsWith('mcp_'),
    'pairing grant minted (mcp_ 24h secret)', JSON.stringify(pair).slice(0, 120));
  const grant = pair.token;

  // 3) MCP handshake
  const noAuth = await mcpRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, null);
  ok(noAuth.status === 401 && noAuth.body?.error?.code === -32001, '/mcp rejects anonymous callers (401 JSON-RPC)');

  const init = await mcpRpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, grant);
  ok(init.body?.result?.serverInfo?.name === 'nebula-crm-mcp' && !!init.body?.result?.capabilities?.tools,
    'MCP initialize handshake (grant auth)', JSON.stringify(init.body).slice(0, 140));

  const list = await mcpRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }, grant);
  const tools = (list.body?.result?.tools || []).map((t) => t.name);
  ok(tools.length === 23, `tools/list → 23 tools for a salesRep (+refine_site +plan_task +list_skills +learn_skill; got ${tools.length})`);
  ok(['build_website', 'web_search', 'web_fetch', 'save_note', 'list_artifacts', 'create_email_task', 'search_contacts'].every((n) => tools.includes(n)),
    'builder + research + CRM + email tools all exposed');

  // Manager-only tools must be hidden from a salesRep's tools/list
  ok(!tools.includes('assign_leads') && !tools.includes('update_deal_stage'),
    'manager-only tools hidden (role filtering over MCP)');

  // 4) tools/call — a read tool
  const call = await mcpRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'crm_overview', arguments: {} } }, grant);
  const inner = JSON.parse(call.body?.result?.content?.[0]?.text || '{}');
  ok(call.body?.result?.isError === false && inner.ok === true && typeof inner.crm === 'object',
    'tools/call crm_overview executed live', JSON.stringify(inner).slice(0, 140));

  // 5) THE MONEY SHOT — the agent builds a REAL website, live Sarvam, hosted publicly
  const build = await mcpRpc({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: {
      name: 'build_website',
      arguments: {
        title: 'Mist & Mocha',
        kind: 'landing',
        brief: 'A cozy artisan coffeehouse in Pune launching its autumn menu. Single-origin pour-overs, jaggery cold brew, walnut banana bread. Warm premium mood, CTA "Reserve a table".',
      },
    },
  }, grant);
  const buildRes = JSON.parse(build.body?.result?.content?.[0]?.text || '{}');
  ok(build.body?.result?.isError === false && buildRes.ok === true,
    'build_website executed live (real Sarvam build)', JSON.stringify(buildRes).slice(0, 160));
  ok(typeof buildRes.url === 'string' && buildRes.url.includes('/sites/'), 'build returned a public URL', buildRes.url);
  console.log(`    → built with: ${buildRes.builder}, ${buildRes.bytes} bytes, url: ${buildRes.url}`);
  if (!buildRes.url) {
    ok(false, 'build returned no URL — cannot fetch site', JSON.stringify(buildRes).slice(0, 200));
  } else {
    const siteRes = await fetch(`${WORKER}${buildRes.url.replace(WORKER, '')}`);
    const siteHtml = await siteRes.text();
    ok(siteRes.status === 200 && siteRes.headers.get('content-type').includes('text/html'), 'site is LIVE at /sites/<id>');
    ok(/<!doctype html|<html/i.test(siteHtml) && siteHtml.length > 800, 'served page is a real HTML document', `${siteHtml.length} bytes`);
    ok(/mist|mocha|coffee|reserve/i.test(siteHtml), 'page content matches the brief', siteHtml.slice(0, 80).replace(/\n/g, ' '));
  }

  // 6) Live-web search — informational (DDG may block datacenter IPs)
  const search = await mcpRpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'web_search', arguments: { query: 'specialty coffee trends india 2026' } } }, grant);
  const searchRes = JSON.parse(search.body?.result?.content?.[0]?.text || '{}');
  if (searchRes.ok) {
    ok(true, `web_search live via ${searchRes.provider} (${searchRes.count} results)`);
  } else {
    console.log(`  ℹ web_search unavailable from this IP (providers: ${searchRes.error?.slice(0, 100)}) — tool honest-failure path verified in unit tests`);
  }

  // 7) Revoke → access gone
  const rev = await fetch(`${WORKER}/v1/assistant/mcp/pair`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  ok(rev.status === 200, 'revoke-all grants');
  await new Promise((r) => setTimeout(r, 1500)); // D1 eventual visibility
  const after = await mcpRpc({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }, grant);
  ok(after.status === 401, 'revoked grant can no longer call /mcp (401)', `got ${after.status}`);

  // Summary
  console.log(`\n════════════════════════════════════════`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  } else {
    console.log('  ALL GREEN — MCP agent verified LIVE');
    console.log(`  Probe user to delete in Firebase Auth: ${EMAIL}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
