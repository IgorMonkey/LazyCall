const { mkdtemp } = require('./temporary.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { writeFile, unlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { RepositoryMemory } = require(path.join(process.env.CALLME_TEST_BUILD || path.join(__dirname, '../dist-electron'), 'repository-memory'));

test('reused project evidence is re-read after edit and isolated by project scope', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'callme-repository-memory-'));
  const file = path.join(root, 'contract.md');
  const memory = new RepositoryMemory();
  memory.remember('project-A', { path: 'contract.md', startLine: 1, limit: 20 });
  await writeFile(file, 'FIRST_VERSION');
  assert((await memory.excerpts('project-A', root, 'contract')).text.includes('FIRST_VERSION'));
  await writeFile(file, 'CURRENT_VERSION');
  const current = await memory.excerpts('project-A', root, 'contract');
  assert(current.text.includes('CURRENT_VERSION')); assert(!current.text.includes('FIRST_VERSION'));
  assert.equal((await memory.excerpts('project-B', root, 'contract')).text, '');
  await unlink(file); assert.equal((await memory.excerpts('project-A', root, 'contract')).text, '');
});

test('seeded sources use bounded authorized reads and cannot escape the selected folder', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'callme-repository-memory-'));
  const memory = new RepositoryMemory();
  await writeFile(path.join(root, 'readme.md'), 'PROJECT_FACT');
  memory.seed('scope', ['../outside.txt', 'readme.md']);
  const evidence = await memory.excerpts('scope', root, 'fact');
  assert.deepEqual(evidence.files, ['readme.md']); assert(evidence.text.includes('PROJECT_FACT'));
  memory.seed('scope', ['secret-new-file.md']);
  assert.deepEqual((await memory.excerpts('scope', root, 'fact')).files, ['readme.md']);
});
