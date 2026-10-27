import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { ContextFile, ProjectContext } from "./shared";
import { UUID_PATTERN } from "./meeting-store";

export const CONTEXT_MAX_FILE_BYTES = 200 * 1024;
export const CONTEXT_MAX_TOTAL_BYTES = 1024 * 1024;
export const CONTEXT_MAX_FILES = 16;
const EXTENSIONS = new Set([".txt", ".md", ".markdown", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".json", ".yaml", ".yml", ".xml", ".csv", ".sql", ".py", ".go", ".rs", ".java", ".cs", ".c", ".cpp", ".h", ".toml"]);
const SENSITIVE_NAME = /(^\.|(?:^|[._\- ])(?:env|credentials?|secrets?|tokens?|auth|passwords?|keys?|private[-_ ]?keys?|id_rsa|id_ed25519)(?:$|[._\- ]))/i;
interface StoredFile extends ContextFile { sha256: string }
interface StoredContext { version: 1; goal: string; files: StoredFile[] }
export function isContextFileAllowed(name: string): boolean { return typeof name === "string" && EXTENSIONS.has(path.extname(name).toLowerCase()); }
export function isSensitiveContextFileName(name: string): boolean { return typeof name !== "string" || SENSITIVE_NAME.test(name); }
export function validContextRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 && !value.startsWith("/") && !value.includes("\\") && value.split("/").every(part => part && part !== "." && part !== "..");
}
function publicContext(value: StoredContext): ProjectContext { return { goal: value.goal, files: value.files.map(({ id, name, bytes, relativePath }) => relativePath === undefined ? ({ id, name, bytes }) : ({ id, name, bytes, relativePath })) }; }
function decode(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Нужен текстовый файл в UTF-8"); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error("Двоичные файлы не поддерживаются");
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)) throw new Error("Файлы с закрытыми ключами нельзя добавлять в контекст");
  return text;
}

