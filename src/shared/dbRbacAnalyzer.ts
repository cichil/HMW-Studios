import type { DbEngine } from './types';

export interface DbUserPrivilegeRecord {
  username: string;
  host: string; // e.g. '%' or 'localhost' for MySQL, 'role' for PostgreSQL
  isSuperuser: boolean;
  hasGrantOption: boolean;
  hasEmptyPassword: boolean;
  accountLocked: boolean;
  plugin?: string;
  grants: string[];
}

export interface DbRbacSecurityFinding {
  id: string;
  severity: 'critical' | 'warn' | 'info';
  userLabel: string;
  title: string;
  recommendation: string;
}

export interface DbRbacSnapshot {
  engine: DbEngine;
  profileId: string;
  profileName: string;
  users: DbUserPrivilegeRecord[];
  findings: DbRbacSecurityFinding[];
  collectedAt: string;
}

export interface DbCreateGrantSpec {
  username: string;
  host: string;
  password: string;
  database: string; // '*' or db name
  table: string; // '*' or table name
  privileges: string[]; // e.g. ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  withGrantOption?: boolean;
  createUserIfNotExists: boolean;
}

export const DB_PRIVILEGE_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  privileges: string[];
}> = [
  {
    id: 'readonly',
    label: 'Auditor / BI (Read-Only)',
    description: 'Hanya SELECT (aman untuk laporan & auditor SPBE)',
    privileges: ['SELECT']
  },
  {
    id: 'app-crud',
    label: 'Aplikasi Web (CRUD)',
    description: 'SELECT, INSERT, UPDATE, DELETE (tanpa DROP/ALTER)',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  },
  {
    id: 'developer',
    label: 'Developer (CRUD + DDL)',
    description: 'CRUD + CREATE, ALTER, INDEX, CREATE VIEW',
    privileges: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'INDEX', 'CREATE VIEW']
  },
  {
    id: 'dba-all',
    label: 'DBA Penuh (ALL PRIVILEGES)',
    description: 'Hak akses penuh pada database target',
    privileges: ['ALL PRIVILEGES']
  }
];

