const { mkdtemp } = require('./temporary.cjs');
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const build = process.env.CALLME_TEST_BUILD || path.join(__dirname, "../dist-electron");
const { CodexProvider } = require(path.join(build, "codex-provider"));
const tick = () => new Promise(resolve => setImmediate(resolve));

test("overview progress renews inactivity only for its own turn and cancel releases without interrupt ack", async t => {
  const f = await fixture(t, (request, { reply }) => {
    if (request.method === 'turn/start') { reply(request, { turn: { id: 'overview-turn' } }); return true; }
    if (request.method === 'turn/interrupt') return true;
    return false;
  });
  await f.provider.connect();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const progress = [];
  const task = f.provider.run({ id: 'overview', purpose: 'project-overview', text: 'Overview', images: [], webSearch: false, onText() {}, onProgress: p => progress.push(p) });
  const rejected = assert.rejects(task, /Запрос отменён/);
  await until(() => progress.some(p => p.stage === 'analyzing'));
  const start = f.requests.find(r => r.method === 'turn/start');
  const threadId = start.params.threadId;
  t.mock.timers.tick(90_000);
  f.emit({ method: 'item/reasoning/summaryTextDelta', params: { threadId, turnId: 'overview-turn', delta: 'thinking' } });
  t.mock.timers.tick(90_000);
  assert.equal(f.provider.running.size, 1, 'Valid reasoning keeps active overview alive past one minute');
  const before = progress.length;
  f.emit({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'wrong-turn', itemId: 'foreign', delta: 'wrong' } });
  f.emit({ method: 'turn/completed', params: { threadId, turn: { id: 'wrong-turn', status: 'completed' } } });
  await tick();
  assert.equal(f.provider.running.size, 1, 'A nested foreign turn id cannot finish the active request');
  assert.equal(progress.length, before);
  const cancellation = f.provider.cancel('overview');
  await rejected;
  assert.equal(f.provider.running.size, 0, 'UI must be released before interrupt ack');
  f.emit({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'overview-turn', itemId: 'late', delta: 'late' } });
  assert.equal(progress.length, before);
  t.mock.timers.tick(20_000); await cancellation;
});

test('foreign progress cannot prevent overview inactivity timeout; timeout releases capacity for retry', async t => {
  const f = await fixture(t, (request, { reply }) => {
    if (request.method === 'turn/start') { reply(request, { turn: { id: 'overview-turn' } }); return true; }
    return false;
  });
  await f.provider.connect();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const task = f.provider.run({ id: 'idle-overview', purpose: 'project-overview', text: 'Overview', images: [], webSearch: false, onText() {} });
  const rejected = assert.rejects(task, /больше двух минут/);
  await until(() => f.provider.running.get('idle-overview')?.turnId);
  const threadId = f.provider.running.get('idle-overview').threadId;
  t.mock.timers.tick(90_000);
  f.emit({ method: 'item/reasoning/textDelta', params: { threadId, turnId: 'other-turn', delta: 'foreign' } });
  t.mock.timers.tick(30_000); await rejected;
  assert.equal(f.provider.running.size, 0);
  const retry = f.provider.run({ id: 'retry', purpose: 'project-overview', text: 'Retry', images: [], webSearch: false, onText() {} });
  await until(() => f.provider.running.get('retry')?.turnId);
  const retryRun = f.provider.running.get('retry');
  f.emit({ method: 'item/completed', params: { threadId: retryRun.threadId, turnId: retryRun.turnId, item: { id: 'retry-answer', type: 'agentMessage', phase: 'final_answer', text: 'Готово' } } });
  f.emit({ method: 'turn/completed', params: { threadId: retryRun.threadId, turn: { id: 'overview-turn', status: 'completed' } } });
  await retry;
  assert.equal(f.provider.running.size, 0);
});

