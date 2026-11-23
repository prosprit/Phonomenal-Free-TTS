"""Speed/memory benchmark for one TTS model, run inside that model's own venv.

Usage: <venv python> bench.py --model kokoro --threads 1 [--save-audio]

Each model adapter lives in models/<name>.py and exposes:
    load(threads: int) -> obj   with obj.sr (int) and obj.synth(text) -> 1-D float32 numpy array
The same sentence splitter is applied to every model, so "first audio" means
"time until the first sentence of the selection is ready to play" -- exactly
what the extension will do (synthesize sentence 1, start playing, keep going).
"""
import argparse, importlib.util, json, os, re, sys, threading, time
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--model", required=True)
ap.add_argument("--threads", type=int, default=1)
ap.add_argument("--save-audio", action="store_true")
ap.add_argument("--reps", type=int, default=3)
args = ap.parse_args()

# Limit threads BEFORE importing numeric libraries.
for v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS",
          "NUMEXPR_NUM_THREADS", "ORT_NUM_THREADS", "RAYON_NUM_THREADS",
          "PTTS_NUM_THREADS", "TORCH_NUM_THREADS"):
    os.environ[v] = str(args.threads)
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")  # CPU only: friends' laptops

import psutil  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402

proc = psutil.Process()
proc.cpu_affinity(list(range(args.threads)))  # hard cap on cores used

try:
    import torch
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
except Exception:
    pass

ROOT = Path(__file__).parent
corpus = json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))

ABBR = r"(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|Mt|No|U\.S|e\.g|i\.e|a\.m|p\.m)"
def split_sentences(text):
    # protect abbreviations, then split on sentence-final punctuation
    t = re.sub(rf"\b({ABBR})\.", lambda m: m.group(1).replace(".", "<D>") + "<D>", text)
    parts, last = [], 0
    for mt in re.finditer(r'[.!?]+["”]?(\s+)(?=["“]?[A-Z0-9])', t):
        parts.append(t[last:mt.start(1)]); last = mt.end(1)
    parts.append(t[last:])
    return [p.replace("<D>", ".").strip() for p in parts if p.strip()]

peak = {"rss": 0}
stop = threading.Event()
def sampler():
    while not stop.is_set():
        try:
            rss = proc.memory_info().rss
            for c in proc.children(recursive=True):
                rss += c.memory_info().rss
            peak["rss"] = max(peak["rss"], rss)
        except Exception:
            pass
        time.sleep(0.02)
threading.Thread(target=sampler, daemon=True).start()

spec = importlib.util.spec_from_file_location(args.model, ROOT / "models" / f"{args.model}.py")
mod = importlib.util.module_from_spec(spec)
# (models dir deliberately not on sys.path: adapter names match package names)
spec.loader.exec_module(mod)

t0 = time.perf_counter()
m = mod.load(args.threads)
load_s = time.perf_counter() - t0
sr = m.sr

def synth(text):
    a = np.asarray(m.synth(text), dtype=np.float32).reshape(-1)
    return a

synth("This is a warm up sentence.")  # warm-up (JIT, caches, lazy init)

audio_dir = ROOT / "audio" / args.model
if args.save_audio:
    audio_dir.mkdir(parents=True, exist_ok=True)

items, errors = [], []
tot_compute = tot_audio = 0.0
for it in corpus:
    sents = split_sentences(it["text"])
    chunks, first = [], None
    t_start = time.perf_counter()
    try:
        for s in sents:
            chunks.append(synth(s))
            if first is None:
                first = time.perf_counter() - t_start
    except Exception as e:  # record failures instead of hiding them
        errors.append({"id": it["id"], "error": repr(e)[:300]})
        continue
    compute = time.perf_counter() - t_start
    gap = np.zeros(int(sr * 0.15), dtype=np.float32)
    wav = np.concatenate([x for c in chunks for x in (c, gap)])
    dur = len(wav) / sr
    tot_compute += compute
    tot_audio += dur
    items.append({"id": it["id"], "first_audio_ms": round(first * 1000, 1),
                  "compute_s": round(compute, 4), "audio_s": round(dur, 3),
                  "n_sent": len(sents)})
    if args.save_audio:
        peakv = np.abs(wav).max() or 1.0
        sf.write(audio_dir / f"{it['id']}.wav", wav / max(1.0, peakv / 0.99), sr)

# Repeated first-audio on a typical selection (first sentence of news_1)
probe = split_sentences(corpus[0]["text"])[0]
reps = []
for _ in range(args.reps):
    t = time.perf_counter(); synth(probe); reps.append((time.perf_counter() - t) * 1000)

stop.set()
fa = sorted(i["first_audio_ms"] for i in items)
out = {
    "model": args.model, "threads": args.threads, "sample_rate": sr,
    "load_s": round(load_s, 3),
    "first_audio_ms_median": round(float(np.median(fa)), 1) if fa else None,
    "first_audio_ms_p90": round(float(np.percentile(fa, 90)), 1) if fa else None,
    "first_audio_ms_probe_median": round(float(np.median(reps)), 1),
    "rtf": round(tot_compute / tot_audio, 4) if tot_audio else None,
    "x_realtime": round(tot_audio / tot_compute, 1) if tot_compute else None,
    "peak_rss_mb": round(peak["rss"] / 2**20),
    "n_ok": len(items), "n_err": len(errors), "errors": errors, "items": items,
    "cpu": "AMD Ryzen 5 5600X (pinned to %d core(s))" % args.threads,
}
(ROOT / "results").mkdir(exist_ok=True)
(ROOT / "results" / f"{args.model}_{args.threads}t.json").write_text(json.dumps(out, indent=1))
print(json.dumps({k: v for k, v in out.items() if k not in ("items",)}, indent=1))
