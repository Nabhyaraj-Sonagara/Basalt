import { HashedEmbedder } from './hashed';
import { AnthropicProvider, DEFAULT_CLAUDE_MODEL } from './providers/anthropic';
import { GeminiEmbedder, GeminiProvider } from './providers/gemini';
import { OpenAIEmbedder, OpenAIProvider } from './providers/openai';
import type { ChatProvider, Embedder, ProviderConfig, ProviderKind } from './types';

export interface ProviderPreset {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  model: string;
  embeddingModel?: string;
  needsKey: boolean;
  local?: boolean;
  /** Environment variable the CLI and MCP server read the key from. */
  envKey?: string;
}

/** Starting points shown in Settings. Model fields are editable, and "Load models" lists what the endpoint serves. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'claude', kind: 'anthropic', label: 'Claude', model: DEFAULT_CLAUDE_MODEL, needsKey: true, envKey: 'ANTHROPIC_API_KEY' },
  { id: 'openai', kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: '', embeddingModel: 'text-embedding-3-small', needsKey: true, envKey: 'OPENAI_API_KEY' },
  { id: 'gemini', kind: 'gemini', label: 'Google Gemini', model: '', embeddingModel: 'text-embedding-004', needsKey: true, envKey: 'GEMINI_API_KEY' },
  { id: 'ollama', kind: 'openai-compatible', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: '', embeddingModel: 'nomic-embed-text', needsKey: false, local: true },
  { id: 'lmstudio', kind: 'openai-compatible', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false, local: true },
  { id: 'openrouter', kind: 'openai-compatible', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', needsKey: true, envKey: 'OPENROUTER_API_KEY' },
  { id: 'groq', kind: 'openai-compatible', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: '', needsKey: true, envKey: 'GROQ_API_KEY' },
  { id: 'mistral', kind: 'openai-compatible', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: '', embeddingModel: 'mistral-embed', needsKey: true, envKey: 'MISTRAL_API_KEY' },
];

export function createProvider(config: ProviderConfig): ChatProvider {
  switch (config.kind) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'openai':
    case 'openai-compatible':
      return new OpenAIProvider(config);
    default:
      throw new Error(`No chat model for provider kind "${config.kind}"`);
  }
}

/** The embedder for semantic search. Falls back to the built-in offline embedder. */
export function createEmbedder(config?: ProviderConfig | null): Embedder {
  if (!config?.embeddingModel || config.kind === 'builtin') return new HashedEmbedder();
  if (config.kind === 'gemini') return new GeminiEmbedder(config);
  if (config.kind === 'openai' || config.kind === 'openai-compatible') return new OpenAIEmbedder(config);
  return new HashedEmbedder();
}

/** Provider configs from environment variables, for the CLI and MCP server. */
export function providersFromEnv(env: Record<string, string | undefined> = process.env): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  for (const p of PROVIDER_PRESETS) {
    const key = p.envKey ? env[p.envKey] : undefined;
    if (p.needsKey && !key) continue;
    if (p.local) continue;
    out.push({ id: p.id, kind: p.kind, label: p.label, baseUrl: p.baseUrl, apiKey: key, model: env[`BASALT_${p.id.toUpperCase()}_MODEL`] || p.model, embeddingModel: p.embeddingModel });
  }
  if (env.BASALT_OPENAI_COMPAT_URL) {
    out.push({ id: 'custom', kind: 'openai-compatible', label: 'Custom', baseUrl: env.BASALT_OPENAI_COMPAT_URL, apiKey: env.BASALT_OPENAI_COMPAT_KEY, model: env.BASALT_OPENAI_COMPAT_MODEL ?? '', embeddingModel: env.BASALT_OPENAI_COMPAT_EMBED });
  }
  return out;
}
