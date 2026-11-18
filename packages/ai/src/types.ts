export type ProviderKind = 'anthropic' | 'openai' | 'gemini' | 'openai-compatible' | 'builtin';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  /** For openai-compatible endpoints (Ollama, LM Studio, OpenRouter, Groq, Mistral…). */
  baseUrl?: string;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
  /** Claude only: output_config.effort. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/** A picture sent with a message: base64 bytes, no data: prefix. */
export interface ChatImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Pictures for models that can see them (sketches, photos, screenshots). */
  images?: ChatImage[];
}

export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatProvider {
  readonly config: ProviderConfig;
  /** Streams text deltas. Throws ProviderError on failure. */
  stream(req: ChatRequest): AsyncIterable<string>;
  listModels(): Promise<string[]>;
}

export interface Embedder {
  readonly id: string;
  readonly dims: number;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}
