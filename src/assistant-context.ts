import type { AssistantMessage, TranscriptLine } from "./shared";

function terms(text: string): Set<string> {
  const stop = new Set(["котор", "можно", "нужн", "просто", "будет", "этот", "того", "тогда", "только", "вопрос", "ответ", "проект", "помоги", "предложи", "репли", "собесед", "чтобы", "через", "какой", "какие", "сейчас"]);
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []).filter(word => ![...stop].some(common => word.startsWith(common))).map(word => word.length > 5 ? word.slice(0, 5) : word));
}

/** A STT chunk is an anchor inside a question, not necessarily the whole question. */
export function replyBlock(lines: TranscriptLine[], target: TranscriptLine): TranscriptLine[] {
  const index = lines.findIndex(line => line.id === target.id);
  if (index < 0) return [target];
  let start = index;
  while (start > 0 && index - start < 5) {
    const before = lines[start - 1], current = lines[start];
    if (before.source !== "remote" || current.startMs - before.endMs > 12_000 || target.endMs - before.startMs > 45_000) break;
    start--;
  }
  return lines.slice(start, index + 1);
}

/** Keep the current exchange and earlier topic evidence, even in a long meeting. */
export function transcriptContext(lines: TranscriptLine[], question: string, target?: TranscriptLine): TranscriptLine[] {
  const end = target ? lines.findIndex(line => line.id === target.id) + 1 : lines.length;
  const available = lines.slice(0, Math.max(0, end));
  const recentStart = Math.max(0, available.length - 20);
  const selected = new Set(available.slice(recentStart).map(line => line.id));
  const keywords = terms(question + " " + (target ? replyBlock(available, target).map(line => line.text).join(" ") : ""));
  const ranked = available.slice(0, recentStart).map((line, index) => {
    const words = terms(line.text);
    return { index, score: [...keywords].filter(word => words.has(word)).length };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 12);
  for (const { index } of ranked) for (let nearby = Math.max(0, index - 1); nearby <= Math.min(available.length - 1, index + 1); nearby++) selected.add(available[nearby].id);
  return available.filter(line => selected.has(line.id));
}

/** Auto-generated reply requests must not push the user's own instructions out of memory. */
export function assistantHistory(messages: AssistantMessage[]): { text: string; manualRequests: number } {
  const done = messages.filter(message => message.state === "done");
  const manual = done.filter(message => message.role === "user" && message.origin !== "reply" && (message.origin === "user" || !/^Предложи ответ на реплику \d+:\d+:/.test(message.text))).slice(-6);
  const replies = done.filter(message => message.role === "assistant" && message.kind !== "summary").slice(-2);
  const previous = [...manual, ...replies].sort((a, b) => a.createdAt - b.createdAt);
  return { text: previous.map(message => `${message.role === "user" ? "Запрос пользователя" : "Предыдущий ответ помощника"}: ${message.text.slice(0, message.role === "user" ? 1600 : 2000)}`).join("\n"), manualRequests: manual.length };
}

export function replyContract(target: TranscriptLine, block: TranscriptLine[], repository: boolean): string {
  return `РЕЖИМ СУФЛЁРА. Пользователь должен ответить собеседнику, а не задать ему тот же технический вопрос. Дай готовую короткую формулировку от лица пользователя: сначала ответ по существу в 1–3 предложениях, при необходимости ещё 2–3 подтверждающих факта. Отвечай на языке реплики собеседника, если пользователь явно не попросил другой язык. Это речь пользователя, а не отчёт агента о работе. Не пиши «проверю», «поищу», «подготовлю» и планы исследования вместо ответа.\n` +
    `Якорь вопроса: ${target.id}. Распознавание режет речь на фрагменты; прочитай весь блок ниже и предыдущее обсуждение. Отвечай на смысл вопроса в этом блоке, не переключайся на более позднюю реплику.\n<вопрос_собеседника>\n${block.map(line => `[${Math.floor(line.startMs / 1000)}s, ${line.id}] ${line.text}`).join("\n")}\n</вопрос_собеседника>\n` +
    `${repository ? "Папка проекта действительно подключена, доступны repo_list/repo_search/repo_read. Используй обзор и проверенные фрагменты. Если вопрос требует деталей реализации, сначала адресно проверь нужный код/контракт. Не проси собеседника уточнить факт, который можно проверить в папке. Не начинай полный разбор репозитория для короткой подсказки." : "Опирайся на разговор и доступные материалы. Если папка не подключена, не утверждай, что проверил код."}\n` +
    `Отделяй существующую реализацию от обсуждаемого варианта. Для вопроса о будущем решении можно предложить вариант словами «Можно сделать так…», явно обозначив предложение. Если точный порог, роль или параметр не подтверждены, скажи это прямо, затем дай известную часть ответа; не выдумывай значение и не заменяй весь ответ встречным «а как?». Уточняющий вопрос допустим только когда без него невозможно восстановить смысл или нужно личное решение пользователя. Если в блоке вообще нет вопроса или просьбы, кратко сообщи об этом, не придумывай их.`;
}
