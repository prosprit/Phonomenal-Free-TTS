// Phonomenal PDF reader: shows the PDF (PDF.js), reads it aloud sentence by sentence from any point, highlights the
// sentence being spoken, follows along, and remembers where you stopped. Open with reader.html?file=<url>[&find=<text>].
import * as pdfjs from "./vendor/pdfjs/pdf.min.mjs";
import { SpeechEngine } from "./engine.js";
import { pageParagraphs } from "./pdftext.js";
import { VOICES, SPEEDS, DEFAULTS, LANGS, SETTING_KEYS, voiceKey, voiceFor, pickLang, langOf } from "./voices.js";

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");
const $ = (id) => document.getElementById(id);
const viewer = $("viewer"), pagesEl = $("pages");
const params = new URLSearchParams(location.search);
const IS_FIREFOX = navigator.userAgent.includes("Firefox");
const END_PUNCT = /[.!?:;”"’)\]]$/;
const PT = 96 / 72;                                   // CSS px per PDF point: "100%" matches the browser's own viewer
const KEYS = [...SETTING_KEYS, "pdfFollow", "pdfSideNotes", "pdfSkipHeaders"];
const S = { ...DEFAULTS, pdfFollow: true, pdfSideNotes: true, pdfSkipHeaders: true, ...(await chrome.storage.sync.get(KEYS)) };

let docLang = S.lang !== "auto" ? langOf(S.lang) : "en", detectedLang = null;   // the language this PDF is read in
let pdf = null, docKey = null, numPages = 0, base = { w: 612, h: 792 };
let zoom = 1, currentPage = 1, resumePos = null, current = null, chipPos = null;
let userScrolled = false, autoScrollUntil = 0;
const pages = [];                  // per page: { n, el, rendered, rendering, task, divs, spanIdx, near }
const textCache = new Map();       // page -> Promise<textContent>
const paraCache = new Map();       // page -> Promise<paragraphs>
const paraReady = new Map();       // page -> paragraphs (resolved), for synchronous highlighting
const engine = new SpeechEngine();

// ---------- toolbar setup ----------
// The voice list follows the PDF's language; each language remembers its own voice.
function fillVoices() {
  $("voice").replaceChildren();
  const cur = voiceFor(S, docLang);
  for (const [label, g2] of [["Men", "male"], ["Women", "female"]]) {
    const g = document.createElement("optgroup"); g.label = label;
    for (const v of VOICES[docLang].filter((x) => x.gender === g2)) g.append(new Option(v.name, v.id, false, v.id === cur));
    $("voice").append(g);
  }
}
function fillLangs() {
  $("langSel").replaceChildren(new Option(detectedLang ? `Detect (${LANGS.find((l) => l.id === detectedLang).name})` : "Detect automatically", "auto", false, S.lang === "auto"),
    ...LANGS.map((l) => new Option(l.name, l.id, false, l.id === S.lang)));
}
async function detectDocLang() {
  let text = "";
  for (let n = 1; n <= Math.min(numPages, 3) && text.length < 3000; n++) {
    try { text += " " + (await getText(n)).items.map((i) => i.str).join(" "); } catch {}
  }
  detectedLang = await pickLang(text, "auto", "");
  setDocLang();
}
function setDocLang() {
  const next = S.lang !== "auto" ? langOf(S.lang) : (detectedLang || "en");
  const changed = next !== docLang;
  docLang = next; fillVoices(); fillLangs();
  if (changed) restartHere();
}
fillVoices(); fillLangs();
for (const sp of SPEEDS) $("speed").append(new Option(`${sp.label} speed`, sp.id, false, sp.id === S.speed));
$("optFollow").checked = S.pdfFollow; $("optSide").checked = S.pdfSideNotes; $("optHeaders").checked = S.pdfSkipHeaders;
const save = (o) => { Object.assign(S, o); chrome.storage.sync.set(o); };

$("voice").onchange = () => { save({ [voiceKey(docLang)]: $("voice").value }); restartHere(); };
$("langSel").onchange = () => { save({ lang: $("langSel").value }); setDocLang(); };
$("speed").onchange = () => { save({ speed: $("speed").value }); restartHere(); };
$("optFollow").onchange = () => { save({ pdfFollow: $("optFollow").checked }); if (S.pdfFollow) backToReading(); };
$("optSide").onchange = () => { save({ pdfSideNotes: $("optSide").checked }); resetText(); };
$("optHeaders").onchange = () => { save({ pdfSkipHeaders: $("optHeaders").checked }); resetText(); };
$("moreBtn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
document.addEventListener("click", (e) => { if (!$("menu").hidden && !e.target.closest(".more")) toggleMenu(false); });
function toggleMenu(open = $("menu").hidden) { $("menu").hidden = !open; $("moreBtn").setAttribute("aria-expanded", String(open)); }

$("play").onclick = togglePlay;
$("stop").onclick = () => engine.stop();
$("prev").onclick = () => skip(-1);
$("next").onclick = () => skip(1);
$("zoomIn").onclick = () => setZoom(zoom * 1.15);
$("zoomOut").onclick = () => setZoom(zoom / 1.15);
$("back").onclick = backToReading;
$("chip").onclick = () => { if (chipPos) start(chipPos); hideChip(); };
$("pageIn").onchange = () => { const n = parseInt($("pageIn").value, 10); if (n >= 1 && n <= numPages) goToPage(n); else $("pageIn").value = currentPage; };
$("pageIn").onfocus = () => $("pageIn").select();

// ---------- opening a document ----------
$("choose").onclick = () => $("file").click();
$("file").onchange = async () => { const f = $("file").files[0]; if (f) await openData(new Uint8Array(await f.arrayBuffer()), f.name); };
viewer.addEventListener("dragover", (e) => { e.preventDefault(); $("panel").classList.add("drag"); });
viewer.addEventListener("dragleave", () => $("panel").classList.remove("drag"));
viewer.addEventListener("drop", async (e) => {
  e.preventDefault(); $("panel").classList.remove("drag");
  const f = [...e.dataTransfer.files].find((x) => x.type === "application/pdf" || /\.pdf$/i.test(x.name));
  if (f) await openData(new Uint8Array(await f.arrayBuffer()), f.name);
});

function showPanel(title, text, { allow = null, note = "", choose = true } = {}) {
  pagesEl.hidden = true; $("panel").hidden = false;
  $("panelTitle").textContent = title; $("panelText").textContent = text;
  $("allow").hidden = !allow; if (allow) { $("allow").textContent = allow.label; $("allow").onclick = allow.run; }
  $("choose").hidden = !choose; $("choose").className = allow ? "btn" : "btn primary";
  $("panelNote").hidden = !note; $("panelNote").textContent = note;
}

async function openUrl(url) {
  progress(0.02);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`The website answered ${r.status}`);
    const data = new Uint8Array(await r.arrayBuffer());
    await openData(data, nameFromUrl(url));
  } catch (e) {
    progress(null);
    if (url.startsWith("file:")) {
      if (IS_FIREFOX) showPanel("Choose the PDF to read it", "Firefox doesn't let add-ons open files on your computer directly. Choose the same file below and it opens right away.");
      else showPanel("Allow Phonomenal to open files on this computer",
        "Chrome asks you to allow this once. On the settings page, turn on “Allow access to file URLs”, then open the PDF again. Or simply choose the file below.",
        { allow: { label: "Open the setting", run: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }) } });
      return;
    }
    const origin = new URL(url).origin + "/*";
    if (chrome.permissions && !(await chrome.permissions.contains({ origins: [origin] }).catch(() => false))) {
      showPanel(`Allow Phonomenal to open PDFs from ${new URL(url).hostname}`, "It downloads the PDF to read it on this computer. Nothing is sent anywhere.",
        { allow: { label: "Allow and open", run: async () => { if (await chrome.permissions.request({ origins: [origin] }).catch(() => false)) openUrl(url); } } });
      $("allow").className = "btn primary";
      return;
    }
    showPanel("This PDF couldn't be opened", `${e.message || e}. Download it to your computer, then choose it below.`);
  }
}