/** Copies only explicitly selected text. Source paths are never stored or exposed to the provider. */
export class ProjectContextStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}
  private async directory(create = false): Promise<string | null> {
    try {
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Ссылка вместо папки контекста");
      return this.root;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return null;
    }
    await mkdir(this.root, { recursive: true });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Ссылка вместо папки контекста");
    return this.root;
  }
  private async ownedFile(directory: string, name: string): Promise<string | null> {
    const file = path.join(directory, name);
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("Ссылка вместо файла контекста");
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  private async read(): Promise<StoredContext> {
    const directory = await this.directory();
    if (!directory) return { version: 1, goal: "", files: [] };
    let raw: string;
    const file = await this.ownedFile(directory, "context.json");
    if (!file) return { version: 1, goal: "", files: [] };
    raw = await readFile(file, "utf8");
    const value = JSON.parse(raw) as StoredContext;
    if (value.version !== 1 || typeof value.goal !== "string" || value.goal.length > 10_000 || !Array.isArray(value.files) || value.files.length > CONTEXT_MAX_FILES) throw new Error("Повреждено хранилище контекста");
    let total = 0;
    const ids = new Set<string>();
    for (const file of value.files) {
      if (!UUID_PATTERN.test(file.id) || ids.has(file.id) || typeof file.name !== "string" || path.basename(file.name) !== file.name || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > CONTEXT_MAX_FILE_BYTES || !/^[0-9a-f]{64}$/.test(file.sha256) || (file.relativePath !== undefined && (!validContextRelativePath(file.relativePath) || path.posix.basename(file.relativePath) !== file.name))) throw new Error("Повреждены сведения о файле контекста");
      ids.add(file.id);
      total += file.bytes;
    }
    if (total > CONTEXT_MAX_TOTAL_BYTES) throw new Error("Превышен размер контекста");
    return value;
  }
  private async save(value: StoredContext): Promise<void> {
    const directory = await this.directory(true);
    if (!directory) throw new Error("Не удалось создать папку контекста");
    const target = path.join(directory, "context.json");
    await this.ownedFile(directory, "context.json");
    const temporary = path.join(directory, `context-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.datasync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  private mutate(fn: () => Promise<ProjectContext>): Promise<ProjectContext> {
    const result = this.pending.then(fn);
    this.pending = result.catch(() => {});
    return result;
  }
  async load(): Promise<ProjectContext> { await this.pending; return publicContext(await this.read()); }
  async folderFingerprints(): Promise<Map<string, string>> {
    await this.pending;
    return new Map((await this.read()).files.filter(file => file.relativePath).map(file => [file.relativePath!, file.sha256]));
  }
  setGoal(goal: string): Promise<ProjectContext> {
    return this.mutate(async () => {
      if (typeof goal !== "string" || goal.length > 10_000) throw new Error("Цель встречи: максимум 10 000 символов");
      const context = await this.read();
      context.goal = goal;
      await this.save(context);
      return publicContext(context);
    });
  }
  addFiles(paths: string[], relativeNames?: string[]): Promise<ProjectContext> {
    return this.mutate(async () => {
      const context = await this.read();
      if (!Array.isArray(paths) || !paths.length || context.files.length + paths.length > CONTEXT_MAX_FILES || (relativeNames !== undefined && (!Array.isArray(relativeNames) || relativeNames.length !== paths.length))) throw new Error(`Можно добавить до ${CONTEXT_MAX_FILES} файлов`);
      const prepared: { file: StoredFile; bytes: Buffer }[] = [];
      let total = context.files.reduce((sum, file) => sum + file.bytes, 0);
      for (let index = 0; index < paths.length; index++) {
        const source = paths[index];
        if (typeof source !== "string" || !path.isAbsolute(source)) throw new Error("Выберите файл через диалог приложения");
        const name = path.basename(source);
        const relativePath = relativeNames?.[index];
        if (relativePath !== undefined && (!validContextRelativePath(relativePath) || path.posix.basename(relativePath) !== name)) throw new Error("Некорректный относительный путь материала");
        if (isSensitiveContextFileName(name)) throw new Error(`Нельзя добавить файл с учётными данными: ${name}`);
        if (!isContextFileAllowed(name)) throw new Error(`Не поддерживается формат файла: ${name}`);
        const handle = await open(source, "r");
        let bytes: Buffer;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > CONTEXT_MAX_FILE_BYTES) throw new Error(`Файл должен быть текстовым и не больше 200 КБ: ${name}`);
          bytes = await handle.readFile();
        } finally { await handle.close(); }
        if (bytes.length > CONTEXT_MAX_FILE_BYTES) throw new Error(`Файл больше 200 КБ: ${name}`);
        decode(bytes);
        total += bytes.length;
        if (total > CONTEXT_MAX_TOTAL_BYTES) throw new Error("Общий размер файлов не должен превышать 1 МБ");
        const hash = createHash("sha256").update(bytes).digest("hex");
        if (context.files.some(file => file.sha256 === hash && file.name === name && file.relativePath === relativePath) || prepared.some(item => item.file.sha256 === hash && item.file.name === name && item.file.relativePath === relativePath)) continue;
        prepared.push({ file: { id: randomUUID(), name, bytes: bytes.length, sha256: hash, ...(relativePath === undefined ? {} : { relativePath }) }, bytes });
      }
      const directory = await this.directory(true);
      if (!directory) throw new Error("Не удалось создать папку контекста");
      const written: string[] = [];
      try {
        for (const item of prepared) {
          const destination = path.join(directory, `${item.file.id}.txt`);
          await this.ownedFile(directory, `${item.file.id}.txt`);
          const handle = await open(destination, "wx");
          written.push(destination);
          try { await handle.writeFile(item.bytes); await handle.datasync(); }
          finally { await handle.close(); }
          context.files.push(item.file);
        }
        await this.save(context);
      } catch (error) { await Promise.all(written.map(file => unlink(file).catch(() => {}))); throw error; }
      return publicContext(context);
    });
  }
  /** Replaces one folder snapshot while preserving manually selected files and stable IDs for unchanged copies. */
  replaceFolderFiles(paths: string[], relativeNames: string[]): Promise<ProjectContext> {
    return this.mutate(async () => {
      const context = await this.read();
      if (!Array.isArray(paths) || !Array.isArray(relativeNames) || relativeNames.length !== paths.length || new Set(relativeNames).size !== relativeNames.length) throw new Error("Некорректный выбранный набор файлов папки");
      const manual = context.files.filter(file => file.relativePath === undefined);
      if (manual.length + paths.length > CONTEXT_MAX_FILES) throw new Error(`Можно добавить до ${CONTEXT_MAX_FILES} файлов`);
      const oldByKey = new Map(context.files.filter(file => file.relativePath !== undefined).map(file => [`${file.sha256}\u0000${file.name}\u0000${file.relativePath}`, file]));
      const selected: { file: StoredFile; bytes?: Buffer }[] = [];
      let total = manual.reduce((sum, file) => sum + file.bytes, 0);
      for (let index = 0; index < paths.length; index++) {
        const source = paths[index];
        const relativePath = relativeNames[index];
        if (typeof source !== "string" || !path.isAbsolute(source) || !validContextRelativePath(relativePath)) throw new Error("Некорректный выбранный набор файлов папки");
        const name = path.basename(source);
        if (path.posix.basename(relativePath) !== name || isSensitiveContextFileName(name) || !isContextFileAllowed(name)) throw new Error("Некорректный выбранный набор файлов папки");
        const handle = await open(source, "r");
        let bytes: Buffer;
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > CONTEXT_MAX_FILE_BYTES) throw new Error(`Файл должен быть текстовым и не больше 200 КБ: ${name}`);
          bytes = await handle.readFile();
        } finally { await handle.close(); }
        if (bytes.length > CONTEXT_MAX_FILE_BYTES) throw new Error(`Файл больше 200 КБ: ${name}`);
        decode(bytes);
        total += bytes.length;
        if (total > CONTEXT_MAX_TOTAL_BYTES) throw new Error("Общий размер файлов не должен превышать 1 МБ");
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        const key = `${sha256}\u0000${name}\u0000${relativePath}`;
        const existing = oldByKey.get(key);
        selected.push(existing ? { file: existing } : { file: { id: randomUUID(), name, bytes: bytes.length, sha256, relativePath }, bytes });
      }
      const next: StoredContext = { ...context, files: [...manual, ...selected.map(item => item.file)] };
      const directory = await this.directory(true);
      if (!directory) throw new Error("Не удалось создать папку контекста");
      const written: string[] = [];
      try {
        for (const item of selected) {
          if (!item.bytes) continue;
          const destination = path.join(directory, `${item.file.id}.txt`);
          await this.ownedFile(directory, `${item.file.id}.txt`);
          const handle = await open(destination, "wx");
          written.push(destination);
          try { await handle.writeFile(item.bytes); await handle.datasync(); }
          finally { await handle.close(); }
        }
        await this.save(next);
      } catch (error) { await Promise.all(written.map(file => unlink(file).catch(() => {}))); throw error; }
      const retained = new Set(next.files.map(file => file.id));
      await Promise.all(context.files.filter(file => file.relativePath !== undefined && !retained.has(file.id)).map(file => unlink(path.join(directory, `${file.id}.txt`)).catch(() => {})));
      return publicContext(next);
    });
  }
  removeFile(id: string): Promise<ProjectContext> {
    return this.mutate(async () => {
      if (!UUID_PATTERN.test(id)) throw new Error("Некорректный идентификатор файла");
      const context = await this.read();
      if (!context.files.some(file => file.id === id)) throw new Error("Файл контекста не найден");
      const directory = await this.directory();
      const file = directory ? await this.ownedFile(directory, `${id}.txt`) : null;
      context.files = context.files.filter(file => file.id !== id);
      await this.save(context);
      if (file) await unlink(file);
      return publicContext(context);
    });
  }
  async text(query = ""): Promise<string> {
    await this.pending;
    const context = await this.read();
    const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? [])].slice(0, 30);
    const files = await Promise.all(context.files.map(async file => {
      const directory = await this.directory();
      if (!directory) throw new Error(`Не найдена копия файла контекста: ${file.name}`);
      const owned = await this.ownedFile(directory, `${file.id}.txt`);
      if (!owned) throw new Error(`Не найдена копия файла контекста: ${file.name}`);
      const bytes = await readFile(owned);
      if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Изменена копия файла контекста: ${file.name}`);
      const text = decode(bytes);
      const lower = text.toLowerCase();
      const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0) + (file.name.toLowerCase().includes(word) ? 3 : 0), 0);
      return { file, text, score };
    }));
    files.sort((a, b) => b.score - a.score);
    let remaining = 40_000;
    const result = [`Цель встречи:\n${context.goal || "Не указана"}`];
    for (const { file, text } of files) {
      if (remaining <= 0) break;
      // For a matching passage, keep surrounding context rather than always cutting the file at its start.
      const first = words.map(word => text.toLowerCase().indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b)[0];
      const start = text.length > 12_000 && first !== undefined ? Math.max(0, first - 1_000) : 0;
      const excerpt = text.slice(start, start + Math.min(12_000, remaining));
      remaining -= excerpt.length;
      result.push(`Файл: ${file.relativePath ?? file.name}\nID: ${file.id}\nSHA-256: ${file.sha256}\n${start || excerpt.length < text.length ? "[Фрагмент файла]\n" : ""}${excerpt}`);
    }
    return result.join("\n\n");
  }
  /** Full, verified snapshot for explicit handoff; never reads original source paths. */
  async exportText(includeGoal = true): Promise<string> {
    await this.pending;
    if (typeof includeGoal !== "boolean") throw new Error("Некорректный параметр экспорта контекста");
    const context = await this.read();
    const directory = await this.directory();
    const result = includeGoal ? [`Цель встречи:\n${context.goal || "Не указана"}`] : [];
    for (const file of context.files) {
      if (!directory) throw new Error(`Не найдена копия файла контекста: ${file.name}`);
      const owned = await this.ownedFile(directory, `${file.id}.txt`);
      if (!owned) throw new Error(`Не найдена копия файла контекста: ${file.name}`);
      const bytes = await readFile(owned);
      if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error(`Изменена копия файла контекста: ${file.name}`);
      const contents = decode(bytes);
      result.push(`Файл: ${file.relativePath ?? file.name}\nID: ${file.id}\nSHA-256: ${file.sha256}\n${contents}`);
    }
    return result.join("\n\n");
  }
}