test('an ordinary active reply survives past sixty seconds and keeps a five-minute cap', async t => {
  const f = await fixture(t, (request, { reply, emit }) => {
    if (request.method !== 'turn/start') return false;
    reply(request, { turn: { id: 'ordinary-turn' } });
    return true;
  });
  await f.provider.connect();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const texts = [];
  const task = f.provider.run({ id: 'ordinary', text: 'Reply', images: [], webSearch: false, onText: text => texts.push(text) });
  await until(() => f.provider.running.get('ordinary')?.turnId);
  const run = f.provider.running.get('ordinary');
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(60_000);
    f.emit({ method: 'item/reasoning/textDelta', params: { threadId: run.threadId, turnId: run.turnId, delta: 'thinking' } });
  }
  assert.equal(f.provider.running.size, 1);
  const params = { threadId: run.threadId, turnId: run.turnId };
  f.emit({ method: 'item/started', params: { ...params, item: { id: 'answer', type: 'agentMessage', phase: 'final_answer' } } });
  f.emit({ method: 'item/agentMessage/delta', params: { ...params, itemId: 'answer', delta: 'Ответ готов' } });
  f.emit({ method: 'turn/completed', params: { ...params, turn: { status: 'completed' } } });
  await task;
  assert.equal(texts.at(-1), 'Ответ готов');
});
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Fixture protocol did not reach expected state");
    await tick();
  }
}

async function fixture(t, handle = () => false) {
  const root = await mkdtemp(path.join(tmpdir(), "callme-codex-protocol-test-"));
  const original = childProcess.spawn;
  const requests = [];
  const responses = [];
  let invocation;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.emit("exit", 0); return true; };
  const emit = value => child.stdout.write(Buffer.from(JSON.stringify(value) + "\n"));
  const reply = (request, result) => emit({ id: request.id, result });
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    for (const line of chunk.toString().trim().split("\n")) {
      const request = JSON.parse(line);
      if (!request.method) { responses.push(request); continue; }
      requests.push(request);
      queueMicrotask(() => {
        if (handle(request, { emit, reply, child })) return;
        if (request.method === "initialize") reply(request, {});
        else if (request.method === "account/read") reply(request, { account: { type: "chatgpt" } });
        else if (request.method === "thread/start") reply(request, { thread: { id: `thread-${request.id}` }, model: "fixture-model" });
        else if (request.id !== undefined) reply(request, {});
      });
    }
    callback();
  } });
  childProcess.spawn = (executable, args, options) => { invocation = { executable, args, options }; return child; };
  const provider = new CodexProvider(path.join(root, "codex-fixture.exe"), path.join(root, "isolated-home"), path.join(root, "workspace"));
  t.after(() => { provider.close(); childProcess.spawn = original; });
  return { provider, requests, responses, child, emit, root, invocation: () => invocation };
}

test("Codex launches an explicit isolated child and excludes inherited model credentials/config", async t => {
  const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CODEX_HOME", "CODEX_THREAD_ID", "CODEX_CONFIG", "NODE_OPTIONS"];
  const previous = keys.map(key => [key, process.env[key]]);
  for (const key of keys) process.env[key] = "fixture-only-do-not-inherit";
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const f = await fixture(t);
  assert.equal((await f.provider.connect()).state, "ready");
  const invocation = f.invocation();
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.equal(invocation.options.env.CODEX_HOME, path.join(f.root, "isolated-home"));
  for (const key of keys.filter(key => key !== "CODEX_HOME")) assert.equal(invocation.options.env[key], undefined, key);
  assert.ok(invocation.args.includes("features.shell_tool=false"));
  assert.ok(invocation.args.includes("features.apps=false"));
  assert.ok(invocation.args.includes("features.plugins=false"));
  assert.equal(f.requests[0].method, "initialize");
});

test("model catalogue filters unsafe/hidden IDs and explicit model effort reaches its own thread", async t => {
  const f = await fixture(t, (request, { reply, emit }) => {
    if (request.method === 'model/list') {
      reply(request, { data: [
        { id: 'alias', model: 'fixture-choice', displayName: 'Fixture choice', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }, { reasoningEffort: 'unexpected' }], defaultReasoningEffort: 'low' },
        { model: 'hidden-model', hidden: true }, { model: 'bad id' }
      ], nextCursor: null }); return true;
    }
    if (request.method === 'turn/start') {
      reply(request, { turn: { id: 'turn-model' } });
      emit({ method: 'item/completed', params: { threadId: request.params.threadId, turnId: 'turn-model', item: { id: 'model-answer', type: 'agentMessage', phase: 'final_answer', text: 'Готово' } } });
      emit({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { status: 'completed' } } }); return true;
    }
    return false;
  });
  const models = await f.provider.models();
  assert.equal(models.length, 1); assert.equal(models[0].id, 'fixture-choice');
  assert.deepEqual(models[0].reasoningEfforts, ['low', 'high']);
  await f.provider.run({ id: 'model-run', text: 'Fixture', images: [], webSearch: false, model: models[0].id, reasoningEffort: 'high', onText() {} });
  const start = f.requests.find(request => request.method === 'thread/start');
  assert.equal(start.params.model, 'fixture-choice');
  assert.equal(start.params.config.model_reasoning_effort, 'high');
});