async function openData(data, name) {
  engine.stop(); current = null; resumePos = null; $("toast").hidden = true;
  for (const p of pages) { p.task?.cancel(); io.unobserve(p.el); }
  pages.length = 0; textCache.clear(); paraCache.clear(); paraReady.clear(); pagesEl.replaceChildren();
  progress(0.05);
  try {
    const task = pdfjs.getDocument({
      data, isEvalSupported: false, enableXfa: false,
      standardFontDataUrl: chrome.runtime.getURL("vendor/pdfjs/standard_fonts/"), wasmUrl: chrome.runtime.getURL("vendor/pdfjs/wasm/"),
    });
    task.onProgress = ({ loaded, total }) => total && progress(0.05 + 0.6 * (loaded / total));
    pdf = await task.promise;
  } catch (e) {
    progress(null);
    return showPanel(e?.name === "PasswordException" ? "This PDF is password-protected" : "This file couldn't be opened as a PDF",
      e?.name === "PasswordException" ? "Open it in your browser's PDF viewer instead." : "Check that it is a PDF and try again.",
      { note: e?.name === "PasswordException" ? "" : `Details: ${e?.message || e}` });
  }
  numPages = pdf.numPages;
  docKey = "pos:" + (pdf.fingerprints?.[0] || name);
  const meta = await pdf.getMetadata().catch(() => null);
  const title = (meta?.info?.Title || "").trim() || name || "PDF";
  document.title = `${title} – Phonomenal`; $("title").textContent = title; $("title").title = title;
  $("pageCount").textContent = numPages;
  const vp = (await pdf.getPage(1)).getViewport({ scale: 1 });
  base = { w: vp.width, h: vp.height };
  zoom = Math.min(1.25, Math.max(0.5, (viewer.clientWidth - 48) / (base.w * PT)));
  $("panel").hidden = true; pagesEl.hidden = false;
  buildPages();
  ["play", "stop", "prev", "next"].forEach((id) => ($(id).disabled = id !== "play"));
  progress(null);
  chrome.runtime.sendMessage({ type: "control", action: "release" }).catch(() => {});   // free the voice used by the popup
  detectedLang = null; await detectDocLang();

  // where to start: a selection passed from the browser's viewer, or where the reader stopped last time
  const saved = (await chrome.storage.local.get(docKey))[docKey];
  if (params.get("find")) {
    const pos = await findText(params.get("find"));
    if (pos) { goToPage(pos.page, false); start(pos); return; }
    toast("Couldn't find the selected words in this PDF. Choose where to start, or press Read.");
  } else if (saved && saved.page <= numPages && (saved.page > 1 || saved.sent > 0 || saved.para > 0)) {
    resumePos = { page: saved.page, para: saved.para, sent: saved.sent };
    goToPage(saved.page, false);
    toast(`Welcome back. Press “Continue reading” to carry on from page ${saved.page}.`);
  }
  updateUI();
}

