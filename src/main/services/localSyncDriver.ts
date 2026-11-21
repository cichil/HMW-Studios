import {
  chmod,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ConnectionProfile, RemoteEntry } from '@shared/types';
import type { IgnoreFilter } from './ignoreFilter';
import type { RemoteTransferDriver } from './transferTypes';

export class LocalFolderTransferDriver implements RemoteTransferDriver {
  private readonly rootDir: string;
  private connected = false;

  constructor(profile: ConnectionProfile) {
    this.rootDir = resolve(profile.remotePath);
  }

  async connect(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isAlive(): boolean {
    return this.connected;
  }

  private resolveLocalTarget(remotePathOrRel: string): string {
    if (isAbsolute(remotePathOrRel)) {
      return resolve(remotePathOrRel);
    }
    return resolve(this.rootDir, remotePathOrRel.replace(/^[/\\]+/, ''));
  }

  async checkAbsoluteOrRelExists(remotePathOrRel: string): Promise<boolean> {
    const target = this.resolveLocalTarget(remotePathOrRel);
    try {
      const st = await stat(target);
      return st.isFile();
    } catch {
      return false;
    }
  }

  async readTailText(
    remotePathOrRel: string,
    maxBytes = 65536
  ): Promise<{ content: string; size: number; exists: boolean }> {
    const target = this.resolveLocalTarget(remotePathOrRel);
    let st;
    try {
      st = await stat(target);
    } catch {
      return { content: '', size: 0, exists: false };
    }
    if (!st.isFile()) {
      return { content: '', size: 0, exists: false };
    }
    if (st.size === 0) {
      return { content: '', size: 0, exists: true };
    }
    if (st.size <= maxBytes) {
      const content = await readFile(target, 'utf-8');
      return { content, size: st.size, exists: true };
    }
    const fh = await open(target, 'r');
    try {
      const len = Math.min(maxBytes, st.size);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, st.size - len);
      return {
        content: buf.subarray(0, bytesRead).toString('utf-8'),
        size: st.size,
        exists: true
      };
    } finally {
      await fh.close();
    }
  }

  async listDirectory(remoteSubPath = ''): Promise<RemoteEntry[]> {
    const cleanSub = remoteSubPath.replace(/^[/\\]+/, '');
    const targetDir = cleanSub ? resolve(this.rootDir, cleanSub) : this.rootDir;
    const dirents = await readdir(targetDir, { withFileTypes: true });
    const entries: RemoteEntry[] = [];

    for (const d of dirents) {
      const fullPath = join(targetDir, d.name);
      try {
        const st = await stat(fullPath);
        const relPath = relative(this.rootDir, fullPath).replace(/\\/g, '/');
        entries.push({
          name: d.name,
          path: fullPath,
          relativePath: relPath,
          isDirectory: d.isDirectory(),
          size: d.isDirectory() ? 0 : st.size,
          mtimeMs: st.mtimeMs,
          permissions: (st.mode & 0o777).toString(8).padStart(3, '0')
        });
      } catch {
        continue;
      }
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async listRecursive(
    ignoreFilter: IgnoreFilter
  ): Promise<{ entries: RemoteEntry[]; ignoredCount: number }> {
    const entries: RemoteEntry[] = [];
    let ignoredCount = 0;

    const walk = async (dir: string): Promise<void> => {
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of dirents) {
        const fullPath = join(dir, d.name);
        const relPath = relative(this.rootDir, fullPath).replace(/\\/g, '/');
        if (ignoreFilter.isIgnored(relPath)) {
          ignoredCount += 1;
          continue;
        }
        if (d.isDirectory()) {
          await walk(fullPath);
        } else {
          try {
            const st = await stat(fullPath);
            entries.push({
              name: d.name,
              path: fullPath,
              relativePath: relPath,
              isDirectory: false,
              size: st.size,
              mtimeMs: st.mtimeMs
            });
          } catch {
            continue;
          }
        }
      }
    };

    await walk(this.rootDir);
    return { entries, ignoredCount };
  }

  async readFileText(remoteRelativePath: string): Promise<string> {
    const target = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    return readFile(target, 'utf-8');
  }

  async writeFileText(remoteRelativePath: string, content: string): Promise<void> {
    const target = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf-8');
  }

  async createEntry(
    remoteRelativePath: string,
    isDirectory: boolean,
    initialContent = ''
  ): Promise<void> {
    const target = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    if (existsSync(target)) {
      throw new Error(`Path sudah ada di remote: ${remoteRelativePath}`);
    }
    if (isDirectory) {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, initialContent, 'utf-8');
    }
  }

  async renameEntry(oldRelativePath: string, newRelativePath: string): Promise<void> {
    const oldTarget = resolve(this.rootDir, oldRelativePath.replace(/^[/\\]+/, ''));
    const newTarget = resolve(this.rootDir, newRelativePath.replace(/^[/\\]+/, ''));
    if (existsSync(newTarget)) {
      throw new Error(`Nama tujuan sudah digunakan: ${newRelativePath}`);
    }
    await mkdir(dirname(newTarget), { recursive: true });
    await rename(oldTarget, newTarget);
  }

  async deleteEntry(remoteRelativePath: string, _isDirectory: boolean): Promise<void> {
    const target = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    await rm(target, { recursive: true, force: true });
  }

  async chmodEntry(remoteRelativePath: string, modeOctal: string): Promise<void> {
    const target = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    const clean = modeOctal.replace(/[^0-7]/g, '') || '644';
    await chmod(target, parseInt(clean, 8));
  }

  async uploadFile(localFilePath: string, remoteRelativePath: string): Promise<void> {
    const dest = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(localFilePath, dest);
    const srcStat = await stat(localFilePath);
    const { utimes } = await import('node:fs/promises');
    await utimes(dest, srcStat.atime, srcStat.mtime);
  }

  async downloadFile(remoteRelativePath: string, localFilePath: string): Promise<void> {
    const src = resolve(this.rootDir, remoteRelativePath.replace(/^[/\\]+/, ''));
    await mkdir(dirname(localFilePath), { recursive: true });
    await copyFile(src, localFilePath);
    const srcStat = await stat(src);
    const { utimes } = await import('node:fs/promises');
    await utimes(localFilePath, srcStat.atime, srcStat.mtime);
  }
}