test("split UTF-8 protocol chunks stream text and final answer replaces commentary", async t => {
  let finish;
  const f = await fixture(t, (request, tools) => {
    if (request.method !== "turn/start") return false;
    tools.reply(request, { turn: { id: "turn-fixture" } });
    const params = { threadId: request.params.threadId, turnId: "turn-fixture" };
    tools.emit({ method: "item/started", params: { ...params, item: { id: "commentary", type: "agentMessage", phase: "commentary" } } });
    tools.emit({ method: "item/agentMessage/delta", params: { ...params, itemId: "commentary", delta: "Проверяю" } });
    tools.emit({ method: "item/started", params: { ...params, item: { id: "answer", type: "agentMessage", phase: "final_answer" } } });
    const encoded = Buffer.from(JSON.stringify({ method: "item/agentMessage/delta", params: { ...params, itemId: "answer", delta: "Привет, мир" } }) + "\n");
    const cut = encoded.indexOf(Buffer.from("Привет")) + 1;
    tools.child.stdout.write(encoded.subarray(0, cut));
    tools.child.stdout.write(encoded.subarray(cut, cut + 3));
    tools.child.stdout.write(encoded.subarray(cut + 3));
    finish = () => {
      tools.emit({ method: "item/completed", params: { ...params, item: { id: "answer", type: "agentMessage", phase: "final_answer", text: "Привет, мир!" } } });
      tools.emit({ method: "turn/completed", params: { ...params, turn: { id: "turn-fixture", status: "completed" } } });
    };
    return true;
  });
  const texts = [];
  const task = f.provider.run({ id: "request-fixture", text: "Тест", images: [], webSearch: false, onText: text => texts.push(text) });
  await until(() => finish);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(texts.some(text => text.includes("Привет, мир")));
  assert.ok(texts.every(text => !text.includes("�")));
  finish(); await task;
  assert.equal(texts.at(-1), "Привет, мир!");
  const start = f.requests.find(request => request.method === "thread/start").params;
  assert.equal(start.approvalPolicy, "never");
  assert.equal(start.sandbox, "read-only");
  assert.equal(start.ephemeral, true);
  assert.equal(start.config.web_search, "disabled");
});

test("commentary is progress only and cannot become an answer on timeout", async t => {
  const f = await fixture(t, (request, { reply, emit }) => {
    if (request.method !== "turn/start") return false;
    reply(request, { turn: { id: "commentary-turn" } });
    const params = { threadId: request.params.threadId, turnId: "commentary-turn" };
    emit({ method: "item/started", params: { ...params, item: { id: "plan", type: "agentMessage", phase: "commentary" } } });
    emit({ method: "item/agentMessage/delta", params: { ...params, itemId: "plan", delta: "Проверю файлы…" } });
    return true;
  });
  await f.provider.connect();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const texts = [];
  const task = f.provider.run({ id: "commentary-only", text: "Тест", images: [], webSearch: false, onText: text => texts.push(text) });
  const rejected = assert.rejects(task, /не сообщает о прогрессе больше двух минут/);
  await until(() => f.provider.running.get("commentary-only")?.turnId);
  t.mock.timers.tick(120_000);
  await rejected;
  assert.deepEqual(texts, []);
});

test("legacy unphased completed agent message remains compatible at a successful terminal", async t => {
  const f = await fixture(t, (request, { reply, emit }) => {
    if (request.method !== "turn/start") return false;
    reply(request, { turn: { id: "legacy-turn" } });
    const params = { threadId: request.params.threadId, turnId: "legacy-turn" };
    emit({ method: "item/completed", params: { ...params, item: { id: "legacy-answer", type: "agentMessage", text: "Совместимый ответ" } } });
    emit({ method: "turn/completed", params: { ...params, turn: { status: "completed" } } });
    return true;
  });
  const texts = [];
  await f.provider.run({ id: "legacy", text: "Тест", images: [], webSearch: false, onText: text => texts.push(text) });
  assert.deepEqual(texts, ["Совместимый ответ"]);
});

