import { useEffect, useRef, useState } from "react";
import type { AgentStatus, AssistantMessage, AssistantRequest, TranscriptLine } from "../shared";
import { Button, Checkbox, TextArea } from "./ui";
import { MessageText } from "./MessageText";
import { useTranscriptFollow } from "./useTranscriptFollow";
import { assistantActivity } from "./assistant-activity";
import { useI18n } from "./i18n";

const timestamp = (ms: number) => String(Math.floor(ms / 60000)).padStart(2, "0") + ":" + String(Math.floor(ms / 1000) % 60).padStart(2, "0");
const contextLabel = (message: AssistantMessage, t: (key: string, vars?: Record<string, string | number>) => string) => {
  const context = message.context;
  if (!context) return null;
  if (!context.projectName) return context.repository === "unavailable" ? { label: t("Папка проекта недоступна"), title: t("Папка проекта недоступна") } : null;
  const repository = context.repository === "connected" ? t("Папка подключена") : context.repository === "unavailable" ? t("Папка проекта недоступна") : t("Папка проекта не подключена");
  return { label: t("Проект: {name}", { name: context.projectName }), title: `${repository}; ${context.brief ? t("обзор передан") : t("обзор не подготовлен")}; ${t("документов: {count}", { count: context.documents })}` };
};

