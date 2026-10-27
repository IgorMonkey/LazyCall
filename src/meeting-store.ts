import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { validateResults } from "./results";
import { correctTranscript, invalidateTranscriptResults } from "./transcript";
import type { AssistantMessage, MeetingResults, MeetingSnapshot, MeetingSummary, TranscriptLine } from "./shared";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface JournalEvent { schemaVersion: number; seq: number; recordedAtUtc: string; type: string; payload: unknown }
export interface JournalContents { events: JournalEvent[]; validBytes: number; needsNewline: boolean }

export async function sessionPath(root: string, id: string): Promise<string> {
  if (!UUID_PATTERN.test(id)) throw new Error("Некорректный идентификатор встречи");
  const directory = path.join(root, id);
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Ссылка вместо папки встречи");
  const [resolvedRoot, resolvedDirectory] = await Promise.all([realpath(root), realpath(directory)]);
  if (path.dirname(resolvedDirectory).toLowerCase() !== resolvedRoot.toLowerCase()) throw new Error("Папка встречи вне хранилища");
  const file = path.join(directory, "events.jsonl");
  if ((await lstat(file)).isSymbolicLink()) throw new Error("Ссылка вместо журнала встречи");
  return file;
}

/** An unfinished final write can be recovered; malformed complete rows are never hidden. */
export async function readJournal(file: string): Promise<JournalContents> {
  const bytes = await readFile(file);
  const events: JournalEvent[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(10, offset);
    const end = newline < 0 ? bytes.length : newline;
    let row: JournalEvent;
    try { row = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset, end))); }
    catch {
      if (newline < 0) return { events, validBytes: offset, needsNewline: false };
      throw new Error(`Повреждён журнал встречи: строка ${events.length + 1}`);
    }
    if (row?.schemaVersion !== 1 || !Number.isSafeInteger(row.seq) || row.seq !== events.length + 1 || typeof row.type !== "string" || !Number.isFinite(Date.parse(row.recordedAtUtc))) {
      throw new Error(`Некорректное событие встречи: строка ${events.length + 1}`);
    }
    events.push(row);
    if (newline < 0) return { events, validBytes: bytes.length, needsNewline: true };
    offset = newline + 1;
  }
  return { events, validBytes: bytes.length, needsNewline: false };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Повреждены данные встречи");
  return value as Record<string, unknown>;
}
function isTranscript(value: unknown): value is TranscriptLine {
  const v = object(value);
  return typeof v.id === "string" && (v.source === "self" || v.source === "remote") && typeof v.text === "string" && typeof v.startMs === "number" && Number.isFinite(v.startMs) && typeof v.endMs === "number" && Number.isFinite(v.endMs);
}
function isMessage(value: unknown): value is AssistantMessage {
  const v = object(value);
  if (v.origin !== undefined && v.origin !== "user" && v.origin !== "reply") return false;
  if (v.progress !== undefined) {
    const progress = object(v.progress);
    if (!["starting", "reading", "analyzing", "writing"].includes(String(progress.stage)) || !Number.isSafeInteger(progress.filesRead) || (progress.filesRead as number) < 0) return false;
  }
  if (v.context !== undefined) {
    const context = object(v.context);
    if (typeof context.projectName !== "string" || context.projectName.length > 200 || !["connected", "unavailable", "none"].includes(String(context.repository)) || typeof context.brief !== "boolean" || !Number.isSafeInteger(context.documents) || (context.documents as number) < 0) return false;
  }
  if (v.replyToLineId !== undefined && (typeof v.replyToLineId !== "string" || v.replyToLineId.length > 100)) return false;
  if (v.replyToLine !== undefined && (!isTranscript(v.replyToLine) || v.replyToLine.source !== "remote" || v.replyToLine.id !== v.replyToLineId)) return false;
  return typeof v.id === "string" && (v.role === "user" || v.role === "assistant") && typeof v.text === "string" && ["streaming", "done", "error"].includes(String(v.state)) && ["answer", "research", "summary"].includes(String(v.kind)) && typeof v.createdAt === "number" && Number.isFinite(v.createdAt);
}
function projectPayload(value: unknown): { id: string | null; name?: string } {
  const payload = object(value);
  if (payload.id === null) {
    if (payload.name !== undefined && payload.name !== null) throw new Error("Повреждён проект встречи");
    return { id: null };
  }
  if (!UUID_PATTERN.test(String(payload.id)) || typeof payload.name !== "string" || !payload.name.trim() || payload.name.length > 100) throw new Error("Повреждён проект встречи");
  return { id: payload.id as string, name: payload.name };
}

