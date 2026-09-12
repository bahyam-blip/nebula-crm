# Nebula Core — our own model

Fine-tuned coding/build model for the Nebula platform. Zero third-party API keys.

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/bahyam-blip/nebula-crm/blob/master/ml/train/nebula_core_colab.ipynb)
**← one click opens the training notebook in Google Colab (free T4).**

```
node ml/dataset/build_dataset.mjs        # rebuild the corpus (deterministic)
# → ml/dataset/nebula-core.jsonl  (494 pairs, ~315k tokens)
```

**Train (free):** open `ml/train/nebula_core_colab.ipynb` in Google Colab →
Runtime → T4 → Run all. ~60-90 min for the 3B (`unsloth/Qwen2.5-Coder-3B-Instruct`),
~3 h for the 7B.

**Serve:** `bash ml/serve/serve_llamacpp.sh out/nebula-core-q4_k_m.gguf` →
OpenAI-compatible server on `:8080`.

**Wire into the platform:**
```
LLM_ENGINE=custom
LLM_CUSTOM_BASE_URL=http://<host>:8080/v1
LLM_CUSTOM_MODEL=nebula-core
```
Verify: `GET /v1/ai/engine` on the Worker → `{"active":"custom",...}`.

Full decision record: `NEBULA_CORE_PLAN.md`.
Router: `cloudflare/worker/src/emailer/llm.js`.
