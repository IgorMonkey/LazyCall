const { _electron: electron } = require('playwright');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const saved = { language: 'en', compute: 'cpu', autoHints: false, autoSummary: true, screenContext: true, enterToSend: true, model: '', reasoningEffort: 'default', theme: 'system', locale: 'ru' };

const selectOption = async (page, label, option) => {
  const combo = page.getByRole('combobox', { name: label, exact: true });
  await combo.click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

(async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'callme-settings-ui-'));
  const env={...process.env,CALLME_TEST_DATA:directory}; delete env.ELECTRON_RUN_AS_NODE;
  let instance;
  const launch=async()=>{
    instance=await electron.launch({executablePath:require('electron'),args:[process.cwd()],env,timeout:30000});
    const page=await instance.firstWindow();
    await require("./prepare-ui-fixture.cjs")(page);
    await page.getByRole('heading',{name:'LazyCall',exact:true}).waitFor();
    await page.locator('[data-testid="stt-status"][data-state="ready"]').waitFor({timeout:150000});
    return page;
  };
  try {
    let page=await launch();
    const engine=await page.evaluate(()=>window.callme.whisperStatus());
    assert(['CPU', 'CUDA'].includes(engine.backend),'A real native backend must be ready');
    if (process.env.CALLME_EXPECT_GPU === '1') assert.equal(engine.backend,'CUDA','GPU regression run must actually load CUDA');
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    assert.equal(await page.getByRole('tab').count(), 5, 'Settings must expose five sections');
    assert.equal(await page.getByRole('combobox',{name:'Язык речи',exact:true}).textContent(),'Русский');
    await page.getByRole('tab',{name:'Помощник',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Подсказки во время встречи',exact:true}).isChecked(),false);
    assert.equal(await page.getByRole('checkbox',{name:'Итоги после завершения встречи',exact:true}).isChecked(),true);
    assert.equal(await page.getByRole('checkbox',{name:'Передавать кадр выбранного окна',exact:true}).isChecked(),true);
    assert.equal(await page.getByRole('checkbox',{name:'Enter отправляет вопрос',exact:true}).isChecked(),true);
    assert(await page.getByRole('button',{name:'Сохранить',exact:true}).isDisabled());
    await page.getByRole('tab',{name:'Запись',exact:true}).click();
    await selectOption(page, 'Язык речи', 'English');
    await page.getByRole('tab',{name:'Помощник',exact:true}).click();
    await page.getByRole('checkbox',{name:'Подсказки во время встречи',exact:true}).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'Язык речи',exact:true}).textContent(),'Русский','Escape should discard unapplied changes');
    await page.getByRole('tab',{name:'Помощник',exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Подсказки во время встречи',exact:true}).isChecked(),false,'Escape must discard automatic hints opt-in');
    await page.getByRole('tab',{name:'Запись',exact:true}).click();
    await selectOption(page, 'Язык речи', 'English');
    await selectOption(page, 'Обработка', 'Только процессор');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.getByRole('dialog',{name:'Настройки',exact:true}).waitFor({state:'hidden',timeout:150000});
    assert.deepEqual(JSON.parse(await readFile(path.join(directory,'settings.json'),'utf8')), saved);
    assert.equal((await page.evaluate(()=>window.callme.whisperStatus())).backend,'CPU');
    await instance.close(); instance=null;
    page=await launch();
    assert.equal((await page.evaluate(()=>window.callme.whisperStatus())).backend,'CPU','Saved CPU selection must survive app restart');
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'Язык речи',exact:true}).textContent(),'English');
    assert.equal(await page.getByRole('combobox',{name:'Обработка',exact:true}).textContent(),'Только процессор');
    await instance.evaluate(({shell})=>{shell.openPath=async target=>{global.__testFolder=target;return '';};});
    await page.getByRole('tab',{name:'Данные',exact:true}).click();
    await page.getByRole('button',{name:'Открыть папку',exact:true}).click();
    await page.waitForTimeout(100);
    assert.equal(await instance.evaluate(()=>global.__testFolder),path.join(directory,'sessions'));
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Настройки',exact:true}).click();
    await page.getByRole('tab',{name:'Вид',exact:true}).click();
    await selectOption(page, 'Тема', 'Тёмная');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();
    assert.equal(await instance.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
    assert.equal(JSON.parse(await readFile(path.join(directory,'settings.json'),'utf8')).theme, 'dark');
    await instance.close(); instance=null;
    page=await launch();
    assert.equal(await instance.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark', 'Saved theme must survive app restart');
    const rejection=await page.evaluate(async()=>{
      try {await window.callme.saveSettings({language:'xx',compute:'shell'});return '';} catch(e){return String(e);}
    });
    assert(rejection.includes('Некорректные настройки'));
    await page.evaluate(async()=>{
      const sources=await window.callme.windows();
      await window.callme.selectWindow(sources[0].id);
      await window.callme.start(); // No getUserMedia/getDisplayMedia: no real sources captured.
    });
    const liveChatSettings = await page.evaluate(async values => window.callme.saveSettings({ ...values, autoSummary: false, screenContext: false, enterToSend: true, theme: 'light' }), { ...saved, theme: 'dark' });
    assert.equal(liveChatSettings.autoSummary, false, 'Chat-only settings remain available while capture is active');
    assert.equal(liveChatSettings.screenContext, false);
    assert.equal(liveChatSettings.enterToSend, true);
    assert.equal(await instance.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'light', 'Theme must apply without restarting Whisper');
    const busyRejection=await page.evaluate(async values => {
      try {await window.callme.saveSettings({ ...values, language: 'ru' });return '';} catch(e){return String(e);}
    }, liveChatSettings);
    assert(busyRejection.includes('Распознавание можно настроить после завершения записи'));
    await page.evaluate(()=>window.callme.stop());
    console.log(JSON.stringify({status:'passed',actualAutoBackend:engine.backend,persistedAfterRestart:saved,folderAction:'verified without opening Explorer',invalidSettingsRejected:true,liveChatSettings:true,meetingGuard:true}));
  } finally { if(instance) await instance.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
