import { parse } from 'yaml';
import { z } from 'zod';
import { LAYOUTS } from './config.ts';
import { FenceTracker } from './fence.ts';

/** Known frontmatter keys. Unknown keys are kept so pages can carry custom metadata. */
export const frontmatterSchema = z.looseObject({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  icon: z.string().min(1).optional(),
  /** Hidden pages are routable but left out of generated navigation. */
  hidden: z.boolean().default(false),
  /** `false` hides the kudos (feedback) widget on this page. */
  kudos: z.boolean().optional(),
  /** Overrides `theme.layout` for this page. */
  layout: z.enum(LAYOUTS).optional(),
  /** Shorter label for the sidebar. */
  sidebarTitle: z.string().min(1).optional(),
  /** Set by `dockudos generate` on pages it writes from an API spec or from code. */
  api: z
    .strictObject({
      source: z.string().min(1),
      kind: z.string().min(1),
      method: z.string().min(1).optional(),
      endpoint: z.string().min(1).optional(),
      group: z.string().min(1).optional(),
      order: z.number().optional(),
    })
    .optional(),
});

export type Frontmatter = z.output<typeof frontmatterSchema>;

export class FrontmatterError extends Error {
  readonly file: string;
  readonly issues: readonly string[];

  constructor(file: string, issues: readonly string[]) {
    super(
      `Invalid frontmatter in ${file}:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'FrontmatterError';
    this.file = file;
    this.issues = issues;
  }
}

export interface ParsedSource {
  data: Frontmatter;
  /** The source with the frontmatter block removed. */
  body: string;
  /** Lines removed from the top, so callers can map body line numbers back to the file. */
  bodyOffset: number;
}

const BLOCK = /^\u{FEFF}?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

/** Split a markdown/MDX source into validated frontmatter and body. `file` is only used in errors. */
export function parseFrontmatter(
  source: string,
  file = '(unknown)',
): ParsedSource {
  const match = BLOCK.exec(source);
  if (!match)
    return { data: frontmatterSchema.parse({}), body: source, bodyOffset: 0 };

  let raw: unknown;
  try {
    raw = parse(match[1] ?? '') ?? {};
  } catch (e) {
    throw new FrontmatterError(file, [
      `not valid YAML (${(e as Error).message.split('\n')[0]})`,
    ]);
  }

  const result = frontmatterSchema.safeParse(raw);
  if (!result.success) {
    throw new FrontmatterError(
      file,
      result.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    );
  }
  return {
    data: result.data,
    body: source.slice(match[0].length),
    bodyOffset: match[0].split('\n').length - 1,
  };
}

/** First level-one ATX heading outside code fences, used as the title when frontmatter has none. */
export function firstHeading(body: string): string | undefined {
  const fence = new FenceTracker();
  for (const line of body.split(/\r?\n/)) {
    if (fence.inCode(line)) continue;
    const h = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1];
    if (h) return h.replace(/[*_`]/g, '').trim();
  }
  return undefined;
}

/** Several content problems reported together, so one build shows every bad file. */
export class ContentError extends Error {
  readonly errors: readonly Error[];

  constructor(errors: readonly Error[]) {
    super(errors.map((e) => e.message).join('\n'));
    this.name = 'ContentError';
    this.errors = errors;
  }
}
