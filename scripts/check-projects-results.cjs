// Actual Electron main/preload/IPC integration for projects and structured meeting results.
// The owned fixture supplies synthetic STT and provider protocol only; no account, model, media, or user data is used.
const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const wait = async (check, label) => {
  const end = Date.now() + 12000;
  while (!await check()) {
    if (Date.now() > end) throw new Error('Timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 80));
  }
};
const rejected = async task => {
  try { await task(); return false; } catch { return true; }
};

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'callme-assistant-desktop-'));
  const projectAFile = path.join(data, 'Проект-A.md');
  const projectBFile = path.join(data, 'Проект-B.md');
  const exported = path.join(data, 'project-a-export.md');
  await Promise.all([
    writeFile(projectAFile, 'FIXTURE_FILE_A_DESCRIPTION: заявки проверяют по номеру из письма.', 'utf8'),
    writeFile(projectBFile, 'FIXTURE_FILE_B_DESCRIPTION: отдельный контекст B.', 'utf8'),
    mkdir('test-results', { recursive: true })
  ]);
  const env = { ...process.env, CALLME_TEST_DATA: data, CALLME_SKIP_WHISPER: '1', CALLME_FIXTURE_FRAME_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  let instance;
  let selectedFile = projectAFile;
  const turns = async () => {
    const file = path.join(data, 'fixture-protocol.jsonl');
    const raw = await readFile(file, 'utf8');
    return raw.trim().split('\n').map(JSON.parse).filter(value => value.method === 'turn/start').map(value => value.params.input.find(item => item.type === 'text').text);
  };
  const launch = async () => {
    instance = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'fixtures/assistant-main.cjs')], env, timeout: 30000 });
    const page = await instance.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    await page.getByRole('heading', { name: 'LazyCall', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.callme.agentStatus()).state === 'ready');
    await instance.evaluate(({ dialog }, values) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.selectedFile] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.exported });
    }, { selectedFile, exported });
    return page;
  };
  const selectFixtureFile = async file => {
    selectedFile = file;
    await instance.evaluate(({ dialog }, next) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [next] });
    }, file);
  };
  const addTranscript = async page => {
    await page.evaluate(() => {
      window.__fixtureLines = [];
      window.__fixtureUnsubscribe?.();
      window.__fixtureUnsubscribe = window.callme.onTranscript(line => window.__fixtureLines.push(line));
      window.callme.audio('remote', 0, 800, new Uint8Array(320).buffer);
    });
    await wait(async () => (await page.evaluate(() => window.__fixtureLines.length)) > 0, 'synthetic transcript reaches main IPC');
    return page.evaluate(() => window.__fixtureLines[0].id);
  };
  const startWithLine = async (page, lockedProjectId) => {
    await page.evaluate(async () => { await window.callme.selectWindow('window:fixture:0'); await window.callme.start(); });
    if (lockedProjectId) assert(await rejected(() => page.evaluate(id => window.callme.selectProject(id), lockedProjectId)), 'active capture must block project changes');
    const lineId = await addTranscript(page);
    await page.evaluate(() => window.callme.stop());
    return lineId;
  };
  try {
    let page = await launch();
    const created = await page.evaluate(async () => {
      const a = await window.callme.createProject({ name: 'FIXTURE_PROJECT_A', description: 'FIXTURE_PROJECT_A_DESCRIPTION' });
      const b = await window.callme.createProject({ name: 'FIXTURE_PROJECT_B', description: 'FIXTURE_PROJECT_B_DESCRIPTION' });
      const updated = await window.callme.updateProject(a.id, { name: 'FIXTURE_PROJECT_A', description: 'FIXTURE_PROJECT_A_DESCRIPTION_UPDATED' });
      return { a: updated, b, listed: await window.callme.listProjects() };
    });
    assert.equal(created.listed.length, 2);
    assert.equal(created.a.description, 'FIXTURE_PROJECT_A_DESCRIPTION_UPDATED');

    const workspaceA = await page.evaluate(async id => {
      await window.callme.selectProject(id);
      await window.callme.setGoal('FIXTURE_GOAL_A');
      return window.callme.addContextFiles();
    }, created.a.id);
    assert.equal(workspaceA.goal, 'FIXTURE_GOAL_A');
    assert.deepEqual(workspaceA.files.map(file => file.name), ['Проект-A.md']);
    const prepItem = { id: randomUUID(), type: 'task', text: 'FIXTURE_PREP_CONFIRMED_TASK', evidenceIds: [], status: 'confirmed', author: 'user', assignee: 'FIXTURE_PREP_OWNER', dueDate: '' };
    const prepared = await page.evaluate(item => window.callme.saveMeetingResults({ sessionId: '', revision: 0, items: [item] }), prepItem);
    assert(prepared.sessionId, 'offline manual results create a preparation session');
    assert.equal(prepared.revision, 1);
    assert.deepEqual(prepared.items, [prepItem]);
    const lineA = await startWithLine(page, created.b.id);
    const carriedA = await page.evaluate(() => window.callme.meetingResults());
    const sessionA = carriedA.sessionId;
    assert(sessionA && lineA, 'A must have a persisted session and transcript source');
    assert.notEqual(sessionA, prepared.sessionId, 'live capture gets a new journal');
    assert.deepEqual(carriedA.items, [prepItem], 'user preparation item carries into the live journal');
    assert.equal(carriedA.revision, 1);

    await page.evaluate(() => window.callme.agentAsk({ text: 'FIXTURE_SUMMARY_A', mode: 'summary', webSearch: false }));
    await wait(async () => (await page.evaluate(() => window.callme.agentMessages())).some(message => message.role === 'assistant' && message.kind === 'summary' && message.state === 'done'), 'structured summary completion');
    let summaryA = await page.evaluate(() => window.callme.meetingResults());
    const generated = summaryA.items.find(value => value.author === 'assistant');
    assert(generated, 'summary adds an assistant draft alongside preparation results');
    assert.equal(generated.status, 'draft');
    assert.deepEqual(generated.evidenceIds, [lineA]);

    const item = generated;
    const manualTask = { id: randomUUID(), type: 'task', text: 'FIXTURE_A_CONFIRMED_TASK', evidenceIds: [lineA], status: 'confirmed', author: 'user', assignee: 'FIXTURE_OWNER_A', dueDate: '2026-10-31' };
    const draftTask = { id: randomUUID(), type: 'task', text: 'FIXTURE_A_DRAFT_TASK', evidenceIds: [lineA], status: 'draft', author: 'user', assignee: '', dueDate: '' };
    const rejectedDecision = { id: randomUUID(), type: 'decision', text: 'FIXTURE_A_REJECTED_DECISION', evidenceIds: [lineA], status: 'rejected', author: 'user', assignee: '', dueDate: '' };
    const question = { id: randomUUID(), type: 'question', text: 'FIXTURE_A_CONFIRMED_QUESTION', evidenceIds: [lineA], status: 'confirmed', author: 'user', assignee: '', dueDate: '' };
    summaryA = await page.evaluate(async ({ current, item, manualTask, draftTask, rejectedDecision, question }) => window.callme.saveMeetingResults({ ...current, items: current.items.map(value => value.id === item.id ? { ...item, text: 'FIXTURE_A_CONFIRMED_DECISION', status: 'confirmed' } : value).concat([manualTask, draftTask, rejectedDecision, question]) }), { current: summaryA, item, manualTask, draftTask, rejectedDecision, question });
    assert.equal(summaryA.revision, 3);
    assert(await rejected(() => page.evaluate(stale => window.callme.saveMeetingResults(stale), { ...summaryA, revision: 1 })), 'stale result revision must reject');
    assert(await rejected(() => page.evaluate(({ current, bad }) => window.callme.saveMeetingResults({ ...current, items: [...current.items, bad] }), { current: summaryA, bad: { ...manualTask, id: randomUUID(), evidenceIds: [randomUUID()] } })), 'unknown evidence must reject');

    const editedBeforeRetry = summaryA.items.filter(value => [item.id, manualTask.id, draftTask.id, rejectedDecision.id].includes(value.id));
    await page.evaluate(() => window.callme.agentAsk({ text: 'FIXTURE_SUMMARY_A_RETRY', mode: 'summary', webSearch: false }));
    await wait(async () => (await page.evaluate(() => window.callme.agentMessages())).filter(message => message.role === 'assistant' && message.kind === 'summary' && message.state === 'done').length === 2, 'summary retry completion');
    summaryA = await page.evaluate(() => window.callme.meetingResults());
    for (const expected of editedBeforeRetry) assert.deepEqual(summaryA.items.find(value => value.id === expected.id), expected, 'summary retry preserves user-edited and reviewed values');

    const race = await page.evaluate(async ({ current, line }) => {
      const item = text => ({ id: crypto.randomUUID(), type: 'task', text, evidenceIds: [line], status: 'draft', author: 'user', assignee: '', dueDate: '' });
      return Promise.allSettled([
        window.callme.saveMeetingResults({ ...current, items: [...current.items, item('FIXTURE_RACE_FIRST')] }),
        window.callme.saveMeetingResults({ ...current, items: [...current.items, item('FIXTURE_RACE_SECOND')] })
      ]).then(values => values.map(value => value.status));
    }, { current: summaryA, line: lineA });
    assert.deepEqual(race.sort(), ['fulfilled', 'rejected'], 'only one simultaneous optimistic result write may win');
    summaryA = await page.evaluate(() => window.callme.meetingResults());
    assert.equal(summaryA.items.filter(value => /^FIXTURE_RACE_/.test(value.text)).length, 1, 'losing simultaneous write cannot overwrite the accepted value');

    await page.evaluate(() => window.callme.export());
    const markdown = await readFile(exported, 'utf8');
    assert(markdown.includes('FIXTURE_A_CONFIRMED_DECISION'));
    assert(markdown.includes('FIXTURE_A_CONFIRMED_TASK'));
    assert(markdown.includes('FIXTURE_TRANSCRIPT_CONFIRMED'));

    await page.evaluate(id => window.callme.selectProject(id), created.b.id);
    await selectFixtureFile(projectBFile);
    const workspaceB = await page.evaluate(async () => { await window.callme.setGoal('FIXTURE_GOAL_B'); return window.callme.addContextFiles(); });
    assert.deepEqual(workspaceB.files.map(file => file.name), ['Проект-B.md']);
    const lineB = await startWithLine(page);
    const sessionB = (await page.evaluate(() => window.callme.meetingResults())).sessionId;
    assert.notEqual(sessionB, sessionA);
    const Bresult = await page.evaluate(async ({ line }) => {
      const current = await window.callme.meetingResults();
      return window.callme.saveMeetingResults({ ...current, items: [{ id: crypto.randomUUID(), type: 'decision', text: 'FIXTURE_B_CONFIRMED_DECISION', evidenceIds: [line], status: 'confirmed', author: 'user', assignee: '', dueDate: '' }] });
    }, { line: lineB });
    assert.equal(Bresult.items[0].status, 'confirmed');
    await page.evaluate(() => window.callme.agentAsk({ text: 'FIXTURE_B_PROMPT', mode: 'answer', webSearch: false }));
    await wait(async () => (await page.evaluate(() => window.callme.agentMessages())).at(-1)?.state === 'done', 'B answer');
    let sent = await turns();
    const promptB = sent.at(-1);
    assert(promptB.includes('FIXTURE_FILE_B_DESCRIPTION') && promptB.includes('FIXTURE_PROJECT_B_DESCRIPTION'));
    assert(!promptB.includes('FIXTURE_FILE_A_DESCRIPTION') && !promptB.includes('FIXTURE_A_CONFIRMED_DECISION'));

    await page.evaluate(id => window.callme.selectProject(id), created.a.id);
    assert(await rejected(() => page.evaluate(({ sessionId, line }) => window.callme.saveMeetingResults({ sessionId, revision: 0, items: [{ id: crypto.randomUUID(), type: 'decision', text: 'STALE_SESSION_MUST_REJECT', evidenceIds: [line], status: 'draft', author: 'user', assignee: '', dueDate: '' }] }), { sessionId: sessionB, line: lineB })), 'results from another meeting must reject');
    await page.evaluate(() => window.callme.agentAsk({ text: 'FIXTURE_A_FOLLOW_UP', mode: 'answer', webSearch: false }));
    await wait(async () => (await page.evaluate(() => window.callme.agentMessages())).at(-1)?.state === 'done', 'A follow-up');
    sent = await turns();
    const promptA = sent.at(-1);
    assert(promptA.includes('FIXTURE_FILE_A_DESCRIPTION') && promptA.includes('FIXTURE_PROJECT_A_DESCRIPTION_UPDATED'));
    assert(promptA.includes('FIXTURE_A_CONFIRMED_DECISION') && promptA.includes('FIXTURE_A_CONFIRMED_TASK'));
    assert(!promptA.includes('FIXTURE_A_DRAFT_TASK') && !promptA.includes('FIXTURE_A_REJECTED_DECISION') && !promptA.includes('FIXTURE_A_CONFIRMED_QUESTION'));
    assert(!promptA.includes('FIXTURE_FILE_B_DESCRIPTION') && !promptA.includes('FIXTURE_B_CONFIRMED_DECISION'));

    await instance.close(); instance = null;
    page = await launch();
    const restoredWorkspace = await page.evaluate(() => window.callme.workspace());
    assert.equal(restoredWorkspace.project?.id, created.a.id, 'selected active project persists across restart');
    assert.deepEqual(restoredWorkspace.context.files.map(file => file.name), ['Проект-A.md']);
    const restoredA = await page.evaluate(id => window.callme.openMeeting(id), sessionA);
    assert.equal(restoredA.meeting.projectId, created.a.id);
    assert(restoredA.results.items.some(value => value.id === prepItem.id && value.evidenceIds.length === 0 && value.status === 'confirmed'));
    assert(restoredA.lines.some(line => line.id === lineA && line.text.includes('FIXTURE_TRANSCRIPT_CONFIRMED')));
    assert(restoredA.results.items.some(value => value.text === 'FIXTURE_A_CONFIRMED_TASK' && value.status === 'confirmed'));
    const report = { status: 'passed', fixture: 'Synthetic owned stdio provider and Whisper enqueue hook; no auth/network/model/media', data, checks: ['project create/update/list/select/restart', 'project file isolation through native dialog stub', 'offline manual preparation result and live carryover', 'session project binding and active-capture project lock', 'actual main Whisper transcript callback', 'summary JSON with live evidence ID and regeneration preservation', 'manual edit/status, optimistic revision conflict, and simultaneous-write serialization', 'bad evidence and stale-session rejection', 'project-only confirmed history in prompt', 'history restore and Markdown export with sources'] };
    await writeFile('test-results/projects-results-report.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report));
  } finally {
    if (instance) await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
