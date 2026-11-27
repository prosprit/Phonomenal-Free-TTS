// Background: right-click menu, keyboard shortcut, and routing between the page, the popup and the speech
// player. Chrome: a service worker that drives an offscreen document. Firefox: an event page that runs the
// player itself. If the Phonon voice cannot start, it falls back to the computer's own voice.
import { DEFAULTS, SPEEDS, SETTING_KEYS, CODE_VERSION, pickLang, voiceFor, langOf } from "./voices.js";

const USE_OFFSCREEN = !!chrome.offscreen;   // Chrome; Firefox has no offscreen API but its background page can play audio
let creating = null, inlinePlayer = null;
let session = null;          // { tabId, text, state, usingFallback }
const log = [];              // recent states, for diagnostics/tests

async function settings() { return { ...DEFAULTS, ...(await chrome.storage.sync.get(SETTING_KEYS)) }; }
const BCP47 = { en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", pt: "pt-BR" };   // for the computer's own voice

// The language last read in, so "warm" (popup opened, settings changed) preloads the model for the likely next read.
async function lastLang() { try { return langOf((await chrome.storage.local.get("lastLang")).lastLang); } catch { return "en"; } }
async function warmLang(s) { return s.lang !== "auto" ? langOf(s.lang) : lastLang(); }
/** Language and voice for this text: the user's fixed choice, or detected from the text and the page. */
async function voiceSetup(text, s, force, pageLang) {
  const lang = await pickLang(text, force || s.lang, pageLang);
  chrome.storage.local.set({ lastLang: lang }).catch(() => {});
  return { lang, voice: voiceFor(s, lang) };
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK", "WORKERS"],
    justification: "Generate speech on the device with a local voice model and play it.",
  }).finally(() => { creating = null; });
  await creating;
}

async function toPlayer(msg) {
  if (USE_OFFSCREEN) { await ensureOffscreen(); return chrome.runtime.sendMessage({ target: "offscreen", ...msg }); }
  if (!inlinePlayer) {
    const { createPlayer } = await import("./player.js");
    inlinePlayer = createPlayer((state, extra = {}) => onPlayerState({ state, ...extra }));
  }
  return inlinePlayer(msg);
}

// ---------- PDFs: open them in the Phonomenal reader (the browser's own PDF viewer cannot be scripted) ----------
const PDF_PATTERNS = ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.pdf#*", "*://*/*.PDF", "file:///*.pdf", "file:///*.PDF"];
export function isPdfUrl(u) { try { return /\.pdf$/i.test(new URL(u).pathname); } catch { return false; } }
const readerUrl = (file, find = "") =>
  chrome.runtime.getURL("reader.html") + "?file=" + encodeURIComponent(file) + (find ? "&find=" + encodeURIComponent(find.slice(0, 300)) : "");
export function openReader(tab, find = "") {
  const id = tabIdOf(tab);
  return id != null ? chrome.tabs.update(id, { url: readerUrl(tab.url, find) }) : chrome.tabs.create({ url: readerUrl(tab.url, find) });
}

// A real tab id, or null. Some Chrome versions report menu clicks inside their built-in PDF viewer with
// tab.id -1 (or no tab at all); using that id makes tab APIs throw, which used to cancel reading silently.
const tabIdOf = (tab) => (Number.isInteger(tab?.id) && tab.id >= 0 ? tab.id : null);
async function activeTab() {
  try { return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null; } catch { return null; }
}

function setBadge(state) {
  const on = ["loading", "speaking", "paused"].includes(state);
  chrome.action.setBadgeBackgroundColor({ color: state === "paused" ? "#8a6d00" : "#2f5d8a" });
  chrome.action.setBadgeText({ text: on ? (state === "paused" ? "❚❚" : "▶") : "" });
}

async function showPill(tabId) {
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ["pill.js"] }); return true; }
  catch { return false; }   // browser pages, the add-on stores, some PDFs: no on-page controls; menu/popup still work
}

function notifyTab(state, extra = {}) {
  const { fallback = false } = extra;     // forward only what the UI needs
  try { if (session?.tabId != null) chrome.tabs.sendMessage(session.tabId, { type: "read-aloud-state", state, fallback, run: session.run }).catch(() => {}); } catch {}
  try { chrome.runtime.sendMessage({ target: "popup", type: "state", state, fallback }).catch(() => {}); } catch {}
}

