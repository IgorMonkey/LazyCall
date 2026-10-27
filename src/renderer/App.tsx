import { useEffect, useRef, useState } from "react";
import { DEFAULT_APP_SETTINGS, type AgentStatus, type AppSettings, type AssistantMessage, type HealthEvent, type MeetingResults, type MeetingSnapshot, type TranscriptLine, type WhisperStatus, type WindowSource, type WorkspaceSnapshot } from "../shared";
import { Capture } from "./capture";
import { Settings } from "./Settings";
import { Button, Field, Icon, IconButton, Select, TextArea } from "./ui";
import { Assistant } from "./Assistant";
import { Materials } from "./Materials";
import { Meetings } from "./Meetings";
import { Projects } from "./Projects";
import { Results } from "./Results";
import { useTranscriptFollow } from "./useTranscriptFollow";
import { CodexHandoff } from "./CodexHandoff";
import { cachedTheme, useTheme } from "./theme";
import { TranscriptEditor } from "./TranscriptEditor";
import { useI18n } from "./i18n";
import { Onboarding } from "./Onboarding";
import { BrandMark, BrandWordmark } from "./BrandMark";
import { HeaderMore } from "./HeaderMore";

const time = (ms: number) => String(Math.floor(ms / 60000)).padStart(2, "0") + ":" + String(Math.floor(ms / 1000) % 60).padStart(2, "0");
function whisperStatusLabel(status: WhisperStatus, t: (key: string) => string) {
  const known: Record<string, string> = {
    "Проверяем Whisper…": "Проверяем Whisper…",
    "Проверяем локальную модель…": "Проверяем локальную модель…",
    "Модель не найдена. Переустановите LazyCall или повторите загрузку компонентов.": "Модель не найдена. Переустановите LazyCall или повторите загрузку компонентов.",
    "Модель ещё не установлена. Запусти yarn setup:whisper.": "Модель ещё не установлена. Запусти yarn setup:whisper.",
    "Загружаем Whisper на видеокарте…": "Загружаем Whisper на видеокарте…",
    "Загружаем Whisper на процессоре…": "Загружаем Whisper на процессоре…",
    "Локальное распознавание готово. Используется видеокарта.": "Локальное распознавание готово. Используется видеокарта.",
    "Локальное распознавание готово. Используется процессор.": "Локальное распознавание готово. Используется процессор."
  };
  return known[status.label] ? t(known[status.label]) : status.label;
}

