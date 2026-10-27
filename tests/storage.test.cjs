const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Journal } = require("../dist-electron/journal");
const { wavFromPcm } = require("../dist-electron/wav");

test("WAV preserves signed 16-bit mono payload and length", () => {
  const pcm = Buffer.from([0, 128, 255, 127, 0, 0]);
  const wav = wavFromPcm(pcm);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), pcm.length + 36);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.throws(() => wavFromPcm(Buffer.alloc(3)));
});
test("journal serializes concurrent finals, flushes and keeps sessions separate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "callme-journal-test-"));
  const journal = new Journal();
  const id = await journal.start(root);
  await Promise.all(Array.from({ length: 30 }, (_, n) => journal.append("transcript.final", { text: "fixture " + n })));
  await journal.close();
  const rows = (await readFile(path.join(root, id, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map(r => r.seq), Array.from({ length: 30 }, (_, n) => n + 1));
  assert.equal(new Set(rows.map(r => r.eventId)).size, 30);
  const second = await journal.start(root);
  await journal.append("session.started", {});
  await journal.close();
  assert.notEqual(second, id);
  const row = JSON.parse((await readFile(path.join(root, second, "events.jsonl"), "utf8")).trim());
  assert.equal(row.seq, 1);
  assert.equal(rows[29].payload.text, "fixture 29");
});
