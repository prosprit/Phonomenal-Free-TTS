// Test-only content script (added to the test copy's manifest by the Firefox test, never shipped):
// relays window.postMessage from the test page to the extension background and back.
window.addEventListener("message", async (e) => {
  if (e.source !== window || e.data?.__bridge !== "req") return;
  let res;
  try { res = await chrome.runtime.sendMessage(e.data.msg); } catch (err) { res = { __error: String(err) }; }
  window.postMessage({ __bridge: "res", id: e.data.id, res: JSON.parse(JSON.stringify(res ?? null)) }, "*");
});
