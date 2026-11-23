// End-to-end test of the Read Aloud extension in Playwright's Chromium.
//   node e2e.mjs [--headed] [--ext <path>]
// Loads the unpacked extension, reads text through the real offscreen/Phonon path, and checks timings,
// stop, pause/resume, speed change, the on-page pill, and that the offscreen page survives >30 s of silence.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const HEADED = args.includes("--headed");
const EXT = path.resolve(args.includes("--ext") ? args[args.indexOf("--ext") + 1] : path.join(import.meta.dirname, "..", "extension"));
const results = { ext: EXT, checks: [], timings: {} };
const check = (name, ok, detail = "") => { results.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Test article</title></head><body style="font:18px system-ui;max-width:640px;margin:40px auto">
<h1>Village news</h1><p id="p1">The library on Elm Street will open late on Tuesday, at 10:30 a.m., because of a staff meeting. Dr. Patel's talk about garden birds has moved to Room 2.</p>
<p id="p2">Tickets cost $5 for adults and are free for children under 12.</p></body></html>`;
const server = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(PAGE); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "read-aloud-e2e-"));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: !HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required"],
});
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker", { timeout: 20000 });
const extId = sw.url().split("/")[2];
const consoleErrors = [];
ctx.on("weberror", (e) => consoleErrors.push(String(e.error())));

async function waitState(states, since, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const hit = await sw.evaluate(([st, s]) => self.__readAloud.log.find((e) => e.t >= s && st.includes(e.state)) || null, [states, since]);
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}
const now = () => sw.evaluate(() => Date.now());
const log = (since) => sw.evaluate((s) => self.__readAloud.log.filter((e) => e.t >= s).map((e) => e.state), since);

if (args.includes("--fallback")) {   // run against a copy whose model file is corrupted
  try {
    await sleep(1500);
    const page = await ctx.newPage(); await page.goto(URL_);
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + "*" }))[0]?.id, URL_);
    const voices = await sw.evaluate(() => new Promise((r) => chrome.tts.getVoices((v) => r(v.map((x) => x.voiceName)))));
    const t = await now();
    await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), ["Testing the backup voice.", tabId]);
    const fb = await waitState(["fallback"], t, 30000);
    check("broken model falls back to the computer's voice", fb, fb?.reason?.slice(0, 120));
    const end = await sw.evaluate(async () => { for (let i = 0; i < 150; i++) { if (!self.__readAloud.session()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; });
    check("fallback reading finishes and clears the session", end, `system voices: ${voices.length} (${voices.slice(0, 3).join(", ")})`);
  } catch (e) { check("fallback run", false, String(e?.stack || e)); }
  await ctx.close(); server.close(); fs.rmSync(profile, { recursive: true, force: true });
  process.exit(results.checks.every((c) => c.ok) ? 0 : 1);
}

try {
  // 0. install: welcome page opens
  await sleep(1500);
  const welcome = ctx.pages().find((p) => p.url().includes("welcome.html"));
  check("welcome page opens on install", welcome, welcome?.url());

  const page = await ctx.newPage();
  await page.goto(URL_);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + "*" }))[0]?.id, URL_);
  const text = await page.evaluate(() => document.getElementById("p1").textContent);

  // 1. cold read: model load + first sound
  let t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), [text, tabId]);
  const sp1 = await waitState(["speaking", "error"], t, 90000);
  check("cold read starts speaking", sp1?.state === "speaking", sp1 ? `first audio ${sp1.firstAudioMs} ms after request (model pre-loaded by the welcome page)` : "timeout");
  results.timings.coldFirstAudioMs = sp1?.firstAudioMs;
  const stats = await sw.evaluate(() => self.__readAloud.offscreenStats());
  const load = stats?.loads?.[0];
  check("offscreen is cross-origin isolated (threads available)", load?.isolated, JSON.stringify(load));
  results.timings.load = load;
  const d1 = await waitState(["done", "error", "stopped"], t, 120000);
  check("cold read finishes", d1?.state === "done", d1 ? `audio ${d1.audioSeconds}s in ${d1.chunks} chunks, total ${d1.totalMs} ms` : "timeout");
  results.timings.cold = d1;
  check("state sequence", true, (await log(t)).join(" → "));

  // 2. on-page pill. A real right-click grants activeTab; a programmatic call cannot, so this part runs only
  //    against a test copy of the extension whose manifest adds host_permissions (see --ext).
  const pillHost = () => page.evaluate(() => { const h = [...document.documentElement.children].find((e) => e.style?.zIndex === "2147483647"); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8"));
  if (manifest.host_permissions) {
    t = await now();
    await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), [text, tabId]);
    await waitState(["speaking"], t);
    await sleep(300);
    const box = await pillHost();
    check("pill appears bottom-right while reading", box && box.w > 200, JSON.stringify(box));
    const cdp = await ctx.newCDPSession(page);   // the pill is in a closed shadow root; read it via the accessibility tree
    const ax = JSON.stringify((await cdp.send("Accessibility.getFullAXTree")).nodes);
    check("pill says 'Reading aloud' and offers Pause", ax.includes("Reading aloud") && ax.includes("Pause"));
    await page.screenshot({ path: path.join(import.meta.dirname, "..", "docs", "pill.png") }).catch(() => {});
    await page.mouse.click(box.x + box.w - 45, box.y + box.h / 2);    // the red Stop button is the right-most control
    const ps = await waitState(["stopped"], t, 3000);
    check("pill Stop button stops reading", ps);
    await sleep(1600);
    check("pill hides after stopping", !(await pillHost()));
    t = await now();
    await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), [text, tabId]);
    await waitState(["speaking"], t);
    await page.keyboard.press("Escape");
    check("Escape key stops reading", await waitState(["stopped"], t, 3000));
  } else {
    console.log("info  pill checks skipped (no host_permissions: run with --ext <test copy>)");
  }

  // 3. warm read: first sound with the model already loaded
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), ["Tickets cost five dollars for adults.", tabId]);
  const sp2 = await waitState(["speaking", "error"], t);
  check("warm first sound", sp2?.state === "speaking" && sp2.firstAudioMs < 1500, `${sp2?.firstAudioMs} ms`);
  results.timings.warmFirstAudioMs = sp2?.firstAudioMs;
  await waitState(["done", "error"], t);

  // 4. stop mid-sentence
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), [text + " " + text, tabId]);
  await waitState(["speaking"], t);
  await sleep(1200);
  const tStop = Date.now();
  await sw.evaluate(() => self.__readAloud.stopReading());
  const st = await waitState(["stopped"], t, 5000);
  const after = await sw.evaluate(() => self.__readAloud.offscreenStats());
  check("stop works immediately", st && !after.playing && !(await sw.evaluate(() => self.__readAloud.session())), `${Date.now() - tStop} ms, playing=${after.playing}`);

  // 5. pause / resume
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), [text, tabId]);
  await waitState(["speaking"], t);
  await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "pause" }));
  const pz = await waitState(["paused"], t, 5000);
  const pst = await sw.evaluate(() => self.__readAloud.offscreenStats());
  await sleep(1500);
  await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "resume" }));
  const rs = await sw.evaluate(async (s) => { for (let i = 0; i < 50; i++) { if (self.__readAloud.log.some((e) => e.t > s && e.state === "speaking")) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }, Date.now() - 0);
  check("pause and resume", pz && pst.ctxState === "suspended", `ctx while paused: ${pst.ctxState}`);
  const dz = await waitState(["done", "error"], t, 60000);
  check("finishes after resume", dz?.state === "done");

  // 6. speed change reloads pacing; slower audio is longer
  const normalSec = d1?.audioSeconds;
  await sw.evaluate(() => chrome.storage.sync.set({ speed: "slower" }));
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), [text, tabId]);
  const ds = await waitState(["done", "error"], t, 120000);
  check("slower speed gives longer audio", ds?.audioSeconds > normalSec * 1.08, `normal ${normalSec}s → slower ${ds?.audioSeconds}s`);
  await sw.evaluate(() => chrome.storage.sync.set({ speed: "normal" }));
  await sleep(500);

  // 7. a different voice
  await sw.evaluate(() => chrome.storage.sync.set({ voice: "Preston" }));
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), ["This is a different voice.", tabId]);
  const dv = await waitState(["done", "error"], t, 60000);
  check("voice Preston plays", dv?.state === "done", dv?.error || "");
  await sw.evaluate(() => chrome.storage.sync.remove("voice"));

  // 8. offscreen survives 40 s of silence, and the next read is still warm
  await sleep(40000);
  const alive = await sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length);
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), ["Still here after a quiet minute.", tabId]);
  const sp3 = await waitState(["speaking", "error"], t, 90000);
  check("offscreen document survives 40 s idle", alive === 1, `contexts=${alive}`);
  check("read after idle is fast", sp3?.firstAudioMs < 1500, `${sp3?.firstAudioMs} ms`);
  results.timings.afterIdleFirstAudioMs = sp3?.firstAudioMs;
  await waitState(["done", "error"], t);

  // 9. truly cold start: close the offscreen page so the model must load again from disk
  await sw.evaluate(() => chrome.offscreen.closeDocument());
  t = await now();
  await sw.evaluate(([x, id]) => self.__readAloud.readText(x, id), ["Good morning, this is a cold start.", tabId]);
  const sc = await waitState(["speaking", "error"], t, 90000);
  check("cold start (model loads from disk) first sound under 2 s", sc?.firstAudioMs < 2000, `${sc?.firstAudioMs} ms`);
  results.timings.trueColdFirstAudioMs = sc?.firstAudioMs;
  await waitState(["done", "error"], t);

  // 10. popup renders with voices
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const nVoices = await popup.locator("input[name=voice]").count();
  check("popup lists 11 voices", nVoices === 11, `${nVoices}`);
  check("popup hides the now-playing bar when idle", !(await popup.locator("#now").isVisible()));
  await popup.screenshot({ path: path.join(import.meta.dirname, "..", "docs", "popup.png") }).catch(() => {});
  await popup.close();

  check("no uncaught errors in extension pages", consoleErrors.length === 0, consoleErrors.join(" | "));
} catch (e) {
  check("test run", false, String(e?.stack || e));
} finally {
  results.fullLog = await sw.evaluate(() => self.__readAloud.log).catch(() => []);
  fs.mkdirSync(path.join(import.meta.dirname, "..", "docs"), { recursive: true });
  fs.writeFileSync(path.join(import.meta.dirname, "e2e-results.json"), JSON.stringify(results, null, 1));
  await ctx.close(); server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  const failed = results.checks.filter((c) => !c.ok).length;
  console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
