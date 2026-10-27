const fs = require('node:fs');
const path = require('node:path');

function validateVersion(version) {
  // SemVer with the explicit prerelease channels used by this application.
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.[1-9]\d*)?$/.test(version)) {
    throw new Error('Use X.Y.Z or X.Y.Z-alpha.N / beta.N / rc.N, with N starting at 1');
  }
  return version;
}
function validateTitle(pr) {
  if (pr?.user?.login === 'dependabot[bot]') return;
  if (!/^(?:feat|fix|docs|refactor|perf|test|build|ci|chore)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: \S.+$/.test(pr?.title || '')) {
    throw new Error('PR title must use a Conventional Commit type, e.g. fix: keep the latest reply visible');
  }
}
function validateTag(version, tag) {
  validateVersion(version);
  if (tag !== `v${version}`) throw new Error(`Release tag must be exactly v${version}`);
}

function validateDependencies(pkg) {
  if (!/^yarn@\d+\.\d+\.\d+$/.test(pkg.packageManager || '')) throw new Error('Pin an exact Yarn version in packageManager');
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(pkg[group] || {})) {
      if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Pin an exact version for ${name}, without ranges or tags`);
    }
  }
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    validateVersion(pkg.version);
    validateDependencies(pkg);
    if (!fs.existsSync(path.join(root, 'yarn.lock')) || fs.existsSync(path.join(root, 'package-lock.json'))) throw new Error('Use yarn.lock as the only dependency lockfile');
    const tagIndex = process.argv.indexOf('--tag');
    if (tagIndex !== -1) validateTag(pkg.version, process.argv[tagIndex + 1]);
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      validateTitle(event.pull_request);
    }
    console.log(JSON.stringify({ status: 'passed', version: pkg.version, tag: `v${pkg.version}`, prTitleChecked: process.env.GITHUB_EVENT_NAME === 'pull_request' }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateVersion, validateTitle, validateTag, validateDependencies };
