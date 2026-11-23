// Sentence-by-sentence speech for long documents: synthesizes a few seconds ahead of what you hear, keeps a
// timeline so the page can highlight the sentence being spoken, and can pause, resume, stop or jump anywhere.
import { PhononTTS } from "./vendor/phonon-tts/index.js";
import { SPEEDS, modelSpec } from "./voices.js";

const AHEAD_S = 6;   // seconds of audio to keep queued: enough to never stall, small enough to react quickly

export class SpeechEngine {
  #tts = null; #delta = null; #loading = null;
  #seq = 0; #ctx = null; #ac = null; #timeline = []; #tick = null; #current = null;
  state = "idle";                       // idle | loading | playing | paused
  onstate = () => {};                   // (state, info)
  onsentence = () => {};                // (utterance) when it starts being heard

  async load(speedId) {
    const delta = (SPEEDS.find((s) => s.id === speedId) || SPEEDS[1]).delta;
    if (this.#tts && this.#delta === delta) return this.#tts;
    if (this.#loading?.delta === delta) return this.#loading.promise;
    const promise = (async () => {
      const t = await PhononTTS.load({ lang: "en", model: modelSpec(), quant: "q8", cache: false, device: "cpu", threads: "auto", conditions: { duration_delta: delta } });
      this.#tts?.dispose(); this.#tts = t; this.#delta = delta;
      return t;
    })();
    this.#loading = { delta, promise };
    try { return await promise; } finally { if (this.#loading?.promise === promise) this.#loading = null; }
  }

  get info() { return this.#tts ? { threads: this.#tts.threads, isolated: self.crossOriginIsolated } : null; }
  get current() { return this.#current; }

  /** Speak utterances ({text, pause, ...}) from an async iterator until it ends or play() is called again. */
  async play(utterances, { voice, speed }) {
    this.stop(true);
    const id = ++this.#seq;
    this.#set("loading");
    let t;
    try { t = await this.load(speed); } catch (e) { if (id === this.#seq) this.#set("error", { error: String(e?.message || e) }); return; }
    if (id !== this.#seq) return;
    const ctx = this.#ctx = new AudioContext({ sampleRate: t.sampleRate, latencyHint: "playback" });
    const ac = this.#ac = new AbortController();
    const timeline = this.#timeline = [];
    this.#tick = setInterval(() => this.#follow(ctx, timeline), 60);
    let at = ctx.currentTime + 0.06, first = true;
    const v = t.voices.includes(voice) ? voice : "default";
    try {
      for await (const u of utterances) {
        if (id !== this.#seq) return;
        while (at - ctx.currentTime > AHEAD_S && id === this.#seq) await sleep(80);
        if (id !== this.#seq) return;
        let start = null;
        for await (const pcm of t.stream(u.text, { voice: v, signal: ac.signal })) {
          if (id !== this.#seq) return;
          const buf = ctx.createBuffer(1, pcm.length, t.sampleRate);
          buf.getChannelData(0).set(pcm);
          const src = ctx.createBufferSource();
          src.buffer = buf; src.connect(ctx.destination);
          at = Math.max(at, ctx.currentTime + 0.02);
          start ??= at;
          src.start(at); at += buf.duration;
        }
        if (start === null) continue;               // nothing to say (punctuation only)
        timeline.push({ u, start, end: at });
        at += u.pause ?? 0.12;
        if (first) { first = false; if (ctx.state !== "suspended") this.#set("playing"); }
      }
    } catch (e) {
      if (id === this.#seq && e?.name !== "AbortError") { this.#set("error", { error: String(e?.message || e) }); this.stop(true); }
      return;
    }
    while (id === this.#seq && ctx.state !== "closed" && ctx.currentTime < at) await sleep(100);
    if (id !== this.#seq) return;
    this.stop(true); this.#set("done");
  }

  #follow(ctx, timeline) {
    const now = ctx.currentTime;
    let hit = null;
    for (let i = timeline.length - 1; i >= 0; i--) if (timeline[i].start <= now + 0.02) { hit = timeline[i]; break; }
    if (hit && hit.u !== this.#current) { this.#current = hit.u; this.onsentence(hit.u); }
  }

  pause() { if (this.#ctx && this.state === "playing") this.#ctx.suspend().then(() => this.#set("paused")); }
  resume() { if (this.#ctx && this.state === "paused") this.#ctx.resume().then(() => this.#set("playing")); }

  stop(silent = false) {
    this.#seq++;
    clearInterval(this.#tick); this.#tick = null;
    this.#ac?.abort(); this.#ac = null;
    this.#ctx?.close().catch(() => {}); this.#ctx = null;
    this.#timeline = [];
    const was = this.state !== "idle";
    this.#current = null;
    if (!silent && was) this.#set("idle");
    else this.state = "idle";
  }

  #set(state, info = {}) { this.state = state === "done" || state === "error" ? "idle" : state; this.onstate(state, info); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
