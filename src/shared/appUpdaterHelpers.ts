export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AppUpdateStateDto {
  phase: AppUpdatePhase;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadPercent?: number;
  bytesPerSecond?: number;
  transferredBytes?: number;
  totalBytes?: number;
  /** True untuk instalasi NSIS (bisa unduh & pasang otomatis); false untuk Portable .ZIP / mode dev */
  canAutoInstall: boolean;
  errorMessage?: string;
  checkedAt?: string;
}

export interface GithubReleaseAssetLike {
  name?: string;
  browser_download_url?: string;
}

export interface GithubReleaseLike {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAssetLike[];
}

export const GITHUB_REPO_OWNER = 'cichil';
export const GITHUB_REPO_NAME = 'HMW-Studios';
export const GITHUB_RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;
export const GITHUB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;

/**
 * Menormalisasi string versi semver (mis. "v4.0.1" -> [4, 0, 1]) dan membandingkan a vs b.
 * Mengembalikan >0 jika a > b, <0 jika a < b, 0 jika sama.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (raw: string): { nums: number[]; pre: string } => {
    const clean = (raw || '').trim().replace(/^v/i, '');
    const [mainPart, prePart = ''] = clean.split('-', 2);
    const nums = mainPart
      .split('.')
      .map((s) => Number.parseInt(s.replace(/[^0-9].*$/, ''), 10))
      .map((n) => (Number.isFinite(n) && n >= 0 ? n : 0));
    while (nums.length < 3) nums.push(0);
    return { nums: nums.slice(0, 3), pre: prePart.trim().toLowerCase() };
  };

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  // Versi stabil (tanpa pre-release) lebih baru daripada pre-release dengan angka sama
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  return pa.pre.localeCompare(pb.pre);
}

export function isNewerVersion(currentVersion: string, candidateVersion: string): boolean {
  if (!candidateVersion || !candidateVersion.trim()) return false;
  return compareSemver(candidateVersion, currentVersion) > 0;
}

export function normalizeVersionTag(raw: string): string {
  return (raw || '').trim().replace(/^v/i, '');
}

/**
 * Memilih URL aset rilis Windows terbaik dari GitHub Release:
 * 1) Installer Setup .exe (`HMW-Studio-Setup-*.exe`)
 * 2) Paket Portable `.zip`
 * 3) Fallback ke halaman release (`html_url`)
 */
export function pickWindowsReleaseDownloadUrl(release: GithubReleaseLike): string {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const setupExe = assets.find(
    (a) =>
      typeof a.name === 'string' &&
      /setup.*\.exe$/i.test(a.name) &&
      typeof a.browser_download_url === 'string'
  );
  if (setupExe?.browser_download_url) return setupExe.browser_download_url;

  const winZip = assets.find(
    (a) =>
      typeof a.name === 'string' &&
      /\.zip$/i.test(a.name) &&
      typeof a.browser_download_url === 'string'
  );
  if (winZip?.browser_download_url) return winZip.browser_download_url;

  return release.html_url || GITHUB_RELEASES_PAGE_URL;
}
