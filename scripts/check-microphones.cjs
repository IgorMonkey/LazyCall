// Native Electron permissions and fake Chromium devices; no microphone hardware,
// model runtime, authentication, audio persistence or meeting recording is used.
const { _electron: electron } = require('playwright');
const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'lazycall-microphones-'));
  const env = { ...process.env, CALLME_TEST_DATA: data, CALLME_SKIP_WHISPER: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({ executablePath: require('electron'), args: [process.cwd(), '--use-fake-device-for-media-stream'], env, timeout: 30000 });
  try {
    const page = await instance.firstWindow();
    await require('./prepare-ui-fixture.cjs')(page);
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.micTest = { calls: [], tracks: [], mode: 'normal' };
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.micTest.calls.push(constraints);
        if (window.micTest.mode === 'denied') throw new DOMException('Fixture denial', 'NotAllowedError');
        const stream = await original(constraints);
        window.micTest.tracks.push(...stream.getTracks());
        if (window.micTest.mode === 'late') await new Promise(resolve => setTimeout(resolve, 9000));
        return stream;
      };
    });
    await page.reload();
    const mic = page.getByRole('combobox', { name: 'Микрофон', exact: true });
    await mic.waitFor();
    assert.equal(await page.evaluate(() => window.micTest.calls.length), 0, 'Startup must not acquire a microphone');
    // This failed before the fix: the only option before recording was Default.
    await mic.focus(); await mic.press('Enter');
    await page.getByRole('option').filter({ hasText: /Fake/ }).first().waitFor();
    await page.waitForFunction(() => window.micTest.tracks.length && window.micTest.tracks.every(track => track.readyState === 'ended'));
    const options = await page.getByRole('option').allTextContents();
    const chosen = page.getByRole('option').filter({ hasText: /Fake/ }).first();
    const label = await chosen.innerText(); await chosen.click();
    assert.equal((await mic.innerText()).trim(), label.trim());
    assert.equal((await page.evaluate(() => window.callme.listMeetings())).length, 0, 'Device discovery must not create a meeting');
    const outsideDenied = await page.evaluate(async () => {
      try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); return false; }
      catch { return true; }
    });
    assert(outsideDenied, 'Microphone access must close when discovery finishes');
    const permissions = await page.evaluate(async () => {
      const token = await window.callme.prepareMicrophone();
      try {
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput' && device.deviceId && !['default', 'communications'].includes(device.deviceId));
        const selected = devices.find(device => device.label.includes('Fake'));
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selected.deviceId } }, video: false });
        const selectedMatches = stream.getAudioTracks()[0].getSettings().deviceId === selected.deviceId;
        stream.getTracks().forEach(track => track.stop());
        let cameraDenied = false, displayDenied = false;
        try { const camera = await navigator.mediaDevices.getUserMedia({ video: true }); camera.getTracks().forEach(track => track.stop()); } catch { cameraDenied = true; }
        try { const screen = await navigator.mediaDevices.getDisplayMedia({ video: true }); screen.getTracks().forEach(track => track.stop()); } catch { displayDenied = true; }
        return { selectedMatches, cameraDenied, displayDenied };
      } finally { await window.callme.finishMicrophone(token); }
    });
    assert.deepEqual(permissions, { selectedMatches: true, cameraDenied: true, displayDenied: true });
    const auxiliaryDenied = await instance.evaluate(async ({ BrowserWindow }, source) => {
      const auxiliary = new BrowserWindow({ show: false, webPreferences: { preload: source.preload, sandbox: true, contextIsolation: true } });
      try { await auxiliary.loadFile(source.file); return await auxiliary.webContents.executeJavaScript('window.callme.prepareMicrophone().then(() => false, () => true)'); }
      finally { auxiliary.destroy(); }
    }, { preload: path.resolve('dist-electron/preload.js'), file: path.resolve('dist/index.html') });
    assert(auxiliaryDenied, 'Other windows must not open a microphone probe');
    const refresh = page.getByRole('button', { name: 'Обновить список окон и устройств', exact: true });
    await refresh.click(); await page.evaluate(() => { window.micTest.mode = 'denied'; });
    await mic.click();
    await page.getByText('Разрешите доступ к микрофону в настройках Windows и попробуйте ещё раз.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.micTest.mode = 'late'; });
    await mic.click();
    await page.getByText('Проверка микрофона заняла слишком много времени. Попробуйте ещё раз.', { exact: true }).waitFor({ timeout: 12000 });
    await page.waitForFunction(() => window.micTest.tracks.every(track => track.readyState === 'ended'), { }, { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.micTest.mode = 'normal'; });
    const previousCalls = await page.evaluate(() => window.micTest.calls.length);
    await mic.click();
    await page.waitForFunction(count => window.micTest.calls.length > count && window.micTest.tracks.every(track => track.readyState === 'ended'), previousCalls);
    assert.equal((await page.evaluate(() => window.callme.listMeetings())).length, 0);
    await mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/microphones-before-recording.png' });
    const report = { status: 'passed', options, checks: ['no startup acquisition', 'keyboard opens device discovery before recording', 'native device labels and selection', 'probe tracks stopped', 'exact device constraints', 'audio permission closes after probe', 'camera and display denied during probe', 'auxiliary IPC denied', 'denial and retry', 'late acquisition stopped after timeout', 'no meeting created'] };
    await writeFile('test-results/microphones-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await instance.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