export function Assistant({ status, messages, hasSession, hasTranscript, phase, enterToSend, replyTarget, sessionEpoch, note, onPrepared, onAddNote, onError, onOpenResults }: {
  status: AgentStatus; messages: AssistantMessage[]; hasSession: boolean; hasTranscript: boolean; phase: string; enterToSend: boolean; replyTarget?: TranscriptLine; sessionEpoch: number; note: string; onPrepared: (sessionId: string) => void; onAddNote: (text: string) => void; onError: (text: string) => void; onOpenResults: () => void;
}) {
  const { locale, t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState("");
  const currentEpoch = useRef(sessionEpoch);
  currentEpoch.current = sessionEpoch;
  const { viewport: area, body, awayFromBottom, followLatest, onScroll } = useTranscriptFollow(messages);
  const last = messages.at(-1);
  const streamingMessage = [...messages].reverse().find(message => message.state === "streaming");
  const streaming = !!streamingMessage;
  const cancelId = streamingMessage?.id || requestId;
  const busy = sending || streaming;
  const ready = status.state === "ready";
  useEffect(() => { setRequestId(""); setPrompt(""); setSending(false); followLatest(); }, [sessionEpoch, followLatest]);
  const ask = async (mode: AssistantRequest["mode"], defaultText?: string, replyToLineId?: string) => {
    const text = defaultText || prompt.trim();
    if (busy || !ready || (mode !== "summary" && !text)) return;
    const requestEpoch = currentEpoch.current;
    setSending(true);
    try {
      const result = await window.callme.agentAsk({ text: mode === "summary" ? (locale === "en" ? "Summarize the meeting: decisions, open questions and next steps." : "Подведи итоги встречи: решения, открытые вопросы и следующие шаги.") : text, mode, webSearch: mode === "research", note, ...(replyToLineId ? { replyToLineId } : {}) });
      if (requestEpoch !== currentEpoch.current) return;
      onPrepared(result.sessionId); setRequestId(result.requestId); if (mode !== "summary" && !defaultText) setPrompt(""); followLatest();
    } catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { if (requestEpoch === currentEpoch.current) setSending(false); }
  };
  const connect = async () => {
    setConnecting(true);
    try { if (status.state === "login") await window.callme.agentLogin(); else { const result = await window.callme.agentConnect(); if (result.state === "login") await window.callme.agentLogin(); } }
    catch (e) { onError(e instanceof Error ? e.message : String(e)); }
    finally { setConnecting(false); }
  };
  const copy = async (message: AssistantMessage) => {
    try { await window.callme.copyText(message.text); setCopied(message.id); setTimeout(() => setCopied(current => current === message.id ? "" : current), 1800); }
    catch { onError("Не удалось скопировать ответ."); }
  };
  return <section className="assistant-pane" aria-label={t("assistant")}>
    <div className="pane-header"><h2>{t("assistant")}</h2>{phase !== "done" && <Button size="compact" variant="quiet" onClick={onOpenResults} title={t("Решения, задачи и открытые вопросы")}>{t("meetingResults")}</Button>}</div>
    <div className="assistant-history">
      {!ready && messages.length > 0 && <p className="composer-status" role="status">{t("Помощник не подключён. ")}<Button variant="text" size="compact" loading={connecting} disabled={status.state === "connecting"} onClick={() => void connect()}>{t("signInChatGPT")}</Button></p>}
    {ready && phase !== "done" && <div className="assistant-toolbar"><Button variant="primary" size="compact" disabled={!replyTarget || busy} onClick={() => replyTarget && void ask("answer", "Предложи ответ на выбранную реплику собеседника.", replyTarget.id)} title={replyTarget ? t("Короткий ответ на последнюю реплику собеседника") : t("Дождитесь реплики собеседника")}>{t("suggestAnswer")}</Button>{replyTarget && <div className="assistant-reply-target" title={replyTarget.text}><time>{timestamp(replyTarget.startMs)}</time><span className="assistant-reply-excerpt">{replyTarget.text}</span></div>}</div>}
    <div className="assistant-messages" ref={area} onScroll={onScroll} aria-live="polite" aria-relevant="additions text"><div ref={body}>
      {messages.length === 0 && <div className="assistant-empty">
        {ready ? <p>{phase === "done" ? t("Задайте вопрос по записи или откройте итоги встречи.") : t("Здесь появится вариант ответа собеседнику.")}</p> : <>
          <p>{status.state === "connecting" ? t("Подключаем помощника…") : t("Войдите через ChatGPT, чтобы получать подсказки.")}</p>
          {status.state !== "connecting" && <Button size="compact" loading={connecting} onClick={() => void connect()}>{t("signInChatGPT")}</Button>}
          {status.state === "error" && <p className="assistant-failure" role="alert">{status.label}</p>}
          <p className="assistant-privacy">{t("Для подсказок отправляем в Codex текст встречи, заметки, выбранные файлы и кадр экрана. Расшифровка работает без входа.")}</p>
        </>}
      </div>}
      {messages.map(message => <article className={"assistant-message message-" + message.role + " message-" + message.state} key={message.id}>
        <div className="assistant-message-label">{message.role === "user" ? t("Ваш запрос") : message.kind === "summary" ? t("Итоги (черновик)") : message.kind === "research" ? t("Проверка") : t("Можно ответить")}{message.state === "streaming" && <span className="secondary-label">{assistantActivity(message)}</span>}{message.role === "assistant" && contextLabel(message, t) && <span className="secondary-label" title={contextLabel(message, t)?.title}>{contextLabel(message, t)?.label}</span>}</div>
        <div className="assistant-message-text">{message.text ? message.role === "assistant" ? <MessageText text={message.text} /> : message.text.startsWith("Помоги ответить на последний вопрос собеседника.") ? t("Помоги ответить") : message.kind === "summary" ? t("Подвести итоги встречи") : message.text : message.state === "streaming" ? assistantActivity(message) : t("Ответ без текста.")}</div>
        {message.state === "error" && <span className="assistant-failure">{t("Ответ прерван. Можно отправить запрос ещё раз.")}</span>}
        {message.role === "assistant" && message.state === "done" && message.text && <div className="assistant-message-actions"><Button size="compact" variant="quiet" onClick={() => void copy(message)}>{copied === message.id ? t("copied") : t("copy")}</Button><Button size="compact" variant="quiet" onClick={() => onAddNote(message.text)}>{t("addToNotes")}</Button></div>}
      </article>)}</div>
    </div>
    {awayFromBottom && messages.length > 0 && <div className="assistant-follow"><Button variant="text" size="compact" icon="down" onClick={followLatest}>{t("К последнему ответу")}</Button></div>}
    </div>
    <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void ask(webSearch ? "research" : "answer"); }}>
      <label className="composer-label" htmlFor="assistant-question">{phase === "done" ? t("Вопрос по записи") : t("askQuestion")}</label><TextArea id="assistant-question" placeholder={phase === "done" ? t("Например: что уточнить по итогам?") : t("Например: что уточнить про сроки?")} value={prompt} maxLength={12000} rows={2} disabled={!ready || busy} onChange={event => setPrompt(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.repeat && !event.nativeEvent.isComposing && (enterToSend || event.ctrlKey || event.metaKey)) { event.preventDefault(); void ask(webSearch ? "research" : "answer"); }
      }} />
      <div className="composer-actions"><Checkbox checked={webSearch} disabled={busy} onChange={event => setWebSearch(event.target.checked)}>{t("searchWeb")}</Checkbox>
        {busy ? <Button size="compact" icon="stop" disabled={!cancelId} onClick={() => void window.callme.agentCancel(cancelId).catch(e => onError(String(e)))}>{t("stop")}</Button> : <Button type="submit" variant="primary" size="compact" disabled={!ready || !prompt.trim()} title={enterToSend ? "Enter" : "Ctrl+Enter"}>{phase === "done" ? t("Спросить по записи") : t("send")}</Button>}
      </div>
    </form>
  </section>;
}
