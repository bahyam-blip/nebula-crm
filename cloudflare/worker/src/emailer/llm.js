/**
 * ═══════════════════════════════════════════════════════════════════
 *  Nebula LLM Router — one entry point, many engines, $0 keys needed.
 * ═══════════════════════════════════════════════════════════════════
 *
 * The owner directive (2026-09): "train our own model … I cannot pay for
 * api keys from third party ai platforms." This router is the runtime
 * half of that answer. The training half lives in /ml (Nebula Core).
 *
 * Engines, in auto-chain priority order:
 *
 *   1. custom      →  NEBULA CORE — our own fine-tuned model (see /ml).
 *                     Any OpenAI-compatible endpoint works: llama.cpp
 *                     server, vLLM, HF Inference. This is the owned
 *                     model with ZERO marginal cost per token.
 *                     Config: LLM_CUSTOM_BASE_URL (required),
 *                             LLM_CUSTOM_MODEL  (default 'nebula-core'),
 *                             LLM_CUSTOM_API_KEY (optional Bearer).
 *
 *   2. workers-ai  →  Cloudflare Workers AI binding (env.AI). Included
 *                     free with the Cloudflare account (daily neuron
 *                     allocation) — NO API key, NO billing setup. The
 *                     default engine for every fresh deployment.
 *                     qwen2.5-coder-32b for code generation,
 *                     llama-3.3-70b-fast for prose/planning/chat.
 *
 *   3. sarvam      →  the legacy paid provider (sarvam.js). Demoted to
 *                     last resort; still works when its key is present
 *                     so existing deployments never regress.
 *
 * LLM_ENGINE pins exactly one engine: 'custom' | 'workers-ai' | 'sarvam'
 * (pinned engines do NOT fall back — honest failures, easy debugging).
 * Unset/'auto' walks the chain of everything configured.
 *
 * llmChat(env, messages, opts) is a DROP-IN replacement for sarvamChat:
 *   • same signature, same return (content string),
 *   • same opts: { json, maxTokens, temperature, code },
 *   • same tolerant JSON extraction (extractJson),
 *   • plus opts.engine to force one engine for a single call.
 */

import { sarvamChat, extractJson } from './sarvam.js';

/** Default Workers AI models (overridable via vars). */
const WAI_CODER_DEFAULT = '@cf/qwen/qwen2.5-coder-32b-instruct';
const WAI_CHAT_DEFAULT = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Engine metadata for /v1/ai/engine + the Studio engine card. */
export const ENGINES = {
  custom: {
    id: 'custom',
    label: 'Nebula Core (self-hosted fine-tune)',
    cost: 'free (our model)',
    configured: (env) => !!env.LLM_CUSTOM_BASE_URL,
  },
  'workers-ai': {
    id: 'workers-ai',
    label: 'Cloudflare Workers AI',
    cost: 'free daily allocation',
    configured: (env) => !!env.AI,
  },
  sarvam: {
    id: 'sarvam',
    label: 'Sarvam AI (legacy fallback)',
    cost: 'paid per token',
    configured: (env) => !!env.SARVAM_API_KEY,
  },
};

/** Engines available right now, in auto-chain priority order. */
export function availableEngines(env) {
  const order = ['custom', 'workers-ai', 'sarvam'];
  return order.filter((id) => ENGINES[id].configured(env));
}

/** Can ANY engine answer right now? (replaces `!!env.SARVAM_API_KEY` guards) */
export function llmReady(env) {
  return availableEngines(env).length > 0;
}

/** Resolved engine chain for status/introspection endpoints. */
export function engineStatus(env) {
  const pinned = ['custom', 'workers-ai', 'sarvam'].includes(
    String(env.LLM_ENGINE || '').toLowerCase()
  )
    ? String(env.LLM_ENGINE).toLowerCase()
    : null;
  const chain = pinned ? [pinned] : availableEngines(env);
  return {
    ready: chain.length > 0,
    pinned,
    active: chain[0] || null,
    chain,
    models: {
      'workers-ai': {
        chat: env.WAI_CHAT_MODEL || WAI_CHAT_DEFAULT,
        coder: env.WAI_CODER_MODEL || WAI_CODER_DEFAULT,
      },
      custom: { model: env.LLM_CUSTOM_MODEL || 'nebula-core', base: env.LLM_CUSTOM_BASE_URL || null },
      sarvam: { model: env.SARVAM_MODEL || 'sarvam-105b' },
    },
  };
}

