import type { AssistantMessage } from "../shared";

export function assistantActivity(message: AssistantMessage): string {
  if (message.progress?.stage === "reading") return message.progress.filesRead > 0 ? `Читает файлы проекта: ${message.progress.filesRead}…` : "Читает файлы проекта…";
  if (message.progress?.stage === "analyzing") return message.context?.repository === "connected" ? "Изучает проект…" : "Разбирает вопрос…";
  return message.kind === "summary" ? "Составляет итоги…" : "Готовит ответ…";
}
