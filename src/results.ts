import { randomUUID } from "node:crypto";
import type { MeetingResults, ResultItem, TranscriptLine } from "./shared";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set<ResultItem["type"]>(["decision", "task", "question"]);
const STATUSES = new Set<ResultItem["status"]>(["draft", "confirmed", "rejected"]);
const AUTHORS = new Set<ResultItem["author"]>(["user", "assistant"]);

function record(value: unknown, message = "Некорректные итоги встречи"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, message = "Некорректные итоги встречи"): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(message);
  return value;
}
function item(value: unknown, evidence: Set<string>): ResultItem {
  const candidate = record(value);
  if (!UUID_PATTERN.test(String(candidate.id)) || !TYPES.has(candidate.type as ResultItem["type"]) || !STATUSES.has(candidate.status as ResultItem["status"]) || !AUTHORS.has(candidate.author as ResultItem["author"])) throw new Error("Некорректный пункт итогов");
  const evidenceIds = candidate.evidenceIds;
  if (candidate.evidenceStale !== undefined && typeof candidate.evidenceStale !== "boolean") throw new Error("Некорректное состояние основания");
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 30 || evidenceIds.some(id => typeof id !== "string" || !evidence.has(id)) || new Set(evidenceIds).size !== evidenceIds.length) throw new Error("Некорректные ссылки на расшифровку");
  return {
    id: String(candidate.id), type: candidate.type as ResultItem["type"], text: text(candidate.text, 4_000, "Некорректный пункт итогов"), evidenceIds: [...evidenceIds],
    status: candidate.status as ResultItem["status"], author: candidate.author as ResultItem["author"],
    assignee: typeof candidate.assignee === "string" && candidate.assignee.length <= 200 ? candidate.assignee : (() => { throw new Error("Некорректный пункт итогов"); })(),
    dueDate: typeof candidate.dueDate === "string" && candidate.dueDate.length <= 200 ? candidate.dueDate : (() => { throw new Error("Некорректный пункт итогов"); })(),
    ...(candidate.evidenceStale !== undefined ? { evidenceStale: candidate.evidenceStale as boolean } : {})
  };
}

export function validateResults(value: unknown, sessionId: string, lines: TranscriptLine[]): MeetingResults {
  if (typeof sessionId !== "string" || (sessionId && !UUID_PATTERN.test(sessionId))) throw new Error("Некорректный идентификатор встречи");
  const candidate = record(value);
  if (candidate.transcriptStale !== undefined && typeof candidate.transcriptStale !== "boolean") throw new Error("Некорректное состояние итогов");
  if (candidate.sessionId !== sessionId || !Number.isSafeInteger(candidate.revision) || (candidate.revision as number) < 0 || !Array.isArray(candidate.items) || candidate.items.length > 150) throw new Error("Некорректные итоги встречи");
  const evidence = new Set(lines.map(line => line.id));
  const items = candidate.items.map(value => item(value, evidence));
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("Повторяется идентификатор пункта итогов");
  return { sessionId, revision: candidate.revision as number, items, ...(candidate.transcriptStale !== undefined ? { transcriptStale: candidate.transcriptStale as boolean } : {}) };
}

export interface GeneratedResults { summary: string; items: ResultItem[] }

export function parseGeneratedResults(source: string, lines: TranscriptLine[]): GeneratedResults {
  if (typeof source !== "string") throw new Error("Ответ помощника должен быть JSON");
  const fenced = source.match(/^```json\s*\r?\n([\s\S]*?)\r?\n?```\s*$/);
  const json = fenced ? fenced[1] : source;
  if (!json.trim() || (!fenced && /```/.test(json))) throw new Error("Ответ помощника должен быть JSON");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error("Ответ помощника должен быть JSON"); }
  const generated = record(value, "Некорректный формат итогов помощника");
  if (typeof generated.summary !== "string" || !generated.summary.trim() || generated.summary.length > 15_000) throw new Error("Помощник не составил содержание записи. Попробуйте ещё раз.");
  const summary = generated.summary;
  if (!Array.isArray(generated.items) || generated.items.length > 100) throw new Error("Некорректный формат итогов помощника");
  const evidence = new Set(lines.map(line => line.id));
  const items = generated.items.map(value => {
    const candidate = record(value, "Некорректный формат итогов помощника");
    const evidenceIds = candidate.evidenceIds;
    if (!TYPES.has(candidate.type as ResultItem["type"]) || !Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 30 || evidenceIds.some(id => typeof id !== "string" || !evidence.has(id)) || new Set(evidenceIds).size !== evidenceIds.length) throw new Error("Некорректные ссылки на расшифровку");
    return {
      id: randomUUID(), type: candidate.type as ResultItem["type"], text: text(candidate.text, 4_000, "Некорректный формат итогов помощника"), evidenceIds: [...evidenceIds],
      status: "draft" as const, author: "assistant" as const,
      assignee: typeof candidate.assignee === "string" && candidate.assignee.length <= 200 ? candidate.assignee : (() => { throw new Error("Некорректный формат итогов помощника"); })(),
      dueDate: typeof candidate.dueDate === "string" && candidate.dueDate.length <= 200 ? candidate.dueDate : (() => { throw new Error("Некорректный формат итогов помощника"); })()
    };
  });
  return { summary, items };
}

function normalized(value: string): string { return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }

export function mergeGeneratedResults(current: MeetingResults, generated: ResultItem[]): MeetingResults {
  const retained = current.items.filter(item => !(item.author === "assistant" && item.status === "draft" && item.evidenceStale));
  const seen = new Set(retained.map(item => `${item.type}\u0000${normalized(item.text)}`));
  const fresh: ResultItem[] = [];
  for (const item of generated) {
    const key = `${item.type}\u0000${normalized(item.text)}`;
    if (!seen.has(key)) { seen.add(key); fresh.push(item); }
  }
  return { sessionId: current.sessionId, revision: current.revision + 1, items: [...retained, ...fresh], ...(current.transcriptStale !== undefined ? { transcriptStale: false } : {}) };
}

function clock(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
const headings: Record<ResultItem["type"], string> = { decision: "Решения", task: "Задачи", question: "Открытые вопросы" };
const labels: Record<ResultItem["status"], string> = { draft: "Черновик", confirmed: "Подтверждено", rejected: "Отклонено" };

export function formatResultsMarkdown(results: MeetingResults, lines: TranscriptLine[]): string {
  const byId = new Map(lines.map(line => [line.id, line]));
  const output = ["## Итоги встречи"];
  if (results.transcriptStale) output.push("", "Расшифровка исправлена. Краткое содержание и пункты требуют проверки.");
  for (const type of ["decision", "task", "question"] as const) {
    output.push("", `### ${headings[type]}`);
    const items = results.items.filter(item => item.type === type);
    if (!items.length) { output.push("- Нет пунктов."); continue; }
    for (const item of items) {
      output.push(`- **${item.evidenceStale ? "Требует повторной проверки" : labels[item.status]}** — ${item.text}`);
      if (item.evidenceStale) output.push("  - Основание исправлено: требуется повторная проверка пункта.");
      if (item.assignee) output.push(`  - Исполнитель: ${item.assignee}`);
      if (item.dueDate) output.push(`  - Срок: ${item.dueDate}`);
      if (!item.evidenceIds.length) output.push("  - Основание: не указано");
      for (const id of item.evidenceIds) {
        const line = byId.get(id);
        output.push(line ? `  - Основание ${clock(line.startMs)}: ${line.text}` : `  - Основание: реплика ${id} недоступна`);
      }
    }
  }
  return output.join("\n") + "\n";
}
