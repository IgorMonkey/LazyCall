const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, mkdir, symlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const build = process.env.CALLME_TEST_BUILD || path.join(__dirname, "../dist-electron");
const { ProjectStore } = require(path.join(build, "project-store"));
const { MeetingStore } = require(path.join(build, "meeting-store"));
const { Journal } = require(path.join(build, "journal"));
const { validateResults, parseGeneratedResults, mergeGeneratedResults, formatResultsMarkdown } = require(path.join(build, "results"));
const temporary = () => mkdtemp(path.join(tmpdir(), "callme-projects-results-"));
const session = "f0f9c835-85e3-4aee-a171-7ba04e66b474";
const line = { id: "line-a", source: "self", startMs: 65_000, endMs: 66_000, text: "Решили отправить отчёт." };
const item = (overrides = {}) => ({ id: "4bd8c417-d4f6-4200-bf6b-89e674cdb7e2", type: "decision", text: "Отправить отчёт", evidenceIds: ["line-a"], status: "confirmed", author: "user", assignee: "Ирина", dueDate: "2026-10-30", ...overrides });

test("projects persist selection and keep contexts isolated", async () => {
  const root = await temporary();
  const projects = new ProjectStore(path.join(root, "projects"));
  const alpha = await projects.create({ name: "  Альфа  ", description: "Первый проект" });
  const beta = await projects.create({ name: "Бета", description: "Второй проект" });
  assert.equal(alpha.name, "Альфа");
  await projects.context(alpha.id).setGoal("Цель Альфы");
  await projects.context(beta.id).setGoal("Цель Беты");
  await projects.select(alpha.id);
  const reloaded = new ProjectStore(path.join(root, "projects"));
  assert.equal(await reloaded.selected(), alpha.id);
  assert.equal((await reloaded.get(alpha.id)).description, "Первый проект");
  assert.equal((await reloaded.context(alpha.id).load()).goal, "Цель Альфы");
  assert.equal((await reloaded.context(beta.id).load()).goal, "Цель Беты");
  await assert.rejects(reloaded.get("../outside"), /идентификатор/);
  await assert.rejects(reloaded.create({ name: " ", description: "" }), /данные/);
  await assert.rejects(reloaded.update(alpha.id, { name: "x".repeat(101), description: "" }), /данные/);
});

test("project metadata rejects malformed state and metadata instead of accepting it", async () => {
  const root = await temporary();
  const directory = path.join(root, "projects");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "state.json"), "not json");
  await assert.rejects(new ProjectStore(directory).selected(), /состояние/);
  const store = new ProjectStore(path.join(root, "valid"));
  const project = await store.create({ name: "Проект", description: "" });
  await writeFile(path.join(root, "valid", project.id, "project.json"), JSON.stringify({ id: project.id, name: "", description: "", createdAt: "bad", updatedAt: "bad" }));
  await assert.rejects(store.get(project.id), /Повреждены/);
});

test("project context refuses a linked context directory", async t => {
  const root = await temporary();
  const store = new ProjectStore(path.join(root, "projects"));
  const project = await store.create({ name: "Проект", description: "" });
  const outside = path.join(root, "outside");
  await mkdir(outside);
  try { await symlink(outside, path.join(root, "projects", project.id, "context"), "junction"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Windows does not permit test junctions in this environment");
    throw error;
  }
  await assert.rejects(store.context(project.id).load(), /Ссылка вместо папки/);
});

test("results validate revisions and generated items require existing evidence", () => {
  const current = validateResults({ sessionId: session, revision: 0, items: [] }, session, [line]);
  assert.equal(current.revision, 0);
  assert.throws(() => parseGeneratedResults(JSON.stringify({ summary: " ", items: [] }), [line]), /не составил/);
  assert.deepEqual(parseGeneratedResults(JSON.stringify({ summary: "Обсудили образование облаков; договорённостей не было.", items: [] }), [line]).items, []);
  assert.throws(() => validateResults({ sessionId: session, revision: 1.5, items: [] }, session, [line]), /итоги/);
  assert.throws(() => validateResults({ sessionId: session, revision: 1, items: [item({ evidenceIds: ["missing"] })] }, session, [line]), /ссылки/);
  assert.throws(() => parseGeneratedResults(JSON.stringify({ summary: "Итог", items: [{ type: "task", text: "Сделать", evidenceIds: ["missing"], assignee: "", dueDate: "" }] }), [line]), /ссылки/);
  const generated = parseGeneratedResults("```json\n" + JSON.stringify({ summary: "Итог", items: [{ type: "task", text: "Сделать", evidenceIds: ["line-a"], assignee: "", dueDate: "" }] }) + "\n```", [line]);
  assert.equal(generated.items[0].author, "assistant");
  assert.equal(generated.items[0].status, "draft");
  assert.match(generated.items[0].id, /^[0-9a-f-]{36}$/i);
});

test("generated merging preserves manual and rejected items and markdown exposes them", () => {
  const manual = item({ status: "rejected", author: "user" });
  const current = { sessionId: session, revision: 7, items: [manual] };
  const duplicate = { ...item({ id: "f2d9a96c-b8a4-4b80-9981-d063321090d4", status: "draft", author: "assistant", text: " отправить   отчёт " }) };
  const newItem = item({ id: "19819613-2adb-4267-8f52-a81861d517cb", type: "task", text: "Проверить цифры", status: "draft", author: "assistant" });
  const merged = mergeGeneratedResults(current, [duplicate, newItem]);
  assert.equal(merged.revision, 8);
  assert.deepEqual(merged.items, [manual, newItem]);
  const markdown = formatResultsMarkdown(merged, [line]);
  assert.match(markdown, /Отклонено/);
  assert.match(markdown, /01:05/);
  assert.match(markdown, /Проверить цифры/);
});

test("meeting journals load old sessions and enforce sequential validated result edits", async () => {
  const root = await temporary();
  const journal = new Journal();
  const id = await journal.start(root);
  await journal.append("session.started", { id, startedAt: "2026-10-25T10:00:00.000Z" });
  await journal.append("session.project", { id: null });
  await journal.append("transcript.final", line);
  await journal.append("results.edited", { sessionId: id, revision: 1, items: [item({ id: "a65b3e5b-0642-4b4f-b7ed-bfb2259c6512" })] });
  await journal.close();
  const loaded = await new MeetingStore(root).load(id);
  assert.equal(loaded.results.revision, 1);
  assert.equal(loaded.results.items.length, 1);

  const old = await journal.start(root);
  await journal.append("session.started", { id: old, startedAt: "2026-10-25T10:00:00.000Z" });
  await journal.close();
  assert.deepEqual((await new MeetingStore(root).load(old)).results, { sessionId: old, revision: 0, items: [] });

  const bad = await journal.start(root);
  await journal.append("session.started", { id: bad, startedAt: "2026-10-25T10:00:00.000Z" });
  await journal.append("results.edited", { sessionId: bad, revision: 2, items: [] });
  await journal.close();
  await assert.rejects(new MeetingStore(root).load(bad), /версия/);
});
