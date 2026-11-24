// Reading a web page onward from a chosen spot, like the PDF reader: works out the article text from there to the
// end (skipping menus, sidebars, citation marks and the reference list), highlights the sentence being spoken,
// keeps it in view, and while reading lets you click a sentence, or select words and press "Read from here", to
// jump. Injected into the page you asked to read (activeTab); it never runs anywhere else.
(() => {
  if (window.__phonPage) return;

  const SKIP = "script,style,noscript,template,textarea,input,select,option,button,svg,math,canvas,video,audio,iframe,object,embed," +
    "nav,aside,footer,table,figure,[role=navigation],[role=complementary],[role=contentinfo],[role=search],[role=note],[aria-hidden=true],[hidden]," +
    // common page furniture that isn't marked up as such (Wikipedia and other MediaWiki sites, plus generic names)
    ".noprint,.hatnote,.navbox,.metadata,.ambox,.sistersitebox,.side-box,.mw-editsection,.reference,.reflist,.mw-references-wrap," +
    ".catlinks,.printfooter,.mw-jump-link,.shortdescription,.sr-only,.visually-hidden,.screen-reader-text";
  const PAGE_HEADER = "header,[role=banner]";
  const ROOT = "main,[role=main],article";
  const END_HEADINGS = /^(references|notes|citations|sources|footnotes|bibliography|external links|further reading|see also|related articles|comments)$/i;
  const MAX_CHARS = 250000;
  const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "sentence" }) : null;
  const ABBREV = /\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St|Fig|No|approx|cf|al)\.$/i;
  const HL = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";

  let run = null, items = [], active = false, playing = false, lastUserScroll = 0, autoScrollUntil = 0, chip = null;

  // ---------- what to read ----------
  const styleCache = new WeakMap();
  function styleOf(el) {
    let s = styleCache.get(el);
    if (!s) { const cs = getComputedStyle(el); s = { display: cs.display, hidden: cs.display === "none" || cs.visibility === "hidden" }; styleCache.set(el, s); }
    return s;
  }
  const isBlock = (el) => { const d = styleOf(el).display; return !d.startsWith("inline") && d !== "contents"; };
  const blockOf = (node) => { let el = node.parentElement; while (el && el !== document.body && !isBlock(el)) el = el.parentElement; return el || document.body; };
  // the heading a piece of text belongs to, if any (headings can be inline inside a wrapper, as on Wikipedia)
  const headingOf = (node, block) => {
    const h = node.parentElement?.closest("h1,h2,h3,h4,h5,h6,[role=heading]");
    return h && (block.contains(h) || h.contains(block)) ? h : null;
  };
  const bracketed = (el) => el.childElementCount < 6 && /^\[[^[\]]{1,30}\]$/.test((el.textContent || "").trim());   // [1], [edit], [citation needed]

  function walker(root, keep) {
    return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;    // spaces between links matter ("7 million")
        if (n.tagName === "BR") return NodeFilter.FILTER_ACCEPT;
        if (n.contains(keep)) return NodeFilter.FILTER_SKIP;      // whatever you started in is always read
        if (n.matches(SKIP) || styleOf(n).hidden || bracketed(n) || n.id === "phonomenal-chip") return NodeFilter.FILTER_REJECT;
        if (n.matches(PAGE_HEADER) && !n.closest(ROOT)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      },
    });
  }

  /** Blocks of text from (node, offset) to the end of the article, or to `until` (a collapsed Range): [{el, text, nodes, ni, off}] */
  function collect(node, offset, until = null) {
    if (node.nodeType !== 3) {            // an element position: start at the first text inside or after it
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      tw.currentNode = node.childNodes[offset] || node;
      let t = tw.currentNode.nodeType === 3 ? tw.currentNode : tw.nextNode();
      while (t && !t.data.trim()) t = tw.nextNode();
      if (!t) return [];
      node = t; offset = 0;
    }
    const root = node.parentElement?.closest(ROOT) || document.body;
    const tw = walker(root, node);
    tw.currentNode = node;
    const blocks = [];
    let cur = null, total = 0;
    const finish = () => {
      if (!cur) return;
      while (cur.text.endsWith(" ")) { cur.text = cur.text.slice(0, -1); cur.ni.pop(); cur.off.pop(); }
      if (cur.text) blocks.push(cur);
      total += cur.text.length; cur = null;
    };
    for (let n = node, first = true; n; n = tw.nextNode(), first = false) {
      if (n.nodeType === 1) { if (cur && !cur.text.endsWith(" ")) { cur.text += " "; cur.ni.push(cur.nodes.length - 1); cur.off.push(0); } continue; }
      if (until && until.comparePoint(n, 0) > 0) break;                     // past the end of the selection
      const lim = until && n === until.startContainer ? until.startOffset : n.data.length;
      const el = blockOf(n);
      if (!n.data.trim()) {                   // only spaces: a word gap inside the current block, never a block of its own
        if (cur?.el === el && cur.text && !cur.text.endsWith(" ")) { cur.nodes.push(n); cur.text += " "; cur.ni.push(cur.nodes.length - 1); cur.off.push(0); }
        continue;
      }
      if (!cur || cur.el !== el) {
        finish();
        if (total > MAX_CHARS) break;
        const h = headingOf(n, el);
        if (!first && h && END_HEADINGS.test(h.textContent.replace(/\[[^\]]*\]/g, "").trim())) break;
        cur = { el, text: "", nodes: [], ni: [], off: [], heading: !!h };
      }
      cur.nodes.push(n);
      const k = cur.nodes.length - 1, s = n.data;
      for (let i = first ? offset : 0; i < lim; i++) {
        const ws = /\s/.test(s[i]);
        if (ws && (!cur.text || cur.text.endsWith(" "))) continue;
        cur.text += ws ? " " : s[i]; cur.ni.push(k); cur.off.push(i);
      }
      if (until && n === until.startContainer) break;
    }
    finish();
    return blocks;
  }

  function sentences(text) {
    let raw = [];
    if (segmenter) for (const s of segmenter.segment(text)) raw.push({ start: s.index, end: s.index + s.segment.length });
    else raw = [{ start: 0, end: text.length }];
    const merged = [];
    for (const s of raw) {
      const prev = merged[merged.length - 1];
      const prevText = prev ? text.slice(prev.start, prev.end).trim() : "";
      if (prev && (ABBREV.test(prevText) || /^\(?[\da-zA-Z]{1,3}[.)]$/.test(prevText) || text.slice(s.start, s.end).trim().length < 3)) prev.end = s.end;
      else merged.push({ ...s });
    }
    const out = [];
    for (const s of merged) {
      let { start } = s;
      while (s.end - start > 320) {
        const cut = Math.max(text.lastIndexOf("; ", start + 300), text.lastIndexOf(", ", start + 300));
        if (cut <= start + 80) break;
        out.push({ start, end: cut + 1 }); start = cut + 2;
      }
      out.push({ start, end: s.end });
    }
    return out.map((s) => {
      while (s.start < s.end && !text[s.start].trim()) s.start++;
      while (s.end > s.start && !text[s.end - 1].trim()) s.end--;
      return s;
    }).filter((s) => s.end > s.start && /[\p{L}\p{N}]/u.test(text.slice(s.start, s.end)));
  }

  /** Utterances from a spot in the page (to `until`, or the end of the article).
   *  wholeSentence: start at the beginning of the sentence containing the spot. */
  function plan(node, offset, wholeSentence, until = null) {
    let blocks = collect(node, offset, until);
    if (wholeSentence && node.nodeType === 3 && blocks.length) {   // re-collect from the start of the clicked sentence
      const all = collect(blocks[0].el, 0), full = all[0];
      if (full && full.el === blocks[0].el) {
        const at = full.ni.findIndex((k, i) => full.nodes[k] === node && full.off[i] >= offset);
        const s = at >= 0 && sentences(full.text).find((x) => at < x.end);
        if (s) { full.from = s.start; blocks = all; }
      }
    }
    const out = [];
    for (const b of blocks) {
      for (const s of sentences(b.text)) {
        if (b.from != null && s.end <= b.from) continue;
        out.push({ b, start: s.start, end: s.end, text: b.text.slice(s.start, s.end), pause: 0.12 });
      }
      if (out.length) out[out.length - 1].pause = b.heading ? 0.5 : 0.4;
    }
    return out;
  }

  // ---------- highlighting and following ----------
  function ensureStyle() {
    if (!HL || document.getElementById("phonomenal-hl-style")) return;
    const st = document.createElement("style");
    st.id = "phonomenal-hl-style";
    st.textContent = "::highlight(phonomenal){background-color:rgb(255 204 0 / .45)}";
    (document.head || document.documentElement).appendChild(st);
  }
  function rangeOf(it) {
    const { b, start, end } = it;
    if (!b.nodes[b.ni[start]]?.isConnected) return null;
    const r = document.createRange();
    try { r.setStart(b.nodes[b.ni[start]], b.off[start]); r.setEnd(b.nodes[b.ni[end - 1]], b.off[end - 1] + 1); } catch { return null; }
    return r;
  }
  function clearHighlight() { if (HL) CSS.highlights.delete("phonomenal"); }
  function highlight(index) {
    const it = items[index];
    if (!it) return;
    const r = rangeOf(it);
    if (!r) return;
    if (HL) { ensureStyle(); CSS.highlights.set("phonomenal", new Highlight(r)); }
    if (Date.now() - lastUserScroll < 4000) return;          // you're looking elsewhere: don't pull the page back
    const rect = r.getBoundingClientRect();
    if (rect.top < 70 || rect.bottom > innerHeight - 110) {
      autoScrollUntil = Date.now() + 1200;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      (it.b.el === document.body ? r.startContainer.parentElement : it.b.el)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
  }
  for (const ev of ["wheel", "touchmove"]) addEventListener(ev, () => { if (Date.now() > autoScrollUntil) lastUserScroll = Date.now(); }, { passive: true, capture: true });
  addEventListener("keydown", (e) => { if (/^(PageUp|PageDown|ArrowUp|ArrowDown|Home|End| )$/.test(e.key)) lastUserScroll = Date.now(); }, true);

  // ---------- starting ----------
  // Two modes. "selection": read just what you selected, then offer "Continue reading" (nothing reads on
  // unless you ask). "continuous": read on to the end of the article; a click on a sentence jumps there.
  let mode = "selection", contPoint = null;
  function begin(its, m, cont = null) {
    if (!its.length) return null;
    items = its; mode = m; contPoint = cont;
    run = Math.random().toString(36).slice(2);          // unique across frames
    active = true; hideChip(); clearHighlight();
    return { run, items: items.map(({ text, pause }) => ({ text, pause })) };
  }
  const start = (node, offset, wholeSentence) => begin(plan(node, offset, wholeSentence), "continuous");
  function fromSelection(onward = false) {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) return null;
    const r = sel.getRangeAt(0);
    let node = r.startContainer, offset = r.startOffset;
    if (node.nodeType === 3) { while (offset > 0 && /\S/.test(node.data[offset - 1])) offset--; }   // whole first word
    if (onward) return start(node, offset, false);
    let en = r.endContainer, eo = r.endOffset;
    if (en.nodeType === 3) { while (eo > 0 && eo < en.data.length && /\S/.test(en.data[eo - 1]) && /\S/.test(en.data[eo])) eo++; }   // whole last word
    const until = document.createRange(); until.setStart(en, eo); until.collapse(true);
    return begin(plan(node, offset, false, until), "selection", { node: en, offset: eo });
  }
  function jump(res) { if (res) chrome.runtime.sendMessage({ type: "control", action: "read-seq", ...res }).catch(() => {}); }

  // after reading a selection: a small "Continue reading" button right where it stopped
  function offerContinue() {
    const last = items.length && rangeOf(items[items.length - 1]);
    if (!last || !contPoint?.node?.isConnected) return;
    const rest = plan(contPoint.node, contPoint.offset, false);
    if (!rest.length) return;                            // that was the end of the article
    showChip(last, "Continue reading", () => jump(begin(rest, "continuous")));
  }

  // ---------- reading on: click a sentence to jump, or select words and press "Read from here" ----------
  const INTERACTIVE = "a[href],button,input,select,textarea,label,summary,video,audio,[contenteditable=''],[contenteditable=true],[role=button],[role=link],[role=tab],[role=menuitem],[onclick]";
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node: p.offsetNode, offset: p.offset }; }
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r && { node: r.startContainer, offset: r.startOffset }; }
    return null;
  }
  addEventListener("pointerdown", (e) => { if (chip && e.target !== chip) hideChip(); }, true);   // a click elsewhere dismisses it
  addEventListener("pointerup", (e) => {
    if (!active || mode !== "continuous" || e.button !== 0 || /^phonomenal-/.test(e.target?.id || "")) return;   // our pill and chip
    setTimeout(() => {
      const sel = getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        return showChip(sel.getRangeAt(0), "Read from here", () => { jump(fromSelection(true)); getSelection()?.removeAllRanges(); });
      }
      if (!playing || e.target.closest?.(INTERACTIVE) || e.target.closest?.(SKIP)) return;
      const c = caretAt(e.clientX, e.clientY);
      if (c?.node?.nodeType === 3 && c.node.data.trim()) jump(start(c.node, c.offset, true));
    }, 0);
  }, true);

  // A small button just below the end of `range`. It sits in the page (absolute), so it scrolls with the text.
  function showChip(range, label, onClick) {
    hideChip();
    const rect = [...range.getClientRects()].pop() || range.getBoundingClientRect();
    const host = document.createElement("div");
    host.id = "phonomenal-chip";
    const left = Math.min(Math.max(8, rect.right - 80), document.documentElement.clientWidth - 220) + scrollX;
    host.style.cssText = `all:initial;position:absolute;z-index:2147483647;left:${left}px;top:${rect.bottom + scrollY + 8}px;`;
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>button{font:700 16px/1 system-ui,-apple-system,"Segoe UI",sans-serif;display:inline-flex;align-items:center;gap:8px;min-height:44px;
      padding:0 18px 0 14px;border:0;border-radius:999px;background:#2f5d8a;color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
      button:hover{background:#264d73} button:focus-visible{outline:3px solid #1d2733;outline-offset:2px} svg{width:18px;height:18px;fill:currentColor}
      @media (prefers-reduced-motion:no-preference){button{animation:in .16s ease-out}} @keyframes in{from{opacity:0;transform:translateY(-4px)}}</style>
      <button type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>`;
    const btn = root.querySelector("button");
    btn.append(label);
    btn.onclick = () => { hideChip(); onClick(); };
    document.documentElement.appendChild(host);
    chip = host;
  }
  function hideChip() { chip?.remove(); chip = null; }
  addEventListener("keydown", (e) => { if (e.key === "Escape") hideChip(); }, true);

  // ---------- messages from the background ----------
  chrome.runtime.onMessage.addListener((m, _sender, reply) => {
    if (m?.type === "phonomenal-read-selection") {
      const res = fromSelection();
      if (res) getSelection()?.removeAllRanges();      // so the reading highlight isn't hidden under the selection
      reply(res); return;
    }
    if (m?.type === "read-aloud-sentence" && m.run === run) highlight(m.index);
    if (m?.type === "read-aloud-state") {
      playing = m.state === "speaking";
      if (["done", "stopped", "error"].includes(m.state)) {
        const offer = m.state === "done" && m.run === run && mode === "selection";
        active = false; playing = false; clearHighlight(); hideChip();
        if (offer) offerContinue();
      }
      else if (m.run != null && m.run !== run) { active = false; clearHighlight(); }     // another tab or text took over
    }
  });

  window.__phonPage = { fromSelection, plan, items: () => items, run: () => run, active: () => active, mode: () => mode };   // used by tests
})();
