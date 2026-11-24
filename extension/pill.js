// On-page controls shown while reading: big, high-contrast Pause and Stop buttons in the bottom-right corner.
// A thin light edge keeps the dark bar visible on dark pages; motion is opacity/transform only and off for reduced motion.
// Injected only into the tab the user asked to read (activeTab). Lives in a closed shadow root so pages can't restyle it.
(() => {
  if (window.__readAloudPill) { window.__readAloudPill.show(); return; }
  const host = document.createElement("div");
  host.id = "phonomenal-pill";
  host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
  <style>
    .pill { font: 600 17px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; display:flex; align-items:center; gap:8px;
            background:#1d2733; color:#fff; padding:7px 7px 7px 16px; border-radius:999px; border:1px solid rgb(255 255 255 / .16);
            box-shadow:0 1px 2px rgb(0 0 0 / .06), 0 4px 12px rgb(0 0 0 / .08); }
    @media (prefers-reduced-motion: no-preference) { .pill { animation: rise 150ms ease-out; } }
    @keyframes rise { from { opacity:0; transform:translateY(8px); } }
    .dot { width:10px; height:10px; border-radius:50%; background:#7fd18b; flex:none; }
    .dot.loading { background:#f2c14e; animation: pulse 1s infinite; }
    .dot.paused, .dot.error { background:#f2c14e; }
    @keyframes pulse { 50% { opacity:.35 } }
    @media (prefers-reduced-motion: reduce) { .dot.loading { animation:none } }
    .label { min-width:124px; margin-right:4px; }
    button { font: 600 16px/1 system-ui, -apple-system, "Segoe UI", sans-serif; border:0; border-radius:999px; min-height:44px; padding:0 18px; cursor:pointer; }
    button:focus-visible { outline:3px solid #9cc8ff; outline-offset:2px; }
    button:disabled { opacity:.45; cursor:default; }
    .pause, .retry { background:#e8eef5; color:#1d2733; min-width:96px; }
    .pause:hover:not(:disabled), .retry:hover { background:#fff; }
    .stop { background:#c63b3b; color:#fff; }
    .stop:hover { background:#ad3030; }
    button:active:not(:disabled) { transform:scale(.97); }
  </style>
  <div class="pill" role="region" aria-label="Phonomenal reading controls">
    <span class="dot loading" aria-hidden="true"></span>
    <span class="label" aria-live="polite">Getting ready…</span>
    <button class="pause" type="button" disabled>Pause</button>
    <button class="retry" type="button" hidden>Try again</button>
    <button class="stop" type="button">Stop</button>
  </div>`;
  const dot = root.querySelector(".dot"), label = root.querySelector(".label");
  const pauseBtn = root.querySelector(".pause"), stopBtn = root.querySelector(".stop"), retryBtn = root.querySelector(".retry");
  let paused = false, hideTimer = null, ping = null;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});
  pauseBtn.onclick = () => send({ type: "control", action: paused ? "resume" : "pause" });
  stopBtn.onclick = () => send({ type: "control", action: "stop" });
  retryBtn.onclick = () => send({ type: "control", action: "retry" });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && host.isConnected) send({ type: "control", action: "stop" }); }, true);

  function setState(state, fallback) {
    clearTimeout(hideTimer);
    const active = ["loading", "speaking", "paused"].includes(state);
    paused = state === "paused";
    dot.className = "dot " + state;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    pauseBtn.disabled = state === "loading";             // stays in place (no jump), just inactive while loading
    pauseBtn.hidden = !!fallback || !active;
    stopBtn.hidden = !active;
    retryBtn.hidden = state !== "error";                 // every failure offers a way back
    label.textContent = { loading: "Getting ready…", speaking: "Reading aloud", paused: "Paused",
      done: "Finished", stopped: "Stopped", error: "Couldn't play that" }[state] || "Reading aloud";
    // Firefox unloads an idle background page; a ping every 10 s while reading keeps the voice going.
    if (active && !ping) ping = setInterval(() => send({ type: "keepalive" }), 10000);
    if (!active) { clearInterval(ping); ping = null; hideTimer = setTimeout(() => host.remove(), state === "error" ? 10000 : 1200); }
  }
  chrome.runtime.onMessage.addListener((m) => { if (m?.type === "read-aloud-state") { if (!host.isConnected) document.documentElement.appendChild(host); setState(m.state, m.fallback); } });
  window.__readAloudPill = { show() { if (!host.isConnected) document.documentElement.appendChild(host); setState("loading"); } };
  window.__readAloudPill.show();
})();
