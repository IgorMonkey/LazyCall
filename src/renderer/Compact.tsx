import { useEffect, useMemo, useState } from "react";
import type { CompactSnapshot, TranscriptLine } from "../shared";
import { MessageText } from "./MessageText";
import { Button } from "./ui";
import { useTheme } from "./theme";
import { useTranscriptFollow } from "./useTranscriptFollow";
import { assistantActivity } from "./assistant-activity";
import { useI18n } from "./i18n";
import { BrandMark, BrandWordmark } from "./BrandMark";
import "./compact.css";

const api = () => window.callmeCompact;
const timestamp = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function Quote({ line, title }: { line: TranscriptLine; title: string }) {
  return <section className="compact-quote" aria-label={title}>
    <p className="compact-eyebrow"><span>{title}</span><time>{timestamp(line.startMs)}</time></p>
    <p>{line.text}</p>
  </section>;
}

function EmptyState({ value }: { value: CompactSnapshot }) {
  const { t } = useI18n();
  if (value.error) return <p className="compact-state compact-state-error" role="alert">{value.error}</p>;
  if (value.phase === "idle") return <p className="compact-state">{t("Start recording in the main window — suggestions will appear here.")}</p>;
  if (value.phase === "paused") return <p className="compact-state">{t("Recording is paused. Resume it to request a suggestion.")}</p>;
  if (value.phase === "done") return <p className="compact-state">{t("Recording is finished. Open LazyCall to view results and continue.")}</p>;
  if (value.agent.state !== "ready") return <p className="compact-state">{t("A suggestion will be available after the assistant connects.")}</p>;
  return <p className="compact-state">{t("Waiting for a participant message to suggest an answer.")}</p>;
}

export function Compact() {
  const { setPreference, t } = useI18n();
  const [snapshot, setSnapshot] = useState<CompactSnapshot | null>(null);
  const [requestError, setRequestError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const follow = useTranscriptFollow(snapshot?.answer);
  useTheme(snapshot?.theme ?? "system");

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const receive = (value: CompactSnapshot) => { if (active) { setSnapshot(value); setPreference(value.locale ?? "system"); setRequestError(""); } };
    const off = api().onSnapshot(value => { receivedUpdate = true; receive(value); });
    void api().snapshot().then(value => { if (!receivedUpdate) receive(value); }).catch(() => { if (active && !receivedUpdate) setRequestError("Не удалось получить состояние LazyCall."); });
    return () => { active = false; off(); };
  }, []);

  const state = snapshot;
  const actionEnabled = !!state && state.phase === "live" && state.agent.state === "ready" && !!state.target && !state.busy && !requesting;
  const canCancel = !!state?.busy && state.answer?.state === "streaming";
  const status = useMemo(() => state ? `${state.agent.label}${state.busy ? ". Готовим ответ…" : ""}` : "Подключаем окно…", [state]);
  const ask = async () => {
    if (!actionEnabled) return;
    setRequesting(true); setRequestError("");
    try { await api().ask(); }
    catch (error) { setRequestError(error instanceof Error ? error.message : "Не удалось запросить подсказку."); }
    finally { setRequesting(false); }
  };
  const cancel = async () => {
    if (!state?.busy) return;
    setRequestError("");
    try { await api().cancel(); }
    catch (error) { setRequestError(error instanceof Error ? error.message : "Не удалось остановить ответ."); }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); void api().hide(); return; }
      if (event.key === "Enter" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && actionEnabled) { event.preventDefault(); void ask(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [actionEnabled]);

  return <main className="compact" aria-label={t("LazyCall suggestions")}>
    <header className="compact-header">
      <div className="compact-brand"><BrandMark /><strong aria-label="LazyCall"><BrandWordmark /></strong></div>
      <Button size="compact" variant="quiet" onClick={() => void api().showMain()}>{t("openLazyCall")}</Button>
    </header>
    <div ref={follow.viewport} className="compact-content" onScroll={follow.onScroll}>
      <div ref={follow.body} className="compact-content-body">
        <p className="compact-agent" role="status">{status}</p>
        {!state ? <p className="compact-state">{t("Connecting meeting state…")}</p> : <>
        {state.target && <Quote line={state.target} title={t("lastMessage")} />}
        {state.answer && <section className="compact-answer" aria-live={state.answer.state === "streaming" ? "polite" : undefined}>
          <div className="compact-answer-heading"><p className="compact-eyebrow">{state.answerTarget ? t("Answer at {time}", { time: timestamp(state.answerTarget.startMs) }) : t("assistantAnswer")}</p>{state.answer.state === "streaming" && <span role="status">{assistantActivity(state.answer)}</span>}</div>
          {state.answerTarget && state.answerTarget.id !== state.target?.id && <Quote line={state.answerTarget} title={t("replyForThis")} />}
          {state.answer.text ? <MessageText text={state.answer.text} openLink={url => api().openLink(url)} /> : <p>{assistantActivity(state.answer)}</p>}
          {state.answer.state === "done" && state.answer.text && <Button size="compact" variant="quiet" onClick={() => void api().copyAnswer().catch(() => setRequestError(t("Could not copy the answer.")))}>{t("copy")}</Button>}
        </section>}
        {!state.target || state.phase !== "live" || state.agent.state !== "ready" || !!state.error ? <EmptyState value={state} /> : null}
        {requestError && <p className="compact-state compact-state-error" role="alert">{requestError}</p>}
        </>}
      </div>
    </div>
    {follow.awayFromBottom && <div className="compact-follow"><Button size="compact" variant="quiet" onClick={follow.followLatest}>{t("showLatestAnswer")}</Button></div>}
    <div className="compact-actions">
      {canCancel ? <Button size="compact" variant="stop" onClick={() => void cancel()}>{t("stop")}</Button> : <Button size="compact" variant="primary" disabled={!actionEnabled} loading={requesting || !!state?.busy} onClick={() => void ask()}>{state?.busy ? t("Assistant is busy") : t("suggestAnswer")}</Button>}
    </div>
    {state && <footer className="compact-shortcuts">{state.shortcuts.toggleRegistered ? t("{key} — show or hide", { key: state.shortcuts.toggle }) : t("{key} — unavailable or occupied", { key: state.shortcuts.toggle })}; {state.shortcuts.replyRegistered ? t("{key} — suggest answer", { key: state.shortcuts.reply }) : t("{key} — unavailable or occupied", { key: state.shortcuts.reply })}. {t("Escape — hide window.")}</footer>}
  </main>;
}
