import type { DbEngine } from './types';

export interface DbDigestQueryStat {
  digestText: string;
  schemaName: string;
  execCount: number;
  avgLatencyMs: number;
  totalLatencyMs: number;
  rowsExamined: number;
  rowsSent: number;
  noIndexUsedCount: number;
}

export interface DbLockWaitItem {
  waitingPid: number;
  waitingUser: string;
  waitingQuery: string;
  waitSec: number;
  blockingPid?: number;
  blockingUser?: string;
  blockingQuery?: string;
  lockedTable?: string;
}

export interface DbStorageDatabaseSummary {
  database: string;
  tableCount: number;
  rowEstimate: number;
  dataMb: number;
  indexMb: number;
  freeMb: number;
  totalMb: number;
}

export interface DbStorageTableItem {
  database: string;
  table: string;
  engine: string;
  rowEstimate: number;
  dataMb: number;
  indexMb: number;
  freeMb: number;
  totalMb: number;
}

export interface DbTuningAdvisory {
  id: string;
  severity: 'critical' | 'warning' | 'good';
  variableName: string;
  currentValue: string;
  recommendedValue?: string;
  title: string;
  explanation: string;
}

export interface DbHealthSnapshot {
  profileId: string;
  profileName: string;
  engine: DbEngine;
  serverVersion: string;
  uptimeSec: number;
  uptimeLabel: string;
  collectedAtMs: number;
  connections: {
    threadsConnected: number;
    threadsRunning: number;
    maxConnections: number;
    maxUsedConnections: number;
    abortedConnects: number;
    usagePct: number;
  };
  bufferPool: {
    sizeMb: number;
    usedMb: number;
    usagePct: number;
    hitRatioPct: number;
    dirtyPagesPct: number;
  };
  bottlenecks: {
    slowQueries: number;
    selectFullJoin: number;
    tmpTablesTotal: number;
    tmpDiskTables: number;
    tmpDiskRatioPct: number;
    tableLocksWaited: number;
    openedTables: number;
  };
  counters: {
    questions: number;
    comSelect: number;
    comInsert: number;
    comUpdate: number;
    comDelete: number;
    bytesReceived: number;
    bytesSent: number;
    innodbDataReads: number;
    innodbDataWrites: number;
  };
  performanceSchemaEnabled: boolean;
  digestQueries: DbDigestQueryStat[];
  lockWaits: DbLockWaitItem[];
  storageByDb: DbStorageDatabaseSummary[];
  largestTables: DbStorageTableItem[];
  variables: Array<{ name: string; value: string }>;
  advisories: DbTuningAdvisory[];
}

export interface DbRealtimeRatePoint {
  timestampLabel: string;
  qps: number;
  selectPerSec: number;
  writePerSec: number;
  netInKbps: number;
  netOutKbps: number;
  innodbReadsPerSec: number;
  innodbWritesPerSec: number;
}

export function formatUptimeIndonesian(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (days > 0) return `${days} hari ${hours} jam ${mins} mnt`;
  if (hours > 0) return `${hours} jam ${mins} mnt`;
  return `${mins} mnt ${sec % 60} dtk`;
}

