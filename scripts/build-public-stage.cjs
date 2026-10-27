const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'release', 'public-review');
const vc = ['MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'VCOMP140.dll'];

(async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
  await fs.mkdir(path.join(project, 'release'), { recursive: true });
  const parent = await fs.realpath(path.join(project, 'release'));
  assert.equal(parent.toLowerCase(), path.join(await fs.realpath(project), 'release').toLowerCase());
  try { assert.equal((await fs.realpath(output)).toLowerCase(), path.join(parent, 'public-review').toLowerCase()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output);
  const extraResources = pkg.build.extraResources.filter(entry => entry.to !== 'codex').map(entry => entry.to !== 'whisper' ? entry : {
    ...entry, filter: [...entry.filter, ...vc.map(name => '!**/' + name), '!LICENSE-Microsoft-VC.txt']
  });
  const config = { ...pkg.build, directories: { ...pkg.build.directories, output }, extraResources,
    files: [...pkg.build.files, 'LICENSE', 'THIRD_PARTY_NOTICES.md'] };
  const configFile = path.join(output, 'stage-config.json');
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  const child = spawn(process.execPath, [path.join(project, 'node_modules/electron-builder/out/cli/cli.js'), '--config', configFile, '--win', 'dir', '--x64', '--publish', 'never'], { cwd: project, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, 'Public staging failed');
  const resources = path.join(output, 'win-unpacked', 'resources');
  await assert.rejects(fs.access(path.join(resources, 'codex')), { code: 'ENOENT' });
  for (const backend of ['cpu', 'cuda']) for (const name of vc) await assert.rejects(fs.access(path.join(resources, 'whisper', backend, 'Release', name)), { code: 'ENOENT' });
  const repository = process.env.CALLME_RELEASE_REPOSITORY;
  if (repository) {
    assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Invalid release repository');
    const [owner, repo] = repository.split('/');
    await fs.writeFile(path.join(resources, 'app-update.yml'), `provider: github\nowner: ${owner}\nrepo: ${repo}\nupdaterCacheDirName: callme-updater\n`);
  }
  await fs.writeFile(path.join(output, 'public-stage.json'), JSON.stringify({ version: pkg.version, source: 'fresh build', bundledCodex: false, bundledVcDlls: false, systemVcRequired: '14.51.36247.0', releaseRepository: repository || null, published: false }, null, 2));
  console.log(JSON.stringify({ status: 'staged', version: pkg.version, output, bundledCodex: false, bundledVcDlls: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
