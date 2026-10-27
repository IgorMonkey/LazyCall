import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { CONTEXT_MAX_FILE_BYTES, CONTEXT_MAX_FILES, isContextFileAllowed, isSensitiveContextFileName, validContextRelativePath } from "./context-store";

const MAX_DEPTH = 6;
const MAX_ENTRIES = 2_500;
const MAX_CANDIDATES = 120;
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "vendor", "build", "dist", "coverage", ".next", ".venv", "venv", "target", "cache"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ContextFolderCandidate {
  id: string;
  name: string;
  bytes: number;
  path: string;
  /** Main-process-only hash, used to identify a changed source between previews. */
  fingerprint?: string;
  /** Bounded text retained only for local topic ranking; never sent to the renderer. */
  suggestionText?: string;
  recommended?: boolean;
  reason?: string;
  changed?: boolean;
}
export interface ContextFolderScan { name: string; files: ContextFolderCandidate[]; truncated: boolean }

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !!relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}
function priority(name: string): number {
  const lower = name.toLowerCase();
  if (/(^|\/)readme(?:\.[^/]*)?$/.test(lower)) return 0;
  if (lower.startsWith("docs/")) return 1;
  if (/(^|\/)(package\.json|tsconfig(?:\.[^/]*)?\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json|pom\.xml)$/.test(lower)) return 2;
  return 3;
}
function compare(a: ContextFolderCandidate, b: ContextFolderCandidate): number {
  return priority(a.name) - priority(b.name) || a.name.localeCompare(b.name, "en");
}
function topicWords(topic?: string): string[] {
  if (typeof topic !== "string") return [];
  const ignored = new Set(["about", "after", "and", "are", "for", "from", "that", "the", "this", "with", "без", "для", "или", "как", "над", "под", "при", "про", "что", "это"]);
  const words = [...new Set((topic.normalize("NFKC").toLocaleLowerCase("ru").match(/[\p{L}\p{N}_-]+/gu) || [])
    .map(word => word.replace(/ё/g, "е")).filter(word => word.length > 1 && !ignored.has(word)))].slice(0, 24);
  // Common repository terminology lets a Russian topic match English source names.
  const aliases: Array<[RegExp, string[]]> = [
    [/^поиск/, ["search", "filter"]], [/^заяв/, ["ticket", "request"]],
    [/^(оплат|платеж)/, ["payment", "billing"]], [/^пользоват/, ["user", "account"]],
    [/^(вход|авторизац)/, ["login", "signin", "authorization"]], [/^настрой/, ["settings", "config"]],
    [/^расшифров/, ["transcript", "whisper"]], [/^звук/, ["audio", "capture"]],
    [/^экран/, ["screen", "frame"]], [/^итог/, ["summary", "result"]]
  ];
  const expanded = [...words];
  for (const [pattern, terms] of aliases) if (words.some(word => pattern.test(word))) expanded.push(...terms);
  return [...new Set(expanded)].slice(0, 40);
}
function architectureReason(name: string): string | null {
  const lower = name.toLowerCase();
  if (/(^|\/)readme(?:\.[^/]*)?$/.test(lower)) return "Обзор проекта";
  if (/(^|\/)(architecture|arch|design|overview|structure|adr)(?:[._-]|$)/.test(lower)) return "Устройство проекта";
  if (lower.startsWith("docs/")) return "Документация проекта";
  if (/(^|\/)(package\.json|tsconfig(?:\.[^/]*)?\.json|pyproject\.toml|cargo\.toml|go\.mod|composer\.json|pom\.xml)$/.test(lower)) return "Состав и настройки проекта";
  return null;
}
function matches(text: string, word: string): number {
  let found = 0;
  let from = 0;
  while (found < 8) {
    const at = text.indexOf(word, from);
    if (at < 0) break;
    found++;
    from = at + word.length;
  }
  return found;
}

/**
 * Ranks a previously bounded preview. It never reads the folder or follows paths,
 * so a caller may safely use it for repeated topic changes on the same preview.
 */
export function suggestContextFiles(files: ContextFolderCandidate[], topic?: string): ContextFolderCandidate[] {
  const words = topicWords(topic);
  const ranked = files.map(file => {
    const lowerName = file.name.toLocaleLowerCase("ru").replace(/ё/g, "е");
    const text = (file.suggestionText || "").toLocaleLowerCase("ru").replace(/ё/g, "е");
    const base = architectureReason(file.name);
    let topicHits = 0;
    for (const word of words) topicHits += matches(lowerName, word) * 20 + matches(text, word);
    const score = topicHits * 100 + (base ? 20 - priority(file.name) : 0);
    const reason = topicHits ? `Связано с темой: ${words.filter(word => lowerName.includes(word) || text.includes(word)).slice(0, 3).join(", ")}` : base || undefined;
    return { file, score, reason, topicHits };
  }).sort((a, b) => b.score - a.score || compare(a.file, b.file));
  const recommended = new Set(ranked.filter(item => item.topicHits > 0 || !!architectureReason(item.file.name)).slice(0, CONTEXT_MAX_FILES).map(item => item.file.id));
  const reasons = new Map(ranked.map(item => [item.file.id, item.reason]));
  return ranked.map(({ file }) => ({ ...file, recommended: recommended.has(file.id), reason: reasons.get(file.id) }));
}
function textFile(bytes: Buffer): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text);
  } catch { return false; }
}
async function checkedRoot(root: string): Promise<{ lexical: string; resolved: string }> {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("Некорректная папка материалов");
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Папка материалов не должна быть ссылкой");
  return { lexical: path.resolve(root), resolved: await realpath(root) };
}

