"""Re-score clarity against SPOKEN-FORM references, reusing the Whisper transcripts in results/quality_<m>.json.

Why: Whisper writes "7:45" as "7.45", and the text normalizer turns "Elm St." into "elm saint" and drops "(b)",
so the raw WER punished correct readings. Here each tricky item has a hand-written spoken reference (what a careful
human reader would say), both sides get the same canonicalization, and a model that failed to produce audio for an
item is charged 100% WER on it (PiVo).
"""
import json, re
from pathlib import Path
import jiwer
from whisper_normalizer.english import EnglishTextNormalizer

ROOT = Path(__file__).parent
SPOKEN = {
    "abbr_1": "The meeting is at Saint Mary's Church on Elm Street, near the U.S. Post Office.",
    "letter_2": "Section 4 b of the agreement states that either party may cancel with thirty days' written notice.",
    "recipe_2": "Add one half cup of melted butter, then stir in the eggs one at a time. Bake for 25 to 30 minutes, or until golden brown.",
    "url_1": "For more information, visit www example org or email help at example org.",
    "num_1": "The train leaves at 7 45 and arrives at 11 20, a trip of about 210 miles.",
    "email_1": "Hi Margaret, just a reminder that your appointment with Dr. Patel is on Thursday at 10 30 AM. Please bring your insurance card and a list of your medications.",
    "date_1": "The festival runs from June 21 to July 4, and tickets go on sale on May 1.",
    "email_3": "Your package has shipped and should arrive by Monday, March 3. You can track it on our website.",
}
WORDNUM = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
           "ten": "10", "first": "1", "second": "2", "third": "3", "fourth": "4", "a half": "one half"}
norm = EnglishTextNormalizer()

def canon(s):
    s = norm(s)
    s = re.sub(r"(\d)\.(\d)", r"\1 \2", s)                 # 7.45 -> 7 45
    s = re.sub(r"\b(\d+)(st|nd|rd|th)\b", r"\1", s)        # 21st -> 21
    s = re.sub(r"\ba m\b", "am", s); s = re.sub(r"\bp m\b", "pm", s)
    s = re.sub(r"\b(\d)\s+(\d{3})\s+(\d{3})\s+(\d{4})\b", r"\1 \2 \3 \4", s)
    for w, d in WORDNUM.items():
        s = re.sub(rf"\b{w}\b", d, s)
    return re.sub(r"\s+", " ", s).strip()

corpus = {c["id"]: c for c in json.loads((ROOT / "corpus.json").read_text(encoding="utf-8"))}
summary = {}
for qf in sorted((ROOT / "results").glob("quality_*.json")):
    q = json.loads(qf.read_text())
    have = {it["id"]: it for it in q["items"]}
    refs, hyps, diffs = [], [], []
    for cid, c in corpus.items():
        ref = canon(SPOKEN.get(cid, c["text"]))
        hyp = canon(have[cid]["hyp"]) if cid in have else ""     # no audio -> every word missed
        refs.append(ref); hyps.append(hyp)
        if ref != hyp:
            diffs.append({"id": cid, "ref": ref, "hyp": hyp, "wer": round(jiwer.wer(ref, hyp), 3)})
    w = jiwer.wer(refs, hyps)
    summary[q["model"]] = {"wer_spoken_pct": round(100 * w, 2), "utmos": q["utmos_mean"], "items_differing": len(diffs),
                           "missing_audio": len(corpus) - len(have), "diffs": diffs}
(ROOT / "results" / "clarity_spoken.json").write_text(json.dumps(summary, indent=1))
for m, s in sorted(summary.items(), key=lambda kv: kv[1]["wer_spoken_pct"]):
    print(f"\n=== {m}: WER {s['wer_spoken_pct']}%  UTMOS {s['utmos']}  differing {s['items_differing']}  missing {s['missing_audio']}")
    for d in s["diffs"]:
        print(f"  {d['id']:12s} REF: {d['ref'][:100]}\n  {'':12s} HYP: {d['hyp'][:100]}")
