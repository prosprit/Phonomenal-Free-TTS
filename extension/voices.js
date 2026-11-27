// Languages and voices bundled with the extension. Model: Phonon 40M multilingual (gradium/phonon-40m-multilingual,
// CC BY-NC 4.0). Voices: gradium/phonon-voices (Apache-2.0); the non-English ones are the catalog's top-ranked
// women and men for each language. English keeps the voices from earlier versions ("default" is Reuben).
// hz: median pitch of the voice reading its language's sample sentence, measured with browser-bench/voice-check.mjs.
// region: only where the voice catalog names one.
// Bumped with every release. The popup compares it with the background's copy: after the folder of an unpacked
// install is replaced, Chrome keeps running the old background code until the extension is reloaded.
export const CODE_VERSION = "0.5.0";

export const LANGS = [
  { id: "en", name: "English", sample: "Hello! This is how I will sound when I read to you. Select any text on a page, right-click, and choose Read aloud." },
  { id: "es", name: "Español", sample: "¡Hola! Así sonaré cuando te lea. Selecciona un texto en una página, haz clic derecho y elige Read aloud." },
  { id: "fr", name: "Français", sample: "Bonjour ! Voici ma voix quand je vous fais la lecture. Sélectionnez un texte, faites un clic droit et choisissez Read aloud." },
  { id: "de", name: "Deutsch", sample: "Hallo! So klinge ich, wenn ich dir vorlese. Markiere einen Text auf einer Seite, klicke mit der rechten Maustaste und wähle Read aloud." },
  { id: "pt", name: "Português", sample: "Olá! É assim que vou soar quando ler para você. Selecione um texto na página, clique com o botão direito e escolha Read aloud." },
];
export const LANG_IDS = LANGS.map((l) => l.id);

export const VOICES = {
  en: [
    { id: "default", name: "Reuben", gender: "male", hz: 113 },
    { id: "Preston", name: "Preston", gender: "male", hz: 130 },
    { id: "Trevor", name: "Trevor", gender: "male", hz: 145 },
    { id: "Hugh", name: "Hugh", gender: "male", hz: 130, region: "UK" },
    { id: "Spencer", name: "Spencer", gender: "male", hz: 115, region: "UK" },
    { id: "Edwin", name: "Edwin", gender: "male", hz: 154, region: "UK" },
    { id: "Hadley", name: "Hadley", gender: "female", hz: 176 },
    { id: "Everly", name: "Everly", gender: "female", hz: 174 },
    { id: "Delia", name: "Delia", gender: "female", hz: 176 },
    { id: "Bryony", name: "Bryony", gender: "female", hz: 183, region: "UK" },
    { id: "Harper", name: "Harper", gender: "female", hz: 192 },
  ],
  es: [
    { id: "Noa", name: "Noa", gender: "female", hz: 216, region: "Spain" },
    { id: "Lucia-Sol", name: "Lucía-Sol", gender: "female", hz: 207, region: "Spain" },
    { id: "Rebeca", name: "Rebeca", gender: "female", hz: 224, region: "Mexico" },
    { id: "Regina", name: "Regina", gender: "female", hz: 216, region: "Mexico" },
    { id: "Marcos", name: "Marcos", gender: "male", hz: 153, region: "Spain" },
    { id: "Borja", name: "Borja", gender: "male", hz: 128, region: "Spain" },
    { id: "Lalo", name: "Lalo", gender: "male", hz: 183, region: "Mexico" },
    { id: "Aldo", name: "Aldo", gender: "male", hz: 179, region: "Mexico" },
  ],
  fr: [
    { id: "Noemie", name: "Noémie", gender: "female", hz: 202, region: "France" },
    { id: "Coralie", name: "Coralie", gender: "female", hz: 231, region: "France" },
    { id: "Tiphaine", name: "Tiphaine", gender: "female", hz: 189 },
    { id: "Augustin", name: "Augustin", gender: "male", hz: 136 },
    { id: "Arnaud", name: "Arnaud", gender: "male", hz: 125 },
    { id: "Jules", name: "Jules", gender: "male", hz: 119 },
  ],
  de: [
    { id: "Nele", name: "Nele", gender: "female", hz: 188 },
    { id: "Jette", name: "Jette", gender: "female", hz: 197 },
    { id: "Annika", name: "Annika", gender: "female", hz: 192 },
    { id: "Anton", name: "Anton", gender: "male", hz: 108 },
    { id: "Mirko", name: "Mirko", gender: "male", hz: 140 },
    { id: "Mats", name: "Mats", gender: "male", hz: 109 },
  ],
  pt: [
    { id: "Manuela-Lu", name: "Manuela-Lu", gender: "female", hz: 279, region: "Brazil" },
    { id: "Isadora", name: "Isadora", gender: "female", hz: 231, region: "Brazil" },
    { id: "Debora", name: "Débora", gender: "female", hz: 235, region: "Brazil" },
    { id: "Davi", name: "Davi", gender: "male", hz: 169, region: "Brazil" },
    { id: "Igor", name: "Igor", gender: "male", hz: 163, region: "Brazil" },
    { id: "Kaua", name: "Kauã", gender: "male", hz: 176, region: "Brazil" },
  ],
};

