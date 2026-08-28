/**
 * Mailer task store — owner instructions + execution state, in Workers KV.
 *
 * Lifecycle:  pending → planning → active → done | failed | cancelled
 * KV keys:    mail:task:<id>   full task object
 *             mail:task:index  JSON array of ids (newest first)
 *             mail:lock        run lock (no overlapping cron runs)
 */

const TTL = 60 * 60 * 24 * 180; // keep tasks 180 days

export async function putTask(kv, task) {
  await kv.put(`mail:task:${task.id}`, JSON.stringify(task), { expirationTtl: TTL });
  const index = JSON.parse((await kv.get('mail:task:index')) || '[]');
  if (!index.includes(task.id)) index.unshift(task.id);
  await kv.put('mail:task:index', JSON.stringify(index.slice(0, 200)));
}

export async function getTask(kv, id) {
  const raw = await kv.get(`mail:task:${id}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listTasks(kv) {
  const index = JSON.parse((await kv.get('mail:task:index')) || '[]');
  const out = [];
  for (const id of index) {
    const t = await getTask(kv, id);
    if (t) out.push(t);
  }
  return out;
}

export async function deleteTask(kv, id) {
  await kv.delete(`mail:task:${id}`);
  const index = JSON.parse((await kv.get('mail:task:index')) || '[]').filter((x) => x !== id);
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
    error: null,
  };
}

export function touch(task, patch = {}) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  return task;
}