export class MeetingStore {
  constructor(private readonly root: string) {}
  async list(): Promise<MeetingSummary[]> {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const meetings = await Promise.all(entries.filter(entry => entry.isDirectory() && UUID_PATTERN.test(entry.name)).map(async entry => (await this.load(entry.name)).meeting));
    return meetings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async load(id: string): Promise<MeetingSnapshot> {
    const { events } = await readJournal(await sessionPath(this.root, id));
    const started = events.find(event => event.type === "session.started");
    if (!started) throw new Error("В журнале нет начала встречи");
    const initial = object(started.payload);
    if (initial.id !== id || typeof initial.startedAt !== "string" || !Number.isFinite(Date.parse(initial.startedAt))) throw new Error("Повреждено начало встречи");
    const results: MeetingResults = { sessionId: id, revision: 0, items: [] };
    const snapshot: MeetingSnapshot = { meeting: { id, startedAt: initial.startedAt, title: "Встреча", interrupted: true }, lines: [], note: "", messages: [], goal: "", results };
    const messages = new Map<string, AssistantMessage>();
    for (const event of events) {
      if (event.type === "session.project") {
        const project = projectPayload(event.payload);
        if (project.id === null) {
          delete snapshot.meeting.projectId;
          delete snapshot.meeting.projectName;
        } else {
          snapshot.meeting.projectId = project.id;
          snapshot.meeting.projectName = project.name;
        }
        continue;
      }
      const payload = object(event.payload);
      if (event.type === "transcript.final") {
        if (!isTranscript(payload)) throw new Error("Повреждена реплика встречи");
        snapshot.lines.push(payload);
      } else if (event.type === "transcript.edited") {
        const index = snapshot.lines.findIndex(line => line.id === payload.lineId);
        if (index < 0 || typeof payload.editedAt !== "string") throw new Error("Повреждено исправление реплики");
        const corrected = correctTranscript(snapshot.lines[index], payload.text, payload.previousText, payload.editedAt);
        if (corrected !== snapshot.lines[index]) {
          snapshot.lines[index] = corrected;
          snapshot.results = invalidateTranscriptResults(snapshot.results, corrected.id);
        }
      } else if (event.type === "note.edited") {
        if (typeof payload.text !== "string") throw new Error("Повреждена заметка встречи");
        snapshot.note = payload.text;
      } else if (event.type === "assistant.message") {
        if (!isMessage(payload)) throw new Error("Повреждено сообщение помощника");
        messages.set(payload.id, payload);
      } else if (event.type === "context.goal") {
        if (typeof payload.goal !== "string") throw new Error("Повреждена цель встречи");
        snapshot.goal = payload.goal;
      } else if (event.type === "results.edited") {
        const next = validateResults(payload, id, snapshot.lines);
        if (next.revision !== snapshot.results.revision + 1) throw new Error("Некорректная версия итогов встречи");
        snapshot.results = next;
      } else if (event.type === "session.stopped") {
        if (typeof payload.endedAt !== "string" || !Number.isFinite(Date.parse(payload.endedAt))) throw new Error("Повреждено завершение встречи");
        snapshot.meeting.endedAt = payload.endedAt;
        snapshot.meeting.interrupted = false;
      }
    }
    snapshot.messages = [...messages.values()].map(message => message.state === "streaming" ? { ...message, state: "error" } : message);
    const title = (snapshot.goal || snapshot.note).trim().split(/\r?\n/)[0];
    if (title) snapshot.meeting.title = title.slice(0, 100);
    return snapshot;
  }
}
