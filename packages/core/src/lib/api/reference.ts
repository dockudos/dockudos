import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ReferenceSourceConfig } from '../config.ts';
import type { GeneratedFile } from './generate-openapi.ts';
import {
  code,
  escapeMdx,
  escapeParagraphs,
  fence,
  markdownPage,
  table,
} from './markdown-pages.ts';
import { slugify, summarize } from './text.ts';
import { ApiSpecError } from './types.ts';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ReferenceResult {
  name: string;
  kind: string;
  files: GeneratedFile[];
  operations: number;
  pages: number;
  hash: string;
}

export interface ReferenceOptions {
  root: string;
  docsDir: string;
  sources: readonly ReferenceSourceConfig[];
}

const inputsOf = (s: ReferenceSourceConfig) =>
  Array.isArray(s.input) ? s.input : [s.input];

/** Generate reference pages for every `reference.sources` entry. */
export async function generateReferences({
  root,
  docsDir,
  sources,
}: ReferenceOptions): Promise<ReferenceResult[]> {
  const out: ReferenceResult[] = [];
  for (const source of sources) {
    const files = inputsOf(source).map((f) =>
      isAbsolute(f) ? f : resolve(root, f),
    );
    const texts = await Promise.all(
      files.map((f, i) =>
        readFile(f, 'utf8').catch((e: NodeJS.ErrnoException) => {
          throw new ApiSpecError(
            inputsOf(source)[i] as string,
            e.code === 'ENOENT'
              ? `file not found (looked for ${f})`
              : `cannot be read: ${e.message}`,
          );
        }),
      ),
    );
    // TypeScript symbols also depend on files the entry points import, so for it the hash only skips an unchanged run
    // of the same inputs; `dockudos generate --force` re-reads everything.
    const hash = createHash('sha256')
      .update(JSON.stringify(source))
      .update(texts.join('\0'))
      .digest('hex')
      .slice(0, 16);
    const mount = source.path ?? source.name;
    const base = `${docsDir}/${mount}`;
    const result =
      source.type === 'python'
        ? generatePython(texts[0] as string, inputsOf(source)[0] as string, {
            name: source.name,
            base,
            title: source.title,
          })
        : await generateTypeScript(files, root, {
            name: source.name,
            base,
            title: source.title,
          });
    out.push({ name: source.name, kind: source.type, hash, ...result });
  }
  return out;
}

// -- Python (Griffe) ---------------------------------------------------------

/** A Griffe expression (annotation, default value) as source text. Griffe writes either a string or a tree. */
export function griffeExpr(e: unknown): string {
  if (e === null || e === undefined) return '';
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean') return String(e);
  if (Array.isArray(e)) return e.map(griffeExpr).join('');
  if (!isObject(e)) return '';
  switch (e.cls) {
    case 'ExprName':
      return String(e.name ?? '');
    case 'ExprAttribute':
      return griffeExpr(e.values).replace(/\.\./g, '.');
    case 'ExprSubscript':
      return `${griffeExpr(e.left)}[${griffeExpr(e.slice)}]`;
    case 'ExprTuple':
    case 'ExprList':
    case 'ExprSet':
      return (Array.isArray(e.elements) ? e.elements : [])
        .map(griffeExpr)
        .join(', ');
    case 'ExprBinOp':
      return `${griffeExpr(e.left)} ${String(e.operator ?? '|')} ${griffeExpr(e.right)}`;
    default:
      return e.name !== undefined
        ? String(e.name)
        : e.value !== undefined
          ? griffeExpr(e.value)
          : '';
  }
}

interface PyParam {
  name: string;
  annotation?: unknown;
  default?: unknown;
  kind?: string;
}

function pySignature(
  name: string,
  params: PyParam[],
  returns: unknown,
): string {
  const list = params.map((p) => {
    const prefix =
      p.kind === 'variadic positional'
        ? '*'
        : p.kind === 'variadic keyword'
          ? '**'
          : '';
    const ann = griffeExpr(p.annotation);
    const def =
      !prefix && p.default !== undefined && p.default !== null
        ? griffeExpr(p.default)
        : '';
    return `${prefix}${p.name}${ann ? `: ${ann}` : ''}${def ? ` = ${def}` : ''}`;
  });
  const ret = griffeExpr(returns);
  return `${name}(${list.join(', ')})${ret ? ` -> ${ret}` : ''}`;
}

