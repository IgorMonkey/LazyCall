// Real Electron/preload/provider boundary, synthetic model; no microphone or real login.
const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'callme-assistant-desktop-repository-'));
  const folder = path.join(data, 'repository');
  await mkdir(path.join(folder, 'src'), { recursive: true });
  await writeFile(path.join(folder, 'README.md'), '# Fixture repository\nREPOSITORY_DYNAMIC_V1\n', 'utf8');
  for (let index = 0; index < 40; index++) await writeFile(path.join(folder, 'src', `file-${index}.ts`), `export const value = 'REPO_FILE_${index}';`);
  const protocol = path.join(data, 'fixture-protocol.jsonl');
  const env = { ...process.env, CALLME_TEST_DATA: data, CALLME_SKIP_WHISPER: '1', CALLME_FIXTURE_FRAME_TEST: '1', CALLME_FIXTURE_LOG: protocol }; delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve('scripts/fixtures/assistant-main.cjs')], env });
    let page = await app.firstWindow();
    await page.getByRole('heading', { name: 'LazyCall', exact: true }).waitFor();
    await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, folder);
    assert.equal((await page.evaluate(() => window.callme.workspace())).project, null);
    const bound = await page.evaluate(() => window.callme.connectRepository());
    assert.equal(path.resolve(bound.folder.path), folder);
    assert.equal((await page.evaluate(() => window.callme.projectContext())).files.length, 0, 'Connecting a repository must not import a file selection');
    await page.evaluate(() => window.callme.agentConnect());
    await page.evaluate(() => {
      window.__repositoryProgress = [];
      window.__repositoryProgressOff = window.callme.onProjectAnalysisProgress(value => window.__repositoryProgress.push(value));
    });
    const initialOverview = await page.evaluate(() => window.callme.analyzeProject());
    assert.match(initialOverview.brief.text, /FIXTURE_REPOSITORY_OVERVIEW: REPOSITORY_DYNAMIC_V1/);
    assert(!initialOverview.brief.text.includes('FIXTURE_COMMENTARY_PLAN'), 'Commentary must never become the stored overview answer');
    const initialProgress = await page.evaluate(() => window.__repositoryProgress);
    for (const stage of ['starting', 'analyzing', 'reading', 'writing']) assert(initialProgress.some(value => value.stage === stage), 'Missing native overview progress stage: ' + stage);
    assert(initialProgress.some(value => value.filesRead === 1), 'Native overview progress must report one real repository read');
    const preservedBrief = initialOverview.brief.text;
    await page.evaluate(() => { window.__repositoryProgress = []; window.__overviewCancel = window.callme.analyzeProject(); });
    await page.waitForFunction(() => window.__repositoryProgress.some(value => value.stage === 'analyzing'));
    await page.evaluate(() => window.callme.cancelProjectAnalysis());
    assert.equal(await page.evaluate(() => window.__overviewCancel.then(() => false, () => true)), true, 'Cancelled overview must reject');
    assert.equal((await page.evaluate(() => window.callme.projectKnowledge())).brief.text, preservedBrief, 'Cancelled overview must keep the previous brief');
    const retriedOverview = await page.evaluate(() => window.callme.analyzeProject());
    assert.match(retriedOverview.brief.text, /FIXTURE_REPOSITORY_RETRY: REPOSITORY_DYNAMIC_V1/);
    const waitForAnswer = async (id, expected) => {
      let answer;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        answer = (await page.evaluate(() => window.callme.agentMessages())).find(message => message.id === id);
        if (answer?.state === 'done' || answer?.state === 'error') break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(answer?.state, 'done', 'Repository answer did not complete');
      assert(answer.text.includes(expected), answer.text);
      assert(!answer.text.includes('FIXTURE_COMMENTARY_PLAN'), 'Commentary must never reach displayed assistant text');
      return answer;
    };
    const ask = async (expected, text = 'FIXTURE_REPO_LOOKUP') => {
      const { requestId: id } = await page.evaluate(value => window.callme.agentAsk({ text: value, mode: 'answer', webSearch: false }), text);
      return waitForAnswer(id, expected);
    };
    const askReply = async lineId => {
      const { requestId: id } = await page.evaluate(value => window.callme.agentAsk({ text: '', replyToLineId: value, mode: 'answer', webSearch: false }), lineId);
      return waitForAnswer(id, 'FIXTURE_ONLY_CALLME_');
    };
    await page.evaluate(async () => {
      window.__fixtureReplyLine = '';
      window.callme.onTranscript(line => { if (line.source === 'remote') window.__fixtureReplyLine = line.id; });
      await window.callme.selectWindow('window:fixture:0');
      await window.callme.start();
      window.callme.audio('remote', 0, 800, new Uint8Array(320).buffer);
    });
    await page.waitForFunction(() => !!window.__fixtureReplyLine);
    await ask('FIXTURE_ONLY_CALLME_', 'отвечай из проекта: используй проверенный код и не обещай поиск позже.');
    const replyLineId = await page.evaluate(() => window.__fixtureReplyLine);
    for (let index = 0; index < 7; index++) await askReply(replyLineId);
    await ask('REPO_FILE_25');
    let rows = (await readFile(protocol, 'utf8')).trim().split('\n').map(JSON.parse);
    let turns = rows.filter(row => row.method === 'turn/start');
    let lookupPrompt = turns.at(-1).params.input.find(item => item.type === 'text').text;
    assert(lookupPrompt.includes(retriedOverview.brief.text), 'Project brief must be included in later assistant prompts');
    assert(lookupPrompt.includes('отвечай из проекта: используй проверенный код'), 'Typed user instruction must survive automatic reply pairs');
    assert(lookupPrompt.includes('REPOSITORY_DYNAMIC_V1'), 'Fresh checked repository excerpt must be included in the first request');
    const lookupThread = rows.filter(row => row.method === 'thread/start').at(-1);
    assert.deepEqual(lookupThread.params.dynamicTools.map(tool => tool.name), ['repo_list', 'repo_search', 'repo_read'], 'Selected folder must supply read-only tool definitions');
    await writeFile(path.join(folder, 'src', 'file-25.ts'), "export const value = 'CURRENT_REPO_VERSION';");
    await ask('CURRENT_REPO_VERSION');
    rows = (await readFile(protocol, 'utf8')).trim().split('\n').map(JSON.parse);
    turns = rows.filter(row => row.method === 'turn/start');
    lookupPrompt = turns.at(-1).params.input.find(item => item.type === 'text').text;
    assert(lookupPrompt.includes('CURRENT_REPO_VERSION'), 'Each new request must use a freshly read repository excerpt after a source edit');
    for (const row of rows.filter(row => row.method === 'turn/start')) assert(!JSON.stringify(row.params.input).includes(folder), 'Repository path must not be added to meeting prompt');
    await page.evaluate(() => window.callme.stop());
    const project = await page.evaluate(() => window.callme.createProject({ name: 'Separate repo scope', description: '' }));
    await page.evaluate(id => window.callme.selectProject(id), project.id);
    assert.equal((await page.evaluate(() => window.callme.projectKnowledge())).folder, null);
    await ask('FIXTURE_REPO_NOT_CONNECTED');
    await page.evaluate(() => window.callme.selectProject(null));
    assert.equal((await page.evaluate(() => window.callme.projectKnowledge())).folder.name, 'repository');
    await page.evaluate(() => window.callme.disconnectRepository());
    await ask('FIXTURE_REPO_NOT_CONNECTED');
    await app.close(); app = null;
    const journalRows = [];
    for (const sessionId of await readdir(path.join(data, 'sessions'))) {
      const eventFile = path.join(data, 'sessions', sessionId, 'events.jsonl');
      journalRows.push(...(await readFile(eventFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse));
    }
    const repositoryRequests = journalRows.filter(row => row.type === 'assistant.request' && row.payload.context?.repository === 'connected');
    assert(repositoryRequests.some(row => row.payload.briefCharacters > 0 && Array.isArray(row.payload.evidenceFiles)), 'Repository request journal must retain context and evidence metadata');
    assert(repositoryRequests.some(row => row.payload.evidenceFiles.includes('src/file-25.ts')), 'Fresh reread source must be recorded as request evidence');
    assert(journalRows.some(row => row.type === 'assistant.repository-read' && row.payload.path === 'src/file-25.ts'), 'Repository reads must be journaled without source content');
    assert(journalRows.some(row => row.type === 'assistant.completed'), 'Assistant completion must be journaled');
    assert(journalRows.some(row => row.type === 'assistant.message' && row.payload.role === 'user' && row.payload.origin === 'user' && row.payload.text.startsWith('отвечай из проекта:')), 'Typed instruction must preserve user provenance');
    assert(journalRows.filter(row => row.type === 'assistant.message' && row.payload.role === 'user' && row.payload.origin === 'reply').length >= 7, 'Automatic reply requests must preserve reply provenance');
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve('scripts/fixtures/assistant-main.cjs')], env });
    page = await app.firstWindow(); await page.getByRole('heading', { name: 'LazyCall', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.callme.projectKnowledge())).folder, null, 'Disconnect must persist');
    const result = { status: 'passed', checks: ['folder without project or imported files', 'native dynamic read beyond 16 files', 'repository overview progress through real IPC', 'overview cancellation preserves prior brief and retry works', 'phased commentary never becomes an answer', 'brief and fresh checked excerpts in later prompts', 'typed provenance survives automatic replies', 'repository request/read/completion journal metadata', 'fresh source after edit', 'project isolation', 'disconnect and restart'], fixture: 'synthetic stdio model; native dialogs stubbed; own userData; no microphone/cloud/auth' };
    await writeFile('test-results/repository-flow.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
