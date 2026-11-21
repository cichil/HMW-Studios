import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type {
  ConnectionProfile,
  DatabaseProfile,
  SavedHttpRequest,
  SavedSqlQueryItem
} from '@shared/types';
import type { HttpCollectionWorkspace } from '@shared/apiCollectionEngine';
import type { SshSnippetItem } from '@shared/sshSnippetsCatalog';

export interface WorkspaceBundlePayload {
  format: 'hmw-studio-team-bundle';
  version: 1;
  exportedAt: string;
  exportedBy?: string;
  includesSecrets: boolean;
  connections?: Array<{
    profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>;
    secret?: { password?: string; passphrase?: string; privateKeyPath?: string };
  }>;
  dbProfiles?: Array<{
    profile: Omit<DatabaseProfile, 'id' | 'createdAt' | 'updatedAt'>;
    secret?: { password?: string };
  }>;
  savedQueries?: SavedSqlQueryItem[];
  httpWorkspace?: HttpCollectionWorkspace;
  savedHttpRequests?: SavedHttpRequest[];
  sshSnippets?: SshSnippetItem[];
}

export interface EncryptedHmwPackEnvelope {
  magic: 'HMWPACK1';
  kdf: 'scrypt';
  cipher: 'aes-256-gcm';
  saltB64: string;
  ivB64: string;
  tagB64: string;
  ciphertextB64: string;
  meta: {
    exportedAt: string;
    includesSecrets: boolean;
    connectionCount: number;
    dbProfileCount: number;
    savedQueryCount: number;
    httpRequestCount: number;
    sshSnippetCount: number;
  };
}

export function encryptWorkspaceBundle(
  payload: WorkspaceBundlePayload,
  passphrase: string
): string {
  const secretPass = passphrase.trim();
  if (secretPass.length < 4) {
    throw new Error('Passphrase enkripsi minimal 4 karakter.');
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secretPass, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plainBuf = Buffer.from(JSON.stringify(payload), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope: EncryptedHmwPackEnvelope = {
    magic: 'HMWPACK1',
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    saltB64: salt.toString('base64'),
    ivB64: iv.toString('base64'),
    tagB64: tag.toString('base64'),
    ciphertextB64: encrypted.toString('base64'),
    meta: {
      exportedAt: payload.exportedAt,
      includesSecrets: payload.includesSecrets,
      connectionCount: payload.connections?.length ?? 0,
      dbProfileCount: payload.dbProfiles?.length ?? 0,
      savedQueryCount: payload.savedQueries?.length ?? 0,
      httpRequestCount:
        (payload.httpWorkspace?.requests.length ?? 0) || (payload.savedHttpRequests?.length ?? 0),
      sshSnippetCount: payload.sshSnippets?.length ?? 0
    }
  };
  return JSON.stringify(envelope, null, 2);
}

export function decryptWorkspaceBundle(
  rawFileContent: string,
  passphrase: string
): WorkspaceBundlePayload {
  let envelope: EncryptedHmwPackEnvelope;
  try {
    envelope = JSON.parse(rawFileContent) as EncryptedHmwPackEnvelope;
  } catch {
    throw new Error('File bukan format .hmwpack JSON yang valid.');
  }

  if (envelope.magic !== 'HMWPACK1' || envelope.cipher !== 'aes-256-gcm') {
    throw new Error('Header file .hmwpack tidak dikenali atau rusak.');
  }

  const salt = Buffer.from(envelope.saltB64, 'base64');
  const iv = Buffer.from(envelope.ivB64, 'base64');
  const tag = Buffer.from(envelope.tagB64, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertextB64, 'base64');
  const key = scryptSync(passphrase.trim(), salt, 32);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf-8'
    );
    const parsed = JSON.parse(decrypted) as WorkspaceBundlePayload;
    if (parsed.format !== 'hmw-studio-team-bundle') {
      throw new Error('Isi bundel .hmwpack tidak valid.');
    }
    return parsed;
  } catch (err) {
    if (err instanceof Error && err.message.includes('bundel')) throw err;
    throw new Error('Passphrase salah atau file .hmwpack telah rusak/dimodifikasi.');
  }
}