export function App() {
  const [onboardingRequest, setOnboardingRequest] = useState(0);
  const { locale, setPreference: setLocalePreference, t } = useI18n();
  const [sources, setSources] = useState<WindowSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [status, setStatus] = useState<WhisperStatus>({ state: "loading", label: "Проверяем Whisper…", backend: null });
  const [phase, setPhase] = useState<"idle" | "starting" | "live" | "paused" | "stopping" | "done">("idle");
  const [pauseChanging, setPauseChanging] = useState(false);
  const [editingLine, setEditingLine] = useState<TranscriptLine | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [note, setNote] = useState("");
  const [levels, setLevels] = useState({ self: 0, remote: 0 });
  const [preview, setPreview] = useState("");
  const [frameAt, setFrameAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [messages, setMessages] = useState<HealthEvent[]>([]);
  const [hasSession, setHasSession] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [noteState, setNoteState] = useState<"draft" | "saving" | "saved" | "error">("draft");
  const { viewport: transcript, body: transcriptBody, awayFromBottom, followLatest, jumpTo: jumpToEvidence, onScroll: onTranscriptScroll } = useTranscriptFollow(lines);
  const [preferences, setPreferences] = useState<AppSettings>({ ...DEFAULT_APP_SETTINGS, theme: cachedTheme() });
  useTheme(preferences.theme);
  const [agent, setAgent] = useState<AgentStatus>({ state: "disconnected", label: "Помощник не подключён" });
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [loadingMeeting, setLoadingMeeting] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>({ project: null, context: { goal: "", files: [] } });
  const [results, setResults] = useState<MeetingResults>({ sessionId: "", revision: 0, items: [] });
  const [resultsOpen, setResultsOpen] = useState(0);
  const [autoSummaryPending, setAutoSummaryPending] = useState(false);
  const [completionSaved, setCompletionSaved] = useState(false);
  const noteEpoch = useRef(0);
  const noteSaved = useRef("");
  const sessionId = useRef("");
  const capture = useRef<Capture | null>(null);
  const anchor = useRef(0);
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const stopInProgress = useRef(false);
  const autoSummaryAttempted = useRef(false);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const recording = phase === "live" || phase === "paused" || phase === "starting";
  const disabled = recording || phase === "stopping" || loadingMeeting;

  const report = (message: string, severity: "info" | "error" = "error") => {
    setMessages(old => [...old.slice(-3), { message, severity }]);
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const windows = await window.callme.windows();
      setSources(windows);
      setSourceId(old => windows.some(s => s.id === old) ? old : "");
    } catch (e) { report(String(e)); }
    finally { setRefreshing(false); }
    // Device enumeration can wait for an active document. It must not hide the window list.
    void navigator.mediaDevices.enumerateDevices().then(devices => setMicrophones(devices.filter(d => d.kind === "audioinput"))).catch(() => {});
  };
  useEffect(() => {
    void refresh();
    void window.callme.whisperStatus().then(setStatus);
    void window.callme.settings().then(snapshot => { const next = { ...DEFAULT_APP_SETTINGS, ...snapshot.values }; setPreferences(next); setLocalePreference(next.locale); }).catch(() => report("Не удалось прочитать настройки."));
    void window.callme.agentStatus().then(setAgent).catch(() => {});
    void window.callme.agentMessages().then(setAssistantMessages).catch(() => {});
    void window.callme.workspace().then(setWorkspace).catch(() => {});
    void window.callme.meetingResults().then(setResults).catch(() => {});
    const off = [
      window.callme.onStatus(setStatus),
      window.callme.onTranscript(line => {
        const next = [...linesRef.current, line].sort((a, b) => a.startMs - b.startMs);
        linesRef.current = next;
        setLines(next);
      }),
      window.callme.onHealth(event => setMessages(old => [...old.slice(-3), event])),
      window.callme.onCaptureStop(() => void stopRef.current())
      ,window.callme.onTranscriptEdited(value => {
        if (value.sessionId !== sessionId.current) return;
        const next = linesRef.current.map(line => line.id === value.line.id ? value.line : line);
        linesRef.current = next; setLines(next); setResults(value.results);
      })
      ,window.callme.onAgentStatus(setAgent)
      ,window.callme.onAssistantMessage(message => setAssistantMessages(old => {
        const found = old.findIndex(item => item.id === message.id);
        return found < 0 ? [...old, message] : old.map(item => item.id === message.id ? message : item);
      }))
      ,window.callme.onMeetingResults(value => {
        if (!value.sessionId || !sessionId.current || value.sessionId === sessionId.current) setResults(value);
      })
    ];
    const onDeviceChange = () => { void navigator.mediaDevices.enumerateDevices().then(devices => setMicrophones(devices.filter(d => d.kind === "audioinput"))); };
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => { off.forEach(fn => fn()); navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange); };
  }, []);
  useEffect(() => {
    if (!autoSummaryPending || autoSummaryAttempted.current || agent.state !== "ready" || !lines.length || assistantMessages.some(message => message.state === "streaming")) return;
    autoSummaryAttempted.current = true;
    setAutoSummaryPending(false);
    void generateResults().catch(error => report(error instanceof Error ? error.message : String(error)));
  }, [autoSummaryPending, agent.state, lines.length, assistantMessages]);
  useEffect(() => {
    if (phase !== "live" && phase !== "paused") return;
    const timer = setInterval(() => setElapsed(performance.now() - anchor.current), 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (!hasSession) { setNoteState("draft"); return; }
    if (loadingMeeting || phase === "starting" || phase === "stopping") return;
    if (note === noteSaved.current) { setNoteState("saved"); return; }
    let current = true;
    const epoch = noteEpoch.current;
    const targetSession = sessionId.current;
    setNoteState("saving");
    const timer = setTimeout(() => {
      if (epoch !== noteEpoch.current) return;
      void window.callme.note(note, targetSession).then(() => { if (current) { noteSaved.current = note; setNoteState("saved"); } })
        .catch(e => { if (current) { setNoteState("error"); report(String(e)); } });
    }, 450);
    return () => { current = false; clearTimeout(timer); };
  }, [note, hasSession, sessionEpoch, loadingMeeting, phase]);

  const start = async () => {
    if (disabled || !sourceId) return;
    noteEpoch.current++;
    autoSummaryAttempted.current = false; setAutoSummaryPending(false);
    setSessionEpoch(old => old + 1);
    setPhase("starting"); setMessages([]); setPreview(""); setFrameAt(null);
    setCompletionSaved(false);
    try {
      await window.callme.selectWindow(sourceId);
      sessionId.current = (await window.callme.start()).sessionId;
      const preparedNote = phase === "done" ? "" : note;
      await window.callme.note(preparedNote, sessionId.current);
      noteSaved.current = preparedNote; noteEpoch.current++;
      setLines([]); linesRef.current = []; setAssistantMessages([]); setNote(preparedNote); setHasSession(true); setElapsed(0); followLatest(); setMeetingTitle("");
      anchor.current = performance.now();
      const instance = new Capture({
        level(source, value) { setLevels(old => ({ ...old, [source]: value })); },
        frame(dataUrl, atMs) {
          setPreview(dataUrl); setFrameAt(atMs);
          window.callme.frame(dataUrl, atMs);
        },
        problem(message, severity) { window.callme.health(message, severity); }
      });
      capture.current = instance;
      await instance.start(micId);
      setPhase("live");
    } catch (e) {
      await capture.current?.stop();
      capture.current = null;
      await window.callme.stop().catch(() => {});
      setPhase("idle"); setLevels({ self: 0, remote: 0 });
      setSessionEpoch(old => old + 1);
      report(e instanceof Error ? e.message : String(e));
    }
  };
  const stop = async () => {
    if (stopInProgress.current || phase === "stopping") return;
    stopInProgress.current = true;
    setPhase("stopping");
    let failure: unknown;
    try { await capture.current?.stop(); } catch (error) { failure = error; }
    capture.current = null;
    setLevels({ self: 0, remote: 0 });
    try { await window.callme.note(note, sessionId.current); } catch (error) { failure ||= error; }
    // A note-write failure must never leave native capture acceptance running.
    try { await window.callme.stop(); } catch (error) { failure ||= error; }
    setCompletionSaved(!failure); setPhase("done");
    if (failure) report(failure instanceof Error ? failure.message : String(failure));
    else if (preferences.autoSummary && agent.state === "ready" && linesRef.current.length && !autoSummaryAttempted.current) setAutoSummaryPending(true);
    stopInProgress.current = false;
  };
  stopRef.current = stop;
  const togglePause = async () => {
    const instance = capture.current;
    if (!instance || pauseChanging || (phase !== "live" && phase !== "paused")) return;
    setPauseChanging(true);
    try {
      if (phase === "live") {
        await instance.pause();
        setPhase("paused"); setLevels({ self: 0, remote: 0 }); setPreview(""); setFrameAt(null);
        await window.callme.setCapturePaused(true);
      } else {
        await window.callme.setCapturePaused(false);
        try { await instance.resume(); setPhase("live"); }
        catch (error) { await window.callme.setCapturePaused(true).catch(() => {}); throw error; }
      }
    } catch (error) {
      if (instance.isPaused()) { setPhase("paused"); setLevels({ self: 0, remote: 0 }); await window.callme.setCapturePaused(true).catch(() => {}); }
      report(error instanceof Error ? error.message : String(error));
    }
    finally { setPauseChanging(false); }
  };
  const loadMeeting = async (id: string) => {
    if (disabled) return;
    noteEpoch.current++; autoSummaryAttempted.current = false; setAutoSummaryPending(false); setLoadingMeeting(true); setEditingLine(null);
    try {
      if (hasSession && note !== noteSaved.current) await window.callme.note(note, sessionId.current);
      const snapshot: MeetingSnapshot = await window.callme.openMeeting(id);
      sessionId.current = snapshot.meeting.id;
      noteSaved.current = snapshot.note;
      setLines(snapshot.lines); setNote(snapshot.note); setAssistantMessages(snapshot.messages);
      setResults(snapshot.results || await window.callme.meetingResults());
      setWorkspace(await window.callme.workspace()); setHasSession(true); setPhase("done"); setMeetingTitle(snapshot.meeting.title);
      setCompletionSaved(true);
      setPreview(""); setSourceId(""); setFrameAt(null); setElapsed(snapshot.lines.at(-1)?.endMs || 0);
      setSessionEpoch(old => old + 1); followLatest();
    } catch (e) { report(e instanceof Error ? e.message : String(e)); throw e; }
    finally { setLoadingMeeting(false); }
  };
  const selectProject = async (id: string | null) => {
    setEditingLine(null);
    noteEpoch.current++;
    autoSummaryAttempted.current = false; setAutoSummaryPending(false);
    if (hasSession && note !== noteSaved.current) await window.callme.note(note, sessionId.current);
    const next = await window.callme.selectProject(id);
    noteSaved.current = ""; sessionId.current = "";
    setWorkspace(next); setLines([]); linesRef.current = []; setNote(""); setAssistantMessages([]); setResults({ sessionId: "", revision: 0, items: [] });
    setHasSession(false); setMeetingTitle(""); setPreview(""); setFrameAt(null); setElapsed(0); setPhase("idle"); followLatest(); setSessionEpoch(old => old + 1);
  };
  const generateResults = async () => {
    const result = await window.callme.agentAsk({ text: locale === "en" ? "Summarize the recording: topics, decisions, tasks and unresolved questions, if any. Do not invent owners, deadlines or evidence." : "Кратко подведи итоги записи: о чём говорили, решения, задачи и открытые вопросы, если они были. Не выдумывай исполнителей, сроки или источники.", mode: "summary", webSearch: false, note });
    sessionId.current = result.sessionId; noteSaved.current = note; setHasSession(true);
  };
  const saveResults = async (value: MeetingResults) => {
    const saved = await window.callme.saveMeetingResults(value);
    if (saved.sessionId && saved.sessionId !== sessionId.current) {
      await window.callme.note(note, saved.sessionId);
      sessionId.current = saved.sessionId; noteSaved.current = note; setHasSession(true); setSessionEpoch(old => old + 1);
    }
    setResults(saved); return saved;
  };
  const postActionBusy = autoSummaryPending || assistantMessages.some(message => message.state === "streaming");
  const source = sources.find(s => s.id === sourceId);
  const message = messages.at(-1);
  const meetingLabel = phase === "live" ? t("Идёт встреча") : phase === "paused" ? t("Запись на паузе") : phase === "done" ? t("Встреча завершена") :
    phase === "starting" ? t("Подключение") : phase === "stopping" ? t("Завершение встречи") : t("Новая встреча");
  const headerStatus = loadingMeeting ? t("Открываем встречу…") : meetingTitle || (phase !== "idle" && phase !== "done" ? meetingLabel : "");

  const readyLabel = status.state === "ready" ? t("Распознавание готово") : status.state === "loading" ? t("Загружаем распознавание…") :
    status.state === "missing" ? t("Модель не установлена") : t("Распознавание недоступно");
  const noteLabel = noteState === "saving" ? t("Сохраняем…") : noteState === "saved" ? t("Сохранено") :
    noteState === "error" ? t("Не сохранено") : note ? t("Черновик") : "";
  const exportMeeting = () => void window.callme.export().then(ok => {
    if (ok) report("Расшифровка и заметки сохранены в файл.", "info");
  }).catch(e => report(String(e)));
  const prepareCodexTransfer = async () => {
    if (hasSession && note !== noteSaved.current) {
      await window.callme.note(note, sessionId.current);
      noteSaved.current = note;
    }
  };
  const startFresh = () => void selectProject(workspace.project?.id || null).catch(error => report(String(error)));

  return <div className="app" data-testid="stt-status" data-state={status.state}>
    <header className={"app-header" + (headerStatus ? " has-meeting-heading" : "")}>
      <div className="brand" aria-label="LazyCall">
        <BrandMark />
        <h1 aria-label="LazyCall"><BrandWordmark /></h1>
      </div>
      {headerStatus && <div className={"meeting-heading" + (phase === "live" ? " is-recording" : "")} title={headerStatus} role="status">{headerStatus}</div>}
      <div className="header-actions">
        <Projects workspace={workspace} disabled={disabled || assistantMessages.some(message => message.state === "streaming")} onSelected={selectProject} onUpdated={async () => setWorkspace(await window.callme.workspace())} />
        <Meetings disabled={disabled} onOpen={loadMeeting} projectId={workspace.project?.id} />
        <Settings busy={disabled} status={status} agent={agent} onSaved={next => { setPreferences(next); setLocalePreference(next.locale); }} />
        <HeaderMore exportDisabled={!hasSession || phase === "stopping"} onExport={exportMeeting} onCompact={() => void window.callme.showCompact().catch(error => report(String(error)))} onHelp={() => setOnboardingRequest(value => value + 1)} />
      </div>
    </header>
    <Onboarding requestOpen={onboardingRequest} showTrigger={false} />

    {phase === "done" ? <section className="post-recording" aria-label={t("Завершённая запись")}><div><strong>{completionSaved ? t("Встреча сохранена") : t("Запись завершена с ошибкой")}</strong><span>{time(elapsed)}</span></div><div className="done-actions"><Button variant="primary" onClick={() => setResultsOpen(old => old + 1)}>{autoSummaryPending || assistantMessages.some(message => message.state === "streaming" && message.kind === "summary") ? t("Составляем итоги…") : t("Итоги встречи")}</Button><CodexHandoff disabled={postActionBusy} beforeTransfer={prepareCodexTransfer} onError={report} onNotice={message => report(message, "info")} /><Button variant="quiet" disabled={postActionBusy} title={postActionBusy ? t("Дождитесь ответа или остановите его") : t("Подготовить новую встречу")} onClick={startFresh}>{t("Новая встреча")}</Button></div></section> : <><section className="setup" aria-label={t("Источники встречи")}>
      <Field id="microphone" label={t("Микрофон")} icon="mic">
        <Select id="microphone" aria-label={t("Микрофон")} disabled={disabled} value={micId} onChange={e => setMicId(e.target.value)}>
          <option value="">{t("По умолчанию")}</option>
          {microphones.filter(d => d.deviceId && d.deviceId !== "default").map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || t("Микрофон {number}", { number: i + 1 })}</option>)}
        </Select>
      </Field>
      <Field id="meeting-window" label={t("Окно созвона")} icon="screen">
        <Select id="meeting-window" aria-label={t("Окно созвона")} disabled={disabled} value={sourceId} onChange={e => setSourceId(e.target.value)}>
          <option value="">{refreshing ? t("Ищем доступные окна…") : sources.length ? t("Выберите окно созвона") : t("Откройте окно созвона")}</option>
          {sources.map(s => <option key={s.id} value={s.id}>{s.id.startsWith("screen:") ? t("Весь экран: ") : ""}{s.name}</option>)}
        </Select>
      </Field>
      <IconButton icon="refresh" loading={refreshing} disabled={disabled} onClick={() => void refresh()} aria-label="Обновить список окон и устройств" title="Обновить окна и устройства" />
      <div className="start-control">
        <div className={"timer " + (phase === "live" ? "is-live" : "")} aria-label={"Длительность встречи: " + time(elapsed)}><span className="status-dot" /><span>{time(elapsed)}</span></div>
        {phase === "live" || phase === "paused" ?
          <Button variant="stop" icon="stop" disabled={pauseChanging} onClick={() => void stop()}>{t("Завершить")}</Button> :
          <Button variant="primary" icon="play" loading={phase === "starting" || phase === "stopping"} disabled={disabled || status.state !== "ready" || !sourceId} onClick={() => void start()}
            title={status.state !== "ready" ? readyLabel : !sourceId ? "Выберите окно созвона" : "Включить микрофон, системный звук и захват выбранного окна"}>
            {phase === "starting" ? t("Подключаем…") : phase === "stopping" ? t("Завершаем…") : hasSession ? t("Новая встреча") : t("Начать встречу")}
          </Button>}
      </div>
    </section>

    <div className="audio-status">
      <Meter name={t("Вы")} value={levels.self} active={phase === "live"} />
      <Meter name={t("Собеседники")} value={levels.remote} active={phase === "live"} />
      {(phase === "live" || phase === "paused") && <div className="capture-controls">
        {!!status.pending && <span className={"capture-progress " + (status.oldestQueuedAt && Date.now() - status.oldestQueuedAt > 12000 ? "is-delayed" : "")} role="status">{status.oldestQueuedAt && Date.now() - status.oldestQueuedAt > 12000 ? "Распознавание отстаёт" : "Распознаём речь"}{status.pending > 1 ? `: ${status.pending} фрагм.` : ""}</span>}
        {phase === "paused" && <span className="capture-progress" role="status">{t("Звук и кадры не поступают")}</span>}
        <Button size="compact" variant="quiet" icon={phase === "paused" ? "play" : "pause"} loading={pauseChanging} onClick={() => void togglePause()}>{phase === "paused" ? t("Продолжить") : t("Пауза")}</Button>
      </div>}
    </div></>}

    {message && <div className={"alert " + message.severity} role={message.severity === "error" ? "alert" : "status"}>
      <Icon name={message.severity === "error" ? "warning" : "check"} /><span>{message.message}</span>
      <IconButton icon="close" size="small" className="alert-dismiss" onClick={() => setMessages([])} aria-label="Скрыть уведомление" title="Скрыть уведомление" />
    </div>}

    {results.transcriptStale && phase === "done" && <div className="transcript-stale-notice" role="status"><span>{t("Расшифровка исправлена. Прежние итоги устарели.")}</span><Button size="compact" variant="text" onClick={() => setResultsOpen(old => old + 1)}>{t("Проверить итоги")}</Button></div>}
    <main className="workspace">
      <section className="conversation" aria-label={t("Расшифровка встречи")}>
        <div className="pane-header"><h2>{t("Расшифровка")}</h2><Materials source={source} preview={preview} frameAt={frameAt} phase={phase} epoch={sessionEpoch} project={workspace.project} onSnapshot={() => { if (!capture.current?.snapshot()) report(t("Кадр пока недоступен. Повторите через секунду."), "info"); }} /></div>
        <div className="transcript" ref={transcript} onScroll={onTranscriptScroll}>
          <div ref={transcriptBody}>
          {lines.length === 0 ? <div className="empty-transcript">
            <p>{phase === "live" ? t("Слушаем…") :
              phase === "stopping" ? t("Обрабатываем последние фразы…") :
              phase === "done" ? t("Речь не распознана.") : t("Реплики появятся во время встречи.")}</p>
            {phase === "idle" && <p className="empty-transcript-next">{locale === "en" ? "Choose a meeting window, then start the meeting." : "Выберите окно созвона, затем начните встречу."}</p>}
          </div> : lines.map(line => <article key={line.id} data-line-id={line.id} tabIndex={-1} className={"utterance " + line.source}>
            <time className="utterance-time">{time(line.startMs)}</time>
            <div className="utterance-body"><div className="utterance-meta"><span className="speaker">{line.source === "self" ? t("Вы") : t("Собеседники")}</span>{line.editedAt && <span className="transcript-edited-label" title={t("Исходное распознавание сохранено")}>{t("Исправлено")}</span>}{phase === "done" && <Button size="compact" variant="text" className="transcript-edit-action" aria-label={t("Исправить реплику ") + time(line.startMs)} disabled={postActionBusy || loadingMeeting} onClick={() => setEditingLine(line)}>{t("Исправить")}</Button>}</div><p>{line.text}</p></div>
          </article>)}
          </div>
        </div>
        {awayFromBottom && lines.length > 0 && <div className="conversation-footer"><Button variant="text" icon="down" onClick={followLatest}>{t("К последней реплике")}</Button></div>}
        <section className="quick-notes" aria-label={t("Заметки встречи")}><div className="quick-notes-heading"><h2>{t("Заметки")}</h2><span className={"secondary-label note-state " + noteState}>{noteLabel}</span></div><TextArea aria-label={t("Заметки")} placeholder={t("Записать важное…")} rows={2} value={note} onChange={event => setNote(event.target.value)} maxLength={100000} spellCheck /></section>
      </section>

      <Assistant status={agent} messages={assistantMessages} hasSession={hasSession} hasTranscript={lines.length > 0} phase={phase} enterToSend={preferences.enterToSend} replyTarget={[...lines].reverse().find(line => line.source === "remote")} sessionEpoch={sessionEpoch} note={note} onPrepared={id => { sessionId.current = id; noteSaved.current = note; setHasSession(true); }} onAddNote={text => { const combined = note.trim() ? note.trimEnd() + "\n\n" + text : text; if (combined.length > 100000) { report("В заметках недостаточно места для этого ответа."); return; } setNote(combined); report("Добавлено в заметки.", "info"); }} onError={report} onOpenResults={() => setResultsOpen(old => old + 1)} />
    </main>
    <TranscriptEditor line={editingLine} sessionId={sessionId.current} blocked={phase !== "done" || postActionBusy} onClose={() => setEditingLine(null)} onEdited={value => { const next = linesRef.current.map(line => line.id === value.line.id ? value.line : line); linesRef.current = next; setLines(next); setResults(value.results); }} />
    <Results value={results} lines={lines} phase={phase} agent={agent} busy={postActionBusy} hasProject={!!workspace.project} summaryText={[...assistantMessages].reverse().find(message => message.role === "assistant" && message.kind === "summary" && message.state === "done")?.text || ""} generating={assistantMessages.some(message => message.state === "streaming" && message.kind === "summary")} canGenerate={agent.state === "ready" && lines.length > 0} onGenerate={generateResults} onCancel={async () => { const message = [...assistantMessages].reverse().find(item => item.state === "streaming" && item.kind === "summary"); if (message) await window.callme.agentCancel(message.id); }} onSave={saveResults} onJump={jumpToEvidence} openSignal={resultsOpen} />

    {status.state !== "ready" && <footer className="app-footer"><span className={"engine-status " + status.state} title={whisperStatusLabel(status, t)}><span className="status-dot" />{readyLabel}</span></footer>}
  </div>;
}

function Meter({ name, value, active }: { name: string; value: number; active: boolean }) {
  return <div className={"meter " + (active ? "active" : "")}><span className="meter-label" title={name === "Собеседники" ? "Системный звук всех приложений на выбранном выходе" : "Звук вашего микрофона"}>{name}</span><div className="meter-bars" aria-hidden="true">{Array.from({ length: 15 }, (_, i) => <i key={i} className={active && value * 15 > i ? "lit" : ""} />)}</div></div>;
}

