import { open, mkdir, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readJournal, sessionPath } from "./meeting-store";

export class Journal {
  private handle: FileHandle | null = null;
  private pending: Promise<void> = Promise.resolve();
  private seq = 0;
  private closing = false;
  directory = "";
  async start(root: string): Promise<string> {
    await this.close();
    const id = randomUUID();
    this.directory = path.join(root, id);
    await mkdir(this.directory, { recursive: true });
    this.handle = await open(path.join(this.directory, "events.jsonl"), "ax");
    this.seq = 0;
    this.closing = false;
    return id;
  }
  async open(root: string, id: string): Promise<void> {
    await this.close();
    const file = await sessionPath(root, id);
    const recovered = await readJournal(file);
    const handle = await open(file, "r+");
    try {
      await handle.truncate(recovered.validBytes);
      if (recovered.needsNewline) await handle.write("\n", recovered.validBytes, "utf8");
      await handle.datasync();
    } finally { await handle.close(); }
    this.handle = await open(file, "a");
    this.directory = path.dirname(file);
    this.seq = recovered.events.at(-1)?.seq ?? 0;
    this.closing = false;
  }
  append(type: string, payload: unknown): Promise<void> {
    const handle = this.handle;
    if (!handle || this.closing) return Promise.reject(new Error("Журнал не открыт"));
    const row = JSON.stringify({
      schemaVersion: 1, eventId: randomUUID(), seq: ++this.seq,
      recordedAtUtc: new Date().toISOString(), type, payload
    }) + "\n";
    this.pending = this.pending.then(async () => {
      await handle.writeFile(row);
      await handle.datasync();
    });
    return this.pending;
  }
  async flush() { await this.pending; await this.handle?.datasync(); }
  async close() {
    this.closing = true;
    try { await this.pending; } finally {
      await this.handle?.close();
      this.handle = null;
      this.pending = Promise.resolve();
    }
  }
}
