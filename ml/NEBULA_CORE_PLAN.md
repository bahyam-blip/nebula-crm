# NEBULA CORE — the owned-model plan

**Owner directive (2026-09):** "train our own model to coding and to do all the work
because I cannot pay for api keys from third party ai platforms."

This document is the research → decision → build record. The build shipped with it.

## 1. The cost reality (why this architecture)

| Path | Cost to train | Cost to run | Verdict |
|---|---|---|---|
| Third-party API keys (Sarvam etc.) | — | paid per token, quota anxiety | **what we are escaping** |
| Full pretrain of an LLM | $100k+ | GPU cluster | fantasy — never |
| **QLoRA fine-tune of an open 3B/7B coder** | **$0** (free Colab T4) | **$0** (llama.cpp on any 8 GB box) | **the play** |
| Cloudflare Workers AI | — | free daily allocation on the account we already have | free default engine today |

An honest note on expectations: a QLoRA-tuned 3B will not out-think a 70B+ API model
on open-ended reasoning. What it WILL do — because that is exactly what the corpus
teaches — is execute Nebula's own craft faithfully: produce plans, tokens, sections,
copy, QA fixes and DevOps files in Nebula's house style with zero marginal cost,
infinite quota, full privacy. The architecture below uses each engine where it is
strongest.

## 2. The runtime (shipped: `cloudflare/worker/src/emailer/llm.js`)

One router, three engines, automatic chain:

```
llmChat(env, messages, opts)
  1. custom      → NEBULA CORE (our model) behind any OpenAI-compatible
                   endpoint: LLM_CUSTOM_BASE_URL (+ LLM_CUSTOM_MODEL, optional key)
  2. workers-ai  → free Cloudflare binding ([ai] binding="AI"):
                   qwen2.5-coder-32b for code, llama-3.3-70b-fast for prose
  3. sarvam      → legacy paid fallback (only if its key is still set)

LLM_ENGINE=<id> pins one engine (honest failures, no surprise bills).
GET /v1/ai/engine → live engine status for the Studio.
```

Every previous `sarvamChat` call site (planner, agents, designer, copywriter,
builder, assistant, memory, analytics) now goes through the router. `/v1/ai`
(the app's proxy) synthesizes the same OpenAI response shape for every engine,
so the Flutter app needed **zero changes**.

## 3. The model (shipped: `ml/`)

```
ml/
  dataset/build_dataset.mjs     deterministic corpus builder (494 gold pairs, ~315k tok)
  dataset/nebula-core.jsonl     the committed corpus — 8 task families
  train/finetune_qlora.py       Unsloth QLoRA (4-bit, r16, cosine, adamw_8bit)
  train/nebula_core_colab.ipynb Run-all on a FREE T4 — the "start it today" button
  train/requirements.txt
  export/export_gguf.py         merged model → q4_k_m + q5_k_m GGUF
  serve/serve_llamacpp.sh       OpenAI-compatible server on :8080 (llama.cpp)
```

Corpus families (all derived from the worker's REAL capability — mastery packs,
seed skills, v14 layout hardener laws, the project's own CI workflows):

| family | teaches | count |
|---|---|---|
| plan | brief → execution plan JSON (features + layout contract) | 60 |
| section | spec + tokens → production `<section>` HTML/CSS | 220 |
| tokens | brand words → design-token JSON (real harmony math) | 60 |
| copy | brand + tone → specific, non-generic copy JSON | 80 |
| qa_fix | violated law → hardened snippet (fixed/svh/min-width:0…) | 12 |
| devops | intent → real GitHub Actions YAML (APK / Pages / Worker) | 9 |
| skill | domain + gap → distilled skill rules (24 seed skills ×2) | 48 |
| assistant | owner ops questions → grounded answers | 5 |

## 4. Execution roadmap

- [x] **Phase 0 — free engine live (done):** Workers AI binding + router; Sarvam demoted.
- [x] **Phase 1 — corpus (done):** `nebula-core.jsonl` committed, deterministic rebuild.
- [ ] **Phase 2 — train (owner, ~90 min):** open `ml/train/nebula_core_colab.ipynb`
      in Colab → T4 → Run all → download `nebula-core-q4_k_m.gguf`.
- [ ] **Phase 3 — serve:** `bash ml/serve/serve_llamacpp.sh <gguf>` on any 8 GB box
      (or private HF upload + inference endpoint), then set
      `LLM_ENGINE=custom`, `LLM_CUSTOM_BASE_URL=https://host:8080/v1`.
- [ ] **Phase 4 — data flywheel:** the worker's builds (plans that led to shipped
      sites, QA fixes the director caught) are already structured JSON — a follow-up
      `harvest` pass can append real production rounds to the corpus and retrain,
      so the owned model improves with every site Nebula ships.

## 5. What stays true

- No new paid key enters the system. Sarvam's key becomes optional legacy.
- The app never sees a key — the Worker holds everything (unchanged posture).
- The agent runtime (master prompt, orchestrator, skills) is unchanged — it now
  speaks through the router, so swapping engines never touches agent code.
