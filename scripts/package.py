"""Zip the extension folder (plus README.md, the install guide) for sharing: dist/phonomenal-free-tts-<version>.zip"""
import json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
version = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "dist" / f"phonomenal-free-tts-{version}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.write(ROOT / "README.md", "phonomenal-free-tts/README.md")
    for p in sorted(EXT.rglob("*")):
        if p.is_file():
            z.write(p, f"phonomenal-free-tts/extension/{p.relative_to(EXT).as_posix()}")
print(f"{out}  {out.stat().st_size / 2**20:.1f} MB")
