// Tells open event streams that a hive changed. Uses Postgres LISTEN/NOTIFY, so it also works
// with several server instances behind a load balancer.
import pg from 'pg';

type Listener = (seq: number) => void;

export class Notifier {
  private listeners = new Map<string, Set<Listener>>();
  private client: pg.Client | null = null;

  constructor(private readonly db: pg.Pool | null) {}

  async start(databaseUrl: string): Promise<void> {
    this.client = new pg.Client({ connectionString: databaseUrl });
    this.client.on('notification', (msg) => {
      const [hiveId, seq] = (msg.payload ?? '').split(':');
      for (const l of this.listeners.get(hiveId) ?? []) l(Number(seq));
    });
    this.client.on('error', (err) => console.error('LISTEN connection error:', err.message));
    await this.client.connect();
    await this.client.query('LISTEN basalt_hive_changes');
  }

  async notify(hiveId: string, seq: number): Promise<void> {
    if (this.db && this.client) await this.db.query('SELECT pg_notify($1, $2)', ['basalt_hive_changes', `${hiveId}:${seq}`]);
    else for (const l of this.listeners.get(hiveId) ?? []) l(seq);
  }

  subscribe(hiveId: string, fn: Listener): () => void {
    const set = this.listeners.get(hiveId) ?? new Set();
    set.add(fn);
    this.listeners.set(hiveId, set);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(hiveId);
    };
  }

  async stop(): Promise<void> {
    await this.client?.end().catch(() => {});
  }
}
