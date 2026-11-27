// The speech player: owns the Phonon model and the audio output, and streams speech as it is generated.
// Chrome runs it in an offscreen document (offscreen.js); Firefox runs it in the background page itself.
import { PhononTTS } from "./vendor/phonon-tts/index.js";
import { SPEEDS, modelSpec, langOf } from "./voices.js";

const AHEAD_S = 6;   // seconds of audio kept ready ahead when reading a page sentence by sentence
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createPlayer(report) {
  let tts = null, ttsKey = null, loading = null;
  let seq = 0, current = null;
  const stats = { loads: [] };

  // One model instance at a time, loaded for one language (which picks how numbers, dates and symbols are read)
  // and one pacing. Switching either reloads it, which takes about half a second.
  async function getTTS(speedId, langId) {
    const delta = (SPEEDS.find((s) => s.id === speedId) || SPEEDS[1]).delta;
    const lang = langOf(langId), key = `${lang}|${delta}`;
    if (tts && ttsKey === key) return tts;
    if (loading && loading.key === key) return loading.promise;
    const t0 = performance.now();
    const promise = (async () => {
      if (tts) { tts.dispose(); tts = null; }
      const t = await PhononTTS.load({
        lang, model: modelSpec(), quant: "q8", cache: false, device: "cpu", threads: "auto",
        conditions: { duration_delta: delta },
      });
      tts = t; ttsKey = key;
      stats.loads.push({ lang, ms: Math.round(performance.now() - t0), threads: t.threads, threadsReason: t.threadsReason, device: t.device, isolated: self.crossOriginIsolated });
      return t;
    })();
    loading = { key, promise };
    try { return await promise; } finally { if (loading?.promise === promise) loading = null; }
  }

  function stop(reason = "stopped") {
    seq++;
    if (!current) return;
    current.ac.abort(); clearInterval(current.tick);
    current.ctx.close().catch(() => {});
    current = null;
    report(reason);
  }

  async function speak({ text, voice, speed, lang }) {
    stop("replaced");
    const id = ++seq;
    const t0 = performance.now();
    report("loading");
    let t;
    try { t = await getTTS(speed, lang); }
    catch (e) { if (id === seq) report("error", { error: String(e?.message || e), phase: "load" }); return; }
    if (id !== seq) return;

    const ctx = new AudioContext({ sampleRate: t.sampleRate, latencyHint: "playback" });
    const ac = new AbortController();
    current = { ac, ctx, id };
    let at = ctx.currentTime + 0.05, first = true, samples = 0, chunks = 0;
    try {
      const stream = t.stream(text, { voice: t.voices.includes(voice) ? voice : "default", signal: ac.signal });
      for await (const pcm of stream) {
        if (id !== seq) break;
        const buf = ctx.createBuffer(1, pcm.length, t.sampleRate);
        buf.getChannelData(0).set(pcm);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination);
        at = Math.max(at, ctx.currentTime);
        src.start(at); at += buf.duration;
        samples += pcm.length; chunks++;
        if (first) { first = false; report("speaking", { firstAudioMs: Math.round(performance.now() - t0) }); }
      }
    } catch (e) {
      if (id === seq && e?.name !== "AbortError") { report("error", { error: String(e?.message || e), phase: "speak" }); stop("error"); }
      return;
    }
    if (id !== seq) return;
    // Wait for the queued audio to finish playing (works while paused, too).
    while (id === seq && ctx.state !== "closed" && ctx.currentTime < at) await new Promise((r) => setTimeout(r, 100));
    if (id !== seq) return;
    current = null; ctx.close().catch(() => {});
    report("done", { audioSeconds: +(samples / t.sampleRate).toFixed(2), chunks, totalMs: Math.round(performance.now() - t0) });
  }

  // A page read sentence by sentence: synthesizes a few seconds ahead of what you hear and reports
  // report("sentence", {index}) as each one starts being heard, so the page can highlight it.
  async function speakSeq({ items, voice, speed, lang }) {
    stop("replaced");
    const id = ++seq;
    const t0 = performance.now();
    report("loading");
    let t;
    try { t = await getTTS(speed, lang); }
    catch (e) { if (id === seq) report("error", { error: String(e?.message || e), phase: "load" }); return; }
    if (id !== seq) return;

    const ctx = new AudioContext({ sampleRate: t.sampleRate, latencyHint: "playback" });
    const ac = new AbortController();
    const timeline = [];
    let heard = -1;
    const tick = setInterval(() => {
      const now = ctx.currentTime;
      for (let k = timeline.length - 1; k >= 0; k--) {
        if (timeline[k].start <= now + 0.02) { if (timeline[k].i > heard) { heard = timeline[k].i; report("sentence", { index: heard }); } break; }
      }
    }, 60);
    current = { ac, ctx, id, tick };
    const v = t.voices.includes(voice) ? voice : "default";
    let at = ctx.currentTime + 0.05, first = true;
    try {
      for (let i = 0; i < items.length; i++) {
        while (id === seq && at - ctx.currentTime > AHEAD_S) await sleep(80);   // also holds while paused
        if (id !== seq) return;
        let start = null;
        for await (const pcm of t.stream(items[i].text, { voice: v, signal: ac.signal })) {
          if (id !== seq) return;
          const buf = ctx.createBuffer(1, pcm.length, t.sampleRate);
          buf.getChannelData(0).set(pcm);
          const src = ctx.createBufferSource();
          src.buffer = buf; src.connect(ctx.destination);
          at = Math.max(at, ctx.currentTime + 0.02);
          start ??= at;
          src.start(at); at += buf.duration;
          if (first) { first = false; report("speaking", { firstAudioMs: Math.round(performance.now() - t0) }); }
        }
        if (start !== null) timeline.push({ i, start });
        at += items[i].pause ?? 0.12;
      }
    } catch (e) {
      if (id === seq && e?.name !== "AbortError") { report("error", { error: String(e?.message || e), phase: "speak" }); stop("error"); }
      return;
    }
    while (id === seq && ctx.state !== "closed" && ctx.currentTime < at) await sleep(100);
    if (id !== seq) return;
    clearInterval(tick); current = null; ctx.close().catch(() => {});
    report("done", { sentences: items.length, totalMs: Math.round(performance.now() - t0) });
  }

  // Returns a value only for "stats"; everything else reports progress through report().
  return function handle(msg) {
    switch (msg.type) {
      case "speak": speak(msg); break;
      case "speak-seq": speakSeq(msg); break;
      case "stop": stop(); break;
      case "pause": if (current) current.ctx.suspend().then(() => report("paused")); break;
      case "resume": if (current) current.ctx.resume().then(() => report("speaking")); break;
      case "warm": getTTS(msg.speed, msg.lang).then(() => report("ready")).catch((e) => report("error", { error: String(e), phase: "warm" })); break;
      case "stats": return { ...stats, playing: !!current, ctxState: current?.ctx.state ?? null };
    }
  };
}
