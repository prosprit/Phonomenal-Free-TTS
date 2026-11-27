import { VOICES, SPEEDS, DEFAULTS, LANGS, SETTING_KEYS, CODE_VERSION, voiceKey, voiceFor, langOf } from "./voices.js";

const $ = (id) => document.getElementById(id);
const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(SETTING_KEYS)) };
const control = (action, extra) => chrome.runtime.sendMessage({ type: "control", action, ...extra });
const lastLang = langOf((await chrome.storage.local.get("lastLang").catch(() => ({}))).lastLang);

// Voices: one list per language, each remembering its own choice. Starts on the fixed language, or the last one read.
let shown = s.lang !== "auto" ? langOf(s.lang) : lastLang;
function radio(container, name, checked, id, label, onpick, lang) {
  const el = document.createElement("label");
  el.className = "opt";
  el.innerHTML = `<input type="radio" name="${name}"><span></span>`;
  const input = el.firstChild;
  input.value = id; el.lastChild.textContent = label; input.checked = checked;
  if (lang) el.lastChild.lang = lang;
  input.onchange = onpick;
  container.appendChild(el);
}
// Language row: picks which voices are listed. With "Detect language" off it also fixes the reading language.
for (const l of LANGS) radio($("langs"), "vlang", l.id === shown, l.id, l.name, () => {
  showVoices(l.id);
  if (s.lang !== "auto") setLang(l.id);
  control("warm", { lang: shown });
}, l.id);
$("detect").checked = s.lang === "auto";
$("detect").onchange = () => setLang($("detect").checked ? "auto" : shown);
function setLang(lang) { s.lang = lang; chrome.storage.sync.set({ lang }); langNote(); }
// Says what the language row does in each mode; its line is always there, so nothing below moves.
function langNote() {
  const fixed = LANGS.find((l) => l.id === s.lang);
  $("langNote").innerHTML = fixed ? "All text is read in <b></b>." : "Each text is read in its own language.";
  if (fixed) $("langNote").querySelector("b").textContent = fixed.name;
}
langNote();
function showVoices(lang) {
  shown = lang;
  document.querySelector(`input[name=vlang][value=${lang}]`).checked = true;
  $("men").replaceChildren(); $("women").replaceChildren();
  const key = voiceKey(lang), cur = voiceFor(s, lang);
  for (const v of VOICES[lang]) {
    radio($(v.gender === "male" ? "men" : "women"), "voice", v.id === cur, v.id, v.name, () => {
      s[key] = v.id; chrome.storage.sync.set({ [key]: v.id }); note();
    });
  }
  note();
}
// The chosen voice's measured pitch in Hz (and region, where the catalog gives one); the Hear button names the voice.
const note = () => {
  const v = VOICES[shown].find((x) => x.id === voiceFor(s, shown));
  $("vnote").innerHTML = "<b></b>: " + v.hz + " Hz" + (v.region ? ", " + v.region : "");
  $("vnote").firstChild.textContent = v.name;
  $("try").textContent = `Hear ${v.name}`;
};
for (const sp of SPEEDS) radio($("speeds"), "speed", sp.id === s.speed, sp.id, sp.label, () => { s.speed = sp.id; chrome.storage.sync.set({ speed: sp.id }); });
showVoices(shown);

$("try").onclick = () => control("read", { text: LANGS.find((l) => l.id === shown).sample, lang: shown, tabId: null });
$("stop").onclick = () => control("stop");
$("pause").onclick = () => control($("pause").textContent === "Pause" ? "pause" : "resume");

// The Hear button and Pause/Stop share one slot, so nothing jumps when reading starts or stops. The status line is
// read out by screen readers; it only shows on screen when something went wrong.
function show(state) {
  const on = ["loading", "speaking", "paused"].includes(state);
  $("now").hidden = !on; $("try").hidden = on;
  $("pause").textContent = state === "loading" ? "Starting…" : state === "paused" ? "Resume" : "Pause";
  $("pause").disabled = state === "loading";
  const msg = { loading: "Getting ready…", speaking: "Reading aloud", paused: "Paused", error: "The voice couldn't start. Try again." }[state] || "";
  $("nowLabel").textContent = msg; $("nowLabel").classList.toggle("quietly", state !== "error");
}
chrome.runtime.onMessage.addListener((m) => { if (m?.target === "popup" && m.type === "state") show(m.state); });
chrome.runtime.sendMessage({ type: "status" }).then((r) => {
  show(r?.state ?? "idle");
  // The popup always loads fresh from the folder, the background does not: an older background means the files
  // were replaced without reloading the extension, and it would ignore the new settings.
  if (r && r.code !== CODE_VERSION) { $("updateCard").hidden = false; $("pdfCard").hidden = true; $("how").hidden = true; }
});
$("finishUpdate").onclick = () => chrome.runtime.reload();

// Show the real shortcut (people can change it, and macOS shows ⌥⇧R); hide the line if none is set.
chrome.commands.getAll().then((cmds) => {
  const k = cmds.find((c) => c.name === "read-selection")?.shortcut;
  if (!k) return;
  $("shortcut").innerHTML = ` Or press ${k.split("+").map((p) => `<kbd>${p}</kbd>`).join("+")}.`;
  $("shortcut").hidden = false;
});
// PDFs open in the Phonomenal reader (page highlighting, read from any point)
const reader = (file) => chrome.runtime.getURL("reader.html") + (file ? "?file=" + encodeURIComponent(file) : "");
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
let onPdf = false;
try { onPdf = !!tab?.url && /\.pdf$/i.test(new URL(tab.url).pathname); } catch {}
if (onPdf && $("updateCard").hidden) { $("pdfCard").hidden = false; $("how").hidden = true; $("try").className = "btn"; }
$("readPdf").onclick = async () => { await chrome.tabs.update(tab.id, { url: reader(tab.url) }); window.close(); };
$("openPdf").onclick = async (e) => { e.preventDefault(); await chrome.tabs.create({ url: reader() }); window.close(); };

if (!onPdf) control("warm", { lang: shown });   // load the voice while the user looks at the popup
