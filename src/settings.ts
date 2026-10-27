import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "./shared";

export const defaultSettings = DEFAULT_APP_SETTINGS;
const EFFORTS = new Set(["default", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

export function validateSettings(input: unknown): AppSettings {
  const value = input as Partial<AppSettings> | null;
  if (!value || !["ru", "en", "auto"].includes(value.language ?? "") || !["auto", "cpu"].includes(value.compute ?? "") ||
    (value.autoHints !== undefined && typeof value.autoHints !== "boolean") ||
    (value.autoSummary !== undefined && typeof value.autoSummary !== "boolean") ||
    (value.screenContext !== undefined && typeof value.screenContext !== "boolean") ||
    (value.enterToSend !== undefined && typeof value.enterToSend !== "boolean") ||
    (value.locale !== undefined && !["system", "ru", "en"].includes(value.locale)) ||
    (value.theme !== undefined && !["light", "dark", "system"].includes(value.theme)) ||
    (value.model !== undefined && (typeof value.model !== "string" || (value.model !== "" && !MODEL.test(value.model)))) ||
    (value.reasoningEffort !== undefined && (typeof value.reasoningEffort !== "string" || !EFFORTS.has(value.reasoningEffort)))) {
    throw new Error("Некорректные настройки распознавания");
  }
  const model = value.model ?? DEFAULT_APP_SETTINGS.model;
  const reasoningEffort = value.reasoningEffort ?? DEFAULT_APP_SETTINGS.reasoningEffort;
  if (reasoningEffort !== "default" && !model) throw new Error("Для выбранного уровня рассуждений укажите модель");
  return {
    language: value.language!, locale: value.locale ?? DEFAULT_APP_SETTINGS.locale, compute: value.compute!,
    autoHints: value.autoHints ?? DEFAULT_APP_SETTINGS.autoHints,
    autoSummary: value.autoSummary ?? DEFAULT_APP_SETTINGS.autoSummary,
    screenContext: value.screenContext ?? DEFAULT_APP_SETTINGS.screenContext,
    enterToSend: value.enterToSend ?? DEFAULT_APP_SETTINGS.enterToSend,
    model, reasoningEffort, theme: value.theme ?? DEFAULT_APP_SETTINGS.theme
  };
}
export async function loadSettings(directory: string): Promise<AppSettings> {
  try { return validateSettings(JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...defaultSettings };
    throw error;
  }
}
export async function storeSettings(directory: string, input: unknown): Promise<AppSettings> {
  const value = validateSettings(input);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, "settings.json");
  await writeFile(target + ".tmp", JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(target + ".tmp", target);
  return value;
}
