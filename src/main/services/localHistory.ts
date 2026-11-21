import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FileHistoryEntry } from '@shared/types';

interface StoredHistoryEntry extends FileHistoryEntry {
  sha256: string;
}

const MAX_SNAPSHOTS_PER_FILE = 40;

export class LocalHistoryService {
  private readonly historyRoot: string;
  private readonly blobsDir: string;
  private readonly indexFile: string;

  constructor(storageDir: string) {
    this.historyRoot = join(resolve(storageDir), 'file-history');
    this.blobsDir = join(this.historyRoot, 'blobs');
    this.indexFile = join(this.historyRoot, 'index.json');
  }

  private async readIndex(): Promise<StoredHistoryEntry[]> {
    if (!existsSync(this.indexFile)) return [];
    try {
      const raw = await readFile(this.indexFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredHistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(entries: StoredHistoryEntry[]): Promise<void> {
    await mkdir(this.blobsDir, { recursive: true });
    await writeFile(this.indexFile, JSON.stringify(entries, null, 2), 'utf-8');
  }

  private blobPathFor(id: string): string {
    return join(this.blobsDir, `${id}.snapshot`);
  }

  async record(payload: {
    fileKey: string;
    label: string;
    sourceKind: 'local' | 'remote';
    displayPath: string;
    connectionId?: string;
    relativePath: string;
    content: string;
  }): Promise<FileHistoryEntry | null> {
    const sha256 = createHash('sha256').update(payload.content, 'utf-8').digest('hex');
    const all = await this.readIndex();

    const sameFile = all
      .filter((e) => e.fileKey === payload.fileKey)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // Hindari duplikasi snapshot berturut-turut jika isi file sama persis
    if (sameFile[0] && sameFile[0].sha256 === sha256) {
      return sameFile[0];
    }

    await mkdir(this.blobsDir, { recursive: true });
    const id = `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const size = Buffer.byteLength(payload.content, 'utf-8');

    await writeFile(this.blobPathFor(id), payload.content, 'utf-8');

    const newEntry: StoredHistoryEntry = {
      id,
      fileKey: payload.fileKey,
      label: payload.label,
      sourceKind: payload.sourceKind,
      displayPath: payload.displayPath,
      connectionId: payload.connectionId,
      relativePath: payload.relativePath,
      timestamp: now,
      size,
      sha256
    };

    const otherFiles = all.filter((e) => e.fileKey !== payload.fileKey);
    const updatedSameFile = [newEntry, ...sameFile];
    const keptSameFile = updatedSameFile.slice(0, MAX_SNAPSHOTS_PER_FILE);
    const overflow = updatedSameFile.slice(MAX_SNAPSHOTS_PER_FILE);

    for (const old of overflow) {
      await rm(this.blobPathFor(old.id), { force: true }).catch(() => {});
    }

    await this.writeIndex([...keptSameFile, ...otherFiles]);
    return newEntry;
  }

  async list(fileKey: string): Promise<FileHistoryEntry[]> {
    const all = await this.readIndex();
    return all
      .filter((e) => e.fileKey === fileKey)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map(({ sha256: _sha, ...publicEntry }) => publicEntry);
  }

  async getContent(snapshotId: string): Promise<string> {
    const safeId = snapshotId.replace(/[^a-zA-Z0-9_-]/g, '');
    return readFile(this.blobPathFor(safeId), 'utf-8');
  }

  async clear(fileKey: string): Promise<void> {
    const all = await this.readIndex();
    const toRemove = all.filter((e) => e.fileKey === fileKey);
    const remaining = all.filter((e) => e.fileKey !== fileKey);
    for (const item of toRemove) {
      await rm(this.blobPathFor(item.id), { force: true }).catch(() => {});
    }
    await this.writeIndex(remaining);
  }
}
