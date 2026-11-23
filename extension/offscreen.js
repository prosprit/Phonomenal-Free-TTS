// Chrome only: the service worker cannot play audio or hold the model, so the player lives in this offscreen document.
import { createPlayer } from "./player.js";

const handle = createPlayer((state, extra = {}) =>
  chrome.runtime.sendMessage({ target: "background", type: "state", state, ...extra }).catch(() => {}));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  const r = handle(msg);
  if (r !== undefined) sendResponse(r);
});
chrome.runtime.sendMessage({ target: "background", type: "state", state: "offscreen-ready" }).catch(() => {});
