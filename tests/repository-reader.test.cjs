const { mkdtemp } = require('./temporary.cjs');
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdir, symlink, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const build = process.env.CALLME_TEST_BUILD || path.join(__dirname, "../dist-electron");
const { RepositoryReader, repositoryTools } = require(path.join(build, "repository-reader"));
const temporary = () => mkdtemp(path.join(tmpdir(), "callme-repository-reader-"));
const call = async (reader, tool, args) => JSON.parse(await reader.call(tool, args));

test("repository tools expose bounded DynamicToolSpec definitions", () => {
  assert.deepEqual(repositoryTools.map(tool => tool.name), ["repo_list", "repo_search", "repo_read"]);
  assert.ok(repositoryTools.every(tool => tool.type === "function" && tool.inputSchema.type === "object"));
});

test("cancelled repository access stops before opening a path", async () => {
  const root = await temporary();
  const abort = new AbortController(); abort.abort();
  const reader = new RepositoryReader(root, abort.signal);
  await assert.rejects(reader.call("repo_list", {}), /отменено/);
});

test("reader lists paginated paths and reads a live nested file beyond context-import limits", async () => {
  const root = await temporary();
  await mkdir(path.join(root, "src", "deep"), { recursive: true });
  await Promise.all(Array.from({ length: 205 }, (_, index) => writeFile(path.join(root, `file-${String(index).padStart(3, "0")}.txt`), `file ${index}`)));
  await writeFile(path.join(root, "src", "deep", "high-index.ts"), "export const state = 'before';\n");
  const reader = new RepositoryReader(root);
  const first = await call(reader, "repo_list", { offset: 0 });
  const second = await call(reader, "repo_list", { offset: 200 });
  assert.equal(first.entries.length, 200);
  assert.equal(first.nextOffset, 200);
  assert.ok(second.entries.length >= 6);
  const before = await call(reader, "repo_read", { path: "src/deep/high-index.ts" });
  assert.match(before.lines[0].text, /before/);
  await writeFile(path.join(root, "src", "deep", "high-index.ts"), "export const state = 'after';\n");
  const after = await call(reader, "repo_read", { path: "src/deep/high-index.ts" });
  assert.match(after.lines[0].text, /after/);
  assert.ok(!JSON.stringify(after).includes(root));
});

test("reader rejects traversal, sensitive, binary and skipped paths without exposing host paths", async () => {
  const root = await temporary();
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, "safe.txt"), "safe"), writeFile(path.join(root, ".env"), "TOKEN=secret"),
    writeFile(path.join(root, "binary.txt"), Buffer.from([0, 1, 2])), writeFile(path.join(root, "secret.pem"), "private"),
    writeFile(path.join(root, "node_modules", "dep.js"), "ignored")
  ]);
  const reader = new RepositoryReader(root);
  for (const value of ["../safe.txt", "C:/Windows/win.ini", "//server/share/file.txt", ".env", "binary.txt", "secret.pem", "node_modules"]) {
    await assert.rejects(reader.call("repo_read", { path: value }), error => !String(error.message).includes(root));
  }
});

test("reader rejects a symlink that points outside the chosen repository", async t => {
  const root = await temporary();
  const outside = await temporary();
  await writeFile(path.join(outside, "outside.txt"), "outside");
  try { await symlink(path.join(outside, "outside.txt"), path.join(root, "link.txt"), "file"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("Windows does not permit test symlinks in this environment");
    throw error;
  }
  const reader = new RepositoryReader(root);
  await assert.rejects(reader.call("repo_read", { path: "link.txt" }), /Ссылки|недоступен/);
});

test("reader rejects a pre-existing Windows directory junction outside the chosen root", async t => {
  const root = await temporary();
  const outside = await temporary();
  await writeFile(path.join(outside, "outside.txt"), "outside");
  try { await symlink(outside, path.join(root, "junction"), "junction"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP", "EINVAL"].includes(error.code)) return t.skip("Windows does not permit junction fixtures in this environment");
    throw error;
  }
  const reader = new RepositoryReader(root);
  await assert.rejects(reader.call("repo_list", { path: "junction" }), /Ссылки|недоступен/);
  await assert.rejects(reader.call("repo_search", { query: "outside", path: "junction" }), /Ссылки|недоступен/);
});

test("literal searches are scoped, bounded and omit generated or sensitive trees", async () => {
  const root = await temporary();
  await Promise.all([mkdir(path.join(root, "src"), { recursive: true }), mkdir(path.join(root, "credentials"), { recursive: true }), mkdir(path.join(root, "dist"), { recursive: true })]);
  await Promise.all(Array.from({ length: 81 }, (_, index) => writeFile(path.join(root, "src", `match-${index}.ts`), `const needle = ${index};`)));
  await Promise.all([
    writeFile(path.join(root, "credentials", "leak.txt"), "needle"), writeFile(path.join(root, "dist", "generated.js"), "needle"),
    writeFile(path.join(root, "src", "named-feature.ts"), "irrelevant")
  ]);
  const reader = new RepositoryReader(root);
  const textMatches = await call(reader, "repo_search", { query: "needle", mode: "text" });
  assert.equal(textMatches.matches.length, 80);
  assert.equal(textMatches.truncated, true);
  assert.ok(textMatches.matches.every(match => match.path.startsWith("src/")));
  const names = await call(reader, "repo_search", { query: "FEATURE", mode: "filename", path: "src" });
  assert.deepEqual(names.matches.map(match => match.path), ["src/named-feature.ts"]);
  await assert.rejects(reader.call("repo_search", { query: "needle", path: "credentials" }), /недоступен/);
});

test("read line and byte limits are enforced", async () => {
  const root = await temporary();
  await writeFile(path.join(root, "many.txt"), Array.from({ length: 250 }, (_, index) => `line-${index + 1}`).join("\n"));
  const reader = new RepositoryReader(root);
  const response = await call(reader, "repo_read", { path: "many.txt", startLine: 40, limit: 200 });
  assert.equal(response.lines.length, 200);
  assert.equal(response.lines[0].number, 40);
  assert.equal(response.lines.at(-1).number, 239);
  await assert.rejects(reader.call("repo_read", { path: "many.txt", limit: 201 }), /limit/);
});
