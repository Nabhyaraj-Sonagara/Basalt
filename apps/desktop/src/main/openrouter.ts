// "Sign in with OpenRouter": OAuth with PKCE. The browser asks the person to approve Basalt,
// OpenRouter redirects to a one-shot server on localhost with a code, and we exchange the code
// for a key that belongs to their OpenRouter account (no key to copy and paste).
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const BASE = () => (process.env.BASALT_OPENROUTER_URL || 'https://openrouter.ai').replace(/\/+$/, '');
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Basalt</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0;background:#fbf6ea;color:#2b2722">
<div style="text-align:center"><h1 style="font-size:22px">You're signed in</h1><p>Close this tab and return to Basalt.</p></div></body>`;

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Runs the sign-in. Resolves with an OpenRouter API key for the person's account. */
export async function signInWithOpenRouter(openExternal: (url: string) => Promise<void>, signal?: AbortSignal): Promise<string> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  const server = createServer((req, res) => {
    // One request per connection: a browser must never reuse this socket for a later sign-in.
    res.setHeader('connection', 'close');
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get('code');
    if (!code || (url.searchParams.has('state') && url.searchParams.get('state') !== state)) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('Sign-in failed. Close this tab and try again from Basalt.');
      rejectCode(new Error('OpenRouter sign-in was cancelled or failed.'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE);
    resolveCode(code);
  });
  // OpenRouter's docs use localhost:3000 for local apps; fall back to any free port.
  let port: number;
  try {
    port = await listen(server, 3000);
  } catch {
    port = await listen(server, 0);
  }
  const timer = setTimeout(() => rejectCode(new Error('Sign-in timed out. Try again.')), 5 * 60_000);
  signal?.addEventListener('abort', () => rejectCode(new Error('Sign-in cancelled.')));
  try {
    const callback = `http://localhost:${port}/callback`;
    const auth = `${BASE()}/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
    await openExternal(auth);
    const code = await codePromise;
    const res = await fetch(`${BASE()}/api/v1/auth/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`OpenRouter didn't accept the sign-in (${res.status}). Try again.`);
    const data = (await res.json()) as { key?: string };
    if (!data.key) throw new Error("OpenRouter didn't return a key.");
    return data.key;
  } finally {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }
}

export interface LocalModels {
  id: 'ollama' | 'lmstudio';
  label: string;
  baseUrl: string;
  models: string[];
  embeddingModels: string[];
}

/** Looks for Ollama and LM Studio running on this computer. */
export async function detectLocalModels(): Promise<LocalModels[]> {
  const probe = async (url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return res.ok ? ((await res.json()) as unknown) : null;
    } catch {
      return null;
    }
  };
  const isEmbed = (m: string) => /embed|bge|e5-|nomic|minilm/i.test(m);
  const out: LocalModels[] = [];
  const ollama = (await probe(`${process.env.BASALT_OLLAMA_URL || 'http://127.0.0.1:11434'}/api/tags`)) as { models?: { name: string }[] } | null;
  if (ollama?.models) {
    const names = ollama.models.map((m) => m.name);
    out.push({ id: 'ollama', label: 'Ollama', baseUrl: `${process.env.BASALT_OLLAMA_URL || 'http://localhost:11434'}/v1`, models: names.filter((m) => !isEmbed(m)), embeddingModels: names.filter(isEmbed) });
  }
  const lms = (await probe(`${process.env.BASALT_LMSTUDIO_URL || 'http://127.0.0.1:1234'}/v1/models`)) as { data?: { id: string }[] } | null;
  if (lms?.data) {
    const names = lms.data.map((m) => m.id);
    out.push({ id: 'lmstudio', label: 'LM Studio', baseUrl: `${process.env.BASALT_LMSTUDIO_URL || 'http://localhost:1234'}/v1`, models: names.filter((m) => !isEmbed(m)), embeddingModels: names.filter(isEmbed) });
  }
  return out;
}
