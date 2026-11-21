import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Client as SshClient, type ClientChannel, type ConnectConfig } from 'ssh2';
import type {
  TerminalCreateOptions,
  TerminalSessionInfo,
  TerminalShellKind
} from '@shared/types';
import type { ConnectionManager } from './connections';

interface ManagedSession {
  info: TerminalSessionInfo;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

interface NodePtyLike {
  spawn: (
    file: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ) => {
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: (e: { exitCode: number }) => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
  };
}

function resolveShellExecutable(shellKind: TerminalShellKind = 'default'): {
  cmd: string;
  args: string[];
  label: string;
} {
  if (process.platform === 'win32') {
    if (shellKind === 'cmd') {
      return { cmd: 'cmd.exe', args: [], label: 'Command Prompt' };
    }
    if (shellKind === 'git-bash') {
      const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
      if (existsSync(gitBash)) {
        return { cmd: gitBash, args: ['--login', '-i'], label: 'Git Bash' };
      }
    }
    if (shellKind === 'wsl') {
      return { cmd: 'wsl.exe', args: [], label: 'WSL' };
    }
    return { cmd: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' };
  }

  const sh = process.env.SHELL || '/bin/bash';
  return { cmd: sh, args: ['-i'], label: sh.split('/').pop() || 'Shell' };
}

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly dataListeners = new Set<(payload: { id: string; data: string }) => void>();
  private readonly exitListeners = new Set<(payload: { id: string; exitCode: number }) => void>();
  private readonly connectionManager: ConnectionManager;
  private ptyModuleLoaded = false;
  private ptyModule: NodePtyLike | null = null;

  constructor(connectionManager: ConnectionManager) {
    this.connectionManager = connectionManager;
  }

  private async getNodePty(): Promise<NodePtyLike | null> {
    if (this.ptyModuleLoaded) return this.ptyModule;
    this.ptyModuleLoaded = true;
    try {
      const mod = await import('@lydell/node-pty');
      this.ptyModule = (mod.default ?? mod) as unknown as NodePtyLike;
    } catch {
      this.ptyModule = null;
    }
    return this.ptyModule;
  }

  onData(cb: (payload: { id: string; data: string }) => void): () => void {
    this.dataListeners.add(cb);
    return () => this.dataListeners.delete(cb);
  }

  onExit(cb: (payload: { id: string; exitCode: number }) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  private emitData(id: string, data: string): void {
    for (const fn of this.dataListeners) fn({ id, data });
  }

  private emitExit(id: string, exitCode: number): void {
    for (const fn of this.exitListeners) fn({ id, exitCode });
  }

  async create(options: TerminalCreateOptions): Promise<TerminalSessionInfo> {
    if (options.kind === 'ssh' && options.connectionId) {
      return this.createSshSession(options.connectionId, options.cols ?? 100, options.rows ?? 28);
    }
    return this.createLocalSession(options);
  }

  private async createLocalSession(options: TerminalCreateOptions): Promise<TerminalSessionInfo> {
    const id = `term-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cwd = options.cwd && existsSync(options.cwd) ? options.cwd : homedir();
    const { cmd, args, label } = resolveShellExecutable(options.shell);
    const cols = options.cols ?? 100;
    const rows = options.rows ?? 28;

    const pty = await this.getNodePty();
    if (pty) {
      try {
        const proc = pty.spawn(cmd, args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...(process.env as Record<string, string>), TERM: 'xterm-256color' }
        });

        const info: TerminalSessionInfo = {
          id,
          title: label,
          kind: 'local',
          backend: 'conpty',
          cwd
        };

        proc.onData((data) => this.emitData(id, data));
        proc.onExit(({ exitCode }) => {
          this.sessions.delete(id);
          this.emitExit(id, exitCode);
        });

        this.sessions.set(id, {
          info,
          write: (data) => proc.write(data),
          resize: (c, r) => {
            try {
              proc.resize(Math.max(20, c), Math.max(5, r));
            } catch {
              // Ignore resize race
            }
          },
          close: () => {
            try {
              proc.kill();
            } catch {
              // Ignore
            }
            this.sessions.delete(id);
          }
        });

        return info;
      } catch {
        // Fallback to child_process interactive bridge below
      }
    }

    // Fallback interactive shell session (works on every system without native addons)
    const fallbackArgs =
      cmd.toLowerCase().includes('powershell') ? ['-NoLogo', '-NoExit'] : args;
    const child: ChildProcessWithoutNullStreams = spawn(cmd, fallbackArgs, {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      windowsHide: true
    });

    const info: TerminalSessionInfo = {
      id,
      title: `${label}`,
      kind: 'local',
      backend: 'stdio-bridge',
      cwd
    };

    let lineBuffer = '';
    setTimeout(() => {
      this.emitData(
        id,
        `\x1b[38;5;208m[HMW Terminal]\x1b[0m Sesi ${label} aktif di \x1b[36m${cwd}\x1b[0m\r\n$ `
      );
    }, 50);

    child.stdout.on('data', (chunk: Buffer) => {
      const normalized = chunk.toString('utf-8').replace(/\r?\n/g, '\r\n');
      this.emitData(id, normalized);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const normalized = chunk.toString('utf-8').replace(/\r?\n/g, '\r\n');
      this.emitData(id, `\x1b[31m${normalized}\x1b[0m`);
    });
    child.on('close', (code) => {
      this.sessions.delete(id);
      this.emitExit(id, code ?? 0);
    });

    this.sessions.set(id, {
      info,
      write: (data: string) => {
        for (const ch of data) {
          if (ch === '\r' || ch === '\n') {
            this.emitData(id, '\r\n');
            child.stdin.write(lineBuffer + '\n');
            lineBuffer = '';
          } else if (ch === '\u007f' || ch === '\b') {
            if (lineBuffer.length > 0) {
              lineBuffer = lineBuffer.slice(0, -1);
              this.emitData(id, '\b \b');
            }
          } else if (ch === '\u0003') {
            lineBuffer = '';
            this.emitData(id, '^C\r\n$ ');
          } else {
            lineBuffer += ch;
            this.emitData(id, ch);
          }
        }
      },
      resize: () => {
        // Not needed for stdio stream fallback
      },
      close: () => {
        child.kill();
        this.sessions.delete(id);
      }
    });

    return info;
  }

  private async createSshSession(
    connectionId: string,
    cols: number,
    rows: number
  ): Promise<TerminalSessionInfo> {
    const profile = await this.connectionManager.getById(connectionId);
    if (profile.protocol !== 'sftp') {
      throw new Error('Terminal SSH hanya tersedia untuk koneksi berprotokol SFTP/SSH2.');
    }
    const secrets = await this.connectionManager.getSecrets(connectionId);
    const id = `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ssh = new SshClient();

    const config: ConnectConfig = {
      host: profile.host,
      port: profile.port || 22,
      username: profile.username,
      readyTimeout: 15000
    };

    if (profile.authType === 'privateKey' && profile.privateKeyPath) {
      config.privateKey = await readFile(profile.privateKeyPath);
      if (secrets.passphrase) config.passphrase = secrets.passphrase;
    } else if (secrets.password) {
      config.password = secrets.password;
    }

    const channel = await new Promise<ClientChannel>((resolveChannel, rejectChannel) => {
      ssh
        .on('ready', () => {
          ssh.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
            if (err) {
              ssh.end();
              rejectChannel(err);
              return;
            }
            resolveChannel(stream);
          });
        })
        .on('error', (err) => {
          rejectChannel(err);
        })
        .connect(config);
    });

    const info: TerminalSessionInfo = {
      id,
      title: `SSH: ${profile.name}`,
      kind: 'ssh',
      backend: 'ssh2-pty',
      connectionId
    };

    channel.on('data', (chunk: Buffer) => {
      this.emitData(id, chunk.toString('utf-8'));
    });
    channel.stderr.on('data', (chunk: Buffer) => {
      this.emitData(id, chunk.toString('utf-8'));
    });
    channel.on('close', () => {
      ssh.end();
      this.sessions.delete(id);
      this.emitExit(id, 0);
    });

    this.sessions.set(id, {
      info,
      write: (data: string) => channel.write(data),
      resize: (c: number, r: number) => channel.setWindow(r, c, 0, 0),
      close: () => {
        channel.close();
        ssh.end();
        this.sessions.delete(id);
      }
    });

    return info;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  close(id: string): void {
    this.sessions.get(id)?.close();
  }

  closeAll(): void {
    for (const s of this.sessions.values()) {
      s.close();
    }
    this.sessions.clear();
  }

  async runCommand(
    commandLine: string,
    cwd: string
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolveResult) => {
      const isWin = process.platform === 'win32';
      const shellExe = isWin ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWin ? ['/d', '/s', '/c', commandLine] : ['-c', commandLine];
      const child = spawn(shellExe, shellArgs, {
        cwd: existsSync(cwd) ? cwd : homedir(),
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf-8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf-8');
      });
      child.on('close', (code) => {
        resolveResult({ stdout, stderr, code: code ?? 0 });
      });
      child.on('error', (err) => {
        resolveResult({ stdout, stderr: err.message, code: 1 });
      });
    });
  }
}
