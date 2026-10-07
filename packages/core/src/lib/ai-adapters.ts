import {
  type ChatMessage,
  type EmbeddingProvider,
  type GenerateInput,
  type LLMProvider,
  ProviderError,
  normalizeMessages,
  readSse,
  redact,
} from './ai-provider.ts';

/** The part of `fetch` the adapters use, so tests and runtimes without a global `fetch` can supply their own. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export interface AdapterOptions {
  apiKey: string;
  model: string;
  /** API address, without a trailing slash. Default: the vendor's. Point it at any compatible server. */
  baseUrl?: string;
  fetch?: FetchLike;
}

const OPENAI_URL = 'https://api.openai.com/v1';
const ANTHROPIC_URL = 'https://api.anthropic.com';
const trimUrl = (url: string) => url.replace(/\/+$/, '');

async function failure(
  what: string,
  response: Response,
  secrets: string[],
): Promise<ProviderError> {
  let detail = '';
  try {
    const text = (await response.text()).slice(0, 400);
    try {
      const json = JSON.parse(text) as {
        error?: { message?: string } | string;
      };
      detail =
        typeof json.error === 'string'
          ? json.error
          : (json.error?.message ?? text);
    } catch {
      detail = text;
    }
  } catch {
    /* no body */
  }
  const message = redact(
    `${what} failed (${response.status})${detail ? `: ${detail.trim()}` : '.'}`,
    secrets,
  );
  return new ProviderError(message, response.status);
}

async function send(
  what: string,
  doFetch: FetchLike,
  url: string,
  init: Parameters<FetchLike>[1],
  secrets: string[],
): Promise<Response> {
  let response: Response;
  try {
    response = await doFetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ProviderError(
      redact(
        `${what} could not be reached: ${(error as Error).message}`,
        secrets,
      ),
    );
  }
  if (!response.ok) throw await failure(what, response, secrets);
  return response;
}

/**
 * Chat models from OpenAI and anything that speaks its API (Azure gateways, vLLM, Ollama, LiteLLM,
 * OpenRouter...): set `baseUrl`. Streams `choices[].delta.content`.
 */
export function openaiProvider(options: AdapterOptions): LLMProvider {
  const doFetch = options.fetch ?? ((u, i) => fetch(u, i));
  const base = trimUrl(options.baseUrl ?? OPENAI_URL);
  // OpenAI's newer models reject `max_tokens`; other servers have not all learned the new name.
  const tokenField = options.baseUrl ? 'max_tokens' : 'max_completion_tokens';
  return {
    id: 'openai',
    async *generate({ system, messages, maxTokens, signal }: GenerateInput) {
      const response = await send(
        'The language model request',
        doFetch,
        `${base}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            stream: true,
            ...(maxTokens && { [tokenField]: maxTokens }),
            messages: [
              { role: 'system', content: system },
              ...normalizeMessages(messages),
            ],
          }),
          signal,
        },
        [options.apiKey],
      );
      if (!response.body)
        throw new ProviderError('The language model sent no response body.');
      for await (const { data } of readSse(response.body)) {
        if (data === '[DONE]') return;
        let chunk: {
          choices?: { delta?: { content?: string | null } }[];
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error)
          throw new ProviderError(
            redact(
              chunk.error.message ?? 'The language model reported an error.',
              [options.apiKey],
            ),
          );
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    },
  };
}

/** Claude models through the Messages API. Streams `text_delta` events. */
export function anthropicProvider(
  options: AdapterOptions & { version?: string },
): LLMProvider {
  const doFetch = options.fetch ?? ((u, i) => fetch(u, i));
  const base = trimUrl(options.baseUrl ?? ANTHROPIC_URL);
  return {
    id: 'anthropic',
    async *generate({ system, messages, maxTokens, signal }: GenerateInput) {
      const response = await send(
        'The language model request',
        doFetch,
        `${base}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': options.version ?? '2023-06-01',
          },
          body: JSON.stringify({
            model: options.model,
            stream: true,
            // The API requires a limit; 1024 is a modest default for an answer.
            max_tokens: maxTokens ?? 1024,
            system,
            messages: normalizeMessages(messages),
          }),
          signal,
        },
        [options.apiKey],
      );
      if (!response.body)
        throw new ProviderError('The language model sent no response body.');
      for await (const { event, data } of readSse(response.body)) {
        let body: {
          type?: string;
          delta?: { type?: string; text?: string };
          error?: { message?: string };
        };
        try {
          body = JSON.parse(data);
        } catch {
          continue;
        }
        if (event === 'error' || body.type === 'error')
          throw new ProviderError(
            redact(
              body.error?.message ?? 'The language model reported an error.',
              [options.apiKey],
            ),
          );
        if (
          body.type === 'content_block_delta' &&
          body.delta?.type === 'text_delta' &&
          body.delta.text
        )
          yield body.delta.text;
        if (body.type === 'message_stop') return;
      }
    },
  };
}

/** Well-known output sizes, so `dimensions` is right before the first call. */
const KNOWN_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
};

const EMBED_BATCH = 96;

export interface EmbeddingOptions extends AdapterOptions {
  /** Vector length to request (models that support shortening) or to assume (others). */
  dimensions?: number;
  /** Pause between retries, in ms. Default 500, doubling. */
  retryDelay?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Embeddings from OpenAI or any server with the same `/embeddings` route. */
export function openaiEmbeddings(options: EmbeddingOptions): EmbeddingProvider {
  const doFetch = options.fetch ?? ((u, i) => fetch(u, i));
  const base = trimUrl(options.baseUrl ?? OPENAI_URL);
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const provider: EmbeddingProvider = {
    id: 'openai',
    model: options.model,
    dimensions: options.dimensions ?? KNOWN_DIMENSIONS[options.model] ?? 0,
    async embed(texts, { signal } = {}) {
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH) {
        const batch = texts.slice(i, i + EMBED_BATCH);
        let attempt = 0;
        for (;;) {
          try {
            const response = await send(
              'The embeddings request',
              doFetch,
              `${base}/embeddings`,
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  authorization: `Bearer ${options.apiKey}`,
                },
                body: JSON.stringify({
                  model: options.model,
                  input: batch,
                  ...(options.dimensions && { dimensions: options.dimensions }),
                }),
                signal,
              },
              [options.apiKey],
            );
            const json = (await response.json()) as {
              data?: { index: number; embedding: number[] }[];
            };
            if (!json.data || json.data.length !== batch.length)
              throw new ProviderError(
                'The embeddings response did not match the request.',
              );
            for (const item of [...json.data].sort((a, b) => a.index - b.index))
              vectors.push(item.embedding);
            break;
          } catch (error) {
            const status =
              error instanceof ProviderError ? error.status : undefined;
            const retryable =
              status === 429 ||
              (status !== undefined && status >= 500) ||
              (error instanceof ProviderError &&
                status === undefined &&
                !signal?.aborted &&
                /could not be reached/.test(error.message));
            if (!retryable || attempt >= 2 || signal?.aborted) throw error;
            await sleep((options.retryDelay ?? 500) * 2 ** attempt++);
          }
        }
      }
      if (vectors[0]) provider.dimensions = vectors[0].length;
      return vectors;
    },
  };
  return provider;
}

export type { ChatMessage };
