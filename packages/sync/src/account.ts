// Account and hive key handling on top of SyncClient.
import { b64, DEFAULT_KDF, deriveKeys, open, randomKey, randomSalt, seal, unb64, type KdfParams } from './crypto';
import type { SyncClient } from './client';
import type { RemoteHive } from './protocol';

export interface Session {
  token: string;
  /** The account key, unwrapped. Keep it in the OS keychain; it decrypts every hive. */
  accountKey: Buffer;
}

const normEmail = (e: string) => e.trim().toLowerCase();

export async function createAccount(client: SyncClient, email: string, password: string, kdf: KdfParams = DEFAULT_KDF): Promise<Session> {
  if (password.length < 10) throw new Error('Use a password of at least 10 characters.');
  const salt = randomSalt();
  const { authKey, kek } = await deriveKeys(password, salt, kdf);
  const accountKey = randomKey();
  const res = await client.signup({ email: normEmail(email), salt: b64(salt), kdf, authKey: b64(authKey), wrappedAccountKey: b64(seal(kek, accountKey, 'account-key')) });
  client.token = res.token;
  return { token: res.token, accountKey };
}

export async function signIn(client: SyncClient, email: string, password: string): Promise<Session> {
  const params = await client.authParams(normEmail(email));
  const { authKey, kek } = await deriveKeys(password, unb64(params.salt), params.kdf);
  const res = await client.login({ email: normEmail(email), authKey: b64(authKey) });
  client.token = res.token;
  let accountKey: Buffer;
  try {
    accountKey = open(kek, unb64(res.wrappedAccountKey), 'account-key');
  } catch {
    throw new Error("Signed in, but this password can't unlock your notes. If you changed it on another device, use the new one.");
  }
  return { token: res.token, accountKey };
}

/** Changes the password. Only the account key is re-wrapped; notes stay as they are. */
export async function changePassword(client: SyncClient, email: string, current: string, next: string, accountKey: Buffer, kdf: KdfParams = DEFAULT_KDF): Promise<Session> {
  if (next.length < 10) throw new Error('Use a password of at least 10 characters.');
  const params = await client.authParams(normEmail(email));
  const cur = await deriveKeys(current, unb64(params.salt), params.kdf);
  const salt = randomSalt();
  const nxt = await deriveKeys(next, salt, kdf);
  const res = await client.changePassword({ currentAuthKey: b64(cur.authKey), salt: b64(salt), kdf, authKey: b64(nxt.authKey), wrappedAccountKey: b64(seal(nxt.kek, accountKey, 'account-key')) });
  client.token = res.token;
  return { token: res.token, accountKey };
}

export interface OpenedHive {
  id: string;
  name: string;
  hiveKey: Buffer;
  createdAt: string;
}

export function openHive(accountKey: Buffer, h: RemoteHive): OpenedHive {
  return {
    id: h.id,
    name: open(accountKey, unb64(h.encName), 'hive-name').toString('utf8'),
    hiveKey: open(accountKey, unb64(h.wrappedKey), 'hive-key'),
    createdAt: h.createdAt,
  };
}

export async function listHives(client: SyncClient, accountKey: Buffer): Promise<OpenedHive[]> {
  return (await client.hives()).map((h) => openHive(accountKey, h));
}

export async function createRemoteHive(client: SyncClient, accountKey: Buffer, name: string): Promise<OpenedHive> {
  const hiveKey = randomKey();
  const created = await client.createHive({ encName: b64(seal(accountKey, Buffer.from(name), 'hive-name')), wrappedKey: b64(seal(accountKey, hiveKey, 'hive-key')) });
  return { id: created.id, name, hiveKey, createdAt: created.createdAt };
}
