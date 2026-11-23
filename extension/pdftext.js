// Turns one PDF.js page's text into readable paragraphs and sentences, in reading order:
// drops running headers/footers and page numbers, rejoins hyphenated line breaks, keeps lists and headings as
// their own paragraphs, and moves narrow margin notes (sidebars, glossary boxes) to the end of the page.
// Every spoken character keeps a pointer to the text-layer span it came from, so the reader can highlight it.

const BULLET = /^[•▪◦●■□➢►▸‣∙·*–-]$/;
const LIST_MARK = /^(\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])$/;
const END_PUNCT = /[.!?:;”"’)]$/;
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "sentence" }) : null;

/**
 * @param {{items: any[]}} textContent  from page.getTextContent()
 * @param {number[]} view                page.view, [x0, y0, x1, y1] in PDF units
 * @param {{skipHeaders?: boolean, sideNotes?: "read"|"skip"}} opts
 * @returns {{text: string, k: Int32Array, o: Int32Array, aside: boolean, heading: boolean, sentences: {start:number,end:number}[]}[]}
 *   k[i]/o[i]: text-layer span index and offset inside it for character i (-1 for inserted spaces)
 */
export function pageParagraphs(textContent, view, opts = {}) {
  const { skipHeaders = true, sideNotes = "read" } = opts;
  // 1. items, indexed like PDF.js TextLayer's spans (every item that has a .str gets a span)
  const items = [];
  let k = 0;
  for (const it of textContent.items) {
    if (it.str === undefined) continue;
    const t = it.transform, fs = Math.hypot(t[2], t[3]) || it.height || 10;
    items.push({ k: k++, str: it.str, x: t[4], y: t[5], w: it.width, fs, eol: it.hasEOL });
  }

  // 2. lines: consecutive items on the same baseline, moving left to right
  const lines = [];
  let line = null;
  for (const it of items) {
    const blank = !it.str.trim();
    if (blank && !line) continue;
    if (!blank && (!line || line.brk || Math.abs(it.y - line.y) > 0.4 * Math.max(it.fs, line.fs) || it.x < line.x1 - 1.5 * it.fs)) {
      line = { y: it.y, x0: it.x, x1: it.x + it.w, fs: it.fs, parts: [], brk: false };
      lines.push(line);
    }
    if (!line) continue;
    if (!blank) {
      const prev = line.parts[line.parts.length - 1];
      if (prev && !prev.space && /\S$/.test(prev.it.str) && it.x - line.x1 > 0.15 * it.fs) line.parts.push({ space: true });
      line.parts.push({ it });
      line.x1 = Math.max(line.x1, it.x + it.w); line.fs = Math.max(line.fs, it.fs);
    } else if (line.parts.length && !line.parts[line.parts.length - 1].space) line.parts.push({ it, space: true });
    if (it.eol) line.brk = true;
  }
  for (const l of lines) {
    while (l.parts.length && l.parts[l.parts.length - 1].space) l.parts.pop();
    l.text = l.parts.map((p) => (p.it ? p.it.str : " ")).join("").trim();
  }

  // 3. running headers, footers and page numbers
  const [, vy0, , vy1] = view, ph = vy1 - vy0;
  const body = lines.filter((l) => {
    if (!l.text) return false;
    if (!skipHeaders) return true;
    const top = l.y > vy1 - 0.07 * ph, bottom = l.y < vy0 + 0.06 * ph;
    if ((top || bottom) && l.text.length < 140) return false;
    if ((l.y > vy1 - 0.12 * ph || l.y < vy0 + 0.1 * ph) && /^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l.text)) return false;
    return true;
  });

  // 4. blocks: runs of lines stacked closely in the same column
  const blocks = [];
  let b = null;
  for (const l of body) {
    const gap = b ? b.last.y - l.y : 0;
    const overlaps = b && l.x0 < b.x1 && l.x1 > b.x0;
    if (!b || !overlaps || gap < -0.5 * l.fs || gap > 2.2 * Math.max(l.fs, b.last.fs)) {
      b = { lines: [], x0: l.x0, x1: l.x1, chars: 0 };
      blocks.push(b);
    }
    b.lines.push(l); b.last = l; b.chars += l.text.length;
    b.x0 = Math.min(b.x0, l.x0); b.x1 = Math.max(b.x1, l.x1);
  }

  // 5. side notes: blocks much narrower than the main text and outside its column
  const main = blocks.reduce((m, x) => (x.chars > (m?.chars ?? -1) ? x : m), null);
  for (const x of blocks) {
    const w = x.x1 - x.x0, mw = main ? main.x1 - main.x0 : w;
    x.aside = !!main && x !== main && w < 0.6 * mw && (x.x1 <= main.x0 + 2 || x.x0 >= main.x1 - 2);
  }
  const ordered = [...blocks.filter((x) => !x.aside), ...(sideNotes === "skip" ? [] : blocks.filter((x) => x.aside))];

  // 6. paragraphs inside each block, with a character map back to the spans
  const paras = [];
  for (const blk of ordered) {
    const bodyFs = median(blk.lines.map((l) => l.fs));
    let p = null, itemLine = false;
    blk.lines.forEach((l, i) => {
      const prev = blk.lines[i - 1];
      const first = l.parts.find((x) => x.it)?.it.str.trim() ?? "";
      const startsItem = BULLET.test(first) || LIST_MARK.test(first);
      const heading = l.fs > bodyFs * 1.18;
      const newPara = !p || startsItem || heading !== p.heading ||
        // a short line ending a sentence, or a first-line indent (but not a list item's hanging indent)
        (prev && END_PUNCT.test(prev.text) && (prev.x1 < blk.x1 - 4 * l.fs || (!itemLine && l.x0 > prev.x0 + 0.8 * l.fs))) ||
        (prev && prev.y - l.y > 1.75 * l.fs);
      if (newPara) { p = { chars: [], heading, aside: blk.aside }; paras.push(p); itemLine = startsItem; }
      else {
        const last = p.chars[p.chars.length - 1];
        // "decom-" + "pensated" -> "decompensated"
        if (last && last.c === "-" && /[a-z]-$/i.test(prev.text) && /^[a-z]/.test(l.text)) p.chars.pop();
        else p.chars.push({ c: " ", k: -1, o: -1 });
      }
      for (const part of l.parts) {
        if (!part.it) { p.chars.push({ c: " ", k: -1, o: -1 }); continue; }
        const s = part.it.str;
        for (let j = 0; j < s.length; j++) p.chars.push({ c: s[j], k: part.it.k, o: j });
      }
    });
  }

  return paras.map((p) => {
    // drop a leading bullet symbol (it is not spoken) and tidy whitespace
    let cs = p.chars;
    const firstReal = cs.findIndex((c) => c.c.trim());
    if (firstReal >= 0 && BULLET.test(cs[firstReal].c) && cs[firstReal].c !== "-") cs = cs.slice(firstReal + 1);
    cs = collapseSpaces(cs);
    const text = cs.map((c) => c.c).join("");
    return { text, k: Int32Array.from(cs, (c) => c.k), o: Int32Array.from(cs, (c) => c.o), aside: p.aside, heading: p.heading, sentences: sentences(text) };
  }).filter((p) => /[\p{L}\p{N}]/u.test(p.text));
}

