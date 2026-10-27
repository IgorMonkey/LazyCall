const { _electron: electron } = require('playwright');
const { mkdtemp, readFile, readdir, mkdir, writeFile, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const executable = path.resolve(process.env.CALLME_PACKAGED_EXE || 'release/win-unpacked/LazyCall.exe');
  const publicLight = process.env.CALLME_PUBLIC_LIGHT === '1';
  await access(executable);
  const data = await mkdtemp(path.join(tmpdir(), 'callme-packaged-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + data], env, timeout: 30000 });
  const errors = [];
  try {
    const runtime = await instance.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, data: app.getPath('userData'), resources: process.resourcesPath, app: app.getAppPath() }));
    // Stop before any test writes if this Electron build ignores isolation flags.
    assert.equal(path.resolve(runtime.data).toLowerCase(), path.resolve(data).toLowerCase(), 'Packaged test must use isolated userData');
    assert.equal(runtime.packaged, true);
    assert(runtime.resources.toLowerCase().startsWith(path.dirname(executable).toLowerCase()));
    if (publicLight) {
      assert.equal(runtime.version, require('../package.json').version, 'Public-light smoke must run the current source version');
      assert(runtime.resources.toLowerCase().includes(`${path.sep}public-review${path.sep}`), 'Public-light smoke must run release/public-review/win-unpacked');
    }
    const page = await instance.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    const updateStatus = await page.evaluate(() => window.callme.updateStatus());
    if (publicLight && await require('../dist-electron/updates.js').hasReleaseFeed(path.join(runtime.resources, 'app-update.yml'))) {
      assert.notEqual(updateStatus.state, 'unconfigured', 'Configured packaged updater must load successfully');
    }
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: 'LazyCall', exact: true }).waitFor();
    const wordmark = await page.locator('.brand .brand-wordmark').evaluate(async node => {
      const mask = getComputedStyle(node).maskImage;
      const image = new Image(); image.src = mask.slice(5, -2); await image.decode();
      return { width: node.getBoundingClientRect().width, imageWidth: image.naturalWidth, imageHeight: image.naturalHeight };
    });
    assert(wordmark.width >= 100 && wordmark.imageWidth > wordmark.imageHeight, 'Packaged handwritten wordmark failed to load');
    await page.locator('[data-testid="stt-status"][data-state="ready"]').waitFor({ timeout: 150000 });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => Array.from(document.fonts).filter(font => font.family.includes('Scada') && font.status === 'loaded').length);
    assert(fonts > 0, 'Bundled Scada failed to load');
    const status = await page.evaluate(() => window.callme.whisperStatus());
    assert(['CPU', 'CUDA'].includes(status.backend));
    const expectedManifest = JSON.parse(await readFile(path.join(runtime.resources, 'whisper', 'manifest.json'), 'utf8'));
    await access(path.join(runtime.resources, 'whisper', expectedManifest.model));
    await access(path.join(runtime.resources, 'whisper', 'LICENSE-whisper.cpp.txt'));
    let codexRuntime;
    let agent;
    if (publicLight) {
      await assert.rejects(access(path.join(runtime.resources, 'codex')), { code: 'ENOENT' });
      for (const backend of ['cpu', 'cuda']) for (const dll of ['MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'VCOMP140.dll']) {
        await assert.rejects(access(path.join(runtime.resources, 'whisper', backend, 'Release', dll)), { code: 'ENOENT' });
      }
      // Poll IPC in Node: waitForFunction does not await an async predicate.
      let settledStatus;
      const discoveryDeadline = Date.now() + 45000;
      while (Date.now() < discoveryDeadline) {
        const snapshot = await page.evaluate(async () => {
          const [found, status] = await Promise.all([window.callme.codexRuntime(), window.callme.agentStatus()]);
          return { found, status };
        });
        const terminal = ['login', 'ready', 'error'].includes(snapshot.status.state);
        if ((snapshot.found.source === 'installed' && terminal) || (snapshot.found.source === 'missing' && snapshot.status.label.includes('Codex не найден'))) { settledStatus = snapshot; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(settledStatus, 'Installed Codex discovery did not reach a terminal startup state');
      codexRuntime = settledStatus.found;
      agent = settledStatus.status;
      assert.notEqual(codexRuntime.source, 'bundled', 'Public-light build must not use a bundled Codex runtime');
      if (codexRuntime.source === 'installed') {
        assert(codexRuntime.executable && codexRuntime.version, 'Installed Codex discovery must return an executable and version');
        assert.equal(agent.state, 'login', 'An installed Codex must use LazyCall\'s own fresh login profile');
      } else {
        assert.equal(codexRuntime.source, 'missing');
        assert.equal(codexRuntime.executable, null);
        assert.equal(agent.state, 'disconnected');
      }
    } else {
      const codexManifest = JSON.parse(await readFile(path.join(runtime.resources, 'codex', 'manifest.json'), 'utf8'));
      await access(path.join(runtime.resources, 'codex', codexManifest.executable));
      await access(path.join(runtime.resources, 'codex', 'LICENSE-Codex.txt'));
      await page.waitForFunction(async () => (await window.callme.agentStatus()).state === 'login', undefined, { timeout: 45000 });
      agent = await page.evaluate(() => window.callme.agentStatus());
      assert.equal(agent.state, 'login', 'Fresh portable profile must request its own ChatGPT login');
      codexRuntime = { source: 'bundled', executable: path.join(runtime.resources, 'codex', codexManifest.executable), version: codexManifest.version };
    }
    const settings = await page.evaluate(() => window.callme.settings());
    assert.equal(settings.values.autoSummary, true);
    assert.equal(settings.values.screenContext, true);
    assert.equal(settings.values.enterToSend, true);
    assert.equal(settings.values.model, '');
    assert.equal(settings.values.theme, 'system');
    await page.evaluate(values => window.callme.saveSettings({ ...values, theme: 'dark' }), settings.values);
    assert.equal(await instance.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
    await page.evaluate(values => window.callme.saveSettings({ ...values, theme: 'light' }), settings.values);
    assert.equal(await instance.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'light');
    await page.evaluate(() => window.callme.showCompact());
    const compact = (await instance.windows()).find(window => window.url().endsWith('#compact'));
    assert(compact, 'Packaged compact renderer was not opened');
    compact.on('pageerror', error => errors.push(error.message));
    await compact.getByRole('main', { name: 'Подсказки LazyCall' }).waitFor();
    const compactState = await compact.evaluate(async () => ({ fullBridge: typeof window.callme, snapshot: await window.callmeCompact.snapshot() }));
    assert.equal(compactState.fullBridge, 'undefined', 'Compact must not expose the main desktop API');
    assert.equal(compactState.snapshot.theme, 'light');
    assert.equal(compactState.snapshot.phase, 'idle');
    assert(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('#compact') && window.isAlwaysOnTop() && window.getMinimumSize()[1] === 380)));
    await compact.evaluate(() => window.callmeCompact.hide());
    const repositoryFolder = path.join(data, 'repository-without-project');
    await mkdir(repositoryFolder);
    await writeFile(path.join(repositoryFolder, 'README.md'), 'PACKAGED_REPOSITORY_FIXTURE');
    await instance.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, repositoryFolder);
    const repository = await page.evaluate(() => window.callme.connectRepository());
    assert.equal(repository.folder.name, 'repository-without-project');
    assert.equal((await page.evaluate(() => window.callme.workspace())).project, null);
    assert.equal((await page.evaluate(() => window.callme.projectContext())).files.length, 0);
    assert.equal((await page.evaluate(() => window.callme.disconnectRepository())).folder, null);
    assert.equal((await page.evaluate(() => window.callme.whisperStatus())).state, 'ready');
    assert.deepEqual(await page.evaluate(() => window.callme.agentModels()), []);
    const project = await page.evaluate(async () => {
      const created = await window.callme.createProject({ name: 'Packaged project fixture', description: 'Only synthetic packaged validation data' });
      await window.callme.selectProject(created.id);
      return created;
    });
    assert.equal((await page.evaluate(() => window.callme.workspace())).project.id, project.id);
    const contextDirectory = path.join(data, 'synthetic-context');
    await mkdir(contextDirectory);
    await writeFile(path.join(contextDirectory, 'README.md'), 'PACKAGED_CONTEXT_FIXTURE: selected material.', 'utf8');
    await instance.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, contextDirectory);
    const imported = await page.evaluate(async () => {
      const preview = await window.callme.previewContextFolder();
      return window.callme.importContextFolder(preview.id, preview.files.map(file => file.id));
    });
    assert.equal(imported.files[0].relativePath, 'README.md');
    const knowledge = await page.evaluate(() => window.callme.projectKnowledge());
    assert.equal(path.resolve(knowledge.folder.path), path.resolve(contextDirectory));
    assert.equal(knowledge.folder.available, true);
    const packedFiles = require('@electron/asar').listPackage(runtime.app).map(file => file.replaceAll('\\', '/'));
    for (const required of ['/assets/lazycall-icon.png', '/assets/lazycall-icon.ico', '/assets/lazycall-logo.png', '/assets/lazycall-wordmark.svg', '/assets/lazycall-lockup.svg', '/assets/lazycall-lockup-light.svg', '/licenses/Scada-OFL.txt']) assert(packedFiles.includes(required), 'Missing packaged asset/license: ' + required);
    await instance.evaluate(async ({ BrowserWindow }) => {
      const target = new BrowserWindow({ show: false, width: 400, height: 250, title: 'Packaged smoke source' });
      await target.loadURL('data:text/html,<title>Packaged smoke source</title>');
      target.showInactive();
    });
    const startedSession = await page.evaluate(async () => {
      const source = (await window.callme.windows()).find(item => item.name === 'Packaged smoke source');
      if (!source) throw new Error('Missing owned fixture window');
      await window.callme.selectWindow(source.id);
      return window.callme.start(); // No media device capture, only synthetic PCM below.
    });
    const wav = await readFile('test-results/speech-16k.wav');
    let pcm;
    for (let offset = 12; offset + 8 <= wav.length;) {
      const length = wav.readUInt32LE(offset + 4);
      if (wav.toString('ascii', offset, offset + 4) === 'data') { pcm = wav.subarray(offset + 8, offset + 8 + length); break; }
      offset += 8 + length + length % 2;
    }
    assert(pcm);
    await page.evaluate(bytes => {
      const pcm = Uint8Array.from(bytes);
      window.callme.audio('self', 0, pcm.byteLength / 32, pcm.buffer);
    }, Array.from(pcm));
    await page.locator('.utterance.self p').filter({ hasText: 'заявки' }).waitFor({ timeout: 45000 });
    await page.evaluate(async sessionId => { await window.callme.note('Переносимая сборка: synthetic smoke.', sessionId); await window.callme.stop(); }, startedSession.sessionId);
    const sessions = await readdir(path.join(data, 'sessions'));
    const events = (await readFile(path.join(data, 'sessions', sessions[0], 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert(events.some(event => event.type === 'transcript.final' && event.payload.text.includes('заявки')));
    assert(events.some(event => event.type === 'session.stopped'));
    const structured = await page.evaluate(async sessionId => {
      const snapshot = await window.callme.openMeeting(sessionId);
      const current = await window.callme.meetingResults();
      const item = { id: crypto.randomUUID(), type: 'task', text: 'PACKAGED_RESULT_FIXTURE: проверить номер заявки', evidenceIds: [snapshot.lines[0].id], status: 'confirmed', author: 'user', assignee: '', dueDate: '' };
      await window.callme.saveMeetingResults({ ...current, items: [item] });
      return window.callme.openMeeting(sessionId);
    }, startedSession.sessionId);
    assert.equal(structured.meeting.projectId, project.id);
    assert.equal(structured.results.items[0].status, 'confirmed');
    assert(structured.lines.some(line => structured.results.items[0].evidenceIds.includes(line.id)));
    await instance.evaluate(({ dialog }, dest) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest }); }, path.join(data, 'export.md'));
    assert(await page.evaluate(() => window.callme.export()));
    const exported = await readFile(path.join(data, 'export.md'), 'utf8');
    assert(exported.includes('заявки') && exported.includes('synthetic smoke'));
    assert(exported.includes('PACKAGED_RESULT_FIXTURE') && exported.includes('Подтверждено'));
    await instance.evaluate(({ shell, clipboard }) => { shell.openExternal = async url => { global.__packagedHandoff = url; }; clipboard.writeText = text => { global.__packagedClipboard = text; }; clipboard.readText = () => global.__packagedClipboard || ""; });
    await page.evaluate(() => window.callme.continueInCodex());
    const handoff = new URL(await instance.evaluate(() => global.__packagedHandoff));
    assert.equal(handoff.protocol, 'codex:');
    assert.equal(handoff.hostname, 'new');
    const bundle = handoff.searchParams.get('path');
    assert.equal(path.dirname(bundle), path.join(data, 'handoffs'));
    assert((await readFile(path.join(bundle, 'meeting.md'), 'utf8')).includes('PACKAGED_RESULT_FIXTURE'));
    assert((await readFile(path.join(bundle, 'context.md'), 'utf8')).includes('PACKAGED_CONTEXT_FIXTURE'));
    await page.evaluate(() => window.callme.copyMeetingForCodex());
    assert((await instance.evaluate(({ clipboard }) => clipboard.readText())).includes('PACKAGED_RESULT_FIXTURE'));
    const integration = await page.evaluate(() => window.callme.connectCodexIntegration());
    assert.equal(integration.enabled, true);
    const pluginUrl = new URL(await instance.evaluate(() => global.__packagedHandoff));
    assert.equal(pluginUrl.hostname, 'plugins');
    assert.equal(pluginUrl.pathname, '/callme');
    await page.evaluate(() => window.callme.disconnectCodexIntegration());
    assert.equal((await page.evaluate(() => window.callme.codexIntegration())).enabled, false);
    assert.deepEqual(errors, []);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/packaged-smoke.png' });
    const result = { status: 'passed', executable, runtime, publicLight, backend: status.backend, fonts, codexRuntime, agentStatus: agent.state, customAssetsAndFontLicense: true, transcription: events.find(event => event.type === 'transcript.final').payload.text, projectsAndResults: true, exportVerified: true, expandedSettings: true, themes: true, compactWindow: true, compactShortcuts: compactState.snapshot.shortcuts, folderImport: true, boundFolder: true, codexHandoffBundle: true, codexClipboard: true, pluginAccessToggle: true, externalLaunchStubbed: true, errors };
    await writeFile('test-results/packaged-check.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await instance.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) if (window.getTitle() === 'Packaged smoke source') window.destroy();
    }).catch(() => {});
    await instance.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
