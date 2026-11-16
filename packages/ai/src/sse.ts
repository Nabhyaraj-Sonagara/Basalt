/** Parses a fetch Response body as Server-Sent Events, yielding each event's data string. */
export async function* sseData(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = raw
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
      }
    }
    const tail = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export async function httpError(res: Response, provider: string): Promise<Error> {
  let detail = '';
  try {
    const body = await res.text();
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    detail = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? body.slice(0, 200);
  } catch {
    /* ignore */
  }
  const { ProviderError } = await import('./types');
  const hint =
    res.status === 401 || res.status === 403
      ? 'Check the API key in Settings → Assistant.'
      : res.status === 429
        ? 'Rate limited. Try again in a moment.'
        : res.status === 404
          ? 'Check the model name and endpoint.'
          : '';
  return new ProviderError(`${provider} returned ${res.status}${detail ? `: ${detail}` : ''}. ${hint}`.trim(), res.status, res.status === 429 || res.status >= 500);
}
