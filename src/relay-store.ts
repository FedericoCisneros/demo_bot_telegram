import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface RelayEntry {
  customerChatId: number;
  customerName: string;
}

interface StoreFile {
  version: 1;
  /** [ownerMessageId, entry] pairs, oldest first. */
  entries: [number, RelayEntry][];
}

/**
 * Remembers which customer each message in the owner's chat belongs to, so a reply
 * from the owner can be routed back. Kept in memory and mirrored to a small JSON file
 * so replies still work after a restart. Oldest links are dropped past `maxEntries`.
 */
export class RelayStore {
  private readonly entries = new Map<number, RelayEntry>();
  private readonly filePath: string | undefined;
  private readonly maxEntries: number;

  constructor(options: { filePath?: string; maxEntries?: number } = {}) {
    this.filePath = options.filePath;
    this.maxEntries = options.maxEntries ?? 5000;
    this.load();
  }

  link(ownerMessageId: number, entry: RelayEntry): void {
    this.entries.delete(ownerMessageId);
    this.entries.set(ownerMessageId, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as number;
      this.entries.delete(oldest);
    }
    this.save();
  }

  lookup(ownerMessageId: number): RelayEntry | undefined {
    return this.entries.get(ownerMessageId);
  }

  get size(): number {
    return this.entries.size;
  }

  private load(): void {
    if (!this.filePath) return;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return; // First run: nothing saved yet.
    }
    try {
      const data = JSON.parse(raw) as StoreFile;
      for (const [id, entry] of data.entries ?? []) {
        if (Number.isInteger(id) && Number.isInteger(entry?.customerChatId)) {
          this.entries.set(id, { customerChatId: entry.customerChatId, customerName: String(entry.customerName ?? '') });
        }
      }
    } catch (err) {
      console.warn(`Ignoring unreadable relay store ${this.filePath}: ${(err as Error).message}`);
    }
  }

  private save(): void {
    if (!this.filePath) return;
    const data: StoreFile = { version: 1, entries: [...this.entries] };
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Write-then-rename so a crash mid-write never leaves a half-written file.
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, this.filePath);
  }
}
