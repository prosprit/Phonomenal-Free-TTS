// End-to-end test of the extension in the installed Firefox (temporary add-on via WebDriver BiDi).
//   node e2e-firefox.mjs --ext <copy with host_permissions for 127.0.0.1> [--headed] [--firefox <path>]
// Firefox has no offscreen API, so the player runs in the background event page. The test shortens Firefox's
// idle timeout and closes every extension page during a long read, to prove the pill's keepalive pings stop
// Firefox from unloading the page mid-sentence. Firefox's default autoplay policy is left as is.
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const EXT = path.resolve(opt("--ext", path.join(import.meta.dirname, "..", "extension")));
const FIREFOX = opt("--firefox", "C:/Program Files/Mozilla Firefox/firefox.exe");
const ID = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;
const UUID = "5d1c3a52-7f0e-4b8e-9a51-0c2f6a7b9e10";
const BASE = `moz-extension://${UUID}/`;
const IDLE_MS = 15000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { browser: "firefox", checks: [] };
const check = (name, ok, detail = "") => { results.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const PARA = "The library on Elm Street will open late on Tuesday, at 10:30 a.m., because of a staff meeting. Dr. Patel's talk about garden birds has moved to Room 2.";
const PAGE = `<!doctype html><meta charset="utf-8"><title>Test article</title><body style="font:18px system-ui;max-width:640px;margin:40px auto"><h1>Village news</h1><p>${PARA}</p></body>`;
const server = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(PAGE); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
  browser: "firefox", executablePath: FIREFOX, headless: !args.includes("--headed"),
  extraPrefsFirefox: {
    "extensions.webextensions.uuids": JSON.stringify({ [ID]: UUID }),
    "extensions.background.idle.timeout": IDLE_MS,
  },
});
const errors = [];
let page;   // the test page; its bridge content script relays messages to the background
const send = (msg) => page.evaluate((m) => new Promise((res) => {
  const id = Math.random().toString(36).slice(2);
  const on = (e) => { if (e.data?.__bridge === "res" && e.data.id === id) { removeEventListener("message", on); res(e.data.res); } };
  addEventListener("message", on); postMessage({ __bridge: "req", id, msg: m }, "*");
}), msg);
const diag = () => send({ type: "diag" });
const read = (text) => send({ type: "control", action: "read", text });   // tabId comes from the sender tab
async function waitFor(states, since, timeout = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const d = await diag();
    const hit = d?.log?.find((e) => e.t >= since && states.includes(e.state));
    if (hit) return hit;
    await sleep(250);
  }
  return null;
}

try {
  await browser.installExtension(EXT);
  await sleep(2000);
  const pages = await browser.pages();
  for (const p of pages) p.on("pageerror", (e) => errors.push(String(e)));

  page = await browser.newPage(); page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL_); await sleep(500);
  const d0 = await diag();
  check("Firefox uses the in-background player (no offscreen)", d0?.offscreen === false, d0?.__error || "");
  // BiDi cannot list moz-extension tabs; the welcome page's only side effect is warming the voice, so look for that.
  check("welcome page opened on install and pre-loaded the voice", d0?.log?.some((e) => e.state === "ready"));

  // 1. read with the model loading cold
  let t = Date.now();
  await read(PARA);
  const sp = await waitFor(["speaking", "error"], t);
  check("reads aloud in Firefox", sp?.state === "speaking", sp ? `first audio ${sp.firstAudioMs} ms (voice pre-loaded by the welcome page)` : "timeout");
  const st = (await diag()).stats;
  check("model loaded", st?.loads?.length, JSON.stringify(st?.loads?.[0]));
  check("audio clock is running (not blocked by autoplay)", st?.ctxState === "running", `AudioContext ${st?.ctxState}`);
  const done = await waitFor(["done", "error"], t, 120000);
  check("finishes reading", done?.state === "done", done ? `audio ${done.audioSeconds}s, total ${done.totalMs} ms` : "timeout");

  // 2. warm read, pill, stop via the pill's Stop button
  t = Date.now();
  await read(PARA);
  const sp2 = await waitFor(["speaking"], t);
  check("warm first sound", sp2?.firstAudioMs < 1500, `${sp2?.firstAudioMs} ms`);
  await sleep(300);
  const box = await page.evaluate(() => { const h = [...document.documentElement.children].find((e) => e.style?.zIndex === "2147483647"); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  check("pill appears while reading", box && box.w > 200, JSON.stringify(box));
  fs.mkdirSync(path.join(import.meta.dirname, "..", "docs", "shots"), { recursive: true });
  await page.screenshot({ path: path.join(import.meta.dirname, "..", "docs", "shots", "firefox-pill.png") });
  if (box) await page.mouse.click(box.x + box.w - 40, box.y + box.h / 2);
  check("pill Stop button stops reading", await waitFor(["stopped"], t, 4000));

  // 3. long read with every extension page closed and the test silent: only the pill's pings keep the page alive
  const long = Array(4).fill(PARA).join(" ");
  for (const p of await browser.pages()) if (p.url().startsWith("moz-extension:")) await p.close();
  t = Date.now();
  await read(long);
  await waitFor(["speaking"], t);
  console.log(`info  extension pages closed; idle timeout ${IDLE_MS / 1000}s; staying silent through a ~45 s read…`);
  await sleep(52000);
  const d = await diag();
  const fin = d.log.find((e) => e.t >= t && e.state === "done");
  check("background survives a long read with no extension pages open", fin && fin.audioSeconds > 2.5 * IDLE_MS / 1000,
    fin ? `read ${fin.audioSeconds}s of audio to the end` : `log since start: ${d.log.filter((e) => e.t >= t).map((e) => e.state).join(",") || "empty (background was unloaded)"}`);
  check("no uncaught errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("test run", false, String(e?.stack || e));
} finally {
  fs.writeFileSync(path.join(import.meta.dirname, "e2e-firefox-results.json"), JSON.stringify(results, null, 1));
  await browser.close().catch(() => {}); server.close();
  const failed = results.checks.filter((x) => !x.ok).length;
  console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
