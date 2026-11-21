import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { simpleGit, type DefaultLogFields } from 'simple-git';
import type {
  GitCommitInfo,
  GitFileChange,
  GitLineBlameInfo,
  GitStatusSummary
} from '@shared/types';

export class GitService {
  private mapCode(code: string): GitFileChange['status'] {
    const trimmed = code.trim();
    if (trimmed === 'M') return 'M';
    if (trimmed === 'A') return 'A';
    if (trimmed === 'D') return 'D';
    if (trimmed === 'R') return 'R';
    if (trimmed === 'U') return 'U';
    return '?';
  }

  async status(workspacePath: string): Promise<GitStatusSummary> {
    const root = resolve(workspacePath);
    if (!existsSync(root)) {
      return {
        isRepo: false,
        branch: '',
        branches: [],
        ahead: 0,
        behind: 0,
        changes: [],
        recentCommits: []
      };
    }

    const git = simpleGit(root);
    let isRepo = false;
    try {
      isRepo = await git.checkIsRepo();
    } catch {
      isRepo = false;
    }

    if (!isRepo) {
      return {
        isRepo: false,
        branch: '',
        branches: [],
        ahead: 0,
        behind: 0,
        changes: [],
        recentCommits: []
      };
    }

    const [st, branchSummary] = await Promise.all([
      git.status(),
      git.branchLocal().catch(() => ({ all: [] as string[], current: '' }))
    ]);

    const changes: GitFileChange[] = [];
    for (const f of st.files) {
      const idx = f.index || ' ';
      const wd = f.working_dir || ' ';
      if (idx !== ' ' && idx !== '?') {
        changes.push({
          path: f.path,
          status: this.mapCode(idx),
          staged: true
        });
      }
      if (wd !== ' ') {
        changes.push({
          path: f.path,
          status: wd === '?' ? '?' : this.mapCode(wd),
          staged: false
        });
      }
    }

    let recentCommits: GitCommitInfo[] = [];
    try {
      const log = await git.log({ maxCount: 10 });
      recentCommits = log.all.map((entry: DefaultLogFields) => ({
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        message: entry.message,
        author: entry.author_name,
        date: entry.date
      }));
    } catch {
      // Empty repo with zero commits yet
      recentCommits = [];
    }

    return {
      isRepo: true,
      branch: st.current || branchSummary.current || 'main',
      branches: branchSummary.all.length > 0 ? branchSummary.all : [st.current || 'main'],
      ahead: st.ahead,
      behind: st.behind,
      changes,
      recentCommits
    };
  }

  async init(workspacePath: string): Promise<GitStatusSummary> {
    const root = resolve(workspacePath);
    const git = simpleGit(root);
    await git.init();
    return this.status(root);
  }

  async stage(workspacePath: string, paths: string[]): Promise<GitStatusSummary> {
    const root = resolve(workspacePath);
    const git = simpleGit(root);
    await git.add(paths);
    return this.status(root);
  }

  async unstage(workspacePath: string, paths: string[]): Promise<GitStatusSummary> {
    const root = resolve(workspacePath);
    const git = simpleGit(root);
    try {
      await git.reset(['HEAD', '--', ...paths]);
    } catch {
      await git.raw(['rm', '--cached', ...paths]);
    }
    return this.status(root);
  }

  async commit(workspacePath: string, message: string): Promise<GitStatusSummary> {
    const root = resolve(workspacePath);
    const git = simpleGit(root);
    await git.commit(message);
    return this.status(root);
  }

  async checkout(
    workspacePath: string,
    branch: string,
    createNew = false
  ): Promise<GitStatusSummary> {
    const root = resolve(workspacePath);
    const git = simpleGit(root);
    if (createNew) {
      await git.checkoutLocalBranch(branch);
    } else {
      await git.checkout(branch);
    }
    return this.status(root);
  }

