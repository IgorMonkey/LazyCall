import { useEffect, useRef, useState } from "react";
import type { MeetingResults, TranscriptLine } from "../shared";
import { Button, IconButton, TextArea } from "./ui";
import { useI18n } from "./i18n";

export function TranscriptEditor({ line, sessionId, blocked, onClose, onEdited }: { line: TranscriptLine | null; sessionId: string; blocked: boolean; onClose: () => void; onEdited: (value: { line: TranscriptLine; results: MeetingResults }) => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setError(""); setText(line?.text || "");
    if (line) dialog.current?.showModal(); else dialog.current?.close();
  }, [line]);
  const close = () => { if (!saving) onClose(); };
  const save = async () => {
    if (!line || saving || blocked || !text.trim() || text.trim() === line.text) return;
    setSaving(true); setError("");
    try {
      const value = await window.callme.editTranscript({ sessionId, lineId: line.id, text, expectedText: line.text });
      onEdited(value); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить реплику."); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="transcript-edit-dialog" aria-labelledby="transcript-edit-title" onCancel={event => { event.preventDefault(); close(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="settings-heading"><h2 id="transcript-edit-title">{t("Исправить реплику")}</h2><IconButton icon="close" disabled={saving} aria-label={t("Закрыть исправление")} onClick={close} /></div>
      <div className="transcript-edit-body">
        <TextArea aria-label={t("Текст реплики")} rows={5} maxLength={20000} value={text} disabled={saving || blocked} onChange={event => setText(event.target.value)} autoFocus />
        <details><summary>{t("Исходное распознавание")}</summary><p>{line?.originalText ?? line?.text}</p></details>
        <p className="materials-help">{t("Оригинал сохранится. Итоги и связанные пункты будут отмечены для проверки.")}</p>
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
      <div className="settings-actions"><Button disabled={saving} onClick={close}>{t("Отменить")}</Button><Button variant="primary" type="submit" loading={saving} disabled={blocked || !text.trim() || text.trim() === line?.text}>{t("Сохранить")}</Button></div>
    </form>
  </dialog>;
}
