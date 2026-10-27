import type { MeetingResults, TranscriptLine } from "./shared";

/** Corrections append to the journal; the first recognizer output is retained. */
export function correctTranscript(line: TranscriptLine, text: unknown, expectedText: unknown, editedAt: string): TranscriptLine {
  if (typeof text !== "string" || !text.trim() || text.length > 20000) throw new Error("Введите текст реплики, максимум 20 000 символов");
  if (expectedText !== line.text) throw new Error("Реплика уже изменилась. Откройте её заново.");
  if (!Number.isFinite(Date.parse(editedAt))) throw new Error("Некорректное время исправления");
  const corrected = text.trim();
  return corrected === line.text ? line : { ...line, text: corrected, originalText: line.originalText ?? line.text, editedAt };
}

export function invalidateTranscriptResults(results: MeetingResults, lineId: string): MeetingResults {
  return { ...results, revision: results.revision + 1, transcriptStale: true, items: results.items.map(item => item.evidenceIds.includes(lineId) ? { ...item, evidenceStale: true } : item) };
}
