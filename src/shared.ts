export type SourceRole = "self" | "remote";
export interface AppSettings { language: "ru" | "en" | "auto"; locale: "system" | "ru" | "en"; compute: "auto" | "cpu"; autoHints: boolean; autoSummary: boolean; screenContext: boolean; enterToSend: boolean; model: string; reasoningEffort: string; theme: "light" | "dark" | "system" }
export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = { language: "ru", locale: "system", compute: "auto", autoHints: false, autoSummary: true, screenContext: true, enterToSend: true, model: "", reasoningEffort: "default", theme: "system" };
export interface ProjectKnowledge { folder: { name: string; path: string; available: boolean } | null; brief: { text: string; generatedAt: string; fingerprint: string; stale: boolean; files: string[]; repositoryFiles?: string[] } | null }
export interface ProjectAnalysisProgress { stage: "starting" | "reading" | "analyzing" | "writing"; filesRead: number }
export interface CodexIntegration { enabled: boolean; prepared: boolean }
export interface SettingsSnapshot { values: AppSettings; dataDirectory: string }
export interface UpdateStatus { state: "unconfigured" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "error"; currentVersion: string; version?: string; percent?: number; transferred?: number; total?: number; message?: string }
export interface AgentStatus { state: "disconnected" | "connecting" | "login" | "ready" | "error"; label: string; model?: string }
export interface AgentModel { id: string; name: string; description: string; isDefault: boolean; reasoningEfforts: string[]; defaultReasoningEffort: string }
export interface AssistantContext { projectName: string; repository: "connected" | "unavailable" | "none"; brief: boolean; documents: number }
export interface AssistantMessage { id: string; role: "user" | "assistant"; text: string; state: "streaming" | "done" | "error"; kind: "answer" | "research" | "summary"; createdAt: number; replyToLineId?: string; replyToLine?: TranscriptLine; origin?: "user" | "reply"; progress?: ProjectAnalysisProgress; context?: AssistantContext }
export interface AssistantRequest { text: string; mode: "answer" | "research" | "summary"; webSearch: boolean; note?: string; replyToLineId?: string }
export interface ContextFile { id: string; name: string; bytes: number; relativePath?: string }
export interface ContextFolderFile { id: string; name: string; bytes: number; recommended?: boolean; reason?: string; changed?: boolean }
export interface ContextFolderPreview { id: string; name: string; files: ContextFolderFile[]; maxFiles: number; maxBytes: number; truncated: boolean; selectedIds?: string[] }
export interface ProjectContext { goal: string; files: ContextFile[] }
export interface Project { id: string; name: string; description: string; createdAt: string; updatedAt: string }
export interface ProjectInput { name: string; description: string }
export interface WorkspaceSnapshot { project: Project | null; context: ProjectContext }
export interface ResultItem { id: string; type: "decision" | "task" | "question"; text: string; evidenceIds: string[]; status: "draft" | "confirmed" | "rejected"; author: "user" | "assistant"; assignee: string; dueDate: string; evidenceStale?: boolean }
export interface MeetingResults { sessionId: string; revision: number; items: ResultItem[]; transcriptStale?: boolean }
export interface MeetingSummary { id: string; startedAt: string; endedAt?: string; title: string; interrupted: boolean; projectId?: string; projectName?: string }
export interface MeetingSnapshot { meeting: MeetingSummary; lines: TranscriptLine[]; note: string; messages: AssistantMessage[]; goal: string; results: MeetingResults }
export interface WindowSource { id: string; name: string; thumbnail: string }
export interface TranscriptLine {
  id: string;
  source: SourceRole;
  startMs: number;
  endMs: number;
  text: string;
  originalText?: string;
  editedAt?: string;
}
export interface WhisperStatus {
  state: "missing" | "loading" | "ready" | "error";
  label: string;
  backend: "CPU" | "CUDA" | null;
  pending?: number;
  oldestQueuedAt?: number;
  dropped?: number;
}
export interface MeetingState {
  id: string;
  lines: TranscriptLine[];
  note: string;
  startedAt: string;
}
export interface HealthEvent { message: string; severity: "info" | "error" }
export interface CompactShortcuts { toggle: string; reply: string; toggleRegistered: boolean; replyRegistered: boolean }
export interface CompactSnapshot { phase: "idle" | "live" | "paused" | "done"; theme: AppSettings["theme"]; /** Optional while older main-process snapshots are still supported. */ locale?: AppSettings["locale"]; agent: AgentStatus; target: TranscriptLine | null; answer: AssistantMessage | null; answerTarget: TranscriptLine | null; busy: boolean; error: string; shortcuts: CompactShortcuts }
export interface CompactApi {
  snapshot(): Promise<CompactSnapshot>;
  onSnapshot(fn: (value: CompactSnapshot) => void): () => void;
  ask(): Promise<void>;
  cancel(): Promise<void>;
  showMain(): Promise<void>;
  hide(): Promise<void>;
  copyAnswer(): Promise<void>;
  openLink(url: string): Promise<void>;
}
export interface DesktopApi {
  codexRuntime(): Promise<{ source: "bundled" | "installed" | "missing"; executable: string | null; version: string | null; error?: string }>;
  refreshCodexRuntime(): ReturnType<DesktopApi["codexRuntime"]>;
  chooseCodexRuntime(): ReturnType<DesktopApi["codexRuntime"]>;
  installCodexInstructions(): Promise<void>;
  updateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateStatus(fn: (status: UpdateStatus) => void): () => void;
  showCompact(): Promise<void>;
  projectKnowledge(): Promise<ProjectKnowledge>;
  connectRepository(): Promise<ProjectKnowledge | null>;
  disconnectRepository(): Promise<ProjectKnowledge>;
  refreshContextFolder(): Promise<ContextFolderPreview>;
  suggestContextFiles(previewId: string, topic: string): Promise<ContextFolderPreview>;
  editTranscript(value: { sessionId: string; lineId: string; text: string; expectedText: string }): Promise<{ line: TranscriptLine; results: MeetingResults }>;
  onTranscriptEdited(fn: (value: { sessionId: string; line: TranscriptLine; results: MeetingResults }) => void): () => void;
  setCapturePaused(paused: boolean): Promise<void>;
  analyzeProject(): Promise<ProjectKnowledge>;
  onProjectAnalysisProgress(fn: (progress: ProjectAnalysisProgress) => void): () => void;
  cancelProjectAnalysis(): Promise<void>;
  saveProjectBrief(text: string): Promise<ProjectKnowledge>;
  codexIntegration(): Promise<CodexIntegration>;
  connectCodexIntegration(): Promise<CodexIntegration>;
  disconnectCodexIntegration(): Promise<CodexIntegration>;
  copyMeetingForCodex(): Promise<void>;
  agentModels(): Promise<AgentModel[]>;
  listProjects(): Promise<Project[]>;
  workspace(): Promise<WorkspaceSnapshot>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, input: ProjectInput): Promise<Project>;
  selectProject(id: string | null): Promise<WorkspaceSnapshot>;
  meetingResults(): Promise<MeetingResults>;
  saveMeetingResults(value: MeetingResults): Promise<MeetingResults>;
  onMeetingResults(fn: (value: MeetingResults) => void): () => void;
  agentStatus(): Promise<AgentStatus>;
  agentConnect(): Promise<AgentStatus>;
  agentLogin(): Promise<void>;
  agentLogout(): Promise<void>;
  agentAsk(request: AssistantRequest): Promise<{requestId: string; sessionId: string}>;
  agentCancel(requestId: string): Promise<void>;
  agentMessages(): Promise<AssistantMessage[]>;
  onAgentStatus(fn: (status: AgentStatus) => void): () => void;
  onAssistantMessage(fn: (message: AssistantMessage) => void): () => void;
  projectContext(): Promise<ProjectContext>;
  setGoal(goal: string): Promise<ProjectContext>;
  addContextFiles(): Promise<ProjectContext>;
  previewContextFolder(): Promise<ContextFolderPreview | null>;
  importContextFolder(previewId: string, fileIds: string[]): Promise<ProjectContext>;
  removeContextFile(id: string): Promise<ProjectContext>;
  listMeetings(): Promise<MeetingSummary[]>;
  openMeeting(id: string): Promise<MeetingSnapshot>;
  openLink(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  settings(): Promise<SettingsSnapshot>;
  saveSettings(values: AppSettings): Promise<AppSettings>;
  openDataFolder(): Promise<void>;
  windows(): Promise<WindowSource[]>;
  prepareMicrophone(): Promise<string>;
  finishMicrophone(token: string): Promise<void>;
  selectWindow(id: string): Promise<void>;
  whisperStatus(): Promise<WhisperStatus>;
  start(): Promise<{ sessionId: string }>;
  stop(): Promise<void>;
  audio(source: SourceRole, startMs: number, endMs: number, pcm: ArrayBuffer): void;
  frame(dataUrl: string, atMs: number): void;
  health(message: string, severity?: "info" | "error"): void;
  note(text: string, sessionId: string): Promise<void>;
  export(): Promise<boolean>;
  continueInCodex(): Promise<void>;
  onTranscript(fn: (line: TranscriptLine) => void): () => void;
  onStatus(fn: (state: WhisperStatus) => void): () => void;
  onHealth(fn: (event: HealthEvent) => void): () => void;
  onCaptureStop(fn: () => void): () => void;
}