export function formatBytesReadable(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function numFromMap(map: Record<string, string>, key: string, fallback = 0): number {
  const raw = map[key] ?? map[key.toLowerCase()];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function strFromMap(map: Record<string, string>, key: string, fallback = ''): string {
  return map[key] ?? map[key.toLowerCase()] ?? fallback;
}

/**
 * Parses MySQL / MariaDB `SHOW GLOBAL STATUS` and `SHOW GLOBAL VARIABLES` maps into
 * MySQL Workbench-grade health gauges, counters, and automated `my.cnf` tuning advisories.
 */
export function parseMysqlStatusAndVariables(
  rawStatus: Record<string, string>,
  rawVars: Record<string, string>,
  meta: {
    profileId: string;
    profileName: string;
    collectedAtMs?: number;
  }
): Omit<
  DbHealthSnapshot,
  'digestQueries' | 'lockWaits' | 'storageByDb' | 'largestTables' | 'variables'
> {
  const status: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawStatus)) {
    status[k.toLowerCase()] = String(v ?? '');
  }
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVars)) {
    vars[k.toLowerCase()] = String(v ?? '');
  }

  const versionComment = strFromMap(vars, 'version_comment');
  const versionNum = strFromMap(vars, 'version', 'MySQL');
  const serverVersion = versionComment
    ? `${versionNum} (${versionComment})`
    : versionNum;

  const uptimeSec = numFromMap(status, 'uptime', 0);
  const threadsConnected = numFromMap(status, 'threads_connected', 0);
  const threadsRunning = numFromMap(status, 'threads_running', 0);
  const maxConnections = Math.max(1, numFromMap(vars, 'max_connections', 151));
  const maxUsedConnections = numFromMap(status, 'max_used_connections', threadsConnected);
  const abortedConnects = numFromMap(status, 'aborted_connects', 0);
  const connUsagePct = Math.min(
    100,
    Number(((threadsConnected / maxConnections) * 100).toFixed(1))
  );

  const pageSize = Math.max(4096, numFromMap(vars, 'innodb_page_size', 16384));
  const bpSizeBytes =
    numFromMap(vars, 'innodb_buffer_pool_size', 0) ||
    numFromMap(status, 'innodb_buffer_pool_pages_total', 0) * pageSize;
  const pagesTotal = Math.max(
    1,
    numFromMap(status, 'innodb_buffer_pool_pages_total', Math.floor(bpSizeBytes / pageSize) || 1)
  );
  const pagesData = numFromMap(status, 'innodb_buffer_pool_pages_data', 0);
  const pagesFree = numFromMap(status, 'innodb_buffer_pool_pages_free', 0);
  const pagesDirty = numFromMap(status, 'innodb_buffer_pool_pages_dirty', 0);
  const usedPages = pagesData > 0 ? pagesData : Math.max(0, pagesTotal - pagesFree);

  const bpSizeMb = Number((bpSizeBytes / (1024 * 1024)).toFixed(1));
  const bpUsedMb = Number(((usedPages * pageSize) / (1024 * 1024)).toFixed(1));
  const bpUsagePct = Math.min(
    100,
    Number(((usedPages / pagesTotal) * 100).toFixed(1))
  );

  const readReqs = numFromMap(status, 'innodb_buffer_pool_read_requests', 0);
  const diskReads = numFromMap(status, 'innodb_buffer_pool_reads', 0);
  const hitRatioPct =
    readReqs > 0
      ? Math.max(0, Math.min(100, Number(((1 - diskReads / readReqs) * 100).toFixed(2))))
      : 100;
  const dirtyPagesPct = Math.min(
    100,
    Number(((pagesDirty / pagesTotal) * 100).toFixed(1))
  );

  const slowQueries = numFromMap(status, 'slow_queries', 0);
  const selectFullJoin = numFromMap(status, 'select_full_join', 0);
  const tmpTablesTotal = numFromMap(status, 'created_tmp_tables', 0);
  const tmpDiskTables = numFromMap(status, 'created_tmp_disk_tables', 0);
  const tmpDiskRatioPct =
    tmpTablesTotal > 0
      ? Math.min(100, Number(((tmpDiskTables / tmpTablesTotal) * 100).toFixed(1)))
      : 0;
  const tableLocksWaited = numFromMap(status, 'table_locks_waited', 0);
  const openedTables = numFromMap(status, 'opened_tables', 0);

  const perfSchemaRaw = strFromMap(vars, 'performance_schema', 'OFF').toUpperCase();
  const performanceSchemaEnabled = perfSchemaRaw === 'ON' || perfSchemaRaw === '1';

  const advisories: DbTuningAdvisory[] = [];

  // 1. Buffer Pool Hit Ratio & Size Check
  if (bpSizeMb > 0 && bpSizeMb <= 128) {
    advisories.push({
      id: 'bp-small',
      severity: bpUsagePct > 85 ? 'critical' : 'warning',
      variableName: 'innodb_buffer_pool_size',
      currentValue: formatBytesReadable(bpSizeBytes),
      recommendedValue: '1G – 4G (50–70% RAM Server DB)',
      title: 'InnoDB Buffer Pool masih ukuran default/kecil (≤ 128 MB)',
      explanation:
        'Buffer Pool yang terlalu kecil memaksa MySQL membaca tabel berulang kali dari disk dan memperlambat kueri JOIN besar.'
    });
  } else if (hitRatioPct < 97 && readReqs > 10000) {
    advisories.push({
      id: 'bp-hit-low',
      severity: hitRatioPct < 90 ? 'critical' : 'warning',
      variableName: 'innodb_buffer_pool_size',
      currentValue: `${formatBytesReadable(bpSizeBytes)} (Hit Ratio ${hitRatioPct}%)`,
      recommendedValue: formatBytesReadable(bpSizeBytes * 2),
      title: `Buffer Pool Hit Ratio rendah (${hitRatioPct}% < ideal 99%)`,
      explanation:
        'Banyak pembacaan halaman data meleset dari RAM dan jatuh ke disk fisik. Pertimbangkan menaikkan innodb_buffer_pool_size.'
    });
  } else {
    advisories.push({
      id: 'bp-healthy',
      severity: 'good',
      variableName: 'innodb_buffer_pool_size',
      currentValue: `${formatBytesReadable(bpSizeBytes)} (Hit Ratio ${hitRatioPct}%)`,
      title: `InnoDB Buffer Pool sangat sehat (Hit Ratio ${hitRatioPct}%)`,
      explanation:
        'Hampir seluruh permintaan baca tabel dilayani langsung dari memori RAM tanpa hambatan I/O disk.'
    });
  }

  // 2. Full Join Without Index Check
  if (selectFullJoin > 0) {
    advisories.push({
      id: 'full-join',
      severity: selectFullJoin > 250 ? 'critical' : 'warning',
      variableName: 'Select_full_join',
      currentValue: `${selectFullJoin.toLocaleString('id-ID')} kueri JOIN tanpa indeks`,
      recommendedValue: '0 (Tambahkan INDEX pada kolom ON)',
      title: 'Terdeteksi JOIN Tabel tanpa Indeks (Full Table Scan Join)',
      explanation:
        'Terdapat kueri JOIN yang memindai seluruh baris tabel karena kolom penghubung ON belum memiliki INDEX. Buka tab Top Slow SQL untuk melihat kuerinya.'
    });
  }

  // 3. Temp Tables Spilling to Disk
  if (tmpDiskRatioPct > 22 && tmpDiskTables > 100) {
    const curTmp = numFromMap(vars, 'tmp_table_size', 16 * 1024 * 1024);
    advisories.push({
      id: 'tmp-disk',
      severity: tmpDiskRatioPct > 45 ? 'critical' : 'warning',
      variableName: 'tmp_table_size / max_heap_table_size',
      currentValue: `${formatBytesReadable(curTmp)} (${tmpDiskRatioPct}% bocor ke disk)`,
      recommendedValue: '64M – 128M (set keduanya sama besar)',
      title: `Rasio Tabel Sementara di Disk Tinggi (${tmpDiskRatioPct}%)`,
      explanation:
        'Kueri GROUP BY / ORDER BY besar sering membuat tabel sementara di disk yang lambat. Naikkan tmp_table_size & max_heap_table_size secara bersamaan.'
    });
  }

  // 4. Max Connections Headroom
  const peakConnPct = (maxUsedConnections / maxConnections) * 100;
  if (peakConnPct >= 80) {
    advisories.push({
      id: 'max-conn',
      severity: peakConnPct >= 95 ? 'critical' : 'warning',
      variableName: 'max_connections',
      currentValue: `${maxConnections} (Puncak terpakai: ${maxUsedConnections})`,
      recommendedValue: String(Math.ceil((maxConnections * 1.5) / 50) * 50),
      title: `Puncak koneksi mendekati batas "Too many connections" (${peakConnPct.toFixed(0)}%)`,
      explanation:
        'Server pernah mencapai ≥ 80% batas max_connections. Naikkan max_connections atau pastikan aplikasi menutup koneksi idle.'
    });
  }

  // 5. Max Allowed Packet
  const maxPacket = numFromMap(vars, 'max_allowed_packet', 16 * 1024 * 1024);
  if (maxPacket > 0 && maxPacket < 16 * 1024 * 1024) {
    advisories.push({
      id: 'max-packet',
      severity: 'warning',
      variableName: 'max_allowed_packet',
      currentValue: formatBytesReadable(maxPacket),
      recommendedValue: '64M',
      title: 'max_allowed_packet kecil (< 16 MB)',
      explanation:
        'Dapat memicu error "Packet too large / MySQL server has gone away" saat impor dump SQL besar atau menyimpan teks panjang.'
    });
  }

  // 6. Slow Query Log Status
  const slowLogOn = strFromMap(vars, 'slow_query_log', 'OFF').toUpperCase();
  if (slowLogOn !== 'ON' && slowLogOn !== '1') {
    advisories.push({
      id: 'slow-log-off',
      severity: 'warning',
      variableName: 'slow_query_log',
      currentValue: 'OFF',
      recommendedValue: 'ON (long_query_time = 1)',
      title: 'Slow Query Log belum diaktifkan',
      explanation:
        'Mengaktifkan slow_query_log = 1 & long_query_time = 1 sangat membantu mengaudit kueri lambat produksi secara historis.'
    });
  }

  return {
    profileId: meta.profileId,
    profileName: meta.profileName,
    engine: 'mysql',
    serverVersion,
    uptimeSec,
    uptimeLabel: formatUptimeIndonesian(uptimeSec),
    collectedAtMs: meta.collectedAtMs ?? Date.now(),
    connections: {
      threadsConnected,
      threadsRunning,
      maxConnections,
      maxUsedConnections,
      abortedConnects,
      usagePct: connUsagePct
    },
    bufferPool: {
      sizeMb: bpSizeMb,
      usedMb: bpUsedMb,
      usagePct: bpUsagePct,
      hitRatioPct,
      dirtyPagesPct
    },
    bottlenecks: {
      slowQueries,
      selectFullJoin,
      tmpTablesTotal,
      tmpDiskTables,
      tmpDiskRatioPct,
      tableLocksWaited,
      openedTables
    },
    counters: {
      questions:
        numFromMap(status, 'questions', 0) || numFromMap(status, 'queries', 0),
      comSelect: numFromMap(status, 'com_select', 0),
      comInsert: numFromMap(status, 'com_insert', 0),
      comUpdate: numFromMap(status, 'com_update', 0),
      comDelete: numFromMap(status, 'com_delete', 0),
      bytesReceived: numFromMap(status, 'bytes_received', 0),
      bytesSent: numFromMap(status, 'bytes_sent', 0),
      innodbDataReads: numFromMap(status, 'innodb_data_reads', 0),
      innodbDataWrites: numFromMap(status, 'innodb_data_writes', 0)
    },
    performanceSchemaEnabled,
    advisories
  };
}

