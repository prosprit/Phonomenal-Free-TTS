"""Writes listen/manifest.json: which models/voices have audio for which items (read by listen/index.html).
Two sets: "default" (each model's default voice, all 30 benchmark sentences) and "male" (male voices, 6 sentences + a 2-minute passage).
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).parent
NAMES = {
    "kokoro": "Kokoro-82M", "phonon": "Phonon 31M", "kale": "kale-tts-1-nano", "tinyvoca": "tiny-voca",
    "paradee": "Paradee-8M", "klein": "Klein-TTS X1.5 Pro", "supertonic": "Supertonic 3", "kitten": "KittenTTS 2 mini",
    "nanoedge": "nano-edge-tts", "pivo": "PiVo-1.4M", "os_windows": "Windows built-in voice",
}
corpus = json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))
long2 = re.search(r'LONG_2 = \((.*?)\)\n', (ROOT / "render_voices.py").read_text(encoding="utf-8"), re.S).group(1)
long2 = "".join(re.findall(r'"(.*?)"', long2))
male_ids = ["news_1", "num_2", "num_3", "names_1", "quote_1", "long_1"]
male_corpus = [c for c in corpus if c["id"] in male_ids] + [{"id": "long_2", "kind": "2-minute passage", "text": long2}]

DESC = {  # Phonon voice catalog (gradium/phonon-voices), shortened
    "default": "Phonon's built-in default voice", "Preston": "trim, focused, steady low-set core",
    "Trevor": "buoyant energy over a resonant mid-low core", "Hugh": "soft and close, airy, sincere",
    "Spencer": "light and airy, slow, patient delivery", "Edwin": "efficient and firm, tidy articulation",
    "Hadley": "settled, even-toned and genuinely kind", "Delia": "low, grounded, sincere",
    "Everly": "rounded, soft-edged, easy relaxed delivery", "Bryony": "full, rich mid-range, softly relaxed",
    "Harper": "modern, confident and friendly, American",
}
pv_path = ROOT / "results" / "phonon_voices.json"
pv = json.loads(pv_path.read_text()) if pv_path.exists() else {}
sets = {"phonon": {"label": "Phonon voices, male & female (7 items, incl. 2-min passage)", "corpus": male_corpus, "models": []},
        "default": {"label": "Phonon default voice, all 30 test sentences", "corpus": corpus, "models": []}}
for d in sorted((ROOT / "audio").iterdir()):
    have = sorted(p.stem for p in d.glob("*.wav"))
    if not have:
        continue
    if d.name.startswith("phonon@"):
        voice = d.name.split("@", 1)[1]
        g = pv.get(voice, {}).get("gender", "?")
        sets["phonon"]["models"].append({"key": d.name, "name": f"{voice} ({'male' if g == 'M' else 'female'})",
                                         "desc": f"{DESC.get(voice, '')} · {pv.get(voice, {}).get('pitch_hz', '?')} Hz", "g": g, "items": have})
    elif d.name in NAMES:
        sets["default"]["models"].append({"key": d.name, "name": NAMES[d.name], "items": have})
order = list(NAMES)
sets["default"]["models"].sort(key=lambda m: order.index(m["key"]))
sets["phonon"]["models"].sort(key=lambda m: (m["g"] != "M", m["name"]))
out = ROOT / "listen"; out.mkdir(exist_ok=True)
(out / "manifest.json").write_text(json.dumps({"sets": sets}, indent=1), encoding="utf-8")
for k, s in sets.items():
    print(k, len(s["models"]), "voices:", ", ".join(m["name"] for m in s["models"]))