function cleanText(t) {
  return String(t || "").replace(/­/g, "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

async function begin(tabId, text, run) {
  stopFallback();
  if (session && session.tabId !== tabId) notifyTab("stopped");     // clear the controls and highlight in the old tab
  session = { tabId, text, run, lang: "en", state: "loading", usingFallback: false, started: Date.now() };
  setBadge("loading");
  // on-page controls are a nicety: if the page refuses them (PDF viewer, browser pages), speak anyway
  if (tabId != null) await within(showPill(tabId), 1500);
  notifyTab("loading");
}

let lastRead = null;     // what was last asked for, so the pill's "Try again" can repeat it after an error

/** Speak one piece of text (the popup's sample, the welcome page, text the page reader can't follow).
 *  `lang` forces a language (the popup's voice sample); otherwise it follows the settings / detection. */
export async function readText(text, tabId, { lang: force = null, pageLang = "" } = {}) {
  text = cleanText(text);
  if (!text) return { ok: false, reason: "empty" };
  tabId = tabIdOf({ id: tabId });
  lastRead = { text, tabId, force, pageLang };
  const s = await settings();
  await begin(tabId, text, null);                                   // controls first, then the language
  const { lang, voice } = await voiceSetup(text, s, force, pageLang);
  if (session) session.lang = lang;
  await toPlayer({ type: "speak", text, voice, speed: s.speed, lang });
  return { ok: true, lang, voice };
}

/** Read a page sentence by sentence from where the user chose (items come from pagereader.js). */
export async function readSeq(items, run, tabId, pageLang = "") {
  items = (items || []).map((it) => ({ text: cleanText(it.text), pause: Math.min(1, Math.max(0, +it.pause || 0.12)) })).filter((it) => it.text);
  if (!items.length) return { ok: false, reason: "empty" };
  tabId = tabIdOf({ id: tabId });
  lastRead = { items, run, tabId, pageLang };
  const s = await settings();
  const text = items.map((it) => it.text).join(" ");
  await begin(tabId, text, String(run));
  const { lang, voice } = await voiceSetup(text, s, null, pageLang);
  if (session) session.lang = lang;
  await toPlayer({ type: "speak-seq", items, voice, speed: s.speed, lang });
  return { ok: true, lang, voice };
}

/** "Read aloud" on a web page: read the selection in that frame, highlighting as it goes; the page then offers
 *  "Continue reading" (pagereader.js). False if the page can't be followed. */
export async function readFromPage(tabId, frameId = 0) {
  if (tabId == null) return false;
  try {
    const injected = await within(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["pagereader.js"] }), 2000);
    if (!injected) return false;
    const res = await within(chrome.tabs.sendMessage(tabId, { type: "phonomenal-read-selection" }, { frameId }), 3000);
    if (!res?.items?.length) return false;
    return (await readSeq(res.items, res.run, tabId, res.lang)).ok;
  } catch { return false; }
}

export async function stopReading() {
  stopFallback();
  await toPlayer({ type: "stop" }).catch(() => {});
  finish("stopped");
}

function finish(state) {
  notifyTab(state);
  setBadge(state);
  session = null;
}

// Fallback: the computer's built-in voice (chrome.tts in Chrome, speechSynthesis in Firefox's background page).
function stopFallback() {
  if (!session?.usingFallback) return;
  if (chrome.tts) chrome.tts.stop(); else globalThis.speechSynthesis?.cancel();
}

async function fallbackSpeak(reason) {
  if (!session) return;
  const s = await settings();
  const rate = s.speed === "slower" ? 0.85 : s.speed === "faster" ? 1.15 : 1.0;
  session.usingFallback = true;
  log.push({ t: Date.now(), state: "fallback", reason });
  notifyTab("speaking", { fallback: true });
  setBadge("speaking");
  const end = (kind) => { if (session?.usingFallback) finish(kind); };
  if (chrome.tts) {
    chrome.tts.speak(session.text, {
      rate, lang: BCP47[session.lang] || "en-US",
      onEvent: (e) => { if (["end", "interrupted", "cancelled", "error"].includes(e.type)) end(e.type === "end" ? "done" : e.type === "error" ? "error" : "stopped"); },
    });
  } else if (globalThis.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(session.text);
    u.rate = rate; u.lang = BCP47[session.lang] || "en-US";
    u.onend = () => end("done"); u.onerror = (e) => end(e.error === "canceled" || e.error === "interrupted" ? "stopped" : "error");
    speechSynthesis.speak(u);
  } else end("error");
}

function onPlayerState(msg) {
  log.push({ t: Date.now(), ...msg }); if (log.length > 200) log.shift();
  if (["offscreen-ready", "ready"].includes(msg.state)) return;
  if (!session || session.usingFallback) return;
  if (msg.state === "sentence") {             // highlight the sentence now being heard
    if (session.run && session.tabId != null) {
      try { chrome.tabs.sendMessage(session.tabId, { type: "read-aloud-sentence", run: session.run, index: msg.index }).catch(() => {}); } catch {}
    }
    return;
  }
  if (msg.state === "error" && msg.phase === "load") return void fallbackSpeak(msg.error);
  session.state = msg.state;
  if (["done", "stopped", "error"].includes(msg.state)) finish(msg.state);
  else if (msg.state !== "replaced") { notifyTab(msg.state); setBadge(msg.state); }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    // One item per situation, so the browser shows it directly instead of under a "Phonomenal" submenu
    // (Chrome nests an extension's items as soon as more than one matches, hidden ones included).
    chrome.contextMenus.create({ id: "read-aloud", title: "Read aloud", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "pdf-open", title: "Read this PDF aloud", contexts: ["page"], documentUrlPatterns: PDF_PATTERNS });
  });
  if (reason === "install") chrome.tabs.create({ url: "welcome.html" });
});

