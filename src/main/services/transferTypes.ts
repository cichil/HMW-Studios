import type { RemoteEntry } from '@shared/types';
import type { IgnoreFilter } from './ignoreFilter';

export interface DecryptedSecrets {
  password?: string;
  passphrase?: string;
}

export interface RemoteTransferDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isAlive?(): boolean;
  checkAbsoluteOrRelExists?(remotePathOrRel: string): Promise<boolean>;
  readTailText?(
    remotePathOrRel: string,
    maxBytes?: number
  ): Promise<{ content: string; size: number; exists: boolean }>;
  listDirectory(remoteSubPath?: string): Promise<RemoteEntry[]>;
  listRecursive(
    ignoreFilter: IgnoreFilter,
    options?: { requireRootExists?: boolean }
  ): Promise<{ entries: RemoteEntry[]; ignoredCount: number }>;
  readFileText(remoteRelativePath: string): Promise<string>;
  writeFileText(remoteRelativePath: string, content: string): Promise<void>;
  createEntry(
    remoteRelativePath: string,
    isDirectory: boolean,
    initialContent?: string
  ): Promise<void>;
  renameEntry(oldRelativePath: string, newRelativePath: string): Promise<void>;
  deleteEntry(remoteRelativePath: string, isDirectory: boolean): Promise<void>;
  chmodEntry(remoteRelativePath: string, modeOctal: string): Promise<void>;
  uploadFile(localFilePath: string, remoteRelativePath: string): Promise<void>;
  downloadFile(remoteRelativePath: string, localFilePath: string): Promise<void>;
}

export function joinPosixRemote(basePath: string, subPath = ''): string {
  const cleanBase = (basePath || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  const cleanSub = subPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanSub) return cleanBase;
  return cleanBase === '/' ? `/${cleanSub}` : `${cleanBase}/${cleanSub}`;
}
