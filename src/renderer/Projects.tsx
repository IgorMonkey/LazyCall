import { useRef, useState } from "react";
import type { Project, ProjectInput, WorkspaceSnapshot } from "../shared";
import { Button, Field, IconButton, Input, TextArea } from "./ui";
import { useI18n } from "./i18n";

type Mode = "list" | "new" | Project;

export function Projects({ workspace, disabled, onSelected, onUpdated }: { workspace: WorkspaceSnapshot; disabled: boolean; onSelected: (id: string | null) => Promise<void>; onUpdated: () => Promise<void> }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mode, setMode] = useState<Mode>("list");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const editing = typeof mode === "object" ? mode : null;
  const refresh = async () => {
    setLoading(true); setError("");
    try { setProjects(await window.callme.listProjects()); }
    catch { setError("Не удалось прочитать проекты."); }
    finally { setLoading(false); }
  };
  const open = () => { setMode("list"); setName(""); setDescription(""); setError(""); dialog.current?.showModal(); void refresh(); };
  const showNew = () => { setMode("new"); setName(""); setDescription(""); setError(""); };
  const showEdit = (project: Project) => { setMode(project); setName(project.name); setDescription(project.description); setError(""); };
  const select = async (id: string | null) => {
    setSaving(true); setError("");
    try { await onSelected(id); dialog.current?.close(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const save = async () => {
    const input: ProjectInput = { name: name.trim(), description: description.trim() };
    if (!input.name) { setError(t("Введите название проекта.")); return; }
    setSaving(true); setError("");
    try {
      const project = editing ? await window.callme.updateProject(editing.id, input) : await window.callme.createProject(input);
      setProjects(old => editing ? old.map(item => item.id === project.id ? project : item) : [...old, project]);
      if (editing) { await onUpdated(); dialog.current?.close(); }
      else { await onSelected(project.id); dialog.current?.close(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const current = workspace.project;
  const form = mode !== "list";
  const title = mode === "new" ? t("Новый проект") : editing ? t("Изменить проект") : t("Проекты");
  return <>
    <Button className="project-picker-trigger" variant="quiet" icon="chevron" disabled={disabled} onClick={open} aria-haspopup="dialog" title={disabled ? t("Завершите текущую операцию") : current?.name || t("Выбрать или изменить проект")}><span>{current?.name || t("Без проекта")}</span></Button>
    <dialog ref={dialog} className={"projects-dialog" + (form ? " is-form" : "")} aria-labelledby="projects-title" onCancel={event => { if (saving) event.preventDefault(); }}>
      <div className="settings-heading"><h2 id="projects-title">{title}</h2><IconButton icon="close" disabled={saving} onClick={() => dialog.current?.close()} aria-label="Закрыть проекты" /></div>
      <div className="projects-body" aria-busy={loading || saving}>
        {form ? <section className="project-form" aria-label={title}>
          <Field id="project-name" label={t("Название")}><Input id="project-name" maxLength={100} value={name} disabled={saving} onChange={event => setName(event.target.value)} autoFocus /></Field>
          <Field id="project-description" label={t("Описание (необязательно)")}><TextArea id="project-description" rows={4} maxLength={4000} value={description} disabled={saving} onChange={event => setDescription(event.target.value)} /></Field>
        </section> : <div className="projects-list">
          <div className="project-row"><Button className="project-item" variant="secondary" icon={!current ? "check" : undefined} disabled={saving} onClick={() => void select(null)}><span><strong>{t("Без проекта")}</strong></span></Button></div>
          {projects.map(project => <div className="project-row" key={project.id}>
            <Button className="project-item" variant="secondary" icon={current?.id === project.id ? "check" : undefined} disabled={saving} onClick={() => void select(project.id)}><span><strong>{project.name}</strong>{project.description && <small>{project.description}</small>}</span></Button>
            <Button size="compact" variant="quiet" disabled={saving} onClick={() => showEdit(project)} aria-label={t("Изменить проект") + " " + project.name}>{t("Изменить")}</Button>
          </div>)}
        </div>}
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
      <div className="settings-actions project-actions">{form ? <><Button variant="quiet" disabled={saving} onClick={() => { setMode("list"); setError(""); }}>{t("Назад")}</Button><Button variant="primary" loading={saving} onClick={() => void save()}>{editing ? t("Сохранить") : t("Создать проект")}</Button></> : <Button variant="primary" disabled={loading || saving} onClick={showNew}>{t("Новый проект")}</Button>}</div>
    </dialog>
  </>;
}
