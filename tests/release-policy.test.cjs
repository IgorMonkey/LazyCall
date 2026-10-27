const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateVersion, validateTitle, validateTag, validateDependencies } = require('../scripts/check-release-policy.cjs');

test('release versions use explicit ordered channels and reject ambiguous identifiers', () => {
  for (const version of ['0.3.5-alpha.1', '0.3.5-alpha.12', '0.3.5-beta.1', '0.3.5-rc.1', '0.3.5', '1.0.0']) assert.equal(validateVersion(version), version);
  for (const version of ['v0.3.5', '00.3.5', '0.03.5', '0.3.05', '0.3.5-alpha.0', '0.3.5-alpha.01', '0.3.5-preview.1', '0.3.5-alpha', '0.3.5+local']) assert.throws(() => validateVersion(version));
});
test('a release cannot claim a different package version', () => {
  validateTag('0.3.5-alpha.1', 'v0.3.5-alpha.1');
  assert.throws(() => validateTag('0.3.5-alpha.1', 'v0.3.5'));
  assert.throws(() => validateTag('0.3.5-alpha.1', '0.3.5-alpha.1'));
});
test('human PRs use conventional titles while Dependabot only bypasses the title rule', () => {
  for (const title of ['fix: keep reply visible', 'feat(provider)!: change capabilities', 'ci: validate release tags']) validateTitle({ title, user: { login: 'contributor' } });
  assert.throws(() => validateTitle({ title: 'random update', user: { login: 'contributor' } }));
  assert.throws(() => validateTitle({ title: 'fix:', user: { login: 'contributor' } }));
  validateTitle({ title: 'Bump dependency group', user: { login: 'dependabot[bot]' } });
});

test('dependency changes keep exact package and Yarn versions', () => {
  const base = { packageManager: 'yarn@4.13.0', dependencies: { react: '19.3.1' } };
  validateDependencies(base);
  for (const version of ['^19.3.1', '~19.3.1', '*', 'latest', '>=19.0.0']) assert.throws(() => validateDependencies({ ...base, dependencies: { react: version } }));
  assert.throws(() => validateDependencies({ ...base, packageManager: 'yarn@stable' }));
});
