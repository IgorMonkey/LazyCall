import { useEffect, useRef, useState } from "react";
import type { CodexIntegration } from "../shared";
import { Button, IconButton } from "./ui";
import "./codex-handoff.css";
import { useI18n } from "./i18n";

export function CodexConnection() {
  const { t } = useI18n();
  const [status, setStatus] = useState<CodexIntegration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => window.callme.codexIntegration()).then(value => { if (mounted) setStatus(value); }).catch(() => { if (mounted) setMessage("Не удалось проверить подключение."); });
    return () => { mounted = false; };
  }, []);
  const change = async (connect: boolean) => {
    setBusy(true); setMessage("");
    try {
      setStatus(await (connect ? window.callme.connectCodexIntegration() : window.callme.disconnectCodexIntegration()));
      setMessage(connect ? "В Codex открыта страница LazyCall. Завершите установку или обновление там, затем выберите LazyCall в нужном чате." : "Доступ к встречам отключён.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось подключить LazyCall."); }
    finally { setBusy(false); }
  };
  return <section className="codex-connection">
    <h3>LazyCall {t("in Codex")}</h3>
    <p className="settings-help">{t("Подключение даёт Codex доступ на чтение сохранённых встреч и материалов проектов. В любом локальном чате можно попросить найти встречу и разобрать итоги.")}</p>
    <div className="codex-connection-actions"><Button size="compact" loading={busy} onClick={() => void change(true)}>{status?.enabled ? t("Открыть подключение") : t("Подключить LazyCall")}</Button>{status?.enabled && <Button size="compact" variant="quiet" disabled={busy} onClick={() => void change(false)}>{t("Отключить доступ")}</Button>}</div>
    {message && <p className="settings-help" role="status">{message}</p>}
  </section>;
}

export function CodexHandoff({ disabled, beforeTransfer, onError, onNotice }: { disabled: boolean; beforeTransfer: () => Promise<void>; onError: (message: string) => void; onNotice: (message: string) => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openCount, setOpenCount] = useState(0);
  const act = async (newChat: boolean) => {
    setBusy(true); setError("");
    try {
      await beforeTransfer();
      if (newChat) await window.callme.continueInCodex(); else await window.callme.copyMeetingForCodex();
      dialog.current?.close();
      onNotice(newChat ? "В Codex подготовлен черновик с материалами записи. Отправьте его, чтобы продолжить." : "Итоги скопированы. Вставьте их в нужный чат Codex.");
    } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message); onError(message); }
    finally { setBusy(false); }
  };
  return <>
    <Button variant="secondary" disabled={disabled} onClick={() => { setError(""); setOpenCount(old => old + 1); dialog.current?.showModal(); }} title={disabled ? t("Дождитесь ответа или остановите его") : t("Продолжить работу с записью")}>{t("Продолжить в Codex")}</Button>
    <dialog ref={dialog} className="codex-handoff-dialog" aria-labelledby="codex-handoff-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className="settings-heading"><h2 id="codex-handoff-title">{t("Продолжить в Codex")}</h2><IconButton icon="close" disabled={busy} aria-label={t("Закрыть передачу в Codex")} onClick={() => dialog.current?.close()} /></div>
      <div className="codex-handoff-body">
        <section><h3>{t("Новый чат")}</h3><p>{t("Откроется черновик с расшифровкой, заметками, итогами и выбранными материалами проекта.")}</p><Button variant="primary" disabled={busy} loading={busy} onClick={() => void act(true)}>{t("Открыть новый чат")}</Button></section>
        <section><h3>{t("Существующий чат")}</h3><p>{t("Скопируйте итоги и вставьте их в нужный чат. Через подключённый LazyCall можно дополнительно получить полную расшифровку и основания.")}</p><Button disabled={busy} onClick={() => void act(false)}>{t("Скопировать итоги")}</Button></section>
        <CodexConnection key={openCount} />
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
    </dialog>
  </>;
}
