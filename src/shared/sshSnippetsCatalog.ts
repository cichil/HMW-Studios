export interface SshSnippetItem {
  id: string;
  name: string;
  category: 'Laravel / PHP' | 'Web Server' | 'Database & Cache' | 'Disk & SSL' | 'Custom';
  command: string;
  description: string;
  dangerous?: boolean;
  builtIn?: boolean;
}

export interface MultiSshExecItemResult {
  connectionId: string;
  connectionName: string;
  isProduction: boolean;
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export const BUILTIN_SSH_SNIPPETS: SshSnippetItem[] = [
  {
    id: 'snip-disk-top',
    name: 'Top 15 Folder Disk Terbesar',
    category: 'Disk & SSL',
    command: 'du -h --max-depth=2 /var/www /var/log 2>/dev/null | sort -hr | head -n 15',
    description: 'Melacak folder terbesar yang menghabiskan kapasitas disk server',
    builtIn: true
  },
  {
    id: 'snip-mem-top',
    name: 'Top 12 Proses Memori & CPU',
    category: 'Disk & SSL',
    command: 'ps aux --sort=-%mem | head -n 13',
    description: 'Menampilkan proses PHP/MySQL/Nginx pemakan RAM terbesar',
    builtIn: true
  },
  {
    id: 'snip-ssl-expiry',
    name: 'Cek Masa Berlaku Sertifikat SSL',
    category: 'Disk & SSL',
    command:
      'for f in /etc/letsencrypt/live/*/cert.pem /etc/ssl/certs/*.crt; do [ -f "$f" ] && echo "=== $f ===" && openssl x509 -enddate -noout -in "$f" 2>/dev/null; done | head -n 40',
    description: 'Memeriksa tanggal kedaluwarsa sertifikat SSL di server',
    builtIn: true
  },
  {
    id: 'snip-laravel-clear',
    name: 'Clear Cache & Optimize Laravel',
    category: 'Laravel / PHP',
    command: 'php artisan optimize:clear && php artisan config:cache && php artisan route:cache',
    description: 'Membersihkan cache view/config/route lalu membangun ulang cache produksi',
    builtIn: true
  },
  {
    id: 'snip-php-version',
    name: 'Cek Versi PHP, Ekstensi & php.ini',
    category: 'Laravel / PHP',
    command: 'php -v && php --ini && php -m | tr "\\n" " "',
    description: 'Verifikasi versi PHP CLI, lokasi php.ini, dan modul aktif (mysqli/pdo/xdebug)',
    builtIn: true
  },
  {
    id: 'snip-nginx-test',
    name: 'Uji Konfigurasi Nginx (nginx -t)',
    category: 'Web Server',
    command: 'nginx -t 2>&1 || apachectl configtest 2>&1',
    description: 'Validasi sintaks konfigurasi Nginx / Apache sebelum reload',
    builtIn: true
  },
  {
    id: 'snip-phpfpm-reload',
    name: 'Reload PHP-FPM (Zero-Downtime)',
    category: 'Web Server',
    command:
      'for svc in php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm php-fpm; do systemctl is-active --quiet $svc && systemctl reload $svc && echo "Reloaded $svc"; done',
    description: 'Memuat ulang worker PHP-FPM tanpa memutus koneksi aktif',
    dangerous: true,
    builtIn: true
  },
  {
    id: 'snip-nginx-reload',
    name: 'Reload Nginx / Apache',
    category: 'Web Server',
    command:
      '(systemctl is-active --quiet nginx && nginx -t && systemctl reload nginx && echo "Nginx reloaded") || (systemctl is-active --quiet apache2 && systemctl reload apache2 && echo "Apache2 reloaded")',
    description: 'Validasi lalu reload Nginx atau Apache secara aman',
    dangerous: true,
    builtIn: true
  },
  {
    id: 'snip-error-tail',
    name: 'Tail 40 Baris Error Log Terakhir',
    category: 'Laravel / PHP',
    command:
      'for f in /var/log/nginx/error.log /var/log/apache2/error.log /var/log/php*-fpm.log; do [ -r "$f" ] && echo "=== $f ===" && tail -n 25 "$f"; done',
    description: 'Mengambil 25 baris terakhir log error Nginx, Apache, & PHP-FPM',
    builtIn: true
  },
  {
    id: 'snip-mysql-slow',
    name: 'Cek Status Service MySQL & Redis',
    category: 'Database & Cache',
    command:
      'for s in mysql mariadb postgresql redis-server supervisor; do st=$(systemctl is-active $s 2>/dev/null || echo "not-found"); echo "$s: $st"; done',
    description: 'Memeriksa status aktif layanan database & antrean',
    builtIn: true
  }
];

export function detectDangerousSshCommand(command: string): {
  dangerous: boolean;
  reason?: string;
} {
  const c = command.trim();
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-rf\b/i.test(c)) {
    return { dangerous: true, reason: 'Perintah menghapus file/folder rekursif (rm -rf)' };
  }
  if (/\b(reboot|shutdown|poweroff|halt|init\s+0|init\s+6|mkfs|dd\s+if=)\b/i.test(c)) {
    return { dangerous: true, reason: 'Perintah berisiko tinggi pada sistem operasi / disk' };
  }
  if (/\bsystemctl\s+(stop|restart|reload|disable)\b|\bservice\s+\S+\s+(stop|restart|reload)\b/i.test(c)) {
    return { dangerous: true, reason: 'Memuat ulang / menghentikan layanan server (systemctl/service)' };
  }
  return { dangerous: false };
}

export function buildServiceControlCommand(
  serviceName: string,
  action: 'reload' | 'restart' | 'status'
): string {
  const safeName = serviceName.replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!safeName) {
    throw new Error('Nama service tidak valid.');
  }
  if (action === 'status') {
    return `systemctl status ${safeName} --no-pager -n 15 2>&1 || service ${safeName} status 2>&1`;
  }
  return `systemctl ${action} ${safeName} 2>&1 && systemctl is-active ${safeName} 2>&1`;
}
