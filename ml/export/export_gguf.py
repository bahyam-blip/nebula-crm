#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════
 NEBULA CORE — GGUF export + quantize
═════════════════════════════════════════════════════════════════════
 Takes the merged 16-bit model produced by finetune_qlora.py and
 exports llama.cpp GGUF quantizations (q4_k_m ≈ 2.0 GB for 3B,
 q5_k_m ≈ 2.3 GB) — the format the OpenAI-compatible serving path
 (llama.cpp / LM Studio / Ollama import) consumes.

 Usage:
   python export_gguf.py --model ../out/nebula-core-3b/merged \
                         --out    ../out/nebula-core-3b/gguf

 Then either:
   A) serve it yourself (unlimited, free):
        bash ../serve/serve_llamacpp.sh <path>/nebula-core-q4_k_m.gguf
      …and point the Nebula worker at it:
        LLM_ENGINE=custom
        LLM_CUSTOM_BASE_URL=http://<host>:8080/v1
   B) upload to Hugging Face (free hosting):
        huggingface-cli upload <user>/nebula-core <out> --private
═════════════════════════════════════════════════════════════════════
"""

import argparse
import os

def main():
    ap = argparse.ArgumentParser(description="Nebula Core GGUF export")
    ap.add_argument("--model", required=True, help="merged 16-bit model dir")
    ap.add_argument("--out", required=True, help="output dir for gguf files")
    ap.add_argument("--quants", default="q4_k_m,q5_k_m",
                    help="comma list: q4_k_m,q5_k_m,q8_0")
    args = ap.parse_args()

    # Unsloth must be imported BEFORE torch/transformers.
    from unsloth import FastLanguageModel

    os.makedirs(args.out, exist_ok=True)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=4096,
        load_in_4bit=True,
    )

    for q in [x.strip() for x in args.quants.split(",") if x.strip()]:
        print(f"[nebula] exporting {q} …")
        model.save_pretrained_gguf(
            args.out,
            tokenizer,
            quantization_method=q,
        )
        print(f"[nebula] done → {args.out} ({q})")

    print("[nebula] NEXT: bash ../serve/serve_llamacpp.sh "
          f"{args.out}/<name>.q4_k_m.gguf")

if __name__ == "__main__":
    main()
