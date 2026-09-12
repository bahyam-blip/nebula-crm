#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  NEBULA CORE — local/VM serving via llama.cpp (OpenAI-compatible)
#  Serves our fine-tuned GGUF behind /v1/chat/completions so the
#  Nebula Worker's `custom` engine can consume it directly.
#
#  Usage:   bash serve_llamacpp.sh /path/to/nebula-core-q4_k_m.gguf [port]
#  Then set Worker env:
#    LLM_ENGINE=custom
#    LLM_CUSTOM_BASE_URL=http://<this-host>:8080/v1
#    LLM_CUSTOM_MODEL=nebula-core
#  Verify the router:  GET https://<worker>/v1/ai/engine
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

GGUF="${1:?usage: serve_llamacpp.sh <model.gguf> [port]}"
PORT="${2:-8080}"

if ! command -v llama-server >/dev/null 2>&1; then
  echo "[nebula] llama-server not found — installing llama.cpp …"
  if command -v brew >/dev/null 2>&1; then
    brew install llama.cpp
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y -qq build-essential cmake curl
    git clone --depth 1 https://github.com/ggml-org/llama.cpp /tmp/llama.cpp
    cmake -S /tmp/llama.cpp -B /tmp/llama.cpp/build -DLLAMA_CUDA=OFF >/dev/null
    cmake --build /tmp/llama.cpp/build --config Release -j >/dev/null
    sudo cp /tmp/llama.cpp/build/bin/llama-server /usr/local/bin/
  else
    echo "[nebula] install llama.cpp manually: https://github.com/ggml-org/llama.cpp" >&2
    exit 1
  fi
fi

echo "[nebula] serving ${GGUF} on :${PORT} (OpenAI-compatible at /v1)"
exec llama-server \
  -m "${GGUF}" \
  --port "${PORT}" \
  --host 0.0.0.0 \
  --ctx-size 8192 \
  --parallel 2 \
  --alias nebula-core
