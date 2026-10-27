import { useRef, useState } from "react";
import type { MeetingSummary } from "../shared";
import { Button, Checkbox, IconButton } from "./ui";
import { useI18n } from "./i18n";

export function Meetings({ disabled, onOpen, projectId }: { disabled: boolean; onOpen: (id: string) => Promise<void>; projectId?: string }) {
  const { locale, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState("");
  const [error, setError] = useState("");
  const [allProjects, setAllProjects] = useState(false);
  const open = async () => {
    dialog.current?.showModal(); setLoading(true); setError("");
    try { setMeetings(await window.callme.listMeetings()); }
    catch { setError("Не удалось прочитать сохранённые встречи."); }
    finally { setLoading(false); }
  };
  const choose = async (id: string) => {
    setOpening(id); setError("");
    try { await onOpen(id); dialog.current?.close(); }
    catch { setError("Не удалось открыть встречу. Попробуйте ещё раз."); }
    finally { setOpening(""); }
  };
  return <>
    <Button className="header-meetings-trigger" variant="quiet" icon="history" disabled={disabled} onClick={() => void open()} aria-label={t("Встречи")} aria-haspopup="dialog" title={disabled ? t("Завершите текущую встречу, чтобы открыть другую") : t("Открыть сохранённую встречу")}><span className="header-action-label">{t("Встречи")}</span></Button>
    <dialog ref={dialog} className="meetings-dialog" aria-labelledby="meetings-title" onCancel={event => { if (opening) event.preventDefault(); }}>
      <div className="settings-heading"><h2 id="meetings-title">{t("Сохранённые встречи")}</h2><IconButton icon="close" disabled={!!opening} onClick={() => dialog.current?.close()} aria-label={t("Закрыть список встреч")} /></div>
      <div className="meetings-list" aria-busy={loading || !!opening}>
        {projectId && <div className="meetings-filter"><Checkbox checked={allProjects} onChange={event => setAllProjects(event.target.checked)}>{t("Все проекты")}</Checkbox></div>}
        {loading ? <p className="materials-help">{t("loading")}</p> : meetings.filter(meeting => allProjects || !projectId || meeting.projectId === projectId).length ? meetings.filter(meeting => allProjects || !projectId || meeting.projectId === projectId).map(meeting => <Button className="meeting-item" key={meeting.id} disabled={!!opening} loading={opening === meeting.id} onClick={() => void choose(meeting.id)}>
          <span><strong>{meeting.title}</strong>{meeting.projectName && <small>{meeting.projectName}</small>}<small>{new Date(meeting.startedAt).toLocaleString(locale === "en" ? "en-US" : "ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}{meeting.interrupted ? t(" — восстановлена после закрытия") : ""}</small></span>
        </Button>) : <p className="materials-help">{t("Здесь будут сохранённые встречи.")}</p>}
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
    </dialog>
  </>;
}