// duration_delta conditions Phonon's pacing: measured +0.5 ≈ 18% slower, -0.3 ≈ 16% faster.
export const SPEEDS = [
  { id: "slower", label: "Slower", delta: 0.5 },
  { id: "normal", label: "Normal", delta: 0.0 },
  { id: "faster", label: "Faster", delta: -0.3 },
];

// "lang" is "auto" (detect from the text) or a language id. Each language remembers its own voice: English keeps
// the "voice" key earlier versions used, the others use "voice_<lang>".
export const DEFAULTS = { lang: "auto", speed: "normal", voice: "default", voice_es: "Noa", voice_fr: "Noemie", voice_de: "Nele", voice_pt: "Manuela-Lu" };
export const voiceKey = (lang) => (lang === "en" ? "voice" : `voice_${lang}`);
export const SETTING_KEYS = Object.keys(DEFAULTS);
export const langOf = (id) => (LANG_IDS.includes(id) ? id : "en");
/** The chosen voice for a language, falling back to that language's default if the stored one isn't bundled. */
export function voiceFor(s, lang) {
  lang = langOf(lang);
  const id = s[voiceKey(lang)];
  return VOICES[lang].some((v) => v.id === id) ? id : DEFAULTS[voiceKey(lang)];
}

/**
 * The language to read `text` in. A fixed choice wins; "auto" asks the browser's language detector (Chrome and
 * Firefox both ship one, it runs on the device), then the page's own lang attribute, then English.
 */
export async function pickLang(text, choice = "auto", pageLang = "") {
  if (LANG_IDS.includes(choice)) return choice;
  const hint = String(pageLang || "").toLowerCase().split(/[-_]/)[0];
  try {
    const r = await chrome.i18n.detectLanguage(String(text).slice(0, 4000));
    const top = r?.languages?.[0], code = top?.language?.toLowerCase().split(/[-_]/)[0];
    if (code && LANG_IDS.includes(code) && (r.isReliable || top.percentage >= 70 || code === hint)) return code;
  } catch { /* no detector: use the page's language */ }
  return LANG_IDS.includes(hint) ? hint : "en";
}

export function modelSpec() {
  const u = (p) => chrome.runtime.getURL(p);
  const voices = {};
  for (const list of Object.values(VOICES)) {
    for (const v of list) voices[v.id] = u(v.id === "default" ? "model/default-voice.safetensors" : `model/voices/${v.id}.safetensors`);
  }
  return {
    weights: { q8: u("model/model.q8.gguf") },
    tokenizer: u("model/tokenizer.json"),
    config: u("model/config.json"),
    voices,
    defaultVoice: "default",
  };
}
