#!/usr/bin/env node
/**
 * Business Profile (branding) + 1:1 per-recipient sending + template styles.
 *
 * Zero-dependency; mocks every outbound fetch and drives the REAL modules.
 *   node scripts/test_business_brand.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));

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

async function seedDoc(db, col, id, data) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(col, id) DO UPDATE SET json = excluded.json`
  ).bind(col, id, typeof data.teamId === 'string' ? data.teamId : null,
         JSON.stringify(data), now, now).run();
}

let passed = 0;
let failed = 0;
const failures = [];
function ok(cond, name, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name} ${extra}`); }
}

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const serviceAccount = {
  client_email: 'sa@nebula-crm-70f58.iam.gserviceaccount.com',
  private_key: pem,
};

function kvMock() {
  const m = new Map();
  return {
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => void m.set(k, String(v)),
    delete: async (k) => void m.delete(k),
    _map: m,
  };
}

const captured = { sends: [], templates: [], batches: [], campaigns: [] };
// Delivery chain self-invocation shim (chunked sending, see pipeline.js).
let LIVE_ENV = null;
const kickQueue = [];
async function drainKicks() {
  let guard = 0;
  while (kickQueue.length && guard++ < 500) {
    const batch = kickQueue.splice(0);
    await Promise.allSettled(batch);
  }
}
const contactsInCrm = [
  { name: 'Asha Rao', email: 'asha@example.com', status: 'lead', company: 'Acme' },
  { name: 'Vik Singh', email: 'vik@example.com', status: 'customer', company: 'Globex' },
];
let sarvamScript = [];

/* ── Global fetch mock ──────────────────────────────────────────── */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url instanceof Request ? url.url : url);
  const body = typeof init.body === 'string' ? init.body : '';

  if (u === 'https://worker.test/v1/mail/deliver') {
    const payload = JSON.parse(body);
    const res = await deliverInternal(LIVE_ENV, payload, { waitUntil: (p) => kickQueue.push(Promise.resolve(p).catch(() => {})) });
    await drainKicks();
    return jsonRes(res.status, await res.json().catch(() => ({})));
  }
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    return jsonRes(200, { access_token: 'mock-oauth-token', expires_in: 3600 });
  }
  if (u.startsWith('https://api.sarvam.ai/')) {
    const parsed = JSON.parse(body);
    const text = parsed.messages.map((m) => m.content).join('\n');
    if (!('reasoning_effort' in parsed)) {
      return jsonRes(400, { error: { message: 'mock: reasoning_effort missing' } });
    }
    return jsonRes(200, { choices: [{ message: { content: JSON.stringify(sarvamReplyFor(text)) }, finish_reason: 'stop' }] });
  }
  if (u.startsWith('https://email-api.mailercloud.com/')) {
    captured.sends.push({ url: u, body: JSON.parse(body) });
    return jsonRes(200, { status: 'SUCCESS', statusCode: 1000, message: 'NA' });
  }
  if (u.startsWith('https://cloudapi.mailercloud.com/v1/')) {
    const path = u.replace('https://cloudapi.mailercloud.com/v1', '');
    if (path === '/list') return jsonRes(200, { id: 'LST1' });
    if (path === '/contacts/batch') { captured.batches.push(JSON.parse(body)); return jsonRes(200, { status: 'success' }); }
    if (path === '/contacts/upsert') return jsonRes(200, { status: 'success' });
    if (path === '/templates/create') { captured.templates.push(JSON.parse(body)); return jsonRes(200, { id: 'TPL9' }); }
    if (path === '/campaign/save') { captured.campaigns.push(JSON.parse(body)); return jsonRes(200, { id: 'MC1' }); }
    return jsonRes(200, {});
  }
  if (u.startsWith('https://firestore.googleapis.com/')) {
    if (u.includes(':runQuery')) {
      const q = JSON.parse(body);
      if (JSON.stringify(q).includes('"contacts"')) {
        return jsonRes(200, contactsInCrm.map((c, i) => ({
          document: {
            name: `projects/p/databases/(default)/documents/contacts/c${i + 1}`,
            fields: fsFields({ name: c.name, email: c.email, status: c.status, company: c.company, tags: [], createdAt: '2026-08-01T10:00:00Z' }),
          },
        })));
      }
      return jsonRes(200, []);
    }
    if (u.includes('/documents/mail_state/')) return jsonRes(404, { error: { message: 'not found' } });
    if (u.includes('/documents/activities') && init.method === 'POST') return jsonRes(200, { name: 'x/activities/a1' });
    if (u.includes('/documents/campaigns/') && init.method === 'PATCH') return jsonRes(200, { name: 'x/campaigns/x', fields: JSON.parse(body).fields });
    return jsonRes(200, {});
  }
  return realFetch(url, init);
};

