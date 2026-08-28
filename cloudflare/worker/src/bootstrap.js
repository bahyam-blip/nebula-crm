/**
 * Server-side account bootstrap + one-time Firestore → D1 migration.
 *
 * bootstrapUser ports the Dart AuthService signup logic (user doc, bootstrap
 * claim, invite adoption, team ensure, capability seeding, audit entry) to
 * the Worker, so the app only says "here is my token" and everything else
 * happens server-side against D1.
 */

import { getDoc, putDoc, queryDocs, toStorage, fsRestToStorage } from './data.js';

/* ── Capability seeding (mirrors lib/core/auth/capabilities.dart) ── */

const ALL_CAPS = [
  'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.import', 'contacts.export',
  'leads.distribute', 'leads.reassign', 'calls.log',
  'deals.view', 'deals.edit', 'deals.delete',
  'tasks.create', 'tasks.assignOthers',
  'team.view', 'team.invite', 'team.changeRoles', 'team.managePermissions',
  'commissions.viewOwn', 'commissions.viewTeam', 'commissions.approve', 'commissions.setRate',
  'performance.view', 'audit.view', 'ai.actions', 'settings.manage',
];

function defaultCapabilityIdsFor(role) {
  const sets = {
    superAdmin: ALL_CAPS,
    admin: ALL_CAPS.filter((c) => !['team.changeRoles', 'team.managePermissions', 'commissions.setRate'].includes(c)),
    manager: [
      'contacts.view', 'contacts.create', 'contacts.edit', 'contacts.import',
      'leads.distribute', 'leads.reassign', 'calls.log',
      'deals.view', 'deals.edit', 'tasks.create', 'tasks.assignOthers',
      'team.view', 'commissions.viewOwn', 'commissions.viewTeam', 'performance.view', 'ai.actions',
    ],
    salesRep: [
      'contacts.view', 'contacts.create', 'contacts.edit', 'calls.log',
      'deals.view', 'deals.edit', 'tasks.create', 'team.view', 'commissions.viewOwn',
    ],
    supportAgent: ['contacts.view', 'contacts.edit', 'calls.log', 'tasks.create', 'team.view'],
    viewer: ['contacts.view', 'deals.view', 'team.view'],
  };
  return [...(sets[role] || sets.salesRep)].sort();
}

/* ── Bootstrap ───────────────────────────────────────────────────── */

export async function bootstrapUser(env, db, { claims }) {
  const uid = claims.sub;
  const email = String(claims.email || '').trim();
  const providerName = String(claims.name || '').trim();
  const providerPhoto = String(claims.picture || '').trim();

  const existing = await getDoc(db, 'users', uid);
  if (existing) {
    // Keep the profile warm: lastActive + email refresh, never clobber an
    // uploaded avatar with the provider photo (same rule as before).
    const patch = { lastActiveAt: { __type: 'svts' }, email: email || existing.data.email || '' };
    const ownPhoto = String(existing.data.photoUrl || '').trim();
    if (!ownPhoto && providerPhoto) patch.photoUrl = providerPhoto;
    await putDoc(db, 'users', uid, { ...existing.data, ...patch }, { merge: true });
    return {
      user: { id: uid, ...(await getDoc(db, 'users', uid)).data },
      flags: { existing: true },
    };
  }

  // First user claims the workspace (create-once race in D1).
  let isFirstUser = false;
  const claim = await db
    .prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING')
    .bind('bootstrap_owner', uid)
    .run();
  if (claim?.meta?.changes > 0) isFirstUser = true;
  else {
    const row = await db.prepare('SELECT v FROM meta WHERE k = ?').bind('bootstrap_owner').first();
    isFirstUser = row?.v === uid; // reclaim by the same owner is a no-op repair
  }

  let role = isFirstUser ? 'superAdmin' : 'salesRep';
  let teamId = env.DEFAULT_TEAM_ID || 'default-team'; // matches AppConstants.defaultTeamId

  // An admin can pre-assign a role by email (the invite flow).
  let invite = null;
  if (!isFirstUser && email) {
    const rows = await queryDocs(db, { col: 'invites', where: [{ field: 'email', value: email }], limit: 5 });
    invite = rows.map((r) => ({ id: r.id, data: r.data })).find((r) => !r.data.accepted) || null;
    if (invite) {
      role = invite.data.role || role;
      teamId = invite.data.teamId || teamId;
    }
  }

  // Ensure the team doc exists (best-effort, mirrors the old flow).
  try {
    const team = await getDoc(db, 'teams', teamId);
    if (!team) {
      await putDoc(db, 'teams', teamId, toStorage({
        id: teamId,
        name: 'Default Team',
        ownerId: uid,
        plan: 'free',
        teamId,
      }));
    }
  } catch (_) { /* non-fatal */ }

  const now = new Date().toISOString();
  const profile = {
    id: uid,
    email: email || '',
    displayName: providerName || (email ? email.split('@')[0] : 'User'),
    photoUrl: providerPhoto || null,
    phone: null,
    title: null,
    role,
    teamId,
    capabilities: defaultCapabilityIdsFor(role),
    createdAt: { __type: 'ts', v: now },
    lastActiveAt: { __type: 'ts', v: now },
  };
  await putDoc(db, 'users', uid, profile, { merge: false });

  if (invite) {
    await putDoc(db, 'invites', invite.id, { ...invite.data, accepted: true, acceptedBy: uid, acceptedAt: { __type: 'ts', v: now } }, { merge: true });
  }

  // Audit entry (best-effort).
  try {
    await putDoc(db, 'activities', crypto.randomUUID(), toStorage({
      type: 'user_signed_up',
      ownerId: uid,
      teamId,
      title: 'New user signed up',
      description: `${profile.displayName} joined as ${role}`,
      metadata: { role, isFirstUser },
      timestamp: { __type: 'ts', v: now },
    }));
  } catch (_) { /* non-fatal */ }

  return { user: { id: uid, ...profile }, flags: { created: true, isFirstUser, invited: !!invite } };
}