const docOf = (m: Json): string | undefined =>
  isObject(m.docstring) && typeof m.docstring.value === 'string'
    ? m.docstring.value
    : undefined;

function pyMember(m: Json, name: string, level: number): string {
  const h = '#'.repeat(level);
  const out: string[] = [];
  if (m.kind === 'function') {
    out.push(
      `${h} ${escapeMdx(name)}`,
      fence(
        pySignature(name, (m.parameters as PyParam[]) ?? [], m.returns),
        'python',
      ),
    );
    const doc = docOf(m);
    if (doc) out.push(escapeParagraphs(doc));
  } else if (m.kind === 'class') {
    const bases = Array.isArray(m.bases)
      ? m.bases.map(griffeExpr).filter(Boolean)
      : [];
    out.push(`${h} class ${escapeMdx(name)}`);
    if (bases.length) out.push(`Bases: ${bases.map(code).join(', ')}`);
    const doc = docOf(m);
    if (doc) out.push(escapeParagraphs(doc));
    for (const [childName, child] of publicMembers(m)) {
      if (
        isObject(child) &&
        (child.kind === 'function' || child.kind === 'attribute')
      )
        out.push(pyMember(child, childName, level + 1));
    }
  } else if (m.kind === 'attribute') {
    const ann = griffeExpr(m.annotation);
    out.push(
      `${h} ${escapeMdx(name)}`,
      code(`${name}${ann ? `: ${ann}` : ''}`),
    );
    const doc = docOf(m);
    if (doc) out.push(escapeParagraphs(doc));
  }
  return out.join('\n\n');
}

function publicMembers(m: Json): [string, unknown][] {
  const members = isObject(m.members) ? m.members : {};
  return Object.entries(members).filter(
    ([n, v]) => !n.startsWith('_') && !(isObject(v) && v.kind === 'alias'),
  );
}

/** Pages for the modules of a Griffe dump (`griffe dump <package> > docs.json`). Docstrings are shown as text. */
export function generatePython(
  text: string,
  input: string,
  { name, base, title }: { name: string; base: string; title?: string },
): Omit<ReferenceResult, 'name' | 'kind' | 'hash'> {
  let dump: unknown;
  try {
    dump = JSON.parse(text);
  } catch (e) {
    throw new ApiSpecError(
      input,
      `is not JSON (run \`griffe dump <package>\` to make it): ${(e as Error).message}`,
    );
  }
  const packages = isObject(dump) ? Object.values(dump).filter(isObject) : [];
  if (!packages.length || !packages.every((p) => p.kind === 'module')) {
    throw new ApiSpecError(
      input,
      'is not the output of `griffe dump`: expected a JSON object of modules',
    );
  }

  const files: GeneratedFile[] = [];
  let order = 0;
  const modules: { path: string; page: string; summary?: string }[] = [];
  const walk = (m: Json, path: string) => {
    const members = publicMembers(m);
    const body: string[] = [];
    const doc = docOf(m);
    if (doc) body.push(escapeParagraphs(doc));
    for (const [n, v] of members) {
      if (isObject(v) && v.kind !== 'module') body.push(pyMember(v, n, 2));
    }
    const slug = path.split('.').map(slugify).join('/');
    const hasContent = body.length > 0;
    if (hasContent) {
      modules.push({ path, page: slug, summary: summarize(doc) });
      files.push({
        file: `${base}/modules/${slug}.mdx`,
        content: markdownPage(
          {
            title: path,
            description: summarize(doc),
            source: name,
            kind: 'module',
            group: 'Modules',
            order: order++,
          },
          body.join('\n\n'),
        ),
      });
    }
    for (const [n, v] of members)
      if (isObject(v) && v.kind === 'module') walk(v, `${path}.${n}`);
  };
  for (const p of packages) walk(p, String(p.name ?? 'package'));

  files.push({
    file: `${base}/index.mdx`,
    content: markdownPage(
      {
        title: title ?? 'Python reference',
        source: name,
        kind: 'overview',
        order: -1,
      },
      table(
        ['Module', 'Summary'],
        modules.map((m) => [m.path, m.summary ?? '']),
      ) || 'The package has no documented public members.',
    ),
  });
  return { files, operations: modules.length, pages: modules.length };
}

