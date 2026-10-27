import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isSensitiveContextFileName } from "./context-store";

const PAGE_SIZE = 200;
const SEARCH_MATCHES = 80;
const SEARCH_ENTRIES = 100_000;
const SEARCH_MILLISECONDS = 8_000;
const READ_MAX_BYTES = 8 * 1024 * 1024;
const READ_MAX_LINES = 200;
const READ_MAX_OUTPUT_BYTES = 24 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "vendor", "build", "dist", "coverage", ".next", ".venv", "venv", "target", "cache"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".pfx", ".p12", ".kdbx", ".keystore"]);

export const repositoryTools = [
  {
    type: "function",
    name: "repo_list",
    description: "List normal files and directories below the selected repository folder. Paths are repository-relative.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { path: { type: "string", description: "Optional POSIX relative directory." }, offset: { type: "integer", minimum: 0, description: "Pagination offset." } }
    }
  },
  {
    type: "function",
    name: "repo_search",
    description: "Literal repository search. Use mode text for file contents or filename for names; results are bounded and never include source paths outside the selected repository.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        mode: { type: "string", enum: ["text", "filename"] },
        path: { type: "string", description: "Optional POSIX relative directory to narrow the search." }
      }
    }
  },
  {
    type: "function",
    name: "repo_read",
    description: "Read a UTF-8 text file below the selected repository with a bounded line range.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, description: "POSIX relative file path." },
        startLine: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: READ_MAX_LINES }
      }
    }
  }
] as const;

type Root = { lexical: string; resolved: string };

function relativePath(value: unknown, allowEmpty = false): string[] {
  if (typeof value !== "string" || value.length > 500 || (!allowEmpty && !value.length) || path.isAbsolute(value) || value.startsWith("//") || value.startsWith("\\\\") || value.includes("\\")) throw new Error("Некорректный путь репозитория");
  if (!value) return [];
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("Некорректный путь репозитория");
  return parts;
}

