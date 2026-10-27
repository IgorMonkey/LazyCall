import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import type { AppSettings, SourceRole, WhisperStatus } from "./shared";
import { DEFAULT_APP_SETTINGS } from "./shared";
import { wavFromPcm } from "./wav";

interface Job { source: SourceRole; startMs: number; endMs: number; pcm: Uint8Array }
interface QueuedJob extends Job { queuedAt: number }
export class Whisper {
  preferences: AppSettings = { ...DEFAULT_APP_SETTINGS };
  private child: ChildProcess | null = null;
  private port = 0;
  private jobs: QueuedJob[] = [];
  private activeJob: QueuedJob | null = null;
  private dropped = 0;
  private busy = false;
  private abort: AbortController | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;
  status: WhisperStatus = { state: "missing", label: "Проверяем локальную модель…", backend: null };
  onStatus = (_: WhisperStatus) => {};
  onText = async (_: Job, _text: string) => {};
  onError = (_message: string) => {};
  constructor(private root: string) {}
  private update(status: WhisperStatus) { this.status = status; this.onStatus(status); }
  private queueStatus() {
    const oldest = this.activeJob ?? this.jobs[0];
    this.update({ ...this.status, pending: this.jobs.length + (this.activeJob ? 1 : 0), oldestQueuedAt: oldest?.queuedAt, dropped: this.dropped });
  }
  async check() {
    try {
      const config = JSON.parse(await readFile(path.join(this.root, "manifest.json"), "utf8"));
      await readFile(path.join(this.root, config.cpu));
      const { access } = await import("node:fs/promises");
      await access(path.join(this.root, config.model));
      this.update({ state: this.child ? this.status.state : "loading", label: this.child ? this.status.label : "Модель найдена. Готовим Whisper…", backend: this.status.backend });
      return config as { cpu: string; cuda: string; model: string };
    } catch {
      this.update({ state: "missing", label: "Модель не найдена. Переустановите LazyCall или повторите загрузку компонентов.", backend: null });
      return null;
    }
  }
  async start() {
    if (this.status.state === "ready" && this.child) return;
    if (this.starting) return this.starting;
    this.starting = this.launch().finally(() => { this.starting = null; });
    return this.starting;
  }
  async reconfigure(preferences: AppSettings) {
    await this.starting?.catch(() => {});
    await this.drain();
    this.close();
    this.preferences = { ...preferences };
    await this.start();
  }
  private async launch() {
    const generation = this.generation;
    const config = await this.check();
    if (generation !== this.generation) return;
    if (!config) throw new Error(this.status.label);
    const backends = config.cuda && this.preferences.compute === "auto" ? ["CUDA", "CPU"] as const : ["CPU"] as const;
    for (const backend of backends) {
      this.update({ state: "loading", label: "Загружаем Whisper на " + (backend === "CUDA" ? "видеокарте…" : "процессоре…"), backend });
      try {
        const actual = await this.boot(path.join(this.root, backend === "CUDA" ? config.cuda : config.cpu), path.join(this.root, config.model), backend, generation);
        if (generation !== this.generation) return;
        this.update({ state: "ready", label: "Локальное распознавание готово. " + (actual === "CUDA" ? "Используется видеокарта." : "Используется процессор."), backend: actual });
        return;
      } catch (e) {
        if (generation !== this.generation) return;
        this.child?.kill();
        this.child = null;
        if (backend === "CPU") {
          const message = e instanceof Error ? e.message : String(e);
          this.update({ state: "error", label: "Whisper не запустился: " + message, backend: null });
          throw e;
        }
      }
    }
  }
  private async boot(exe: string, model: string, backend: "CPU" | "CUDA", generation: number) {
    this.port = await new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const address = s.address() as net.AddressInfo;
        s.close(() => resolve(address.port));
      });
    });
    if (generation !== this.generation) throw new Error("Загрузка отменена");
    const args = ["-m", model, "-l", this.preferences.language, "-t", "6", "--host", "127.0.0.1", "--port", String(this.port)];
    if (backend === "CPU") args.push("--no-gpu");
    const child = spawn(exe, args, { windowsHide: true, shell: false, cwd: path.dirname(exe), stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    let failure = "";
    child.once("error", e => { failure = e.message; });
    // Inspect startup backend messages only. Never retain native inference output.
    let booting = true, startupTail = "", cudaBuffer = false;
    child.stderr?.on("data", chunk => {
      if (!booting) return;
      startupTail = (startupTail + chunk.toString()).slice(-8192);
      if (/CUDA\d*\s+(?:total size|compute buffer|KV buffer)\s*=/.test(startupTail)) cudaBuffer = true;
    });
    child.stdout?.on("data", () => {});
    child.once("exit", () => {
      if (this.child === child) {
        this.child = null;
        if (this.status.state === "ready") {
          this.update({ state: "error", label: "Whisper остановился. Останови и начни встречу снова.", backend: null });
          this.onError("Локальный движок остановился; часть аудио может быть не распознана.");
        }
      }
    });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (generation !== this.generation) throw new Error("Загрузка отменена");
      if (failure || child.exitCode !== null || child.signalCode !== null || child.killed) throw new Error(failure || "Движок завершился при загрузке");
      try {
        const r = await fetch("http://127.0.0.1:" + this.port + "/", { signal: AbortSignal.timeout(800) });
        if (r.ok) {
          booting = false; startupTail = "";
          return cudaBuffer ? "CUDA" as const : "CPU" as const;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    throw new Error("Превышено время загрузки модели");
  }
  enqueue(job: Job) {
    if (this.status.state !== "ready") { this.onError("Whisper недоступен: фрагмент аудио пропущен."); return; }
    if (this.jobs.length >= 4) {
      this.jobs.shift();
      this.dropped++;
      this.onError("Whisper отстаёт: пропущен фрагмент аудио, чтобы не копить задержку.");
    }
    this.jobs.push({ ...job, queuedAt: Date.now() });
    this.queueStatus();
    void this.pump();
  }
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift()!;
        this.activeJob = job; this.queueStatus();
        this.abort = new AbortController();
        const timeout = setTimeout(() => this.abort?.abort(), 30000);
        try {
          const form = new FormData();
          form.append("file", new Blob([new Uint8Array(wavFromPcm(job.pcm))], { type: "audio/wav" }), "speech.wav");
          form.append("response_format", "json");
          form.append("temperature", "0");
          const res = await fetch("http://127.0.0.1:" + this.port + "/inference", { method: "POST", body: form, signal: this.abort.signal });
          if (!res.ok) throw new Error("Whisper HTTP " + res.status);
          const json = await res.json() as { text?: string };
          const text = (json.text ?? "").trim();
          if (text && !/^\[.*\]$/.test(text)) await this.onText(job, text);
        } catch (e) {
          this.onError("Не удалось распознать фрагмент: " + (e instanceof Error ? e.message : String(e)));
        } finally { clearTimeout(timeout); this.abort = null; this.activeJob = null; this.queueStatus(); }
      }
    } finally { this.busy = false; }
  }
  async drain() {
    const deadline = Date.now() + 20000;
    while ((this.busy || this.jobs.length) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    if (this.busy || this.jobs.length) {
      this.jobs = [];
      this.abort?.abort();
      this.onError("Хвост распознавания не завершён за 20 секунд. Встреча сохранена с пропуском.");
      while (this.busy) await new Promise(r => setTimeout(r, 25));
    }
  }
  close() {
    this.generation++;
    this.jobs = [];
    this.activeJob = null; this.dropped = 0;
    this.abort?.abort();
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}
