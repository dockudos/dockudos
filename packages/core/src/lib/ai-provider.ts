/** One turn of a conversation. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateInput {
  /** Fixed instructions for the model. */
  system: string;
  /** The conversation so far; the last message is the user's. */
  messages: ChatMessage[];
  /** Most tokens to produce. */
  maxTokens?: number;
  /** Cancels the request (the reader closed the page, or the answer is no longer wanted). */
  signal?: AbortSignal;
}

/**
 * A language model. `generate` streams the answer as pieces of text. Implement it to use any model:
 * the built-in adapters are `openaiProvider` and `anthropicProvider`.
 */
export interface LLMProvider {
  id: string;
  generate(input: GenerateInput): AsyncIterable<string>;
}

/** A model that turns text into vectors, for meaning-based search. */
export interface EmbeddingProvider {
  id: string;
  /** The model's name, recorded in the index so vectors from different models are never mixed. */
  model?: string;
  /** Length of each vector; 0 when it is only known after the first call. */
  dimensions: number;
  embed(
    texts: string[],
    options?: { signal?: AbortSignal },
  ): Promise<number[][]>;
}

/** A provider answered with an error, or could not be reached. The message never contains a key. */
export class ProviderError extends Error {
  /** HTTP status, when the provider answered. */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    if (status !== undefined) this.status = status;
  }
}

/** Remove every secret from a text, so error messages and logs cannot leak a key. */
export function redact(text: string, secrets: readonly (string | undefined)[]) {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join('***');
  }
  return out;
}

/**
 * Make a conversation acceptable to every provider: it starts with a user message, roles alternate
 * (neighbours with the same role are joined), and empty messages are dropped.
 */
export function normalizeMessages(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out.at(-1);
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else if (last || m.role === 'user') out.push({ role: m.role, content });
  }
  return out;
}

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Read a Server-Sent Events body: events end at a blank line, a `data:` field can span lines, and
 * network chunks can cut anywhere (including inside a character or between `\r` and `\n`).
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n?/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const event = parseEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event) yield event;
      }
      if (done) break;
    }
    const rest = parseEvent(buffer);
    if (rest) yield rest;
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(block: string): SseEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length
    ? { ...(event && { event }), data: data.join('\n') }
    : undefined;
}
