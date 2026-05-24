import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { AzureOpenAI } from 'openai';

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
 * LlmService wraps the OpenAI SDK (or Azure OpenAI SDK) for non-agent completions
 * such as memory extraction. Provider is selected by LLM_PROVIDER env var:
 *
 *   LLM_PROVIDER=azure   → AzureOpenAI client
 *                          Requires: AZURE_OPENAI_API_KEY, AZURE_OPENAI_INSTANCE_NAME,
 *                                    AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
 *
 *   (default)            → OpenAI-compatible client
 *                          Supports: OpenAI direct, LiteLLM proxy, Ollama
 *                          Requires: OPENAI_API_KEY (or ANTHROPIC_API_KEY / LLM_API_KEY)
 *                          Optional: LLM_BASE_URL to route through a proxy
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI | AzureOpenAI;
  private readonly defaultModel: string;
  private readonly isAzure: boolean;
  private readonly azureDeployment: string | undefined;

  constructor(private readonly config: ConfigService) {
    const provider = (this.config.get<string>('LLM_PROVIDER') ?? '').toLowerCase();
    this.isAzure = provider === 'azure';

    if (this.isAzure) {
      const instanceName = this.config.getOrThrow<string>('AZURE_OPENAI_INSTANCE_NAME');
      this.azureDeployment = this.config.getOrThrow<string>('AZURE_OPENAI_DEPLOYMENT');
      const apiVersion = this.config.get<string>('AZURE_OPENAI_API_VERSION') ?? '2024-02-01';

      this.client = new AzureOpenAI({
        apiKey: this.config.getOrThrow<string>('AZURE_OPENAI_API_KEY'),
        endpoint: `https://${instanceName}.openai.azure.com`,
        apiVersion,
        deployment: this.azureDeployment,
      });

      this.defaultModel = this.azureDeployment; // Azure uses deployment name as model
      this.logger.log(`LLM configured — Azure OpenAI · deployment: ${this.azureDeployment} · version: ${apiVersion}`);
    } else {
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
  }

  /**
   * Send a completion request and return the full response with token metrics.
   * For Azure, the model param is the deployment name (already set as defaultModel).
   */
  async complete(
    messages: LlmMessage[],
    options?: { model?: string; temperature?: number; maxTokens?: number },
  ): Promise<LlmResponse> {
    // Azure: always use the configured deployment name — ignore any model override
    const model = this.isAzure
      ? (this.azureDeployment ?? this.defaultModel)
      : (options?.model ?? this.defaultModel);

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
    const model = this.isAzure
      ? (this.azureDeployment ?? this.defaultModel)
      : (options?.model ?? this.defaultModel);

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
