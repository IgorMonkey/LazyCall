// Use only with the test's isolated user-data directory. Product UI has no test
// bypass: fixtures persist their own locale and dismiss only their own tutorial.
module.exports = async function prepareFixture(page) {
  await page.waitForFunction(() => window.callme?.settings && document.querySelector('#root'));
  await page.evaluate(async () => {
    localStorage.setItem('callme.onboarding.dismissed.v1', 'true');
    const snapshot = await window.callme.settings();
    await window.callme.saveSettings({ ...snapshot.values, locale: 'ru' });
  });
  await page.reload();
};