/**
 * Calculates real-time per-second throughput rates (`QPS`, `KB/s`, `InnoDB I/O`)
 * between two consecutive `DbHealthSnapshot` samples.
 */
export function computeMysqlRateDelta(
  prev: DbHealthSnapshot,
  curr: DbHealthSnapshot
): DbRealtimeRatePoint | null {
  const dtSec = (curr.collectedAtMs - prev.collectedAtMs) / 1000;
  if (!Number.isFinite(dtSec) || dtSec < 0.25) return null;

  const rate = (after: number, before: number): number => {
    const diff = after - before;
    if (diff <= 0) return 0;
    return Number((diff / dtSec).toFixed(1));
  };

  const qps = rate(curr.counters.questions, prev.counters.questions);
  const selectPerSec = rate(curr.counters.comSelect, prev.counters.comSelect);
  const writeBefore =
    prev.counters.comInsert + prev.counters.comUpdate + prev.counters.comDelete;
  const writeAfter =
    curr.counters.comInsert + curr.counters.comUpdate + curr.counters.comDelete;
  const writePerSec = rate(writeAfter, writeBefore);

  const netInKbps = Number(
    (Math.max(0, curr.counters.bytesReceived - prev.counters.bytesReceived) / 1024 / dtSec).toFixed(1)
  );
  const netOutKbps = Number(
    (Math.max(0, curr.counters.bytesSent - prev.counters.bytesSent) / 1024 / dtSec).toFixed(1)
  );

  const innodbReadsPerSec = rate(
    curr.counters.innodbDataReads,
    prev.counters.innodbDataReads
  );
  const innodbWritesPerSec = rate(
    curr.counters.innodbDataWrites,
    prev.counters.innodbDataWrites
  );

  const dt = new Date(curr.collectedAtMs);
  const timestampLabel = dt.toTimeString().slice(0, 8);

  return {
    timestampLabel,
    qps,
    selectPerSec,
    writePerSec,
    netInKbps,
    netOutKbps,
    innodbReadsPerSec,
    innodbWritesPerSec
  };
}
