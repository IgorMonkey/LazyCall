import { useEffect, useState } from "react";
import type { DesktopApi } from "../shared";
import { Button } from "./ui";
import { useI18n } from "./i18n";

export function CodexRuntime({ busy }: { busy: boolean }) {
  const { locale } = useI18n();
  const en = locale === "en";
  const [runtime, setRuntime] = useState<Awaited<ReturnType<DesktopApi["codexRuntime"]>> | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void window.callme.codexRuntime?.().then(value => { if (mounted) setRuntime(value); }).catch(() => { if (mounted) setError(en ? "Could not check Codex." : "Не удалось проверить Codex."); });
    return () => { mounted = false; };
  }, []);
  if (!window.callme.codexRuntime) return null;
  const action = async (run: () => ReturnType<DesktopApi["codexRuntime"]>) => {
    setWorking(true); setError("");
    try { setRuntime(await run()); }
    catch { setError(en ? "Could not connect Codex. Finish the recording and check the selected executable." : "Не удалось подключить Codex. Завершите запись и проверьте выбранный файл."); }
    finally { setWorking(false); }
  };
  return <div className="settings-runtime" style={{ display: "grid", gap: 12, padding: 16, border: "1px solid var(--line)", borderRadius: 10 }}>
    <strong>{!runtime ? (en ? "Looking for Codex…" : "Проверяем Codex…") : runtime.source === "missing" ? (en ? "Codex CLI is not installed" : "Codex CLI не найден") : `${en ? "Codex found" : "Codex найден"}: ${runtime.version}`}</strong>
    <p className="settings-help">{runtime?.executable ? (en ? "LazyCall uses this CLI with its own profile. Sign in below to enable suggestions." : "LazyCall использует этот CLI с отдельным профилем. Войдите ниже, чтобы включить подсказки.") : (en ? "Transcription works without Codex. For AI suggestions, install the CLI and select Find again." : "Расшифровка работает без Codex. Для AI-подсказок установите CLI, затем нажмите «Найти снова».")}</p>
    {runtime?.executable && <p className="settings-help settings-path" title={runtime.executable}>{runtime.executable}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {runtime?.source === "missing" && <Button type="button" disabled={working} onClick={() => { void window.callme.installCodexInstructions().catch(() => setError(en ? "Could not open installation instructions." : "Не удалось открыть инструкцию установки.")); }}>{en ? "Install Codex" : "Установить Codex"}</Button>}
      <Button type="button" variant="secondary" disabled={busy || working} onClick={() => void action(() => window.callme.refreshCodexRuntime())}>{working ? (en ? "Checking…" : "Проверяем…") : (en ? "Find again" : "Найти снова")}</Button>
      <Button type="button" variant="quiet" disabled={busy || working} onClick={() => void action(() => window.callme.chooseCodexRuntime())}>{en ? "Choose codex.exe" : "Выбрать codex.exe"}</Button>
    </div>
    {error && <p className="settings-error" role="alert">{error}</p>}
  </div>;
}
