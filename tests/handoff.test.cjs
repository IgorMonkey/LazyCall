const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createCodexHandoff } = require('../dist-electron/handoff');

test('Codex draft URL carries owned bundle path, with complete recording data in files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'callme-handoff-'));
  const lineId = 'a47c03bc-47de-4b27-89c8-03ea4630a2f7';
  const snapshot = {
    meeting: { id: 'f2ac50b5-b5b9-48e5-9471-c29dd5af3b48', startedAt: '2026-10-26T10:00:00Z', note: 'PRIVATE_NOTE', lines: [{ id: lineId, source: 'remote', startMs: 1200, endMs: 3000, text: 'PRIVATE_TRANSCRIPT' }] },
    messages: [{ id: 'answer', role: 'assistant', text: 'PRIVATE_SYNOPSIS', state: 'done', kind: 'summary', createdAt: 1 }],
    results: { sessionId: 'f2ac50b5-b5b9-48e5-9471-c29dd5af3b48', revision: 1, items: [{ id: '21df10f1-ddd6-4de3-83df-ced8674fd271', type: 'task', text: 'PRIVATE_TASK', evidenceIds: [lineId], status: 'draft', author: 'assistant', assignee: '', dueDate: '' }] },
    project: null, context: 'docs/brief.md\nPRIVATE_CONTEXT_TAIL'
  };
  const url = new URL(await createCodexHandoff(root, snapshot));
  assert.equal(url.protocol, 'codex:'); assert.equal(url.hostname, 'new');
  const directory = url.searchParams.get('path');
  assert.equal(path.dirname(directory), path.join(root, 'handoffs'));
  assert.ok(url.searchParams.get('prompt').includes('meeting.md'));
  assert.ok(url.href.length < 2000);
  assert.ok(!url.href.includes('PRIVATE_'));
  assert.deepEqual((await readdir(directory)).sort(), ['context.md', 'meeting.md']);
  const body = await readFile(path.join(directory, 'meeting.md'), 'utf8');
  for (const value of ['PRIVATE_NOTE', 'PRIVATE_TRANSCRIPT', 'PRIVATE_SYNOPSIS', 'PRIVATE_TASK', lineId]) assert.ok(body.includes(value), value);
  assert.ok((await readFile(path.join(directory, 'context.md'), 'utf8')).includes('PRIVATE_CONTEXT_TAIL'));
  const second = new URL(await createCodexHandoff(root, snapshot));
  assert.notEqual(second.searchParams.get('path'), directory);
});
