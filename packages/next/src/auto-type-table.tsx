import { md, type ToMarkdown } from '@dockudos/core';
import { TypeTable, type TypeField } from '@dockudos/ui';
import { resolve } from 'node:path';

/**
 * Read the properties of an interface or object type from a TypeScript file,
 * with their JSDoc descriptions and `@default` tags. Needs `typescript`.
 */
export async function readTypeFields(
  file: string,
  name: string,
): Promise<Record<string, TypeField>> {
  let ts: typeof import('typescript');
  try {
    ts = (await import('typescript')).default;
  } catch {
    throw new Error(
      '<AutoTypeTable> needs the `typescript` package. Install it with `npm install -D typescript`.',
    );
  }

  const program = ts.createProgram([file], {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
  });
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`<AutoTypeTable>: cannot read ${file}`);
  const checker = program.getTypeChecker();

  const declaration = source.statements.find(
    (
      s,
    ): s is
      | import('typescript').InterfaceDeclaration
      | import('typescript').TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
      s.name.text === name,
  );
  if (!declaration) {
    throw new Error(
      `<AutoTypeTable>: no interface or type named "${name}" in ${file}`,
    );
  }

  const type = checker.getTypeAtLocation(declaration.name);
  const fields: Record<string, TypeField> = {};
  for (const prop of type.getProperties()) {
    const location = prop.valueDeclaration ?? declaration;
    const propType = checker.getTypeOfSymbolAtLocation(prop, location);
    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const description = ts
      .displayPartsToString(prop.getDocumentationComment(checker))
      .trim();
    const defaultTag = prop
      .getJsDocTags(checker)
      .find((t) => t.name === 'default' || t.name === 'defaultValue');

    fields[prop.name] = {
      // `T | undefined` is how an optional property reads; the `required` flag says it better.
      type: checker.typeToString(
        optional ? checker.getNonNullableType(propType) : propType,
        location,
        ts.TypeFormatFlags.NoTruncation,
      ),
      required: !optional,
      ...(description && { description }),
      ...(defaultTag && {
        default: ts.displayPartsToString(defaultTag.text).trim(),
      }),
    };
  }
  return fields;
}

export interface AutoTypeTableProps {
  /** TypeScript file, relative to the project root. */
  path: string;
  /** Name of the interface or type alias to document. */
  name: string;
}

/** A type table generated from your own TypeScript types, so it cannot drift from the code. */
export async function AutoTypeTable({ path, name }: AutoTypeTableProps) {
  return (
    <TypeTable
      type={await readTypeFields(resolve(process.cwd(), path), name)}
    />
  );
}

/** The same table as Markdown, from the types as they are now. If the file cannot be read, a line names the table. */
AutoTypeTable.toMarkdown = (async (props) => {
  try {
    const fields = await readTypeFields(resolve(process.cwd(), props.path), props.name);
    return TypeTable.toMarkdown({ type: fields });
  } catch {
    return md.block(md.italic(`Type table of ${md.code(props.name)} from ${md.code(props.path)}.`));
  }
}) satisfies ToMarkdown<AutoTypeTableProps>;