// -- TypeScript --------------------------------------------------------------

type TS = typeof import('typescript');

interface Documented {
  summary: string;
  tags: { name: string; text: string }[];
}

async function loadTypeScript(): Promise<TS> {
  try {
    return (await import('typescript')).default;
  } catch {
    throw new ApiSpecError(
      'typescript',
      'is needed to read TypeScript definitions. Install it with `npm install -D typescript`.',
    );
  }
}

/** Reference pages for the exports of TypeScript entry points: functions, classes, interfaces, types, enums, constants. */
export async function generateTypeScript(
  entries: string[],
  root: string,
  { name, base, title }: { name: string; base: string; title?: string },
): Promise<Omit<ReferenceResult, 'name' | 'kind' | 'hash'>> {
  const ts = await loadTypeScript();
  const program = ts.createProgram(entries, {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  });
  const checker = program.getTypeChecker();

  const docs = (symbol: import('typescript').Symbol): Documented => ({
    summary: ts
      .displayPartsToString(symbol.getDocumentationComment(checker))
      .trim(),
    tags: symbol
      .getJsDocTags(checker)
      .map((t) => ({ name: t.name, text: ts.displayPartsToString(t.text) })),
  });
  const typeText = (
    t: import('typescript').Type,
    at: import('typescript').Node,
  ) =>
    checker.typeToString(
      t,
      at,
      ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    );

  const exported = new Map<string, import('typescript').Symbol>();
  for (const entry of entries) {
    const file = program.getSourceFile(entry);
    if (!file)
      throw new ApiSpecError(
        relative(root, entry) || entry,
        'is not a TypeScript file the compiler can read',
      );
    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (!moduleSymbol) continue;
    for (const s of checker.getExportsOfModule(moduleSymbol))
      exported.set(s.name, s);
  }

  type Kind =
    | 'Functions'
    | 'Classes'
    | 'Interfaces'
    | 'Types'
    | 'Enums'
    | 'Variables';
  const items: { kind: Kind; name: string; body: string; summary: string }[] =
    [];

  const membersTable = (
    type: import('typescript').Type,
    at: import('typescript').Node,
  ) =>
    table(
      ['Member', 'Type', 'Description'],
      type.getProperties().map((p) => {
        const decl = p.valueDeclaration ?? p.declarations?.[0] ?? at;
        const optional = (p.flags & ts.SymbolFlags.Optional) !== 0;
        const d = docs(p);
        const flags = [
          optional ? 'optional' : '',
          d.tags.some((t) => t.name === 'deprecated') ? 'deprecated' : '',
        ].filter(Boolean);
        // `x?: T` has the type `T | undefined`; the `?` already says so.
        const type = typeText(checker.getTypeOfSymbolAtLocation(p, decl), decl);
        return [
          `${p.name}${optional ? '?' : ''}`,
          optional ? type.replace(/ \| undefined$/, '') : type,
          [d.summary, ...flags].filter(Boolean).join(' · '),
        ];
      }),
    );

  const tagBlocks = (d: Documented): string[] => {
    const out: string[] = [];
    const dep = d.tags.find((t) => t.name === 'deprecated');
    if (dep) out.push(`**Deprecated.** ${escapeMdx(dep.text)}`);
    for (const t of d.tags.filter((t) => t.name === 'example'))
      out.push(
        '**Example**',
        fence(t.text.replace(/^```\w*\n?|\n?```$/g, ''), 'ts'),
      );
    return out;
  };

  for (const [exportName, rawSymbol] of [...exported].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const symbol =
      rawSymbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(rawSymbol)
        : rawSymbol;
    const decl = symbol.declarations?.[0];
    if (!decl) continue;
    const d = docs(symbol);
    const body: string[] = [];
    if (d.summary) body.push(escapeParagraphs(d.summary));
    let kind: Kind | undefined;

    if (symbol.flags & ts.SymbolFlags.Function) {
      kind = 'Functions';
      const sigs = checker
        .getTypeOfSymbolAtLocation(symbol, decl)
        .getCallSignatures();
      body.push(
        fence(
          sigs
            .map(
              (s) =>
                `function ${exportName}${checker.signatureToString(s, decl, ts.TypeFormatFlags.NoTruncation).replace(/^(<[^>]*>)?\(/, '$1(')}`,
            )
            .join('\n'),
          'ts',
        ),
      );
      const first = sigs[0];
      if (first?.parameters.length) {
        const paramDocs = new Map(
          d.tags
            .filter((t) => t.name === 'param')
            .map((t) => {
              const m = /^(\S+)\s*-?\s*([\s\S]*)$/.exec(t.text);
              return [m?.[1] ?? '', m?.[2] ?? ''] as const;
            }),
        );
        body.push(
          '## Parameters',
          table(
            ['Name', 'Type', 'Description'],
            first.parameters.map((p) => [
              p.name,
              typeText(checker.getTypeOfSymbolAtLocation(p, decl), decl),
              paramDocs.get(p.name) ?? docs(p).summary,
            ]),
          ),
        );
      }
      if (first)
        body.push('## Returns', code(typeText(first.getReturnType(), decl)));
    } else if (symbol.flags & ts.SymbolFlags.Class) {
      kind = 'Classes';
      const instance = checker.getDeclaredTypeOfSymbol(symbol);
      body.push(
        fence(`class ${exportName}`, 'ts'),
        '## Members',
        membersTable(instance, decl),
      );
    } else if (symbol.flags & ts.SymbolFlags.Interface) {
      kind = 'Interfaces';
      body.push(
        fence(decl.getText().split('{')[0]?.trim() ?? exportName, 'ts'),
        '## Members',
        membersTable(checker.getDeclaredTypeOfSymbol(symbol), decl),
      );
    } else if (symbol.flags & ts.SymbolFlags.TypeAlias) {
      kind = 'Types';
      const text = decl.getText();
      body.push(
        fence(text.length > 4000 ? `${text.slice(0, 4000)}…` : text, 'ts'),
      );
      const t = checker.getDeclaredTypeOfSymbol(symbol);
      if (t.getProperties().length && !t.isUnion())
        body.push('## Members', membersTable(t, decl));
    } else if (symbol.flags & ts.SymbolFlags.Enum) {
      kind = 'Enums';
      const members = checker
        .getTypeOfSymbolAtLocation(symbol, decl)
        .getProperties();
      body.push(
        table(
          ['Member', 'Description'],
          members.map((m) => [m.name, docs(m).summary]),
        ),
      );
    } else if (symbol.flags & ts.SymbolFlags.Variable) {
      kind = 'Variables';
      body.push(
        code(
          `${exportName}: ${typeText(checker.getTypeOfSymbolAtLocation(symbol, decl), decl)}`,
        ),
      );
    }
    if (!kind) continue;
    body.push(...tagBlocks(d));
    items.push({
      kind,
      name: exportName,
      body: body.join('\n\n'),
      summary: d.summary,
    });
  }

  const files: GeneratedFile[] = [];
  const slugs = new Set<string>();
  let order = 0;
  for (const item of items) {
    let slug = slugify(item.name);
    for (let i = 2; slugs.has(`${item.kind}/${slug}`) || slug === 'index'; i++)
      slug = `${slugify(item.name)}-${i}`;
    slugs.add(`${item.kind}/${slug}`);
    files.push({
      file: `${base}/${slugify(item.kind)}/${slug}.mdx`,
      content: markdownPage(
        {
          title: item.name,
          description: summarize(item.summary),
          source: name,
          kind: 'symbol',
          group: item.kind,
          order: order++,
        },
        item.body,
      ),
    });
  }
  files.push({
    file: `${base}/index.mdx`,
    content: markdownPage(
      {
        title: title ?? 'TypeScript reference',
        source: name,
        kind: 'overview',
        order: -1,
      },
      table(
        ['Name', 'Kind', 'Summary'],
        items.map((i) => [i.name, i.kind, summarize(i.summary, 120) ?? '']),
      ) || 'No exports were found.',
    ),
  });
  return { files, operations: items.length, pages: items.length };
}
