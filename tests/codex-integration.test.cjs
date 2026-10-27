const { mkdtemp } = require('./temporary.cjs');
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdir, readFile, writeFile, lstat, symlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");

const { integrationStatus, prepareCodexPlugin, disableCodexIntegration } = require("../dist-electron/codex-integration.js");
const { ProjectStore } = require("../dist-electron/project-store.js");

function rpc(child) {
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n"); if (index < 0) break;
      const row = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      pending.get(row.id)?.(row);
    }
  });
  return (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 5000);
    pending.set(id, row => { clearTimeout(timer); pending.delete(id); resolve(row); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }) + "\n");
  });
}

async function seed(root) {
  const projectStore = new ProjectStore(path.join(root, "projects"));
  const project = await projectStore.create({ name: "Fixture project", description: "Read-only fixture project" });
  const source = path.join(root, "fixture.md");
  await writeFile(source, "Selected material for MCP fixture.");
  await projectStore.context(project.id).setGoal("Fixture goal");
  await projectStore.context(project.id).addFiles([source]);
  const meetingId = randomUUID();
  const startedAt = "2026-01-02T03:04:05.000Z";
  await mkdir(path.join(root, "sessions", meetingId), { recursive: true });
  const rows = [
    { schemaVersion: 1, seq: 1, recordedAtUtc: startedAt, type: "session.started", payload: { id: meetingId, startedAt } },
    { schemaVersion: 1, seq: 2, recordedAtUtc: startedAt, type: "session.project", payload: { id: project.id, name: project.name } },
    { schemaVersion: 1, seq: 3, recordedAtUtc: startedAt, type: "context.goal", payload: { goal: "Fixture goal" } },
    { schemaVersion: 1, seq: 4, recordedAtUtc: startedAt, type: "transcript.final", payload: { id: randomUUID(), source: "remote", startMs: 0, endMs: 400, text: "First actual evidence." } },
    { schemaVersion: 1, seq: 5, recordedAtUtc: startedAt, type: "transcript.final", payload: { id: randomUUID(), source: "self", startMs: 500, endMs: 900, text: "Second actual evidence." } },
    { schemaVersion: 1, seq: 6, recordedAtUtc: startedAt, type: "session.stopped", payload: { endedAt: "2026-01-02T03:05:05.000Z" } }
  ];
  await writeFile(path.join(root, "sessions", meetingId, "events.jsonl"), rows.map(JSON.stringify).join("\n") + "\n");
  return { project, meetingId };
}

test("prepares an own local plugin and serves bounded read-only MCP data through Electron", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "callme mcp ю-"));
  const { project, meetingId } = await seed(root);
  assert.deepEqual(await integrationStatus(root), { enabled: false, prepared: false });
  const electron = require("electron");
  const entry = path.resolve("dist-electron/mcp-entry.js");
  const child = spawn(electron, [entry, "--data-root", root], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const request = rpc(child);
  try {
    assert.equal((await request(1, "initialize", { protocolVersion: "2025-06-18" })).error.code, -32001);
    const link = await prepareCodexPlugin(root, electron, entry);
    assert.equal(new URL(link).searchParams.get("marketplacePath"), path.join(root, "codex-integration"));
    assert.deepEqual(await integrationStatus(root), { enabled: true, prepared: true });
    const pluginRoot = path.join(root, "codex-integration", "plugins", "callme");
    const legacy = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
    const mcp = JSON.parse(await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"));
    assert.equal(legacy.name, "callme");
    assert.deepEqual(mcp.mcpServers.callme.env, { ELECTRON_RUN_AS_NODE: "1" });
    assert.deepEqual((await request(2, "initialize", { protocolVersion: "2025-06-18" })).result.capabilities, { tools: {} });
    const listed = await request(3, "tools/list");
    assert.equal(listed.result.tools.length, 4);
    assert(listed.result.tools.every(tool => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint && !tool.annotations.openWorldHint && tool.annotations.idempotentHint));
    const projects = JSON.parse((await request(4, "tools/call", { name: "list_projects", arguments: {} })).result.content[0].text);
    assert.equal(projects.projects[0].id, project.id);
    const meetings = JSON.parse((await request(5, "tools/call", { name: "list_meetings", arguments: { projectId: project.id } })).result.content[0].text);
    assert.equal(meetings.meetings[0].id, meetingId);
    const first = JSON.parse((await request(6, "tools/call", { name: "read_meeting", arguments: { id: meetingId, limit: 1 } })).result.content[0].text);
    assert.equal(first.transcript.lines.length, 1);
    assert.equal(first.transcript.lines[0].text, "First actual evidence.");
    const second = JSON.parse((await request(7, "tools/call", { name: "read_meeting", arguments: { id: meetingId, offset: 1, limit: 1 } })).result.content[0].text);
    assert.equal(second.transcript.lines[0].text, "Second actual evidence.");
    const knowledge = JSON.parse((await request(8, "tools/call", { name: "read_project", arguments: { id: project.id } })).result.content[0].text);
    assert.equal(knowledge.project.description, "Read-only fixture project");
    assert(knowledge.selectedMaterials.excerpt.includes("Selected material"));
    assert(!knowledge.selectedMaterials.excerpt.includes(root));
    const bad = await request(9, "tools/call", { name: "read_meeting", arguments: { id: "not-a-uuid" } });
    assert.equal(bad.result.isError, true);
    await disableCodexIntegration(root);
    assert.equal((await request(10, "ping")).error.code, -32001);
    assert.deepEqual(await integrationStatus(root), { enabled: false, prepared: true });
    assert.equal((await lstat(path.join(pluginRoot, ".mcp.json"))).isFile(), true);
  } finally {
    child.kill();
  }
});

test("refuses a symlinked LazyCall integration root", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "callme-mcp-link-"));
  const outside = await mkdtemp(path.join(tmpdir(), "callme-mcp-outside-"));
  try { await symlink(outside, path.join(root, "codex-integration"), "junction"); }
  catch (error) { if (error.code === "EPERM" || error.code === "EACCES") return t.skip("Windows does not permit test directory links in this environment"); throw error; }
  await assert.rejects(() => prepareCodexPlugin(root, path.resolve("electron.exe"), path.resolve("dist-electron/mcp-entry.js")), /ссылкой/);
});