export function auditDbUsersSecurity(
  users: DbUserPrivilegeRecord[],
  engine: DbEngine
): DbRbacSecurityFinding[] {
  const findings: DbRbacSecurityFinding[] = [];

  for (const u of users) {
    const label = engine === 'mysql' ? `'${u.username}'@'${u.host}'` : u.username;
    const isSystemInternal =
      u.username.startsWith('mysql.') ||
      u.username === 'debian-sys-maint' ||
      u.username.startsWith('pg_');
    if (isSystemInternal) continue;

    if (u.hasEmptyPassword && !u.accountLocked) {
      findings.push({
        id: `empty-pwd-${label}`,
        severity: 'critical',
        userLabel: label,
        title: `Akun ${label} tidak memiliki password!`,
        recommendation:
          engine === 'mysql'
            ? `Segera tetapkan password kuat dengan ALTER USER ${label} IDENTIFIED BY '...';`
            : `Segera tetapkan password dengan ALTER ROLE "${u.username}" WITH PASSWORD '...';`
      });
    }

    if (engine === 'mysql' && u.username.toLowerCase() === 'root' && u.host === '%') {
      findings.push({
        id: `root-remote-${label}`,
        severity: 'critical',
        userLabel: label,
        title: `Akun root@% terbuka dari semua alamat IP remote!`,
        recommendation:
          'Batasi akses root hanya ke localhost / IP VPN tertentu, atau hapus akun root@%.'
      });
    }

    if (engine === 'mysql' && u.host === '%' && (u.isSuperuser || u.hasGrantOption)) {
      findings.push({
        id: `wildcard-super-${label}`,
        severity: 'warn',
        userLabel: label,
        title: `Akun ${label} memiliki hak SUPER / GRANT OPTION dari host wildcard (%).`,
        recommendation:
          'Gunakan prinsip Least Privilege: batasi host ke subnet intranet (mis. 10.1.0.%) dan cabut GRANT OPTION.'
      });
    }

    if (u.username.trim() === '') {
      findings.push({
        id: `anon-user-${u.host}`,
        severity: 'critical',
        userLabel: `''@'${u.host}'`,
        title: `Terdapat akun anonim (''@'${u.host}') pada server database.`,
        recommendation: `Hapus akun anonim dengan DROP USER ''@'${u.host}';`
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: 'rbac-clean',
      severity: 'info',
      userLabel: 'Semua Akun',
      title: 'Tidak ditemukan celah keamanan RBAC kritis pada akun database.',
      recommendation: 'Pertahankan rotasi password berkala dan batasi akun aplikasi pada hak CRUD saja.'
    });
  }

  return findings;
}

export function buildRbacGrantSqlStatements(
  spec: DbCreateGrantSpec,
  engine: DbEngine
): string[] {
  const userClean = spec.username.trim().replace(/['"`]/g, '');
  if (!userClean) {
    throw new Error('Nama user database tidak boleh kosong.');
  }
  const privs = spec.privileges.length > 0 ? spec.privileges : ['SELECT'];
  const stmts: string[] = [];

  if (engine === 'postgres') {
    const qUser = `"${userClean}"`;
    if (spec.createUserIfNotExists) {
      const escapedPwd = spec.password.replace(/'/g, "''");
      stmts.push(
        escapedPwd
          ? `CREATE ROLE ${qUser} WITH LOGIN PASSWORD '${escapedPwd}';`
          : `CREATE ROLE ${qUser} WITH LOGIN;`
      );
    }
    const privStr = privs.includes('ALL PRIVILEGES') ? 'ALL PRIVILEGES' : privs.join(', ');
    if (spec.table === '*' || !spec.table.trim()) {
      const schema = spec.database && spec.database !== '*' ? `"${spec.database.replace(/"/g, '""')}"` : 'public';
      stmts.push(`GRANT USAGE ON SCHEMA ${schema} TO ${qUser};`);
      stmts.push(
        `GRANT ${privStr} ON ALL TABLES IN SCHEMA ${schema} TO ${qUser}${
          spec.withGrantOption ? ' WITH GRANT OPTION' : ''
        };`
      );
    } else {
      const qTbl = `"${spec.table.replace(/"/g, '""')}"`;
      stmts.push(
        `GRANT ${privStr} ON TABLE ${qTbl} TO ${qUser}${
          spec.withGrantOption ? ' WITH GRANT OPTION' : ''
        };`
      );
    }
    return stmts;
  }

  // MySQL / MariaDB
  const hostClean = (spec.host.trim() || '%').replace(/'/g, '');
  const account = `'${userClean}'@'${hostClean}'`;
  if (spec.createUserIfNotExists) {
    const escapedPwd = spec.password.replace(/'/g, "''");
    stmts.push(
      escapedPwd
        ? `CREATE USER IF NOT EXISTS ${account} IDENTIFIED BY '${escapedPwd}';`
        : `CREATE USER IF NOT EXISTS ${account};`
    );
  }
  const dbPart =
    !spec.database.trim() || spec.database.trim() === '*'
      ? '*'
      : `\`${spec.database.trim().replace(/`/g, '``')}\``;
  const tblPart =
    !spec.table.trim() || spec.table.trim() === '*'
      ? '*'
      : `\`${spec.table.trim().replace(/`/g, '``')}\``;
  const privStr = privs.includes('ALL PRIVILEGES') ? 'ALL PRIVILEGES' : privs.join(', ');
  stmts.push(
    `GRANT ${privStr} ON ${dbPart}.${tblPart} TO ${account}${
      spec.withGrantOption ? ' WITH GRANT OPTION' : ''
    };`
  );
  stmts.push('FLUSH PRIVILEGES;');
  return stmts;
}
