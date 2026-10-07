import { PACKAGE_MANAGERS, convertPackageCommand } from '@dockudos/core';
import type { Code, Root } from 'mdast';
import type { Plugin } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import { codeNode, jsx } from './jsx.ts';

const TS_LANGS = new Set(['ts', 'tsx', 'typescript']);

type Transpile = (code: string, lang: string) => string;

/**
 * Turns special code fences into components:
 * - ```` ```package-install ```` with an npm command becomes npm/pnpm/yarn/bun tabs;
 * - a TypeScript fence with `ts-to-js` in its meta becomes TypeScript/JavaScript tabs;
 * - ```` ```mermaid ```` becomes a `<Mermaid>` diagram.
 */
const remarkCode: Plugin<[], Root> = () => async (tree) => {
  let transpile: Transpile | undefined;

  const jobs: (() => Promise<void>)[] = [];
  visit(tree, 'code', (node: Code, index, parent) => {
    if (!parent || index === undefined) return;

    if (node.lang === 'package-install') {
      const commands = node.value
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map(convertPackageCommand);
      const tabs = PACKAGE_MANAGERS.map((pm) =>
        jsx('Tab', { value: pm }, [
          codeNode('bash', commands.map((c) => c[pm]).join('\n')),
        ]),
      );
      parent.children.splice(
        index,
        1,
        jsx('Tabs', { groupId: 'package-manager' }, tabs),
      );
      return [SKIP, index + 1];
    }

    if (node.lang === 'mermaid') {
      parent.children.splice(index, 1, jsx('Mermaid', { chart: node.value }));
      return [SKIP, index + 1];
    }

    if (
      node.lang &&
      TS_LANGS.has(node.lang) &&
      /(^|\s)ts-to-js(\s|$)/.test(node.meta ?? '')
    ) {
      const meta =
        (node.meta ?? '').replace(/(^|\s)ts-to-js(?=\s|$)/, '').trim() || null;
      const lang = node.lang;
      jobs.push(async () => {
        transpile ??= await loadTranspiler();
        const js = transpile(node.value, lang);
        const at = parent.children.indexOf(node);
        parent.children.splice(
          at,
          1,
          jsx('Tabs', { groupId: 'language' }, [
            jsx('Tab', { value: 'TypeScript' }, [
              codeNode(lang, node.value, meta),
            ]),
            jsx('Tab', { value: 'JavaScript' }, [
              codeNode(lang === 'tsx' ? 'jsx' : 'js', js, meta),
            ]),
          ]),
        );
      });
      return SKIP;
    }
    return undefined;
  });
  for (const job of jobs) await job();
};

async function loadTranspiler(): Promise<Transpile> {
  let ts: typeof import('typescript');
  try {
    ts = (await import('typescript')).default;
  } catch {
    throw new Error(
      '`ts-to-js` code blocks need the `typescript` package. Install it with `npm install -D typescript`.',
    );
  }
  return (code, lang) => {
    const out = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        verbatimModuleSyntax: false,
        removeComments: false,
      },
      fileName: lang === 'tsx' ? 'x.tsx' : 'x.ts',
    }).outputText;
    // TypeScript emits 4-space indents; docs use 2.
    return out
      .replace(/^( {4})+/gm, (m) => '  '.repeat(m.length / 4))
      .trimEnd();
  };
}

export default remarkCode;
