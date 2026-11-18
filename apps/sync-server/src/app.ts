// Basalt Sync HTTP API. Everything it stores is ciphertext produced by the client
// (@basalt/sync); the server sees email addresses, sizes and timestamps, not notes or file names.
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { z } from 'zod';
import type pg from 'pg';
import type { BlobStore } from './blobs';
import type { Config } from './config';
import { tx, type Db } from './db';
import { Notifier } from './notify';

const scrypt = promisify(scryptCb) as (pw: Buffer, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const API = '/v1';
const META_HEADER = 'x-basalt-meta';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const b64 = z.string().max(4096).regex(/^[A-Za-z0-9+/]*={0,2}$/, 'base64');
const kdf = z.object({ N: z.number().int().min(2 ** 10).max(2 ** 20), r: z.number().int().min(1).max(32), p: z.number().int().min(1).max(16) });
const email = z.string().trim().toLowerCase().max(254).email();
const uuid = z.string().uuid();
const pathIdRe = /^[a-f0-9]{64}$/;

/** "2 MB", "512 KB": for messages people read. */
const size = (n: number) => (n >= 1024 ** 2 ? `${+(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const authHash = (authKey: Buffer, salt: Buffer) => scrypt(authKey, salt, 32, { N: 2 ** 14, r: 8, p: 1 });

/** Simple fixed-window limiter, per client address and bucket. */
class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    }, windowMs).unref();
  }
  check(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) this.hits.set(key, { n: 1, reset: now + this.windowMs });
    else if (++h.n > this.limit) throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.');
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  blobs: BlobStore;
  notifier: Notifier;
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string;
}

async function readBody(req: IncomingMessage, max: number, tooLarge = 'That request is too large.'): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, 'too_large', tooLarge);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > max) throw new HttpError(413, 'too_large', tooLarge);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const raw = await readBody(req, 64 * 1024);
  let data: unknown;
  try {
    data = raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body must be JSON.');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(400, 'invalid', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return parsed.data;
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) }).end(text);
}

export function createApp({ config, db, blobs, notifier }: AppDeps): Server {
  const authLimit = new RateLimiter(20, 10 * 60 * 1000);
  const signupLimit = new RateLimiter(5, 60 * 60 * 1000);

  // Old daily transfer rows are only needed for today; clear them out now and then.
  setInterval(() => void db.query(`DELETE FROM transfer WHERE day < current_date - 2`).catch(() => {}), 60 * 60 * 1000).unref();

  /** Counts bytes against the account's daily transfer allowance, refusing once it would go over. */
  async function charge(userId: string, bytes: number): Promise<void> {
    const limit = config.transferBytesPerDay;
    if (!limit) return;
    const r = await db.query(
      `INSERT INTO transfer(user_id, day, bytes) SELECT $1::uuid, current_date, $2::bigint WHERE $2::bigint <= $3::bigint
       ON CONFLICT (user_id, day) DO UPDATE SET bytes = transfer.bytes + $2::bigint WHERE transfer.bytes + $2::bigint <= $3::bigint
       RETURNING bytes`,
      [userId, bytes, limit],
    );
    if (!r.rowCount) {
      throw new HttpError(429, 'transfer_limit', `This account has used today's sync allowance (${size(limit)} of uploads and downloads). Sync picks up again tomorrow (UTC).`);
    }
  }

  const fakeSalt = (e: string) => createHmac('sha256', config.serverSecret).update(`salt:${e}`).digest().subarray(0, 16);

  async function newSession(c: pg.PoolClient | Db, userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await c.query(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`, [sha(token), userId, String(config.sessionDays)]);
    return token;
  }

  async function user(ctx: Ctx): Promise<{ id: string; tokenHash: Buffer }> {
    const m = /^Bearer (\S+)$/.exec(ctx.req.headers.authorization ?? '');
    if (!m) throw new HttpError(401, 'unauthorized', 'Sign in to sync.');
    const tokenHash = sha(m[1]);
    const r = await db.query('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]);
    if (!r.rowCount) throw new HttpError(401, 'unauthorized', 'Your sync session has expired. Sign in again.');
    return { id: r.rows[0].user_id, tokenHash };
  }

  async function hiveFor(userId: string, id: string): Promise<void> {
    if (!uuid.safeParse(id).success) throw new HttpError(404, 'not_found', 'No such hive.');
    const r = await db.query('SELECT 1 FROM hives WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!r.rowCount) throw new HttpError(404, 'not_found', 'No such hive.');
  }

  async function verifyAuthKey(userId: string, authKey: string): Promise<boolean> {
    const r = await db.query('SELECT auth_salt, auth_hash FROM users WHERE id = $1', [userId]);
    if (!r.rowCount) return false;
    const got = await authHash(Buffer.from(authKey, 'base64'), r.rows[0].auth_salt);
    return timingSafeEqual(got, r.rows[0].auth_hash);
  }

  const ifMatch = (ctx: Ctx) => {
    const v = ctx.req.headers['if-match'];
    if (v == null || !/^\d+$/.test(String(v))) throw new HttpError(428, 'precondition_required', 'Send If-Match with the revision you last saw (0 for a new file).');
    return Number(v);
  };
  const metaHeader = (ctx: Ctx) => {
    const v = ctx.req.headers[META_HEADER];
    if (typeof v !== 'string' || !b64.safeParse(v).success) throw new HttpError(400, 'invalid', `Send the sealed file metadata in ${META_HEADER}.`);
    return Buffer.from(v, 'base64');
  };

  /** Writes or deletes one file under optimistic concurrency. Returns the new rev and seq. */
  async function writeFile(hiveId: string, userId: string, id: string, expect: number, meta: Buffer, body: Buffer | null) {
    const blobId = body ? randomBytes(16).toString('hex') : null;
    if (body) await blobs.put(blobId!, body);
    let oldBlob: string | null = null;
    try {
      const out = await tx(db, async (c) => {
        const h = await c.query('SELECT seq FROM hives WHERE id = $1 FOR UPDATE', [hiveId]);
        const cur = await c.query('SELECT rev, size, blob_id, deleted FROM files WHERE hive_id = $1 AND path_id = $2', [hiveId, id]);
        const rev = cur.rowCount ? (cur.rows[0].rev as number) : 0;
        if (rev !== expect) throw new HttpError(409, 'conflict', 'Another device changed this file first.', { rev });
        if (!body && (!cur.rowCount || cur.rows[0].deleted)) throw new HttpError(404, 'not_found', 'That file is already deleted.');
        const wasLive = !!cur.rowCount && !cur.rows[0].deleted;
        const oldSize = wasLive ? Number(cur.rows[0].size) : 0;
        const newSize = body ? body.length : 0;
        const addFiles = (body ? 1 : 0) - (wasLive ? 1 : 0);
        if (newSize > oldSize || addFiles > 0) {
          const u = await c.query('SELECT usage_bytes, file_count FROM users WHERE id = $1 FOR UPDATE', [userId]);
          if (Number(u.rows[0].usage_bytes) + newSize - oldSize > config.quotaBytes) {
            throw new HttpError(507, 'quota', `Your sync storage is full (${size(config.quotaBytes)}). Sync is for notes; delete notes you don't need or keep big files out of the hive.`);
          }
          if (addFiles > 0 && Number(u.rows[0].file_count) + addFiles > config.maxFiles) {
            throw new HttpError(507, 'file_limit', `This account has the most files sync holds (${config.maxFiles.toLocaleString('en')}).`);
          }
        }
        const seq = Number(h.rows[0].seq) + 1;
        await c.query('UPDATE hives SET seq = $2 WHERE id = $1', [hiveId, seq]);
        await c.query(
          `INSERT INTO files(hive_id, path_id, rev, seq, deleted, meta, blob_id, size, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (hive_id, path_id) DO UPDATE SET rev = $3, seq = $4, deleted = $5, meta = $6, blob_id = $7, size = $8, updated_at = now()`,
          [hiveId, id, rev + 1, seq, !body, meta, blobId, newSize],
        );
        await c.query('UPDATE users SET usage_bytes = usage_bytes + $2, file_count = greatest(0, file_count + $3) WHERE id = $1', [userId, newSize - oldSize, addFiles]);
        oldBlob = cur.rowCount ? cur.rows[0].blob_id : null;
        return { rev: rev + 1, seq };
      });
      if (oldBlob) await blobs.delete(oldBlob).catch(() => {});
      await notifier.notify(hiveId, out.seq);
      return out;
    } catch (err) {
      if (blobId) await blobs.delete(blobId).catch(() => {});
      throw err;
    }
  }

  async function route(ctx: Ctx): Promise<void> {
    const { req, res, url } = ctx;
    const p = url.pathname;
    const m = req.method ?? 'GET';

    if (p === '/healthz' && m === 'GET') {
      await db.query('SELECT 1');
      return send(res, 200, { ok: true });
    }
    if (!p.startsWith(API + '/')) throw new HttpError(404, 'not_found', 'Not found.');
    const path = p.slice(API.length);

    // ----- accounts -----
    if (path === '/auth/params' && m === 'POST') {
      authLimit.check(`params:${ctx.ip}`);
      const body = await readJson(req, z.object({ email }));
      const r = await db.query('SELECT salt, kdf FROM users WHERE email = $1', [body.email]);
      if (r.rowCount) return send(res, 200, { salt: r.rows[0].salt.toString('base64'), kdf: r.rows[0].kdf });
      return send(res, 200, { salt: fakeSalt(body.email).toString('base64'), kdf: { N: 2 ** 17, r: 8, p: 1 } });
    }
    if (path === '/auth/signup' && m === 'POST') {
      if (!config.allowSignup) throw new HttpError(403, 'signup_closed', 'This sync server is not taking new accounts.');
      signupLimit.check(`signup:${ctx.ip}`);
      const body = await readJson(req, z.object({ email, salt: b64, kdf, authKey: b64, wrappedAccountKey: b64 }));
      if (config.maxUsers > 0) {
        const n = await db.query('SELECT count(*)::int AS n FROM users');
        if (n.rows[0].n >= config.maxUsers) throw new HttpError(403, 'signup_full', 'This sync server has all the accounts it can take.');
      }
      const authSalt = randomBytes(16);
      const hash = await authHash(Buffer.from(body.authKey, 'base64'), authSalt);
      const out = await tx(db, async (c) => {
        const r = await c.query(
          `INSERT INTO users(email, salt, kdf, auth_salt, auth_hash, wrapped_account_key) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (email) DO NOTHING RETURNING id`,
          [body.email, Buffer.from(body.salt, 'base64'), body.kdf, authSalt, hash, Buffer.from(body.wrappedAccountKey, 'base64')],
        );
        if (!r.rowCount) throw new HttpError(409, 'email_taken', 'An account with that email already exists. Sign in instead.');
        return { token: await newSession(c, r.rows[0].id), wrappedAccountKey: body.wrappedAccountKey };
      });
      return send(res, 201, out);
    }
    if (path === '/auth/login' && m === 'POST') {
      authLimit.check(`login:${ctx.ip}`);
      const body = await readJson(req, z.object({ email, authKey: b64 }));
      const r = await db.query('SELECT id, auth_salt, auth_hash, wrapped_account_key FROM users WHERE email = $1', [body.email]);
      const salt = r.rowCount ? r.rows[0].auth_salt : randomBytes(16);
      const got = await authHash(Buffer.from(body.authKey, 'base64'), salt);
      if (!r.rowCount || !timingSafeEqual(got, r.rows[0].auth_hash)) throw new HttpError(401, 'bad_credentials', "That email and password don't match.");
      authLimit.check(`login-ok:${ctx.ip}`);
      return send(res, 200, { token: await newSession(db, r.rows[0].id), wrappedAccountKey: r.rows[0].wrapped_account_key.toString('base64') });
    }
    if (path === '/auth/logout' && m === 'POST') {
      const u = await user(ctx);
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [u.tokenHash]);
      return send(res, 204);
    }
    if (path === '/auth/password' && m === 'POST') {
      authLimit.check(`password:${ctx.ip}`);
      const u = await user(ctx);
      const body = await readJson(req, z.object({ currentAuthKey: b64, salt: b64, kdf, authKey: b64, wrappedAccountKey: b64 }));
      if (!(await verifyAuthKey(u.id, body.currentAuthKey))) throw new HttpError(401, 'bad_credentials', 'Your current password is wrong.');
      const authSalt = randomBytes(16);
      const hash = await authHash(Buffer.from(body.authKey, 'base64'), authSalt);
      const token = await tx(db, async (c) => {
        await c.query('UPDATE users SET salt = $2, kdf = $3, auth_salt = $4, auth_hash = $5, wrapped_account_key = $6 WHERE id = $1', [
          u.id,
          Buffer.from(body.salt, 'base64'),
          body.kdf,
          authSalt,
          hash,
          Buffer.from(body.wrappedAccountKey, 'base64'),
        ]);
        await c.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
        return newSession(c, u.id);
      });
      return send(res, 200, { token, wrappedAccountKey: body.wrappedAccountKey });
    }
    if (path === '/me' && m === 'GET') {
      const u = await user(ctx);
      const r = await db.query('SELECT email, usage_bytes, file_count, wrapped_account_key FROM users WHERE id = $1', [u.id]);
      return send(res, 200, {
        email: r.rows[0].email,
        usageBytes: Number(r.rows[0].usage_bytes),
        quotaBytes: config.quotaBytes,
        wrappedAccountKey: r.rows[0].wrapped_account_key.toString('base64'),
        maxFileBytes: config.maxFileBytes,
        fileCount: Number(r.rows[0].file_count),
        maxFiles: config.maxFiles,
        transferBytesPerDay: config.transferBytesPerDay,
      });
    }
    if (path === '/me' && m === 'DELETE') {
      const u = await user(ctx);
      const body = await readJson(req, z.object({ authKey: b64 }));
      if (!(await verifyAuthKey(u.id, body.authKey))) throw new HttpError(401, 'bad_credentials', 'Your password is wrong.');
      const blobIds = (await db.query('SELECT f.blob_id FROM files f JOIN hives h ON h.id = f.hive_id WHERE h.user_id = $1 AND f.blob_id IS NOT NULL', [u.id])).rows.map((r) => r.blob_id as string);
      await db.query('DELETE FROM users WHERE id = $1', [u.id]);
      for (const b of blobIds) await blobs.delete(b).catch(() => {});
      return send(res, 204);
    }

    // ----- hives -----
    if (path === '/hives' && m === 'GET') {
      const u = await user(ctx);
      const r = await db.query('SELECT id, enc_name, wrapped_key, created_at FROM hives WHERE user_id = $1 ORDER BY created_at', [u.id]);
      return send(res, 200, r.rows.map((h) => ({ id: h.id, encName: h.enc_name.toString('base64'), wrappedKey: h.wrapped_key.toString('base64'), createdAt: h.created_at.toISOString() })));
    }
    if (path === '/hives' && m === 'POST') {
      const u = await user(ctx);
      const body = await readJson(req, z.object({ encName: b64, wrappedKey: b64 }));
      const count = await db.query('SELECT count(*)::int AS n FROM hives WHERE user_id = $1', [u.id]);
      if (count.rows[0].n >= 50) throw new HttpError(403, 'limit', 'You have the maximum of 50 synced hives.');
      const r = await db.query('INSERT INTO hives(user_id, enc_name, wrapped_key) VALUES ($1, $2, $3) RETURNING id, created_at', [u.id, Buffer.from(body.encName, 'base64'), Buffer.from(body.wrappedKey, 'base64')]);
      return send(res, 201, { id: r.rows[0].id, encName: body.encName, wrappedKey: body.wrappedKey, createdAt: r.rows[0].created_at.toISOString() });
    }

    const hm = /^\/hives\/([^/]+)(\/changes|\/events|\/files\/([^/]+))?$/.exec(path);
    if (!hm) throw new HttpError(404, 'not_found', 'Not found.');
    const hiveId = decodeURIComponent(hm[1]);
    const u = await user(ctx);
    await hiveFor(u.id, hiveId);

    if (!hm[2] && m === 'DELETE') {
      const blobIds = (await db.query('SELECT blob_id FROM files WHERE hive_id = $1 AND blob_id IS NOT NULL', [hiveId])).rows.map((r) => r.blob_id as string);
      await tx(db, async (c) => {
        const live = await c.query('SELECT coalesce(sum(size), 0)::bigint AS s, count(*)::int AS n FROM files WHERE hive_id = $1 AND NOT deleted', [hiveId]);
        await c.query('DELETE FROM hives WHERE id = $1', [hiveId]);
        await c.query('UPDATE users SET usage_bytes = greatest(0, usage_bytes - $2), file_count = greatest(0, file_count - $3) WHERE id = $1', [u.id, Number(live.rows[0].s), live.rows[0].n]);
      });
      for (const b of blobIds) await blobs.delete(b).catch(() => {});
      return send(res, 204);
    }
    if (hm[2] === '/changes' && m === 'GET') {
      const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
      const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 500) || 500));
      const r = await db.query('SELECT path_id, rev, seq, deleted, meta, size FROM files WHERE hive_id = $1 AND seq > $2 ORDER BY seq LIMIT $3', [hiveId, since, limit + 1]);
      const more = r.rows.length > limit;
      const rows = r.rows.slice(0, limit);
      const top = rows.length ? Number(rows[rows.length - 1].seq) : Number((await db.query('SELECT seq FROM hives WHERE id = $1', [hiveId])).rows[0].seq);
      return send(res, 200, {
        records: rows.map((f) => ({ pathId: f.path_id, rev: f.rev, seq: Number(f.seq), deleted: f.deleted, meta: f.meta ? f.meta.toString('base64') : null, size: Number(f.size) })),
        seq: Math.max(top, since),
        more,
      });
    }
    if (hm[2] === '/events' && m === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(': connected\n\n');
      const off = notifier.subscribe(hiveId, (seq) => res.write(`event: change\ndata: {"seq":${seq}}\n\n`));
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        off();
      });
      return;
    }
    if (hm[3]) {
      const id = hm[3];
      if (!pathIdRe.test(id)) throw new HttpError(400, 'invalid', 'Bad file id.');
      if (m === 'GET') {
        const r = await db.query('SELECT blob_id, size FROM files WHERE hive_id = $1 AND path_id = $2 AND NOT deleted', [hiveId, id]);
        if (!r.rowCount || !r.rows[0].blob_id) throw new HttpError(404, 'not_found', 'No such file.');
        await charge(u.id, Number(r.rows[0].size));
        const data = await blobs.get(r.rows[0].blob_id);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length }).end(data);
        return;
      }
      if (m === 'PUT') {
        const expect = ifMatch(ctx);
        const meta = metaHeader(ctx);
        // Sealed content is the file plus a small header and tag, hence the allowance.
        const body = await readBody(req, config.maxFileBytes + 64, `Files over ${size(config.maxFileBytes)} don't sync. Sync is for notes; big files stay on your devices.`);
        await charge(u.id, body.length);
        return send(res, 200, await writeFile(hiveId, u.id, id, expect, meta, body));
      }
      if (m === 'DELETE') {
        const expect = ifMatch(ctx);
        const meta = metaHeader(ctx);
        return send(res, 200, await writeFile(hiveId, u.id, id, expect, meta, null));
      }
    }
    throw new HttpError(405, 'method', 'Method not allowed.');
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const fwd = config.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const ip = fwd || req.socket.remoteAddress || 'unknown';
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    try {
      await route({ req, res, url, ip });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code, message: err.message, ...err.extra });
      console.error(`${req.method} ${url.pathname}:`, err);
      if (!res.headersSent) send(res, 500, { error: 'server', message: 'The sync server hit an error. Try again shortly.' });
    }
  });
}
