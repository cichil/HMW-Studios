import { mkdir } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { dirname, posix } from 'node:path';
import { Client as FtpClient } from 'basic-ftp';
import type { ConnectionProfile, RemoteEntry } from '@shared/types';
import type { IgnoreFilter } from './ignoreFilter';
import {
  joinPosixRemote,
  type DecryptedSecrets,
  type RemoteTransferDriver
} from './transferTypes';

export class FtpTransferDriver implements RemoteTransferDriver {
  private readonly client = new FtpClient(15000);
  private readonly profile: ConnectionProfile;
  private readonly secrets: DecryptedSecrets;
  private initialPwd = '/';

  constructor(profile: ConnectionProfile, secrets: DecryptedSecrets) {
    this.profile = profile;
    this.secrets = secrets;
  }

  private resolveRemote(subPath = ''): string {
    const rawBase = (this.profile.remotePath || '/').replace(/\\/g, '/').trim();
    const absBase = rawBase.startsWith('/')
      ? rawBase
      : joinPosixRemote(this.initialPwd || '/', rawBase === '.' ? '' : rawBase);
    return joinPosixRemote(absBase, subPath);
  }

  async connect(): Promise<void> {
    const host = this.profile.host?.trim();
    const port = this.profile.port || 21;
    if (!host) {
      throw new Error(
        `Host ${this.profile.protocol.toUpperCase()} belum diisi pada profil "${this.profile.name}".`
      );
    }
    const isSecure = this.profile.protocol === 'ftps';
    try {
      await this.client.access({
        host,
        port,
        user: this.profile.username || 'anonymous',
        password: this.secrets.password || '',
        secure: isSecure,
        secureOptions: isSecure
          ? {
              rejectUnauthorized: this.profile.rejectUnauthorized ?? false,
              minVersion: 'TLSv1.2'
            }
          : undefined
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Tidak dapat terhubung ke ${this.profile.protocol.toUpperCase()} "${this.profile.name}" (${host}:${port}) — ${raw}`
      );
    }
    try {
      this.initialPwd = await this.client.pwd();
    } catch {
      this.initialPwd = '/';
    }
  }

  async disconnect(): Promise<void> {
    this.client.close();
  }

  isAlive(): boolean {
    return !this.client.closed;
  }

  async checkAbsoluteOrRelExists(remotePathOrRel: string): Promise<boolean> {
    const target = remotePathOrRel.startsWith('/')
      ? remotePathOrRel
      : this.resolveRemote(remotePathOrRel);
    try {
      await this.client.size(target);
      return true;
    } catch {
      return false;
    }
  }

  async readTailText(
    remotePathOrRel: string,
    maxBytes = 65536
  ): Promise<{ content: string; size: number; exists: boolean }> {
    const target = remotePathOrRel.startsWith('/')
      ? remotePathOrRel
      : this.resolveRemote(remotePathOrRel);
    let size = 0;
    try {
      size = await this.client.size(target);
    } catch {
      return { content: '', size: 0, exists: false };
    }
    if (size === 0) return { content: '', size: 0, exists: true };
    const startAt = Math.max(0, size - maxBytes);
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      }
    });
    await this.client.downloadTo(writable, target, startAt);
    return {
      content: Buffer.concat(chunks).toString('utf-8'),
      size,
      exists: true
    };
  }

  async listDirectory(remoteSubPath = ''): Promise<RemoteEntry[]> {
    const target = this.resolveRemote(remoteSubPath);
    const list = await this.client.list(target);
    const entries: RemoteEntry[] = list
      .filter((item) => item.name !== '.' && item.name !== '..')
      .map((item) => {
        const rel = remoteSubPath
          ? `${remoteSubPath.replace(/^\/+|\/+$/g, '')}/${item.name}`
          : item.name;
        return {
          name: item.name,
          path: joinPosixRemote(target, item.name),
          relativePath: rel,
          isDirectory: item.isDirectory,
          size: item.size,
          mtimeMs: item.modifiedAt ? item.modifiedAt.getTime() : 0
        };
      });

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  async listRecursive(
    ignoreFilter: IgnoreFilter,
    options?: { requireRootExists?: boolean }
  ): Promise<{ entries: RemoteEntry[]; ignoredCount: number }> {
    const entries: RemoteEntry[] = [];
    let ignoredCount = 0;
    const base = this.resolveRemote('');

    const walk = async (currentPosix: string, relPrefix: string): Promise<void> => {
      let list;
      try {
        list = await this.client.list(currentPosix);
      } catch (err) {
        if (relPrefix === '' && options?.requireRootExists) {
          throw new Error(
            `Gagal membaca direktori remote "${currentPosix}" di ${this.profile.name}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        return;
      }
      for (const item of list) {
        if (item.name === '.' || item.name === '..') continue;
        const relPath = relPrefix ? `${relPrefix}/${item.name}` : item.name;
        if (ignoreFilter.isIgnored(relPath)) {
          ignoredCount += 1;
          continue;
        }
        const fullRemote = joinPosixRemote(currentPosix, item.name);
        if (item.isDirectory) {
          await walk(fullRemote, relPath);
        } else if (item.isFile) {
          entries.push({
            name: item.name,
            path: fullRemote,
            relativePath: relPath,
            isDirectory: false,
            size: item.size,
            mtimeMs: item.modifiedAt ? item.modifiedAt.getTime() : 0
          });
        }
      }
    };

    await walk(base, '');
    return { entries, ignoredCount };
  }

  async readFileText(remoteRelativePath: string): Promise<string> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      }
    });
    await this.client.downloadTo(writable, fullRemote);
    return Buffer.concat(chunks).toString('utf-8');
  }

  async writeFileText(remoteRelativePath: string, content: string): Promise<void> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    const parentDir = posix.dirname(fullRemote);
    await this.client.ensureDir(parentDir);
    const stream = Readable.from([Buffer.from(content, 'utf-8')]);
    await this.client.uploadFrom(stream, posix.basename(fullRemote));
  }

  async createEntry(
    remoteRelativePath: string,
    isDirectory: boolean,
    initialContent = ''
  ): Promise<void> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    if (isDirectory) {
      await this.client.ensureDir(fullRemote);
      return;
    }

    let fileExists = false;
    try {
      await this.client.size(fullRemote);
      fileExists = true;
    } catch {
      fileExists = false;
    }
    if (fileExists) {
      throw new Error(`File sudah ada di server FTP: ${remoteRelativePath}`);
    }

    const parentDir = posix.dirname(fullRemote);
    await this.client.ensureDir(parentDir);
    const stream = Readable.from([Buffer.from(initialContent, 'utf-8')]);
    await this.client.uploadFrom(stream, posix.basename(fullRemote));
  }

  async renameEntry(oldRelativePath: string, newRelativePath: string): Promise<void> {
    const oldFull = this.resolveRemote(oldRelativePath);
    const newFull = this.resolveRemote(newRelativePath);
    if (posix.dirname(oldFull) === posix.dirname(newFull)) {
      await this.client.cd(posix.dirname(oldFull));
      await this.client.rename(posix.basename(oldFull), posix.basename(newFull));
    } else {
      await this.client.ensureDir(posix.dirname(newFull));
      await this.client.rename(oldFull, newFull);
    }
  }

  async deleteEntry(remoteRelativePath: string, isDirectory: boolean): Promise<void> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    if (isDirectory) {
      await this.client.removeDir(fullRemote);
    } else {
      await this.client.remove(fullRemote);
    }
  }

  async chmodEntry(remoteRelativePath: string, modeOctal: string): Promise<void> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    const clean = modeOctal.replace(/[^0-7]/g, '') || '644';
    await this.client.send(`SITE CHMOD ${clean} ${fullRemote}`);
  }

  async uploadFile(localFilePath: string, remoteRelativePath: string): Promise<void> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    const parentDir = posix.dirname(fullRemote);
    await this.client.ensureDir(parentDir);
    await this.client.uploadFrom(localFilePath, posix.basename(fullRemote));
  }

  async downloadFile(remoteRelativePath: string, localFilePath: string): Promise<void> {
    const fullRemote = this.resolveRemote(remoteRelativePath);
    await mkdir(dirname(localFilePath), { recursive: true });
    await this.client.downloadTo(localFilePath, fullRemote);
  }
}