function display(parts: string[]): string { return parts.join("/"); }
function insideOrSame(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function isSkippedDirectory(name: string): boolean {
  return name.startsWith(".") || SKIPPED_DIRECTORIES.has(name.toLowerCase()) || isSensitiveContextFileName(name);
}
function isSensitiveFile(name: string): boolean {
  return name.startsWith(".") || isSensitiveContextFileName(name) || SENSITIVE_EXTENSIONS.has(path.extname(name).toLowerCase());
}
function text(bytes: Buffer): string {
  let value: string;
  try { value = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Файл не является текстом UTF-8"); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error("Двоичные файлы не поддерживаются");
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(value)) throw new Error("Файлы с закрытыми ключами недоступны");
  return value;
}
function integer(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new Error(`Некорректный параметр ${label}`);
  return value as number;
}
function truncateUtf8(value: string, bytes: number): string {
  let used = 0;
  let result = "";
  for (const character of value) {
    const next = Buffer.byteLength(character, "utf8");
    if (used + next > bytes) return result;
    result += character;
    used += next;
  }
  return result;
}
function sameIdentity(first: { dev: number | bigint; ino: number | bigint }, second: { dev: number | bigint; ino: number | bigint }): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

/** Read-only, bounded access to a single repository chosen by the native host. */
export class RepositoryReader {
  constructor(private readonly root: string, private readonly signal?: AbortSignal) {}
  private active() { if (this.signal?.aborted) throw new Error("Чтение репозитория отменено"); }

  private async checkedRoot(): Promise<Root> {
    this.active();
    if (typeof this.root !== "string" || !path.isAbsolute(this.root)) throw new Error("Папка репозитория недоступна");
    try {
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Папка репозитория недоступна");
      const lexical = path.resolve(this.root);
      const resolved = await realpath(this.root);
      if (lexical.toLowerCase() !== resolved.toLowerCase()) throw new Error("Папка репозитория недоступна");
      return { lexical, resolved };
    } catch { throw new Error("Папка репозитория недоступна"); }
  }

  private async target(root: Root, value: unknown, kind: "file" | "directory", allowEmpty = false): Promise<{ path: string; relative: string[]; info: Awaited<ReturnType<typeof lstat>> }> {
    this.active();
    const relative = relativePath(value, allowEmpty);
    if (relative.some(part => isSkippedDirectory(part) || isSensitiveFile(part))) throw new Error("Ресурс репозитория недоступен");
    try {
      const rootInfo = await lstat(root.lexical);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root.lexical)).toLowerCase() !== root.resolved.toLowerCase()) throw new Error("Папка репозитория недоступна");
    } catch { throw new Error("Папка репозитория недоступна"); }
    const candidate = path.resolve(root.lexical, ...relative);
    if (!insideOrSame(root.lexical, candidate)) throw new Error("Путь находится вне репозитория");
    let current = root.lexical;
    try {
      for (const part of relative) {
        current = path.join(current, part);
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error("Ссылки в репозитории недоступны");
      }
      const info = await lstat(candidate);
      if (info.isSymbolicLink() || (kind === "file" ? !info.isFile() : !info.isDirectory())) throw new Error("Ресурс репозитория недоступен");
      const resolved = await realpath(candidate);
      if (!insideOrSame(root.resolved, resolved)) throw new Error("Путь находится вне репозитория");
      return { path: candidate, relative, info };
    } catch (error) {
      if (error instanceof Error && /Ссылки|вне репозитория/.test(error.message)) throw error;
      throw new Error("Ресурс репозитория недоступен");
    }
  }

  private async eligibleFile(root: Root, relative: string[]): Promise<{ text: string } | null> {
    let checked;
    try { checked = await this.target(root, display(relative), "file"); }
    catch { return null; }
    if (isSensitiveFile(path.basename(checked.path)) || checked.info.size > READ_MAX_BYTES) return null;
    const expected = checked.info;
    let handle;
    try {
      handle = await open(checked.path, "r");
      const before = await handle.stat();
      if (!before.isFile() || before.size !== expected.size || !sameIdentity(expected, before) || before.size > READ_MAX_BYTES) return null;
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let offset = 0;
      while (offset < bytes.length) {
        this.active();
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (offset !== before.size || after.size !== before.size || !sameIdentity(before, after) || offset > READ_MAX_BYTES) return null;
      // Re-check every component after the handle read before returning its contents.
      const current = await this.target(root, display(relative), "file");
      if (!sameIdentity(expected, current.info) || current.info.size !== before.size) return null;
      return { text: text(bytes.subarray(0, offset)) };
    } catch { return null; }
    finally { await handle?.close().catch(() => {}); }
  }

  async call(tool: string, args: unknown): Promise<string> {
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Некорректные параметры инструмента");
    const root = await this.checkedRoot();
    if (tool === "repo_list") return JSON.stringify(await this.list(root, args as Record<string, unknown>));
    if (tool === "repo_search") return JSON.stringify(await this.search(root, args as Record<string, unknown>));
    if (tool === "repo_read") return JSON.stringify(await this.read(root, args as Record<string, unknown>));
    throw new Error("Неизвестный инструмент репозитория");
  }

  private async list(root: Root, args: Record<string, unknown>): Promise<unknown> {
    const { path: directory, relative } = await this.target(root, args.path ?? "", "directory", true);
    const offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER, "offset");
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { throw new Error("Папка репозитория недоступна"); }
    const visible: Array<{ name: string; path: string; kind: "file" | "directory"; bytes?: number }> = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      this.active();
      if (entry.name.startsWith(".")) continue;
      const child = path.join(directory, entry.name);
      let info;
      try { info = await lstat(child); }
      catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (isSkippedDirectory(entry.name)) continue;
        visible.push({ name: entry.name, path: display([...relative, entry.name]), kind: "directory" });
      } else if (info.isFile() && !isSensitiveFile(entry.name)) {
        visible.push({ name: entry.name, path: display([...relative, entry.name]), kind: "file", bytes: info.size });
      }
    }
    const page = visible.slice(offset, offset + PAGE_SIZE);
    return { path: display(relative), entries: page, nextOffset: offset + PAGE_SIZE < visible.length ? offset + PAGE_SIZE : null };
  }

  private async search(root: Root, args: Record<string, unknown>): Promise<unknown> {
    const query = args.query;
    if (typeof query !== "string" || !query.length || query.length > 500) throw new Error("Укажите поисковый запрос до 500 символов");
    const mode = args.mode === undefined ? "text" : args.mode;
    if (mode !== "text" && mode !== "filename") throw new Error("Некорректный режим поиска");
    const { relative: base } = await this.target(root, args.path ?? "", "directory", true);
    const deadline = Date.now() + SEARCH_MILLISECONDS;
    const matches: Array<{ path: string; line?: number; preview?: string }> = [];
    let inspected = 0;
    let truncated = false;
    const walk = async (segments: string[]): Promise<void> => {
      if (truncated) return;
      let directory;
      try { directory = (await this.target(root, display(segments), "directory", true)).path; }
      catch { return; }
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        this.active();
        if (Date.now() >= deadline || inspected >= SEARCH_ENTRIES || matches.length >= SEARCH_MATCHES) { truncated = true; return; }
        inspected++;
        if (entry.name.startsWith(".")) continue;
        if (entry.isSymbolicLink()) continue;
        const next = [...segments, entry.name];
        if (entry.isDirectory()) {
          if (!isSkippedDirectory(entry.name)) await walk(next);
          continue;
        }
        if (!entry.isFile() || isSensitiveFile(entry.name)) continue;
        const relative = display(next);
        if (mode === "filename") {
          if (!relative.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))) continue;
          try { await this.target(root, relative, "file"); }
          catch { continue; }
          matches.push({ path: relative });
          continue;
        }
        const content = await this.eligibleFile(root, next);
        if (!content) continue;
        const found = content.text.indexOf(query);
        if (found < 0) continue;
        let line = 1;
        for (let index = 0; index < found; index++) if (content.text.charCodeAt(index) === 10) line++;
        const preview = content.text.slice(Math.max(0, found - 120), found + query.length + 240).replace(/\s+/g, " ");
        matches.push({ path: relative, line, preview: truncateUtf8(preview, 512) });
      }
    };
    await walk(base);
    return { mode, query, matches, inspectedEntries: inspected, truncated, note: truncated ? "Поиск ограничен 80 совпадениями, 100 000 элементами или 8 секундами; сузьте папку или запрос." : undefined };
  }

  private async read(root: Root, args: Record<string, unknown>): Promise<unknown> {
    const { path: file, relative } = await this.target(root, args.path, "file");
    if (isSensitiveFile(path.basename(file))) throw new Error("Чувствительные файлы недоступны");
    const content = await this.eligibleFile(root, relative);
    if (!content) throw new Error("Доступен только UTF-8 текстовый файл до 8 МБ");
    const startLine = integer(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER, "startLine");
    const limit = integer(args.limit, 100, 1, READ_MAX_LINES, "limit");
    const lines: Array<{ number: number; text: string }> = [];
    let used = 0;
    let outputTruncated = false;
    let totalLines = 0;
    let lineNumber = 1;
    let start = 0;
    while (start <= content.text.length) {
      const end = content.text.indexOf("\n", start);
      const boundary = end < 0 ? content.text.length : end;
      totalLines++;
      if (lineNumber >= startLine && lines.length < limit && !outputTruncated) {
        const prefix = `${lineNumber}: `;
        const remaining = READ_MAX_OUTPUT_BYTES - used - Buffer.byteLength(prefix, "utf8");
        if (remaining <= 0) outputTruncated = true;
        else {
          const source = content.text.slice(start, boundary);
          const value = truncateUtf8(source, remaining);
          lines.push({ number: lineNumber, text: value });
          used += Buffer.byteLength(prefix + value, "utf8");
          if (value.length < source.length || used >= READ_MAX_OUTPUT_BYTES) outputTruncated = true;
        }
      }
      if (end < 0) break;
      start = end + 1;
      lineNumber++;
    }
    const endLine = lines.length ? lines.at(-1)!.number : startLine - 1;
    return { path: display(relative), startLine, endLine, totalLines, truncated: outputTruncated || endLine < totalLines, lines };
  }
}
