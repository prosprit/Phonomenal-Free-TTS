// Screenshots of every UI surface for design review: node shots.mjs [--ext <path>] [--out <dir>]
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const EXT = path.resolve(opt("--ext", path.join(import.meta.dirname, "..", "extension")));
const OUT = path.resolve(opt("--out", path.join(import.meta.dirname, "..", "docs", "shots")));
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = `<!doctype html><meta charset="utf-8"><body style="font:18px Georgia,serif;max-width:640px;margin:40px auto;color:#222">
<h1>Village news</h1><p id="p1">The library on Elm Street will open late on Tuesday, at 10:30 a.m., because of a staff meeting. Dr. Patel's talk about garden birds has moved to Room 2.</p></body>`;
const server = http.createServer((_q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(PAGE); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "read-aloud-shots-"));
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--autoplay-policy=no-user-gesture-required"] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
try {
  await sleep(1500);
  for (const scheme of ["light", "dark"]) {
    const w = await ctx.newPage(); await w.emulateMedia({ colorScheme: scheme }); await w.setViewportSize({ width: 1000, height: 820 });
    await w.goto(`chrome-extension://${id}/welcome.html`); await sleep(400);
    await w.screenshot({ path: path.join(OUT, `welcome-${scheme}.png`) }); await w.close();
    const p = await ctx.newPage(); await p.emulateMedia({ colorScheme: scheme }); await p.setViewportSize({ width: 400, height: 600 });
    await p.goto(`chrome-extension://${id}/popup.html`); await sleep(400);
    await p.screenshot({ path: path.join(OUT, `popup-${scheme}.png`) }); await p.close();
  }
  const page = await ctx.newPage(); await page.setViewportSize({ width: 1000, height: 400 }); await page.goto(URL_);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + "*" }))[0]?.id, URL_);
  const text = await page.evaluate(() => document.getElementById("p1").textContent);
  await sw.evaluate(([x, t]) => self.__readAloud.readText(x, t), [text, tabId]);
  await sleep(60); await page.screenshot({ path: path.join(OUT, "pill-loading.png") });
  await sleep(1500); await page.screenshot({ path: path.join(OUT, "pill-speaking.png") });
  await sw.evaluate(() => chrome.runtime.sendMessage({ target: "offscreen", type: "pause" })); await sleep(400);
  await page.screenshot({ path: path.join(OUT, "pill-paused.png") });
  await sw.evaluate(() => self.__readAloud.stopReading());
  console.log("screenshots in", OUT);
} finally { await ctx.close(); server.close(); fs.rmSync(profile, { recursive: true, force: true }); }