const nameFromUrl = (u) => { try { return decodeURIComponent(new URL(u).pathname.split("/").pop() || "PDF").replace(/\.pdf$/i, ""); } catch { return "PDF"; } };

// ---------- pages: placeholders, lazy rendering ----------
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const p = pages[+e.target.dataset.n - 1];
    if (!p || p.el !== e.target) continue;          // a page from a document that was closed
    p.near = e.isIntersecting;
    if (p.near) render(p); else unrender(p);
  }
}, { root: viewer, rootMargin: "1500px 0px" });

function buildPages() {
  const frag = document.createDocumentFragment();
  for (let n = 1; n <= numPages; n++) {
    const el = document.createElement("div");
    el.className = "page"; el.dataset.n = n;
    el.setAttribute("role", "region"); el.setAttribute("aria-label", `Page ${n}`);
    const p = { n, el, rendered: false, rendering: false, size: null };
    pages.push(p); sizePage(p); frag.append(el); io.observe(el);
  }
  pagesEl.append(frag);
  $("zoomVal").textContent = Math.round(zoom * 100) + "%";
}

function sizePage(p) {
  const s = zoom * PT, w = p.size?.w ?? base.w, h = p.size?.h ?? base.h;
  p.el.style.width = Math.floor(w * s) + "px"; p.el.style.height = Math.floor(h * s) + "px";
  p.el.style.setProperty("--scale-factor", s);
}

