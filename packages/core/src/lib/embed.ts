import { type AskContext, parseContext } from './ask.ts';

/** The message the embedded assistant sends its host once it is running, so the host can say where the reader is. */
export const EMBED_READY_MESSAGE = 'dockudos:ready';

/** The message the embedded assistant sends its host when the reader presses Escape inside it. */
export const EMBED_CLOSE_MESSAGE = 'dockudos:close';

/** The message a host page sends its embedded assistant to say where the reader is. */
export const EMBED_CONTEXT_MESSAGE = 'dockudos:context';

/** The address of the embeddable assistant of a site, with the context in the query. */
export function embedUrl(siteUrl: string, context?: AskContext): string {
  const url = new URL('/embed', siteUrl);
  if (context?.path) url.searchParams.set('path', context.path);
  if (context?.hint) url.searchParams.set('hint', context.hint);
  return url.toString();
}

type Params = Record<string, string | string[] | undefined>;

/** Read the context from the query of the embed page. Anything that is not a short plain string is ignored. */
export function embedContextFromParams(
  params: URLSearchParams | Params,
): AskContext | undefined {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  return parseContext({ path: get('path'), hint: get('hint') });
}

/** Read a context message from a host page; `undefined` for any other message. */
export function parseContextMessage(data: unknown): AskContext | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const message = data as { type?: unknown; context?: unknown };
  if (message.type !== EMBED_CONTEXT_MESSAGE) return undefined;
  return parseContext(message.context) ?? {};
}