export async function onMenuClick(info, tab) {
  log.push({ t: Date.now(), state: "menu", item: info.menuItemId, tabId: tab?.id ?? null, chars: (info.selectionText || "").length });
  // where the click happened: the reported tab if it is real, otherwise the tab in front
  const real = tabIdOf(tab) != null ? tab : (await activeTab()) || tab || {};
  const url = info.pageUrl || real.url || "";
  const id = tabIdOf(real);
  if (info.menuItemId === "read-aloud") {
    // a web page: read the selection with highlighting, then offer "Continue reading" on the page
    if (!isPdfUrl(url) && tabIdOf(tab) != null && await readFromPage(id, info.frameId ?? 0)) return;
    // the browser's PDF viewer and pages that can't be followed (browser pages, text boxes): read the selected text
    if ((info.selectionText || "").trim()) return readText(info.selectionText, id);
    if (isPdfUrl(url)) return openReader({ id, url });   // the PDF viewer gave no text: use the reader
  }
  if (info.menuItemId === "pdf-open") return openReader({ id, url });
}
chrome.contextMenus.onClicked.addListener((info, tab) => { onMenuClick(info, tab).catch(() => {}); });

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "read-selection") return;
  if (session) return stopReading();
  if (tabIdOf(tab) == null) return;
  if (isPdfUrl(tab.url)) return openReader(tab);       // the browser's PDF viewer can't be read from: open the reader
  if (await readFromPage(tab.id, 0)) return;           // the selection, then "Continue reading"
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || "") });
    if (result.trim()) readText(result, tab.id);
  } catch { /* page does not allow scripts */ }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "background" && msg.type === "state") return void onPlayerState(msg);
  if (msg?.type === "control") {           // from the on-page pill, the popup or the welcome page
    if (msg.action === "stop") stopReading();
    if (msg.action === "pause" && session && !session.usingFallback) toPlayer({ type: "pause" });
    if (msg.action === "resume" && session && !session.usingFallback) toPlayer({ type: "resume" });
    if (msg.action === "retry" && lastRead && !session) {
      if (lastRead.items) readSeq(lastRead.items, lastRead.run, lastRead.tabId, lastRead.pageLang);
      else readText(lastRead.text, lastRead.tabId, { lang: lastRead.force, pageLang: lastRead.pageLang });
    }
    if (msg.action === "read") readText(msg.text, msg.tabId ?? sender.tab?.id ?? null, { lang: msg.lang, pageLang: msg.pageLang });
    if (msg.action === "read-seq") readSeq(msg.items, msg.run, sender.tab?.id ?? null, msg.lang);   // a jump within the page being read
    if (msg.action === "warm") settings().then(async (s) => toPlayer({ type: "warm", speed: s.speed, lang: msg.lang || await warmLang(s) }));
    if (msg.action === "open-pdf" && msg.url) {
      if (msg.newTab) chrome.tabs.create({ url: readerUrl(msg.url, msg.find) });
      else openReader({ id: msg.tabId ?? sender.tab?.id, url: msg.url }, msg.find);
    }
    // the PDF reader runs its own voice: stop this one and, in Chrome, free its memory
    if (msg.action === "release") { if (session) stopReading(); if (USE_OFFSCREEN) chrome.offscreen.closeDocument().catch(() => {}); }
    sendResponse({ ok: true });
    return;
  }
  // The pill pings while reading: in Firefox each message keeps the event page from idling out mid-sentence.
  if (msg?.type === "keepalive") { sendResponse({ reading: !!session }); return; }
  if (msg?.type === "reader-state") {        // the PDF reader's progress: badge + diagnostics
    log.push({ t: Date.now(), state: "reader-" + msg.state, text: msg.text, highlighted: msg.highlighted }); if (log.length > 200) log.shift();
    if (!session) setBadge(msg.state === "playing" ? "speaking" : msg.state);
    return;
  }
  if (msg?.type === "status") { sendResponse({ reading: !!session, state: session?.state ?? "idle", fallback: !!session?.usingFallback, code: CODE_VERSION }); return; }
  if (msg?.type === "diag") {               // used by the automated tests
    Promise.resolve(toPlayer({ type: "stats" })).then((stats) => sendResponse({ log, stats, session, offscreen: USE_OFFSCREEN }));
    return true;
  }
});

// Speed and language changes need the model reloaded: warm it in the background so the next read is quick.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.speed || changes.lang) && !session) settings().then(async (s) => toPlayer({ type: "warm", speed: s.speed, lang: await warmLang(s) }));
});

// Test hook (used by the Chrome end-to-end test; harmless otherwise).
self.__readAloud = { readText, readSeq, readFromPage, onMenuClick, stopReading, onPlayerState, log, session: () => session, ensureOffscreen, offscreenStats: () => toPlayer({ type: "stats" }), SPEEDS };