function collapseSpaces(cs) {
  const out = [];
  for (const c of cs) {
    const space = !c.c.trim();
    if (space && (!out.length || !out[out.length - 1].c.trim())) continue;
    out.push(space ? { c: " ", k: c.k, o: c.o } : c);
  }
  while (out.length && !out[out.length - 1].c.trim()) out.pop();
  return out;
}

const ABBREV = /\b(e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|St|Fig|No|approx|cf|al)\.$/i;

/** Sentence ranges within a paragraph; merges splits after common abbreviations and caps very long ones. */
export function sentences(text) {
  let raw = [];
  if (segmenter) for (const s of segmenter.segment(text)) raw.push({ start: s.index, end: s.index + s.segment.length });
  else raw = [{ start: 0, end: text.length }];
  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    const prevText = prev ? text.slice(prev.start, prev.end).trim() : "";
    // keep "e.g." / "Dr." / list markers like "1." or "a." with the words that follow them
    if (prev && (ABBREV.test(prevText) || /^\(?[\da-zA-Z]{1,3}[.)]$/.test(prevText) || text.slice(s.start, s.end).trim().length < 3)) prev.end = s.end;
    else merged.push({ ...s });
  }
  const out = [];
  for (const s of merged) {   // very long sentences (tables, run-ons): split at ; or , so highlighting keeps moving
    let { start } = s;
    while (s.end - start > 320) {
      const cut = Math.max(text.lastIndexOf("; ", start + 300), text.lastIndexOf(", ", start + 300));
      if (cut <= start + 80) break;
      out.push({ start, end: cut + 1 }); start = cut + 2;
    }
    out.push({ start, end: s.end });
  }
  return out.map((s) => {   // trim spaces at the edges
    while (s.start < s.end && !text[s.start].trim()) s.start++;
    while (s.end > s.start && !text[s.end - 1].trim()) s.end--;
    return s;
  }).filter((s) => s.end > s.start);
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 10; }
