import { useEffect, useRef, useState } from "react";
import type { ContextFile, Project, ProjectAnalysisProgress, ProjectContext as ProjectContextValue, ProjectKnowledge } from "../shared";
import { Button, IconButton, TextArea } from "./ui";
import { MessageText } from "./MessageText";
import "./project-context.css";
import { useI18n } from "./i18n";

function projectError(cause: unknown, fallback: string) {
  const raw = cause instanceof Error ? cause.message : String(cause || "");
  const clean = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").split("\n")[0].trim();
  if (/время ожидания|тайм-?аут|\b(?:timeout|timed out|deadline exceeded)\b/i.test(clean)) return "Обзор не успел завершиться. Папка подключена — можно повторить обзор или задавать вопросы по проекту.";
  if (!clean || clean.length > 220 || /^[\w./\\:-]+(?:\s+[\w./\\:-]+){0,2}$/i.test(clean)) return fallback;
  return clean;
}

function analysisLabel(progress: ProjectAnalysisProgress, t: (key: string) => string) {
  const stage = progress.stage as string;
  if (stage === "reading") return t("Читаем файлы проекта");
  if (stage === "analyzing") return t("Изучаем устройство проекта");
  if (stage === "writing") return t("Составляем обзор");
  return t("Подключаем помощника");
}

function analysisElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ProjectContext({ project, epoch, phase, files, onBeforeChange, onContextChanged, onBusy }: {
  project: Project | null; epoch: number; phase: string; files: ContextFile[]; goal: string;
  onBeforeChange: () => Promise<boolean>; onContextChanged: (context: ProjectContextValue) => void; onBusy: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [knowledge, setKnowledge] = useState<ProjectKnowledge>({ folder: null, brief: null });
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<ProjectAnalysisProgress>({ stage: "starting", filesRead: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const cancelled = useRef(false);
  const startedAt = useRef(0);
  const canAnalyze = (phase === "idle" || phase === "done") && (!!knowledge.folder?.available || files.length > 0);
  const fingerprint = files.map(file => `${file.id}:${file.bytes}:${file.name}`).join("|");
  useEffect(() => { onBusy(busy || editing); }, [busy, editing, onBusy]);
  useEffect(() => window.callme.onAgentStatus(status => { if (status.state === "ready") setNeedsLogin(false); }), []);
  useEffect(() => {
    if (!analyzing) return;
    const off = window.callme.onProjectAnalysisProgress(setAnalysisProgress);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => { off?.(); window.clearInterval(timer); };
  }, [analyzing]);
  useEffect(() => {
    let active = true;
    setEditing(false); setError(""); setNeedsLogin(false);
    void window.callme.projectKnowledge().then(value => { if (active) setKnowledge(value); }).catch(cause => { if (active) setError(projectError(cause, "Не удалось прочитать контекст.")); });
    return () => { active = false; };
  }, [project?.id, project?.updatedAt, epoch, fingerprint]);
  const analyze = async (connected = false) => {
    if ((!canAnalyze && !connected) || analyzing) return;
    setBusy(true); setAnalyzing(true); setError(""); setNeedsLogin(false); cancelled.current = false; startedAt.current = Date.now(); setElapsed(0); setAnalysisProgress({ stage: "starting", filesRead: 0 });
    try {
      if ((await window.callme.agentStatus()).state !== "ready") { setNeedsLogin(true); return; }
      setKnowledge(await window.callme.analyzeProject());
    } catch (cause) { setError(cancelled.current ? "Разбор остановлен." : projectError(cause, "Не удалось подготовить обзор.")); }
    finally { setAnalyzing(false); setBusy(false); }
  };
  const connect = async () => {
    if (!(await onBeforeChange())) return;
    setBusy(true); setError(""); setNeedsLogin(false);
    try {
      const value = await window.callme.connectRepository();
      if (!value) return;
      setKnowledge(value);
      onContextChanged(await window.callme.projectContext());
      if (phase === "idle" || phase === "done") await analyze(true);
    } catch (cause) { setError(projectError(cause, "Не удалось подключить папку.")); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!(await onBeforeChange())) return;
    setBusy(true); setError(""); setNeedsLogin(false);
    try { setKnowledge(await window.callme.disconnectRepository()); onContextChanged(await window.callme.projectContext()); }
    catch (cause) { setError(projectError(cause, "Не удалось отключить папку.")); }
    finally { setBusy(false); }
  };
  const saveBrief = async () => {
    setBusy(true); setError("");
    try { setKnowledge(await window.callme.saveProjectBrief(text.trim())); setEditing(false); }
    catch (cause) { setError(projectError(cause, "Не удалось сохранить обзор.")); }
    finally { setBusy(false); }
  };
  const login = async () => {
    setBusy(true); setError("");
    try {
      const status = await window.callme.agentConnect();
      if (status.state === "login") await window.callme.agentLogin();
      else if (status.state === "ready") { setNeedsLogin(false); await analyze(); }
    } catch (cause) { setError(projectError(cause, "Не удалось открыть вход.")); }
    finally { setBusy(false); }
  };
  return <section className="project-context-panel" aria-label={t("Контекст проекта")}>
    <div className="materials-section-heading"><h3>{t("Папка проекта")}</h3><div><Button size="compact" variant={knowledge.folder ? "quiet" : "secondary"} disabled={busy || editing} aria-label={knowledge.folder ? t("Сменить папку") : t("Подключить папку")} onClick={() => void connect()}>{knowledge.folder ? t("Сменить") : t("Подключить папку")}</Button>{knowledge.folder && <IconButton icon="close" size="small" disabled={busy || editing} aria-label={t("Отключить папку")} title={t("Отключить папку")} onClick={() => void disconnect()} />}</div></div>
    {knowledge.folder ? <>
      <div className="project-folder"><strong>{knowledge.folder.name}</strong><span title={knowledge.folder.path}>{knowledge.folder.path}</span></div>
      <p className="materials-help">{knowledge.folder.available ? t("Помощник читает файлы по запросу. Код не изменяется.") : t("Папка недоступна. Подключите её заново или выберите другую.")}</p>
    </> : <><p className="materials-help">{t("Выберите корень репозитория. Отмечать файлы вручную не нужно.")}</p><p className="materials-help project-context-onboarding">{t("Покажи проект. Давай выясним, что вы там с нейронкой написали.")}</p></>}
    {knowledge.brief && !editing && <div className="project-brief"><div className="project-brief-heading"><strong>{t("Обзор")}</strong><div><Button size="compact" variant="quiet" disabled={busy} onClick={() => { setText(knowledge.brief?.text || ""); setEditing(true); }}>{t("Изменить")}</Button>{canAnalyze && <Button size="compact" variant="quiet" disabled={busy} onClick={() => void analyze()}>{t("Обновить")}</Button>}</div></div><MessageText text={knowledge.brief.text} /></div>}
    {!knowledge.brief && canAnalyze && !analyzing && !needsLogin && <div className="project-brief"><Button size="compact" disabled={busy} onClick={() => void analyze()}>{t("Подготовить обзор")}</Button></div>}
    {editing && <div className="project-brief"><TextArea aria-label={t("Описание проекта")} rows={5} maxLength={12000} value={text} disabled={busy} onChange={event => setText(event.target.value)} /><div className="result-controls"><Button size="compact" variant="primary" disabled={busy || !text.trim()} onClick={() => void saveBrief()}>{t("Сохранить")}</Button><Button size="compact" variant="quiet" disabled={busy} onClick={() => setEditing(false)}>{t("Отменить")}</Button></div></div>}
    {analyzing && <div className="project-brief project-analysis">
      <div className="project-analysis-progress" role="status"><span className="project-analysis-indicator" aria-hidden="true" /><strong>{analysisLabel(analysisProgress, t)}</strong><span>{t("Прочитано файлов: {count}", { count: analysisProgress.filesRead })}</span><span>{t("Время: {time}", { time: analysisElapsed(elapsed) })}</span></div>
      <Button size="compact" variant="quiet" onClick={() => { cancelled.current = true; void window.callme.cancelProjectAnalysis().catch(() => {}); }}>{t("Остановить разбор")}</Button>
    </div>}
    {needsLogin && <div className="project-brief"><p className="materials-help">{t("Папка подключена. Войдите через ChatGPT для работы помощника.")}</p><Button size="compact" disabled={busy} onClick={() => void login()}>{t("signInChatGPT")}</Button></div>}
    {error && <p className="project-context-error" role="alert">{t(error)}</p>}
  </section>;
}
