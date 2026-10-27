import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { useI18n } from "./i18n";
import "./onboarding.css";

export const ONBOARDING_DISMISSED_KEY = "callme.onboarding.dismissed.v1";

type StepCopy = { eyebrow: string; title: string; body: string; aside?: string; action?: string };
type Copy = { trigger: string; skip: string; back: string; next: string; done: string; progress: (step: number) => string; steps: StepCopy[] };

const content: Record<"ru" | "en", Copy> = {
  ru: {
    trigger: "Как пользоваться", skip: "Пропустить", back: "Назад", next: "Дальше", done: "Готово",
    progress: step => `Шаг ${step} из 3`,
    steps: [
      { eyebrow: "Первый созвон", title: "Выберите звук и начните", body: "Выберите окно созвона. LazyCall запишет микрофон и системный звук, а расшифровка появится по ходу разговора.", aside: "Код сгенерировал. Теперь объясняй." },
      { eyebrow: "Подсказки", title: "Подключите помощника — если нужен", body: "В настройках можно войти через ChatGPT. Тогда помощник использует расшифровку и контекст проекта для подсказок. Без входа работает локальная расшифровка.", action: "Открыть настройки помощника" },
      { eyebrow: "Контекст и итоги", title: "Папка проекта — по желанию", body: "Перед встречей можно подключить папку проекта и указать цель. Без них помощник опирается на разговор. После встречи — проверьте итоги, экспортируйте расшифровку или продолжите работу в Codex." }
    ]
  },
  en: {
    trigger: "How it works", skip: "Skip", back: "Back", next: "Next", done: "Done",
    progress: step => `Step ${step} of 3`,
    steps: [
      { eyebrow: "First call", title: "Choose your audio and start", body: "Choose the meeting window. LazyCall records your microphone and system audio, then builds the transcript as you talk.", aside: "You generated the code. Now explain it." },
      { eyebrow: "Suggestions", title: "Connect an assistant if you need one", body: "In Settings, sign in with ChatGPT. The assistant can then use the transcript and project context for suggestions. Local transcription works without sign-in.", action: "Open assistant settings" },
      { eyebrow: "Context and results", title: "Project folder? Optional.", body: "You can connect a project folder and set a goal before a meeting. Without them, the assistant uses the conversation. Afterwards, review the results, export the transcript, or continue in Codex." }
    ]
  }
};

function isDismissed() {
  try { return Boolean(window.localStorage.getItem(ONBOARDING_DISMISSED_KEY)); }
  catch { return false; }
}

export function Onboarding({ requestOpen = 0, showTrigger = true }: { requestOpen?: number; showTrigger?: boolean }) {
  const { locale } = useI18n();
  const copy = content[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [leavingStep, setLeavingStep] = useState<number | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);

  useEffect(() => {
    if (!isDismissed()) setVisible(true);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (visible && !element.open) element.showModal();
    if (!visible && element.open) element.close();
  }, [visible]);

  useEffect(() => {
    if (leavingStep === null) return;
    const timer = window.setTimeout(() => setLeavingStep(null), 200);
    return () => window.clearTimeout(timer);
  }, [leavingStep]);

  const dismiss = () => {
    try { window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "true"); } catch { /* The tutorial remains optional when storage is unavailable. */ }
    setVisible(false);
    window.setTimeout(() => (restoreFocus.current?.isConnected ? restoreFocus.current : trigger.current)?.focus(), 0);
  };
  const show = () => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStep(0); setLeavingStep(null); setVisible(true);
  };
  useEffect(() => { if (requestOpen > 0) show(); }, [requestOpen]);
  const move = (next: number) => {
    if (next < 0 || next > 2 || leavingStep !== null) return;
    setDirection(next > step ? 1 : -1);
    setLeavingStep(step);
    setStep(next);
  };
  const openAssistantSettings = () => {
    dismiss();
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("callme:open-settings", { detail: { tab: "assistant" } })), 0);
  };
  const current = copy.steps[step];

  return <>
    {showTrigger && <button ref={trigger} type="button" className="button button-quiet button-compact onboarding-trigger" onClick={show}>{copy.trigger}</button>}
    <dialog ref={dialog} className="onboarding-dialog" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" data-testid="onboarding-dialog" onCancel={event => { event.preventDefault(); dismiss(); }}>
      <div className="onboarding-shell">
        <div className="onboarding-topline"><span>{copy.progress(step + 1)}</span><button type="button" className="onboarding-skip" data-testid="onboarding-skip" onClick={dismiss}>{copy.skip}</button></div>
        <div className="onboarding-progress" aria-hidden="true">{copy.steps.map((_, index) => <i key={index} className={index === step ? "is-active" : index < step ? "is-complete" : ""} />)}</div>
        <div className="onboarding-stage" aria-live="polite">
          {leavingStep !== null && <Slide key={`leaving-${leavingStep}`} copy={copy.steps[leavingStep]} step={leavingStep} direction={direction} leaving />}
          <Slide key={`current-${step}`} copy={current} step={step} direction={direction} />
        </div>
        <div className="onboarding-actions">
          <Button variant="quiet" data-testid="onboarding-back" onClick={() => move(step - 1)} disabled={step === 0 || leavingStep !== null}>{copy.back}</Button>
          <div className="onboarding-actions-main">{current.action && <Button variant="secondary" data-testid="onboarding-open-assistant" onClick={openAssistantSettings}>{current.action}</Button>}<Button variant="primary" data-testid={step === 2 ? "onboarding-done" : "onboarding-next"} onClick={() => step === 2 ? dismiss() : move(step + 1)} disabled={leavingStep !== null}>{step === 2 ? copy.done : copy.next}</Button></div>
        </div>
      </div>
    </dialog>
  </>;
}

function Slide({ copy, step, direction, leaving = false }: { copy: StepCopy; step: number; direction: 1 | -1; leaving?: boolean }) {
  return <section className={`onboarding-slide ${leaving ? "is-leaving" : "is-entering"} ${direction > 0 ? "is-forward" : "is-backward"}`} aria-hidden={leaving || undefined} data-testid={`onboarding-step-${step + 1}`}>
    <div className="onboarding-copy"><p className="onboarding-eyebrow">{copy.eyebrow}</p><h2 id={leaving ? undefined : "onboarding-title"}>{copy.title}</h2><p id={leaving ? undefined : "onboarding-description"}>{copy.body}</p>{copy.aside && <p className="onboarding-aside">{copy.aside}</p>}</div>
  </section>;
}