/* ── One-time migration: Firestore REST → D1 ─────────────────────── */

const MIGRATE_COLLECTIONS = [
  'users', 'teams', 'invites', 'contacts', 'deals', 'tickets', 'campaigns',
  'activities', 'articles', 'insights', 'notes', 'companies', 'commissions',
  'settings', 'tasks', 'call_logs', 'audit_logs', 'chat_threads',
];

const COLS_WITH_TEAM = new Set(MIGRATE_COLLECTIONS);

async function fsBase(env) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`;
}

/** Page one collection (or subcollection path) from Firestore REST. */
async function* pageFirestore(env, path) {
  const { getAccessToken } = await import('./push.js');
  const token = await getAccessToken(env);
  let pageToken = null;
  for (let i = 0; i < 200; i++) { // hard cap: 200 pages × 500 docs
    const url = new URL(`${await fsBase(env)}/documents/${path}`);
    url.searchParams.set('pageSize', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (res.status === 404) return; // collection never existed
      throw new Error(`Firestore read ${res.status} for ${path}: ${t.slice(0, 150)}`);
    }
    const json = await res.json();
    for (const doc of json.documents || []) yield doc;
    pageToken = json.nextPageToken;
    if (!pageToken) return;
  }
}

/** REST document → {id, data} in storage form. */
function fsDocToStorage(doc) {
  const id = doc.name.split('/').pop();
  const data = {};
  for (const [k, v] of Object.entries(doc.fields || {})) data[k] = fsRestToStorage(v);
  return { id, data };
}

export async function migrateFromFirestore(env, db) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT not set — cannot read legacy Firestore');
  }
  const counts = {};
  let total = 0;

  const upsertBatch = async (col, rows) => {
    if (!rows.length) return;
    const stmt = db.prepare(
      `INSERT INTO docs (col, id, team_id, json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(col, id) DO UPDATE SET team_id = excluded.team_id, json = excluded.json, updated_at = excluded.updated_at`
    );
    const now = Date.now();
    await db.batch(rows.map((r) => stmt.bind(col, r.id, r.teamId, r.json, now, now)));
  };

  for (const col of MIGRATE_COLLECTIONS) {
    let n = 0;
    let buf = [];
    for await (const restDoc of pageFirestore(env, col)) {
      const { id, data } = fsDocToStorage(restDoc);
      if (!id) continue;
      const teamId = typeof data.teamId === 'string' ? data.teamId : null;
      buf.push({ id, teamId, json: JSON.stringify(data) });
      n++;
      if (buf.length >= 200) { await upsertBatch(col, buf); buf = []; }
    }
    if (buf.length) await upsertBatch(col, buf);
    counts[col] = n;
    total += n;

    // Subcollections: chat_threads/{tid}/messages
    if (col === 'chat_threads') {
      let mn = 0;
      let mbuf = [];
      for await (const restDoc of pageFirestore(env, 'chat_threads')) {
        const { id: tid } = fsDocToStorage(restDoc);
        for await (const msg of pageFirestore(env, `chat_threads/${tid}/messages`)) {
          const { id: mid, data } = fsDocToStorage(msg);
          if (!mid) continue;
          const teamId = typeof data.teamId === 'string' ? data.teamId : null;
          mbuf.push({ id: mid, teamId, json: JSON.stringify(data) });
          mn++;
          if (mbuf.length >= 200) {
            await upsertBatch(`chat_threads/${tid}/messages`, mbuf);
            mbuf = [];
          }
        }
        if (mbuf.length) { await upsertBatch(`chat_threads/${tid}/messages`, mbuf); mbuf = []; }
      }
      counts['chat_threads/*/messages'] = mn;
      total += mn;
    }
  }

  // system/ singletons → meta (bootstrap claim + repair markers)
  let sysN = 0;
  for await (const restDoc of pageFirestore(env, 'system')) {
    const { id, data } = fsDocToStorage(restDoc);
    if (id === 'bootstrap' && data.ownerId) {
      await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO NOTHING')
        .bind('bootstrap_owner', String(data.ownerId)).run();
      sysN++;
    } else {
      await db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
        .bind(`system:${id}`, JSON.stringify(data)).run();
      sysN++;
    }
  }
  counts['system→meta'] = sysN;

  return { total, counts, migratedAt: new Date().toISOString() };
}
