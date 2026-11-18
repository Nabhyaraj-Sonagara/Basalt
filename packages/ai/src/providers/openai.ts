import { httpError, sseData } from '../sse';
import type { ChatProvider, ChatRequest, Embedder, ProviderConfig } from '../types';

/**
 * OpenAI and any OpenAI-compatible endpoint (Ollama, LM Studio, OpenRouter, Groq, Mistral, vLLM…).
 */
export class OpenAIProvider implements ChatProvider {
  constructor(readonly config: ProviderConfig) {}

  get baseUrl(): string {
    return (this.config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) h.authorization = `Bearer ${this.config.apiKey}`;
    return h;
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) =>
        m.images?.length
          ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } }))] }
          : { role: m.role, content: m.content },
      ),
    ];
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: this.config.model, messages, stream: true, ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}) }),
      signal: req.signal,
    });
    if (!res.ok) throw await httpError(res, this.config.label);
    for await (const data of sseData(res, req.signal)) {
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const text = j.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        /* skip keep-alive lines */
      }
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) throw await httpError(res, this.config.label);
    const j = (await res.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => m.id).sort();
  }
}

export class OpenAIEmbedder implements Embedder {
  readonly id: string;
  dims = 0;
  constructor(private config: ProviderConfig) {
    this.id = `${config.kind}:${config.baseUrl ?? ''}:${config.embeddingModel}`;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const base = (this.config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
    const res = await fetch(`${base}/embeddings`, { method: 'POST', headers, body: JSON.stringify({ model: this.config.embeddingModel, input: texts }), signal });
    if (!res.ok) throw await httpError(res, this.config.label);
    const j = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    const out = j.data.sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
    this.dims = out[0]?.length ?? this.dims;
    return out;
  }
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
