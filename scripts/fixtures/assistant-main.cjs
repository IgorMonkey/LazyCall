// Test entry point only. Product main/preload/IPC/storage run unchanged.
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const root = path.resolve(process.env.CALLME_TEST_DATA || '');
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert(path.basename(root).startsWith('callme-assistant-desktop-'));
assert.equal(process.env.CALLME_SKIP_WHISPER, '1');
const originalSpawn = childProcess.spawn;
if (process.env.CALLME_FIXTURE_FRAME_TEST === '1') {
  const { Whisper } = require(path.join(__dirname, '../../dist-electron/whisper.js'));
  Whisper.prototype.start = async function () { this.status = { state: 'ready', label: 'Fixture only', backend: 'CPU' }; };
  Whisper.prototype.drain = async function () {};
  Whisper.prototype.enqueue = function (job) {
    const text = job.startMs >= 900 ? 'FIXTURE_NEWER_REMOTE_LINE_MUST_NOT_REPLACE_TARGET.' : 'FIXTURE_TRANSCRIPT_CONFIRMED: номер заявки проверяем до пятницы.';
    queueMicrotask(() => this.onText?.(job, text));
  };
  const promises = require('node:fs/promises');
  const originalWriteFile = promises.writeFile;
  promises.writeFile = async (file, ...rest) => {
    if (typeof file === 'string' && file.endsWith('.jpg')) {
      assert(path.resolve(file).toLowerCase().startsWith(root.toLowerCase() + path.sep));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return originalWriteFile(file, ...rest);
  };
}
childProcess.spawn = (executable, args, options) => {
  if (path.basename(executable).toLowerCase() !== 'codex.exe') return originalSpawn(executable, args, options);
  if (args.length === 1 && args[0] === '--version') return originalSpawn(executable, args, options);
  assert.equal(options.env.CODEX_HOME, path.join(root, 'codex-home'));
  assert.equal(options.shell, false);
  return originalSpawn(process.execPath, [path.join(__dirname, 'assistant-provider.cjs')], {
    ...options, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1', CALLME_FIXTURE_LOG: path.join(root, 'fixture-protocol.jsonl') }
  });
};
require(path.join(__dirname, '../../dist-electron/main.js'));
