// Validate the real bundled app-server's experimental schema, without signing in or starting a model turn.
const { mkdtemp, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { CodexProvider } = require('../dist-electron/codex-provider');
const { repositoryTools } = require('../dist-electron/repository-reader');

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'callme-repository-protocol-'));
  const provider = new CodexProvider(path.resolve('runtime/codex/package/vendor/x86_64-pc-windows-msvc/bin/codex.exe'), path.join(data, 'home'), path.join(data, 'workspace'));
  try {
    const account = await provider.connect();
    assert.equal(account.state, 'login', 'Protocol test must use its own empty login profile');
    const thread = await provider.rpc('thread/start', { cwd: path.join(data, 'workspace'), approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, dynamicTools: repositoryTools });
    assert.equal(typeof thread.thread.id, 'string');
    await provider.rpc('thread/unsubscribe', { threadId: thread.thread.id });
    const result = { status: 'passed', bundledCodex: '0.145.0', dynamicToolSchemaAccepted: true, authentication: 'own empty profile', modelTurnStarted: false };
    await writeFile('test-results/repository-protocol.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { provider.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
