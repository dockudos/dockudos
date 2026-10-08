'use client';

import { Suspense, lazy } from 'react';
import { CopyButton } from '../copy-button.tsx';
import type { CodeMirrorProps } from './cm.tsx';

const CodeMirror = lazy(() => import('./cm.tsx'));

export interface CodeEditorProps extends Omit<CodeMirrorProps, 'readOnly'> {
  readOnly?: boolean;
  testId?: string;
}

/** The language CodeMirror should use for a content type. */
export function languageForMime(mime: string | undefined, body = ''): string {
  const type = mime?.toLowerCase() ?? '';
  if (/json/.test(type)) return 'json';
  if (/xml|html/.test(type)) return 'xml';
  if (/yaml/.test(type)) return 'yaml';
  if (/javascript/.test(type)) return 'javascript';
  if (!type && /^\s*[[{]/.test(body)) return 'json';
  return 'text';
}

/**
 * A code editor (CodeMirror) that loads on demand. Until it arrives the code is already on the page, as a plain
 * `<pre>` (read-only) or a `<textarea>` (editable), so nothing waits on the download and nothing is lost without it.
 */
export function CodeEditor({ testId, ...props }: CodeEditorProps) {
  const { value, label, readOnly, placeholder, invalid, describedBy, onChange } = props;
  const fallback = readOnly ? (
    <pre className="dk-cm-fallback" tabIndex={0} aria-label={label}>
      <code>{value}</code>
    </pre>
  ) : (
    <textarea
      className="dk-cm-fallback"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      placeholder={placeholder}
      rows={Math.min(14, Math.max(4, value.split('\n').length + 1))}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
  return (
    <div className="dk-cm" data-invalid={invalid ? '' : undefined} data-testid={testId}>
      <Suspense fallback={fallback}>
        <CodeMirror {...props} />
      </Suspense>
    </div>
  );
}

/** Read-only code in a frame, with a copy button. */
export function CodeView({
  code,
  language,
  title,
  label,
  ...rest
}: {
  code: string;
  language: string;
  title?: string;
  label?: string;
  lineNumbers?: boolean;
  foldable?: boolean;
  wrap?: boolean;
  testId?: string;
}) {
  return (
    <figure className="dk-code" data-has-title={title ? '' : undefined}>
      {title && <figcaption className="dk-code-title">{title}</figcaption>}
      <div className="dk-code-body">
        <CodeEditor readOnly value={code} language={language} label={label ?? title ?? 'Code'} {...rest} />
        <CopyButton text={code} />
      </div>
    </figure>
  );
}
