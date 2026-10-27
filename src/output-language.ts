import type { AppSettings } from "./shared";
export function outputLanguage(preference: AppSettings["locale"], system: string): "English" | "Russian" {
  return preference === "ru" || (preference === "system" && /^ru(?:-|$)/i.test(system)) ? "Russian" : "English";
}
