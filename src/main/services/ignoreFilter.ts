import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_IGNORE_PATTERNS = [
  '.git',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
  '.aptana-sync-tmp',
  '*.swp'
];

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLE_STAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/___DOUBLE_STAR___/g, '.*');

  if (normalized.includes('/')) {
    return new RegExp(`^${escaped}(?:/.*)?$`, 'i');
  }
  return new RegExp(`(?:^|/)${escaped}(?:/|$)`, 'i');
}

export class IgnoreFilter {
  private readonly matchers: RegExp[];

  constructor(patterns: string[] = DEFAULT_IGNORE_PATTERNS) {
    const cleaned = patterns
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith('#'));
    this.matchers = cleaned.map(globToRegExp);
  }

  static fromWorkspace(workspacePath: string, extraPatterns: string[] = []): IgnoreFilter {
    const patterns = [...DEFAULT_IGNORE_PATTERNS, ...extraPatterns];
    const aptanaIgnorePath = join(workspacePath, '.aptanaignore');
    if (existsSync(aptanaIgnorePath)) {
      try {
        const lines = readFileSync(aptanaIgnorePath, 'utf-8').split(/\r?\n/);
        patterns.push(...lines);
      } catch {
        // Ignore unreadable .aptanaignore
      }
    }
    return new IgnoreFilter(patterns);
  }

  isIgnored(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return false;
    return this.matchers.some((rx) => rx.test(normalized));
  }
}
