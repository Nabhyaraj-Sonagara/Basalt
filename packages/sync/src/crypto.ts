// End-to-end encryption for Basalt Sync. Only Node's crypto module; nothing here talks to the network.
//
//   password ──scrypt──▶ master ──HKDF──▶ authKey (sent to the server, which stores a hash of it)
//                                    └──▶ kek     (never leaves the device)
//   accountKey (random)  wrapped by kek, stored on the server
//   hiveKey (random, one per remote hive) wrapped by accountKey, stored on the server
//   hiveKey ──HKDF──▶ contentKey, metaKey, pathKey
//
// File contents and metadata are AES-256-GCM. Paths become HMAC(pathKey, path), so the server
// never sees file names or text.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const VERSION = 1;
const NONCE = 12;
const TAG = 16;

export interface KdfParams {
  N: number;
  r: number;
  p: number;
}
/** Production parameters: about 0.3 s and 128 MiB on a laptop. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

export const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
export const unb64 = (s: string): Buffer => Buffer.from(s, 'base64');
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const randomKey = (): Buffer => randomBytes(32);
export const randomSalt = (): Buffer => randomBytes(16);

function hkdf(key: Uint8Array, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `basalt-sync/v1/${info}`, 32));
}

/** Derives the login key (sent to the server) and the key-encryption key (kept locally) from a password. */
export function deriveKeys(password: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<{ authKey: Buffer; kek: Buffer }> {
  return new Promise((resolve, reject) => {
    const maxmem = 128 * params.N * params.r * 2;
    scrypt(password.normalize('NFKC'), salt, 32, { ...params, maxmem }, (err, master) => {
      if (err) return reject(err);
      resolve({ authKey: hkdf(master, 'auth'), kek: hkdf(master, 'kek') });
    });
  });
}

/** AES-256-GCM. Output: version (1 byte) | nonce (12) | ciphertext | tag (16). `aad` binds the ciphertext to its context. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad = ''): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  if (aad) c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, body, c.getAuthTag()]);
}

export function open(key: Uint8Array, sealed: Uint8Array, aad = ''): Buffer {
  const buf = Buffer.from(sealed);
  if (buf.length < 1 + NONCE + TAG || buf[0] !== VERSION) throw new Error('Unrecognised encrypted data.');
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 1 + NONCE));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(buf.length - TAG));
  return Buffer.concat([d.update(buf.subarray(1 + NONCE, buf.length - TAG)), d.final()]);
}

export interface HiveKeys {
  content: Buffer;
  meta: Buffer;
  path: Buffer;
}

export function hiveKeys(hiveKey: Uint8Array): HiveKeys {
  return { content: hkdf(hiveKey, 'content'), meta: hkdf(hiveKey, 'meta'), path: hkdf(hiveKey, 'path') };
}

/** A stable, opaque id for a path. Unicode-normalised so macOS and Linux names match. */
export function pathId(keys: HiveKeys, path: string): string {
  return createHmac('sha256', keys.path).update(path.normalize('NFC')).digest('hex');
}

/** What the server stores next to each file, encrypted. */
export interface FileMeta {
  path: string;
  /** sha256 of the plaintext. */
  hash: string;
  size: number;
  mtime: number;
}

export function sealMeta(keys: HiveKeys, id: string, meta: FileMeta): string {
  return b64(seal(keys.meta, Buffer.from(JSON.stringify(meta)), id));
}

export function openMeta(keys: HiveKeys, id: string, sealed: string): FileMeta {
  const meta = JSON.parse(open(keys.meta, unb64(sealed), id).toString('utf8')) as FileMeta;
  if (typeof meta.path !== 'string' || typeof meta.hash !== 'string') throw new Error('Bad file metadata.');
  return meta;
}

export const sealContent = (keys: HiveKeys, id: string, data: Uint8Array): Buffer => seal(keys.content, data, id);
export const openContent = (keys: HiveKeys, id: string, data: Uint8Array): Buffer => open(keys.content, data, id);

export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
