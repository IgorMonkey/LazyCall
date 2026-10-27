const { mkdtemp } = require('./temporary.cjs');
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdir, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const build = process.env.CALLME_TEST_BUILD || path.join(__dirname, "../dist-electron");
const { ProjectKnowledgeStore, fingerprintContext } = require(path.join(build, "project-knowledge"));
const temporary = () => mkdtemp(path.join(tmpdir(), "callme-project-knowledge-"));

test("uploaded display names are separate from verified repository source paths", async () => {
  const root = await temporary();
  const store = new ProjectKnowledgeStore(path.join(root, 'knowledge'));
  const fingerprint = fingerprintContext('context');
  await store.saveBrief('Uploaded README is not repository README', fingerprint, ['README.md']);
  assert.equal((await store.load()).brief.repositoryFiles, undefined, 'Legacy/uploaded names must not imply repository reads');
  await store.saveBrief('Checked contract', fingerprint, ['README.md', 'src/contract.ts'], ['src/contract.ts']);
  assert.deepEqual((await new ProjectKnowledgeStore(path.join(root, 'knowledge')).load()).brief.repositoryFiles, ['src/contract.ts']);
  await assert.rejects(store.saveBrief('Invalid provenance', fingerprint, [], ['../outside.md']), /относительных файлов/);
  assert.equal((await store.load()).brief.text, 'Checked contract');
});

test("knowledge persists a selected local folder and bounded brief across reload", async () => {
  const root = await temporary();
  const source = path.join(root, "chosen");
  await mkdir(source);
  const store = new ProjectKnowledgeStore(path.join(root, "owned", "knowledge"));
  assert.deepEqual(await store.load(), { folder: null, brief: null });
  const bound = await store.bindFolder(source);
  assert.deepEqual(bound.folder, { name: "chosen", path: source, available: true });
  const fingerprint = fingerprintContext("Цель\nФайл: src/app.ts");
  await store.saveBrief("Краткое описание", fingerprint, ["README.md", "src/app.ts"]);
  const reloaded = new ProjectKnowledgeStore(path.join(root, "owned", "knowledge"));
  const loaded = await reloaded.load(fingerprint);
  assert.equal(loaded.brief.text, "Краткое описание");
  assert.equal(loaded.brief.stale, false);
  assert.deepEqual(loaded.brief.files, ["README.md", "src/app.ts"]);
  const edited = await reloaded.editBrief("Исправленный текст");
  assert.equal(edited.brief.text, "Исправленный текст");
  assert.equal(edited.brief.generatedAt, loaded.brief.generatedAt);
  assert.equal(edited.brief.fingerprint, fingerprint);
});

test("knowledge marks stale from a supplied current fingerprint without replacing its saved brief", async () => {
  const root = await temporary();
  const store = new ProjectKnowledgeStore(path.join(root, "knowledge"));
  const original = fingerprintContext("first\r\ncontext");
  assert.equal(original, fingerprintContext("first\ncontext"));
  await store.saveBrief("Brief", original, []);
  const stale = await store.markStale(fingerprintContext("second context"));
  assert.equal(stale.brief.stale, true);
  assert.equal((await store.load()).brief.stale, false);
});

test("missing selected folder remains visible as unavailable and folderPath explains it", async () => {
  const root = await temporary();
  const source = path.join(root, "chosen");
  await mkdir(source);
  const store = new ProjectKnowledgeStore(path.join(root, "knowledge"));
  await store.bindFolder(source);
  await rm(source, { recursive: true, force: true });
  assert.equal((await store.load()).folder.available, false);
  await assert.rejects(store.folderPath(), /недоступна/);
});

test("knowledge rejects malformed metadata and invalid brief paths without overwriting valid state", async () => {
  const root = await temporary();
  const own = path.join(root, "knowledge");
  await mkdir(own, { recursive: true });
  await writeFile(path.join(own, "knowledge.json"), "not json");
  await assert.rejects(new ProjectKnowledgeStore(own).load(), /Повреждены/);
  const valid = new ProjectKnowledgeStore(path.join(root, "valid"));
  const fingerprint = fingerprintContext("context");
  await valid.saveBrief("Valid", fingerprint, ["src/app.ts"]);
  await assert.rejects(valid.saveBrief("bad", fingerprint, ["../escape.ts"]), /относительных/);
  assert.equal((await valid.load()).brief.text, "Valid");
  await assert.rejects(valid.bindFolder("relative"), /диалог/);
});

test("changing or disconnecting a repository clears its previous brief", async () => {
  const root = await temporary();
  const first = path.join(root, "first"), second = path.join(root, "second");
  await mkdir(first); await mkdir(second);
  const store = new ProjectKnowledgeStore(path.join(root, "knowledge"));
  await store.bindFolder(first);
  await store.saveBrief("First repo overview", fingerprintContext("first"), []);
  assert.equal((await store.bindFolder(first)).brief.text, "First repo overview");
  assert.equal((await store.bindFolder(second)).brief, null);
  await store.saveBrief("Second repo overview", fingerprintContext("second"), []);
  const disconnected = await store.unbindFolder();
  assert.equal(disconnected.folder, null);
  assert.equal(disconnected.brief, null);
});
