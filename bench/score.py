"""Quality scoring: clarity (round-trip Whisper large-v3 WER) and naturalness (UTMOS22 strong).

Usage: envs/score/Scripts/python.exe score.py model1 model2 ...
Reads audio/<model>/<id>.wav, writes results/quality_<model>.json.
Neither judge is me or the user: Whisper is an independent ASR, UTMOS22 is the MOS
predictor the HF Open TTS Leaderboard uses.
"""
import json, sys
from pathlib import Path
import numpy as np, librosa, torch, jiwer
from transformers import pipeline
from whisper_normalizer.english import EnglishTextNormalizer

ROOT = Path(__file__).parent
corpus = {c["id"]: c for c in json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))}
norm = EnglishTextNormalizer()
dev = "cuda" if torch.cuda.is_available() else "cpu"
asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3",
               torch_dtype=torch.float16 if dev == "cuda" else torch.float32, device=dev)
mos = torch.hub.load("tarepan/SpeechMOS:v1.2.0", "utmos22_strong", trust_repo=True).to(dev).eval()

for model in sys.argv[1:]:
    d = ROOT / "audio" / model
    rows, refs, hyps, scores = [], [], [], []
    for wav in sorted(d.glob("*.wav")):
        cid = wav.stem
        a, _ = librosa.load(wav, sr=16000, mono=True)
        hyp = asr({"raw": a, "sampling_rate": 16000},
                  generate_kwargs={"language": "en", "task": "transcribe"},
                  return_timestamps=len(a) > 16000 * 29)["text"]
        r, h = norm(corpus[cid]["text"]), norm(hyp)
        w = jiwer.wer(r, h) if r else 0.0
        with torch.no_grad():
            s = float(mos(torch.from_numpy(a).unsqueeze(0).to(dev), 16000).item()) if len(a) > 1600 else float("nan")
        refs.append(r); hyps.append(h); scores.append(s)
        rows.append({"id": cid, "kind": corpus[cid]["kind"], "wer": round(w, 4), "utmos": round(s, 3), "ref": r, "hyp": h})
    pooled = jiwer.wer(refs, hyps) if refs else None
    out = {"model": model, "n": len(rows), "wer_pooled": round(pooled, 4) if pooled is not None else None,
           "wer_mean": round(float(np.mean([x["wer"] for x in rows])), 4) if rows else None,
           "utmos_mean": round(float(np.nanmean(scores)), 3) if rows else None,
           "items_with_errors": sum(1 for x in rows if x["wer"] > 0), "items": rows}
    (ROOT / "results" / f"quality_{model}.json").write_text(json.dumps(out, indent=1))
    print(model, "WER", out["wer_pooled"], "UTMOS", out["utmos_mean"], "items w/ errors", out["items_with_errors"], flush=True)