async function render(p) {
  if (p.rendered || p.rendering) return;
  p.rendering = true;
  const z = zoom;
  try {
    const page = await pdf.getPage(p.n);
    const vp = page.getViewport({ scale: z * PT });
    p.size = { w: vp.width / (z * PT), h: vp.height / (z * PT) }; sizePage(p);
    const canvas = document.createElement("canvas");
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    p.task = page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    await p.task.promise;
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const tl = new pdfjs.TextLayer({ textContentSource: await getText(p.n), container: layer, viewport: vp });
    await tl.render();
    if (!p.near || z !== zoom) { p.rendering = false; return; }
    p.divs = tl.textDivs; p.spanIdx = new Map(p.divs.map((d, i) => [d, i]));
    p.el.replaceChildren(canvas, layer);
    p.rendered = true;
    if (current?.parts.some((x) => x.page === p.n)) { applyHighlight(); if (following()) scrollToCurrent(); }
  } catch (e) {
    if (e?.name !== "RenderingCancelledException") console.warn("page", p.n, e);
  }
  p.rendering = false;
}

function unrender(p) {
  p.task?.cancel(); p.task = null;
  if (p.rendered) { p.el.replaceChildren(); p.rendered = false; p.divs = null; p.spanIdx = null; }
}

function setZoom(z) {
  z = Math.min(3, Math.max(0.4, z));
  if (!pdf || Math.abs(z - zoom) < 0.001) return;
  const anchor = viewer.scrollTop / Math.max(1, viewer.scrollHeight);
  zoom = z; $("zoomVal").textContent = Math.round(zoom * 100) + "%";
  for (const p of pages) { unrender(p); sizePage(p); }
  viewer.scrollTop = anchor * viewer.scrollHeight;
  for (const p of pages) if (p.near) render(p);
}

function goToPage(n, smooth = true) {
  const p = pages[n - 1]; if (!p) return;
  autoScrollUntil = Date.now() + 800;
  viewer.scrollTo({ top: p.el.offsetTop - 12, behavior: smooth ? "smooth" : "instant" });
  currentPage = n; updateUI();
}

// the page in the upper third of the window is "the page you're on"
let scrollRaf = 0;
viewer.addEventListener("scroll", () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const y = viewer.scrollTop + viewer.clientHeight * 0.33;
    let lo = 0, hi = pages.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pages[mid].el.offsetTop <= y) lo = mid; else hi = mid - 1; }
    if (pages[lo] && pages[lo].n !== currentPage) { currentPage = pages[lo].n; updateUI(); }
    hideChip();
  });
}, { passive: true });

// ---------- text: paragraphs and the reading flow ----------
function getText(n) {
  if (!textCache.has(n)) textCache.set(n, pdf.getPage(n).then((pg) => pg.getTextContent()));
  return textCache.get(n);
}
function getParas(n) {
  if (!paraCache.has(n)) paraCache.set(n, (async () => {
    const [pg, tc] = await Promise.all([pdf.getPage(n), getText(n)]);
    const ps = pageParagraphs(tc, pg.view, { skipHeaders: S.pdfSkipHeaders, sideNotes: S.pdfSideNotes ? "read" : "skip" });
    paraReady.set(n, ps);
    return ps;
  })());
  return paraCache.get(n);
}
function resetText() { paraCache.clear(); paraReady.clear(); if (engine.state !== "idle" && current) start({ page: current.pos.page, para: 0, sent: 0 }); }

/**
 * Everything from `pos` to the end of the document, one sentence at a time. A sentence that runs onto the next page
 * is spoken in one piece, and that page's side notes wait until the paragraph it was in has finished.
 */
