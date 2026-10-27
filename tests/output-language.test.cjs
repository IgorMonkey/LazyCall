const { test } = require('node:test');
const assert = require('node:assert/strict');
const { outputLanguage } = require('../dist-electron/output-language');
test('generated briefs and summaries follow explicit UI language with international system fallback', () => {
  assert.equal(outputLanguage('ru', 'en-US'), 'Russian');
  assert.equal(outputLanguage('en', 'ru-RU'), 'English');
  assert.equal(outputLanguage('system', 'ru-RU'), 'Russian');
  assert.equal(outputLanguage('system', 'en-US'), 'English');
  assert.equal(outputLanguage('system', 'de-DE'), 'English');
});
