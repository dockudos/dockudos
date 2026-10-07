import type { SearchHit } from './keyword-search.ts';

/** Protocol versions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

/** A page as the MCP tools return it. */
export interface McpPage {
  path: string;
  title: string;
  description?: string;
  /** The page as Markdown, ready for a model to read. */
  markdown: string;
}

export interface McpPageSummary {
  path: string;
  title: string;
  description?: string;
}

/** What the MCP server reads the docs through. Every method is read-only. */
export interface McpBackend {
  search(
    query: string,
    options: { limit: number; version?: string; locale?: string },
  ): SearchHit[] | Promise<SearchHit[]>;
  /** `'forbidden'` when the page is protected and the caller has not shown the right credentials. */
  getPage(
    path: string,
  ):
    | Promise<McpPage | 'forbidden' | undefined>
    | McpPage
    | 'forbidden'
    | undefined;
  listPages(): McpPageSummary[] | Promise<McpPageSummary[]>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  /** Hints for the model on how to use the tools. */
  instructions?: string;
}

type Id = string | number | null;
interface JsonRpcError {
  code: number;
  message: string;
}
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: Id;
  result?: unknown;
  error?: JsonRpcError;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const TOOLS = [
  {
    name: 'search_docs',
    title: 'Search the documentation',
    description:
      'Search the documentation by keywords or a short question. Returns the best matching sections, each with its page, heading, a link and a snippet. Use get_page to read a whole page.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to look for: names, error codes or a short question.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Most results to return. Default 8.',
        },
        version: {
          type: 'string',
          description:
            'Documentation version. Ignored when the site has a single version.',
        },
        locale: {
          type: 'string',
          description: 'Language. Ignored when the site has a single language.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_page',
    title: 'Read a documentation page',
    description:
      'Get the full text of one documentation page as Markdown, by its path (for example /guides/auth), as returned by search_docs or list_pages.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The page path, starting with /.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_pages',
    title: 'List documentation pages',
    description:
      'List the pages of the documentation with their titles and descriptions, optionally filtered by a word in the title, path or description.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Keep pages whose title, path or description contains this.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Most pages to return. Default 100.',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
] as const;

const text = (value: string, extra: object = {}) => ({
  content: [{ type: 'text', text: value }],
  ...extra,
});
const toolError = (message: string) => ({ ...text(message), isError: true });

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

class ProtocolError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function integer(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  max: number,
): number {
  const v = args[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max)
    throw new ProtocolError(
      INVALID_PARAMS,
      `"${key}" must be a whole number from 1 to ${max}.`,
    );
  return v;
}

function string(
  args: Record<string, unknown>,
  key: string,
  required = false,
): string | undefined {
  const v = args[key];
  if (v === undefined) {
    if (required)
      throw new ProtocolError(INVALID_PARAMS, `"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== 'string')
    throw new ProtocolError(INVALID_PARAMS, `"${key}" must be text.`);
  if (required && !v.trim())
    throw new ProtocolError(INVALID_PARAMS, `"${key}" must not be empty.`);
  if (v.length > 500)
    throw new ProtocolError(
      INVALID_PARAMS,
      `"${key}" is longer than 500 characters.`,
    );
  return v;
}

/**
 * A Model Context Protocol server for the docs, as a function from one JSON-RPC message to its response.
 * It offers three read-only tools (`search_docs`, `get_page`, `list_pages`) and is independent of how messages
 * travel: the Next.js route (Streamable HTTP) and `dockudos mcp` (stdio) both call `handle`.
 */
export function createMcpServer(info: McpServerInfo, backend: McpBackend) {
  async function callTool(name: string, args: Record<string, unknown>) {
    switch (name) {
      case 'search_docs': {
        const query = string(args, 'query', true) as string;
        const limit = integer(args, 'limit', 8, 20);
        const hits = await backend.search(query, {
          limit,
          version: string(args, 'version'),
          locale: string(args, 'locale'),
        });
        if (hits.length === 0)
          return text('No results.', { structuredContent: { results: [] } });
        const lines = hits.map((h, i) => {
          const where = [h.title, ...h.headingPath].join(' › ');
          return `${i + 1}. ${where}\n   ${h.url}\n   ${h.snippet.text.replace(/\s+/g, ' ')}`;
        });
        return text(lines.join('\n\n'), {
          structuredContent: {
            results: hits.map((h) => ({
              title: h.title,
              headingPath: h.headingPath,
              path: h.path,
              anchor: h.anchor,
              url: h.url,
              snippet: h.snippet.text,
            })),
          },
        });
      }
      case 'get_page': {
        const path = string(args, 'path', true) as string;
        const page = await backend.getPage(path);
        if (page === 'forbidden')
          return toolError(
            'This page needs credentials. Send them with the request to the docs server.',
          );
        if (!page)
          return toolError(
            `No page at ${path}. Use list_pages or search_docs to find the right path.`,
          );
        return text(page.markdown, {
          structuredContent: {
            path: page.path,
            title: page.title,
            markdown: page.markdown,
          },
        });
      }
      case 'list_pages': {
        const filter = string(args, 'query')?.toLowerCase();
        const limit = integer(args, 'limit', 100, 200);
        const all = await backend.listPages();
        const pages = all
          .filter((p) =>
            filter
              ? `${p.title} ${p.path} ${p.description ?? ''}`
                  .toLowerCase()
                  .includes(filter)
              : true,
          )
          .slice(0, limit);
        const body = pages
          .map(
            (p) =>
              `- ${p.title} (${p.path})${p.description ? `: ${p.description}` : ''}`,
          )
          .join('\n');
        return text(body || 'No pages.', {
          structuredContent: {
            pages: pages.map((p) => ({
              path: p.path,
              title: p.title,
              description: p.description,
            })),
            total: all.length,
          },
        });
      }
      default:
        throw new ProtocolError(INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  async function dispatch(
    message: Record<string, unknown>,
  ): Promise<JsonRpcResponse | undefined> {
    const hasId = 'id' in message;
    const id = (hasId ? message['id'] : null) as Id;
    const method = message['method'];
    if (message['jsonrpc'] !== '2.0' || typeof method !== 'string') {
      // A response from the client to something we never asked: nothing to do.
      if (!('method' in message) && ('result' in message || 'error' in message))
        return undefined;
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: INVALID_REQUEST,
          message: 'Not a JSON-RPC 2.0 request.',
        },
      };
    }
    // Notifications have no id and get no answer.
    if (!hasId) return undefined;
    const params = isObject(message['params']) ? message['params'] : {};
    try {
      switch (method) {
        case 'initialize': {
          const asked =
            typeof params['protocolVersion'] === 'string'
              ? params['protocolVersion']
              : '';
          const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(
            asked,
          )
            ? asked
            : MCP_PROTOCOL_VERSIONS[0];
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: version,
              capabilities: { tools: { listChanged: false } },
              serverInfo: { name: info.name, version: info.version },
              ...(info.instructions && { instructions: info.instructions }),
            },
          };
        }
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };
        case 'tools/list':
          return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
        case 'tools/call': {
          const name = params['name'];
          if (typeof name !== 'string')
            throw new ProtocolError(
              INVALID_PARAMS,
              'Say which tool to call ("name").',
            );
          const args = isObject(params['arguments']) ? params['arguments'] : {};
          return { jsonrpc: '2.0', id, result: await callTool(name, args) };
        }
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: METHOD_NOT_FOUND,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (error) {
      if (error instanceof ProtocolError)
        return {
          jsonrpc: '2.0',
          id,
          error: { code: error.code, message: error.message },
        };
      console.error('dockudos mcp:', error);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: INTERNAL_ERROR,
          message: 'The documentation server failed.',
        },
      };
    }
  }

  return {
    /**
     * Answer one message (or a batch). Resolves to `undefined` when there is nothing to send back: a
     * notification, or a batch of notifications.
     */
    async handle(
      message: unknown,
    ): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
      if (Array.isArray(message)) {
        if (message.length === 0)
          return {
            jsonrpc: '2.0',
            id: null,
            error: { code: INVALID_REQUEST, message: 'Empty batch.' },
          };
        const out = (
          await Promise.all(
            message.map((m) =>
              isObject(m)
                ? dispatch(m)
                : Promise.resolve<JsonRpcResponse>({
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                      code: INVALID_REQUEST,
                      message: 'Not a JSON-RPC 2.0 request.',
                    },
                  }),
            ),
          )
        ).filter((r): r is JsonRpcResponse => !!r);
        return out.length ? out : undefined;
      }
      if (!isObject(message))
        return {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: INVALID_REQUEST,
            message: 'Not a JSON-RPC 2.0 request.',
          },
        };
      return dispatch(message);
    },
  };
}

/** The response for a body that is not JSON at all. */
export const mcpParseError = (): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: null,
  error: { code: PARSE_ERROR, message: 'The message is not valid JSON.' },
});

export interface DocsBackendOptions {
  /** Search over the content index of public pages. */
  search: McpBackend['search'];
  /** Every routable page, including hidden and protected ones. */
  pages: readonly McpPageSummary[];
  /** The paths listed to tools: public pages only. */
  listed: readonly McpPageSummary[];
  markdown(path: string): string | Promise<string>;
  /** Is this path covered by an access rule? */
  isProtected(path: string): boolean;
  /** For a protected page: has the caller shown the right credentials? */
  authorize?(path: string): boolean | Promise<boolean>;
}

/**
 * The backend most sites want. Searching and listing only ever see public pages. Reading a page by path
 * also serves hidden pages (their URL works) but a protected page only when the caller is authorized.
 */
export function createDocsBackend(options: DocsBackendOptions): McpBackend {
  return {
    search: options.search,
    listPages: () => [...options.listed],
    async getPage(path) {
      const page = options.pages.find((p) => p.path === path);
      if (!page) return undefined;
      if (options.isProtected(path) && !(await options.authorize?.(path)))
        return 'forbidden';
      return {
        path: page.path,
        title: page.title,
        ...(page.description && { description: page.description }),
        markdown: await options.markdown(path),
      };
    },
  };
}
