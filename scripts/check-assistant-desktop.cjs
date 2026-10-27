// Actual Electron main/preload/IPC/context/journal integration with an owned stdio fixture.
// No model authentication, model requests, microphone, screen capture, or user files are used.
const { _electron: electron } = require('playwright');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, mkdir, writeFile, readFile, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (!await check()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 100)); }
}

async function clipboardGuard() {
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fixtures/clipboard-guard.ps1')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stderr.on('data', chunk => { error += chunk.toString(); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Clipboard guard startup timed out')), 10000);
    child.once('error', failure => { clearTimeout(timeout); reject(failure); });
    child.once('exit', code => { if (!output.includes('CLIPBOARD_GUARD_READY')) { clearTimeout(timeout); reject(new Error('Clipboard guard failed: ' + code + ' ' + error)); } });
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('CLIPBOARD_GUARD_READY')) { clearTimeout(timeout); resolve(); } });
  });
  return async () => {
    const exit = once(child, 'exit'); child.stdin.end('restore\n');
    const [code] = await exit;
    assert.equal(code, 0, 'Clipboard restoration failed');
    assert(output.includes('CLIPBOARD_GUARD_RESTORED'), 'Clipboard guard did not finish');
  };
}

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'callme-assistant-desktop-'));
  assert.equal(path.dirname(data).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
  const selected = path.join(data, 'Описание проекта.md');
  const exported = path.join(data, 'fixture-export.md');
  await writeFile(selected, '# FIXTURE_CONTEXT_A\nЗаявки ищут по номеру из письма.\n', 'utf8');
  await mkdir('test-results', { recursive: true });
  const env = { ...process.env, CALLME_TEST_DATA: data, CALLME_SKIP_WHISPER: '1', CALLME_FIXTURE_FRAME_TEST: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors = [];
  let instance;
  let restoreClipboard;
  const launch = async () => {
    instance = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'fixtures/assistant-main.cjs')], env, timeout: 30000 });
    const page = await instance.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    page.on('pageerror', failure => errors.push(failure.message));
    await page.getByRole('heading', { name: 'LazyCall', exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.callme.agentStatus()).state === 'ready');
    const runtime = await instance.evaluate(({ app }) => ({ data: app.getPath('userData'), packaged: app.isPackaged }));
    assert.equal(runtime.data, data); assert.equal(runtime.packaged, false);
    await instance.evaluate(({ dialog }, values) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values.selected] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.exported });
    }, { selected, exported });
    return page;
  };
  const readProtocol = async () => (await readFile(path.join(data, 'fixture-protocol.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const prompts = async () => (await readProtocol()).filter(request => request.method === 'turn/start').map(request => request.params.input.find(item => item.type === 'text').text);
  try {
    let page = await launch();
    const untrustedRejected = await instance.evaluate(async ({ BrowserWindow }, preload) => {
      const auxiliary = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try { await auxiliary.loadURL('about:blank'); return await auxiliary.webContents.executeJavaScript('window.callme.settings().then(() => false, () => true)'); }
      finally { auxiliary.close(); }
    }, path.resolve('dist-electron/preload.js'));
    assert.equal(untrustedRejected, true, 'IPC from a different window must reject');
    await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('FIXTURE_NOTE_A: уточнить права доступа');
    await page.getByRole('button', { name: 'Экран и файлы', exact: true }).click();
    await page.getByRole('textbox', { name: 'Цель встречи', exact: true }).fill('FIXTURE_GOAL_A: поиск заявки');
    await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
    await page.getByRole('button', { name: 'Убрать файл Описание проекта.md', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    // Drive the actual fixture Whisper callback so structured results have a real source line.
    await page.evaluate(async () => {
      await window.callme.selectWindow('window:fixture:0');
      await window.callme.start();
      window.callme.audio('remote', 0, 800, new Uint8Array(320).buffer);
    });
    await page.locator('.utterance').waitFor();
    await page.evaluate(() => window.callme.stop());
    await page.getByRole('textbox', { name: 'Вопрос или уточнение', exact: true }).fill('FIXTURE_QUESTION_A: что уточнить?');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.locator('.message-streaming').waitFor();
    await page.locator('.message-streaming .assistant-message-text').filter({ hasText: 'FIXTURE_ONLY_CALLME_' }).waitFor();
    await page.locator('.message-assistant.message-done').first().waitFor();
    const firstId = (await page.evaluate(() => window.callme.listMeetings()))[0].id;
    let sent = await prompts();
    assert(sent[0].includes('FIXTURE_GOAL_A')); assert(sent[0].includes('FIXTURE_NOTE_A')); assert(sent[0].includes('FIXTURE_CONTEXT_A'));
    assert(!sent[0].includes(selected), 'Provider must receive copied text, not original local paths');
    restoreClipboard = await clipboardGuard();
    await page.getByRole('button', { name: 'Скопировать', exact: true }).first().click();
    const copied = await instance.evaluate(({ clipboard }) => clipboard.readText());
    assert(copied.startsWith('FIXTURE_ONLY_CALLME_ОТВЕТ'));
    await restoreClipboard(); restoreClipboard = null;
    await page.getByRole('button', { name: 'В заметки', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('.note-state').textContent === 'Сохранено');
    assert((await page.getByRole('textbox', { name: 'Заметки', exact: true }).inputValue()).includes('FIXTURE_ONLY_CALLME_ОТВЕТ'));
    await page.getByRole('button', { name: 'Итоги встречи', exact: true }).click();
    await page.getByRole('heading', { name: 'Итоги встречи', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Составить итоги', exact: true }).click();
    await page.locator('.message-assistant.message-done').filter({ hasText: 'FIXTURE_ONLY_CALLME_ИТОГИ' }).waitFor();
    await page.getByRole('button', { name: 'Закрыть итоги', exact: true }).click();
    await page.getByRole('textbox', { name: 'Вопрос или уточнение', exact: true }).fill('CANCEL_FIXTURE');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.locator('.message-streaming .assistant-message-text').filter({ hasText: 'FIXTURE_ONLY_CALLME_' }).waitFor();
    await page.getByRole('button', { name: 'Остановить', exact: true }).click();
    await page.locator('.message-assistant.message-error').last().waitFor();
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Экспорт', exact: true }).click();
    await page.getByText('Расшифровка и заметки сохранены в файл.', { exact: true }).waitFor();
    const markdown = await readFile(exported, 'utf8');
    assert(markdown.includes('FIXTURE_NOTE_A')); assert(markdown.includes('FIXTURE_ONLY_CALLME_ИТОГИ')); assert(markdown.includes('Запрос отменён'));
    await page.screenshot({ path: 'test-results/assistant-desktop.png' });
    await instance.close(); instance = null;
    // Relaunch the real app and restore the durable journal through history UI.
    page = await launch();
    await page.getByRole('button', { name: 'Встречи', exact: true }).click();
    await page.getByRole('button', { name: /FIXTURE_GOAL_A/ }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Заметки"]').value.includes('FIXTURE_NOTE_A'));
    assert((await page.getByRole('textbox', { name: 'Заметки', exact: true }).inputValue()).includes('FIXTURE_NOTE_A'));
    await page.locator('.message-assistant.message-done').filter({ hasText: 'FIXTURE_ONLY_CALLME_ИТОГИ' }).waitFor();
    assert.equal((await page.evaluate(() => window.callme.projectContext())).goal, 'FIXTURE_GOAL_A: поиск заявки');
    await instance.close(); instance = null;
    // A separate preparation session must not inherit the other journal's notes/messages.
    page = await launch();
    const context = await page.evaluate(() => window.callme.projectContext());
    for (const file of context.files) await page.evaluate(id => window.callme.removeContextFile(id), file.id);
    await page.evaluate(() => window.callme.setGoal('FIXTURE_GOAL_B: другая тема'));
    await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('FIXTURE_NOTE_B: отдельный разговор');
    await page.getByRole('textbox', { name: 'Вопрос или уточнение', exact: true }).fill('FIXTURE_QUESTION_B');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.locator('.message-assistant.message-done').first().waitFor();
    const meetings = await page.evaluate(() => window.callme.listMeetings());
    assert.equal(meetings.length, 2);
    const secondId = meetings.find(meeting => meeting.id !== firstId).id;
    sent = await prompts();
    const secondPrompt = sent.at(-1);
    assert(secondPrompt.includes('FIXTURE_NOTE_B')); assert(secondPrompt.includes('FIXTURE_GOAL_B'));
    assert(!secondPrompt.includes('FIXTURE_NOTE_A')); assert(!secondPrompt.includes('FIXTURE_QUESTION_A')); assert(!secondPrompt.includes('FIXTURE_CONTEXT_A'));
    await page.getByRole('button', { name: 'Встречи', exact: true }).click();
    await page.getByRole('button', { name: /FIXTURE_GOAL_A/ }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Заметки"]').value.includes('FIXTURE_NOTE_A'));
    const rejected = await page.evaluate(async id => { try { await window.callme.note('STALE_NOTE_MUST_NOT_PERSIST', id); return false; } catch { return true; } }, secondId);
    assert(rejected, 'Wrong-session note IPC must reject');
    await page.getByRole('textbox', { name: 'Вопрос по записи', exact: true }).fill('FIXTURE_FOLLOWUP_A');
    await page.getByRole('button', { name: 'Спросить по записи', exact: true }).click();
    await until(async () => (await prompts()).at(-1)?.startsWith('ЗАДАНИЕ ПОЛЬЗОВАТЕЛЯ\nFIXTURE_FOLLOWUP_A\n'), 'follow-up reached owned child');
    await until(async () => (await page.evaluate(() => window.callme.agentMessages())).at(-1)?.state === 'done', 'follow-up persisted');
    sent = await prompts();
    assert(sent.at(-1).includes('FIXTURE_NOTE_A')); assert(sent.at(-1).includes('FIXTURE_GOAL_A')); assert(!sent.at(-1).includes('FIXTURE_NOTE_B')); assert(!sent.at(-1).includes('FIXTURE_QUESTION_B'));
    // Delayed frame persistence must complete in the previous journal before switching.
    const frameSessions = await page.evaluate(async () => {
      await window.callme.selectWindow('window:fixture:0');
      const old = await window.callme.start();
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 18;
      canvas.getContext('2d').fillRect(0, 0, 32, 18);
      window.callme.frame(canvas.toDataURL('image/jpeg'), 1000);
      await window.callme.stop();
      const next = await window.callme.start();
      await window.callme.agentAsk({ text: 'FRAME_SESSION_D_REQUEST', note: 'FRAME_SESSION_D_NOTE', mode: 'answer', webSearch: false });
      return { old: old.sessionId, next: next.sessionId };
    });
    await until(async () => (await page.evaluate(() => window.callme.agentMessages())).at(-1)?.state === 'done', 'post-frame answer persisted');
    const postFrameTurn = (await readProtocol()).filter(request => request.method === 'turn/start').at(-1);
    assert(postFrameTurn.params.input.find(item => item.type === 'text').text.includes('FRAME_SESSION_D_REQUEST'));
    assert(!postFrameTurn.params.input.some(item => item.type === 'localImage'), 'Old frame must not enter next meeting context');
    await page.evaluate(() => window.callme.stop());
    await instance.close(); instance = null;
    const journals = [];
    for (const id of await readdir(path.join(data, 'sessions'))) {
      const raw = await readFile(path.join(data, 'sessions', id, 'events.jsonl'), 'utf8');
      assert(!raw.includes('STALE_NOTE_MUST_NOT_PERSIST'));
      const rows = raw.trim().split('\n').map(JSON.parse);
      if (id !== frameSessions.old) assert(rows.some(row => row.type === 'assistant.message' && row.payload.role === 'assistant' && row.payload.state === 'done'));
      assert(rows.some(row => row.type === 'session.stopped'));
      if (id === frameSessions.old) {
        const frame = rows.find(row => row.type === 'frame.selected');
        assert(frame, 'Old journal must own pending frame');
        assert(frame.seq < rows.find(row => row.type === 'session.stopped').seq);
        assert((await readFile(path.join(data, 'sessions', id, frame.payload.file))).length > 20);
      }
      if (id === frameSessions.next) assert(!rows.some(row => row.type === 'frame.selected'), 'New journal cannot inherit frame event');
      journals.push({ id, events: rows.length });
    }
    assert.deepEqual(errors, []);
    const report = { status: 'passed', fixture: 'Synthetic owned stdio provider and STT-start stub; no auth/network/model/media', data, journals, checks: ['untrusted window IPC rejection', 'goal and selected file copied into request', 'streaming and terminal persistence', 'clipboard copy and restoration', 'append notes', 'summary', 'cancellation', 'Markdown export', 'close/relaunch/history', 'session context isolation', 'stale note rejection', 'clean preparation session closure', 'pending frame written before stop in original journal', 'frame context does not cross next session'], errors };
    await writeFile('test-results/assistant-desktop-report.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report));
  } finally {
    if (restoreClipboard) await restoreClipboard();
    if (instance) await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