/* ══ Engine: Cloudflare Workers AI ══════════════════════════════════ */

async function chatWorkersAI(env, messages, opts = {}) {
  if (!env.AI) throw new Error('workers-ai: no AI binding in wrangler.toml');
  // Code-heavy calls (site/section generation) get the 32B coder; prose,
  // planning and chat get the fast 70B generalist.
  const model =
    opts.model ||
    (opts.code ? env.WAI_CODER_MODEL || WAI_CODER_DEFAULT : env.WAI_CHAT_MODEL || WAI_CHAT_DEFAULT);

  const input = {
    messages,
    max_tokens: Math.max(512, Math.min(opts.maxTokens || 4096, 8192)),
    temperature: opts.temperature ?? 0.6,
  };
  // The coder model honors a hard "JSON only" instruction reliably; we
  // still parse with extractJson afterwards (tolerant of fences).
  if (opts.json) {
    input.messages = [
      ...messages,
      {
        role: 'user',
        content:
          'Respond with a SINGLE valid JSON object and nothing else — no prose, no markdown fences.',
      },
    ];
  }

  let data;
  try {
    data = await env.AI.run(model, input);
  } catch (e) {
    throw new Error(`workers-ai ${model}: ${String(e?.message || e).slice(0, 300)}`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error(`workers-ai ${model}: empty result`);
  }
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(`workers-ai ${model}: ${JSON.stringify(data.errors).slice(0, 300)}`);
  }
  const content = typeof data.response === 'string' ? data.response : '';
  if (!content.trim()) {
    throw new Error(`workers-ai ${model}: empty response`);
  }
  return opts.json ? extractJson(content) : content;
}

/* ══ Engine: Nebula Core (custom OpenAI-compatible endpoint) ════════ */

async function chatCustom(env, messages, opts = {}) {
  const base = String(env.LLM_CUSTOM_BASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('custom: LLM_CUSTOM_BASE_URL not set');
  const model = env.LLM_CUSTOM_MODEL || 'nebula-core';
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const headers = { 'Content-Type': 'application/json' };
    if (env.LLM_CUSTOM_API_KEY) headers.Authorization = `Bearer ${env.LLM_CUSTOM_API_KEY}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.6,
        max_tokens: Math.max(512, Math.min(opts.maxTokens || 4096, 16384)),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`custom ${res.status}: ${t.slice(0, 300)}`);
    }

    const data = await res.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return opts.json ? extractJson(content) : content;
    }
    lastError = new Error(`custom: empty response (attempt ${attempt})`);
  }
  throw lastError;
}

/* ══ Engine: Sarvam (legacy) ════════════════════════════════════════ */

async function chatSarvam(env, messages, opts = {}) {
  if (!env.SARVAM_API_KEY) throw new Error('sarvam: SARVAM_API_KEY not set');
  return sarvamChat(env, messages, opts);
}

const RUNNERS = {
  custom: chatCustom,
  'workers-ai': chatWorkersAI,
  sarvam: chatSarvam,
};

/* ══ The router ═════════════════════════════════════════════════════ */

/**
 * llmChat — route one chat completion through the engine chain.
 * Tries engines in order (pinned → only that one); the first SUCCESS
 * returns. If every engine fails, throws an error naming each failure —
 * never a silent hollow answer.
 */
export async function llmChat(env, messages, opts = {}) {
  const status = engineStatus(env);

  // Per-call override wins, then the pinned var, then the auto chain.
  let chain;
  if (opts.engine && RUNNERS[opts.engine]) {
    chain = [opts.engine];
  } else {
    chain = status.chain;
  }

  if (!chain.length) {
    throw new Error(
      'No LLM engine configured. Set LLM_CUSTOM_BASE_URL (Nebula Core), ' +
        'add the Workers AI binding ([ai] binding="AI"), or set SARVAM_API_KEY.'
    );
  }

  const failures = [];
  for (const id of chain) {
    try {
      return await RUNNERS[id](env, messages, opts);
    } catch (e) {
      failures.push(`${id}: ${String(e?.message || e).slice(0, 200)}`);
    }
  }
  throw new Error(`All LLM engines failed → ${failures.join(' | ')}`);
}

/** OpenAI-shaped wrapper so /v1/ai consumers keep parsing the same shape. */
export function openAiShape(content, { model = 'nebula-router', engine = 'workers-ai' } = {}) {
  return {
    id: `nebula-${Date.now().toString(36)}`,
    object: 'chat.completion',
    model,
    engine,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  };
}
