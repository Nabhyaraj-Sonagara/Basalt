import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  /** Used to make up stable salts for unknown emails, so sign-in doesn't reveal who has an account. */
  serverSecret: string;
  dataDir: string;
  s3: { bucket: string; region?: string; prefix: string; endpoint?: string } | null;
  quotaBytes: number;
  maxFileBytes: number;
  allowSignup: boolean;
  /** Read the client address from X-Forwarded-For (set when behind Caddy or a load balancer). */
  trustProxy: boolean;
  sessionDays: number;
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v: string | undefined, d: boolean) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.DATABASE_URL) throw new Error('Set DATABASE_URL, for example postgres://basalt:password@db:5432/basalt');
  if (!env.SERVER_SECRET || env.SERVER_SECRET.length < 32) {
    throw new Error(`Set SERVER_SECRET to a long random value, for example: ${randomBytes(32).toString('hex')}`);
  }
  return {
    port: num(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL,
    serverSecret: env.SERVER_SECRET,
    dataDir: env.DATA_DIR ?? '/data/blobs',
    s3: env.S3_BUCKET ? { bucket: env.S3_BUCKET, region: env.S3_REGION || env.AWS_REGION, prefix: env.S3_PREFIX ?? 'blobs/', endpoint: env.S3_ENDPOINT || undefined } : null,
    quotaBytes: num(env.QUOTA_BYTES, 1024 ** 3),
    maxFileBytes: num(env.MAX_FILE_BYTES, 100 * 1024 ** 2),
    allowSignup: bool(env.ALLOW_SIGNUP, true),
    trustProxy: bool(env.TRUST_PROXY, false),
    sessionDays: num(env.SESSION_DAYS, 90),
  };
}
