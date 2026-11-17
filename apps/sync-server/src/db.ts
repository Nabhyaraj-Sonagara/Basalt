import pg from 'pg';

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     email text NOT NULL UNIQUE,
     email_verified boolean NOT NULL DEFAULT false,
     salt bytea NOT NULL,
     kdf jsonb NOT NULL,
     auth_salt bytea NOT NULL,
     auth_hash bytea NOT NULL,
     wrapped_account_key bytea NOT NULL,
     usage_bytes bigint NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE IF NOT EXISTS sessions (
     token_hash bytea PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL
   );
   CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
   CREATE TABLE IF NOT EXISTS hives (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     enc_name bytea NOT NULL,
     wrapped_key bytea NOT NULL,
     seq bigint NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX IF NOT EXISTS hives_user ON hives(user_id);
   CREATE TABLE IF NOT EXISTS files (
     hive_id uuid NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
     path_id text NOT NULL,
     rev integer NOT NULL,
     seq bigint NOT NULL,
     deleted boolean NOT NULL DEFAULT false,
     meta bytea,
     blob_id text,
     size bigint NOT NULL DEFAULT 0,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (hive_id, path_id)
   );
   CREATE INDEX IF NOT EXISTS files_seq ON files(hive_id, seq);`,
];

export type Db = pg.Pool;

export function createPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

/** Applies schema migrations in order, once each. Safe to run on every start. */
export async function migrate(db: Db): Promise<void> {
  const c = await db.connect();
  try {
    await c.query('SELECT pg_advisory_lock(812734)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version as number));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      if (done.has(i + 1)) continue;
      await c.query('BEGIN');
      await c.query(MIGRATIONS[i]);
      await c.query('INSERT INTO schema_migrations(version) VALUES ($1)', [i + 1]);
      await c.query('COMMIT');
    }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await c.query('SELECT pg_advisory_unlock(812734)').catch(() => {});
    c.release();
  }
}

export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}
