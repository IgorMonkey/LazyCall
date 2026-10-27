import { useEffect, useRef, useState } from "react";
import type { Project, ProjectContext, WindowSource } from "../shared";
import { Button, Field, Icon, IconButton, TextArea } from "./ui";
import { ProjectContext as ProjectContextPanel } from "./ProjectContext";
import { useI18n } from "./i18n";

export function Materials({ source, preview, frameAt, phase, epoch, project, onSnapshot }: {
  source?: WindowSource; preview: string; frameAt: number | null; phase: string; epoch: number; project: Project | null; onSnapshot: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState<ProjectContext>({ goal: "", files: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  useEffect(() => { void window.callme.projectContext().then(value => { setContext(value); setDirty(false); }).catch(() => {}); }, [epoch]);
  const open = async () => {
    dialog.current?.showModal(); setLoading(true); setError("");
    try { setContext(await window.callme.projectContext()); setDirty(false); }
    catch { setError("Не удалось открыть материалы встречи."); }
    finally { setLoading(false); }
  };
  const saveGoal = async () => {
    if (!dirty) return true;
    setSaving(true); setError("");
    try { setContext(await window.callme.setGoal(context.goal)); setDirty(false); return true; }
    catch { setError("Не удалось сохранить цель встречи."); return false; }
    finally { setSaving(false); }
  };
  const close = async () => { if (await saveGoal()) dialog.current?.close(); };
  const files = async (removeId?: string) => {
    setSaving(true); setError("");
    try {
      if (dirty) { await window.callme.setGoal(context.goal); setDirty(false); }
      setContext(removeId ? await window.callme.removeContextFile(removeId) : await window.callme.addContextFiles());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  return <>
    <Button size="compact" variant="quiet" icon="folder" onClick={() => void open()} aria-haspopup="dialog" title={t("Цель встречи, выбранные файлы и экран")}>{t("Экран и файлы")}</Button>
    <dialog ref={dialog} className="materials-dialog" aria-labelledby="materials-title" onCancel={event => { if (saving || contextBusy || dirty) { event.preventDefault(); if (!saving && !contextBusy) void close(); } }}>
      <div className="settings-heading"><h2 id="materials-title">{t("Материалы встречи")}</h2><IconButton icon="close" disabled={saving || contextBusy} onClick={() => void close()} aria-label={t("Закрыть материалы")} /></div>
      <div className="materials-body" aria-busy={loading || saving || contextBusy}>
        <section className="meeting-context-fields">
          {project && <div className="project-context"><h3>{project.name}</h3>{project.description && <p className="materials-help">{project.description}</p>}</div>}
          <Field id="meeting-goal" label={t("Цель встречи")}><TextArea id="meeting-goal" rows={2} maxLength={4000} value={context.goal} placeholder={t("Что нужно решить?")} disabled={loading || saving || contextBusy} onChange={event => { setContext({ ...context, goal: event.target.value }); setDirty(true); }} /></Field>
          <ProjectContextPanel project={project} epoch={epoch} phase={phase} files={context.files} goal={context.goal} onBeforeChange={saveGoal} onContextChanged={setContext} onBusy={setContextBusy} />
          <div className="materials-section-heading"><h3>{t("Дополнительные документы")}</h3><Button size="compact" icon="plus" disabled={loading || saving || contextBusy} onClick={() => void files()}>{t("Добавить документ")}</Button></div>
          {context.files.length ? <ul className="context-files">{context.files.map(file => <li key={file.id}><Icon name="file" /><span title={file.relativePath || file.name}>{file.relativePath || file.name}<small>{file.bytes < 1024 ? file.bytes + " Б" : Math.ceil(file.bytes / 1024) + " КБ"}</small></span><IconButton icon="close" size="small" disabled={saving || contextBusy} aria-label={t("Убрать файл ") + file.name} onClick={() => void files(file.id)} /></li>)}</ul> : <p className="materials-help">{t("Добавьте требования, описание сервиса или договорённости. Например: .md или .txt.")}</p>}
          <p className="materials-help context-scope">{project ? "Папка и документы сохраняются для следующих встреч проекта." : "Сохраняются для следующих встреч без проекта."}</p>
        </section>
        <section className="materials-screen" aria-label={t("Экран созвона")}><h3>{t("Экран")}</h3>
          <div className={"preview " + (!(preview || source?.thumbnail) ? "is-empty" : "")}>{preview || source?.thumbnail ? <img src={preview || source?.thumbnail} alt={t("Выбранное окно созвона")} /> : <p className="materials-help">{t("Окно ещё не выбрано.")}</p>}</div>
          {source && <p className="screen-caption" title={source.name}>{source.name}</p>}
          {phase === "live" && frameAt !== null && <p className="materials-help">{t("Кадр обновляется при изменениях окна.")}</p>}
          {phase === "live" && <Button size="compact" icon="screen" onClick={onSnapshot}>{t("Кадр сейчас")}</Button>}
          <p className="materials-help capture-scope">{t("Системный звук включает другие приложения на том же устройстве вывода.")}</p>
        </section>
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
      <div className="settings-actions"><Button variant="primary" loading={saving} disabled={loading || contextBusy} onClick={() => void close()}>{t("Готово")}</Button></div>
    </dialog>
  </>;
}
