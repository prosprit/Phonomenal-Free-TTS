// Voices bundled with the extension (Phonon 31M, Apache-2.0). Gender measured from pitch and confirmed by the catalog.
export const VOICES = [
  { id: "default", name: "Reuben", gender: "male", note: "Warm and clear (recommended)" },
  { id: "Preston", name: "Preston", gender: "male", note: "Steady and low" },
  { id: "Trevor", name: "Trevor", gender: "male", note: "Friendly, resonant" },
  { id: "Hugh", name: "Hugh", gender: "male", note: "Soft and gentle, British" },
  { id: "Spencer", name: "Spencer", gender: "male", note: "Slow and patient, British" },
  { id: "Edwin", name: "Edwin", gender: "male", note: "Firm and tidy, British" },
  { id: "Hadley", name: "Hadley", gender: "female", note: "Calm and kind" },
  { id: "Everly", name: "Everly", gender: "female", note: "Soft and relaxed" },
  { id: "Delia", name: "Delia", gender: "female", note: "Low and sincere" },
  { id: "Bryony", name: "Bryony", gender: "female", note: "Rich and warm, British" },
  { id: "Harper", name: "Harper", gender: "female", note: "Bright and friendly" },
];

// duration_delta conditions Phonon's pacing: measured +0.5 ≈ 18% slower, -0.3 ≈ 16% faster.
export const SPEEDS = [
  { id: "slower", label: "Slower", delta: 0.5 },
  { id: "normal", label: "Normal", delta: 0.0 },
  { id: "faster", label: "Faster", delta: -0.3 },
];

export const DEFAULTS = { voice: "default", speed: "normal" };

export function modelSpec() {
  const u = (p) => chrome.runtime.getURL(p);
  const voices = {};
  for (const v of VOICES) voices[v.id] = u(v.id === "default" ? "model/default-voice.safetensors" : `model/voices/${v.id}.safetensors`);
  return {
    weights: { q8: u("model/model.q8.gguf") },
    tokenizer: u("model/tokenizer.json"),
    config: u("model/config.json"),
    voices,
    defaultVoice: "default",
  };
}
