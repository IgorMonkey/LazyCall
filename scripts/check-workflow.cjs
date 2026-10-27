// Actual Electron IPC workflow using owned fixture data. It neither authenticates nor opens Codex.
const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const wait = async (check, label) => {
  const deadline = Date.now() + 12000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
};
const rejected = async task => {
  try { await task(); return false; } catch { return true; }
};

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'callme-assistant-desktop-'));
  const source = path.join(data, 'fixture-folder');
  await mkdir(path.join(source, 'docs'), { recursive: true });
  await Promise.all([
    writeFile(path.join(source, 'README.md'), 'FIXTURE_FOLDER_README: current project material.', 'utf8'),
    writeFile(path.join(source, 'docs', 'plan.md'), 'FIXTURE_FOLDER_PLAN: verify the handoff bundle.', 'utf8'),
    writeFile(path.join(source, '.env'), 'FIXTURE_SECRET_MUST_NOT_IMPORT=1', 'utf8')
  ]);
  const env = { ...process.env, CALLME_TEST_DATA: data, CALLME_SKIP_WHISPER: '1', CALLME_FIXTURE_FRAME_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let instance;
  const protocol = async () => (await readFile(path.join(data, 'fixture-protocol.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  try {
    instance = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'fixtures/assistant-main.cjs')], env, timeout: 30000 });
    const page = await instance.firstWindow();
    await page.getByRole('heading', { name: 'LazyCall', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.callme.agentStatus()).state === 'ready');
    await instance.evaluate(({ dialog, shell }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      shell.openExternal = async url => { global.__workflowCodexUrl = url; };
    }, source);

    const models = await page.evaluate(() => window.callme.agentModels());
    assert.deepEqual(models, [{ id: 'fixture-model', name: 'Fixture model', description: 'Owned test-only catalog entry.', isDefault: true, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }]);
    const configured = await page.evaluate(async () => window.callme.saveSettings({ language: 'ru', compute: 'auto', autoHints: false, autoSummary: true, screenContext: true, enterToSend: false, model: 'fixture-model', reasoningEffort: 'high' }));
    assert.equal(configured.model, 'fixture-model');
    assert.equal(configured.reasoningEffort, 'high');

    const project = await page.evaluate(() => window.callme.createProject({ name: 'FIXTURE_WORKFLOW_PROJECT', description: 'FIXTURE_WORKFLOW_DESCRIPTION' }));
    await page.evaluate(async id => { await window.callme.selectProject(id); await window.callme.setGoal('FIXTURE_WORKFLOW_GOAL'); }, project.id);
    const preview = await page.evaluate(() => window.callme.previewContextFolder());
    assert(preview, 'folder dialog must return an import preview');
    assert.deepEqual(preview.files.map(file => file.name), ['README.md', 'docs/plan.md']);
    assert(!JSON.stringify(preview).includes(source), 'preview must not expose an absolute source folder path');
    const imported = await page.evaluate(({ id, ids }) => window.callme.importContextFolder(id, ids), { id: preview.id, ids: preview.files.map(file => file.id) });
    assert.deepEqual(imported.files.map(file => file.relativePath), ['README.md', 'docs/plan.md']);

    const lineId = await page.evaluate(async () => {
      window.__workflowLines = [];
      window.callme.onTranscript(line => window.__workflowLines.push(line));
      await window.callme.selectWindow('window:fixture:0');
      await window.callme.start();
      window.callme.audio('remote', 0, 800, new Uint8Array(320).buffer);
      return (await window.callme.meetingResults()).sessionId;
    });
    assert(lineId, 'live fixture session starts');
    await wait(async () => (await page.evaluate(() => window.__workflowLines.length)) === 1, 'fixture transcript');
    const transcriptId = await page.evaluate(() => window.__workflowLines[0].id);
    assert(await rejected(() => page.evaluate(() => window.callme.agentAsk({ text: 'FIXTURE_UNKNOWN_REPLY', mode: 'answer', webSearch: false, replyToLineId: crypto.randomUUID() }))), 'unknown reply target must reject');
    await page.evaluate(id => window.callme.agentAsk({ text: 'FIXTURE_LOCKED_REPLY', mode: 'answer', webSearch: false, replyToLineId: id }), transcriptId);
    await page.evaluate(() => window.callme.audio('remote', 900, 1600, new Uint8Array(320).buffer));
    await wait(async () => (await page.evaluate(() => window.__workflowLines.length)) === 2, 'newer remote transcript after reply submit');
    await wait(async () => (await page.evaluate(() => window.callme.agentMessages())).at(-1)?.state === 'done', 'locked reply completion');
    let starts = (await protocol()).filter(value => value.method === 'turn/start');
    const lockedPrompt = starts.at(-1).params.input.find(item => item.type === 'text').text;
    assert(lockedPrompt.includes('Предложи ответ на реплику 00:00:\n«FIXTURE_TRANSCRIPT_CONFIRMED: номер заявки проверяем до пятницы.»'));
    assert(!lockedPrompt.includes('FIXTURE_NEWER_REMOTE_LINE_MUST_NOT_REPLACE_TARGET'), 'reply prompt must retain the submitted target rather than a later transcript');
    await page.evaluate(() => window.callme.audio('self', 1800, 2400, new Uint8Array(320).buffer));
    await wait(async () => (await page.evaluate(() => window.__workflowLines.length)) === 3, 'fixture self transcript');
    const selfId = await page.evaluate(() => window.__workflowLines[2].id);
    assert(await rejected(() => page.evaluate(id => window.callme.agentAsk({ text: 'FIXTURE_SELF_REPLY', mode: 'answer', webSearch: false, replyToLineId: id }), selfId)), 'self reply target must reject');
    await page.evaluate(() => window.callme.stop());
    await page.evaluate(async ({ transcriptId }) => {
      const current = await window.callme.meetingResults();
      await window.callme.note('FIXTURE_WORKFLOW_NOTE', current.sessionId);
      await window.callme.saveMeetingResults({ ...current, items: [{ id: crypto.randomUUID(), type: 'task', text: 'FIXTURE_WORKFLOW_CONFIRMED_TASK', evidenceIds: [transcriptId], status: 'confirmed', author: 'user', assignee: 'Fixture owner', dueDate: '' }] });
      await window.callme.agentAsk({ text: 'FIXTURE_WORKFLOW_ASK', mode: 'answer', webSearch: false });
    }, { transcriptId });
    await wait(async () => (await page.evaluate(() => window.callme.agentMessages())).at(-1)?.state === 'done', 'fixture assistant response');
    starts = (await protocol()).filter(value => value.method === 'thread/start');
    const lastStart = starts.at(-1);
    assert.equal(lastStart.params.model, 'fixture-model');
    assert.equal(lastStart.params.config.model_reasoning_effort, 'high');

    await page.evaluate(() => window.callme.continueInCodex());
    const url = await instance.evaluate(() => global.__workflowCodexUrl);
    assert.equal(typeof url, 'string');
    const handoff = new URL(url);
    assert.equal(handoff.protocol, 'codex:');
    assert.equal(handoff.hostname, 'new');
    const handoffDirectory = handoff.searchParams.get('path');
    const prompt = handoff.searchParams.get('prompt');
    assert(handoffDirectory && path.dirname(handoffDirectory).toLowerCase() === path.join(data, 'handoffs').toLowerCase());
    assert(prompt && prompt.length < 500 && prompt.includes('meeting.md') && prompt.includes('context.md'));
    assert(!url.includes(source) && !url.includes('FIXTURE_FOLDER_README') && !url.includes('FIXTURE_SECRET_MUST_NOT_IMPORT'));
    assert(!url.includes('codex-home') && !url.includes('assistant-workspace'));
    assert.deepEqual((await readdir(handoffDirectory)).sort(), ['context.md', 'meeting.md']);
    const [meeting, context] = await Promise.all([readFile(path.join(handoffDirectory, 'meeting.md'), 'utf8'), readFile(path.join(handoffDirectory, 'context.md'), 'utf8')]);
    assert(meeting.includes('FIXTURE_TRANSCRIPT_CONFIRMED') && meeting.includes('FIXTURE_WORKFLOW_NOTE') && meeting.includes('FIXTURE_WORKFLOW_CONFIRMED_TASK') && meeting.includes('FIXTURE_ONLY_CALLME_ОТВЕТ'));
    assert(context.includes('README.md') && context.includes('docs/plan.md') && context.includes('FIXTURE_FOLDER_README') && context.includes('FIXTURE_FOLDER_PLAN'));
    assert(!meeting.includes(source) && !context.includes(source) && !context.includes('FIXTURE_SECRET_MUST_NOT_IMPORT'));
    const report = { status: 'passed', fixture: 'Synthetic owned provider/STT and native dialog/shell stubs; no auth, user files, or external launch', checks: ['model catalog and explicit model/reasoning request', 'folder preview/import with relative paths', 'quick reply locks the submitted remote quote and rejects unknown/self IDs', 'current meeting transcript/note/results/messages handoff', 'handoff URL contains only owned directory and short prompt'] };
    await writeFile('test-results/workflow-report.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report));
  } finally {
    if (instance) await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
