import type { ReactNode } from 'react';
import { md, type ToMarkdown } from '@dockudos/core';

export interface TypeField {
  /** The TypeScript type, shown as code. */
  type: string;
  description?: ReactNode;
  default?: string;
  required?: boolean;
}

/** Props or options as a table: `<TypeTable type={{ name: { type: 'string', required: true } }} />`. */
export function TypeTable({ type }: { type: Record<string, TypeField> }) {
  const rows = Object.entries(type);
  return (
    <div className="not-prose my-5 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Type reference</caption>
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Type
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Default
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, field]) => (
            <tr key={name} className="border-t align-top">
              <th
                scope="row"
                className="px-3 py-2 font-mono text-[0.8125rem] font-medium"
              >
                {name}
                {field.required && (
                  <span className="text-destructive" title="Required">
                    <span aria-hidden="true">*</span>
                    <span className="sr-only"> (required)</span>
                  </span>
                )}
              </th>
              <td className="px-3 py-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">
                  {field.type}
                </code>
                {field.description && (
                  <div className="mt-1.5 text-muted-foreground">
                    {field.description}
                  </div>
                )}
              </td>
              <td className="px-3 py-2">
                {field.default ? (
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">
                    {field.default}
                  </code>
                ) : (
                  <span aria-label="none">&mdash;</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

TypeTable.toMarkdown = ((props) => {
  const fields = props.type;
  if (!fields || typeof fields !== 'object') return undefined;
  const rows = Object.entries(fields).map(([name, f]) => [
    `${md.code(name)}${f.required ? ' (required)' : ''}`,
    f.type ? md.code(f.type) : '',
    f.default !== undefined ? md.code(String(f.default)) : '',
    typeof f.description === 'string' ? f.description : '',
  ]);
  return md.block(md.table(['Name', 'Type', 'Default', 'Description'], rows));
}) satisfies ToMarkdown<{ type: Record<string, TypeField> }>;