function jsonRes(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function sarvamReplyFor(text) {
  for (const s of sarvamScript) if (s.match(text)) return s.reply;
  throw new Error('sarvam mock: no scripted reply for: ' + text.slice(0, 80));
}
function fsFields(plain) {
  const out = {};
  for (const [k, v] of Object.entries(plain)) out[k] = fsVal(v);
  return out;
}
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object') return { mapValue: { fields: fsFields(v) } };
  return { stringValue: String(v) };
}

/* ── Modules under test ─────────────────────────────────────────── */
const { handleMail, runPipeline, mailConfigState, deliverInternal } = await import(
  '../cloudflare/worker/src/emailer/pipeline.js'
);
const { createStore } = await import('../cloudflare/worker/src/emailer/state.js');
const { sendPersonalizedBatch, resolveSender, SEND_CONCURRENCY } = await import(
  '../cloudflare/worker/src/emailer/emailapi.js'
);
const { renderHtml } = await import('../cloudflare/worker/src/emailer/copywriter.js');
const { brandFor, mergeProfilePatch, normalizeStyle, profileToFacts } = await import(
  '../cloudflare/worker/src/emailer/business.js'
);

async function makeEnv() {
  const db = makeD1();
  for (const [i, c] of contactsInCrm.entries()) {
    await seedDoc(db, 'contacts', `c${i + 1}`, {
      name: c.name, email: c.email, status: c.status, company: c.company,
      tags: [], segments: [], createdAt: '2026-08-01T10:00:00.000Z', teamId: 'default-team',
    });
  }
  const env = {
    DB: db,
    FIREBASE_PROJECT_ID: 'p',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify(serviceAccount),
    MAILERCLOUD_API_KEY: 'mc_test_key',
    SARVAM_API_KEY: 'sarvam_test',
    NEBULA_EMAIL_KV: kvMock(),
    MAIL_DRY_RUN: 'false',
    MAIL_DELIVERY_MODE: 'auto',
    MAIL_TRANSACTIONAL_MAX: '250',
    MAIL_BUSINESS_NAME: 'Nebula CRM',
    MAIL_TIMEZONE: 'Asia/Calcutta',
    MAIL_SENDER_EMAIL: 'das@aidraft.bond',
    MAIL_RUN_RETRY_MS: '20',
    MAIL_ANALYTICS_INTERVAL_HOURS: '24',
    MAIL_SELF_URL: 'https://worker.test',
  };
  LIVE_ENV = env;
  return env;
}