async function* flow(pos) {
  let carry = null, deferred = [];
  for (let page = pos.page, para = pos.para, sent = pos.sent; page <= numPages; page++, para = 0, sent = 0) {
    const ps = await getParas(page);
    const mainCount = ps.filter((x) => !x.aside).length;
    for (; para < ps.length; para++, sent = 0) {
      const P = ps[para], lastMain = !P.aside && para === mainCount - 1;
      for (; sent < P.sentences.length; sent++) {
        const r = P.sentences[sent];
        let u = { text: P.text.slice(r.start, r.end), parts: [{ page, para, start: r.start, end: r.end }], pos: { page, para, sent } };
        if (carry) { u = { text: carry.text + " " + u.text, parts: [...carry.parts, ...u.parts], pos: carry.pos }; carry = null; }
        if (lastMain && sent === P.sentences.length - 1 && page < numPages && !END_PUNCT.test(u.text)) {
          const nextFirst = (await getParas(page + 1)).find((x) => !x.aside);
          if (nextFirst && /^[a-z(,;]/.test(nextFirst.text)) { carry = u; continue; }
        }
        const endOfPara = sent === P.sentences.length - 1;
        yield { ...u, pause: endOfPara ? (P.heading ? 0.55 : 0.4) : 0.15 };
      }
      if (carry && lastMain) { deferred = ps.slice(para + 1).map((x, i) => ({ page, para: para + 1 + i, P: x })); break; }
      if (deferred.length) {
        for (const d of deferred) for (let s = 0; s < d.P.sentences.length; s++) {
          const r = d.P.sentences[s];
          yield { text: d.P.text.slice(r.start, r.end), parts: [{ page: d.page, para: d.para, start: r.start, end: r.end }], pos: { page: d.page, para: d.para, sent: s }, pause: s === d.P.sentences.length - 1 ? 0.4 : 0.15 };
        }
        deferred = [];
      }
    }
  }
  if (carry) yield { ...carry, pause: 0.4 };
}

async function prevPos(pos) {
  let { page, para, sent } = pos;
  if (sent > 0) return { page, para, sent: sent - 1 };
  for (;;) {
    if (para > 0) { const ps = await getParas(page); para--; return { page, para, sent: ps[para].sentences.length - 1 }; }
    if (page <= 1) return { page: 1, para: 0, sent: 0 };
    page--; para = (await getParas(page)).length;
  }
}

// ---------- playback ----------
engine.onsentence = (u) => {
  current = u; userScrolledCheck();
  applyHighlight();
  if (following()) scrollToCurrent();
  savePos(u.pos);
  if ($("next").disabled) updateUI();
  report("playing");
};
// tell the extension what the reader is doing (toolbar badge shows ▶ / ❚❚ while a PDF is being read)
function report(state) {
  const highlighted = current?._ranges?.map((r) => r.toString()).join("") ?? null;
  chrome.runtime.sendMessage({ type: "reader-state", state, text: current?.text ?? null, highlighted }).catch(() => {});
}
engine.onstate = (state, info) => {
  if (state === "error") toast("Sorry, the voice couldn't start. Try reloading this page.");
  if (state === "done") { toast("Finished reading."); }
  if (state === "idle" || state === "done" || state === "error") { current = null; applyHighlight(); userScrolled = false; $("back").hidden = true; }
  updateUI(); report(state);
};
addEventListener("pagehide", () => { engine.stop(); report("idle"); });

async function start(pos) {
  hideChip();
  resumePos = null; userScrolled = false; $("back").hidden = true;
  await getParas(pos.page);
  engine.play(flow(pos), { voice: voiceFor(S, docLang), speed: S.speed, lang: docLang });
  updateUI();
}

function togglePlay() {
  if (!pdf) return;
  if (engine.state === "playing") return engine.pause();
  if (engine.state === "paused") return engine.resume();
  if (engine.state === "loading") return;
  start(resumePos && resumePos.page === currentPage ? resumePos : { page: currentPage, para: 0, sent: 0 });
}

async function skip(dir) {
  const u = current; if (!u) return;
  if (dir > 0) {
    const it = flow(u.pos); await it.next(); const nx = await it.next();
    if (!nx.done) start(nx.value.pos);
  } else start(await prevPos(u.pos));
}

function restartHere() { if (engine.state !== "idle" && current) start(current.pos); }

let saveTimer = 0;
function savePos(pos) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ [docKey]: { ...pos, t: Date.now() } }), 600);
}

