import path from "node:path";

/** Product branding is independent from the persistent storage identifier. */
export function runtimeIdentity(executable: string) {
  const preview = /^(?:LazyCall|CallMe)WebPreview\.exe$/i.test(path.win32.basename(executable));
  return { name: preview ? "LazyCallWebPreview" : "LazyCall", dataDirectory: preview ? "LazyCallWebPreview" : "CallMe", preview };
}