/** Produces a bounded, non-following preview; absolute paths remain in the main process only. */
export async function scanContextFolder(root: string, topic?: string): Promise<ContextFolderScan> {
  const checked = await checkedRoot(root);
  const files: ContextFolderCandidate[] = [];
  let entries = 0;
  let scannedBytes = 0;
  let truncated = false;
  let stopped = false;
  const walk = async (directory: string, segments: string[], depth: number): Promise<void> => {
    if (stopped) return;
    let children;
    try { children = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    children.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const child of children) {
      if (entries >= MAX_ENTRIES) { truncated = true; stopped = true; return; }
      entries++;
      if (child.name.startsWith(".")) continue;
      const childPath = path.join(directory, child.name);
      let info;
      try { info = await lstat(childPath); }
      catch { continue; }
      if (info.isSymbolicLink()) continue;
      const childSegments = [...segments, child.name];
      if (info.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(child.name.toLowerCase()) && !isSensitiveContextFileName(child.name) && depth < MAX_DEPTH) await walk(childPath, childSegments, depth + 1);
        continue;
      }
      if (!info.isFile() || info.size > CONTEXT_MAX_FILE_BYTES || isSensitiveContextFileName(child.name) || !isContextFileAllowed(child.name)) continue;
      if (scannedBytes + info.size > MAX_SCANNED_BYTES) { truncated = true; continue; }
      scannedBytes += info.size;
      let bytes: Buffer;
      try { bytes = await readFile(childPath); }
      catch { continue; }
      if (bytes.length > CONTEXT_MAX_FILE_BYTES || !textFile(bytes)) continue;
      files.push({ id: randomUUID(), name: childSegments.join("/"), bytes: bytes.length, path: childPath,
        fingerprint: createHash("sha256").update(bytes).digest("hex"), suggestionText: bytes.toString("utf8", 0, 16 * 1024) });
      if (files.length > MAX_CANDIDATES) { files.splice(0, files.length, ...suggestContextFiles(files, topic)); files.pop(); truncated = true; }
    }
  };
  await walk(checked.lexical, [], 0);
  files.sort(compare);
  return { name: path.basename(checked.lexical), files: suggestContextFiles(files, topic), truncated };
}

async function noLinks(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Ссылки в папке материалов не поддерживаются");
  }
}

export async function resolveContextSelection(root: string, files: ContextFolderCandidate[], ids: string[]): Promise<{ paths: string[]; relativeNames: string[] }> {
  const checked = await checkedRoot(root);
  if (!Array.isArray(ids) || !ids.length || ids.length > CONTEXT_MAX_FILES || new Set(ids).size !== ids.length || !Array.isArray(files)) throw new Error(`Выберите от 1 до ${CONTEXT_MAX_FILES} файлов`);
  const byId = new Map(files.map(file => [file.id, file]));
  const paths: string[] = [];
  const relativeNames: string[] = [];
  for (const id of ids) {
    const file = byId.get(id);
    if (!file || !UUID_PATTERN.test(file.id) || typeof file.path !== "string" || !path.isAbsolute(file.path) || !validContextRelativePath(file.name)) throw new Error("Некорректный выбор материалов");
    const target = path.resolve(file.path);
    const expected = path.resolve(checked.lexical, ...file.name.split("/"));
    if (target.toLowerCase() !== expected.toLowerCase() || !inside(checked.lexical, target)) throw new Error("Файл находится вне выбранной папки");
    await noLinks(checked.lexical, target);
    const [info, resolved] = await Promise.all([lstat(target), realpath(target)]);
    if (!info.isFile() || info.isSymbolicLink() || !inside(checked.resolved, resolved) || info.size > CONTEXT_MAX_FILE_BYTES || isSensitiveContextFileName(path.basename(target)) || !isContextFileAllowed(path.basename(target))) throw new Error("Файл больше не подходит для материалов");
    const bytes = await readFile(target);
    if (bytes.length > CONTEXT_MAX_FILE_BYTES || !textFile(bytes)) throw new Error("Файл больше не подходит для материалов");
    paths.push(target);
    relativeNames.push(file.name);
  }
  return { paths, relativeNames };
}
