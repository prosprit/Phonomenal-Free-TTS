// One button that becomes Stop while reading: nothing to mis-click, and it always shows what will happen next.
const btn = document.getElementById("toggle"), status = document.getElementById("status");
const demo = document.getElementById("demo").textContent;
let reading = false;

function show(state) {
  reading = ["loading", "speaking", "paused"].includes(state);
  btn.textContent = reading ? "Stop" : "Read this to me";
  btn.className = "btn " + (reading ? "stop" : "primary");
  status.textContent = state === "loading" ? "Getting ready…" : state === "speaking" ? "Reading aloud" : "";
}
btn.onclick = async () => {
  if (reading) return chrome.runtime.sendMessage({ type: "control", action: "stop" });
  show("loading");
  const tab = await chrome.tabs.getCurrent();
  chrome.runtime.sendMessage({ type: "control", action: "read", text: demo, tabId: tab?.id ?? null });
};
chrome.runtime.onMessage.addListener((m) => { if (m?.target === "popup" && m.type === "state") show(m.state); });
chrome.runtime.sendMessage({ type: "control", action: "warm" });   // get the voice ready while the page is open
