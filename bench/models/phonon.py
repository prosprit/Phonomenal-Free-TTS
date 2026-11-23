import os as _os
# Phonon 31M English via the ptts native runtime (same engine as the phonon-tts WASM build), q8 weights.
import ptts
class M:
    def __init__(self, threads):
        ptts.set_num_threads(threads)
        self.t = ptts.TTS("hf://gradium/phonon-31m-en", lang="en", quant="q8")
        self.sr = self.t.sample_rate
    def synth(self, text):
        v = _os.environ.get("TTS_VOICE"); return self.t.synth(text, voice=v) if v else self.t.synth(text)
def load(threads): return M(threads)
