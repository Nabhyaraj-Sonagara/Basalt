// Wire types shared by the sync client and server. Binary fields are base64 strings;
// file bodies travel as application/octet-stream.

export const API = '/v1';
/** Sync is for notes: files larger than this aren't uploaded unless the server says otherwise. */
export const MAX_FILE_BYTES_DEFAULT = 2 * 1024 * 1024;

export interface AuthParamsRequest {
  email: string;
}
export interface AuthParamsResponse {
  salt: string;
  kdf: { N: number; r: number; p: number };
}

export interface SignupRequest {
  email: string;
  salt: string;
  kdf: { N: number; r: number; p: number };
  authKey: string;
  wrappedAccountKey: string;
}
export interface LoginRequest {
  email: string;
  authKey: string;
}
export interface SessionResponse {
  token: string;
  wrappedAccountKey: string;
}
export interface PasswordRequest {
  currentAuthKey: string;
  salt: string;
  kdf: { N: number; r: number; p: number };
  authKey: string;
  wrappedAccountKey: string;
}

export interface MeResponse {
  email: string;
  usageBytes: number;
  quotaBytes: number;
  wrappedAccountKey: string;
  /** Server limits (absent on servers older than 0.3). */
  maxFileBytes?: number;
  fileCount?: number;
  maxFiles?: number;
  transferBytesPerDay?: number;
}

export interface RemoteHive {
  id: string;
  /** Hive name sealed with the account key. */
  encName: string;
  /** Hive key sealed with the account key. */
  wrappedKey: string;
  createdAt: string;
}
export interface CreateHiveRequest {
  encName: string;
  wrappedKey: string;
}

export interface ChangeRecord {
  pathId: string;
  /** Per-file revision; 0 means the file has never existed. */
  rev: number;
  /** Hive-wide sequence number of this change. */
  seq: number;
  deleted: boolean;
  /** Sealed FileMeta (null only for records written without one). */
  meta: string | null;
  size: number;
}
export interface ChangesResponse {
  records: ChangeRecord[];
  /** The highest sequence number covered by this page. */
  seq: number;
  more: boolean;
}
export interface WriteResponse {
  rev: number;
  seq: number;
}
export interface ConflictResponse {
  error: 'conflict';
  rev: number;
}
export interface ErrorResponse {
  error: string;
  message: string;
}

/** Header carrying the sealed FileMeta on PUT and DELETE. */
export const META_HEADER = 'x-basalt-meta';
