import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type {
  FileNode,
  FileReadResult,
  LearnedJoinEdgeDto,
  ReplaceInFilesOptions,
  ReplaceInFilesResult,
  SearchMatch,
  TodoCommentItem,
  WebSymbolCatalog,
  WorkspaceChangeEvent
} from '@shared/types';
import { learnJoinEdgesFromSources } from '@shared/sqlJoinHelper';
import {
  extractWebSymbolsFromSource,
  mergeWebSymbolCatalogs
} from '@shared/webAssetAnalyzer';

const EXPLORER_SKIP_DIRS = new Set(['.git']);
const SEARCH_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'release']);
const MAX_READ_BYTES = 5 * 1024 * 1024; // 5 MB safety guard for text editor

export function normalizeRelPath(rootPath: string, fullPath: string): string {
  return relative(rootPath, fullPath).replace(/\\/g, '/');
}

export class WorkspaceService {
  private watcher: FSWatcher | null = null;
  private currentRoot: string | null = null;

  async listTree(rootPath: string, maxDepth = 6): Promise<FileNode[]> {
    const resolvedRoot = resolve(rootPath);
    return this.walkDir(resolvedRoot, resolvedRoot, 0, maxDepth);
  }

  private async walkDir(
    rootPath: string,
    currentDir: string,
    depth: number,
    maxDepth: number
  ): Promise<FileNode[]> {
    if (depth > maxDepth) return [];
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes: FileNode[] = [];
    for (const entry of entries) {
      if (EXPLORER_SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(currentDir, entry.name);
      let st;
      try {
        st = await stat(fullPath);
      } catch {
        continue;
      }

      const isDir = entry.isDirectory();
      const relPath = normalizeRelPath(rootPath, fullPath);
      const node: FileNode = {
        name: entry.name,
        path: fullPath,
        relativePath: relPath,
        isDirectory: isDir,
        size: isDir ? 0 : st.size,
        mtimeMs: st.mtimeMs,
        extension: isDir ? '' : extname(entry.name).toLowerCase()
      };

      if (isDir) {
        // Expand shallowly for node_modules to keep UI instant
        if (entry.name === 'node_modules') {
          node.children = [];
        } else {
          node.children = await this.walkDir(rootPath, fullPath, depth + 1, maxDepth);
        }
      }
      nodes.push(node);
    }

    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });

