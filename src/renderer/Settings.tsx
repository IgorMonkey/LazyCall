import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DEFAULT_APP_SETTINGS, type AgentModel, type AgentStatus, type AppSettings, type WhisperStatus } from "../shared";
import { Button, Checkbox, Field, IconButton, Select } from "./ui";
import { CodexConnection } from "./CodexHandoff";
import { applyTheme } from "./theme";
import { Updates } from "./Updates";
import { CodexRuntime } from "./CodexRuntime";
import { useI18n } from "./i18n";

type Tab = "recording" | "assistant" | "data" | "appearance" | "updates";
const effortLabel = (value: string, english: boolean) => ({ low: english ? "Low" : "Небольшое", medium: english ? "Medium" : "Среднее", high: english ? "High" : "Высокое", xhigh: english ? "Very high" : "Очень высокое", max: english ? "Maximum" : "Максимальное" }[value] || value);

export function Settings({ busy, status, agent, onSaved }: { busy: boolean; status: WhisperStatus; agent: AgentStatus; onSaved: (values: AppSettings) => void }) {
  const { locale, preference, setPreference, t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [original, setOriginal] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  const [models, setModels] = useState<AgentModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [directory, setDirectory] = useState("");
  const [tab, setTab] = useState<Tab>("recording");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const originalTheme = useRef(DEFAULT_APP_SETTINGS.theme);
  const originalLocale = useRef<AppSettings["locale"]>(DEFAULT_APP_SETTINGS.locale);
  const previewingTheme = useRef(false);
  const restoreTheme = () => { if (previewingTheme.current) applyTheme(originalTheme.current, true); setPreference(originalLocale.current); previewingTheme.current = false; };
  useEffect(() => () => restoreTheme(), []);
  const dirty = JSON.stringify(values) !== JSON.stringify(original);
  const disabled = loading || saving || !loaded;
  const recognitionLocked = disabled || busy;
  const selectedModel = models.find(model => model.id === values.model);
  const agentAction = async (action: "connect" | "login" | "logout") => {
    setAgentBusy(true); setError("");
    try {
      if (action === "login") await window.callme.agentLogin();
      else if (action === "logout") await window.callme.agentLogout();
      else { const result = await window.callme.agentConnect(); if (result.state === "login") await window.callme.agentLogin(); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAgentBusy(false); }
  };
  const loadModels = () => {
    setModelsLoading(true);
    void window.callme.agentModels().then(setModels).catch(() => setModelsError("Не удалось загрузить список моделей.")).finally(() => setModelsLoading(false));
  };
  const open = async () => {
    setError(""); setModelsError(""); setLoaded(false); setLoading(true); setTab("recording");
    if (!dialog.current?.open) dialog.current?.showModal();
    try {
      const snapshot = await window.callme.settings();
      const next = { ...DEFAULT_APP_SETTINGS, ...snapshot.values };
      originalTheme.current = next.theme; originalLocale.current = next.locale; previewingTheme.current = false; setValues(next); setOriginal(next); setPreference(next.locale); setDirectory(snapshot.dataDirectory); setLoaded(true);
      loadModels();
    } catch { setError("Не удалось загрузить настройки. Закройте окно и попробуйте снова."); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const openFromOnboarding = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { tab?: Tab } : undefined;
      void open().then(() => { if (detail?.tab) setTab(detail.tab); });
    };
    window.addEventListener("callme:open-settings", openFromOnboarding);
    return () => window.removeEventListener("callme:open-settings", openFromOnboarding);
  }, []);
  useEffect(() => {
    if (!dialog.current?.open || agent.state !== "ready") return;
    loadModels();
  }, [agent.state]);
  const save = async () => {
    if (disabled || !dirty) return;
    setSaving(true); setError("");
    try { const result = await window.callme.saveSettings(values); const next = { ...DEFAULT_APP_SETTINGS, ...result }; originalTheme.current = next.theme; originalLocale.current = next.locale; previewingTheme.current = false; setOriginal(next); setPreference(next.locale); onSaved(next); dialog.current?.close(); }
    catch { setError("Не удалось сохранить настройки. Попробуйте ещё раз."); }
    finally { setSaving(false); }
  };
  const changeModel = (id: string) => {
    const model = models.find(value => value.id === id);
    setValues(old => ({ ...old, model: id, reasoningEffort: model?.defaultReasoningEffort || "default" }));
  };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, current: Tab) => {
    const order: Tab[] = ["recording", "assistant", "data", "appearance", "updates"];
    const index = order.indexOf(current);
    const next = event.key === "Home" ? 0 : event.key === "End" ? order.length - 1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % order.length : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + order.length - 1) % order.length : -1;
    if (next < 0) return;
    event.preventDefault(); setTab(order[next]); document.getElementById("settings-tab-" + order[next])?.focus();
  };
  return <>
    <Button className="header-settings-trigger" variant="quiet" icon="settings" onClick={() => void open()} aria-label={t("settings")} title={t("settings")} aria-haspopup="dialog"><span className="header-action-label">{t("settings")}</span></Button>
    <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { if (saving) event.preventDefault(); else restoreTheme(); }}>
      <form className="settings-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="settings-heading"><h2 id="settings-title">{t("settings")}</h2><IconButton icon="close" disabled={saving} onClick={() => { restoreTheme(); dialog.current?.close(); }} aria-label={t("close")} /></div>
        <div className="settings-layout">
        <nav className="settings-tabs" role="tablist" aria-label={t("settings")} aria-orientation="vertical">
          <Button id="settings-tab-recording" role="tab" aria-controls="settings-panel-recording" aria-selected={tab === "recording"} tabIndex={tab === "recording" ? 0 : -1} onKeyDown={event => moveTab(event, "recording")} className={tab === "recording" ? "is-active" : ""} variant="quiet" type="button" onClick={() => setTab("recording")}>{t("recording")}</Button>
          <Button id="settings-tab-assistant" role="tab" aria-controls="settings-panel-assistant" aria-selected={tab === "assistant"} tabIndex={tab === "assistant" ? 0 : -1} onKeyDown={event => moveTab(event, "assistant")} className={tab === "assistant" ? "is-active" : ""} variant="quiet" type="button" onClick={() => setTab("assistant")}>{t("assistant")}</Button>
          <Button id="settings-tab-data" role="tab" aria-controls="settings-panel-data" aria-selected={tab === "data"} tabIndex={tab === "data" ? 0 : -1} onKeyDown={event => moveTab(event, "data")} className={tab === "data" ? "is-active" : ""} variant="quiet" type="button" onClick={() => setTab("data")}>{t("data")}</Button>
          <Button id="settings-tab-appearance" role="tab" aria-controls="settings-panel-appearance" aria-selected={tab === "appearance"} tabIndex={tab === "appearance" ? 0 : -1} onKeyDown={event => moveTab(event, "appearance")} className={tab === "appearance" ? "is-active" : ""} variant="quiet" type="button" onClick={() => setTab("appearance")}>{t("appearance")}</Button>
          <Button id="settings-tab-updates" role="tab" aria-controls="settings-panel-updates" aria-selected={tab === "updates"} tabIndex={tab === "updates" ? 0 : -1} onKeyDown={event => moveTab(event, "updates")} className={tab === "updates" ? "is-active" : ""} variant="quiet" type="button" onClick={() => setTab("updates")}>{t("updates")}</Button>
        </nav>
        <div className="settings-body" aria-busy={loading || saving}>
          {tab === "updates" && <div id="settings-panel-updates" role="tabpanel" aria-labelledby="settings-tab-updates"><Updates busy={busy} /></div>}
          {tab === "recording" && <section id="settings-panel-recording" className="settings-group" role="tabpanel" aria-labelledby="settings-tab-recording"><SettingsPanelTitle title={t("recognition")} />
            <div className="settings-card"><Field id="stt-language" label={t("speechLanguage")} layout="inline"><Select id="stt-language" disabled={recognitionLocked} value={values.language} onChange={event => setValues({ ...values, language: event.target.value as AppSettings["language"] })}><option value="ru">{t("russian")}</option><option value="en">{t("english")}</option><option value="auto">{t("detectAutomatically")}</option></Select></Field>
            <Field id="stt-compute" label={t("processing")} layout="inline"><Select id="stt-compute" disabled={recognitionLocked} value={values.compute} onChange={event => setValues({ ...values, compute: event.target.value as AppSettings["compute"] })}><option value="auto">{t("automatic")}</option><option value="cpu">{t("cpuOnly")}</option></Select></Field></div>
            {busy && <p className="settings-notice">{t("Завершите встречу, чтобы изменить распознавание.")}</p>}
            {status.state === "ready" && <dl className="settings-facts settings-card"><div><dt>{t("Движок")}</dt><dd>Whisper</dd></div><div><dt>{t("Устройство")}</dt><dd>{status.backend === "CUDA" ? t("Видеокарта NVIDIA") : t("Процессор")}</dd></div></dl>}
          </section>}
          {tab === "assistant" && <section id="settings-panel-assistant" className="settings-group" role="tabpanel" aria-labelledby="settings-tab-assistant"><SettingsPanelTitle title={`Codex ${t("assistant")}`} description={agent.label + (agent.model ? `: ${agent.model}` : "")} />
            <CodexRuntime busy={busy} />
            <div className="settings-card"><Field id="agent-model" label={t("model")} layout="inline"><Select id="agent-model" disabled={disabled || modelsLoading} value={values.model} onChange={event => changeModel(event.target.value)}><option value="">{t("default")}</option>{models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</Select></Field>
            {selectedModel && <p className="settings-help settings-field-help">{selectedModel.description}</p>}
            {modelsError && <p className="settings-error" role="status">{t(modelsError)}</p>}
            <Field id="agent-reasoning" label={t("reasoning")} layout="inline"><Select id="agent-reasoning" disabled={disabled || modelsLoading || !selectedModel} value={values.reasoningEffort} onChange={event => setValues({ ...values, reasoningEffort: event.target.value })}><option value="default">{t("default")}</option>{selectedModel?.reasoningEfforts.map(effort => <option key={effort} value={effort}>{effortLabel(effort, locale === "en")}</option>)}</Select></Field></div>
            <div className="settings-card settings-toggles"><Checkbox checked={values.autoSummary} disabled={disabled} onChange={event => setValues({ ...values, autoSummary: event.target.checked })}>{t("autoSummary")}</Checkbox><Checkbox checked={values.autoHints} disabled={disabled} onChange={event => setValues({ ...values, autoHints: event.target.checked })}>{t("autoHints")}</Checkbox><Checkbox checked={values.screenContext} disabled={disabled} onChange={event => setValues({ ...values, screenContext: event.target.checked })}>{t("screenContext")}</Checkbox><Checkbox checked={values.enterToSend} disabled={disabled} onChange={event => setValues({ ...values, enterToSend: event.target.checked })}>{t("enterToSend")}</Checkbox></div>
            <p className="settings-help agent-data-notice">{t("В Codex передаются текст встречи, заметки и нужные фрагменты подключённого проекта.")}</p>
            <div className="settings-agent-actions">{agent.state === "ready" ? <Button loading={agentBusy} type="button" onClick={() => void agentAction("logout")}>{t("signOut")}</Button> : <Button loading={agentBusy || agent.state === "connecting"} type="button" onClick={() => void agentAction(agent.state === "login" ? "login" : "connect")}>{t("signInChatGPT")}</Button>}</div>
          </section>}
          {tab === "data" && <section id="settings-panel-data" className="settings-group settings-data" role="tabpanel" aria-labelledby="settings-tab-data"><SettingsPanelTitle title={t("Сохранённые встречи")} /><div className="settings-card"><p className="settings-help settings-path" title={directory}>{directory || t("Загрузка…")}</p><Button type="button" disabled={!loaded || saving} onClick={() => { void window.callme.openDataFolder().catch(() => setError(t("Не удалось открыть папку встреч."))); }}>{t("Открыть папку")}</Button></div><CodexConnection /></section>}
          {tab === "appearance" && <section id="settings-panel-appearance" className="settings-group" role="tabpanel" aria-labelledby="settings-tab-appearance"><SettingsPanelTitle title={t("appearance")} /><div className="settings-card"><Field id="interface-locale" label={t("interfaceLanguage")} layout="inline"><Select id="interface-locale" disabled={disabled} value={values.locale} onChange={event => { const next = event.target.value as AppSettings["locale"]; setValues({ ...values, locale: next }); setPreference(next); }}><option value="system">{t("system")}</option><option value="ru">{t("russian")}</option><option value="en">{t("english")}</option></Select></Field><Field id="theme" label={t("theme")} layout="inline"><Select id="theme" disabled={disabled} value={values.theme} onChange={event => { const theme = event.target.value as AppSettings["theme"]; previewingTheme.current = true; setValues({ ...values, theme }); applyTheme(theme); }}><option value="system">{t("system")}</option><option value="light">{t("light")}</option><option value="dark">{t("dark")}</option></Select></Field></div><div className="settings-card settings-inline-block"><p className="settings-help">{t("compactHint")}</p><Button type="button" disabled={disabled} onClick={() => { void window.callme.showCompact().catch(() => setError("Не удалось открыть компактное окно.")); }}>{t("openCompact")}</Button><dl className="settings-shortcuts"><div><dt>Ctrl+Alt+Space</dt><dd>{t("showWindow")}</dd></div><div><dt>Ctrl+Alt+Enter</dt><dd>{t("answerDuringRecording")}</dd></div><div><dt>Escape</dt><dd>{t("hideMiniWindow")}</dd></div></dl></div></section>}
          {error && <p className="settings-error" role="alert">{t(error)}</p>}
        </div>
        </div>
        <div className="settings-actions">{tab === "updates" && !dirty ? <Button type="button" disabled={saving} onClick={() => { restoreTheme(); dialog.current?.close(); }}>{t("close")}</Button> : <><Button type="button" disabled={saving} onClick={() => { restoreTheme(); dialog.current?.close(); }}>{t("cancel")}</Button><Button type="submit" variant="primary" disabled={disabled || !dirty} loading={saving}>{saving ? t("saving") : t("save")}</Button></>}</div>
      </form>
    </dialog>
  </>;
}

function SettingsPanelTitle({ title, description }: { title: string; description?: string }) {
  return <header className="settings-panel-title"><h3>{title}</h3>{description && <p className="settings-help" role="status">{description}</p>}</header>;
}
