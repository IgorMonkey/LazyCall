// Isolated renderer contract/interaction fixture. It never calls Codex or records real media.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(process.env.CALLME_UI_DIST || 'dist');
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, req.url === '/' ? 'index.html' : '.' + decodeURIComponent(req.url.split('?')[0]));
      if (!file.startsWith(root + path.sep)) throw Error('path');
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1264, height: 841 } });
    page.setDefaultTimeout(10000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('callme.onboarding.dismissed.v1', 'true');
      const callbacks = {};
      let current = 'new', context = { goal: '', files: [] }, count = 0, agentCount = 0, preferences = { language: 'ru', locale: 'ru', compute: 'auto', autoHints: false, autoSummary: true, screenContext: true, enterToSend: true, model: '', reasoningEffort: 'default' }, selectedProject = null;
      let projects = [{ id: 'project-1', name: 'Поиск заявок', description: 'Контекст команды поиска', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z' }];
      let results = { sessionId: '', revision: 0, items: [] }, knowledge = { folder: null, brief: null }, codexIntegration = { enabled: false, prepared: false }; const transcriptOriginal = new Map();
      window.uiFixture = { requests: [], requestIds: [], writes: [], links: [], copied: [], frames: [], pauses: [], transcriptEdits: [], analysisCancels: 0, codex: 0, codexCopies: 0, codexConnects: 0, codexDisconnects: 0, agentState: null, emit: (name, value) => callbacks[name]?.(value) };
      const status = { state: 'ready', label: 'Codex подключён', model: 'fixture' };
      const on = name => callback => { callbacks[name] = callback; return () => { delete callbacks[name]; }; };
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const x = canvas.getContext('2d'); x.fillStyle = '#25272b'; x.fillRect(0, 0, 640, 360);
      x.fillStyle = '#ddd'; x.font = '24px sans-serif'; x.fillText('Обсуждение проекта', 32, 60);
      window.callme = {
        codexRuntime: async () => window.uiFixture.runtimeStatus || { source: 'missing', executable: null, version: null },
        refreshCodexRuntime: async () => (window.uiFixture.runtimeStatus = { source: 'installed', executable: 'C:\\fixture\\codex.exe', version: '0.145.0' }),
        chooseCodexRuntime: async () => (window.uiFixture.runtimeStatus = { source: 'installed', executable: 'C:\\fixture\\codex.exe', version: '0.145.0' }),
        installCodexInstructions: async () => { window.uiFixture.links.push('https://learn.chatgpt.com/docs/cli'); },
        updateStatus: async () => window.uiFixture.updateStatus || { state: 'unconfigured', currentVersion: '0.3.5', message: 'Канал обновлений ещё не подключён' },
        onUpdateStatus: on('updateStatus'),
        checkForUpdates: async () => { const value = { state: 'available', currentVersion: '0.3.5', version: '0.3.6' }; callbacks.updateStatus?.(value); return value; },
        downloadUpdate: async () => { callbacks.updateStatus?.({ state: 'downloading', currentVersion: '0.3.5', version: '0.3.6', percent: 42, transferred: 42000000, total: 100000000 }); },
        installUpdate: async () => { window.uiFixture.installAttempted = true; },
        codexIntegration: async () => structuredClone(codexIntegration),
        connectCodexIntegration: async () => { window.uiFixture.codexConnects++; codexIntegration = { enabled: true, prepared: true }; return structuredClone(codexIntegration); },
        disconnectCodexIntegration: async () => { window.uiFixture.codexDisconnects++; codexIntegration = { enabled: false, prepared: false }; return structuredClone(codexIntegration); },
        copyMeetingForCodex: async () => { window.uiFixture.codexCopies++; },
        setCapturePaused: async paused => { window.uiFixture.pauses.push(paused); },
        editTranscript: async ({ sessionId, lineId, text, expectedText }) => {
          window.uiFixture.transcriptEdits.push({ sessionId, lineId, text, expectedText });
          const originalText = transcriptOriginal.get(lineId) || expectedText; transcriptOriginal.set(lineId, originalText);
          const line = { id: lineId, source: 'remote', startMs: 3000, endMs: 7000, text, originalText, editedAt: new Date().toISOString() };
          results = { ...results, sessionId, transcriptStale: true };
          callbacks.transcriptEdited?.({ line: structuredClone(line), results: structuredClone(results) });
          return { line, results: structuredClone(results) };
        },
        projectKnowledge: async () => structuredClone(knowledge),
        connectRepository: async () => { knowledge = { folder: { name: 'LazyCall repository', path: 'C:\\fixture\\repository', available: true }, brief: null }; return structuredClone(knowledge); },
        disconnectRepository: async () => { knowledge = { folder: null, brief: null }; return structuredClone(knowledge); },
        refreshContextFolder: async () => ({ id: 'folder-1', name: 'Материалы поиска', maxFiles: 2, maxBytes: 3000, truncated: false, selectedIds: ['folder-a'], files: [{ id: 'folder-a', name: 'brief/требования.md', bytes: 1024, recommended: true, reason: 'Описание требований' }, { id: 'folder-b', name: 'api.txt', bytes: 1024, recommended: true, reason: 'Контракт API' }, { id: 'folder-c', name: 'large.txt', bytes: 2000 }] }),
        suggestContextFiles: async (previewId, topic) => ({ id: previewId, name: 'Материалы поиска', maxFiles: 2, maxBytes: 3000, truncated: false, files: [{ id: 'folder-a', name: 'brief/требования.md', bytes: 1024, recommended: true, reason: topic ? 'Соответствует теме' : 'Описание требований' }, { id: 'folder-b', name: 'api.txt', bytes: 1024, recommended: false, reason: 'Не относится к теме' }, { id: 'folder-c', name: 'large.txt', bytes: 2000, recommended: false }] }),
        analyzeProject: async () => (knowledge = { ...knowledge, brief: { text: 'Обзор подключённого репозитория.', generatedAt: new Date().toISOString(), fingerprint: 'fixture', stale: false, files: [] } }),
        onProjectAnalysisProgress: on('projectAnalysis'),
        cancelProjectAnalysis: async () => { window.uiFixture.analysisCancels++; },
        saveProjectBrief: async text => (knowledge = { ...knowledge, brief: { text, generatedAt: new Date().toISOString(), fingerprint: 'fixture', stale: false, files: [] } }),
        agentModels: async () => [{ id: 'fixture-model', name: 'Fixture model', description: 'Модель для проверки интерфейса', isDefault: true, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'low' }],
        listProjects: async () => structuredClone(projects),
        workspace: async () => ({ project: selectedProject ? structuredClone(projects.find(project => project.id === selectedProject)) : null, context: structuredClone(context) }),
        createProject: async input => { const project = { id: 'project-' + (++count), ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; projects.push(project); return structuredClone(project); },
        updateProject: async (id, input) => { const index = projects.findIndex(project => project.id === id); projects[index] = { ...projects[index], ...input, updatedAt: new Date().toISOString() }; return structuredClone(projects[index]); },
        selectProject: async id => { selectedProject = id; context = { goal: '', files: [] }; current = ''; results = { sessionId: '', revision: 0, items: [] }; return window.callme.workspace(); },
        meetingResults: async () => structuredClone(results),
        saveMeetingResults: async value => { results = { ...structuredClone(value), sessionId: value.sessionId || 'prepared-' + (++count), revision: value.revision + 1 }; if (!value.sessionId) current = results.sessionId; callbacks.results?.(structuredClone(results)); return structuredClone(results); },
        onMeetingResults: on('results'),
        settings: async () => ({ values: preferences, dataDirectory: 'C:\\LazyCall\\sessions' }),
        saveSettings: async values => (preferences = values), openDataFolder: async () => {},
        agentStatus: async () => window.uiFixture.agentState || status, agentConnect: async () => { callbacks.agentStatus?.(status); return status; },
        agentLogin: async () => {}, agentLogout: async () => callbacks.agentStatus?.({ state: 'disconnected', label: 'Помощник не подключён' }),
        agentMessages: async () => [],
        agentAsk: async request => {
          const id = 'request-' + (++agentCount); window.uiFixture.requests.push(request); window.uiFixture.requestIds.push(id);
          callbacks.assistant?.({ id: id + '-user', role: 'user', text: request.text, state: 'done', kind: request.mode, createdAt: Date.now() });
          callbacks.assistant?.({ id, role: 'assistant', text: 'Проверяем контекст…', state: 'streaming', kind: request.mode, createdAt: Date.now() });
          return { requestId: id, sessionId: current };
        },
        agentCancel: async id => callbacks.assistant?.({ id, role: 'assistant', text: 'Ответ остановлен.', state: 'done', kind: 'answer', createdAt: Date.now() }),
        onAgentStatus: on('agentStatus'), onAssistantMessage: on('assistant'),
        projectContext: async () => structuredClone(context),
        setGoal: async goal => { context.goal = goal; return structuredClone(context); },
        addContextFiles: async () => { context.files.push({ id: 'brief', name: 'Описание проекта.md', bytes: 2048 }); return structuredClone(context); },
        removeContextFile: async id => { context.files = context.files.filter(file => file.id !== id); return structuredClone(context); },
        previewContextFolder: async () => ({ id: 'folder-1', name: 'Материалы поиска', maxFiles: 2, maxBytes: 3000, truncated: false, files: [{ id: 'folder-a', name: 'brief/требования.md', bytes: 1024, recommended: true, reason: 'Описание требований' }, { id: 'folder-b', name: 'api.txt', bytes: 1024, recommended: true, reason: 'Контракт API' }, { id: 'folder-c', name: 'large.txt', bytes: 2000 }] }),
        importContextFolder: async (id, ids) => { context.files = context.files.filter(file => !file.id.startsWith('folder-')); context.files.push(...ids.map(fileId => ({ id: fileId, name: fileId === 'folder-a' ? 'требования.md' : 'api.txt', relativePath: fileId === 'folder-a' ? 'brief/требования.md' : 'api.txt', bytes: 1024 }))); knowledge = { ...knowledge, folder: { name: 'Материалы поиска', path: 'C:\\fixture\\materials', available: true }, brief: null }; return structuredClone(context); },
        listMeetings: async () => [{ id: 'saved', title: 'Поиск заявки', startedAt: '2026-10-25T09:30:00.000Z', interrupted: true, projectId: 'project-1', projectName: 'Поиск заявок' }],
        openMeeting: async id => {
          await new Promise(resolve => setTimeout(resolve, 60)); current = id; context.goal = 'Упростить поиск';
          return { meeting: { id, title: 'Поиск заявки', startedAt: '2026-10-25T09:30:00.000Z', interrupted: true }, goal: context.goal,
            lines: [{ id: 'line-1', source: 'remote', startMs: 3000, endMs: 7000, text: 'Нужно находить заявку по номеру из письма.' }],
            note: 'Проверить права доступа', messages: [{ id: 'old-answer', role: 'assistant', text: 'Уточните формат номера.', state: 'done', kind: 'answer', createdAt: Date.now() }], results: { sessionId: id, revision: 1, items: [] } };
        },
        openLink: async url => window.uiFixture.links.push(url),
        copyText: async text => window.uiFixture.copied.push(text),
        windows: async () => [{ id: 'window:fixture', name: window.uiFixture.windowName || 'Обсуждение проекта — Zoom', thumbnail: canvas.toDataURL() }],
        selectWindow: async () => {}, whisperStatus: async () => ({ state: 'ready', label: 'Готово', backend: 'CPU' }),
        start: async () => { current = 'new'; return { sessionId: current }; }, stop: async () => { if (window.uiFixture.stopLine) callbacks.transcript?.(window.uiFixture.stopLine); },
        note: async (text, sessionId) => { if (sessionId !== current) throw Error('Stale session write'); window.uiFixture.writes.push({ current, sessionId, text }); }, export: async () => true, continueInCodex: async () => { window.uiFixture.codex++; },
        audio: () => {}, frame: (dataUrl, atMs) => window.uiFixture.frames.push({ dataUrl, atMs }), health: () => {},
        onStatus: on('sttStatus'), onTranscript: on('transcript'), onTranscriptEdited: on('transcriptEdited'), onHealth: on('health'), onCaptureStop: on('captureStop')
      };
      const silentAudio = () => {
        const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination();
        gain.gain.value = 0; oscillator.connect(gain).connect(destination); oscillator.start(); return destination.stream;
      };
      navigator.mediaDevices.getUserMedia = async () => silentAudio();
      navigator.mediaDevices.getDisplayMedia = async () => {
        const video = canvas.captureStream(3);
        setTimeout(() => { x.fillStyle = '#25272b'; x.fillRect(0, 350, 640, 10); video.getVideoTracks()[0].requestFrame?.(); }, 50);
        return new MediaStream([...video.getTracks(), ...silentAudio().getTracks()]);
      };
      navigator.mediaDevices.enumerateDevices = async () => [];
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.evaluate(() => document.fonts.ready);
    if (process.argv.includes('--gallery-extra')) {
      await fs.mkdir('test-results', { recursive: true });
      const shot = name => page.screenshot({ path: `test-results/gallery-${name}.png`, animations: 'disabled' });
      await shot('assistant-empty');
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      for (const [tab, name] of [['Запись', 'settings-recording'], ['Помощник', 'settings-assistant'], ['Данные', 'settings-data'], ['Вид', 'settings-appearance'], ['Обновления', 'settings-updates-unconfigured']]) {
        await page.getByRole('tab', { name: tab, exact: true }).click(); await shot(name);
      }
      await page.evaluate(() => window.uiFixture.emit('updateStatus', { state: 'downloading', currentVersion: '0.3.5-alpha.1', version: '0.3.5-alpha.2', percent: 42, transferred: 42000000, total: 100000000 }));
      await page.getByText(/42%/).waitFor(); await shot('settings-updates-progress');
      await page.evaluate(() => window.uiFixture.emit('updateStatus', { state: 'error', currentVersion: '0.3.5-alpha.1', message: 'Не удалось получить обновление. Проверьте подключение и повторите попытку.' }));
      await page.getByText('Не удалось получить обновление. Проверьте подключение и повторите попытку.', { exact: true }).waitFor(); await shot('settings-updates-error');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Встречи', exact: true }).click(); await page.getByText('Поиск заявки', { exact: true }).waitFor(); await shot('meetings-list');
      await page.keyboard.press('Escape');
      await page.evaluate(() => { window.callme.listMeetings = async () => []; });
      await page.getByRole('button', { name: 'Встречи', exact: true }).click(); await page.getByText('Здесь будут сохранённые встречи.', { exact: true }).waitFor(); await shot('meetings-empty');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Без проекта', exact: true }).click();
      await page.getByRole('button', { name: 'Изменить проект Поиск заявок', exact: true }).click(); await page.getByRole('heading', { name: 'Изменить проект', exact: true }).waitFor(); await shot('projects-edit');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Итоги встречи', exact: true }).first().click(); await page.getByText('Пока нет расшифровки.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Добавить пункт вручную', exact: true }).click(); await shot('results-empty-manual');
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []); console.log(JSON.stringify({ status: 'passed', gallery: ['assistant empty', 'five settings tabs', 'update progress/error', 'meetings list/empty', 'project edit', 'manual result'] })); return;
    }
    if (process.argv.includes('--header')) {
      await fs.mkdir('test-results', { recursive: true });
      const { checkSpacing } = require('./ui-spacing.cjs');
      const views = [], screenshots = [];
      const widths = [1680, 1440, 1264, 1100, 1080, 1040, 960, 900, 800, 720, 640, 520, 440, 360];
      const more = () => page.locator('.header-more-trigger');
      await more().waitFor();
      assert.equal(await page.locator('.meeting-heading').count(), 0, 'Idle header must not display a redundant new-meeting label');
      // Real menu keyboard behavior, including skipping disabled export.
      await more().focus(); await page.keyboard.press('ArrowDown');
      assert.equal(await page.getByRole('menuitem', { name: /Мини-окно/ }).evaluate(node => document.activeElement === node), true);
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.getByRole('menuitem', { name: 'Как пользоваться', exact: true }).evaluate(node => document.activeElement === node), true);
      await page.keyboard.press('Escape');
      assert.equal(await more().getAttribute('aria-expanded'), 'false');
      assert.equal(await more().evaluate(node => document.activeElement === node), true);
      // A long real project label is bounded without shortening its accessible name.
      const longProject = 'ОченьДлинноеНазваниеПроектаБезПробеловДляПроверкиШапки'.repeat(2);
      await page.evaluate(name => window.callme.updateProject('project-1', { name, description: 'Synthetic header fixture' }), longProject);
      await page.getByRole('button', { name: 'Без проекта', exact: true }).click();
      await page.locator('.projects-dialog .project-item').nth(1).click();
      await page.getByRole('button', { name: longProject, exact: true }).waitFor();
      for (const locale of ['ru', 'en']) {
        if (locale === 'en') {
          await page.getByRole('button', { name: 'Настройки', exact: true }).click();
          await page.getByRole('tab', { name: 'Вид', exact: true }).click();
          await page.locator('#interface-locale').click(); await page.getByRole('option', { name: 'English', exact: true }).click();
          await page.getByRole('button', { name: 'Save', exact: true }).click();
        }
        for (const theme of ['light', 'dark']) {
          await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
          for (const width of widths) {
            await page.setViewportSize({ width, height: 841 });
            const view = `header-${locale}-${theme}-${width}`;
            views.push(await checkSpacing(page, view, '.app-header'));
            const geometry = await page.locator('.app-header').evaluate(node => {
              const bounds = node.getBoundingClientRect();
              const children = ['.brand', '.meeting-heading', '.header-actions'].filter(selector => node.querySelector(selector)).map(selector => ({ selector, rect: node.querySelector(selector).getBoundingClientRect() }));
              const overlaps = [];
              for (let a = 0; a < children.length; a++) for (let b = a + 1; b < children.length; b++) {
                const x = children[a].rect, y = children[b].rect;
                if (Math.min(x.right,y.right)-Math.max(x.left,y.left)>1 && Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1) overlaps.push([children[a].selector,children[b].selector]);
              }
              return { height: bounds.height, overlaps };
            });
            assert.deepEqual(geometry.overlaps, [], view + ': header groups overlap');
            assert(geometry.height <= (width > 800 ? 60 : 108), view + ': unintended header wrapping');
            if ([1264, 900, 640].includes(width)) {
              await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
              const bounds = await page.locator('.app-header').boundingBox();
              await page.screenshot({ path: `test-results/${view}-bar.png`, clip: { x: 0, y: 0, width, height: Math.ceil(bounds.y + bounds.height + 16) }, animations: 'disabled' });
            }
            await more().click();
            const menu = page.getByRole('menu');
            await menu.waitFor();
            const box = await menu.boundingBox();
            assert(box.x >= 0 && box.x + box.width <= width, view + ': menu clips at viewport edge');
            if ([1264, 900, 640].includes(width)) {
              const file = `test-results/${view}.png`;
              await page.screenshot({ path: file, animations: 'disabled' }); screenshots.push(file);
            }
            await page.keyboard.press('Escape');
          }
        }
        // Return to a supported desktop size before opening settings.
        await page.setViewportSize({ width: 1264, height: 841 });
      }
      await more().click();
      await page.getByRole('menuitem', { name: 'How it works', exact: true }).click();
      await page.getByTestId('onboarding-dialog').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await more().evaluate(node => document.activeElement === node), true, 'Guide must return focus to the menu trigger');
      // Check a saved meeting with a very long title through the actual open flow.
      await page.evaluate(() => {
        const original = window.callme.openMeeting;
        window.callme.openMeeting = async id => {
          const result = await original(id); result.meeting.title = 'VeryLongMeetingTitleWithoutSpaces'.repeat(10); return result;
        };
      });
      await page.getByRole('button', { name: 'Meetings', exact: true }).click();
      await page.locator('.meeting-item').first().click();
      await page.waitForFunction(() => document.querySelector('.meeting-heading')?.textContent.startsWith('VeryLong'));
      for (const width of widths) {
        await page.setViewportSize({ width, height: 641 });
        views.push(await checkSpacing(page, `header-saved-long-title-${width}`, '.app-header'));
        assert(await page.locator('.meeting-heading').evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis'));
        if ([1264, 900, 640].includes(width)) await page.screenshot({ path: `test-results/header-saved-long-title-${width}.png`, animations: 'disabled' });
      }
      assert.deepEqual(errors, []);
      const result = { status: 'passed', views, screenshots, checks: ['viewport bounds', 'no group overlaps', 'long project and meeting labels', 'RU/EN light/dark', 'menu keyboard and focus restoration', 'disabled export skipped', 'guide opens from menu'] };
      await fs.writeFile('test-results/header-review.json', JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ status: result.status, views: views.length, screenshots: screenshots.length, checks: result.checks })); return;
    }
    if (process.argv.includes('--palette')) {
      await fs.mkdir('test-results', { recursive: true });
      await page.getByRole('combobox', { name: 'Окно созвона', exact: true }).click();
      await page.getByRole('option', { name: /Обсуждение проекта/ }).click();
      await page.evaluate(() => {
        window.uiFixture.emit('transcript', { id: 'palette-line', source: 'remote', startMs: 42000, endMs: 48000, text: 'Как устроен поиск заявки и какие права нужны пользователю?' });
        window.uiFixture.emit('assistant', { id: 'palette-answer', role: 'assistant', text: 'Поиск идёт по номеру заявки. Перед выдачей результата проверяем доступ пользователя к проекту. Если доступа нет, данные заявки не показываем.\n\nЭто пример ответа для проверки интерфейса.', state: 'done', kind: 'answer', createdAt: Date.now() });
      });
      await page.getByText('Это пример ответа для проверки интерфейса.', { exact: false }).waitFor();
      const palettes = [];
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const result = await page.evaluate(() => {
          const css = getComputedStyle(document.documentElement), token = name => css.getPropertyValue('--' + name).trim();
          const luminance = hex => { let digits = hex.replace('#', ''); if (digits.length === 3) digits = [...digits].map(value => value + value).join(''); const c = digits.match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
          const contrast = (a, b) => { const x = luminance(token(a)), y = luminance(token(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
          return { tokens: Object.fromEntries(['chrome','surface','surface-raised','ink','secondary','muted','accent','accent-ink','control-border','error'].map(name => [name, token(name)])), ratios: { text: contrast('ink','surface'), secondary: contrast('secondary','surface-raised'), placeholder: contrast('muted','surface-raised'), primary: contrast('accent-ink','accent'), control: contrast('control-border','surface-raised'), focus: contrast('focus-border','surface-raised'), error: contrast('error','error-soft') } };
        });
        for (const [name, value] of Object.entries(result.ratios)) assert(value >= (['control','focus'].includes(name) ? 3 : 4.5), `${theme} ${name} contrast: ${value}`);
        await page.screenshot({ path: `test-results/review-palette-${theme}-main.png`, animations: 'disabled' });
        await page.getByRole('button', { name: 'Настройки', exact: true }).click();
        await page.getByRole('tab', { name: 'Вид', exact: true }).click();
        await page.screenshot({ path: `test-results/review-palette-${theme}-settings.png`, animations: 'disabled' });
        await page.keyboard.press('Escape');
        palettes.push({ theme, ...result });
      }
      assert.deepEqual(errors, []);
      const result = { status: 'passed', palettes, data: 'Synthetic conversation; contrast checks cover theme tokens, not a complete accessibility audit.' };
      await fs.writeFile('test-results/palette-review.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--onboarding')) {
      const openGuide = async name => { await page.getByRole('button', { name: name === 'How it works' ? 'More' : 'Ещё', exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click(); };
      await fs.mkdir('test-results', { recursive: true });
      const shots = [];
      const shot = async name => { await page.locator('.onboarding-slide.is-leaving').waitFor({ state: 'detached' }); const file = `test-results/review-onboarding-${name}.png`; await page.screenshot({ path: file, animations: 'disabled' }); shots.push(file); };
      const dialog = page.getByTestId('onboarding-dialog');
      const advance = async () => { await page.getByTestId('onboarding-next').click(); await page.getByTestId('onboarding-back').waitFor({ state: 'visible' }); };
      await openGuide('Как пользоваться');
      await page.getByTestId('onboarding-step-1').waitFor();
      assert.equal(await dialog.locator('.onboarding-art, svg, img').count(), 0, 'Onboarding must not contain decorative placeholder illustrations');
      await shot('ru-light-step1');
      await advance(); await page.getByTestId('onboarding-open-assistant').waitFor();
      await shot('ru-light-step2');
      await page.getByTestId('onboarding-open-assistant').click();
      await page.getByRole('tab', { name: 'Помощник', exact: true, selected: true }).waitFor();
      assert.equal(await dialog.isVisible(), false);
      await page.keyboard.press('Escape');
      await openGuide('Как пользоваться');
      await advance(); await page.getByTestId('onboarding-next').click();
      await page.getByTestId('onboarding-done').waitFor(); await shot('ru-light-step3');
      await page.getByTestId('onboarding-done').click();
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await page.evaluate(() => window.uiFixture.requests.length), 0);
      await openGuide('Как пользоваться');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.classList.contains('header-more-trigger'));
      assert.equal(await page.locator('.header-more-trigger').evaluate(node => document.activeElement === node), true);
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('tab', { name: 'Вид', exact: true }).click();
      await page.locator('#interface-locale').click(); await page.getByRole('option', { name: 'English', exact: true }).click();
      await page.locator('#theme').click(); await page.getByRole('option', { name: 'Dark', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.setViewportSize({ width: 904, height: 641 });
      await openGuide('How it works');
      await shot('en-dark-step1-904');
      await advance(); await page.getByTestId('onboarding-next').click();
      await page.getByTestId('onboarding-done').waitFor(); await shot('en-dark-step3-904');
      assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
      const motion = await page.locator('.onboarding-slide.is-entering').evaluate(node => getComputedStyle(node).animationDuration);
      assert(motion.split(',').every(value => parseFloat(value) <= 0.01), 'Reduced motion must disable slide animation');
      assert.equal(await page.locator('.onboarding-slide.is-leaving').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).visibility === 'hidden')), true, 'Reduced motion must hide outgoing text');
      await page.getByTestId('onboarding-skip').click();
      assert.equal(await page.evaluate(() => localStorage.getItem('callme.onboarding.dismissed.v1')), 'true');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await openGuide('How it works');
      assert.equal(await page.locator('.onboarding-slide.is-entering').evaluate(node => getComputedStyle(node).animationDuration), '0.2s');
      await advance();
      await shot('en-dark-step2-motion-904');
      assert.equal(await page.locator('.onboarding-slide').count(), 1);
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      const result = { status: 'passed', shots, checks: ['three optional RU/EN steps', 'assistant CTA selects its settings tab', 'done starts no recording or request', 'Escape returns focus', 'skip and reopen', 'reduced motion hides outgoing slide', 'normal 200ms transition removes outgoing slide', '904px dark layout'] };
      await fs.writeFile('test-results/onboarding-review.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--locales')) {
      await fs.mkdir('test-results', { recursive: true });
      const shots = [];
      const shot = async name => { const file = `test-results/review-${name}.png`; await page.screenshot({ path: file, animations: 'disabled' }); shots.push(file); };
      const choose = async (id, label) => { await page.locator('#' + id).click(); await page.getByRole('option', { name: label, exact: true }).click(); };
      const settings = () => page.getByRole('button', { name: /^(Settings|Настройки)$/ }).click();
      await page.getByRole('button', { name: 'Начать встречу', exact: true }).waitFor();
      await shot('ru-light-main');
      await settings(); await page.getByRole('tab', { name: 'Вид', exact: true }).click();
      await choose('interface-locale', 'English');
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'Начать встречу', exact: true }).waitFor();
      await settings(); await page.getByRole('tab', { name: 'Вид', exact: true }).click();
      await choose('interface-locale', 'English'); await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: 'Start meeting', exact: true }).waitFor();
      await shot('en-light-main');
      await settings(); await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
      await page.getByText('Codex CLI is not installed', { exact: true }).waitFor();
      await shot('en-codex-missing');
      await page.getByRole('button', { name: 'Install Codex', exact: true }).click();
      assert((await page.evaluate(() => window.uiFixture.links)).includes('https://learn.chatgpt.com/docs/cli'));
      await page.getByRole('button', { name: 'Find again', exact: true }).click();
      await page.getByText('Codex found: 0.145.0', { exact: true }).waitFor();
      await shot('en-codex-found');
      await page.getByRole('tab', { name: 'Updates', exact: true }).click();
      await shot('en-updates-unconfigured');
      await page.evaluate(() => window.uiFixture.emit('updateStatus', { state: 'available', currentVersion: '0.3.5', version: '0.3.6' }));
      await page.getByRole('button', { name: 'Download update', exact: true }).click();
      await page.getByRole('progressbar').waitFor(); await shot('en-update-progress-demo');
      await page.evaluate(() => window.uiFixture.emit('updateStatus', { state: 'downloaded', currentVersion: '0.3.5', version: '0.3.6', percent: 100 }));
      await page.getByRole('button', { name: 'Close LazyCall and install', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => !!window.uiFixture.installAttempted), false);
      await shot('en-update-ready-demo');
      await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await choose('theme', 'Dark');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByRole('button', { name: 'Screen & files', exact: true }).click();
      await page.getByRole('heading', { name: 'Meeting materials', exact: true }).waitFor();
      await shot('en-dark-materials');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'No project', exact: true }).click();
      await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
      await page.getByText('Поиск заявок', { exact: true }).waitFor();
      await shot('en-dark-projects'); await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Meeting results', exact: true }).click();
      await shot('en-dark-results'); await page.keyboard.press('Escape');
      await settings(); await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await choose('interface-locale', 'Русский'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await page.setViewportSize({ width: 904, height: 641 });
      await settings(); await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
      await shot('ru-dark-assistant-904');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      const result = { status: 'passed', shots, checks: ['RU/EN switch, save and cancel restore', 'user project name is preserved', 'Codex missing/found/install help', 'update progress and manual install state without executing an installer', 'English materials/projects/results', 'dark theme at904 without horizontal overflow'], data: 'synthetic renderer fixtures; no real model calls, recording or installation' };
      await fs.writeFile('test-results/localization-review.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--spacing')) {
      const { checkSpacing } = require('./ui-spacing.cjs');
      const views = [];
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      await page.evaluate(() => { window.uiFixture.windowName = 'ДлинноеНазваниеОкнаБезПробелов'.repeat(8); });
      await page.getByRole('button', { name: 'Обновить список окон и устройств', exact: true }).click();
      await page.getByRole('combobox', { name: 'Окно созвона', exact: true }).click();
      await page.getByRole('option', { name: /ДлинноеНазваниеОкнаБезПробелов/ }).click();
      await page.evaluate(() => window.uiFixture.emit('transcript', { id: 'spacing-target', source: 'remote', startMs: 3000, endMs: 8000, text: 'Как в проекте устроена проверка прав доступа и что произойдёт при изменении условий? '.repeat(5) }));
      for (const theme of ['light', 'dark']) for (const width of [1264, 904]) {
        await page.setViewportSize({ width, height: width === 904 ? 641 : 841 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const label = `${theme}-${width}`;
        views.push(await checkSpacing(page, `main-${label}`));
        const toolbar = await page.locator('.assistant-toolbar').evaluate(node => {
          const button = node.querySelector('.button').getBoundingClientRect(), quote = node.querySelector('.assistant-reply-target').getBoundingClientRect();
          return { gap: quote.top >= button.bottom ? quote.top - button.bottom : quote.left - button.right, quoteHeight: quote.height };
        });
        assert(toolbar.gap >= 11, 'Reply quote must have at least 12px visual separation');
        assert(toolbar.quoteHeight <= 41, 'Long quote must use at most two lines');
        const materials = page.getByRole('button', { name: 'Экран и файлы', exact: true });
        await materials.hover();
        const before = await materials.boundingBox();
        await page.screenshot({ path: `test-results/spacing-main-${label}.png` });
        await page.locator('.assistant-toolbar').screenshot({ path: `test-results/spacing-toolbar-${label}.png` });
        await materials.screenshot({ path: `test-results/spacing-materials-trigger-${label}.png` });
        await materials.focus();
        const focused = await materials.boundingBox();
        assert(Math.abs(focused.x - before.x) < 1 && Math.abs(focused.width - before.width) < 1, 'Focus must not shift control geometry');
        await materials.click();
        await page.getByRole('heading', { name: 'Материалы встречи', exact: true }).waitFor();
        views.push(await checkSpacing(page, `materials-${label}`));
        assert(await page.locator('.screen-caption').evaluate(node => node.scrollWidth > node.clientWidth && getComputedStyle(node).textOverflow === 'ellipsis'), 'Long window name must be truncated without expanding the materials dialog');
        await page.screenshot({ path: `test-results/spacing-materials-${label}.png` });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Настройки', exact: true }).click();
        for (const tab of ['Запись', 'Помощник', 'Данные', 'Вид']) {
          const target = page.getByRole('tab', { name: tab, exact: true });
          await target.click();
          views.push(await checkSpacing(page, `settings-${tab}-${label}`));
        }
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Без проекта', exact: true }).click();
        await page.getByRole('heading', { name: 'Проекты', exact: true }).waitFor();
        views.push(await checkSpacing(page, `projects-${label}`));
        await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
        views.push(await checkSpacing(page, `project-form-${label}`));
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Встречи', exact: true }).click();
        views.push(await checkSpacing(page, `history-${label}`));
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Итоги встречи', exact: true }).click();
        views.push(await checkSpacing(page, `results-${label}`));
        await page.keyboard.press('Escape');
      }
      const result = { status: 'passed', views, checks: ['shared control bounds and icon centering', 'adjacent action spacing', '12px reply quote gap with bounded wrapping', 'focus geometry stability', 'no horizontal overflow', 'light/dark at1264 and904'] };
      await fs.writeFile('test-results/spacing-audit.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--transcript-follow')) {
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      let sequence = 0;
      const append = async (count, long = false) => {
        const first = sequence;
        sequence += count;
        await page.evaluate(({ first, count, long }) => {
          for (let i = first; i < first + count; i++) window.uiFixture.emit('transcript', {
            id: 'follow-' + i, source: i % 2 ? 'self' : 'remote', startMs: i * 1000, endMs: i * 1000 + 900,
            text: long ? ('Длинная реплика с подробностями требований. '.repeat(70)) : 'Реплика ' + i + ': проверяем следование за разговором.'
          });
        }, { first, count, long });
      };
      const metrics = () => page.locator('.transcript').evaluate(area => ({ top: area.scrollTop, gap: area.scrollHeight - area.scrollTop - area.clientHeight, height: area.clientHeight }));
      const bottom = async label => {
        try { await page.waitForFunction(() => { const area = document.querySelector('.transcript'); return area.scrollHeight - area.scrollTop - area.clientHeight <= 26; }, undefined, { timeout: 3000 }); }
        catch { throw new Error(label + ': ' + JSON.stringify(await metrics())); }
      };
      const jump = page.getByRole('button', { name: 'К последней реплике', exact: true });
      await append(30);
      for (let i = 0; i < 8; i++) { await page.waitForTimeout(40); await append(2); }
      await bottom('Burst of incoming speech must keep following');
      await append(1, true);
      await bottom('A reply taller than the viewport must keep its end visible');
      const area = page.locator('.transcript');
      await area.hover(); await page.mouse.wheel(0, -500);
      await jump.waitFor();
      const pausedTop = (await metrics()).top;
      await append(5); await page.waitForTimeout(180);
      assert(Math.abs((await metrics()).top - pausedTop) <= 2, 'Incoming speech must not pull the reader away from old replies');
      await jump.click(); await bottom('Return button must resume following immediately');
      await append(3); await bottom('Following must continue after returning');
      await page.setViewportSize({ width: 904, height: 641 });
      await bottom('Window resize must preserve following');
      await page.setViewportSize({ width: 1264, height: 841 });
      await bottom('Growing the window must preserve following');
      await area.hover(); await page.mouse.wheel(0, -450); await jump.waitFor();
      await area.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await jump.waitFor({ state: 'detached' });
      await append(2); await bottom('Manual return to bottom must resume following');
      await page.locator('.utterance').last().locator('p').evaluate(node => { node.style.lineHeight = '90px'; });
      await bottom('Content layout changes without a new reply must preserve following');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await append(2); await bottom('Following must work with reduced motion');
      assert.deepEqual(errors, []);
      await fs.mkdir('test-results', { recursive: true });
      const result = { status: 'passed', fixture: 'Synthetic transcript; no media or model calls', checks: ['rapid speech across both channels', 'long reply', 'pause while reading', 'resume by button', 'resize', 'manual resume at bottom', 'content reflow', 'reduced motion'], errors };
      await fs.writeFile('test-results/transcript-follow.json', JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
      return;
    }
    if (process.argv.includes('--workflow-ui')) {
      const selectWindow = async () => {
        const meetingWindow = page.getByRole('combobox', { name: 'Окно созвона', exact: true });
        if (await page.locator('select.ui-select').count()) await meetingWindow.selectOption('window:fixture');
        else { await meetingWindow.click(); await page.getByRole('option', { name: /Обсуждение проекта/ }).click(); }
      };
      const start = async () => { await selectWindow(); await page.getByRole('button', { name: /Начать встречу|Новая встреча/, exact: true }).click(); await page.getByText('Идёт встреча', { exact: true }).waitFor(); };
      const stop = async () => { await page.getByRole('button', { name: 'Завершить', exact: true }).click(); await page.getByText('Встреча сохранена', { exact: true }).waitFor(); };
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      await start();
      await page.evaluate(() => window.uiFixture.emit('transcript', { id: 'auto-1', source: 'remote', startMs: 1000, endMs: 1800, text: 'Проверяем автоматические итоги.' }));
      await stop();
      await page.waitForFunction(() => window.uiFixture.requests.filter(request => request.mode === 'summary').length === 1);
      await page.evaluate(() => window.uiFixture.emit('assistant', { id: 'request-1', role: 'assistant', text: 'Краткий итог первой записи.', state: 'done', kind: 'summary', createdAt: Date.now() }));
      await page.evaluate(() => window.uiFixture.emit('transcript', { id: 'auto-late', source: 'self', startMs: 2000, endMs: 2600, text: 'Поздняя реплика не создаёт второй запрос.' }));
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.uiFixture.requests.filter(request => request.mode === 'summary').length), 1, 'auto summary must run once per stopped recording');
      await page.getByRole('button', { name: 'Встречи', exact: true }).click();
      await page.getByRole('button', { name: /Поиск заявки/ }).click();
      await page.getByText('Нужно находить заявку по номеру из письма.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.uiFixture.requests.filter(request => request.mode === 'summary').length), 1, 'opening history must not auto summarize');
      await page.getByRole('button', { name: 'Новая встреча', exact: true }).click();
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Итоги после завершения встречи', exact: true }).uncheck();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await start();
      await page.evaluate(() => window.uiFixture.emit('transcript', { id: 'optout-1', source: 'remote', startMs: 1000, endMs: 1800, text: 'Без автоматической сводки.' }));
      await stop(); await page.waitForTimeout(120);
      assert.equal(await page.evaluate(() => window.uiFixture.requests.filter(request => request.mode === 'summary').length), 1, 'auto summary opt-out must be respected');
      await page.getByRole('button', { name: 'Новая встреча', exact: true }).click();
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Итоги после завершения встречи', exact: true }).check();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await start(); await stop(); await page.waitForTimeout(900);
      assert.equal(await page.getByRole('button', { name: 'Составляем итоги…', exact: true }).count(), 0, 'silent stop must not leave a generating state');
      await page.getByRole('button', { name: 'Новая встреча', exact: true }).click();
      await start();
      await page.evaluate(() => { window.uiFixture.stopLine = { id: 'drain-1', source: 'remote', startMs: 1000, endMs: 1800, text: 'Реплика пришла во время остановки.' }; });
      await stop();
      await page.waitForFunction(() => window.uiFixture.requests.filter(request => request.mode === 'summary').length === 2);
      assert.equal(await page.evaluate(() => window.uiFixture.requests.filter(request => request.mode === 'summary').length), 2, 'drained final line must enter automatic summary');
      await page.evaluate(() => {
        for (let index = 0; index < 30; index++) window.uiFixture.emit('assistant', { id: 'follow-assistant-' + index, role: 'assistant', text: 'Строка помощника '.repeat(18) + index, state: 'done', kind: 'answer', createdAt: Date.now() + index });
      });
      const assistantArea = page.locator('.assistant-messages');
      await page.waitForFunction(() => { const area = document.querySelector('.assistant-messages'); return area.scrollHeight - area.scrollTop - area.clientHeight < 25; });
      await assistantArea.evaluate(area => { area.scrollTop = 0; area.dispatchEvent(new Event('scroll')); });
      const pausedTop = await assistantArea.evaluate(area => area.scrollTop);
      await page.evaluate(() => window.uiFixture.emit('assistant', { id: 'follow-grow', role: 'assistant', text: 'Новый поток '.repeat(80), state: 'streaming', kind: 'answer', createdAt: Date.now() }));
      await page.waitForTimeout(100);
      assert(Math.abs((await assistantArea.evaluate(area => area.scrollTop)) - pausedTop) <= 2, 'assistant updates must not pull a paused reader');
      await page.getByRole('button', { name: 'К последнему ответу', exact: true }).click();
      await page.waitForFunction(() => { const area = document.querySelector('.assistant-messages'); return area.scrollHeight - area.scrollTop - area.clientHeight < 25; });
      const result = { status: 'passed', checks: ['auto summary once', 'history no auto summary', 'auto summary opt-out', 'silent stop clears pending state', 'drained stop line summarized', 'assistant stream follows, pauses, and resumes'] };
      await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/workflow-ui.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--project-context')) {
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Экран и файлы', exact: true }).click();
      await page.getByRole('button', { name: 'Подключить папку', exact: true }).waitFor();
      assert.equal(await page.locator('.folder-files').count(), 0, 'folder selection must not show a file checklist');
      await page.screenshot({ path: 'test-results/repository-empty-light.png', animations: 'disabled' });
      await page.getByLabel('Цель встречи', { exact: true }).fill('Сохранить цель до подключения');
      await page.getByRole('button', { name: 'Подключить папку', exact: true }).click();
      await page.getByText('LazyCall repository', { exact: true }).waitFor();
      await page.getByText('Обзор подключённого репозитория.', { exact: true }).waitFor();
      await page.evaluate(() => {
        window.uiFixture.originalAnalyzeProject = window.callme.analyzeProject;
        window.callme.analyzeProject = () => new Promise((_resolve, reject) => { window.uiFixture.rejectAnalysis = reject; });
      });
      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await page.getByText('Подключаем помощника', { exact: true }).waitFor();
      await page.getByText('Прочитано файлов: 0', { exact: true }).waitFor();
      assert.equal(await page.locator('.project-analysis-indicator').evaluate(node => getComputedStyle(node).animationName), 'none', 'reduced motion must stop the indeterminate indicator');
      await page.waitForTimeout(1050);
      await page.getByText(/Время: 0:0[1-2]/, { exact: true }).waitFor();
      await page.evaluate(() => window.uiFixture.emit('projectAnalysis', { stage: 'reading', filesRead: 7 }));
      await page.getByText('Читаем файлы проекта', { exact: true }).waitFor();
      await page.getByText('Прочитано файлов: 7', { exact: true }).waitFor();
      await page.screenshot({ path: 'test-results/repository-analysis-reading.png', animations: 'disabled' });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.setViewportSize({ width: 904, height: 641 });
      await page.screenshot({ path: 'test-results/repository-analysis-reading-dark-904.png', animations: 'disabled' });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await page.setViewportSize({ width: 1264, height: 841 });
      await page.evaluate(() => window.uiFixture.emit('projectAnalysis', { stage: 'analyzing', filesRead: 7 }));
      await page.getByText('Изучаем устройство проекта', { exact: true }).waitFor();
      await page.evaluate(() => window.uiFixture.emit('projectAnalysis', { stage: 'writing', filesRead: 7 }));
      await page.getByText('Составляем обзор', { exact: true }).waitFor();
      await page.evaluate(() => window.uiFixture.rejectAnalysis(new Error("Error invoking remote method 'project:analyze': Error: Codex request timed out after 5 minutes.")));
      await page.getByText('Обзор не успел завершиться. Папка подключена — можно повторить обзор или задавать вопросы по проекту.', { exact: true }).waitFor();
      assert.equal(await page.getByText('Обзор подключённого репозитория.', { exact: true }).count(), 1, 'a failed refresh must retain the previous overview');
      assert.equal(await page.getByText(/Error invoking remote method/).count(), 0, 'Electron IPC wrappers must not reach the UI');
      await page.screenshot({ path: 'test-results/repository-analysis-timeout.png', animations: 'disabled' });
      await page.evaluate(() => { window.callme.analyzeProject = () => new Promise((_resolve, reject) => { window.uiFixture.rejectCancelledAnalysis = reject; }); });
      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await page.getByRole('button', { name: 'Остановить разбор', exact: true }).click();
      assert.equal(await page.evaluate(() => window.uiFixture.analysisCancels), 1, 'analysis cancellation must call the native bridge');
      await page.evaluate(() => window.uiFixture.rejectCancelledAnalysis(new Error('cancelled')));
      await page.getByText('Разбор остановлен.', { exact: true }).waitFor();
      await page.evaluate(() => { window.callme.analyzeProject = window.uiFixture.originalAnalyzeProject; });
      await page.getByRole('button', { name: 'Обновить', exact: true }).click();
      await page.getByRole('button', { name: 'Остановить разбор', exact: true }).waitFor({ state: 'hidden' });
      await page.getByText('Обзор подключённого репозитория.', { exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.callme.workspace())).project, null, 'connecting folder must not require a LazyCall project');
      assert.equal((await page.evaluate(() => window.callme.projectContext())).files.length, 0, 'connecting folder must not copy a limited file list');
      assert.equal((await page.evaluate(() => window.callme.projectContext())).goal, 'Сохранить цель до подключения');
      await page.screenshot({ path: 'test-results/repository-connected-light.png', animations: 'disabled' });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.setViewportSize({ width: 904, height: 641 });
      await page.screenshot({ path: 'test-results/repository-connected-dark-904.png', animations: 'disabled' });
      await page.getByRole('button', { name: 'Изменить', exact: true }).click();
      await page.getByRole('textbox', { name: 'Описание проекта', exact: true }).fill('Ручное описание проекта');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
      await page.getByText('Ручное описание проекта', { exact: true }).waitFor();
      await page.evaluate(() => { window.uiFixture.restoreRepositoryConnect = window.callme.connectRepository; window.callme.connectRepository = async () => null; });
      await page.getByRole('button', { name: 'Сменить папку', exact: true }).click();
      await page.getByText('LazyCall repository', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Отключить папку', exact: true }).click();
      await page.getByRole('button', { name: 'Подключить папку', exact: true }).waitFor();
      assert.equal(await page.getByText('Ручное описание проекта', { exact: true }).count(), 0, 'disconnect must clear previous repository overview');
      await page.evaluate(() => { window.callme.connectRepository = window.uiFixture.restoreRepositoryConnect; window.callme.agentStatus = async () => ({ state: 'login', label: 'Войдите через ChatGPT' }); });
      await page.getByRole('button', { name: 'Подключить папку', exact: true }).click();
      await page.getByText('Папка подключена. Войдите через ChatGPT для работы помощника.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Войти через ChatGPT', exact: true }).waitFor();
      await page.screenshot({ path: 'test-results/repository-noauth-dark.png', animations: 'disabled' });
      const result = { status: 'passed', checks: ['folder before meeting without project', 'no file checklist or 16-file import', 'goal saved before connection', 'automatic repository overview', 'analysis stages, files read, and elapsed time', 'timeout preserves overview and retry', 'analysis cancellation', 'editable brief', 'cancel keeps folder', 'disconnect clears brief', 'light/dark minimum width'] };
      await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/project-context.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--transcript-edit')) {
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Встречи', exact: true }).click();
      await page.getByRole('button', { name: /Поиск заявки/ }).click();
      await page.getByText('Нужно находить заявку по номеру из письма.', { exact: true }).waitFor();
      const edit = page.locator('button[aria-label^="Исправить реплику"]');
      await edit.waitFor();
      await edit.click();
      await page.getByRole('heading', { name: 'Исправить реплику', exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Текст реплики', exact: true }).fill('Исправленный номер заявки.');
      await page.getByRole('button', { name: 'Отмена', exact: true }).last().click();
      assert.equal(await page.evaluate(() => window.uiFixture.transcriptEdits.length), 0, 'cancel must not write transcript');
      await edit.click();
      await page.getByRole('textbox', { name: 'Текст реплики', exact: true }).fill('Исправленный номер заявки.');
      await page.screenshot({ path: 'test-results/transcript-correction-dialog.png' });
      await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
      await page.waitForFunction(() => window.uiFixture.transcriptEdits.length === 1);
      assert.deepEqual(await page.evaluate(() => window.uiFixture.transcriptEdits[0]), { sessionId: 'saved', lineId: 'line-1', text: 'Исправленный номер заявки.', expectedText: 'Нужно находить заявку по номеру из письма.' });
      await page.getByText('Исправленный номер заявки.', { exact: true }).waitFor();
      await edit.click();
      await page.getByText('Исходное распознавание', { exact: true }).click();
      await page.getByText('Нужно находить заявку по номеру из письма.', { exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Текст реплики', exact: true }).fill('Повторно исправленный номер заявки.');
      await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
      await page.waitForFunction(() => window.uiFixture.transcriptEdits.length === 2);
      assert.equal(await page.evaluate(() => window.uiFixture.transcriptEdits[1].expectedText), 'Исправленный номер заявки.');
      await page.getByRole('button', { name: 'Итоги встречи', exact: true }).first().click();
      await page.locator('.results-dialog').getByText(/устар/i).waitFor();
      await page.locator('.results-dialog').getByRole('button', { name: 'Обновить итог', exact: true }).click();
      await page.waitForFunction(() => window.uiFixture.requests.some(request => request.mode === 'summary'));
      await page.screenshot({ path: 'test-results/transcript-stale-results.png' });
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.uiFixture.emit('assistant', { id: 'editing-stream', role: 'assistant', text: 'Проверяем…', state: 'streaming', kind: 'answer', createdAt: Date.now() }));
      assert(await edit.isDisabled(), 'editing must be disabled while an assistant response is streaming');
      const result = { status: 'passed', checks: ['cancel has no transcript write', 'edit persists expected text', 'repeated edit preserves original text', 'stale results notice', 'streaming disables edit'] };
      await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/transcript-edit.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--codex-handoff')) {
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      const meetingWindow = page.getByRole('combobox', { name: 'Окно созвона', exact: true });
      if (await page.locator('select.ui-select').count()) await meetingWindow.selectOption('window:fixture');
      else { await meetingWindow.click(); await page.getByRole('option', { name: /Обсуждение проекта/ }).click(); }
      await page.getByRole('button', { name: 'Начать встречу', exact: true }).click();
      await page.getByText('Идёт встреча', { exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('Заметка для передачи в Codex');
      await page.getByRole('button', { name: 'Завершить', exact: true }).click();
      await page.getByRole('button', { name: 'Продолжить в Codex', exact: true }).click();
      await page.getByRole('button', { name: 'Подключить LazyCall', exact: true }).click();
      await page.getByRole('button', { name: 'Отключить доступ', exact: true }).click();
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.screenshot({ path: 'test-results/codex-handoff-dark.png' });
      await page.getByRole('button', { name: 'Открыть новый чат', exact: true }).click();
      await page.waitForFunction(() => window.uiFixture.codex === 1);
      assert((await page.evaluate(() => window.uiFixture.writes)).some(write => write.text === 'Заметка для передачи в Codex'));
      await page.getByRole('button', { name: 'Продолжить в Codex', exact: true }).click();
      await page.getByRole('button', { name: 'Скопировать итоги', exact: true }).click();
      await page.waitForFunction(() => window.uiFixture.codexCopies === 1);
      assert.deepEqual(await page.evaluate(() => ({ connects: window.uiFixture.codexConnects, disconnects: window.uiFixture.codexDisconnects })), { connects: 1, disconnects: 1 });
      const result = { status: 'passed', checks: ['new Codex chat flushes note', 'existing chat copies summary', 'connect and disconnect native actions', 'dark handoff dialog'] };
      await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/codex-handoff.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    if (process.argv.includes('--theme')) {
      await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
      await page.screenshot({ path: 'test-results/theme-light-main-1264.png' });
      await page.getByRole('button', { name: 'Итоги встречи', exact: true }).click();
      await page.getByText('Пока нет расшифровки.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Составить итоги', exact: true }).count(), 0, 'empty recording must not show a disabled generation action');
      await page.screenshot({ path: 'test-results/results-empty-light-1264.png' });
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
      const modelSelect = page.getByRole('combobox', { name: 'Модель', exact: true });
      await modelSelect.click();
      await page.getByRole('option', { name: 'Fixture model', exact: true }).click();
      const assistantSpacing = await page.evaluate(() => {
        const description = document.querySelector('.settings-field-help')?.getBoundingClientRect();
        const reasoning = document.querySelector('#agent-reasoning')?.getBoundingClientRect();
        const privacy = document.querySelector('.agent-data-notice')?.getBoundingClientRect();
        const action = document.querySelector('.settings-agent-actions')?.getBoundingClientRect();
        return { descriptionGap: reasoning.top - description.bottom, actionGap: action.top - privacy.bottom };
      });
      assert(assistantSpacing.descriptionGap >= 12 && assistantSpacing.actionGap >= 12, 'assistant setting groups need readable separation');
      await page.screenshot({ path: 'test-results/settings-spacing-assistant-1264.png' });
      await page.getByRole('tab', { name: 'Вид', exact: true }).click();
      const themeSelect = page.getByRole('combobox', { name: 'Тема', exact: true });
      const appearanceSpacing = await page.evaluate(() => {
        const help = document.querySelector('.settings-inline-block .settings-help')?.getBoundingClientRect();
        const action = document.querySelector('.settings-inline-block .button')?.getBoundingClientRect();
        const shortcuts = document.querySelector('.settings-shortcuts')?.getBoundingClientRect();
        return { actionGap: action.top - help.bottom, shortcutsGap: shortcuts.top - action.bottom };
      });
      assert(appearanceSpacing.actionGap >= 12 && appearanceSpacing.shortcutsGap >= 12, 'appearance settings controls need readable separation');
      await page.screenshot({ path: 'test-results/settings-spacing-appearance-1264.png' });
      await themeSelect.click();
      await page.screenshot({ path: 'test-results/theme-light-dropdown-1264.png' });
      await page.getByRole('option', { name: 'Тёмная', exact: true }).click();
      await page.screenshot({ path: 'test-results/theme-dark-settings-1264.png' });
      await page.getByRole('button', { name: 'Отмена', exact: true }).click();
      assert.notEqual(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'cancel restores the persisted theme');
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('tab', { name: 'Вид', exact: true }).click();
      await page.getByRole('combobox', { name: 'Тема', exact: true }).click();
      await page.getByRole('option', { name: 'Тёмная', exact: true }).click();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await page.screenshot({ path: 'test-results/theme-dark-main-1264.png' });
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await page.getByRole('tab', { name: 'Вид', exact: true }).click();
      assert((await page.getByRole('combobox', { name: 'Тема', exact: true }).textContent()).includes('Тёмная'), 'saved theme reopens as dark');
      await page.getByRole('combobox', { name: 'Тема', exact: true }).click();
      await page.getByRole('option', { name: 'Как в системе', exact: true }).click();
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.evaluate(() => {
        window.uiFixture.emit('agentStatus', { state: 'login', label: 'Войдите через ChatGPT' });
        window.uiFixture.emit('transcript', { id: 'theme-line', source: 'remote', startMs: 1_000, endMs: 2_000, text: 'Проверим итог по записи.' });
      });
      await page.getByRole('button', { name: 'Итоги встречи', exact: true }).click();
      await page.locator('.results-dialog[open]').waitFor();
      await page.setViewportSize({ width: 904, height: 641 });
      const noAuthAction = page.locator('.results-dialog').getByRole('button', { name: 'Войти через ChatGPT', exact: true });
      await noAuthAction.waitFor();
      await page.screenshot({ path: 'test-results/results-noauth-dark-904.png' });
      await noAuthAction.click();
      const generateAction = page.locator('.results-dialog').getByRole('button', { name: 'Составить итоги', exact: true });
      await generateAction.waitFor();
      await generateAction.click();
      await page.waitForFunction(() => window.uiFixture.requests.some(request => request.mode === 'summary'));
      await page.evaluate(() => {
        window.uiFixture.emit('assistant', { id: 'request-1', role: 'assistant', text: 'Краткий итог записи.', state: 'done', kind: 'summary', createdAt: Date.now() });
        window.uiFixture.emit('results', { sessionId: 'new', revision: 1, items: [{ id: 'theme-decision', type: 'decision', text: 'Проверить итог', evidenceIds: ['theme-line'], status: 'draft', author: 'assistant', assignee: '', dueDate: '' }] });
      });
      await page.locator('.results-dialog').getByText('Краткий итог записи.', { exact: true }).waitFor();
      await page.screenshot({ path: 'test-results/results-generated-dark-904.png' });
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
      const result = { status: 'passed', checks: ['light main', 'empty results next action', 'assistant and appearance spacing', 'theme dropdown', 'preview cancel restore', 'dark persists and reopens', 'system theme follows OS', 'no-auth results action', 'generated results at minimum width'] };
      await fs.mkdir('test-results', { recursive: true }); await fs.writeFile('test-results/theme.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); return;
    }
    const checkLayout = async name => {
      const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        panes: [...document.querySelectorAll('.conversation,.assistant-pane')].map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })),
        font: getComputedStyle(document.body).fontFamily }));
      assert(!result.overflow, name + ' page overflow');
      assert(result.panes.every(pane => pane.width >= 360 && pane.height >= 250), name + ' cramped pane');
      assert(result.font.includes('Scada'));
      await page.screenshot({ path: 'test-results/assistant-' + name + '.png' });
    };
    const settledDialog = async selector => {
      await page.waitForTimeout(200);
      await page.locator(selector).waitFor();
    };
    await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
    await checkLayout('idle');
    await page.getByRole('button', { name: 'Без проекта', exact: true }).click();
    await settledDialog('.projects-dialog[open]');
    await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
    await page.getByText('Новый проект', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
    await page.locator('.projects-dialog .project-item').nth(1).click();
    await page.getByRole('button', { name: 'Поиск заявок', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.callme.workspace())).project.name, 'Поиск заявок');
    await page.getByRole('button', { name: 'Поиск заявок', exact: true }).click();
    await page.getByRole('button', { name: 'Изменить проект Поиск заявок', exact: true }).click();
    await page.getByRole('textbox', { name: 'Описание (необязательно)', exact: true }).fill('Общий контекст поиска');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('Заметка для подготовки итогов');
    await page.getByRole('button', { name: 'Итоги встречи', exact: true }).first().click();
    await page.getByRole('button', { name: 'Добавить пункт вручную', exact: true }).click();
    await page.getByRole('button', { name: 'Решение', exact: true }).click();
    await page.getByRole('textbox', { name: 'Текст итога', exact: true }).fill('Подготовить критерии поиска');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
    await page.waitForFunction(() => window.uiFixture.writes.some(write => write.text === 'Заметка для подготовки итогов' && write.sessionId.startsWith('prepared-')));
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('Проверить права доступа');
    await page.getByRole('button', { name: 'Экран и файлы', exact: true }).click();
    await page.getByLabel('Цель встречи', { exact: true }).fill('Понять сценарий поиска');
    await page.getByRole('button', { name: 'Подключить папку', exact: true }).click();
    await page.getByText('LazyCall repository', { exact: true }).waitFor();
    assert.equal(await page.locator('.folder-files').count(), 0, 'repository connection must not require file selection');
    await page.screenshot({ path: 'test-results/assistant-repository-connected.png', animations: 'disabled' });
    assert.equal(await page.getByLabel('Цель встречи', { exact: true }).inputValue(), 'Понять сценарий поиска');
    assert.equal((await page.evaluate(() => window.callme.projectContext())).goal, 'Понять сценарий поиска', 'folder import must preserve the unsaved goal');
    await page.getByText('Обзор подключённого репозитория.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
    await page.getByRole('button', { name: 'Убрать файл Описание проекта.md', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Убрать файл Описание проекта.md', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Убрать файл Описание проекта.md', exact: true }).count(), 0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.materials-dialog').open);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Экран и файлы');
    assert.equal((await page.evaluate(() => window.callme.projectContext())).goal, 'Понять сценарий поиска');
    await page.getByRole('button', { name: 'Встречи', exact: true }).click();
    await page.getByRole('button', { name: /Поиск заявки/ }).click();
    await page.getByText('Нужно находить заявку по номеру из письма.', { exact: true }).waitFor();
    await page.getByText('Уточните формат номера.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Заметки', exact: true }).inputValue(), 'Проверить права доступа');
    await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('Новая заметка сохранённой встречи');
    await page.waitForTimeout(600);
    assert((await page.evaluate(() => window.uiFixture.writes)).filter(write => write.current === 'saved').every(write => write.sessionId === 'saved'));
    await page.getByRole('button', { name: 'Экран и файлы', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.uiFixture.emit('assistant', { id: 'auto-hint', role: 'assistant', text: 'Автоматическая подсказка', state: 'streaming', kind: 'answer', createdAt: Date.now() }));
    await page.getByRole('button', { name: 'Остановить', exact: true }).click();
    await page.getByText('Ответ остановлен.', { exact: true }).last().waitFor();
    const composer = page.locator('#assistant-question');
    const requestCount = async () => page.evaluate(() => window.uiFixture.requests.length);
    const cancelAssistant = async () => {
      await page.getByRole('button', { name: 'Остановить', exact: true }).click();
      await page.getByText('Ответ остановлен.', { exact: true }).last().waitFor();
    };
    assert.equal(await page.getByRole('button', { name: 'Спросить по записи', exact: true }).getAttribute('title'), 'Enter');
    const initialRequestCount = await requestCount();
    await composer.fill('Первая строка');
    await composer.press('Shift+Enter');
    assert.equal(await composer.inputValue(), 'Первая строка\n', 'Shift+Enter must add a newline');
    assert.equal(await requestCount(), initialRequestCount, 'Shift+Enter must not send');
    await composer.fill('Ввод через IME');
    await composer.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })));
    await composer.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, repeat: true })));
    assert.equal(await composer.inputValue(), 'Ввод через IME', 'IME and repeated keydown must leave the draft intact');
    assert.equal(await requestCount(), initialRequestCount, 'IME and repeated keydown must not send');
    await composer.fill('Что спросить про доступ?');
    await composer.press('Enter');
    await page.waitForFunction(count => window.uiFixture.requests.length === count + 1, initialRequestCount);
    assert.equal((await page.evaluate(() => window.uiFixture.requests.at(-1))).text, 'Что спросить про доступ?');
    await cancelAssistant();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Enter отправляет вопрос', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert.equal((await page.evaluate(() => window.callme.settings())).values.enterToSend, false);
    assert.equal(await page.getByRole('button', { name: 'Спросить по записи', exact: true }).getAttribute('title'), 'Ctrl+Enter');
    const ctrlRequestCount = await requestCount();
    await composer.fill('Отправить с Ctrl+Enter');
    await composer.press('Control+Enter');
    await page.waitForFunction(count => window.uiFixture.requests.length === count + 1, ctrlRequestCount);
    assert.equal((await page.evaluate(() => window.uiFixture.requests.at(-1))).text, 'Отправить с Ctrl+Enter');
    await cancelAssistant();
    await page.getByRole('checkbox', { name: 'Искать в интернете', exact: true }).check();
    await composer.fill('Найди рекомендации по поиску');
    const researchRequestCount = await requestCount();
    await page.getByRole('button', { name: 'Спросить по записи', exact: true }).click();
    await page.waitForFunction(count => window.uiFixture.requests.length === count + 1, researchRequestCount);
    assert.deepEqual((await page.evaluate(() => window.uiFixture.requests.at(-1))), { text: 'Найди рекомендации по поиску', mode: 'research', webSearch: true, note: 'Новая заметка сохранённой встречи' });
    const researchRequestId = await page.evaluate(() => window.uiFixture.requestIds.at(-1));
    await page.evaluate(id => window.uiFixture.emit('assistant', { id, role: 'assistant', text: '<img src=x onerror=alert(1)>\nУточните допустимые форматы номера и права доступа.\n\n[Источник](https://example.com/design)\n[Плохая ссылка](javascript:alert(1))', state: 'done', kind: 'research', createdAt: Date.now() }), researchRequestId);
    assert.equal(await page.locator('.assistant-message-text img').count(), 0);
    await page.getByRole('link', { name: 'Источник', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.uiFixture.links), ['https://example.com/design']);
    assert.equal(await page.locator('.assistant-message-text a[href^="javascript:"]').count(), 0);
    const assistantContext = { projectName: 'Поиск заявок', repository: 'connected', brief: true, documents: 2 };
    await page.evaluate(({ id, context }) => window.uiFixture.emit('assistant', { id, role: 'assistant', text: '', state: 'streaming', kind: 'research', createdAt: Date.now(), progress: { stage: 'reading', filesRead: 3 }, context }), { id: researchRequestId, context: assistantContext });
    await page.getByText('Читает файлы проекта: 3…', { exact: true }).first().waitFor();
    assert.equal(await page.getByText('Проект: Поиск заявок', { exact: true }).getAttribute('title'), 'Папка подключена; обзор передан; документов: 2');
    await page.screenshot({ path: 'test-results/assistant-project-reading.png' });
    const previousViewport = page.viewportSize();
    await page.setViewportSize({ width: 904, height: 720 });
    await page.evaluate(({ id, context }) => window.uiFixture.emit('assistant', { id, role: 'assistant', text: '', state: 'streaming', kind: 'research', createdAt: Date.now(), progress: { stage: 'reading', filesRead: 3 }, context: { ...context, projectName: 'ДлинноеНазваниеПроекта'.repeat(5) } }), { id: researchRequestId, context: assistantContext });
    assert(await page.locator('.assistant-pane').evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Long project name must not overflow assistant pane');
    await page.setViewportSize(previousViewport);
    await page.evaluate(({ id, context }) => window.uiFixture.emit('assistant', { id, role: 'assistant', text: 'Сначала уточните допустимый формат номера и права доступа.\n\n- Можно ли вставить номер из письма целиком?\n- Что показывать, если заявка недоступна?\n\n[Открыть источник](https://example.com/design)', state: 'done', kind: 'research', createdAt: Date.now(), context }), { id: researchRequestId, context: assistantContext });
    await page.getByRole('button', { name: 'Итоги встречи', exact: true }).first().click();
    await page.getByText('Подтверждённые решения и задачи попадут в контекст следующих встреч проекта.', { exact: true }).waitFor();
    const summaryRequestCount = await requestCount();
    await page.getByRole('button', { name: 'Составить итоги', exact: true }).click();
    await page.waitForFunction(count => window.uiFixture.requests.length === count + 1, summaryRequestCount);
    assert.equal((await page.evaluate(() => window.uiFixture.requests.at(-1))).mode, 'summary');
    const summaryRequestId = await page.evaluate(() => window.uiFixture.requestIds.at(-1));
    await page.evaluate(id => window.uiFixture.emit('assistant', { id, role: 'assistant', text: 'Решение: добавить поиск по номеру.\nСледующий шаг: проверить права доступа.', state: 'done', kind: 'summary', createdAt: Date.now() }), summaryRequestId);
    await page.evaluate(() => window.uiFixture.emit('results', { sessionId: 'saved', revision: 2, items: [{ id: 'decision-1', type: 'decision', text: 'Добавить поиск по номеру', evidenceIds: ['line-1'], status: 'draft', author: 'assistant', assignee: '', dueDate: '' }] }));
    await page.getByText('Добавить поиск по номеру', { exact: true }).waitFor();
    await page.getByRole('button', { name: '00:03', exact: true }).click();
    await page.locator('[data-line-id="line-1"]').waitFor();
    assert.equal(await page.getByRole('button', { name: 'К последней реплике', exact: true }).count(), 0);
    await page.evaluate(() => Array.from({ length: 30 }, (_, index) => window.uiFixture.emit('transcript', { id: 'scroll-' + index, source: index % 2 ? 'self' : 'remote', startMs: 8000 + index * 1000, endMs: 8800 + index * 1000, text: 'Дополнительная реплика для проверки прокрутки ' + index }))); 
    await page.locator('.transcript').evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await page.getByRole('button', { name: 'К последней реплике', exact: true }).waitFor();
    await page.getByRole('button', { name: 'К последней реплике', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'К последней реплике'));
    await page.getByRole('button', { name: 'Итоги встречи', exact: true }).first().click();
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.getByText('Подтверждено', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Добавить пункт вручную', exact: true }).click();
    await page.getByRole('button', { name: 'Решение', exact: true }).click();
    await page.getByRole('textbox', { name: 'Текст итога', exact: true }).last().fill('Проверить права доступа');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).last().click();
    await page.keyboard.press('Escape');
    await page.locator('.assistant-pane').getByText('Решение: добавить поиск по номеру.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Скопировать', exact: true }).last().click();
    assert((await page.evaluate(() => window.uiFixture.copied.at(-1))).includes('Решение: добавить поиск'));
    await page.getByRole('button', { name: 'В заметки', exact: true }).last().click();
    assert((await page.getByRole('textbox', { name: 'Заметки', exact: true }).inputValue()).includes('Решение: добавить поиск'));
    await page.getByRole('button', { name: 'Скрыть уведомление', exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await checkLayout('conversation');
    await page.setViewportSize({ width: 904, height: 641 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await checkLayout('small');
    await page.evaluate(() => window.uiFixture.emit('health', { severity: 'error', message: 'Системный звук недоступен. Микрофон продолжает работать.' }));
    await checkLayout('small-notification');
    await page.getByRole('button', { name: 'Скрыть уведомление', exact: true }).click();
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
    await page.getByRole('tab', { name: 'Помощник', exact: true, selected: true }).waitFor();
    assert.equal(await page.getByRole('checkbox', { name: 'Подсказки во время встречи', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: 'Подсказки во время встречи', exact: true }).check();
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert.equal((await page.evaluate(() => window.callme.settings())).values.autoHints, true);
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await settledDialog('.settings-dialog[open]');
    await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
    await page.screenshot({ path: 'test-results/assistant-settings-small.png' });
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.keyboard.press('Escape');
    assert(await page.locator('#assistant-question').isDisabled());
    await page.getByRole('button', { name: 'Войти через ChatGPT', exact: true }).click();
    assert(await page.locator('#assistant-question').isEnabled());
    // Preparing a conversation with Codex must not discard notes when capture begins.
    await page.reload();
    await page.getByText('Здесь появится вариант ответа собеседнику.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Без проекта', exact: true }).click();
    await page.locator('.projects-dialog .project-item').nth(1).click();
    await page.getByRole('button', { name: 'Поиск заявок', exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Заметки', exact: true }).fill('Подготовить вопросы о правах доступа');
    await page.locator('#assistant-question').fill('Помоги подготовиться');
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page.waitForFunction(() => window.uiFixture.requests.length === 1);
    assert.equal((await page.evaluate(() => window.uiFixture.requests[0])).note, 'Подготовить вопросы о правах доступа');
    await page.getByRole('button', { name: 'Ещё', exact: true }).click();
    assert(await page.getByRole('menuitem', { name: 'Экспорт', exact: true }).isEnabled());
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Остановить', exact: true }).click();
    const meetingWindow = page.getByRole('combobox', { name: 'Окно созвона', exact: true });
    if (await page.locator('select.ui-select').count()) await meetingWindow.selectOption('window:fixture');
    else { await meetingWindow.click(); await page.getByRole('option', { name: /Обсуждение проекта/ }).click(); }
    await page.getByRole('button', { name: 'Новая встреча', exact: true }).click();
    await page.getByText('Идёт встреча', { exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.uiFixture.writes.at(-1))).text, 'Подготовить вопросы о правах доступа');
    assert.equal(await page.locator('.assistant-message').count(), 0);
    await page.evaluate(() => window.uiFixture.emit('transcript', { id: 'live-target', source: 'remote', startMs: 65000, endMs: 68000, text: 'Кто проверит доступ к заявке?' }));
    await page.getByRole('button', { name: 'Подсказать ответ', exact: true }).waitFor();
    await page.screenshot({ path: 'test-results/assistant-live-target-v8.png' });
    await page.getByRole('button', { name: 'Экран и файлы', exact: true }).click();
    await page.getByRole('button', { name: 'Кадр сейчас', exact: true }).click();
    assert((await page.evaluate(() => window.uiFixture.frames)).some(frame => frame.dataUrl.startsWith('data:image/jpeg')));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Завершить', exact: true }).click();
    await page.getByText('Встреча сохранена', { exact: true }).waitFor();
    await page.evaluate(() => {
      const lines = [
        { id: 'final-1', source: 'remote', startMs: 2000, endMs: 5000, text: 'Согласуем критерии поиска и сроки проверки.' },
        { id: 'final-2', source: 'self', startMs: 6000, endMs: 9000, text: 'Я подготовлю сценарий и пришлю его завтра.' },
        { id: 'final-3', source: 'remote', startMs: 10000, endMs: 13000, text: 'Нужно уточнить владельца проверки доступа.' }
      ];
      lines.forEach(line => window.uiFixture.emit('transcript', line));
      window.uiFixture.emit('assistant', { id: 'final-answer', role: 'assistant', text: 'Зафиксировал следующий шаг: подготовить сценарий поиска и уточнить владельца проверки доступа.', state: 'done', kind: 'answer', createdAt: Date.now() });
      window.uiFixture.emit('results', { sessionId: 'new', revision: 8, items: [
        { id: 'final-decision', type: 'decision', text: 'Проверять поиск по номеру письма', evidenceIds: ['final-1'], status: 'confirmed', author: 'assistant', assignee: '', dueDate: '' },
        { id: 'final-task', type: 'task', text: 'Подготовить сценарий поиска', evidenceIds: ['final-2'], status: 'confirmed', author: 'assistant', assignee: 'Ирина', dueDate: 'Завтра' },
        { id: 'final-question', type: 'question', text: 'Кто отвечает за проверку доступа?', evidenceIds: ['final-3'], status: 'draft', author: 'assistant', assignee: '', dueDate: '' }
      ] });
    });
    await page.getByText('Согласуем критерии поиска и сроки проверки.', { exact: true }).waitFor();
    await page.waitForFunction(() => window.uiFixture.requests.some(request => request.mode === 'summary'));
    await page.evaluate(() => window.uiFixture.emit('assistant', { id: 'request-2', role: 'assistant', text: 'Обсудили критерии поиска и проверку доступа.', state: 'done', kind: 'summary', createdAt: Date.now() }));
    await page.setViewportSize({ width: 1264, height: 841 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/assistant-main-done-v8.png' });
    await page.setViewportSize({ width: 904, height: 641 });
    await page.screenshot({ path: 'test-results/assistant-main-done-small-v8.png' });
    await page.setViewportSize({ width: 1264, height: 841 });
    await page.getByRole('button', { name: 'Итоги встречи', exact: true }).first().click();
    await settledDialog('.results-dialog[open]');
    await page.setViewportSize({ width: 1264, height: 1040 });
    await page.screenshot({ path: 'test-results/assistant-results-v7.png' });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1264, height: 841 });
    await page.getByRole('button', { name: 'Экран и файлы', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить документ', exact: true }).click();
    await page.getByRole('button', { name: 'Убрать файл Описание проекта.md', exact: true }).waitFor();
    await settledDialog('.materials-dialog[open]');
    await page.screenshot({ path: 'test-results/assistant-documents-v7.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Поиск заявок', exact: true }).click();
    await settledDialog('.projects-dialog[open]');
    await page.screenshot({ path: 'test-results/assistant-projects-list-v7.png' });
    await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
    await settledDialog('.projects-dialog.is-form[open]');
    await page.screenshot({ path: 'test-results/assistant-projects-form-v7.png' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await settledDialog('.settings-dialog[open]');
    await page.getByRole('tab', { name: 'Помощник', exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: 'test-results/assistant-settings-v8.png' });
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', checks: ['materials and file controls', 'history restore', 'note session isolation', 'keyboard prompt', 'web request', 'cancel', 'summary', 'escaped assistant output', 'safe external links', 'Scada', 'two working panes at minimum size', 'notifications', 'auto-hints opt-in save', 'settings authentication', 'premeeting note reaches request', 'prep notes survive starting capture', 'latest-question action', 'automatic request cancellation', 'copy and append note actions', 'manual frame'], errors }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
