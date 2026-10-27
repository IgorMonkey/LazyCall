// An owned stdio fixture, not a model. Its output is explicitly marked as synthetic.
const readline = require('node:readline');
const fs = require('node:fs');
const turns = new Map();
const repositoryThreads = new Set();
const repositoryCalls = new Map();
let thread = 0, turn = 0, repositoryOverview = 0;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const reply = (request, result) => send({ id: request.id, result });
const models = [{
  id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture model', description: 'Owned test-only catalog entry.', isDefault: true,
  supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Short fixture reasoning.' },
    { reasoningEffort: 'high', description: 'Thorough fixture reasoning.' }
  ],
  defaultReasoningEffort: 'low'
}];
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(process.env.CALLME_FIXTURE_LOG, JSON.stringify(request) + '\n');
  if (!request.method) { const done = repositoryCalls.get(request.id); if (done) { repositoryCalls.delete(request.id); done(request.result); } return; }
  if (request.id === undefined) return;
  if (request.method === 'initialize') return reply(request, {});
  if (request.method === 'account/read') return reply(request, { account: { type: 'chatgpt', email: 'fixture@example.invalid' } });
  if (request.method === 'model/list') return reply(request, { data: models, nextCursor: null });
  if (request.method === 'thread/start') {
    const id = 'fixture-thread-' + (++thread);
    if (request.params.dynamicTools?.some(tool => tool.name === 'repo_read')) repositoryThreads.add(id);
    return reply(request, { thread: { id }, model: request.params?.model || 'fixture-model' });
  }
  if (request.method === 'turn/start') {
    const params = { threadId: request.params.threadId, turnId: 'fixture-turn-' + (++turn) };
    const prompt = request.params.input.find(item => item.type === 'text')?.text || '';
    reply(request, { turn: { id: params.turnId } });
    if (prompt.includes('Подготовь справку о проекте') && repositoryThreads.has(params.threadId)) {
      const attempt = ++repositoryOverview;
      turns.set(params.threadId, { ...params, stream: null, finish: null });
      send({ method: 'item/started', params: { ...params, item: { id: 'overview-plan', type: 'agentMessage', phase: 'commentary' } } });
      send({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'overview-plan', delta: 'FIXTURE_COMMENTARY_PLAN: проверю файлы перед справкой.' } });
      // Keep the second overview active until the native cancellation IPC interrupts it.
      if (attempt === 2) return;
      const finishOverview = result => {
        if (!turns.has(params.threadId)) return;
        const source = String(result?.contentItems?.[0]?.text || '');
        const content = source.includes('REPOSITORY_DYNAMIC_V1') ? 'REPOSITORY_DYNAMIC_V1' : 'MISSING_REPOSITORY_CONTENT';
        const text = `FIXTURE_REPOSITORY_${attempt === 1 ? 'OVERVIEW' : 'RETRY'}: ${content}`;
        send({ method: 'item/started', params: { ...params, item: { id: 'overview', type: 'agentMessage', phase: 'final_answer' } } });
        send({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'overview', delta: text } });
        send({ method: 'item/completed', params: { ...params, item: { id: 'overview', type: 'agentMessage', phase: 'final_answer', text } } });
        send({ method: 'turn/completed', params: { ...params, turn: { id: params.turnId, status: 'completed' } } });
        turns.delete(params.threadId);
      };
      const readId = params.turnId + '-overview-read';
      const listId = params.turnId + '-overview-list';
      repositoryCalls.set(listId, result => {
        if (!turns.has(params.threadId) || !result?.success) return finishOverview(null);
        repositoryCalls.set(readId, finishOverview);
        send({ id: readId, method: 'item/tool/call', params: { ...params, callId: readId, tool: 'repo_read', arguments: { path: 'README.md' } } });
      });
      send({ id: listId, method: 'item/tool/call', params: { ...params, callId: listId, tool: 'repo_list', arguments: { path: '' } } });
      return;
    }
    if (prompt.includes('FIXTURE_REPO_LOOKUP')) {
      const finishRepository = result => {
        if (!turns.has(params.threadId)) return;
        const text = result?.success ? 'FIXTURE_REPO_RESULT: ' + result.contentItems[0].text : 'FIXTURE_REPO_NOT_CONNECTED';
        send({ method: 'item/completed', params: { ...params, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text } } });
        send({ method: 'turn/completed', params: { ...params, turn: { id: params.turnId, status: 'completed' } } });
        turns.delete(params.threadId);
      };
      turns.set(params.threadId, { ...params, stream: null, finish: null });
      if (!repositoryThreads.has(params.threadId)) { finishRepository(null); return; }
      const id = params.turnId + '-repository-read';
      repositoryCalls.set(id, finishRepository);
      send({ id, method: 'item/tool/call', params: { ...params, callId: id, tool: 'repo_read', arguments: { path: 'src/file-25.ts' } } });
      return;
    }
    const summary = prompt.includes('Верни ТОЛЬКО JSON');
    const evidenceId = prompt.match(/\[\d+s, ([0-9a-f-]{36}), (?:Пользователь|Собеседники)\]/i)?.[1];
    const text = summary
      ? JSON.stringify({ summary: 'FIXTURE_ONLY_CALLME_ИТОГИ', items: evidenceId ? [{ type: 'decision', text: 'FIXTURE_GENERATED_DECISION: проверить номер заявки', evidenceIds: [evidenceId], assignee: '', dueDate: '' }] : [] })
      : prompt.includes('Подготовь справку о проекте')
        ? 'FIXTURE_PROJECT_BRIEF: выбранные материалы описывают проверку номера заявки.'
        : 'FIXTURE_ONLY_CALLME_ОТВЕТ\n\nУточните допустимый формат номера и права доступа.';
    send({ method: 'item/started', params: { ...params, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer' } } });
    const stream = setTimeout(() => send({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'answer', delta: text.slice(0, 35) } }), 30);
    const finish = /^ЗАДАНИЕ ПОЛЬЗОВАТЕЛЯ\nCANCEL_FIXTURE(?:\n|$)/.test(prompt) ? null : setTimeout(() => {
      send({ method: 'item/completed', params: { ...params, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text } } });
      send({ method: 'turn/completed', params: { ...params, turn: { id: params.turnId, status: 'completed' } } });
      turns.delete(params.threadId);
    }, 450);
    turns.set(params.threadId, { ...params, stream, finish });
    return;
  }
  if (request.method === 'turn/interrupt') {
    const active = turns.get(request.params.threadId);
    if (active) { clearTimeout(active.stream); clearTimeout(active.finish); turns.delete(active.threadId); send({ method: 'turn/completed', params: { threadId: active.threadId, turn: { id: active.turnId, status: 'interrupted' } } }); }
    return reply(request, {});
  }
  reply(request, {});
});
