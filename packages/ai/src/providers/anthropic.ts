import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type ChatProvider, type ChatRequest, type ProviderConfig } from '../types';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

/** Claude via the official SDK. Server-side refusal fallbacks are on by default. */
export class AnthropicProvider implements ChatProvider {
  private client: Anthropic;

  constructor(readonly config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey || undefined, baseURL: config.baseUrl || undefined });
  }

  async *stream(req: ChatRequest): AsyncIterable<string> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.config.model || DEFAULT_CLAUDE_MODEL,
        max_tokens: req.maxTokens ?? 64000,
        system: req.system,
        messages: req.messages,
        output_config: { effort: this.config.effort ?? 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: req.signal },
    );
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        throw new ProviderError("Claude declined this request. Try rephrasing it, or pick another model in Settings → Assistant.");
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new ProviderError('Claude rejected the API key. Check it in Settings → Assistant.', 401);
      if (err instanceof Anthropic.RateLimitError) throw new ProviderError('Claude is rate limiting requests. Try again in a moment.', 429, true);
      if (err instanceof Anthropic.NotFoundError) throw new ProviderError(`Claude doesn't recognise the model "${this.config.model}".`, 404);
      if (err instanceof Anthropic.APIError) throw new ProviderError(`Claude returned an error (${err.status ?? 'network'}): ${err.message}`, err.status, true);
      throw err;
    }
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }
}
