const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, appendFile, readFile, readdir, truncate } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const build = process.env.CALLME_TEST_BUILD || path.join(__dirname, "../dist-electron");
const { Journal } = require(path.join(build, "journal"));
const { MeetingStore } = require(path.join(build, "meeting-store"));
const { ProjectContextStore } = require(path.join(build, "context-store"));
const temporary = () => mkdtemp(path.join(tmpdir(), "callme-persistence-test-"));

test('flushing before an update leaves the current journal writable if installation is rejected', async () => {
  const root = await temporary();
  const journal = new Journal();
  const id = await journal.start(root);
  await journal.append('fixture.before-update', { text: 'saved' });
  await journal.flush();
  await journal.append('fixture.after-rejected-update', { text: 'still writable' });
  await journal.close();
  const rows = (await readFile(path.join(root, id, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.type), ['fixture.before-update', 'fixture.after-rejected-update']);
});

test("interrupted meeting recovery preserves transcript, notes, assistant upserts and sequence", async () => {
  const root = await temporary();
  const journal = new Journal();
  const id = await journal.start(root);
  await journal.append("session.started", { id, startedAt: "2026-10-25T10:00:00.000Z" });
  await journal.append("transcript.final", { id: "line-1", source: "self", startMs: 10, endMs: 50, text: "Тестовая реплика" });
  await journal.append("note.edited", { text: "Первый черновик" });
  await journal.append("context.goal", { goal: "Проверить поиск" });
  const message = { id: "message-1", role: "assistant", text: "Начало", state: "streaming", kind: "answer", createdAt: 1 };
  await journal.append("assistant.message", message);
  await journal.append("assistant.message", { ...message, text: "Готовый ответ", state: "done" });
  await journal.append("assistant.message", { ...message, id: "interrupted-message" });
  await journal.close();
  const file = path.join(root, id, "events.jsonl");
  await appendFile(file, '{"schemaVersion":1,"seq":8,"payload":"незавершённая');
  const store = new MeetingStore(root);
  const recovered = await store.load(id);
  assert.equal(recovered.meeting.interrupted, true);
  assert.equal(recovered.meeting.title, "Проверить поиск");
  assert.equal(recovered.note, "Первый черновик");
  assert.equal(recovered.lines[0].text, "Тестовая реплика");
  assert.deepEqual(recovered.messages.map(m => [m.text, m.state]), [["Готовый ответ", "done"], ["Начало", "error"]]);
  await journal.open(root, id);
  await journal.append("note.edited", { text: "Дополнено после восстановления" });
  await journal.append("session.stopped", { endedAt: "2026-10-25T10:05:00.000Z" });
  await journal.close();
  const events = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map(event => event.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const finished = await store.load(id);
  assert.equal(finished.note, "Дополнено после восстановления");
  assert.equal(finished.meeting.interrupted, false);
  assert.equal((await store.list())[0].id, id);
});

test("reopening a complete final event without newline keeps the event intact", async () => {
  const root = await temporary();
  const journal = new Journal();
  const id = await journal.start(root);
  await journal.append("session.started", { id, startedAt: new Date().toISOString() });
  await journal.close();
  const file = path.join(root, id, "events.jsonl");
  const bytes = await readFile(file);
  await truncate(file, bytes.length - 1);
  await journal.open(root, id);
  await journal.append("note.edited", { text: "Добавление" });
  await journal.close();
  assert.equal((await new MeetingStore(root).load(id)).note, "Добавление");
});

test("meeting paths reject traversal and complete corruption is not silently repaired", async () => {
  const root = await temporary();
  const store = new MeetingStore(root);
  await assert.rejects(store.load("../other"), /идентификатор/);
  await assert.rejects(new Journal().open(root, "..\\other"), /идентификатор/);
  const journal = new Journal();
  const id = await journal.start(root);
  await journal.append("session.started", { id, startedAt: new Date().toISOString() });
  await journal.close();
  const file = path.join(root, id, "events.jsonl");
  await appendFile(file, 'broken complete row\n');
  const original = await readFile(file);
  await assert.rejects(store.load(id), /Повреждён журнал/);
  await assert.rejects(journal.open(root, id), /Повреждён журнал/);
  assert.deepEqual(await readFile(file), original);
});

test("closing a journal flushes accepted writes and refuses new writes", async () => {
  const root = await temporary();
  const journal = new Journal();
  const id = await journal.start(root);
  const writes = Array.from({ length: 20 }, (_, index) => journal.append("note.edited", { text: `note ${index}` }));
  const closing = journal.close();
  await assert.rejects(journal.append("note.edited", { text: "too late" }), /не открыт/);
  await Promise.all([...writes, closing]);
  const events = (await readFile(path.join(root, id, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(events.length, 20);
  assert.equal(events.at(-1).payload.text, "note 19");
});

test("project context snapshots selected files and persists serialized edits without source paths", async () => {
  const root = await temporary();
  const source = path.join(root, "requirements.md");
  await writeFile(source, "Заявки: поиск по номеру.\nНужен точный результат.");
  const contextRoot = path.join(root, "owned-context");
  const store = new ProjectContextStore(contextRoot);
  await Promise.all([store.setGoal("Проверка номера"), store.addFiles([source])]);
  const loaded = await new ProjectContextStore(contextRoot).load();
  assert.equal(loaded.goal, "Проверка номера");
  assert.equal(loaded.files.length, 1);
  assert.equal(loaded.files[0].name, "requirements.md");
  await writeFile(source, "Изменённый исходный файл");
  const text = await store.text("поиск");
  assert.match(text, /Заявки: поиск по номеру/);
  assert.match(text, /SHA-256: [a-f0-9]{64}/);
  assert.ok(!text.includes(root));
  assert.ok(!(await readFile(path.join(contextRoot, "context.json"), "utf8")).includes(source));
  await store.removeFile(loaded.files[0].id);
  assert.equal((await store.load()).files.length, 0);
  assert.equal((await readdir(contextRoot)).filter(name => name.endsWith(".txt")).length, 0);
  await assert.rejects(store.removeFile("../requirements"), /идентификатор/);
});

test("context rejects sensitive names, invalid UTF-8, binary data, unsupported and oversized files atomically", async () => {
  const root = await temporary();
  const store = new ProjectContextStore(path.join(root, "owned"));
  const fixtures = [
    [".env", Buffer.from("TOKEN=fixture"), /учётными/],
    ["client-credentials.json", Buffer.from("{}"), /учётными/],
    ["picture.png", Buffer.from("image"), /формат/],
    ["invalid.txt", Buffer.from([0xc3, 0x28]), /UTF-8/],
    ["binary.txt", Buffer.from([0, 1, 2]), /Двоичные/],
    ["oversized.md", Buffer.alloc(200 * 1024 + 1, 32), /200 КБ/],
    ["private.md", Buffer.from("-----BEGIN RSA PRIVATE KEY-----\nfixture"), /закрытыми ключами/]
  ];
  for (const [name, bytes, pattern] of fixtures) {
    const source = path.join(root, name);
    await writeFile(source, bytes);
    await assert.rejects(store.addFiles([source]), pattern);
  }
  const good = path.join(root, "good.txt");
  await writeFile(good, "Разрешённый текст");
  await assert.rejects(store.addFiles([good, path.join(root, "binary.txt")]), /Двоичные/);
  assert.deepEqual(await store.load(), { goal: "", files: [] });
  await assert.rejects(store.addFiles(["relative.md"]), /диалог/);
});

test("context enforces count and total bounds, returns relevant bounded excerpts and detects snapshot tampering", async () => {
  const root = await temporary();
  const store = new ProjectContextStore(path.join(root, "owned"));
  const sources = [];
  for (let index = 0; index < 6; index++) {
    const source = path.join(root, `file-${index}.txt`);
    await writeFile(source, "a".repeat(190 * 1024));
    sources.push(source);
  }
  await assert.rejects(store.addFiles(sources), /1 МБ/);
  await assert.rejects(store.addFiles(Array(17).fill(sources[0])), /16/);
  await writeFile(sources[0], "a".repeat(15_000) + "\nУникальное требование: SEARCH_MATCH\n" + "b".repeat(10_000));
  const state = await store.addFiles(sources.slice(0, 4));
  const text = await store.text("SEARCH_MATCH");
  assert.match(text, /SEARCH_MATCH/);
  assert.ok(text.length < 45_000);
  await writeFile(path.join(root, "owned", `${state.files[0].id}.txt`), "Изменено");
  await assert.rejects(store.text(), /Изменена копия/);
});