  async pull(workspacePath: string): Promise<{ ok: boolean; summary: string }> {
    const git = simpleGit(resolve(workspacePath));
    try {
      const res = await git.pull();
      return {
        ok: true,
        summary: `Pull selesai (${res.summary.changes} perubahan, +${res.summary.insertions}/-${res.summary.deletions})`
      };
    } catch (err) {
      return { ok: false, summary: err instanceof Error ? err.message : String(err) };
    }
  }

  async push(workspacePath: string): Promise<{ ok: boolean; summary: string }> {
    const git = simpleGit(resolve(workspacePath));
    try {
      await git.push();
      return { ok: true, summary: 'Push berhasil dikirim ke remote repository.' };
    } catch (err) {
      return { ok: false, summary: err instanceof Error ? err.message : String(err) };
    }
  }

  async fileDiff(
    workspacePath: string,
    relativePath: string
  ): Promise<{ original: string; modified: string }> {
    const root = resolve(workspacePath);
    const git = simpleGit(root);
    const cleanRel = relativePath.replace(/\\/g, '/');

    let original = '';
    try {
      original = await git.show([`HEAD:${cleanRel}`]);
    } catch {
      original = '';
    }

    let modified = '';
    const fullTarget = resolve(root, cleanRel);
    if (existsSync(fullTarget)) {
      try {
        modified = await readFile(fullTarget, 'utf-8');
      } catch {
        modified = '';
      }
    }

    return { original, modified };
  }

  async blameLine(
    workspacePath: string,
    relativePath: string,
    line: number
  ): Promise<GitLineBlameInfo | null> {
    if (!workspacePath || !relativePath || !Number.isFinite(line) || line < 1) {
      return null;
    }
    const root = resolve(workspacePath);
    if (!existsSync(root)) return null;
    const cleanRel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const fullTarget = resolve(root, cleanRel);
    if (!existsSync(fullTarget)) return null;

    const git = simpleGit(root);
    try {
      const raw = await git.raw([
        'blame',
        '-L',
        `${Math.floor(line)},${Math.floor(line)}`,
        '--porcelain',
        '--',
        cleanRel
      ]);
      if (!raw) return null;
      const lines = raw.split(/\r?\n/);
      const headerHash = lines[0]?.split(/\s+/)[0] ?? '';
      if (!headerHash || /^0+$/.test(headerHash)) {
        return {
          hash: headerHash || '0000000',
          shortHash: 'local',
          author: 'Belum di-commit',
          dateIso: new Date().toISOString().slice(0, 10),
          relativeTime: 'perubahan lokal',
          summary: 'Baris belum di-commit'
        };
      }

      let author = '';
      let authorTimeSec = 0;
      let summary = '';
      for (const l of lines) {
        if (l.startsWith('author ')) {
          author = l.slice('author '.length).trim();
        } else if (l.startsWith('author-time ')) {
          authorTimeSec = Number.parseInt(l.slice('author-time '.length).trim(), 10) || 0;
        } else if (l.startsWith('summary ')) {
          summary = l.slice('summary '.length).trim();
        }
      }
      if (!author && !summary) return null;

      const commitDate = authorTimeSec > 0 ? new Date(authorTimeSec * 1000) : new Date();
      const dateIso = commitDate.toISOString().slice(0, 10);
      const diffDays = Math.max(
        0,
        Math.floor((Date.now() - commitDate.getTime()) / (1000 * 60 * 60 * 24))
      );
      const relativeTime =
        diffDays === 0
          ? 'hari ini'
          : diffDays === 1
            ? 'kemarin'
            : diffDays < 30
              ? `${diffDays} hari lalu`
              : diffDays < 365
                ? `${Math.floor(diffDays / 30)} bln lalu`
                : `${Math.floor(diffDays / 365)} thn lalu`;

      return {
        hash: headerHash,
        shortHash: headerHash.slice(0, 7),
        author: author || 'Unknown',
        dateIso,
        relativeTime,
        summary: summary || '(tanpa pesan commit)'
      };
    } catch {
      return null;
    }
  }
}
