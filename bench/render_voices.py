"""Render a listening set for one model+voice (no timing). Runs on cores 2-11 so it won't disturb timing runs on core 0.
Usage: TTS_VOICE=<voice> <venv python> render_voices.py <model> <voice-label>
Writes audio/<model>@<voice-label>/<id>.wav
"""
import importlib.util, json, os, re, sys
from pathlib import Path
import numpy as np, psutil, soundfile as sf

psutil.Process().cpu_affinity(list(range(2, 12)))
ROOT = Path(__file__).parent
model, label = sys.argv[1], sys.argv[2]
IDS = ["news_1", "num_2", "num_3", "names_1", "quote_1", "long_1"]
LONG_2 = ("Every morning, before the rest of the house was awake, my grandfather walked down to the harbour. He said the "
          "sea was easiest to understand when nobody else was talking. He would stand by the railing with a mug of tea, "
          "watching the fishing boats come in, and he could tell you which family each one belonged to just by the way it "
          "turned toward the dock. When I was nine, he started taking me with him. At first I was bored. I wanted to know "
          "why we were standing in the cold, doing nothing. He didn't answer. He just pointed at the water, at the gulls "
          "following the boats, at the old man mending nets on the far pier, and waited. It took me most of that summer to "
          "understand what he was showing me. Nothing in the harbour happened by accident. The tide decided when the boats "
          "could leave. The weather decided how far they could go. The gulls knew which boats had a good catch long before "
          "anyone on shore did. Everything was paying attention to everything else. Years later, after he had passed away, "
          "I went back to that railing on a grey October morning. The boats were different now, bigger and louder, and most "
          "of the families I remembered had sold up and moved inland. But the gulls still followed the boats in, and the tide "
          "still came and went, and for a few minutes, standing there with my own mug of tea, I could almost hear him not "
          "saying anything at all.")

src = ROOT / "models" / f"{model}.py"
spec = importlib.util.spec_from_file_location(model, src); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
m = mod.load(4)
bench = (ROOT / "bench.py").read_text(encoding="utf-8")
exec(bench[bench.index("ABBR ="):bench.index("peak = ")])   # same sentence splitter as the benchmark
corpus = {c["id"]: c["text"] for c in json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))}
texts = {i: corpus[i] for i in IDS} | {"long_2": LONG_2}
out = ROOT / "audio" / f"{model}@{label}"; out.mkdir(parents=True, exist_ok=True)
for cid, text in texts.items():
    chunks = []
    for s in split_sentences(text):
        a = np.asarray(m.synth(s), dtype=np.float32).reshape(-1)
        chunks += [a, np.zeros(int(m.sr * 0.15), np.float32)]
    wav = np.concatenate(chunks); peak = np.abs(wav).max() or 1.0
    sf.write(out / f"{cid}.wav", wav / max(1.0, peak / 0.99), m.sr)
print("OK", model, label, len(texts))
