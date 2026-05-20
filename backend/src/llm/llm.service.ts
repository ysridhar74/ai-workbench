import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * LlmService wraps LiteLLM (via its OpenAI-compatible proxy) or the
 * OpenAI SDK directly. The active model and endpoint are driven entirely
 * by environment variables — no model names are hardcoded.
 *
 * To use LiteLLM proxy: set LLM_BASE_URL to the proxy URL (e.g. http://localhost:4000)
 * To call providers directly: leave LLM_BASE_URL unset and set the
 *   appropriate provider API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
 *   LiteLLM's OpenAI-compat layer handles the routing.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.get<string>('LLM_BASE_URL');
    const apiKey =
      this.config.get<string>('OPENAI_API_KEY') ||
      this.config.get<string>('ANTHROPIC_API_KEY') ||
      this.config.get<string>('LLM_API_KEY') ||
      'placeholder'; // LiteLLM proxy may not require a real key

    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    this.defaultModel = this.config.getOrThrow<string>('LLM_MODEL');
    this.logger.log(`LLM configured — model: ${this.defaultModel}${baseURL ? ` via ${baseURL}` : ''}`);
  }

  /**
   * Send a completion request and return the full response with token metrics.
   */
  async complete(
    messages: LlmMessage[],
    options?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<LlmResponse> {
    const model = options?.model ?? this.defaultModel;

    const response = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 1,
      max_tokens: options?.maxTokens ?? 2048,
    });

    const choice = response.choices[0];
    const usage = response.usage;

    return {
      content: choice.message.content ?? '',
      model: response.model ?? model,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    };
  }

  /**
   * Stream a completion — yields text chunks as they arrive.
   * Collects the full response and token counts at the end.
   */
  async *stream(
    messages: LlmMessage[],
    options?: { model?: string; temperature?: number; maxTokens?: number },
  ): AsyncGenerator<{ chunk?: string; done: boolean; metrics?: Omit<LlmResponse, 'content'> }> {
    const model = options?.model ?? this.defaultModel;

    const stream = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 1,
      max_tokens: options?.maxTokens ?? 2048,
      stream: true,
      stream_options: { include_usage: true },
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let resolvedModel = model;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield { chunk: delta, done: false };
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
      if (chunk.model) resolvedModel = chunk.model;
    }

    yield {
      done: true,
      metrics: {
        model: resolvedModel,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }
}
