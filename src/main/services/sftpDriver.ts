import { mkdir, readFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import { Client as SshClient, type ConnectConfig } from 'ssh2';
import type { ConnectionProfile, RemoteEntry } from '@shared/types';
import type { IgnoreFilter } from './ignoreFilter';
import {
  joinPosixRemote,
  type DecryptedSecrets,
  type RemoteTransferDriver
} from './transferTypes';

function rightsToOctal(rights?: {
  user?: string;
  group?: string;
  other?: string;
}): string | undefined {
  if (!rights) return undefined;
  const part = (r = ''): number =>
    (r.includes('r') ? 4 : 0) + (r.includes('w') ? 2 : 0) + (r.includes('x') ? 1 : 0);
  return `${part(rights.user)}${part(rights.group)}${part(rights.other)}`;
}

export async function buildSshConnectConfig(
  profile: ConnectionProfile,
  secrets: DecryptedSecrets
): Promise<ConnectConfig> {
  const host = profile.host?.trim();
  const port = profile.port || 22;
  if (!host) {
    throw new Error(`Host SFTP/SSH belum diisi pada profil "${profile.name}".`);
  }

  const config: ConnectConfig = {
    host,
    port,
    username: profile.username,
    readyTimeout: 12000,
    keepaliveInterval: 15000,
    keepaliveCountMax: 3,
    algorithms: {
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa'
      ],
      kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1'
      ],
      compress: ['zlib@openssh.com', 'zlib', 'none']
    }
  };

  if (profile.authType === 'privateKey' && profile.privateKeyPath) {
    config.privateKey = await readFile(profile.privateKeyPath);
    if (secrets.passphrase) {
      config.passphrase = secrets.passphrase;
    }
  } else if (secrets.password) {
    config.password = secrets.password;
  }

  return config;
}

export async function openSshClient(
  profile: ConnectionProfile,
  secrets: DecryptedSecrets
): Promise<SshClient> {
  const config = await buildSshConnectConfig(profile, secrets);
  const ssh = new SshClient();
  await new Promise<void>((resolveReady, rejectReady) => {
    let settled = false;
    ssh.once('ready', () => {
      if (settled) return;
      settled = true;
      // Attach no-op error guard after ready so background socket drops don't crash process
      ssh.on('error', () => {});
      resolveReady();
    });
    ssh.once('error', (err) => {
      if (settled) return;
      settled = true;
      rejectReady(
        new Error(
          `Gagal membuka SSH Tunnel melalui "${profile.name}" (${profile.host}:${profile.port || 22}) — ${err.message}`
        )
      );
    });
    ssh.connect(config);
  });
  return ssh;
}

export class SftpTransferDriver implements RemoteTransferDriver {
  private client = new SftpClient();
  private readonly profile: ConnectionProfile;
  private readonly secrets: DecryptedSecrets;
  private connected = false;

  constructor(profile: ConnectionProfile, secrets: DecryptedSecrets) {
    this.profile = profile;
    this.secrets = secrets;
    this.attachLifecycleListeners(this.client);
  }

  private attachLifecycleListeners(sftp: SftpClient): void {
    const markDisconnected = (): void => {
      this.connected = false;
    };
    sftp.on('error', markDisconnected);
    sftp.on('end', markDisconnected);
    sftp.on('close', markDisconnected);
  }

  isAlive(): boolean {
    const rawSftp = (this.client as unknown as { sftp?: unknown }).sftp;
    return this.connected && Boolean(rawSftp);
  }

  private resolveTargetPath(remotePathOrRel: string): string {
    const normalized = remotePathOrRel.replace(/\\/g, '/').trim();
    if (normalized.startsWith('/')) {
      return normalized;
    }
    return joinPosixRemote(this.profile.remotePath, normalized);
  }

