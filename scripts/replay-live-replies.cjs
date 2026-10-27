// Explicit diagnostic: replays selected questions through CallMe's own account.
// Never copies credentials, opens the global Codex profile, or changes a meeting.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { CodexProvider } = require('../dist-electron/codex-provider');
const { replyBlock, transcriptContext, replyContract, assistantHistory } = require('../dist-electron/assistant-context');
const { RepositoryMemory } = require('../dist-electron/repository-memory');

(async () => {
  assert.equal(process.env.CALLME_REPLAY_REAL_MODEL, '1', 'Real model diagnostic must be explicitly enabled');
  const data = path.resolve(process.env.APPDATA, 'CallMe');
  const session = process.env.CALLME_REPLAY_SESSION;
  const targets = (process.env.CALLME_REPLAY_TARGETS || '').split(',').filter(Boolean);
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  assert(uuid.test(session) && targets.length > 0 && targets.length <= 3 && targets.every(id => uuid.test(id)));
  const rows = (await fs.readFile(path.join(data, 'sessions', session, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const projectId = rows.find(row => row.type === 'session.project')?.payload.id;
  assert(uuid.test(projectId), 'Replay requires an explicitly selected project');
  const project = JSON.parse(await fs.readFile(path.join(data, 'projects', projectId, 'project.json'), 'utf8'));
  const knowledge = JSON.parse(await fs.readFile(path.join(data, 'projects', projectId, 'knowledge/knowledge.json'), 'utf8'));
  const settings = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
  const root = knowledge.folder.path;
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'callme-reply-replay-'));
  const provider = new CodexProvider(path.resolve('runtime/codex/package/vendor/x86_64-pc-windows-msvc/bin/codex.exe'), path.join(data, 'codex-home'), workspace);
  const memory = new RepositoryMemory(); memory.seed(projectId, knowledge.brief?.repositoryFiles || []);
  const report = { session, project: project.name, startedAt: new Date().toISOString(), cases: [], credentials: 'CallMe own profile used by runtime directly; no auth read/copied by test; no global Codex profile', mutations: 'no meeting/project/repository modifications' };
  try {
    assert.equal((await provider.connect()).state, 'ready', 'CallMe login is not ready');
    for (const targetId of targets) {
      const anchor = rows.findIndex(row => row.type === 'transcript.final' && row.payload.id === targetId);
      assert(anchor >= 0);
      const before = rows.slice(0, anchor + 1);
      const lines = before.filter(row => row.type === 'transcript.final').map(row => row.payload);
      const target = lines.at(-1); const block = replyBlock(lines, target);
      const messages = [...new Map(before.filter(row => row.type === 'assistant.message').map(row => [row.payload.id, row.payload])).values()];
      const history = assistantHistory(messages);
      const selected = transcriptContext(lines, target.text, target);
      const evidence = await memory.excerpts(projectId, root, block.map(line => line.text).join('\n'));
      const prompt = `Пользователь отвечает на технические вопросы собеседника по проекту ${project.name}.\n<контекст_проекта>\n${project.description || ''}\n${knowledge.brief?.text || ''}\n</контекст_проекта>\n<данные_встречи>\n${selected.map(line => `[${line.startMs / 1000}s, ${line.source}] ${line.text}`).join('\n')}\nИстория запросов пользователя:\n${history.text}\n</данные_встречи>\n<проверенные_фрагменты>\n${evidence.text}\n</проверенные_фрагменты>\n${replyContract(target, block, true)}`;
      const result = { targetId, target: target.text, model: '', elapsedMs: 0, reads: [], answer: '', error: '', stages: [] };
      const started = Date.now();
      console.log(JSON.stringify({ stage: 'replay-start', targetId }));
      try {
        await provider.run({ id: targetId, text: prompt, images: [], webSearch: false, repositoryRoot: root, model: settings.model || undefined, reasoningEffort: settings.reasoningEffort || 'default',
          onRepositoryRead: read => { result.reads.push(read); memory.remember(projectId, read); },
          onProgress: value => { result.stages.push({ ...value, elapsedMs: Date.now() - started }); console.log(JSON.stringify({ targetId, ...value, elapsedMs: Date.now() - started })); },
          onText: text => { result.answer = text; }
        });
      } catch (error) { result.error = error.message; }
      result.elapsedMs = Date.now() - started; result.model = provider.status.model || settings.model || 'default';
      report.cases.push(result);
      await fs.writeFile('test-results/live-reply-replay.json', JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ targetId, elapsedMs: result.elapsedMs, model: result.model, reads: result.reads.length, answer: result.answer, error: result.error }));
    }
  } finally { provider.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