async function call(env, method, path, body, uid = 'user_123') {
  const url = new URL(`https://worker.test${path}`);
  const req = new Request(url, {
    method,
    headers: { Authorization: 'Bearer whatever', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const waits = [];
  const res = await handleMail(req, env, { url, uid, ctx: { waitUntil: (p) => waits.push(p) } });
  return { res, json: await res.json(), waits };
}
const drain = (waits) => Promise.allSettled(waits.map((p) => Promise.resolve(p)));

const BRAND_PATCH = {
  business_name: 'Aidraft Legal',
  tagline: 'AI document intelligence for law firms',
  about: 'AI-powered legal drafting platform for Indian law firms',
  industry: 'Legal Technology',
  products: ['AI contract drafting', 'Document review'],
  audience: 'Law firms and independent advocates',
  tone: 'Confident, precise, premium',
  website: 'aidraft.bond',
  address: 'MG Road, Bengaluru 560001',
  contact_email: 'hello@aidraft.bond',
  sender_name: 'Aidraft Legal',
  signature_name: 'Team Aidraft',
  brand_color: '#7C5CFF',
  default_style: 'modern',
};

/* ══════════════════════ Tests ══════════════════════ */

console.log('\n— 1. Business Profile: CRUD + validation —');
{
  const env = await makeEnv();
  const empty = await call(env, 'GET', '/v1/mail/business');
  ok(empty.res.status === 200, 'GET /business → 200 (works before pipeline configured)');
  ok(empty.json.profile && empty.json.profile.business_name === '', 'empty profile shape');
  ok(Array.isArray(empty.json.template_styles) && empty.json.template_styles.includes('gradient'), 'template_styles exposed');
  ok(empty.json.brand.branded === false, 'brand.branded false when unset');
  ok(empty.json.brand.name === 'Nebula CRM', 'brand falls back to env/CRM name when unset');

  const bad = await call(env, 'POST', '/v1/mail/business', { default_style: 'sparkly' });
  ok(bad.res.status === 400, 'invalid default_style → 400', JSON.stringify(bad.json).slice(0, 100));

  const save = await call(env, 'POST', '/v1/mail/business', BRAND_PATCH);
  ok(save.res.status === 200 && save.json.ok === true, 'POST /business saves a full patch');
  ok(save.json.profile.business_name === 'Aidraft Legal', 'business name stored');
  ok(save.json.profile.website === 'https://aidraft.bond', 'website auto-schemed', save.json.profile.website);
  ok(save.json.profile.brand_color === '#7c5cff', 'brand_color normalized to lower hex', save.json.profile.brand_color);
  ok(save.json.profile.default_style === 'modern', 'default_style accepted');
  ok(save.json.taught === true, 'profile facts taught to AI memory');
  ok(save.json.brand.fromName === 'Aidraft Legal', 'brand.fromName = owner business (no more Nebula CRM)', save.json.brand.fromName);
  ok(save.json.brand.signature === 'Team Aidraft', 'signature honoured');

  // Partial patch merges, does not clobber
  const partial = await call(env, 'POST', '/v1/mail/business', { tagline: 'Draft faster than the clock' });
  ok(partial.res.status === 200, 'partial patch → 200');
  ok(partial.json.profile.business_name === 'Aidraft Legal', 'partial patch keeps business_name');
  ok(partial.json.profile.tagline === 'Draft faster than the clock', 'partial patch updates tagline');

  const reread = await call(env, 'GET', '/v1/mail/business');
  ok(reread.json.brand.branded === true, 'brand.branded true after save');
  ok(reread.json.profile.industry === 'Legal Technology', 'profile persists across reads');

  const st = await call(env, 'GET', '/v1/mail/status');
  ok(st.json.business_profile?.branded === true, '/status reports branded identity');
  ok(st.json.sender?.fromName === 'Aidraft Legal', '/status sender.fromName = business brand', st.json.sender?.fromName);

  // Memory got the owner facts
  const mem = await call(env, 'GET', '/v1/mail/memory');
  ok(mem.json.memory.facts.industry === 'Legal Technology', 'memory learned industry (owner origin)');
  ok(mem.json.memory.facts_origin.industry === 'owner', 'memory facts tagged owner');
  ok(mem.json.memory.facts.tone === 'Confident, precise, premium', 'memory learned tone');

  // Brief cache invalidated by the save
  const store = createStore(env);
  ok((await store.get('biz:brief')) === null, 'saving profile invalidated the cached AI brief');
}

console.log('\n— 2. Test send goes out under the business brand —');
{
  const env = await makeEnv();
  await call(env, 'POST', '/v1/mail/business', BRAND_PATCH);
  captured.sends.length = 0;

  const t = await call(env, 'POST', '/v1/mail/test', { to: 'owner@example.com' });
  ok(t.res.status === 200 && t.json.ok === true, 'POST /test → ok');
  ok(t.json.from === 'Aidraft Legal <das@aidraft.bond>', 'From display = business brand', t.json.from);
  ok(t.json.subject.startsWith('Aidraft Legal test email'), 'subject fallback uses business name', t.json.subject);

  const send = captured.sends.at(-1);
  ok(send?.body?.email?.fromName === 'Aidraft Legal', 'provider payload fromName = brand', send?.body?.email?.fromName);
  const html = send?.body?.email?.html || '';
  ok(html.includes('Aidraft Legal'), 'HTML carries business name');
  ok(html.includes('MG Road, Bengaluru 560001'), 'HTML footer carries business address');
  ok(html.includes('hello@aidraft.bond'), 'HTML footer carries contact email');
  ok(html.includes('Team Aidraft'), 'HTML signature = Team Aidraft');
  ok(!html.includes('Team Nebula CRM') && !html.includes('© ' + new Date().getUTCFullYear() + ' Nebula CRM'), 'no Nebula CRM branding leaks through');
  ok(html.includes('https://aidraft.bond'), 'website link present');
}

console.log('\n— 3. 1:1 sending — every recipient gets a PRIVATE copy —');
{
  const env = await makeEnv();
  captured.sends.length = 0;
  const out = await sendPersonalizedBatch(env, {
    subject: 'Hello {{first_name}}',
    html: '<p>Hi {{first_name}},</p>',
    recipients: [
      { name: 'Asha Rao', email: 'asha@example.com', merge_vars: { first_name: 'Asha' } },
      { name: 'Vik Singh', email: 'vik@example.com', merge_vars: { first_name: 'Vik' } },
      { name: 'Third Person', email: 'third@example.com', merge_vars: { first_name: 'Third' } },
    ],
    metadata: { messageId: 'm1', custom: { campaign_id: 'c1' } },
  });
  ok(out.sent === 3 && out.failed === 0, '3/3 accepted', JSON.stringify(out));
  const apiSends = captured.sends.filter((s) => s.url.endsWith('/email-api'));
  ok(apiSends.length === 3, 'exactly 3 /email-api requests (one per recipient)', String(apiSends.length));
  ok(apiSends.every((s) => s.body.email.recipients.to.length === 1), 'every request has EXACTLY ONE To: address — no cross-visibility');
  const tos = apiSends.map((s) => s.body.email.recipients.to[0].email).sort();
  ok(JSON.stringify(tos) === JSON.stringify(['asha@example.com', 'third@example.com', 'vik@example.com']), 'each address sent its own message', JSON.stringify(tos));
  const asha = apiSends.map((s) => s.body.email.recipients.to[0]).find((r) => r.email === 'asha@example.com');
  ok(asha.merge_vars?.first_name === 'Asha', 'per-recipient merge vars intact');
  ok(apiSends.every((s) => JSON.stringify(s.body.email.recipients.to).length < 120), 'no request carries another recipient');
}

console.log('\n— 4. Pipeline send: branded, named, individual —');
{
  const env = await makeEnv();
  await call(env, 'POST', '/v1/mail/business', BRAND_PATCH);
  captured.sends.length = 0;
  sarvamScript = [
    { match: (t) => t.includes('build a marketing brief'), reply: {
        business_type: 'Legal AI drafting', industry: 'LegalTech', target_audience: 'law firms',
        value_props: ['fast'], tone: 'premium', topics_pool: [], segment_hints: [], language: 'en',
      } },
    { match: (t) => t.includes('OWNER TASK'), reply: {
        understanding: 'send to two named people',
        audience: { segment: null, max_recipients: 2 },
        explicit_recipients: ['asha@example.com', 'vik@example.com'],
        emails: [{ seq: 1, sendAt: new Date(Date.now() - 1000).toISOString(), goal: 'intro', angle: 'hook', tone: 'premium', template_style: 'bold' }],
        reasoning: 'r',
      } },
    { match: (t) => t.includes('Write ONE high-engagement'), reply: {
        subject: 'Stop hunting for clauses', preheader: 'p', headline: 'Draft in minutes',
        intro: 'Straight into the value.', sections: [{ title: 'Why', body: 'Because time is money.' }],
        cta_text: 'See it live', closing: 'Cheers,', ps: '',
      } },
  ];
  const created = await call(env, 'POST', '/v1/mail/tasks', { instruction: 'Send an email to asha@example.com and vik@example.com about our drafting AI' });
  ok(created.res.status === 201, 'task created');
  await drain(created.waits);

  const tasks = (await call(env, 'GET', '/v1/mail/tasks')).json.tasks;
  const t = tasks.find((x) => x.id === created.json.task.id);
  if (t?.emails?.[0]?.status !== 'sent') console.log('    [brand-debug]', JSON.stringify({ status: t?.status, emails: t?.emails?.map((e) => ({ s: e.status, err: e.error, d: e.delivery })) }));
  ok(t?.status === 'done' && t.emails[0].status === 'sent', 'task done + email sent', `${t?.status}/${t?.emails?.[0]?.status}`);

  const apiSends = captured.sends.filter((s) => s.url.endsWith('/email-api'));
  ok(apiSends.length === 2, 'TWO separate private emails (not one To: with both)', String(apiSends.length));
  ok(apiSends.every((s) => s.body.email.recipients.to.length === 1), 'each email has exactly one recipient');
  ok(apiSends.every((s) => s.body.email.fromName === 'Aidraft Legal'), 'From name = business brand on every email', apiSends[0]?.body?.email?.fromName);
  const byRecipient = new Map(apiSends.map((s) => [s.body.email.recipients.to[0].email, s]));
  ok(byRecipient.get('asha@example.com')?.body.email.recipients.to[0].merge_vars?.first_name === 'Asha',
    'Asha gets "Hi Asha," (name from CRM)', JSON.stringify(byRecipient.get('asha@example.com')?.body.email.recipients.to[0]));
  ok(byRecipient.get('vik@example.com')?.body.email.recipients.to[0].merge_vars?.first_name === 'Vik',
    'Vik gets "Hi Vik," (name from CRM)');
  const html = byRecipient.get('asha@example.com')?.body.email.html || '';
  ok(html.includes('Aidraft Legal') && html.includes('Team Aidraft'), 'branded HTML (name + signature)');
  ok(html.includes('Hi {{first_name}},'), 'salutation merge var present for personalization');
  ok(html.includes('MG Road'), 'footer address present');
  // bold template chosen by the plan
  ok(html.includes('font-size:31px') || html.includes('letter-spacing:-.3px'), 'bold template hero rendered (AI-chosen style)');
}

console.log('\n— 5. Template styles: five distinct branded renders —');
{
  const env = await makeEnv();
  await call(env, 'POST', '/v1/mail/business', BRAND_PATCH);
  const profile = (await call(env, 'GET', '/v1/mail/business')).json.profile;
  const brand = brandFor(env, profile);
  const copy = {
    subject: 's', preheader: 'p', headline: 'H', intro: 'i',
    sections: [{ title: 'T', body: 'B' }], cta_text: 'C', closing: 'cl', ps: 'ps',
  };
  const styles = ['modern', 'classic', 'bold', 'minimal', 'gradient'];
  const htmls = {};
  for (const s of styles) {
    htmls[s] = renderHtml(env, copy, { brand, style: s, personalize: true });
    ok(htmls[s].includes('Aidraft Legal'), `${s}: branded`, '');
    ok(htmls[s].includes('Hi {{first_name}},'), `${s}: personalized salutation`);
    ok(htmls[s].includes('You are receiving this because you subscribed to updates from Aidraft Legal'), `${s}: permission line = brand`);
    ok(htmls[s].includes('v1/t/o.png') === false, `${s}: no pixel without track`);
  }
  const uniq = new Set(styles.map((s) => htmls[s].replace(/\s+/g, '')));
  ok(uniq.size === 5, 'five visually distinct templates', String(uniq.size));

  const tracked = renderHtml(env, copy, { brand, track: { campaignId: 'c1' } });
  ok(tracked.includes('v1/t/o.png?c=c1&u=%7B%7Bopen_uid%7D%7D'), 'tracking pixel + merge-var token');
  ok(normalizeStyle('newsletter') === 'classic' && normalizeStyle('offer') === 'bold' && normalizeStyle('story') === 'minimal'
     && normalizeStyle('tip') === 'gradient' && normalizeStyle('announcement') === 'modern', 'legacy planner styles map');
  ok(normalizeStyle('nonsense') === '' && normalizeStyle('') === '', 'unknown style rejected');

  // Fallback brand (no profile at all) still renders coherently
  const plain = renderHtml({ MAIL_BUSINESS_NAME: 'Nebula CRM' }, copy, {});
  ok(plain.includes('Nebula CRM'), 'fallback brand renders when no profile');
}

console.log('\n— 6. mergeProfilePatch + profileToFacts unit behavior —');
{
  const merged = mergeProfilePatch({ business_name: 'X', products: ['a'] }, { products: 'p1, p2; p3', brand_color: 'nothex', website: 'example.com' });
  ok(merged.products.length === 3 && merged.products[0] === 'p1', 'string products split+cleaned', JSON.stringify(merged.products));
  ok(merged.brand_color === '', 'bad hex rejected');
  ok(merged.website === 'https://example.com', 'website schemed');
  const facts = profileToFacts({ business_name: 'Aidraft', about: 'AI legal drafting', industry: 'LegalTech', products: ['x'], tone: 'sharp', audience: 'firms', offers: ['free trial'] });
  ok(facts.business_type === 'Aidraft — AI legal drafting', 'facts compose name+about', facts.business_type);
  ok(facts.products.length === 1 && facts.tone === 'sharp' && facts.offers.length === 1, 'facts carry all AI-sync fields');

  const env = await makeEnv();
  const brand = brandFor(env, { business_name: 'Co', contact_email: 'hi@co.in', sender_name: 'Co HQ' });
  const sender = resolveSender(env, brand);
  ok(sender.fromName === 'Co HQ', 'resolveSender: brand.fromName beats env', sender.fromName);
  ok(sender.replyTo === 'hi@co.in', 'resolveSender: profile contact_email → reply-to', sender.replyTo);
  ok(SEND_CONCURRENCY >= 2 && SEND_CONCURRENCY <= 10, 'send concurrency sane', String(SEND_CONCURRENCY));

  const cfg = await mailConfigState(env, createStore(env));
  ok(cfg.sender.fromName === 'Nebula CRM', 'mailConfigState falls back to CRM name without profile');
}

console.log('\n══════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('ALL GREEN');
