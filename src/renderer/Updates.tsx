import { useEffect, useState } from "react";
import type { UpdateStatus } from "../shared";
import { Button } from "./ui";
import { useI18n } from "./i18n";

function updateMessage(message: string, t: (key: string) => string) {
  const known = new Set([
    "Канал обновлений ещё не подключён", "Установлена актуальная версия", "Можно проверить наличие новой версии",
    "Не удалось получить обновление. Проверьте подключение и повторите попытку.", "Не удалось проверить обновления. Повторите попытку позже.",
    "Загрузка не завершена. Проверьте обновления и повторите попытку."
  ]);
  return known.has(message) ? t(message) : message;
}

export function Updates({ busy }: { busy: boolean }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<UpdateStatus>({ state: "unconfigured", currentVersion: "", message: "Канал обновлений ещё не подключён" });
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let mounted = true;
    void window.callme.updateStatus?.().then(value => { if (mounted) setStatus(value); }).catch(() => { if (mounted) setError(t("Не удалось получить состояние обновлений")); });
    const unsubscribe = window.callme.onUpdateStatus?.(value => { if (mounted) { setStatus(value); setError(""); } });
    return () => { mounted = false; unsubscribe?.(); };
  }, []);
  const action = async (run: () => Promise<unknown>) => {
    setWorking(true); setError("");
    try { await run(); }
    catch (value) { setError(value instanceof Error ? value.message : t("Не удалось выполнить действие")); }
    finally { setWorking(false); }
  };
  const loading = status.state === "checking" || status.state === "downloading";
  return <section className="settings-group settings-updates" aria-label={t("Обновления LazyCall")}>
    <header className="settings-panel-title"><h3>{t("Обновления LazyCall")}</h3>{status.currentVersion && <p className="settings-help">{t("Установлена версия {version}", { version: status.currentVersion })}</p>}</header>
    <div className="settings-card updates-status-card">
    <div role="status" aria-live="polite">
      {status.state === "checking" ? <p>{t("Проверяем наличие новой версии…")}</p> : status.state === "available" ? <p>{t("Доступна версия {version}", { version: status.version || "" })}</p> : status.state === "downloaded" ? <p>{t("Версия {version} готова к установке", { version: status.version || "" })}</p> : status.message && <p>{updateMessage(status.message, t)}</p>}
      {status.state === "downloading" && <><p>{t("Скачиваем версию {version} — {percent}%", { version: status.version || "", percent: Math.floor(status.percent || 0) })}</p><progress aria-label={t("Загрузка обновления")} max={100} value={status.percent || 0} style={{ width: "100%" }} />{status.total ? <p className="muted">{t("{current} of {total} MB", { current: Math.round((status.transferred || 0) / 1_000_000), total: Math.round(status.total / 1_000_000) })}</p> : null}</>}
    </div>
    {status.state === "available" ? <Button disabled={working} onClick={() => void action(() => window.callme.downloadUpdate())}>{t("Скачать обновление")}</Button>
      : status.state === "downloaded" ? <><p>{t("Встречи и настройки сохранятся. LazyCall закроется на время установки.")}</p>{busy && <p className="settings-notice">{t("Сначала завершите запись.")}</p>}<Button disabled={working || busy} onClick={() => void action(() => window.callme.installUpdate())}>{t("Закрыть LazyCall и установить")}</Button></>
      : status.state !== "unconfigured" && <Button disabled={working || loading} onClick={() => void action(async () => setStatus(await window.callme.checkForUpdates()))}>{loading ? t("Подождите…") : status.state === "error" ? t("Повторить проверку") : t("Проверить обновления")}</Button>}
    </div>
    <p className="muted">{t("Новые версии скачиваются по вашему нажатию. Во время записи приложение не обновляется.")}</p>
    {error && <p role="alert" className="error">{t(error)}</p>}
  </section>;
}
