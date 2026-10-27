import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { validContextRelativePath } from "./context-store";
import type { ProjectKnowledge } from "./shared";

const FINGERPRINT = /^[0-9a-f]{64}$/;
const MAX_BRIEF = 20_000;
const MAX_FILES = 16;

interface StoredFolder { name: string; path: string }
interface StoredBrief { text: string; generatedAt: string; fingerprint: string; files: string[]; repositoryFiles?: string[] }
interface StoredKnowledge { version: 1; folder: StoredFolder | null; brief: StoredBrief | null }

function empty(): StoredKnowledge { return { version: 1, folder: null, brief: null }; }
function fingerprint(value: unknown): value is string { return typeof value === "string" && FINGERPRINT.test(value); }
function validFolder(value: unknown): value is StoredFolder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const folder = value as Partial<StoredFolder>;
  return typeof folder.name === "string" && folder.name.length > 0 && folder.name.length <= 200 && typeof folder.path === "string" && path.isAbsolute(folder.path);
}
function validBrief(value: unknown): value is StoredBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const brief = value as Partial<StoredBrief>;
  if (brief.repositoryFiles !== undefined && (!Array.isArray(brief.repositoryFiles) || brief.repositoryFiles.length > MAX_FILES || !brief.repositoryFiles.every(validContextRelativePath) || new Set(brief.repositoryFiles).size !== brief.repositoryFiles.length)) return false;
  return typeof brief.text === "string" && brief.text.length <= MAX_BRIEF && typeof brief.generatedAt === "string" && Number.isFinite(Date.parse(brief.generatedAt)) && fingerprint(brief.fingerprint) && Array.isArray(brief.files) && brief.files.length <= MAX_FILES && brief.files.every(validContextRelativePath) && new Set(brief.files).size === brief.files.length;
}
function validateText(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_BRIEF) throw new Error("Краткое описание проекта: максимум 20 000 символов");
  return value;
}
function validateFiles(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_FILES || value.some(file => !validContextRelativePath(file)) || new Set(value).size !== value.length) throw new Error(`Можно указать до ${MAX_FILES} относительных файлов проекта`);
  return [...value];
}

/** Stable fingerprint for a complete owned context export, independent of Windows line endings. */
export function fingerprintContext(contextExport: string): string {
  if (typeof contextExport !== "string") throw new Error("Некорректный контекст проекта");
  const canonical = contextExport.normalize("NFC").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Persists only local folder selection and a bounded generated brief; source contents are never copied here. */
export class ProjectKnowledgeStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
  private async directory(create = false): Promise<string | null> {
    try {
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Ссылка вместо папки знаний проекта");
      return this.root;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!create) return null;
    }
    await mkdir(this.root, { recursive: true });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Ссылка вместо папки знаний проекта");
    return this.root;
  }
  private async metadata(directory: string): Promise<string | null> {
    const file = path.join(directory, "knowledge.json");
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("Ссылка вместо данных проекта");
      return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  private async read(): Promise<StoredKnowledge> {
    const directory = await this.directory();
    if (!directory) return empty();
    const file = await this.metadata(directory);
    if (!file) return empty();
    let value: unknown;
    try { value = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error instanceof SyntaxError) throw new Error("Повреждены знания проекта"); throw error; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждены знания проекта");
    const stored = value as Partial<StoredKnowledge>;
    if (stored.version !== 1 || (stored.folder !== null && !validFolder(stored.folder)) || (stored.brief !== null && !validBrief(stored.brief))) throw new Error("Повреждены знания проекта");
    return { version: 1, folder: stored.folder ?? null, brief: stored.brief ?? null };
  }
  private async write(value: StoredKnowledge): Promise<void> {
    const directory = await this.directory(true);
    if (!directory) throw new Error("Не удалось создать папку знаний проекта");
    const target = path.join(directory, "knowledge.json");
    await this.metadata(directory);
    const temporary = path.join(directory, `.knowledge-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.datasync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  private async resolvedFolder(folder: StoredFolder): Promise<string> {
    try {
      const info = await lstat(folder.path);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Выбранная папка проекта недоступна или является ссылкой");
      return await realpath(folder.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Выбранная папка проекта больше недоступна");
      throw error;
    }
  }
  private async present(value: StoredKnowledge, currentFingerprint?: string): Promise<ProjectKnowledge> {
    if (currentFingerprint !== undefined && !fingerprint(currentFingerprint)) throw new Error("Некорректный отпечаток контекста проекта");
    let folder: ProjectKnowledge["folder"] = null;
    if (value.folder) {
      try { await this.resolvedFolder(value.folder); folder = { ...value.folder, available: true }; }
      catch (error) {
        if ((error as Error).message.includes("больше недоступна")) folder = { ...value.folder, available: false };
        else throw error;
      }
    }
    const brief = value.brief ? { ...value.brief, files: [...value.brief.files], stale: currentFingerprint === undefined ? false : value.brief.fingerprint !== currentFingerprint } : null;
    return { folder, brief };
  }

  async load(currentFingerprint?: string): Promise<ProjectKnowledge> { await this.pending; return this.present(await this.read(), currentFingerprint); }
  bindFolder(root: string): Promise<ProjectKnowledge> {
    return this.mutate(async () => {
      if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("Выберите папку проекта через диалог приложения");
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Папка проекта не должна быть ссылкой");
      const resolved = await realpath(root);
      const name = path.basename(resolved) || resolved;
      if (name.length > 200) throw new Error("Слишком длинное имя папки проекта");
      const value = await this.read();
      if (value.folder?.path !== resolved) value.brief = null;
      value.folder = { name, path: resolved };
      await this.write(value);
      return this.present(value);
    });
  }
  unbindFolder(): Promise<ProjectKnowledge> {
    return this.mutate(async () => {
      const value = await this.read();
      value.folder = null; value.brief = null;
      await this.write(value);
      return this.present(value);
    });
  }
  async folderPath(): Promise<string | null> {
    await this.pending;
    const folder = (await this.read()).folder;
    return folder ? this.resolvedFolder(folder) : null;
  }
  saveBrief(text: string, contextFingerprint: string, files: string[], repositoryFiles?: string[]): Promise<ProjectKnowledge> {
    return this.mutate(async () => {
      const value = await this.read();
      if (!fingerprint(contextFingerprint)) throw new Error("Некорректный отпечаток контекста проекта");
      value.brief = { text: validateText(text), fingerprint: contextFingerprint, files: validateFiles(files), ...(repositoryFiles ? { repositoryFiles: validateFiles(repositoryFiles) } : {}), generatedAt: new Date().toISOString() };
      await this.write(value);
      return this.present(value);
    });
  }
  markStale(currentFingerprint: string): Promise<ProjectKnowledge> {
    if (!fingerprint(currentFingerprint)) return Promise.reject(new Error("Некорректный отпечаток контекста проекта"));
    return this.load(currentFingerprint);
  }
  editBrief(text: string): Promise<ProjectKnowledge> {
    return this.mutate(async () => {
      const value = await this.read();
      if (!value.brief) throw new Error("Краткое описание проекта ещё не создано");
      value.brief = { ...value.brief, text: validateText(text) };
      await this.write(value);
      return this.present(value);
    });
  }
}
