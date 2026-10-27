// Owned Electron entry for compact-window integration tests. It stubs global shortcuts
// before product main is loaded, so the test never sends a system-wide key press.
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const { globalShortcut } = require("electron");

const root = path.resolve(process.env.CALLME_TEST_DATA || "");
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert(path.basename(root).startsWith("callme-compact-desktop-"));
assert.equal(process.env.CALLME_SKIP_WHISPER, "1");
const handlers = new Map();
const shortcutLog = path.join(root, "compact-shortcuts.json");
const writeShortcuts = () => fs.writeFileSync(shortcutLog, JSON.stringify({ registered: [...handlers.keys()], unregistered: global.__compactUnregistered }));
global.__compactUnregistered = [];
global.__compactShortcutHandlers = handlers;
globalShortcut.register = (accelerator, callback) => {
  if (process.env.CALLME_FIXTURE_SHORTCUT_CONFLICT === accelerator) return false;
  handlers.set(accelerator, callback); writeShortcuts(); return true;
};
globalShortcut.unregister = accelerator => { global.__compactUnregistered.push(accelerator); handlers.delete(accelerator); writeShortcuts(); };
globalShortcut.unregisterAll = () => { for (const accelerator of [...handlers.keys()]) globalShortcut.unregister(accelerator); };

const { Whisper } = require(path.join(__dirname, "../../dist-electron/whisper.js"));
Whisper.prototype.start = async function () { this.status = { state: "ready", label: "Fixture only", backend: "CPU" }; };
Whisper.prototype.drain = async function () {};
Whisper.prototype.enqueue = function (job) {
  const text = job.startMs >= 900
    ? "FIXTURE_NEWER_REMOTE_LINE_MUST_NOT_REPLACE_TARGET."
    : "FIXTURE_COMPACT_TARGET: подтвердите срок по заявке.";
  queueMicrotask(() => this.onText?.(job, text));
};

const originalSpawn = childProcess.spawn;
childProcess.spawn = (executable, args, options) => {
  if (path.basename(executable).toLowerCase() !== "codex.exe") return originalSpawn(executable, args, options);
  assert.equal(options.env.CODEX_HOME, path.join(root, "codex-home"));
  assert.equal(options.shell, false);
  return originalSpawn(process.execPath, [path.join(__dirname, "assistant-provider.cjs")], {
    ...options,
    env: { ...options.env, ELECTRON_RUN_AS_NODE: "1", CALLME_FIXTURE_LOG: path.join(root, "fixture-protocol.jsonl") }
  });
};
require(path.join(__dirname, "../../dist-electron/main.js"));