test("a successful commentary-only turn rejects instead of exposing a plan", async t => {
  const f = await fixture(t, (request, { reply, emit }) => {
    if (request.method !== "turn/start") return false;
    reply(request, { turn: { id: "no-answer-turn" } });
    const params = { threadId: request.params.threadId, turnId: "no-answer-turn" };
    emit({ method: "item/completed", params: { ...params, item: { id: "plan", type: "agentMessage", phase: "commentary", text: "Проверю файлы…" } } });
    emit({ method: "turn/completed", params: { ...params, turn: { status: "completed" } } });
    return true;
  });
  const texts = [];
  await assert.rejects(f.provider.run({ id: "no-answer", text: "Тест", images: [], webSearch: false, onText: text => texts.push(text) }), /без ответа/);
  assert.deepEqual(texts, []);
});

test("approval and dynamic tool requests are denied without host execution", async t => {
  const f = await fixture(t);
  await f.provider.connect();
  f.emit({ id: "approval-fixture", method: "item/commandExecution/requestApproval", params: { command: "fixture-command" } });
  f.emit({ id: "tool-fixture", method: "item/tool/call", params: { tool: "read_local_fixture" } });
  await tick();
  assert.deepEqual(f.responses.find(response => response.id === "approval-fixture").result, { decision: "decline" });
  assert.equal(f.responses.find(response => response.id === "tool-fixture").error.code, -32601);
});

test("repository tools read only their active turn and reject a repeated or foreign call", async t => {
  let active;
  const f = await fixture(t, (request, tools) => {
    if (request.method !== "turn/start") return false;
    active = { threadId: request.params.threadId, turnId: "repo-turn" };
    tools.reply(request, { turn: { id: active.turnId } });
    tools.emit({ id: "repo-call", method: "item/tool/call", params: { ...active, callId: "read-1", tool: "repo_read", arguments: { path: "README.md", startLine: 1, limit: 3 } } });
    return true;
  });
  await writeFile(path.join(f.root, "README.md"), "REPOSITORY_LIVE_CONTENT");
  const progress = [];
  const references = [];
  const task = f.provider.run({ id: "repo-question", purpose: "project-overview", text: "Read README", images: [], webSearch: false, repositoryRoot: f.root, onText() {}, onProgress: p => progress.push(p), onRepositoryRead: value => references.push(value) });
  await until(() => f.responses.some(value => value.id === "repo-call"));
  const result = f.responses.find(value => value.id === "repo-call").result;
  assert.equal(result.success, true);
  assert.deepEqual(references, [{ path: 'README.md', startLine: 1, limit: 3 }]);
  assert(progress.some(p => p.stage === 'reading' && p.filesRead === 0));
  assert(progress.some(p => p.stage === 'analyzing' && p.filesRead === 1));
  f.emit({ id: 'read-again', method: 'item/tool/call', params: { ...active, callId: 'read-again', tool: 'repo_read', arguments: { path: 'README.md' } } });
  await until(() => f.responses.some(value => value.id === 'read-again'));
  assert.equal(progress.at(-1).filesRead, 1, 'Repeated range reads must not inflate the file counter');
  assert.deepEqual(references.at(-1), { path: 'README.md' });
  assert(result.contentItems[0].text.includes("REPOSITORY_LIVE_CONTENT"));
  const thread = f.requests.find(value => value.method === "thread/start").params;
  assert.deepEqual(thread.dynamicTools.map(tool => tool.name), ["repo_list", "repo_search", "repo_read"]);
  assert.equal(thread.config["features.shell_tool"], false);
  assert.equal(thread.sandbox, "read-only");
  f.emit({ id: "duplicate", method: "item/tool/call", params: { ...active, callId: "read-1", tool: "repo_read", arguments: { path: "README.md" } } });
  f.emit({ id: "foreign", method: "item/tool/call", params: { ...active, turnId: "other-turn", callId: "read-2", tool: "repo_read", arguments: { path: "README.md" } } });
  await until(() => f.responses.some(value => value.id === "duplicate") && f.responses.some(value => value.id === "foreign"));
  assert.equal(f.responses.find(value => value.id === "duplicate").result.success, false);
  assert.equal(f.responses.find(value => value.id === "foreign").error.code, -32601);
  f.emit({ method: "item/completed", params: { ...active, item: { id: "repo-answer", type: "agentMessage", phase: "final_answer", text: "Готово" } } });
  f.emit({ method: "turn/completed", params: { ...active, turn: { status: "completed" } } });
  await task;
});

