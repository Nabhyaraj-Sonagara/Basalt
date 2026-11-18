import { httpError, sseData } from '../sse';
import type { ChatProvider, ChatRequest, Embedder, ProviderConfig } from '../types';
import { normalize } from './openai';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements ChatProvider {
  constructor(readonly config: ProviderConfig) {}

  private get base(): string {
    return (this.config.baseUrl || BASE).replace(/\/+$/, '');
  }

  private headers() {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey ?? '' };
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const body = {
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      contents: req.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mediaType, data: i.data } })), { text: m.content }],
      })),
      ...(req.maxTokens ? { generationConfig: { maxOutputTokens: req.maxTokens } } : {}),
    };
    const res = await fetch(`${this.base}/models/${encodeURIComponent(this.config.model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw await httpError(res, this.config.label);
    for await (const data of sseData(res, req.signal)) {
      try {
        const j = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
        if (text) yield text;
      } catch {
        /* ignore */
      }
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.base}/models?pageSize=200`, { headers: this.headers() });
    if (!res.ok) throw await httpError(res, this.config.label);
    const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (j.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  }
}

export class GeminiEmbedder implements Embedder {
  readonly id: string;
  dims = 0;
  constructor(private config: ProviderConfig) {
    this.id = `gemini:${config.embeddingModel}`;
  }
  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const model = `models/${this.config.embeddingModel}`;
    const res = await fetch(`${BASE}/${model}:batchEmbedContents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.config.apiKey ?? '' },
      body: JSON.stringify({ requests: texts.map((t) => ({ model, content: { parts: [{ text: t }] } })) }),
      signal,
    });
    if (!res.ok) throw await httpError(res, this.config.label);
    const j = (await res.json()) as { embeddings: { values: number[] }[] };
    const out = j.embeddings.map((e) => normalize(Float32Array.from(e.values)));
    this.dims = out[0]?.length ?? 0;
    return out;
  }
}
