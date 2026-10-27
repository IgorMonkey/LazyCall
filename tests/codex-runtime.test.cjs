const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const { discoverCodexRuntime, inspectCodexExecutable, knownCodexCandidates, versionProbeEnvironment } = require("../dist-electron/codex-runtime.js");

function pe(machine = 0x8664) {
  const header = Buffer.alloc(512);
  header.write("MZ", 0, "ascii");
  header.writeUInt32LE(0x80, 0x3c);
  header.write("PE\0\0", 0x80, "binary");
  header.writeUInt16LE(machine, 0x84);
  return header;
}

function inspectOptions(version) {
  return { readHeader: async () => pe(), runVersion: async () => version };
}

test("accepts a native x64 Codex executable at the minimum supported version", async () => {
  const executable = path.resolve("C:/Tools/Codex/codex.exe");
  assert.deepEqual(await inspectCodexExecutable(executable, inspectOptions("codex 0.145.0\n")), {
    executable, version: "0.145.0", source: "installed"
  });
});

test("refuses command wrappers, non-x64 files, unsupported versions and raw probe errors", async () => {
  assert.match((await inspectCodexExecutable(path.resolve("C:/Tools/Codex/codex.cmd"), inspectOptions("codex 0.200.0"))).error, /codex\.exe/);
  const executable = path.resolve("C:/Tools/Codex/codex.exe");
  const x86 = await inspectCodexExecutable(executable, { readHeader: async () => pe(0x14c), runVersion: async () => "codex 0.200.0" });
  assert.match(x86.error, /64-битным/);
  const old = await inspectCodexExecutable(executable, inspectOptions("codex 0.144.9"));
  assert.match(old.error, /0\.145\.0/);
  const timeout = await inspectCodexExecutable(executable, { readHeader: async () => pe(), runVersion: async () => { throw new Error("token=do-not-leak"); } });
  assert.equal(timeout.error, "Не удалось проверить Codex");
});

test("prefers the bundled runtime and checks candidates in deterministic order", async () => {
  const calls = [];
  const result = await discoverCodexRuntime("C:/ignored", {
    candidates: [
      { executable: "C:/LazyCall/resources/codex.exe", source: "bundled" },
      { executable: "C:/Users/test/AppData/Roaming/npm/codex.exe", source: "installed" }
    ],
    inspect: async (executable, source) => {
      calls.push(executable);
      return source === "bundled"
        ? { executable, version: "0.145.1", source }
        : { executable: null, version: null, source: "missing", error: "not reached" };
    }
  });
  assert.equal(result.source, "bundled");
  assert.deepEqual(calls, ["C:/LazyCall/resources/codex.exe"]);
});

test("continues past an unavailable bundled copy and reports missing without throwing", async () => {
  const calls = [];
  const result = await discoverCodexRuntime("C:/ignored", {
    candidates: [
      { executable: "C:/LazyCall/resources/codex.exe", source: "bundled" },
      { executable: "C:/Users/test/AppData/Roaming/npm/codex.exe", source: "installed" }
    ],
    inspect: async (executable, source) => {
      calls.push(executable);
      if (source === "installed") return { executable, version: "0.146.0", source };
      return { executable: null, version: null, source: "missing", error: "Нет файла" };
    }
  });
  assert.equal(result.source, "installed");
  assert.deepEqual(calls, ["C:/LazyCall/resources/codex.exe", "C:/Users/test/AppData/Roaming/npm/codex.exe"]);
});

test("known lookup derives npm's native vendor path from a custom absolute PATH directory and ignores the project", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "callme-runtime-project-"));
  const customNpmPrefix = await mkdtemp(path.join(tmpdir(), "callme-runtime-custom-npm-"));
  const candidates = knownCodexCandidates(path.join(customNpmPrefix, "bundle"), {
    APPDATA: "",
    LOCALAPPDATA: "",
    PATH: [project, customNpmPrefix].join(path.delimiter)
  }, project);
  assert(candidates.some(item => item.executable === path.join(customNpmPrefix, "codex.exe")));
  assert(candidates.some(item => item.executable === path.join(customNpmPrefix, "node_modules", "@openai", "codex", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe")));
  assert(!candidates.some(item => item.executable.startsWith(project + path.sep) || item.executable === project));
  assert(!candidates.some(item => item.executable.includes(path.join(project, "codex.exe"))));
});

test("version probe receives no model keys, Codex home or Codex configuration", () => {
  const environment = versionProbeEnvironment({
    SystemRoot: "C:/Windows", PATH: "C:/Windows/System32", APPDATA: "C:/Users/test/AppData/Roaming",
    OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", CODEX_HOME: "C:/private", CODEX_CONFIG: "C:/private/config.toml", NODE_OPTIONS: "--require private.js"
  });
  assert.deepEqual(environment, {
    SystemRoot: "C:/Windows", PATH: "C:/Windows/System32", APPDATA: "C:/Users/test/AppData/Roaming"
  });
});
