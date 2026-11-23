"""Assemble the extension's large/vendored files: the phonon-tts runtime (npm), the Phonon 31M model and the
bundled voices (Hugging Face cache), license texts, and the icons. Re-run after updating phonon-tts or the model.

    python scripts/assemble.py
"""
import json, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
NPM = next(p for p in (ROOT / "node_modules" / "phonon-tts", ROOT / "browser-bench" / "node_modules" / "phonon-tts") if p.exists())
HUB = Path.home() / ".cache" / "huggingface" / "hub"
MODEL = next((HUB / "models--gradium--phonon-31m-en" / "snapshots").iterdir())
VOICES = next((HUB / "models--gradium--phonon-voices" / "snapshots").iterdir())
WANT = ["Preston", "Trevor", "Hugh", "Spencer", "Edwin", "Hadley", "Everly", "Delia", "Bryony", "Harper"]

# 1. phonon-tts runtime (only what the browser needs)
vendor = EXT / "vendor" / "phonon-tts"
if vendor.exists(): shutil.rmtree(vendor)
vendor.mkdir(parents=True)
for f in ["index.js", "worker.js", "fetch.js", "hub.js", "wav.js", "device.js", "simd.js", "threads.js",
          "LICENSE-MIT", "LICENSE-APACHE", "THIRD_PARTY_LICENSES.md", "package.json"]:
    shutil.copy2(NPM / f, vendor / f)
for d in ["gpu", "wasm", "wasm-threads"]:
    shutil.copytree(NPM / d, vendor / d, ignore=shutil.ignore_patterns("*.d.ts"))

# 2. model + voices
m = EXT / "model"
if m.exists(): shutil.rmtree(m)
(m / "voices").mkdir(parents=True)
for f in ["config.json", "tokenizer.json", "model.q8.gguf", "default-voice.safetensors"]:
    shutil.copy2(MODEL / f, m / f)
catalog = {}
for line in (VOICES / "voices.jsonl").read_text(encoding="utf-8").splitlines():
    v = json.loads(line)
    if v["name"] in WANT and v["language"] == "en":
        shutil.copy2(VOICES / v["filename"], m / "voices" / f"{v['name']}.safetensors")
        catalog[v["name"]] = {k: v[k] for k in ("voice_id", "gender", "locale", "description")}
missing = set(WANT) - set(catalog)
assert not missing, f"voices not in cache: {missing}"
(m / "voices" / "catalog.json").write_text(json.dumps(catalog, indent=1), encoding="utf-8")
(m / "LICENSE").write_text(
    "Phonon 31M English (gradium/phonon-31m-en) weights, tokenizer and voices, and the voices from\n"
    "gradium/phonon-voices, are released by Gradium under the Apache License 2.0 (see LICENSE-APACHE in\n"
    "vendor/phonon-tts). Phonon builds on Pocket TTS and the Mimi codec by Kyutai.\n"
    "The phonon-tts browser runtime is licensed MIT OR Apache-2.0.\n"
    "Responsible use: do not use these voices to impersonate real people; tell listeners speech is synthetic where it matters.\n",
    encoding="utf-8")

# 3. icons: a white speaker with sound waves on a rounded blue square
from PIL import Image, ImageDraw
def icon(size):
    S = size * 8
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S // 5, fill=(47, 93, 138, 255))
    w = (255, 255, 255, 255)
    d.rectangle([S * .18, S * .38, S * .33, S * .62], fill=w)
    d.polygon([(S * .33, S * .38), (S * .52, S * .22), (S * .52, S * .78), (S * .33, S * .62)], fill=w)
    for r, wd in ((.17, .055), (.29, .055)):
        box = [S * (.52 - r), S * (.5 - r), S * (.52 + r), S * (.5 + r)]
        d.arc(box, -45, 45, fill=w, width=max(2, int(S * wd)))
    return im.resize((size, size), Image.LANCZOS)
(EXT / "icons").mkdir(exist_ok=True)
for s in (16, 32, 48, 128):
    icon(s).save(EXT / "icons" / f"icon{s}.png")

total = sum(p.stat().st_size for p in EXT.rglob("*") if p.is_file())
print(f"assembled: {len(catalog) + 1} voices, extension size {total / 2**20:.1f} MB")