  async connect(): Promise<void> {
    if (this.isAlive()) return;
    const host = this.profile.host?.trim();
    const port = this.profile.port || 22;
    if (!host) {
      throw new Error(`Host SFTP belum diisi pada profil "${this.profile.name}".`);
    }

    // Fresh SftpClient instance if previous socket closed
    this.client = new SftpClient();
    this.attachLifecycleListeners(this.client);

    const config = await buildSshConnectConfig(this.profile, this.secrets);

    try {
      await this.client.connect(config);
      this.connected = true;
    } catch (err) {
      this.connected = false;
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Tidak dapat terhubung ke SFTP "${this.profile.name}" (${host}:${port}) — ${raw}`
      );
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      await this.client.end();
    } catch {
      // Ignore already closed socket
    }
  }

  async checkAbsoluteOrRelExists(remotePathOrRel: string): Promise<boolean> {
    const target = this.resolveTargetPath(remotePathOrRel);
    try {
      const ex = await this.client.exists(target);
      return Boolean(ex && ex !== 'd');
    } catch {
      return false;
    }
  }

  async readTailText(
    remotePathOrRel: string,
    maxBytes = 65536
  ): Promise<{ content: string; size: number; exists: boolean }> {
    const target = this.resolveTargetPath(remotePathOrRel);
    const ex = await this.client.exists(target);
    if (!ex || ex === 'd') {
      return { content: '', size: 0, exists: false };
    }
    const st = await this.client.stat(target);
    const size = Number(st.size) || 0;
    if (size === 0) {
      return { content: '', size: 0, exists: true };
    }

    if (size <= maxBytes) {
      const buf = await this.client.get(target);
      const content = Buffer.isBuffer(buf) ? buf.toString('utf-8') : String(buf);
      return { content, size, exists: true };
    }

    const startOffset = Math.max(0, size - maxBytes);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolveStream, rejectStream) => {
      const stream = this.client.createReadStream(target, {
        start: startOffset,
        end: size - 1
      });
      stream.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', () => resolveStream());
      stream.on('error', (err: Error) => rejectStream(err));
    });

    return {
      content: Buffer.concat(chunks).toString('utf-8'),
      size,
      exists: true
    };
  }

  async listDirectory(remoteSubPath = ''): Promise<RemoteEntry[]> {
    const target = joinPosixRemote(this.profile.remotePath, remoteSubPath);
    const items = await this.client.list(target);
    const entries: RemoteEntry[] = items
      .filter((item) => item.name !== '.' && item.name !== '..')
      .map((item) => {
        const rel = remoteSubPath
          ? `${remoteSubPath.replace(/^\/+|\/+$/g, '')}/${item.name}`
          : item.name;
        return {
          name: item.name,
          path: joinPosixRemote(target, item.name),
          relativePath: rel,
          isDirectory: item.type === 'd',
          size: item.size,
          mtimeMs: item.modifyTime,
          permissions: rightsToOctal(item.rights)
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
    const base = joinPosixRemote(this.profile.remotePath, '');

    const walk = async (currentPosix: string, relPrefix: string): Promise<void> => {
      let list;
      try {
        list = await this.client.list(currentPosix);
      } catch (err) {
        if (relPrefix === '') {
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
        if (item.type === 'd') {
          await walk(fullRemote, relPath);
        } else if (item.type === '-') {
          entries.push({
            name: item.name,
            path: fullRemote,
            relativePath: relPath,
            isDirectory: false,
            size: item.size,
            mtimeMs: item.modifyTime
          });
        }
      }
    };

    const exists = await this.client.exists(base);
    if (!exists) {
      if (options?.requireRootExists) {
        throw new Error(
          `Direktori remote "${base}" tidak ditemukan di server SFTP "${this.profile.name}" (${this.profile.host}).`
        );
      }
      return { entries, ignoredCount };
    }

    await walk(base, '');
    return { entries, ignoredCount };
  }

  async readFileText(remoteRelativePath: string): Promise<string> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    const buf = await this.client.get(fullRemote);
    if (Buffer.isBuffer(buf)) return buf.toString('utf-8');
    return String(buf);
  }

  async writeFileText(remoteRelativePath: string, content: string): Promise<void> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    const parentRemote = posix.dirname(fullRemote);
    await this.client.mkdir(parentRemote, true);
    await this.client.put(Buffer.from(content, 'utf-8'), fullRemote);
  }

  async createEntry(
    remoteRelativePath: string,
    isDirectory: boolean,
    initialContent = ''
  ): Promise<void> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    const alreadyExists = await this.client.exists(fullRemote);
    if (alreadyExists) {
      throw new Error(`File atau folder sudah ada di server: ${remoteRelativePath}`);
    }
    if (isDirectory) {
      await this.client.mkdir(fullRemote, true);
    } else {
      const parentRemote = posix.dirname(fullRemote);
      await this.client.mkdir(parentRemote, true);
      await this.client.put(Buffer.from(initialContent, 'utf-8'), fullRemote);
    }
  }

  async renameEntry(oldRelativePath: string, newRelativePath: string): Promise<void> {
    const oldFull = joinPosixRemote(this.profile.remotePath, oldRelativePath);
    const newFull = joinPosixRemote(this.profile.remotePath, newRelativePath);
    const destExists = await this.client.exists(newFull);
    if (destExists) {
      throw new Error(`Nama tujuan sudah digunakan di server: ${newRelativePath}`);
    }
    await this.client.mkdir(posix.dirname(newFull), true);
    await this.client.rename(oldFull, newFull);
  }

  async deleteEntry(remoteRelativePath: string, isDirectory: boolean): Promise<void> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    if (isDirectory) {
      await this.client.rmdir(fullRemote, true);
    } else {
      await this.client.delete(fullRemote);
    }
  }

  async chmodEntry(remoteRelativePath: string, modeOctal: string): Promise<void> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    const clean = modeOctal.replace(/[^0-7]/g, '') || '644';
    await this.client.chmod(fullRemote, parseInt(clean, 8));
  }

  async uploadFile(localFilePath: string, remoteRelativePath: string): Promise<void> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    const parentRemote = posix.dirname(fullRemote);
    await this.client.mkdir(parentRemote, true);
    await this.client.fastPut(localFilePath, fullRemote);
  }

  async downloadFile(remoteRelativePath: string, localFilePath: string): Promise<void> {
    const fullRemote = joinPosixRemote(this.profile.remotePath, remoteRelativePath);
    await mkdir(dirname(localFilePath), { recursive: true });
    await this.client.fastGet(fullRemote, localFilePath);
  }
}
