const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtemp, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Updates, hasReleaseFeed } = require('../dist-electron/updates.js');

class Driver extends EventEmitter {
  checks = 0; downloads = 0; installs = 0;
  async checkForUpdates() { this.checks++; this.emit('update-available', { version: '0.4.0' }); }
  async downloadUpdate() { this.downloads++; this.emit('download-progress', { percent: 35, transferred: 35, total: 100 }); this.emit('update-downloaded', { version: '0.4.0' }); }
  quitAndInstall(silent, restart) { assert.equal(silent, false); assert.equal(restart, false); this.installs++; }
}

test('updates require configured feed, explicit download and idle installation', async () => {
  const events = [];
  const updates = new Updates('0.3.4', value => events.push(value));
  assert.equal((await updates.check()).state, 'unconfigured');
  await assert.rejects(updates.download());
  const driver = new Driver();
  updates.attach(driver);
  assert.equal(driver.autoDownload, false);
  assert.equal(driver.autoInstallOnAppQuit, false);
  assert.equal(driver.allowDowngrade, false);
  assert.equal(driver.allowPrerelease, false);
  assert.equal(driver.disableWebInstaller, true);
  await updates.check();
  assert.equal(updates.status.state, 'available');
  assert.equal(driver.downloads, 0, 'Discovery must not download');
  await updates.download();
  assert(events.some(event => event.state === 'downloading' && event.percent === 35));
  assert.equal(updates.status.state, 'downloaded');
  let prepared = false;
  assert.throws(() => updates.install(true, () => { prepared = true; }));
  assert.equal(prepared, false); assert.equal(driver.installs, 0);
  updates.install(false, () => { prepared = true; });
  assert.equal(prepared, true); assert.equal(driver.installs, 1);
});

test('download failure never becomes installable and can be retried after recheck', async () => {
  const updates = new Updates('0.3.4', () => {});
  const driver = new Driver(); updates.attach(driver);
  driver.downloadUpdate = async () => { throw new Error('checksum mismatch'); };
  await updates.check(); await updates.download();
  assert.equal(updates.status.state, 'error');
  assert.throws(() => updates.install(false, () => assert.fail('Must not prepare exit')));
  driver.downloadUpdate = Driver.prototype.downloadUpdate;
  await updates.check(); await updates.download();
  assert.equal(updates.status.state, 'downloaded');
});

test('concurrent checks are coalesced and a pending download cannot be installed', async () => {
  const updates = new Updates('0.3.4', () => {});
  const driver = new Driver(); updates.attach(driver);
  let finish;
  driver.checkForUpdates = () => { driver.checks++; return new Promise(resolve => { finish = resolve; }); };
  const first = updates.check(); await updates.check();
  assert.equal(driver.checks, 1);
  driver.emit('update-available', { version: '0.4.0' });
  await assert.rejects(updates.download());
  assert.throws(() => updates.install(false, () => {}));
  finish(); await first;
});

test('alpha builds can discover prereleases without allowing downgrades', () => {
  const updates = new Updates('0.3.5-alpha.1', () => {});
  const driver = new Driver(); updates.attach(driver);
  assert.equal(driver.allowPrerelease, true);
  assert.equal(driver.allowDowngrade, false);
});

test('downloaded event cannot enable teardown before the download promise settles', async () => {
  const updates = new Updates('0.3.5-alpha.1', () => {});
  const driver = new Driver(); updates.attach(driver);
  await updates.check();
  let finish;
  driver.downloadUpdate = () => {
    driver.emit('update-downloaded', { version: '0.4.0' });
    return new Promise(resolve => { finish = resolve; });
  };
  const downloading = updates.download();
  await Promise.resolve();
  assert.equal(updates.status.state, 'downloading');
  assert.equal(updates.canInstall, false);
  let prepared = false;
  assert.throws(() => updates.install(false, () => { prepared = true; }));
  assert.equal(prepared, false);
  finish(); await downloading;
  assert.equal(updates.status.state, 'downloaded');
  assert.equal(updates.canInstall, true);
});

test('synchronous driver failures produce a retryable error state', async () => {
  const updates = new Updates('0.3.5-alpha.1', () => {});
  const driver = new Driver(); updates.attach(driver);
  driver.checkForUpdates = () => { throw Error('offline'); };
  assert.equal((await updates.check()).state, 'error');
  driver.checkForUpdates = Driver.prototype.checkForUpdates;
  await updates.check();
  driver.downloadUpdate = () => { throw Error('download failed'); };
  await updates.download();
  assert.equal(updates.status.state, 'error');
  assert.throws(() => updates.install(false, () => assert.fail('Must not install')));
});

test('feed loader accepts only the build-embedded public GitHub schema', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'callme-update-feed-'));
  const file = path.join(directory, 'app-update.yml');
  assert.equal(await hasReleaseFeed(file), false);
  for (const url of ['http://github.com/a/b/releases/latest/download', 'https://evil.test/a/b/releases/latest/download', 'https://github.com/a/b/releases/latest/download?token=secret']) {
    await writeFile(file, 'provider: generic\nurl: ' + url + '\n');
    assert.equal(await hasReleaseFeed(file), false);
  }
  const valid = 'provider: github\nowner: fixture\nrepo: callme-releases\nupdaterCacheDirName: callme-updater\n';
  for (const extra of ['url: https://evil.test\n', 'host: evil.test\n', 'token: secret\n', 'repo: override\n', 'provider: generic\n']) {
    await writeFile(file, valid + extra);
    assert.equal(await hasReleaseFeed(file), false);
  }
  await writeFile(file, valid);
  assert.equal(await hasReleaseFeed(file), true);
});
