const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, mkdir, writeFile, unlink, symlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const build = process.env.CALLME_TEST_BUILD || path.join(__dirname, "../dist-electron");
const { scanContextFolder, resolveContextSelection, suggestContextFiles } = require(path.join(build, "folder-context"));
const { ProjectContextStore } = require(path.join(build, "context-store"));
const temporary = () => mkdtemp(path.join(tmpdir(), "callme-folder-context-"));

test("folder scan is deterministic and skips hidden, sensitive, binary and generated trees", async () => {
  const root = await temporary();
  await Promise.all([
    mkdir(path.join(root, "docs"), { recursive: true }), mkdir(path.join(root, "src"), { recursive: true }),
    mkdir(path.join(root, ".git"), { recursive: true }), mkdir(path.join(root, "node_modules", "dep"), { recursive: true }), mkdir(path.join(root, "credentials"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(root, "README.md"), "# Readme"), writeFile(path.join(root, "docs", "guide.md"), "Guide"),
    writeFile(path.join(root, "package.json"), "{}"), writeFile(path.join(root, "src", "app.ts"), "export {}"),
    writeFile(path.join(root, ".env"), "TOKEN=no"), writeFile(path.join(root, "secret-key.txt"), "no"),
    writeFile(path.join(root, "image.png"), "not text"), writeFile(path.join(root, "binary.txt"), Buffer.from([0, 1, 2])),
    writeFile(path.join(root, ".git", "config"), "ignored"), writeFile(path.join(root, "node_modules", "dep", "index.js"), "ignored"), writeFile(path.join(root, "credentials", "config.json"), "ignored")
  ]);
  const preview = await scanContextFolder(root);
  assert.deepEqual(preview.files.map(file => file.name), ["README.md", "docs/guide.md", "package.json", "src/app.ts"]);
  assert.ok(preview.files.every(file => path.isAbsolute(file.path)));
  assert.equal(preview.truncated, false);
});

test("folder suggestions prioritize project orientation and a bounded topic match deterministically", async () => {
  const root = await temporary();
  await Promise.all([mkdir(path.join(root, "docs"), { recursive: true }), mkdir(path.join(root, "src"), { recursive: true })]);
  await Promise.all([
    writeFile(path.join(root, "README.md"), "# Project"), writeFile(path.join(root, "docs", "architecture.md"), "Components"),
    writeFile(path.join(root, "package.json"), "{}"), writeFile(path.join(root, "src", "billing.ts"), "export const платежи = true"),
    writeFile(path.join(root, "src", "view.ts"), "export const view = true")
  ]);
  const preview = await scanContextFolder(root, "обсудить платежи");
  assert.equal(preview.files[0].name, "src/billing.ts");
  assert.equal(preview.files[0].recommended, true);
  assert.match(preview.files[0].reason, /платеж/);
  assert.ok(preview.files.find(file => file.name === "README.md").recommended);
  const again = suggestContextFiles(preview.files, "обсудить платежи");
  assert.deepEqual(again.map(file => file.name), preview.files.map(file => file.name));
});

test("Russian topics match common English repository names", async () => {
  const root = await temporary();
  await writeFile(path.join(root, 'search.ts'), 'export const findTicket = true;');
  await writeFile(path.join(root, 'unrelated.ts'), 'export const value = true;');
  const preview = await scanContextFolder(root, 'Обсудить поиск заявок');
  assert.equal(preview.files.find(file => file.name === 'search.ts').recommended, true);
  assert.equal(preview.files.find(file => file.name === 'unrelated.ts').recommended, false);
});

test("folder scan caps aggregate inspected bytes", async () => {
  const root = await temporary();
  await Promise.all(Array.from({ length: 12 }, (_, index) => writeFile(path.join(root, `large-${index}.md`), "x".repeat(200 * 1024))));
  const preview = await scanContextFolder(root);
  assert.equal(preview.files.length, 10);
  assert.equal(preview.truncated, true);
});

test("folder scan stops at its candidate bound and selection retains POSIX nested names", async () => {
  const root = await temporary();
  for (let index = 0; index < 125; index++) await writeFile(path.join(root, `file-${String(index).padStart(3, "0")}.txt`), "fixture");
  const preview = await scanContextFolder(root);
  assert.equal(preview.files.length, 120);
  assert.equal(preview.truncated, true);
  const selected = await resolveContextSelection(root, preview.files, [preview.files[0].id]);
  assert.deepEqual(selected.relativeNames, [preview.files[0].name]);
  assert.equal(selected.paths.length, 1);
});

test("selection rejects an unknown ID and a file changed into a link after preview", async t => {
  const root = await temporary();
  const source = path.join(root, "nested", "note.md");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "safe");
  const preview = await scanContextFolder(root);
  await assert.rejects(resolveContextSelection(root, preview.files, ["not-an-id"]), /выбор|Выберите/);
  const outside = path.join(root, "outside.md");
  await writeFile(outside, "outside");
  await unlink(source);
  try { await symlink(outside, source, "file"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Windows does not permit test symlinks in this environment");
    throw error;
  }
  await assert.rejects(resolveContextSelection(root, preview.files, [preview.files[0].id]), /Ссылки|больше не подходит/);
});

test("nested folder imports persist relative paths without changing manual names", async () => {
  const root = await temporary();
  const folder = path.join(root, "project");
  const source = path.join(folder, "src", "feature", "plan.md");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "Начало плана\n" + "данные ".repeat(9_000) + "\nКОНЕЦ ПОЛНОГО КОНТЕКСТА");
  const preview = await scanContextFolder(folder);
  const selected = await resolveContextSelection(folder, preview.files, [preview.files[0].id]);
  const store = new ProjectContextStore(path.join(root, "owned"));
  const imported = await store.addFiles(selected.paths, selected.relativeNames);
  await store.setGoal("Цель конкретной встречи");
  assert.deepEqual(imported.files.map(file => ({ name: file.name, relativePath: file.relativePath })), [{ name: "plan.md", relativePath: "src/feature/plan.md" }]);
  const loaded = await new ProjectContextStore(path.join(root, "owned")).load();
  assert.equal(loaded.files[0].relativePath, "src/feature/plan.md");
  assert.match(await store.text(), /Файл: src\/feature\/plan.md/);
  const exported = await store.exportText();
  assert.match(exported, /Файл: src\/feature\/plan.md/);
  assert.match(exported, /SHA-256: [a-f0-9]{64}/);
  assert.match(exported, /КОНЕЦ ПОЛНОГО КОНТЕКСТА/);
  assert.ok(!(await store.exportText(false)).includes("Цель конкретной встречи"));
  await assert.rejects(store.addFiles([source], ["../plan.md"]), /относительный путь/);
});

