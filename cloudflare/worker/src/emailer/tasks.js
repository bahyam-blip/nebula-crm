/**
 * Mailer task store — owner instructions + execution state, in Workers KV
 * (or Firestore via state.js — same tiny API).
 *
 * Lifecycle:  pending → planning → active → done | failed
 *             any live state → cancelled (owner action; nothing more sends)
 * KV keys:    mail:task:<id>   full task object
 *             mail:task:index  JSON array of ids (newest first)
 *             mail:lock        run lock (no overlapping pipeline runs)
 *
 * Tasks carry an `events[]` audit trail (what the AI did, newest last,
 * capped) so the app can show real progress instead of a spinner.
 */

import { safeParse } from './state.js';

const TTL = 60 * 60 * 24 * 180; // keep tasks 180 days
const MAX_EVENTS = 30;

export async function putTask(kv, task) {
  await kv.put(`mail:task:${task.id}`, JSON.stringify(task), { expirationTtl: TTL });
  const index = safeParse(await kv.get('mail:task:index'), []);
  if (!index.includes(task.id)) index.unshift(task.id);
  await kv.put('mail:task:index', JSON.stringify(index.slice(0, 200)));
}

export async function getTask(kv, id) {
  const raw = await kv.get(`mail:task:${id}`);
  return safeParse(raw, null);
}

export async function listTasks(kv) {
  const index = safeParse(await kv.get('mail:task:index'), []);
  const out = [];
  for (const id of index) {
    const t = await getTask(kv, id);
    if (t) out.push(t);
  }
  return out;
}

export async function deleteTask(kv, id) {
  await kv.delete(`mail:task:${id}`);
  const index = safeParse(await kv.get('mail:task:index'), []).filter((x) => x !== id);
  await kv.put('mail:task:index', JSON.stringify(index));
}

export function newTask(instruction, source = 'api', createdBy = '') {
  const id = `t_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return {
    id,
    instruction: String(instruction).slice(0, 4000),
    source,
    createdBy,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: null,
    emails: [],
    events: [],
    error: null,
  };
}

export function touch(task, patch = {}) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  return task;
}

/** Append a progress event (newest last, capped). */
export function addEvent(task, text, kind = 'info') {
  if (!Array.isArray(task.events)) task.events = [];
  task.events.push({
    at: new Date().toISOString(),
    kind, // info | plan | write | send | error | cancel
    text: String(text).slice(0, 300),
  });
  if (task.events.length > MAX_EVENTS) task.events = task.events.slice(-MAX_EVENTS);
  return task;
}

/** Cancel a live task: nothing further will send. Returns true if it changed. */
export function cancelTaskState(task) {
  if (!['pending', 'planning', 'active'].includes(task.status)) return false;
  task.status = 'cancelled';
  for (const e of task.emails || []) {
    if (e.status === 'planned') e.status = 'cancelled';
  }
  addEvent(task, 'Cancelled by owner — no further emails will send.', 'cancel');
  return touch(task);
}

/**
 * Retry a failed task. Returns a fresh state or null when there is nothing
 * to retry (unknown task / not failed / already live).
 *
 *   • Planning failed (no plan):  back to pending → the pipeline re-plans.
 *   • Plan existed, sends failed: requeue only the failed emails, keep the
 *     already-sent ones — nobody gets the same email twice.
 */
export function retryTaskState(task) {
  if (task.status !== 'failed') return null;
  task.error = null;
  if (!task.plan || !Array.isArray(task.emails) || task.emails.length === 0) {
    task.plan = null;
    task.emails = [];
    task.status = 'pending';
    addEvent(task, 'Retry requested — queued for the AI again.', 'info');
    return touch(task);
  }
  let requeued = 0;
  for (const e of task.emails) {
    if (e.status === 'failed') {
      e.status = 'planned';
      e.error = null;
      // 10 minutes out so a retry never re-fires inside the same minute.
      e.sendAt = new Date(Date.now() + 10 * 60 * 1000 + requeued * 60 * 60 * 1000).toISOString();
      requeued++;
    }
  }
  if (!requeued) return null;
  task.status = 'active';
  addEvent(task, `Retry requested — ${requeued} email(s) requeued.`, 'info');
  return touch(task);
}

/** Derived progress for UI (not persisted). */
export function progressOf(task) {
  const emails = task.emails || [];
  const done = emails.filter((e) => ['sent', 'scheduled', 'dry_run', 'partial'].includes(e.status)).length;
  const failed = emails.filter((e) => e.status === 'failed').length;
  const pending = emails.filter((e) => e.status === 'planned').length;
  const nextSendAt = emails
    .filter((e) => e.status === 'planned' && e.sendAt)
    .map((e) => e.sendAt)
    .sort()[0] || null;
  return { total: emails.length, done, failed, pending, nextSendAt };
}
