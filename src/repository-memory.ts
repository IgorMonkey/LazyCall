import { RepositoryReader } from "./repository-reader";

export interface RepositoryRead { path: string; startLine?: number; limit?: number }

/** Only references to already authorized reads are kept. Every excerpt is read fresh. */
export class RepositoryMemory {
  private scopes = new Map<string, RepositoryRead[]>();
  seed(scope: string, paths: string[]) {
    if (this.scopes.has(scope)) return;
    for (const file of paths.slice(0, 12)) this.remember(scope, { path: file });
  }
  remember(scope: string, read: RepositoryRead) {
    const refs = (this.scopes.get(scope) || []).filter(item => item.path !== read.path || item.startLine !== read.startLine);
    refs.push({ ...read });
    this.scopes.delete(scope); this.scopes.set(scope, refs.slice(-12));
    while (this.scopes.size > 8) this.scopes.delete(this.scopes.keys().next().value!);
  }
  async excerpts(scope: string, root: string, question: string): Promise<{ text: string; files: string[] }> {
    const refs = this.scopes.get(scope) || [];
    const words = question.toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) || [];
    const selected = refs.map((read, index) => ({ read, index, score: words.filter(word => read.path.toLowerCase().includes(word)).length }))
      .sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 4);
    const reader = new RepositoryReader(root);
    let text = ""; const files: string[] = [];
    for (const { read } of selected) {
      try {
        const value = await reader.call("repo_read", { ...read, limit: Math.min(read.limit || 100, 80) });
        if (text.length + value.length > 24_000) continue;
        text += value + "\n"; files.push(read.path);
      } catch { /* A moved, changed or unavailable file is not retained as a fact. */ }
    }
    return { text, files: [...new Set(files)] };
  }
}
