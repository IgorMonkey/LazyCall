import { useEffect, useRef, useState } from "react";
import type { AgentStatus, MeetingResults, ResultItem, TranscriptLine } from "../shared";
import { Button, Checkbox, Field, IconButton, Input, TextArea } from "./ui";
import { MessageText } from "./MessageText";
import { useI18n } from "./i18n";

const freshItem = (type: ResultItem["type"]): ResultItem => ({ id: crypto.randomUUID(), type, text: "", evidenceIds: [], status: "draft", author: "user", assignee: "", dueDate: "" });

export function Results({ value, lines, summaryText, generating, canGenerate, hasProject, phase, agent, busy, onGenerate, onCancel, onSave, onJump, openSignal }: {
  value: MeetingResults; lines: TranscriptLine[]; summaryText: string; generating: boolean; canGenerate: boolean; hasProject: boolean; phase: string; agent: AgentStatus; busy: boolean; onGenerate: () => Promise<void>; onCancel: () => Promise<void>; onSave: (value: MeetingResults) => Promise<MeetingResults>; onJump: (lineId: string) => void; openSignal: number;
}) {
  const { t } = useI18n();
  const types: Array<{ type: ResultItem["type"]; label: string; addLabel: string }> = [
    { type: "decision", label: t("Решения"), addLabel: t("Решение") }, { type: "task", label: t("Задачи"), addLabel: t("Задачу") }, { type: "question", label: t("Открытые вопросы"), addLabel: t("Вопрос") }
  ];
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => { if (!dirty && !editingId) setDraft(value); }, [value, dirty, editingId]);
  useEffect(() => { if (openSignal) { setError(""); setManualOpen(false); dialog.current?.showModal(); } }, [openSignal]);
  const update = (id: string, patch: Partial<ResultItem>) => { setDirty(true); setDraft(old => ({ ...old, items: old.items.map(item => item.id === id ? { ...item, ...patch } : item) })); };
  const persist = async (next = draft) => {
    setSaving(true); setError("");
    try { setDraft(await onSave(next)); setDirty(false); setEditingId(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить итоги."); }
    finally { setSaving(false); }
  };
  const add = (type: ResultItem["type"]) => {
    const item = freshItem(type);
    setDraft(old => ({ ...old, items: [...old.items, item] })); setDirty(true); setEditingId(item.id); setManualOpen(false);
  };
  const saveItem = (item: ResultItem) => {
    if (!item.text.trim()) { setError("Добавьте текст пункта."); return; }
    const savedItem = { ...item, text: item.text.trim(), evidenceStale: false };
    const exists = value.items.some(existing => existing.id === item.id);
    void persist({ ...value, items: exists ? value.items.map(existing => existing.id === item.id ? savedItem : existing) : [...value.items, savedItem] });
  };
  const cancelEdit = (item: ResultItem) => {
    const original = value.items.find(existing => existing.id === item.id);
    setDraft(old => ({ ...old, items: original ? old.items.map(existing => existing.id === item.id ? original : existing) : old.items.filter(existing => existing.id !== item.id) }));
    setDirty(false); setEditingId("");
  };
  const close = () => { if (saving || dirty) { setError("Сохраните или отмените изменения перед закрытием."); return; } dialog.current?.close(); };
  const connect = async () => {
    setConnecting(true); setError("");
    try { const status = await window.callme.agentConnect(); if (status.state === "login") await window.callme.agentLogin(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось подключить помощника."); }
    finally { setConnecting(false); }
  };
  const hasTranscript = lines.length > 0;
  const interim = phase === "live" || phase === "paused";
  const generationAvailable = hasTranscript && agent.state === "ready" && canGenerate && !busy && !saving && !dirty && !editingId;
  const assistantDrafts = draft.items.some(item => item.author === "assistant" && item.status === "draft");
  const showGenerate = hasTranscript;
  const refreshSummary = !!summaryText || !!value.transcriptStale;
  const emptyTitle = interim ? t("Речь ещё не распознана.") : phase === "done" ? t("В записи нет распознанной речи.") : t("Пока нет расшифровки.");
  const emptyDetail = phase === "paused" ? t("Возобновите запись в основном окне, чтобы распознать речь.") : phase === "live" ? t("Реплики появятся по ходу разговора. После этого можно составить итог.") : t("Запишите разговор, чтобы составить итог.");
  const manualControls = <div className="results-manual">
    <Button size="compact" variant="quiet" disabled={saving || !!editingId} onClick={() => setManualOpen(open => !open)}>{t("Добавить пункт вручную")}</Button>
    {manualOpen && <span className="results-manual-types">{types.map(group => <Button key={group.type} size="compact" disabled={saving || !!editingId} onClick={() => add(group.type)}>{group.addLabel}</Button>)}</span>}
  </div>;
  return <>
    <dialog ref={dialog} className="results-dialog" aria-labelledby="results-title" onCancel={event => { if (saving || dirty) { event.preventDefault(); setError("Сохраните или отмените изменения перед закрытием."); } }}>
      <div className="settings-heading"><div><h2 id="results-title">{t("Итоги встречи")}</h2>{hasProject && <p className="results-help">{t("Подтверждённые решения и задачи попадут в контекст следующих встреч проекта.")}</p>}</div><IconButton icon="close" disabled={saving} onClick={close} aria-label={t("Закрыть итоги")} /></div>
      <div className="results-body" aria-busy={saving || connecting}>
        {value.transcriptStale && <p className="results-stale-notice" role="status">{t("Расшифровка исправлена: прежние итоги устарели. Обновите краткий итог и проверьте отмеченные пункты.")}</p>}
        {!hasTranscript && draft.items.length === 0 ? <section className="results-empty" aria-label={emptyTitle}><p><strong>{emptyTitle}</strong></p><p>{emptyDetail}</p><Button variant="primary" onClick={close}>{t("Вернуться к записи")}</Button>{manualControls}</section> : <>
          <div className="results-actions">
            {generating ? <><Button size="compact" icon="stop" onClick={() => void onCancel()}>{t("stop")}</Button><span className="secondary-label" role="status">{t("Составляем итоги…")}</span></> : showGenerate && generationAvailable ? <Button size="compact" variant={summaryText ? "quiet" : "primary"} onClick={() => void onGenerate().catch(e => setError(e instanceof Error ? e.message : String(e)))}>{refreshSummary ? t("Обновить итог") : interim ? t("Подвести промежуточный итог") : t("Составить итоги")}</Button> : null}
            {!generating && showGenerate && agent.state !== "ready" && <Button size="compact" variant="primary" loading={connecting} onClick={() => void connect()}>{t("signInChatGPT")}</Button>}
            {!generating && showGenerate && agent.state === "ready" && busy && <span className="secondary-label" role="status">{t("Помощник занят. Подождите завершения текущей задачи.")}</span>}
            {!generating && dirty && <span className="secondary-label" role="status">{t("Сначала сохраните изменения.")}</span>}
          </div>
          {showGenerate && agent.state !== "ready" && !generating && <p className="results-help">{t("Подключите помощника, чтобы составить итоги автоматически. Пункты можно добавить и вручную.")}</p>}
          {interim && !summaryText && showGenerate && agent.state === "ready" && <p className="results-help">{t("Будет использована уже распознанная часть записи.")}</p>}
          {summaryText && <section className="results-summary" aria-label={t("Краткий итог")}><MessageText text={summaryText} /></section>}
          {assistantDrafts && <p className="results-help">{t("Черновики помощника требуют проверки перед подтверждением.")}</p>}
          {draft.items.length > 0 && types.map(group => {
            const items = draft.items.filter(item => item.type === group.type);
            if (!items.length) return null;
            return <section className="results-group" key={group.type}><div className="materials-section-heading"><h3>{group.label}</h3></div>
              {items.map(item => <ResultEditor key={item.id} item={item} lines={lines} saving={saving} editing={editingId === item.id} blocked={!!editingId && editingId !== item.id} onChange={patch => update(item.id, patch)} onSave={() => saveItem(item)} onCancel={() => cancelEdit(item)} onEdit={() => setEditingId(item.id)} onStatus={status => { const next = { ...value, items: value.items.map(existing => existing.id === item.id ? { ...item, status, evidenceStale: false } : existing) }; void persist(next); }} onJump={lineId => { if (!dirty && !editingId) { dialog.current?.close(); onJump(lineId); } }} />)}
            </section>;
          })}
          {manualControls}
        </>}
        {error && <p className="settings-error" role="alert">{t(error)}</p>}
      </div>
      <div className="settings-actions"><Button disabled={saving} onClick={close}>{t("Готово")}</Button></div>
    </dialog>
  </>;
}

function ResultEditor({ item, lines, saving, editing, blocked, onChange, onSave, onCancel, onEdit, onStatus, onJump }: { item: ResultItem; lines: TranscriptLine[]; saving: boolean; editing: boolean; blocked: boolean; onChange: (patch: Partial<ResultItem>) => void; onSave: () => void; onCancel: () => void; onEdit: () => void; onStatus: (status: ResultItem["status"]) => void; onJump: (lineId: string) => void }) {
  const { t } = useI18n();
  const refs = item.evidenceIds.map(id => lines.find(line => line.id === id)).filter((line): line is TranscriptLine => !!line);
  return <article className="result-item" data-status={item.status}><div className="result-item-top"><span className="result-status">{item.status === "confirmed" ? t("Подтверждено") : item.status === "rejected" ? t("Отклонено") : t("Черновик")}</span>{refs.length ? <span className="result-source-buttons">{refs.map(line => <Button key={line.id} size="compact" variant="text" disabled={saving || editing || blocked} title={line.text} onClick={() => onJump(line.id)}>{String(Math.floor(line.startMs / 60000)).padStart(2, "0")}:{String(Math.floor(line.startMs / 1000) % 60).padStart(2, "0")}</Button>)}</span> : !editing && <span className="result-unsourced">{t("Без привязки к реплике")}</span>}</div>
    {item.evidenceStale && <p className="results-stale-notice">{t("Реплика-основание исправлена. Проверьте пункт перед повторным подтверждением.")}</p>}
    {editing ? <><TextArea aria-label={t("Текст итога")} rows={2} value={item.text} disabled={saving} onChange={event => onChange({ text: event.target.value })} placeholder={t("Сформулируйте пункт")} />
      {item.type === "task" && <div className="result-meta"><Field id={"owner-" + item.id} label={t("Исполнитель")}><Input id={"owner-" + item.id} maxLength={200} value={item.assignee} disabled={saving} placeholder={t("Не указан")} onChange={event => onChange({ assignee: event.target.value })} /></Field><Field id={"due-" + item.id} label={t("Срок")}><Input id={"due-" + item.id} maxLength={200} value={item.dueDate} disabled={saving} placeholder={t("Не указан")} onChange={event => onChange({ dueDate: event.target.value })} /></Field></div>}
      <fieldset className="result-evidence" disabled={saving || !lines.length}><legend>{t("Реплики-основания")}</legend>{lines.length ? lines.map(line => <Checkbox key={line.id} checked={item.evidenceIds.includes(line.id)} onChange={event => onChange({ evidenceIds: event.target.checked ? [...item.evidenceIds, line.id] : item.evidenceIds.filter(id => id !== line.id) })}>{line.source === "self" ? t("Вы") : t("Собеседники")}: {line.text}</Checkbox>) : <p className="materials-help">{t("Реплики появятся в расшифровке.")}</p>}</fieldset>
      <div className="result-controls"><Button size="compact" variant="primary" disabled={saving} onClick={onSave}>{t("Сохранить")}</Button><Button size="compact" variant="quiet" disabled={saving} onClick={onCancel}>{t("Отменить")}</Button></div></> : <><p className="result-text">{item.text || t("Без текста")}</p>{(item.assignee || item.dueDate) && <dl className="result-facts">{item.assignee && <div><dt>{t("Исполнитель")}</dt><dd>{item.assignee}</dd></div>}{item.dueDate && <div><dt>{t("Срок")}</dt><dd>{item.dueDate}</dd></div>}</dl>}<div className="result-controls"><Button size="compact" variant="quiet" disabled={saving || blocked} onClick={onEdit}>{t("Изменить")}</Button>{(item.status !== "confirmed" || item.evidenceStale) && <Button size="compact" disabled={saving || blocked} onClick={() => onStatus("confirmed")}>{t("Подтвердить")}</Button>}{item.status !== "rejected" && <Button size="compact" variant="quiet" disabled={saving || blocked} onClick={() => onStatus("rejected")}>{t("Отклонить")}</Button>}</div></>}
  </article>;
}
