import type { SourceRole } from "../shared";

interface Callbacks {
  level(source: SourceRole, level: number): void;
  frame(dataUrl: string, atMs: number): void;
  problem(message: string, severity?: "info" | "error"): void;
}
export class Capture {
  private streams: MediaStream[] = [];
  private contexts: AudioContext[] = [];
  private nodes: AudioWorkletNode[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private video: HTMLVideoElement | null = null;
  private anchor = 0;
  private stopped = true;
  private paused = false;
  private pausing = false;
  private resetters: (() => void)[] = [];
  constructor(private callbacks: Callbacks) {}
  async start(micId: string) {
    this.stopped = false;
    this.paused = false;
    this.pausing = false;
    this.anchor = performance.now();
    let setup: "microphone" | "display" = "microphone";
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(micId ? { deviceId: { exact: micId } } : {}),
        echoCancellation: false, noiseSuppression: true, autoGainControl: false
      }, video: false });
      this.streams.push(mic);
      const micTrack = mic.getAudioTracks()[0];
      const actualDevice = micTrack?.getSettings().deviceId;
      if (micId && actualDevice && actualDevice !== micId) this.callbacks.problem("Выбранный микрофон не подтверждён браузером. Проверьте источник перед записью.");
      setup = "display";
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 3 }, audio: true });
      this.streams.push(screen);
      if (!screen.getAudioTracks().length) this.callbacks.problem("Системный звук не получен. Сейчас распознаётся только микрофон.");
      for (const track of mic.getAudioTracks()) this.watchTrack(track, "Микрофон");
      for (const track of screen.getAudioTracks()) this.watchTrack(track, "Системный звук");
      for (const track of screen.getVideoTracks()) this.watchTrack(track, "Окно созвона");
      await this.attach(new MediaStream(mic.getAudioTracks()), "self");
      if (screen.getAudioTracks().length) await this.attach(new MediaStream(screen.getAudioTracks()), "remote");
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.srcObject = screen;
      await this.video.play();
      this.sampleFrames();
    } catch (e) {
      await this.stop();
      if (!(e instanceof DOMException)) throw e;
      const display = setup === "display";
      const messages: Record<string, string> = display ? {
        NotAllowedError: "Разрешите захват окна или экрана и повторите попытку.",
        NotFoundError: "Не удалось найти источник созвона. Обновите список окон и выберите его снова.",
        OverconstrainedError: "Выбранный источник созвона больше недоступен. Обновите список окон и выберите его снова.",
        NotReadableError: "Источник созвона занят другим приложением. Закройте захват в другом приложении и повторите попытку."
      } : {
        NotAllowedError: "Разрешите доступ к микрофону и повторите попытку.",
        NotFoundError: "Не найден микрофон. Обновите список устройств и выберите микрофон снова.",
        OverconstrainedError: "Выбранный микрофон больше недоступен. Обновите список устройств и выберите микрофон снова.",
        NotReadableError: "Микрофон занят другим приложением. Закройте его в другом приложении и повторите попытку."
      };
      throw messages[e.name] ? new Error(messages[e.name]) : e;
    }
  }
  private watchTrack(track: MediaStreamTrack, label: string) {
    track.addEventListener("mute", () => { if (!this.stopped) this.callbacks.problem(label + " временно отключён."); });
    track.addEventListener("unmute", () => { if (!this.stopped) this.callbacks.problem(label + (track.kind === "video" ? " снова доступно." : " снова передаёт звук."), "info"); });
    track.addEventListener("ended", () => { if (!this.stopped) this.callbacks.problem(label + " отключён: " + (track.label || "без названия")); });
  }
  private async attach(stream: MediaStream, source: SourceRole) {
    const context = new AudioContext();
    this.contexts.push(context);
    await context.audioWorklet.addModule(new URL("./pcm-worklet.js", import.meta.url).href);
    const node = new AudioWorkletNode(context, "callme-pcm");
    this.nodes.push(node);
    let pieces: Float32Array[] = [], count = 0, silence = 0, speech = 0;
    let startMs = performance.now() - this.anchor;
    let tail: Float32Array[] = [];
    const reset = () => { pieces = []; count = 0; speech = 0; silence = 0; tail = []; startMs = performance.now() - this.anchor; };
    this.resetters.push(reset);
    const send = () => {
      if (!count) return;
      if (speech >= context.sampleRate * 0.18) {
        const combined = new Float32Array(count);
        let offset = 0;
        for (const p of pieces) { combined.set(p, offset); offset += p.length; }
        const pcm = resampleTo16k(combined, context.sampleRate);
        window.callme.audio(source, startMs, startMs + count / context.sampleRate * 1000, pcm.buffer as ArrayBuffer);
      }
      reset();
    };
    node.port.onmessage = event => {
      if (event.data.flushed) { send(); return; }
      const { samples, rms } = event.data as { samples: Float32Array; rms: number };
      if (this.paused) { reset(); return; }
      this.callbacks.level(source, Math.min(1, rms * 7));
      const voiced = rms > 0.008;
      if (count === 0 && !voiced) { tail.push(samples); if (tail.length > 3) tail.shift(); return; }
      if (!count) {
        const preroll = tail.reduce((n, p) => n + p.length, 0);
        startMs = Math.max(0, performance.now() - this.anchor - (preroll + samples.length) / context.sampleRate * 1000);
        pieces.push(...tail); count += preroll; tail = [];
      }
      pieces.push(samples); count += samples.length;
      if (voiced) { speech += samples.length; silence = 0; } else silence += samples.length;
      // MVP: phrase chunks after a pause, or at 8 seconds; no fake word-by-word partials.
      if (silence > context.sampleRate * 0.6 || count >= context.sampleRate * 8) send();
    };
    context.createMediaStreamSource(stream).connect(node);
    const mute = context.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(context.destination);
    await context.resume();
  }
  private sampleFrames() {
    if (this.paused || this.timer) return;
    const canvas = document.createElement("canvas");
    const tiny = document.createElement("canvas");
    tiny.width = 32; tiny.height = 18;
    const tinyCtx = tiny.getContext("2d", { willReadFrequently: true })!;
    let previous: Uint8ClampedArray | null = null;
    let lastSent = -2000;
    this.timer = setInterval(() => {
      const video = this.video;
      if (!video || !video.videoWidth) return;
      tinyCtx.drawImage(video, 0, 0, 32, 18);
      const pixels = tinyCtx.getImageData(0, 0, 32, 18).data;
      let difference = previous ? 0 : 255;
      if (previous) { for (let i = 0; i < pixels.length; i += 4) difference += Math.abs(pixels[i] - previous[i]); difference /= 32 * 18; }
      const atMs = performance.now() - this.anchor;
      if (difference < 3 || atMs - lastSent < 2000) return;
      previous = pixels.slice();
      lastSent = atMs;
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      this.callbacks.frame(canvas.toDataURL("image/jpeg", 0.75), atMs);
    }, 500);
  }
  snapshot(): boolean {
    const video = this.video;
    if (this.stopped || this.paused || !video?.videoWidth) return false;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.callbacks.frame(canvas.toDataURL("image/jpeg", 0.75), performance.now() - this.anchor);
    return true;
  }
  isPaused(): boolean { return this.paused; }
  private async flushNodes() {
    await Promise.all(this.nodes.map(node => new Promise<void>(resolve => {
      const old = node.port.onmessage;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (node.port.onmessage === handler) node.port.onmessage = old;
        resolve();
      };
      const timer = setTimeout(finish, 350);
      const handler = (event: MessageEvent) => {
        old?.call(node.port, event);
        if (event.data.flushed) finish();
      };
      node.port.onmessage = handler;
      node.port.postMessage("flush");
    })));
  }
  async pause(): Promise<void> {
    if (this.stopped || this.paused || this.pausing) return;
    this.pausing = true;
    try {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      // Worklet flush is awaited while delivery remains open, so accepted pre-pause speech reaches native before its gate closes.
      await this.flushNodes();
      await Promise.all(this.contexts.map(async context => {
        await context.suspend();
        if (context.state !== "suspended") throw new Error("Не удалось приостановить обработку звука");
      }));
      this.resetters.forEach(reset => reset());
      this.paused = true;
    } catch (error) {
      await Promise.all(this.contexts.map(context => context.suspend().catch(() => {})));
      this.resetters.forEach(reset => reset());
      this.paused = true;
      this.callbacks.problem("Не удалось поставить захват на паузу.");
      throw error;
    } finally { this.pausing = false; }
  }
  async resume(): Promise<void> {
    if (this.stopped || !this.paused) return;
    try {
      await Promise.all(this.contexts.map(async context => {
        await context.resume();
        if (context.state !== "running") throw new Error("Не удалось возобновить обработку звука");
      }));
      this.resetters.forEach(reset => reset());
      this.paused = false;
      this.sampleFrames();
    } catch (error) {
      await Promise.all(this.contexts.map(context => context.suspend().catch(() => {})));
      this.paused = true;
      this.callbacks.problem("Не удалось возобновить захват. Он остаётся на паузе.");
      throw error;
    }
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.paused) this.resetters.forEach(reset => reset());
    else await this.flushNodes();
    this.streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    await Promise.all(this.contexts.map(c => c.close().catch(() => {})));
    this.streams = []; this.nodes = []; this.contexts = []; this.resetters = [];
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null;
  }
}

export function resampleTo16k(samples: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / 16000;
  const output = new Int16Array(Math.floor(samples.length / ratio));
  // Low-pass averaging while downsampling. State resets only at phrase boundaries.
  for (let i = 0; i < output.length; i++) {
    const begin = i * ratio, end = Math.min(samples.length, (i + 1) * ratio);
    let total = 0, weight = 0;
    for (let j = Math.floor(begin); j < Math.ceil(end); j++) {
      const w = Math.min(j + 1, end) - Math.max(j, begin);
      total += samples[j] * w; weight += w;
    }
    const value = Math.max(-1, Math.min(1, total / weight));
    output[i] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return output;
}