    return nodes;
  }

  async readFile(filePath: string): Promise<FileReadResult> {
    const resolved = resolve(filePath);
    const st = await stat(resolved);
    if (st.size > MAX_READ_BYTES) {
      return {
        path: resolved,
        content: `/* File terlalu besar (${(st.size / 1024 / 1024).toFixed(2)} MB) untuk dibuka langsung di editor teks. */`,
        size: st.size,
        mtimeMs: st.mtimeMs,
        encoding: 'utf-8',
        isBinary: false
      };
    }

    const buf = await readFile(resolved);
    const sampleLength = Math.min(buf.length, 4096);
    let isBinary = false;
    for (let i = 0; i < sampleLength; i++) {
      if (buf[i] === 0) {
        isBinary = true;
        break;
      }
    }

    return {
      path: resolved,
      content: isBinary ? '' : buf.toString('utf-8'),
      size: st.size,
      mtimeMs: st.mtimeMs,
      encoding: 'utf-8',
      isBinary
    };
  }

  async writeFile(filePath: string, content: string): Promise<{ mtimeMs: number; size: number }> {
    const resolved = resolve(filePath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf-8');
    const st = await stat(resolved);
    return { mtimeMs: st.mtimeMs, size: st.size };
  }

  async createEntry(targetPath: string, isDirectory: boolean, initialContent = ''): Promise<void> {
    const resolved = resolve(targetPath);
    if (isDirectory) {
      await mkdir(resolved, { recursive: true });
    } else {
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, initialContent, 'utf-8');
    }
  }

  async renameEntry(oldPath: string, newPath: string): Promise<void> {
    await mkdir(dirname(resolve(newPath)), { recursive: true });
    await rename(resolve(oldPath), resolve(newPath));
  }

  async deleteEntry(targetPath: string): Promise<void> {
    await rm(resolve(targetPath), { recursive: true, force: true });
  }

  async copyOrMoveEntry(
    sourcePath: string,
    targetDirPath: string,
    mode: 'copy' | 'cut'
  ): Promise<{ destinationPath: string }> {
    const src = resolve(sourcePath);
    const destDir = resolve(targetDirPath);
    const st = await stat(src);
    const isDir = st.isDirectory();
    const rawName = basename(src);

    await mkdir(destDir, { recursive: true });

    let dest = join(destDir, rawName);
    const srcNorm = src.replace(/\\/g, '/').toLowerCase();
    const destNorm = dest.replace(/\\/g, '/').toLowerCase();
    const destDirNorm = destDir.replace(/\\/g, '/').toLowerCase();

    if (mode === 'cut') {
      if (srcNorm === destNorm) {
        return { destinationPath: src };
      }
      if (isDir && (destNorm + '/').startsWith(srcNorm + '/')) {
        throw new Error('Tidak dapat memindahkan folder ke dalam dirinya sendiri.');
      }
      try {
        await rename(src, dest);
      } catch {
        await cp(src, dest, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
      return { destinationPath: dest };
    }

    if (isDir && (destDirNorm === srcNorm || (destDirNorm + '/').startsWith(srcNorm + '/'))) {
      throw new Error('Tidak dapat menyalin folder ke dalam dirinya sendiri.');
    }

    if (srcNorm === destNorm) {
      const ext = isDir ? '' : extname(rawName);
      const stem = ext ? rawName.slice(0, -ext.length) : rawName;
      let idx = 1;
      do {
        const suffix = idx === 1 ? '_copy' : `_copy${idx}`;
        dest = join(destDir, `${stem}${suffix}${ext}`);
        idx += 1;
      } while (existsSync(dest));
    }

    await cp(src, dest, { recursive: true, force: true });
    return { destinationPath: dest };
  }

  async searchInFiles(
    rootPath: string,
    query: string,
    caseSensitive = false,
    maxResults = 250
  ): Promise<SearchMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const resolvedRoot = resolve(rootPath);
    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    const results: SearchMatch[] = [];

    const scan = async (dir: string): Promise<void> => {
      if (results.length >= maxResults) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) return;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP_DIRS.has(entry.name)) {
            await scan(fullPath);
          }
          continue;
        }

        try {
          const st = await stat(fullPath);
          if (st.size > 1024 * 1024) continue;
          const buf = await readFile(fullPath);
          if (buf.subarray(0, Math.min(buf.length, 1024)).includes(0)) continue;

          const lines = buf.toString('utf-8').split(/\r?\n/);
          for (let idx = 0; idx < lines.length; idx++) {
            const lineText = lines[idx];
            const hay = caseSensitive ? lineText : lineText.toLowerCase();
            const col = hay.indexOf(needle);
            if (col !== -1) {
              results.push({
                filePath: fullPath,
                relativePath: normalizeRelPath(resolvedRoot, fullPath),
                line: idx + 1,
                column: col + 1,
                lineText: lineText.slice(0, 240)
              });
              if (results.length >= maxResults) return;
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    };

    await scan(resolvedRoot);
    return results;
  }

  async replaceInFiles(
    rootPath: string,
    query: string,
    replacement: string,
    options?: ReplaceInFilesOptions,
    onBeforeModify?: (fullPath: string, relPath: string, originalContent: string) => Promise<void>
  ): Promise<ReplaceInFilesResult> {
    if (!query) {
      return { filesModified: 0, occurrencesReplaced: 0, modifiedRelPaths: [], errors: [] };
    }
    const resolvedRoot = resolve(rootPath);
    const caseSensitive = Boolean(options?.caseSensitive);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');

    let candidateFiles: Array<{ fullPath: string; relPath: string }> = [];
    if (options?.includeRelPaths && options.includeRelPaths.length > 0) {
      const uniqueRel = Array.from(
        new Set(options.includeRelPaths.map((p) => p.replace(/^[/\\]+/, '').replace(/\\/g, '/')))
      );
      candidateFiles = uniqueRel.map((relPath) => ({
        fullPath: resolve(resolvedRoot, relPath),
        relPath
      }));
    } else {
      const matches = await this.searchInFiles(resolvedRoot, query, caseSensitive, 1000);
      const seen = new Set<string>();
      for (const m of matches) {
        if (!seen.has(m.relativePath)) {
          seen.add(m.relativePath);
          candidateFiles.push({ fullPath: m.filePath, relPath: m.relativePath });
        }
      }
    }

    let filesModified = 0;
    let occurrencesReplaced = 0;
    const modifiedRelPaths: string[] = [];
    const errors: string[] = [];

    for (const item of candidateFiles) {
      try {
        const buf = await readFile(item.fullPath);
        if (buf.subarray(0, Math.min(buf.length, 1024)).includes(0)) continue;
        const original = buf.toString('utf-8');
        let countInFile = 0;
        const updated = original.replace(regex, () => {
          countInFile += 1;
          return replacement;
        });
        if (countInFile > 0 && updated !== original) {
          if (onBeforeModify) {
            await onBeforeModify(item.fullPath, item.relPath, original).catch(() => {});
          }
          await writeFile(item.fullPath, updated, 'utf-8');
          filesModified += 1;
          occurrencesReplaced += countInFile;
          modifiedRelPaths.push(item.relPath);
        }
      } catch (err) {
        errors.push(`${item.relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { filesModified, occurrencesReplaced, modifiedRelPaths, errors };
  }

  async scanTodos(rootPath: string, maxItems = 300): Promise<TodoCommentItem[]> {
    const resolvedRoot = resolve(rootPath);
    const items: TodoCommentItem[] = [];
    const todoRegex = /(?:\/\/|#|\/\*+|<!--)\s*\b(TODO|FIXME|HACK|NOTE)\b\s*[:\-]?\s*(.+?)(?:\*\/|-->)?$/i;

    const scan = async (dir: string): Promise<void> => {
      if (items.length >= maxItems) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (items.length >= maxItems) return;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP_DIRS.has(entry.name) && entry.name !== 'vendor') {
            await scan(fullPath);
          }
          continue;
        }

        try {
          const st = await stat(fullPath);
          if (st.size > 512 * 1024) continue;
          const buf = await readFile(fullPath);
          if (buf.subarray(0, Math.min(buf.length, 1024)).includes(0)) continue;
          const lines = buf.toString('utf-8').split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(todoRegex);
            if (m) {
              const tag = m[1].toUpperCase() as TodoCommentItem['tag'];
              const text = m[2].trim().slice(0, 180);
              items.push({
                filePath: fullPath,
                relativePath: normalizeRelPath(resolvedRoot, fullPath),
                line: i + 1,
                tag,
                text: text || tag
              });
              if (items.length >= maxItems) return;
            }
          }
        } catch {
          // Ignore unreadable
        }
      }
    };

    await scan(resolvedRoot);
    return items;
  }

  async scanJoinEdges(rootPath: string, maxFiles = 220): Promise<LearnedJoinEdgeDto[]> {
    const resolvedRoot = resolve(rootPath);
    const sources: string[] = [];

    const scan = async (dir: string): Promise<void> => {
      if (sources.length >= maxFiles) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (sources.length >= maxFiles) return;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP_DIRS.has(entry.name) && entry.name !== 'vendor') {
            await scan(fullPath);
          }
          continue;
        }
        const ext = extname(entry.name).toLowerCase();
        if (ext !== '.php' && ext !== '.sql') continue;
        try {
          const st = await stat(fullPath);
          if (st.size > 384 * 1024) continue;
          const text = await readFile(fullPath, 'utf-8');
          if (/join/i.test(text)) {
            sources.push(text);
          }
        } catch {
          // Ignore unreadable
        }
      }
    };

    await scan(resolvedRoot);
    return learnJoinEdgesFromSources(sources);
  }

  async scanWebAssets(rootPath: string, maxFiles = 260): Promise<WebSymbolCatalog> {
    const resolvedRoot = resolve(rootPath);
    const catalogs: WebSymbolCatalog[] = [];
    let scannedCount = 0;

    const webExts = new Set([
      '.js',
      '.mjs',
      '.cjs',
      '.jsx',
      '.ts',
      '.tsx',
      '.css',
      '.scss',
      '.less',
      '.html',
      '.htm',
      '.php',
      '.phtml'
    ]);

    const scan = async (dir: string): Promise<void> => {
      if (scannedCount >= maxFiles) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (scannedCount >= maxFiles) return;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            !SEARCH_SKIP_DIRS.has(entry.name) &&
            entry.name !== 'vendor' &&
            entry.name !== 'storage' &&
            entry.name !== 'cache'
          ) {
            await scan(fullPath);
          }
          continue;
        }

        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith('.min.js') || lowerName.endsWith('.min.css')) {
          // Record minified asset path so <script src="..."> / <link href="..."> still auto-completes it!
          const relMin = normalizeRelPath(resolvedRoot, fullPath);
          catalogs.push({
            jsFunctions: [],
            jsClasses: [],
            cssClasses: [],
            cssVariables: [],
            htmlIds: [],
            jsFiles: lowerName.endsWith('.min.js') ? [relMin] : [],
            cssFiles: lowerName.endsWith('.min.css') ? [relMin] : []
          });
          continue;
        }

        const ext = extname(lowerName);
        if (!webExts.has(ext)) continue;

        try {
          const st = await stat(fullPath);
          if (st.size > 384 * 1024) continue;
          const text = await readFile(fullPath, 'utf-8');
          const relPath = normalizeRelPath(resolvedRoot, fullPath);
          catalogs.push(extractWebSymbolsFromSource(text, relPath, fullPath));
          scannedCount++;
        } catch {
          // Ignore unreadable files
        }
      }
    };

    await scan(resolvedRoot);
    return mergeWebSymbolCatalogs(catalogs);
  }

  async watch(
    rootPath: string,
    onEvent: (ev: WorkspaceChangeEvent) => void
  ): Promise<void> {
    await this.stopWatching();
    const resolvedRoot = resolve(rootPath);
    this.currentRoot = resolvedRoot;

    this.watcher = chokidar.watch(resolvedRoot, {
      ignoreInitial: true,
      ignored: (pathStr: string) =>
        pathStr.includes('node_modules') || pathStr.includes('.git')
    });

    const emit = (eventType: WorkspaceChangeEvent['eventType'], targetPath: string): void => {
      if (!this.currentRoot) return;
      onEvent({
        eventType,
        path: targetPath,
        relativePath: normalizeRelPath(this.currentRoot, targetPath)
      });
    };

    this.watcher.on('add', (p) => emit('add', p));
    this.watcher.on('change', (p) => emit('change', p));
    this.watcher.on('unlink', (p) => emit('unlink', p));
    this.watcher.on('addDir', (p) => emit('addDir', p));
    this.watcher.on('unlinkDir', (p) => emit('unlinkDir', p));
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this.currentRoot = null;
    }
  }

  async createSampleProject(baseDir: string): Promise<string> {
    const projectDir = resolve(baseDir);
    await mkdir(join(projectDir, 'assets', 'css'), { recursive: true });
    await mkdir(join(projectDir, 'assets', 'js'), { recursive: true });
    await mkdir(join(projectDir, 'api'), { recursive: true });

    const indexHtml = join(projectDir, 'index.html');
    if (!existsSync(indexHtml)) {
      await writeFile(
        indexHtml,
        `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HMW Studio — Demo Web Workspace</title>
  <link rel="stylesheet" href="./assets/css/style.css" />
</head>
<body>
  <main class="hero-card">
    <span class="badge">HMW Studio</span>
    <h1>Selamat Datang di Workspace Modern</h1>
    <p>
      Edit file HTML5, CSS3, TypeScript/ES2025, atau PHP 8 ini, lihat perubahan secara langsung
      di panel <strong>Live Web Preview</strong>, atau sinkronisasikan ke server melalui
      <strong>Visual SFTP/FTPS Synchronizer</strong>.
    </p>
    <div class="actions">
      <button id="pingBtn" type="button">Uji Interaksi ES2025</button>
      <span id="statusOutput">Siap dijalankan...</span>
    </div>
  </main>
  <script type="module" src="./assets/js/app.js"></script>
</body>
</html>
`,
        'utf-8'
      );

      await writeFile(
        join(projectDir, 'assets', 'css', 'style.css'),
        `:root {
  --bg: #14171f;
  --card: #1e2330;
  --accent: #f97316;
  --text: #f3f4f6;
  --muted: #9ca3af;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at top right, #262f45, var(--bg));
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  padding: 2rem;
}

.hero-card {
  max-width: 640px;
  background: var(--card);
  border: 1px solid rgba(249, 115, 22, 0.35);
  border-radius: 16px;
  padding: 2.25rem;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.45);
}

.badge {
  display: inline-block;
  background: rgba(249, 115, 22, 0.16);
  color: var(--accent);
  border: 1px solid rgba(249, 115, 22, 0.4);
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.3rem 0.75rem;
  border-radius: 999px;
  margin-bottom: 1rem;
}

h1 {
  font-size: 1.85rem;
  margin-bottom: 0.85rem;
}

p {
  color: var(--muted);
  line-height: 1.65;
  margin-bottom: 1.5rem;
}

.actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

button {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0.65rem 1.2rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease, opacity 0.15s ease;
}

button:hover {
  opacity: 0.92;
  transform: translateY(-1px);
}
`,
        'utf-8'
      );

      await writeFile(
        join(projectDir, 'assets', 'js', 'app.js'),
        `const btn = document.querySelector('#pingBtn');
const output = document.querySelector('#statusOutput');

let counter = 0;

btn?.addEventListener('click', () => {
  counter += 1;
  const timestamp = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());

  if (output) {
    output.textContent = \`Klik #\${counter} berhasil pada \${timestamp}\`;
  }
});
`,
        'utf-8'
      );

      await writeFile(
        join(projectDir, 'api', 'status.php'),
        `<?php
declare(strict_types=1);

namespace App\\Api;

enum DeploymentEnvironment: string {
    case Development = 'development';
    case Staging = 'staging';
    case Production = 'production';
}

final readonly class HealthResponse {
    public function __construct(
        public string $service,
        public DeploymentEnvironment $env,
        public string $phpVersion
    ) {}
}

header('Content-Type: application/json; charset=utf-8');
$payload = new HealthResponse(
    service: 'HMW Studio Modern API',
    env: DeploymentEnvironment::Development,
    phpVersion: PHP_VERSION
);

echo json_encode($payload, JSON_PRETTY_PRINT);
`,
        'utf-8'
      );

      await writeFile(
        join(projectDir, '.aptanaignore'),
        `# Pola file yang diabaikan oleh HMW Studio Synchronizer
.git
node_modules
*.log
.DS_Store
Thumbs.db
`,
        'utf-8'
      );
    }

    return projectDir;
  }
}
