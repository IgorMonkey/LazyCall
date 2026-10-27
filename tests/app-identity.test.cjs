const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtimeIdentity } = require('../dist-electron/app-identity.js');

test('LazyCall preserves the existing production storage identifier', () => {
  assert.deepEqual(runtimeIdentity('C:\\Apps\\LazyCall.exe'), { name: 'LazyCall', dataDirectory: 'CallMe', preview: false });
  assert.equal(runtimeIdentity('C:\\Apps\\electron.exe').dataDirectory, 'CallMe');
});
test('owned preview executables use a separate profile and app identity', () => {
  for (const executable of ['LazyCallWebPreview.exe', 'CallMeWebPreview.exe']) {
    assert.deepEqual(runtimeIdentity('C:\\Temp\\' + executable), { name: 'LazyCallWebPreview', dataDirectory: 'LazyCallWebPreview', preview: true });
  }
  assert.equal(runtimeIdentity('C:\\LazyCallWebPreview.exe\\LazyCall.exe').preview, false);
});