function updateUI() {
  const st = engine.state, active = st !== "idle";
  $("play").classList.toggle("on", st === "playing");
  $("playLabel").textContent = st === "loading" ? "Getting ready…" : st === "playing" ? "Pause" : st === "paused" ? "Resume"
    : resumePos && resumePos.page === currentPage ? "Continue reading" : `Read from page ${currentPage}`;
  $("play").disabled = !pdf;
  $("play").setAttribute("aria-label", st === "playing" ? "Pause reading" : $("playLabel").textContent);
  $("stop").disabled = !active; $("prev").disabled = !current; $("next").disabled = !current;
  if (document.activeElement !== $("pageIn")) $("pageIn").value = pdf ? currentPage : "–";
}

// ---------- highlighting and following along ----------
const HL = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";
let fallbackMarked = [];
function applyHighlight() {
  if (HL) CSS.highlights.delete("tts");
  for (const el of fallbackMarked) el.classList.remove("tts");
  fallbackMarked = [];
  if (!current) return;
  const ranges = [];
  for (const part of current.parts) {
    const p = pages[part.page - 1], P = paraReady.get(part.page)?.[part.para];
    if (!p?.rendered || !P) continue;
    let i = part.start;
    while (i < part.end) {
      const k = P.k[i];
      if (k < 0) { i++; continue; }
      let j = i;
      while (j + 1 < part.end && (P.k[j + 1] === k || P.k[j + 1] < 0)) j++;
      while (P.k[j] < 0) j--;
      const span = p.divs?.[k], node = span?.firstChild;
      if (node) {
        if (HL) {
          const r = new Range();
          r.setStart(node, Math.min(P.o[i], node.length)); r.setEnd(node, Math.min(P.o[j] + 1, node.length));
          ranges.push(r);
        } else { span.classList.add("tts"); fallbackMarked.push(span); }
      }
      i = j + 1;
    }
  }
  if (HL && ranges.length) CSS.highlights.set("tts", new Highlight(...ranges));
  current._ranges = ranges;
}

