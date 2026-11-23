// Background: right-click menu, keyboard shortcut, and routing between the page, the popup and the speech
// player. Chrome: a service worker that drives an offscreen document. Firefox: an event page that runs the
// player itself. If the Phonon voice cannot start, it falls back to the computer's own voice.
import { DEFAULTS, SPEEDS } from "./voices.js";

const USE_OFFSCREEN = !!chrome.offscreen;   // Chrome; Firefox has no offscreen API but its background page can play audio
let creating = null, inlinePlayer = null;
let session = null;          // { tabId, text, state, usingFallback }
const log = [];              // recent states, for diagnostics/tests

async function settings() { return { ...DEFAULTS, ...(await chrome.storage.sync.get(["voice", "speed"])) }; }

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

function setMenus(reading) {
  chrome.contextMenus.update("read-aloud", { title: reading ? "Read aloud (start over)" : "Read aloud" }).catch(() => {});
  chrome.contextMenus.update("stop-reading", { visible: reading }).catch(() => {});
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
  if (session?.tabId != null) chrome.tabs.sendMessage(session.tabId, { type: "read-aloud-state", state, fallback }).catch(() => {});
  chrome.runtime.sendMessage({ target: "popup", type: "state", state, fallback }).catch(() => {});
}

function cleanText(t) {
  return String(t || "").replace(/­/g, "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export async function readText(text, tabId) {
  text = cleanText(text);
  if (!text) return { ok: false, reason: "empty" };
  const s = await settings();
  stopFallback();
  session = { tabId, text, state: "loading", usingFallback: false, started: Date.now() };
  setMenus(true); setBadge("loading");
  if (tabId != null) await showPill(tabId);
  notifyTab("loading");
  await toPlayer({ type: "speak", text, voice: s.voice, speed: s.speed });
  return { ok: true };
}

export async function stopReading() {
  stopFallback();
  await toPlayer({ type: "stop" }).catch(() => {});
  finish("stopped");
}

function finish(state) {
  notifyTab(state);
  setMenus(false); setBadge(state);
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
      rate, lang: "en-US",
      onEvent: (e) => { if (["end", "interrupted", "cancelled", "error"].includes(e.type)) end(e.type === "end" ? "done" : e.type === "error" ? "error" : "stopped"); },
    });
  } else if (globalThis.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(session.text);
    u.rate = rate; u.lang = "en-US";
    u.onend = () => end("done"); u.onerror = (e) => end(e.error === "canceled" || e.error === "interrupted" ? "stopped" : "error");
    speechSynthesis.speak(u);
  } else end("error");
}

function onPlayerState(msg) {
  log.push({ t: Date.now(), ...msg }); if (log.length > 200) log.shift();
  if (["offscreen-ready", "ready"].includes(msg.state)) return;
  if (!session || session.usingFallback) return;
  if (msg.state === "error" && msg.phase === "load") return void fallbackSpeak(msg.error);
  session.state = msg.state;
  if (["done", "stopped", "error"].includes(msg.state)) finish(msg.state);
  else if (msg.state !== "replaced") { notifyTab(msg.state); setBadge(msg.state); }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "read-aloud", title: "Read aloud", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "stop-reading", title: "Stop reading", contexts: ["all"], visible: false });
  });
  if (reason === "install") chrome.tabs.create({ url: "welcome.html" });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-aloud") readText(info.selectionText, tab?.id);
  if (info.menuItemId === "stop-reading") stopReading();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "read-selection") return;
  if (session) return stopReading();
  if (!tab?.id) return;
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
    if (msg.action === "read") readText(msg.text, msg.tabId ?? sender.tab?.id ?? null);
    if (msg.action === "warm") settings().then((s) => toPlayer({ type: "warm", speed: s.speed }));
    sendResponse({ ok: true });
    return;
  }
  // The pill pings while reading: in Firefox each message keeps the event page from idling out mid-sentence.
  if (msg?.type === "keepalive") { sendResponse({ reading: !!session }); return; }
  if (msg?.type === "status") { sendResponse({ reading: !!session, state: session?.state ?? "idle", fallback: !!session?.usingFallback }); return; }
  if (msg?.type === "diag") {               // used by the automated tests
    Promise.resolve(toPlayer({ type: "stats" })).then((stats) => sendResponse({ log, stats, session, offscreen: USE_OFFSCREEN }));
    return true;
  }
});

// Speed changes need the model reloaded with new pacing: warm it in the background so the next read is quick.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.speed) toPlayer({ type: "warm", speed: changes.speed.newValue });
});

// Test hook (used by the Chrome end-to-end test; harmless otherwise).
self.__readAloud = { readText, stopReading, log, session: () => session, ensureOffscreen, offscreenStats: () => toPlayer({ type: "stats" }), SPEEDS };