test("folder refresh replaces only folder copies and validates the complete replacement first", async () => {
  const root = await temporary();
  const manual = path.join(root, "manual.txt");
  const oldFolder = path.join(root, "old.md");
  const nextFolder = path.join(root, "next.md");
  const oversized = path.join(root, "too-big.md");
  await Promise.all([
    writeFile(manual, "ручной файл"), writeFile(oldFolder, "старый файл папки"), writeFile(nextFolder, "новый файл папки"),
    writeFile(oversized, "x".repeat(200 * 1024 + 1))
  ]);
  const store = new ProjectContextStore(path.join(root, "owned"));
  await store.addFiles([manual]);
  const initial = await store.replaceFolderFiles([oldFolder], ["docs/old.md"]);
  const old = initial.files.find(file => file.relativePath === "docs/old.md");
  const same = await store.replaceFolderFiles([oldFolder], ["docs/old.md"]);
  assert.equal(same.files.find(file => file.relativePath === "docs/old.md").id, old.id);
  const refreshed = await store.replaceFolderFiles([nextFolder], ["docs/next.md"]);
  assert.deepEqual(refreshed.files.map(file => [file.name, file.relativePath]), [["manual.txt", undefined], ["next.md", "docs/next.md"]]);
  await assert.rejects(store.replaceFolderFiles([nextFolder, oversized], ["docs/next.md", "docs/too-big.md"]), /200 КБ/);
  const unchanged = await store.load();
  assert.deepEqual(unchanged.files.map(file => [file.name, file.relativePath]), [["manual.txt", undefined], ["next.md", "docs/next.md"]]);
  assert.ok(old.id);
  assert.deepEqual((await new ProjectContextStore(path.join(root, "owned")).load()).files.map(file => file.relativePath), [undefined, "docs/next.md"]);
  const cleared = await store.replaceFolderFiles([], []);
  assert.deepEqual(cleared.files.map(file => file.name), ["manual.txt"], "Connecting live repository must discard only old folder snapshots");
  assert.equal((await new ProjectContextStore(path.join(root, "owned")).load()).files.length, 1);
});
