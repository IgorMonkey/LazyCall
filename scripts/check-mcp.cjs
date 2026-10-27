const { spawn } = require("node:child_process");
const { mkdtemp, mkdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const assert = require("node:assert/strict");
const { integrationStatus, prepareCodexPlugin, disableCodexIntegration } = require("../dist-electron/codex-integration.js");
const { ProjectStore } = require("../dist-electron/project-store.js");

function client(child) {
  let buffer = ""; const waits = new Map();
  child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { buffer += chunk; for (;;) { const at = buffer.indexOf("\n"); if (at < 0) return; const reply = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); waits.get(reply.id)?.(reply); } });
  return (id, method, params) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("MCP response timeout")), 5000); waits.set(id, reply => { clearTimeout(timer); waits.delete(id); resolve(reply); }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) + "\n"); });
}

(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "callme-mcp-check-"));
  const projects = new ProjectStore(path.join(root, "projects"));
  const project = await projects.create({ name: "MCP fixture", description: "Durable fixture project" });
  const id = randomUUID(), when = "2026-01-02T03:04:05.000Z";
  await mkdir(path.join(root, "sessions", id), { recursive: true });
  await writeFile(path.join(root, "sessions", id, "events.jsonl"), [
    { schemaVersion: 1, seq: 1, recordedAtUtc: when, type: "session.started", payload: { id, startedAt: when } },
    { schemaVersion: 1, seq: 2, recordedAtUtc: when, type: "transcript.final", payload: { id: randomUUID(), source: "remote", startMs: 0, endMs: 100, text: "Actual fixture evidence." } },
    { schemaVersion: 1, seq: 3, recordedAtUtc: when, type: "session.stopped", payload: { endedAt: when } }
  ].map(JSON.stringify).join("\n") + "\n");
  const electron = process.env.CALLME_MCP_EXE || require("electron"), entry = path.resolve(process.env.CALLME_MCP_ENTRY || "dist-electron/mcp-entry.js");
  const child = spawn(electron, [entry, "--data-root", root], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const ask = client(child);
  try {
    assert.equal((await ask(1, "ping")).error.code, -32001);
    const link = await prepareCodexPlugin(root, electron, entry);
    assert(link.includes("marketplacePath="));
    assert.deepEqual(await integrationStatus(root), { enabled: true, prepared: true });
    assert.equal((await ask(2, "initialize", {})).result.serverInfo.name, "callme");
    const tools = await ask(3, "tools/list"); assert.equal(tools.result.tools.length, 4);
    const page = JSON.parse((await ask(4, "tools/call", { name: "read_meeting", arguments: { id, limit: 1 } })).result.content[0].text);
    assert.equal(page.transcript.lines[0].text, "Actual fixture evidence.");
    assert.equal((await ask(5, "tools/call", { name: "read_meeting", arguments: { id: "bad" } })).result.isError, true);
    await disableCodexIntegration(root);
    assert.equal((await ask(6, "ping")).error.code, -32001);
    console.log(JSON.stringify({ status: "passed", checks: ["disabled permission gate", "Electron stdio initialize/tools", "bounded durable meeting read", "bad ID rejected", "disable gate"], fixture: "temporary LazyCall data only; no plugin install, global profile, UI, audio, or network" }));
  } finally { child.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
