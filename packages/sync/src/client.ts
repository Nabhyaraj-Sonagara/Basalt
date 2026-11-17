// HTTP client for a Basalt Sync server. Sends only sealed data; see crypto.ts.
import type {
  AuthParamsResponse,
  ChangesResponse,
  CreateHiveRequest,
  LoginRequest,
  MeResponse,
  PasswordRequest,
  RemoteHive,
  SessionResponse,
  SignupRequest,
  WriteResponse,
} from './protocol';
import { API, META_HEADER } from './protocol';

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

/** True for errors that mean "the server can't be reached right now", not "the request was wrong". */
export function isOffline(err: unknown): boolean {
  if (err instanceof SyncHttpError) return err.status >= 502 && err.status <= 504;
  return err instanceof TypeError || (err as { name?: string })?.name === 'AbortError' || /ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed/i.test(String((err as Error)?.message ?? err));
}

export class SyncClient {
  readonly base: string;
  constructor(
    server: string,
    public token: string | null = null,
    private readonly timeoutMs = 60_000,
  ) {
    const u = new URL(server);
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
      throw new Error('The sync server must use https:// (http:// is allowed only for localhost).');
    }
    this.base = u.origin + u.pathname.replace(/\/+$/, '');
  }

  private async request(method: string, path: string, opts: { json?: unknown; body?: Uint8Array; headers?: Record<string, string>; raw?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.body) {
      headers['content-type'] = 'application/octet-stream';
      body = opts.body as BodyInit;
    }
    const res = await fetch(this.base + API + path, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) {
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
      throw new SyncHttpError(res.status, String(data.error ?? res.status), String(data.message ?? `The sync server answered ${res.status}.`), data);
    }
    return res;
  }

  private async json<T>(method: string, path: string, json?: unknown): Promise<T> {
    const res = await this.request(method, path, { json });
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  authParams(email: string) {
    return this.json<AuthParamsResponse>('POST', '/auth/params', { email });
  }
  signup(req: SignupRequest) {
    return this.json<SessionResponse>('POST', '/auth/signup', req);
  }
  login(req: LoginRequest) {
    return this.json<SessionResponse>('POST', '/auth/login', req);
  }
  logout() {
    return this.json<void>('POST', '/auth/logout');
  }
  changePassword(req: PasswordRequest) {
    return this.json<SessionResponse>('POST', '/auth/password', req);
  }
  me() {
    return this.json<MeResponse>('GET', '/me');
  }
  deleteAccount(authKey: string) {
    return this.json<void>('DELETE', '/me', { authKey });
  }
  hives() {
    return this.json<RemoteHive[]>('GET', '/hives');
  }
  createHive(req: CreateHiveRequest) {
    return this.json<RemoteHive>('POST', '/hives', req);
  }
  deleteHive(id: string) {
    return this.json<void>('DELETE', `/hives/${encodeURIComponent(id)}`);
  }
  changes(hiveId: string, since: number, limit = 500) {
    return this.json<ChangesResponse>('GET', `/hives/${encodeURIComponent(hiveId)}/changes?since=${since}&limit=${limit}`);
  }
  async getFile(hiveId: string, pathId: string): Promise<Buffer> {
    const res = await this.request('GET', `/hives/${encodeURIComponent(hiveId)}/files/${pathId}`);
    return Buffer.from(await res.arrayBuffer());
  }
  async putFile(hiveId: string, pathId: string, data: Uint8Array, meta: string, ifMatch: number): Promise<WriteResponse> {
    const res = await this.request('PUT', `/hives/${encodeURIComponent(hiveId)}/files/${pathId}`, { body: data, headers: { 'if-match': String(ifMatch), [META_HEADER]: meta } });
    return (await res.json()) as WriteResponse;
  }
  async deleteFile(hiveId: string, pathId: string, meta: string, ifMatch: number): Promise<WriteResponse> {
    const res = await this.request('DELETE', `/hives/${encodeURIComponent(hiveId)}/files/${pathId}`, { headers: { 'if-match': String(ifMatch), [META_HEADER]: meta } });
    return (await res.json()) as WriteResponse;
  }

  /** Server-sent events for a hive. Calls `onChange` with the new sequence number; resolves when the stream ends. */
  async events(hiveId: string, onChange: (seq: number) => void, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}${API}/hives/${encodeURIComponent(hiveId)}/events`, {
      headers: { authorization: `Bearer ${this.token}`, accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) throw new SyncHttpError(res.status, 'events', `The sync server answered ${res.status}.`);
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data:'));
        if (/^event: ?change/m.test(block) && data) {
          try {
            onChange(Number(JSON.parse(data.slice(5)).seq));
          } catch {
            /* ignore malformed events */
          }
        }
      }
    }
  }
}
