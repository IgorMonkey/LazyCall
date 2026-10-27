import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { ProjectContextStore } from "./context-store";
import { UUID_PATTERN } from "./meeting-store";
import type { Project, ProjectInput } from "./shared";

interface StoredState { version: 1; selectedId: string | null }

function input(value: ProjectInput): ProjectInput {
  if (!value || typeof value.name !== "string" || typeof value.description !== "string") throw new Error("Некорректные данные проекта");
  const name = value.name.trim();
  if (!name || name.length > 100 || value.description.length > 10_000) throw new Error("Некорректные данные проекта");
  return { name, description: value.description };
}

function project(value: unknown, id: string): Project {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждены данные проекта");
  const item = value as Partial<Project>;
  let checked: ProjectInput;
  try { checked = input({ name: item.name as string, description: item.description as string }); }
  catch { throw new Error("Повреждены данные проекта"); }
  if (item.id !== id || typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error("Повреждены данные проекта");
  return { id, ...checked, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

/** Owns project metadata; project context lives inside each project directory. */
export class ProjectStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }
  private async rootPath(): Promise<string> {
    await mkdir(this.root, { recursive: true });
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error("Ссылка вместо папки проектов");
    return realpath(this.root);
  }
  private async directory(id: string, create = false): Promise<string> {
    if (!UUID_PATTERN.test(id)) throw new Error("Некорректный идентификатор проекта");
    const root = await this.rootPath();
    const directory = path.join(this.root, id);
    if (create) await mkdir(directory, { recursive: false });
    let info;
    try { info = await lstat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Проект не найден"); throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Ссылка вместо папки проекта");
    const resolved = await realpath(directory);
    if (path.dirname(resolved).toLowerCase() !== root.toLowerCase()) throw new Error("Папка проекта вне хранилища");
    return directory;
  }
  private async metadata(id: string): Promise<string> {
    const file = path.join(await this.directory(id), "project.json");
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("Ссылка вместо данных проекта");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Проект не найден");
      throw error;
    }
    return file;
  }
  private async read(id: string): Promise<Project> {
    const file = await this.metadata(id);
    let value: unknown;
    try { value = JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (error instanceof SyntaxError) throw new Error("Повреждены данные проекта"); throw error; }
    return project(value, id);
  }
  private async write(directory: string, filename: string, value: unknown): Promise<void> {
    const target = path.join(directory, filename);
    try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Ссылка вместо данных проекта"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.datasync(); }
    finally { await handle.close(); }
    try { await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
  private async readState(): Promise<StoredState> {
    const root = await this.rootPath();
    const file = path.join(root, "state.json");
    try {
      if ((await lstat(file)).isSymbolicLink()) throw new Error("Ссылка вместо состояния проектов");
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждено состояние проектов");
      const state = value as Partial<StoredState>;
      if (state.version !== 1 || (state.selectedId !== null && !UUID_PATTERN.test(String(state.selectedId)))) throw new Error("Повреждено состояние проектов");
      return { version: 1, selectedId: state.selectedId ?? null };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, selectedId: null };
      if (error instanceof SyntaxError) throw new Error("Повреждено состояние проектов");
      throw error;
    }
  }

  async list(): Promise<Project[]> {
    await this.pending;
    const root = await this.rootPath();
    const entries = await readdir(root, { withFileTypes: true });
    const projects = await Promise.all(entries.filter(entry => entry.isDirectory() && UUID_PATTERN.test(entry.name)).map(entry => this.read(entry.name)));
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(id: string): Promise<Project> { await this.pending; return this.read(id); }
  create(value: ProjectInput): Promise<Project> {
    return this.mutate(async () => {
      const data = input(value);
      const id = randomUUID();
      const directory = await this.directory(id, true);
      const now = new Date().toISOString();
      const item: Project = { id, ...data, createdAt: now, updatedAt: now };
      await this.write(directory, "project.json", item);
      return item;
    });
  }
  update(id: string, value: ProjectInput): Promise<Project> {
    return this.mutate(async () => {
      const current = await this.read(id);
      const data = input(value);
      const item: Project = { ...current, ...data, updatedAt: new Date().toISOString() };
      await this.write(await this.directory(id), "project.json", item);
      return item;
    });
  }
  async selected(): Promise<string | null> { await this.pending; return (await this.readState()).selectedId; }
  select(id: string | null): Promise<void> {
    return this.mutate(async () => {
      if (id !== null) await this.read(id);
      await this.write(await this.rootPath(), "state.json", { version: 1, selectedId: id });
    });
  }
  context(id: string): ProjectContextStore {
    if (!UUID_PATTERN.test(id)) throw new Error("Некорректный идентификатор проекта");
    return new ProjectContextStore(path.join(this.root, id, "context"));
  }
}