test("cancel interrupts its own turn, rejects the request and permits a subsequent turn", async t => {
  let started = 0;
  let activeThread;
  const f = await fixture(t, (request, tools) => {
    if (request.method !== "turn/start") return false;
    started++; activeThread = request.params.threadId;
    tools.reply(request, { turn: { id: `turn-${started}` } });
    if (started === 2) {
      tools.emit({ method: "item/completed", params: { threadId: activeThread, turnId: "turn-2", item: { id: "next-answer", type: "agentMessage", phase: "final_answer", text: "Готово" } } });
      tools.emit({ method: "turn/completed", params: { threadId: activeThread, turn: { id: "turn-2", status: "completed" } } });
    }
    return true;
  });
  const task = f.provider.run({ id: "cancel-me", text: "Тест отмены", images: [], webSearch: false, onText() {} });
  const rejected = assert.rejects(task, /отменён/);
  await until(() => started);
  await tick();
  await f.provider.cancel("cancel-me"); await rejected;
  const interrupt = f.requests.find(request => request.method === "turn/interrupt");
  assert.deepEqual(interrupt.params, { threadId: activeThread, turnId: "turn-1" });
  await f.provider.run({ id: "next-request", text: "Следующий тест", images: [], webSearch: true, onText() {} });
  assert.equal(f.requests.filter(request => request.method === "thread/start").at(-1).params.config.web_search, "live");
});

test("protocol RPC errors and failed turns reject honestly and release request capacity", async t => {
  let count = 0;
  const f = await fixture(t, (request, tools) => {
    if (request.method !== "turn/start") return false;
    count++;
    if (count === 1) tools.emit({ id: request.id, error: { message: "Fixture RPC failure" } });
    else {
      tools.reply(request, { turn: { id: "failed-turn" } });
      tools.emit({ method: "turn/completed", params: { threadId: request.params.threadId, turn: { id: "failed-turn", status: "failed", error: { message: "Fixture turn failure" } } } });
    }
    return true;
  });
  const request = id => ({ id, text: "Тест ошибки", images: [], webSearch: false, onText() {} });
  await assert.rejects(f.provider.run(request("rpc-fails")), /Fixture RPC failure/);
  await assert.rejects(f.provider.run(request("turn-fails")), /Fixture turn failure/);
  assert.equal(count, 2);
});

test("untrusted login redirect is rejected without opening any browser", async t => {
  const f = await fixture(t, (request, tools) => {
    if (request.method !== "account/login/start") return false;
    tools.reply(request, { authUrl: "https://fixture.invalid/login" }); return true;
  });
  await assert.rejects(f.provider.login(), /Неизвестный адрес/);
});

test("closing during connect prevents a late child spawn and allows a clean retry", async t => {
  const f = await fixture(t);
  const connecting = f.provider.connect();
  const rejected = assert.rejects(connecting, /отменено/);
  f.provider.close();
  await rejected;
  assert.equal(f.invocation(), undefined);
  assert.equal((await f.provider.connect()).state, "ready");
  assert.ok(f.invocation());
});

test("late stdout, errors and exit from an obsolete child cannot break a replacement connection", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "callme-codex-generation-test-"));
  const original = childProcess.spawn;
  const children = [];
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; child.emit("exit", 0); return true; };
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      for (const line of chunk.toString().trim().split("\n")) {
        const request = JSON.parse(line);
        if (request.id === undefined) continue;
        queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result: request.method === "account/read" ? { account: { type: "chatgpt" } } : {} }) + "\n"));
      }
      callback();
    } });
    children.push(child);
    return child;
  };
  const provider = new CodexProvider(path.join(root, "fixture.exe"), path.join(root, "home"), path.join(root, "workspace"));
  t.after(() => { provider.close(); childProcess.spawn = original; });
  await provider.connect();
  provider.close();
  await provider.connect();
  assert.equal(children.length, 2);
  children[0].stdout.write("invalid stale protocol fixture\n");
  children[0].emit("error", new Error("obsolete child fixture"));
  children[0].emit("exit", 1);
  await tick();
  assert.equal(provider.status.state, "ready");
  assert.equal(children[1].killed, false);
});
