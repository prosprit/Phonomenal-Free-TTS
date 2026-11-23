import { VOICES, SPEEDS, DEFAULTS } from "./voices.js";

const $ = (id) => document.getElementById(id);
const SAMPLE = "Hello! This is how I will sound when I read to you. Select any text on a page, right-click, and choose Read aloud.";
const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(["voice", "speed"])) };
const control = (action, extra) => chrome.runtime.sendMessage({ type: "control", action, ...extra });

function option(container, key, it, label) {
  const el = document.createElement("label");
  el.className = "opt";
  el.innerHTML = `<input type="radio" name="${key}" value="${it.id}"><span>${label}</span>`;
  const input = el.firstChild;
  input.checked = it.id === s[key];
  input.onchange = () => { s[key] = it.id; chrome.storage.sync.set({ [key]: it.id }); if (key === "voice") note(); };
  container.appendChild(el);
}
const note = () => { const v = VOICES.find((x) => x.id === s.voice) || VOICES[0]; $("vnote").textContent = `${v.name}: ${v.note}`; };
for (const v of VOICES) option($(v.gender === "male" ? "men" : "women"), "voice", v, v.name);
for (const sp of SPEEDS) option($("speeds"), "speed", sp, sp.label);
note();

$("try").onclick = () => control("read", { text: SAMPLE, tabId: null });
$("stop").onclick = () => control("stop");
$("pause").onclick = () => control($("pause").textContent === "Pause" ? "pause" : "resume");

// The Hear button and the now-playing bar share one slot, so nothing jumps when reading starts or stops.
function show(state) {
  const on = ["loading", "speaking", "paused"].includes(state);
  $("now").hidden = !on; $("try").hidden = on;
  $("nowLabel").textContent = state === "loading" ? "Getting ready…" : state === "paused" ? "Paused" : "Reading aloud";
  $("pause").textContent = state === "paused" ? "Resume" : "Pause";
  $("pause").disabled = state === "loading";
}
chrome.runtime.onMessage.addListener((m) => { if (m?.target === "popup" && m.type === "state") show(m.state); });
chrome.runtime.sendMessage({ type: "status" }).then((r) => show(r?.state ?? "idle"));

// Show the real shortcut (people can change it, and macOS shows ⌥⇧R); hide the line if none is set.
chrome.commands.getAll().then((cmds) => {
  const k = cmds.find((c) => c.name === "read-selection")?.shortcut;
  if (!k) return;
  $("shortcut").innerHTML = `Shortcut: ${k.split("+").map((p) => `<kbd>${p}</kbd>`).join(" + ")} reads your selection. Press again to stop.`;
  $("shortcut").hidden = false;
});
// PDFs open in the Phonomenal reader (page highlighting, read from any point)
const reader = (file) => chrome.runtime.getURL("reader.html") + (file ? "?file=" + encodeURIComponent(file) : "");
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
let onPdf = false;
try { onPdf = !!tab?.url && /\.pdf$/i.test(new URL(tab.url).pathname); } catch {}
if (onPdf) { $("pdfCard").hidden = false; $("try").className = "btn wide"; }
$("readPdf").onclick = async () => { await chrome.tabs.update(tab.id, { url: reader(tab.url) }); window.close(); };
$("openPdf").onclick = async (e) => { e.preventDefault(); await chrome.tabs.create({ url: reader() }); window.close(); };

if (!onPdf) control("warm");   // load the voice while the user looks at the popup
