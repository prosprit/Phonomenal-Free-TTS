"""Assemble the extension's large/vendored files: the phonon-tts runtime (npm), PDF.js, the Phonon 40M multilingual
model and the bundled voices (Hugging Face), license texts, and the icons. Re-run after updating any of them.

    python scripts/assemble.py                  # everything
    python scripts/assemble.py model            # only some steps: runtime, pdfjs, model, icons

The model repo is gated on Hugging Face: accept its terms once and run `hf auth login` before the model step.
"""
import json, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
NPM = next(p for p in (ROOT / "node_modules" / "phonon-tts", ROOT / "browser-bench" / "node_modules" / "phonon-tts") if p.exists())
STEPS = set(sys.argv[1:]) or {"runtime", "pdfjs", "model", "icons"}
MODEL_REPO = "gradium/phonon-40m-multilingual"
# extension voice id -> catalog voice_id in gradium/phonon-voices ("en": look up the English voice by name).
# Must match VOICES in extension/voices.js. "default" (Reuben) is the model's own default-voice.safetensors.
WANT = {
    "Preston": "en", "Trevor": "en", "Hugh": "en", "Spencer": "en", "Edwin": "en",
    "Hadley": "en", "Everly": "en", "Delia": "en", "Bryony": "en", "Harper": "en",
    # Spanish (Spain, Mexico), French, German and Brazilian Portuguese: the catalog's top-ranked voices
    "Noa": "b6FvJAiokjdqIti4", "Lucia-Sol": "3p0eIGbkmny71GlA", "Rebeca": "Sx8m6WdXBG06zwZT", "Regina": "s58clrg2fe0MO7Y-",
    "Marcos": "jvPx8j8zLGQ3utZz", "Borja": "tIjCgP8v3RY8UpgM", "Lalo": "F05gqkzX7WhKVpSL", "Aldo": "ax7dW1XB0eiMfHgO",
    "Noemie": "FXxJ9mANRq6BCTX5", "Coralie": "ZeSg853xFACESHHI", "Tiphaine": "0fvH6XAKvA748v2v",
    "Augustin": "Tek4tJXiX6_yvXq7", "Arnaud": "aXMVwiUhITMrwPzd", "Jules": "YKeBw3OV1RgpdhLh",
    "Nele": "2A2fFf8SkDEJ8nzx", "Jette": "4Mn9VfG2wsLLEzi5", "Annika": "p6Uutkyi3j2iNAUu",
    "Anton": "3ZKKapPOvuWFcw9f", "Mirko": "Xn9xDzqSSr4xGTNg", "Mats": "Kf5m22mROozoMWj3",
    "Manuela-Lu": "KgC2Nqnjj48NUiyV", "Isadora": "CtNvKUUMrx1h56ih", "Debora": "K8mj96kYHMy8q3Hb",
    "Davi": "NuUr_x5V90hSHzCJ", "Igor": "l7520SIXi14iEamd", "Kaua": "6HftnVU1XqVBJS8t",
}

# 1. phonon-tts runtime (only what the browser needs)
vendor = EXT / "vendor" / "phonon-tts"
if "runtime" in STEPS:
    if vendor.exists(): shutil.rmtree(vendor)
    vendor.mkdir(parents=True)
    for f in ["index.js", "worker.js", "fetch.js", "hub.js", "wav.js", "device.js", "simd.js", "threads.js",
              "LICENSE-MIT", "LICENSE-APACHE", "THIRD_PARTY_LICENSES.md", "package.json"]:
        shutil.copy2(NPM / f, vendor / f)
    for d in ["gpu", "wasm", "wasm-threads"]:
        shutil.copytree(NPM / d, vendor / d, ignore=shutil.ignore_patterns("*.d.ts"))

# 1b. PDF.js for the PDF reader (Apache-2.0): core, worker, standard fonts, image decoders.
# The legacy build: the modern one needs the newest browser built-ins (e.g. Uint8Array.toHex, Chrome 140+)
# and fails to open any PDF on browsers that older Macs are stuck on (Chrome 138 on macOS 11).
if "pdfjs" in STEPS:
    PDFJS = NPM.parent / "pdfjs-dist"
    pj = EXT / "vendor" / "pdfjs"
    if pj.exists(): shutil.rmtree(pj)
    pj.mkdir(parents=True)
    for f in ["legacy/build/pdf.min.mjs", "legacy/build/pdf.worker.min.mjs", "LICENSE"]:
        shutil.copy2(PDFJS / f, pj / Path(f).name)
    for d in ["standard_fonts", "wasm"]:
        shutil.copytree(PDFJS / d, pj / d)
    (pj / "VERSION").write_text(json.loads((PDFJS / "package.json").read_text(encoding="utf-8"))["version"], encoding="utf-8")

# 2. model + voices (downloaded into the Hugging Face cache if missing)
catalog = {}
if "model" in STEPS:
    from huggingface_hub import hf_hub_download, snapshot_download
    MODEL = Path(snapshot_download(MODEL_REPO, allow_patterns=["config.json", "tokenizer.json", "model.q8.gguf", "default-voice.safetensors"]))
    lines = Path(hf_hub_download("gradium/phonon-voices", "voices.jsonl")).read_text(encoding="utf-8").splitlines()
    byid = {v["voice_id"]: v for v in map(json.loads, lines)}
    byname = {v["name"]: v for v in byid.values() if v["language"] == "en"}
    m = EXT / "model"
    if m.exists(): shutil.rmtree(m)
    (m / "voices").mkdir(parents=True)
    for f in ["config.json", "tokenizer.json", "model.q8.gguf", "default-voice.safetensors"]:
        shutil.copy2(MODEL / f, m / f)
    for name, ref in WANT.items():
        v = byname[name] if ref == "en" else byid[ref]
        shutil.copy2(hf_hub_download("gradium/phonon-voices", v["filename"]), m / "voices" / f"{name}.safetensors")
        catalog[name] = {k: v.get(k) for k in ("name", "voice_id", "language", "gender", "locale", "description")}
    (m / "voices" / "catalog.json").write_text(json.dumps(catalog, indent=1, ensure_ascii=False), encoding="utf-8")
    (m / "LICENSE").write_text(
        "Model: Phonon 40M multilingual (gradium/phonon-40m-multilingual) by Gradium. Its weights, tokenizer and\n"
        "default voice are licensed under Creative Commons Attribution-NonCommercial 4.0 International\n"
        "(CC BY-NC 4.0, https://creativecommons.org/licenses/by-nc/4.0/). They are included unchanged and may not\n"
        "be used for commercial purposes.\n"
        "Voices in voices/: gradium/phonon-voices by Gradium, Apache License 2.0 (see LICENSE-APACHE in\n"
        "vendor/phonon-tts). Phonon builds on Pocket TTS and the Mimi codec by Kyutai.\n"
        "The phonon-tts browser runtime is licensed MIT OR Apache-2.0.\n"
        "Responsible use: do not use these voices to impersonate real people; tell listeners speech is synthetic where it matters.\n",
        encoding="utf-8")

# 3. icons: a white speaker with sound waves on a rounded blue square
if "icons" in STEPS:
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
print(f"assembled {sorted(STEPS)}: {len(catalog) + 1 if catalog else '-'} voices, extension size {total / 2**20:.1f} MB")
