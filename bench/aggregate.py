"""Merge speed (results/<m>_<t>t.json), quality (results/quality_<m>.json) and browser results into summary.json + summary.md."""
import json
from pathlib import Path

ROOT = Path(__file__).parent
R = ROOT / "results"
B = ROOT.parent / "browser-bench" / "results"
META = {  # from model cards / HF (checked 2026-11-23)
    "kokoro":     ("Kokoro-82M v1.0 (int8 ONNX)", "82M", 88, "Apache-2.0 (G2P: espeak-ng GPL-3.0)", "kokoro-js / transformers.js"),
    "phonon":     ("Phonon 31M en (q8)", "31M (+10M codec)", 65, "Apache-2.0", "phonon-tts (WASM / WebGPU)"),
    "kale":       ("kale-tts-1-nano (int8)", "7.5M", 15, "Apache-2.0 (no GPL G2P)", "onnxruntime-web + kale-tts.mjs"),
    "tinyvoca":   ("tiny-voca F2 (fp32 ONNX)", "4.5M", 21, "Apache-2.0", "onnxruntime-web (no JS G2P shipped)"),
    "paradee":    ("Paradee-8M v1.3 (int8)", "7.9M", 9, "Apache-2.0 (misaki; espeak for non-English)", "ONNX only (no JS G2P)"),
    "klein":      ("Klein-TTS X1.5 Pro", "13.1M", 53, "Apache-2.0 (misaki)", "Node pkg only"),
    "supertonic": ("Supertonic 3", "~99M", 385, "OpenRAIL-M", "ONNX (no official JS)"),
    "kitten":     ("KittenTTS 2 mini", "82M", 91, "Apache-2.0", "none (PyTorch runtime)"),
    "nanoedge":   ("nano-edge-tts-standalone v2.1", "3.3M", 30, "Apache-2.0 (frontend data from GPL espeak)", "ONNX only (Python frontend)"),
    "pivo":       ("PiVo-1.4M (16 kHz)", "1.4M", 9, "Apache-2.0 / BSD vocoder", "ONNX only"),
    "os_windows": ("Windows built-in voice (baseline)", "-", 0, "ships with OS", "chrome.tts / speechSynthesis"),
}
def load(p):
    try: return json.loads(p.read_text())
    except Exception: return None

clar = load(R / "clarity_spoken.json") or {}
ratings = load(R / "ratings_listener1.json") or {}
def human(m):
    v = [s for k, s in ratings.items() if k.split("|")[1] == m]
    return (round(sum(v) / len(v), 2), len(v)) if v else (None, 0)

rows = []
for m, (name, params, mb, lic, browser) in META.items():
    s4, s1, q = load(R / f"{m}_4t.json"), load(R / f"{m}_1t.json"), load(R / f"quality_{m}.json")
    hr, hn = human(m)
    rows.append({"key": m, "name": name, "params": params, "download_mb": mb, "license": lic, "browser_path": browser,
                 "first_audio_ms_4t": s4 and s4["first_audio_ms_median"], "first_audio_ms_1t": s1 and s1["first_audio_ms_median"],
                 "first_audio_p90_1t": s1 and s1["first_audio_ms_p90"],
                 "x_rt_4t": s4 and s4["x_realtime"], "x_rt_1t": s1 and s1["x_realtime"], "load_s_1t": s1 and s1["load_s"],
                 "rss_mb_1t": s1 and s1["peak_rss_mb"], "failed_items": s4 and s4["n_err"],
                 "wer_raw_pct": q and round(100 * q["wer_pooled"], 2), "utmos": q and q["utmos_mean"],
                 "wer_pct": clar.get(m, {}).get("wer_spoken_pct"), "listener_rating": hr, "listener_n": hn,
                 "items_with_word_errors": q and q["items_with_errors"], "n_scored": q and q["n"]})
browser = [load(p) for p in sorted(B.glob("*.json"))] if B.exists() else []
(ROOT / "summary.json").write_text(json.dumps({"models": rows, "browser": [b for b in browser if b]}, indent=1))

f = lambda v, fmt="{}": "–" if v is None else fmt.format(v)
lines = ["| Model | Params | MB | First audio 1-core (ms) | Speed 1-core | Speed 4-core | RAM 1-core | WER % (spoken ref) | UTMOS | Listener ★ (n) | Failed inputs |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
for r in rows:
    lines.append(f"| {r['name']} | {r['params']} | {r['download_mb']} | {f(r['first_audio_ms_1t'], '{:.0f}')} | {f(r['x_rt_1t'], '{}x')} | "
                 f"{f(r['x_rt_4t'], '{}x')} | {f(r['rss_mb_1t'], '{} MB')} | {f(r['wer_pct'])} | {f(r['utmos'])} | "
                 f"{f(r['listener_rating'])} ({r['listener_n']}) | {f(r['failed_items'])} |")
(ROOT / "summary.md").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
