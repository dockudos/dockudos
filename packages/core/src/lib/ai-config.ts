import {
  type FetchLike,
  anthropicProvider,
  openaiEmbeddings,
  openaiProvider,
} from './ai-adapters.ts';
import type { EmbeddingProvider, LLMProvider } from './ai-provider.ts';
import type { DocsConfig } from './config.ts';

/** The environment variables secrets are read from. They are never read from `docs.json`. */
export const AI_ENV = {
  llmKey: 'DOCKUDOS_LLM_API_KEY',
  embeddingsKey: 'DOCKUDOS_EMBEDDINGS_API_KEY',
} as const;

export interface ResolvedAi {
  /** `undefined` when AI is off or the model could not be set up (see `problems`). */
  llm?: LLMProvider;
  /** `undefined` when embeddings are off or could not be set up. Search then uses keywords alone. */
  embeddings?: EmbeddingProvider;
  /** What is wrong with the setup, in words a site owner can act on. Empty when all is well. */
  problems: string[];
}

export interface ResolveAiOptions {
  /** Where secrets come from. Pass `process.env` on a server. */
  env: Record<string, string | undefined>;
  /** An adapter of your own, used instead of the one `ai.provider` names. Required for `custom`. */
  llm?: LLMProvider;
  embeddings?: EmbeddingProvider;
  fetch?: FetchLike;
}

/**
 * Build the providers the `ai` block asks for. Never throws and never returns a half-working provider:
 * a missing key or adapter is reported in `problems` and the feature falls back (no model: related pages
 * instead of an answer; no embeddings: keywords only).
 */
export function resolveAiProviders(
  ai: DocsConfig['ai'],
  { env, llm, embeddings, fetch }: ResolveAiOptions,
): ResolvedAi {
  const out: ResolvedAi = { problems: [] };
  if (!ai.enabled) return out;

  const llmKey = env[AI_ENV.llmKey]?.trim();
  if (llm) out.llm = llm;
  else if (ai.provider === 'custom')
    out.problems.push(
      'ai.provider is "custom", but no adapter was given. Pass `llm` to createDocsApi({ ai: { llm } }).',
    );
  else if (!llmKey)
    out.problems.push(
      `Set the ${AI_ENV.llmKey} environment variable to use the ${ai.provider} model.`,
    );
  else if (ai.provider === 'openai' && ai.model)
    out.llm = openaiProvider({
      apiKey: llmKey,
      model: ai.model,
      baseUrl: ai.baseUrl,
      fetch,
    });
  else if (ai.provider === 'anthropic' && ai.model)
    out.llm = anthropicProvider({
      apiKey: llmKey,
      model: ai.model,
      baseUrl: ai.baseUrl,
      fetch,
    });

  if (embeddings) out.embeddings = embeddings;
  else if (ai.embeddings) {
    // One OpenAI key can serve both, unless the embeddings go to a different server.
    const sameServer =
      ai.provider === 'openai' && ai.embeddings.baseUrl === ai.baseUrl;
    const key =
      env[AI_ENV.embeddingsKey]?.trim() || (sameServer ? llmKey : undefined);
    if (!key)
      out.problems.push(
        `Set the ${AI_ENV.embeddingsKey} environment variable to use embeddings. Search uses keywords until then.`,
      );
    else
      out.embeddings = openaiEmbeddings({
        apiKey: key,
        model: ai.embeddings.model,
        baseUrl: ai.embeddings.baseUrl,
        dimensions: ai.embeddings.dimensions,
        fetch,
      });
  }
  return out;
}
