#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════
 NEBULA CORE — QLoRA fine-tune (Unsloth)
═════════════════════════════════════════════════════════════════════
 Trains OUR OWN coding/build model on the Nebula corpus
 (ml/dataset/nebula-core.jsonl) so the platform stops depending on
 paid third-party API keys.

 Free-GPU recipe (verified path):
   • Google Colab free tier → Runtime → T4 GPU
   • Base: Qwen2.5-Coder-3B-Instruct (4-bit) — fits comfortably
   • 7B variant: --base unsloth/Qwen2.5-Coder-7B-Instruct (fits on T4
     with this config; expect ~2x the wall time)

 Usage:
   python finetune_qlora.py \
     --dataset ../dataset/nebula-core.jsonl \
     --out    ../out/nebula-core-3b \
     --base   unsloth/Qwen2.5-Coder-3B-Instruct \
     --epochs 3

 Output: merged 16-bit HF model at --out (ready for GGUF export —
 see ../export/export_gguf.py — or direct upload to Hugging Face).
═════════════════════════════════════════════════════════════════════
"""

import argparse
import json
import os

def main():
    ap = argparse.ArgumentParser(description="Nebula Core QLoRA fine-tune")
    ap.add_argument("--dataset", default="../dataset/nebula-core.jsonl")
    ap.add_argument("--out", default="../out/nebula-core-3b")
    ap.add_argument("--base", default="unsloth/Qwen2.5-Coder-3B-Instruct")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-seq", type=int, default=4096)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--lora-r", type=int, default=16)
    args = ap.parse_args()

    # Unsloth must be imported BEFORE torch/transformers (its own rule).
    from unsloth import FastLanguageModel
    import torch
    from datasets import Dataset
    from trl import SFTTrainer, SFTConfig

    print(f"[nebula] base={args.base} epochs={args.epochs} lr={args.lr}")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base,
        max_seq_length=args.max_seq,
        dtype=None,               # auto (fp16 on T4, bf16 on Ampere+)
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_alpha=args.lora_r * 2,
        lora_dropout=0.0,          # unsloth-optimized
        bias="none",
        use_gradient_checkpointing="unsloth",  # ~30% less VRAM
        random_state=3407,
    )

    # ── Dataset: chat JSONL → chatml text ──────────────────────────
    rows = []
    with open(args.dataset, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            rows.append({"messages": o["messages"]})

    def to_text(example):
        return {
            "text": tokenizer.apply_chat_template(
                example["messages"], tokenize=False, add_generation_prompt=False
            )
        }

    ds = Dataset.from_list(rows).map(to_text, remove_columns=["messages"])
    print(f"[nebula] {len(ds)} training rows")

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=ds,
        dataset_text_field="text",
        max_seq_length=args.max_seq,
        packing=False,
        args=SFTConfig(
            per_device_train_batch_size=args.batch,
            gradient_accumulation_steps=args.grad_accum,
            num_train_epochs=args.epochs,
            warmup_ratio=0.03,
            learning_rate=args.lr,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=5,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="cosine",
            seed=3407,
            output_dir=args.out,
            save_strategy="no",
            report_to="none",
        ),
    )

    result = trainer.train()
    print(f"[nebula] train metrics: {result.metrics}")

    # ── Save merged 16-bit (inference-ready, GGUF-ready) ───────────
    os.makedirs(args.out, exist_ok=True)
    model.save_pretrained_merged(
        os.path.join(args.out, "merged"),
        tokenizer,
        save_method="merged_16bit",
    )
    print(f"[nebula] merged model → {args.out}/merged")
    print("[nebula] NEXT: python ../export/export_gguf.py --model "
          f"{args.out}/merged --out {args.out}/gguf")

if __name__ == "__main__":
    main()
