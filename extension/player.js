// The speech player: owns the Phonon model and the audio output, and streams speech as it is generated.
// Chrome runs it in an offscreen document (offscreen.js); Firefox runs it in the background page itself.
import { PhononTTS } from "./vendor/phonon-tts/index.js";
import { SPEEDS, modelSpec } from "./voices.js";

export function createPlayer(report) {
  let tts = null, ttsSpeed = null, loading = null;
  let seq = 0, current = null;
  const stats = { loads: [] };

  async function getTTS(speedId) {
    const delta = (SPEEDS.find((s) => s.id === speedId) || SPEEDS[1]).delta;
    if (tts && ttsSpeed === delta) return tts;
    if (loading && loading.delta === delta) return loading.promise;
    const t0 = performance.now();
    const promise = (async () => {
      if (tts) { tts.dispose(); tts = null; }
      const t = await PhononTTS.load({
        lang: "en", model: modelSpec(), quant: "q8", cache: false, device: "cpu", threads: "auto",
        conditions: { duration_delta: delta },
      });
      tts = t; ttsSpeed = delta;
      stats.loads.push({ ms: Math.round(performance.now() - t0), threads: t.threads, threadsReason: t.threadsReason, device: t.device, isolated: self.crossOriginIsolated });
      return t;
    })();
    loading = { delta, promise };
    try { return await promise; } finally { if (loading?.promise === promise) loading = null; }
  }

  function stop(reason = "stopped") {
    seq++;
    if (!current) return;
    current.ac.abort();
    current.ctx.close().catch(() => {});
    current = null;
    report(reason);
  }

  async function speak({ text, voice, speed }) {
    stop("replaced");
    const id = ++seq;
    const t0 = performance.now();
    report("loading");
    let t;
    try { t = await getTTS(speed); }
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

  // Returns a value only for "stats"; everything else reports progress through report().
  return function handle(msg) {
    switch (msg.type) {
      case "speak": speak(msg); break;
      case "stop": stop(); break;
      case "pause": if (current) current.ctx.suspend().then(() => report("paused")); break;
      case "resume": if (current) current.ctx.resume().then(() => report("speaking")); break;
      case "warm": getTTS(msg.speed).then(() => report("ready")).catch((e) => report("error", { error: String(e), phase: "warm" })); break;
      case "stats": return { ...stats, playing: !!current, ctxState: current?.ctx.state ?? null };
    }
  };
}