const following = () => S.pdfFollow && !userScrolled && engine.state !== "idle";
function scrollToCurrent() {
  if (!current) return;
  const first = current.parts[0];
  const r = current._ranges?.[0]?.getBoundingClientRect() ?? fallbackMarked[0]?.getBoundingClientRect();
  const vr = viewer.getBoundingClientRect();
  autoScrollUntil = Date.now() + 900;
  if (!r) { const p = pages[first.page - 1]; if (p && !p.rendered) viewer.scrollTo({ top: p.el.offsetTop - 12, behavior: "instant" }); return; }
  if (r.top < vr.top + 70 || r.bottom > vr.bottom - 120) {
    viewer.scrollBy({ top: r.top - (vr.top + vr.height * 0.3), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
}

// the reader stops following if you scroll away yourself, and offers a way back
for (const ev of ["wheel", "touchmove"]) viewer.addEventListener(ev, () => userScrolledCheck(true), { passive: true });
viewer.addEventListener("keydown", (e) => { if (["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) userScrolledCheck(true); });
viewer.addEventListener("pointerdown", (e) => { if (e.target === viewer) userScrolledCheck(true); });   // scrollbar drag
function userScrolledCheck(byUser = false) {
  if (!byUser || Date.now() < autoScrollUntil || engine.state === "idle" || !S.pdfFollow) return;
  userScrolled = true; $("back").hidden = false;
}
function backToReading() { userScrolled = false; $("back").hidden = true; if (current) { const p = pages[current.parts[0].page - 1]; if (!p.rendered) goToPage(p.n, false); scrollToCurrent(); } }

// ---------- click or select to read from there ----------
viewer.addEventListener("pointerup", async (e) => {
  if (e.button !== 0 || !e.target.closest?.(".textLayer")) return;
  await new Promise((r) => setTimeout(r, 0));
  const sel = getSelection();
  let node, off;
  if (sel && !sel.isCollapsed && sel.rangeCount) ({ startContainer: node, startOffset: off } = sel.getRangeAt(0));
  else ({ node, off } = caretAt(e.clientX, e.clientY));
  const pos = await posFromNode(node, off);
  if (!pos) return hideChip();
  if (sel?.isCollapsed && engine.state === "playing") return start(pos);   // while reading, a click jumps straight there
  showChip(pos, e.clientX, e.clientY);
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.("#chip")) hideChip(); });

function caretAt(x, y) {
  if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); return { node: c?.offsetNode, off: c?.offset ?? 0 }; }
  const r = document.caretRangeFromPoint?.(x, y); return { node: r?.startContainer, off: r?.startOffset ?? 0 };
}

async function posFromNode(node, off) {
  if (!node) return null;
  const span = node.nodeType === 3 ? node.parentElement : node;
  const pageEl = span?.closest?.(".page"); if (!pageEl) return null;
  const p = pages[+pageEl.dataset.n - 1], k = p.spanIdx?.get(span);
  if (k === undefined) return null;
  const ps = await getParas(p.n);
  for (let pi = 0; pi < ps.length; pi++) {
    const P = ps[pi];
    let ci = -1;
    for (let i = 0; i < P.k.length; i++) if (P.k[i] === k) { ci = i; if (P.o[i] >= off) break; }
    if (ci < 0) continue;
    const si = Math.max(0, P.sentences.findIndex((s) => ci < s.end));
    return { page: p.n, para: pi, sent: si };
  }
  return null;   // e.g. a page header, which is not read
}

function showChip(pos, x, y) {
  chipPos = pos;
  const c = $("chip"); c.hidden = false;
  const w = c.offsetWidth;
  c.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + "px";
  c.style.top = Math.min(innerHeight - 52, y + 14) + "px";
}
function hideChip() { $("chip").hidden = true; chipPos = null; }

// ---------- finding a selection passed from the browser's own viewer ----------
async function findText(q) {
  const want = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
  if (want.length < 2) return null;
  for (let n = 1; n <= numPages; n++) {
    if (n % 20 === 0) progress(n / numPages);
    const ps = await getParas(n);
    for (let pi = 0; pi < ps.length; pi++) {
      const toks = [...ps[pi].text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)];
      for (let i = 0; i + want.length <= toks.length; i++) {
        if (want.every((w, j) => toks[i + j][0] === w)) {
          progress(null);
          const ci = toks[i].index, si = Math.max(0, ps[pi].sentences.findIndex((s) => ci < s.end));
          return { page: n, para: pi, sent: si };
        }
      }
    }
  }
  progress(null);
  return null;
}

// ---------- keyboard ----------
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input, select, textarea");
  if (e.key === "Escape") { if (!$("menu").hidden) toggleMenu(false); else if (!$("chip").hidden) hideChip(); else engine.stop(); return; }
  if (typing) return;
  if (e.key === " " && !e.target.closest?.("button")) { e.preventDefault(); togglePlay(); }
  if (e.shiftKey && e.key === "ArrowRight") { e.preventDefault(); skip(1); }
  if (e.shiftKey && e.key === "ArrowLeft") { e.preventDefault(); skip(-1); }
});

// ---------- small helpers ----------
let toastTimer = 0;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 6000); }
function progress(f) { const el = $("progress"); el.hidden = f === null; if (f !== null) el.firstElementChild.style.transform = `scaleX(${Math.min(1, Math.max(0, f)).toFixed(3)})`; }

// test/diagnostic hook
globalThis.__reader = { engine, flow, getParas, start, pages: () => pages, current: () => current, state: () => engine.state, find: findText };

updateUI();
if (params.get("file")) openUrl(params.get("file"));
else showPanel("Open a PDF to read aloud", "Drop a PDF file here, or choose one from your computer.");
