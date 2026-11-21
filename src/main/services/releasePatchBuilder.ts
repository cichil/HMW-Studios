import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';

export interface ZipFileEntryInput {
  relativePath: string;
  data: Buffer | string;
  mtime?: Date;
}

export interface PatchCandidateFile {
  relativePath: string;
  fullPath: string;
  sizeBytes: number;
  mtimeMs: number;
  reason: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDosDateTime(dt: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, dt.getFullYear());
  const month = dt.getMonth() + 1;
  const day = dt.getDate();
  const hours = dt.getHours();
  const mins = dt.getMinutes();
  const secs = Math.floor(dt.getSeconds() / 2);
  return {
    dosTime: ((hours & 0x1f) << 11) | ((mins & 0x3f) << 5) | (secs & 0x1f),
    dosDate: (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
  };
}

/**
 * Pure Node.js PKZIP (.zip) archive builder preserving nested folder paths.
 */
export function buildZipArchiveBuffer(entries: ZipFileEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const cleanRel = entry.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanRel, 'utf-8');
    const rawBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf-8');
    const compressed = deflateRawSync(rawBuf);
    const checksum = crc32(rawBuf);
    const { dosTime, dosDate } = dateToDosDateTime(entry.mtime ?? new Date());

    // Local file header (30 bytes + filename)
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4); // version needed 2.0
    localHdr.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHdr.writeUInt16LE(8, 8); // Deflate
    localHdr.writeUInt16LE(dosTime, 10);
    localHdr.writeUInt16LE(dosDate, 12);
    localHdr.writeUInt32LE(checksum, 14);
    localHdr.writeUInt32LE(compressed.length, 18);
    localHdr.writeUInt32LE(rawBuf.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    localParts.push(localHdr, nameBuf, compressed);

    // Central directory header (46 bytes + filename)
    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0x0800, 8);
    centralHdr.writeUInt16LE(8, 10);
    centralHdr.writeUInt16LE(dosTime, 12);
    centralHdr.writeUInt16LE(dosDate, 14);
    centralHdr.writeUInt32LE(checksum, 16);
    centralHdr.writeUInt32LE(compressed.length, 20);
    centralHdr.writeUInt32LE(rawBuf.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    centralHdr.writeUInt32LE(0, 38);
    centralHdr.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHdr, nameBuf);
    localOffset += localHdr.length + nameBuf.length + compressed.length;
  }

  const centralSize = centralParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const IGNORED_PATCH_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'release',
  'dist',
  'out',
  '.idea',
  '.vscode'
]);

export async function scanModifiedFilesSince(
  workspacePath: string,
  sinceEpochMs: number,
  maxFiles = 500
): Promise<PatchCandidateFile[]> {
  const results: PatchCandidateFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (results.length >= maxFiles) break;
      if (ent.isDirectory()) {
        if (IGNORED_PATCH_DIRS.has(ent.name)) continue;
        await walk(join(dir, ent.name));
      } else if (ent.isFile()) {
        const fullPath = join(dir, ent.name);
        try {
          const st = await stat(fullPath);
          if (st.mtimeMs >= sinceEpochMs && st.size <= 25 * 1024 * 1024) {
            const rel = relative(workspacePath, fullPath).replace(/\\/g, '/');
            results.push({
              relativePath: rel,
              fullPath,
              sizeBytes: st.size,
              mtimeMs: st.mtimeMs,
              reason: `Diubah ${new Date(st.mtimeMs).toLocaleString('id-ID')}`
            });
          }
        } catch {
          // Ignore unreadable
        }
      }
    }
  }

  await walk(workspacePath);
  return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function createReleasePatchZipBuffer(opts: {
  workspacePath: string;
  relativePaths: string[];
  releaseTitle?: string;
  migrationSql?: string;
}): Promise<{ buffer: Buffer; fileCount: number }> {
  const zipInputs: ZipFileEntryInput[] = [];
  const manifestLines: string[] = [];

  for (const rel of opts.relativePaths) {
    const cleanRel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = join(opts.workspacePath, cleanRel);
    try {
      const [buf, st] = await Promise.all([readFile(full), stat(full)]);
      zipInputs.push({
        relativePath: cleanRel,
        data: buf,
        mtime: st.mtime
      });
      manifestLines.push(`- ${cleanRel} (${(buf.length / 1024).toFixed(1)} KB)`);
    } catch {
      // Skip deleted/missing file
    }
  }

  if (opts.migrationSql && opts.migrationSql.trim()) {
    const sqlBytes = Buffer.from(opts.migrationSql.trim() + '\n', 'utf-8');
    zipInputs.push({
      relativePath: '_sql_migrasi/migrasi_patch.sql',
      data: sqlBytes
    });
    manifestLines.push(`- _sql_migrasi/migrasi_patch.sql (${sqlBytes.length} B)`);
  }

  const releaseNote = [
    `==========================================================`,
    `PAKET RILIS / PATCH — ${opts.releaseTitle?.trim() || 'Update Aplikasi'}`,
    `Dibuat oleh HMW Studio pada: ${new Date().toLocaleString('id-ID')}`,
    `Jumlah File: ${zipInputs.length}`,
    `==========================================================`,
    ``,
    `Daftar File dalam Paket Patch:`,
    ...manifestLines,
    ``,
    `Petunjuk Deploy:`,
    `1. Ekstrak seluruh isi arsip .zip ini ke root folder aplikasi di server tujuan.`,
    opts.migrationSql?.trim()
      ? `2. Jalankan script _sql_migrasi/migrasi_patch.sql pada database tujuan.`
      : `2. Tidak ada migrasi struktur database pada patch ini.`
  ].join('\r\n');

  zipInputs.push({
    relativePath: 'CATATAN_RILIS.txt',
    data: releaseNote
  });

  return {
    buffer: buildZipArchiveBuffer(zipInputs),
    fileCount: zipInputs.length
  };
}
