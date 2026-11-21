import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { EnterpriseAuditEntry, EnterpriseAuditKind } from '@shared/types';

export class AuditTrailService {
  private readonly storageDir: string;
  private readonly auditFile: string;
  private cache: EnterpriseAuditEntry[] | null = null;

  constructor(storageDir: string) {
    this.storageDir = resolve(storageDir);
    this.auditFile = join(this.storageDir, 'enterprise-audit.json');
  }

  private async ensureLoaded(): Promise<EnterpriseAuditEntry[]> {
    if (this.cache) return this.cache;
    if (!existsSync(this.auditFile)) {
      this.cache = [];
      return this.cache;
    }
    try {
      const raw = await readFile(this.auditFile, 'utf-8');
      const parsed = JSON.parse(raw);
      this.cache = Array.isArray(parsed) ? (parsed as EnterpriseAuditEntry[]) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  async list(limit = 500): Promise<EnterpriseAuditEntry[]> {
    const all = await this.ensureLoaded();
    return all.slice(0, Math.max(1, limit));
  }

  async record(
    input: Omit<EnterpriseAuditEntry, 'id' | 'timestamp'> & { kind: EnterpriseAuditKind }
  ): Promise<EnterpriseAuditEntry> {
    const all = await this.ensureLoaded();
    const entry: EnterpriseAuditEntry = {
      ...input,
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString()
    };
    const next = [entry, ...all].slice(0, 1000);
    this.cache = next;
    try {
      await mkdir(this.storageDir, { recursive: true });
      await writeFile(this.auditFile, JSON.stringify(next, null, 2), 'utf-8');
    } catch {
      // Ignore write failures
    }
    return entry;
  }

  async clear(): Promise<void> {
    this.cache = [];
    try {
      await mkdir(this.storageDir, { recursive: true });
      await writeFile(this.auditFile, '[]', 'utf-8');
    } catch {
      // Ignore
    }
  }
}
