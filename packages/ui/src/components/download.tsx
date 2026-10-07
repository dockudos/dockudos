import { Download as DownloadIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface DownloadProps {
  /** The file's address. */
  href: string;
  /** The name the file is saved as. Defaults to its own name. */
  filename?: string;
  /** Its size, written as you want it read: `2.4 MB`. */
  size?: string;
  children?: ReactNode;
}

const extension = (href: string) =>
  /\.([a-z0-9]{1,5})(?:[?#].*)?$/i.exec(href)?.[1]?.toUpperCase();

/** A link to a file to save: an icon, the label, and the type and size. */
export function Download({ href, filename, size, children }: DownloadProps) {
  const type = extension(filename ?? href);
  const meta = [type, size].filter(Boolean).join(', ');
  return (
    <a
      href={href}
      download={filename ?? true}
      className="dk-download"
    >
      <DownloadIcon className="size-4 shrink-0" aria-hidden="true" />
      <span>{children ?? filename ?? href.split('/').pop()}</span>
      {meta && <span className="dk-download-meta">({meta})</span>}
    </a>
  );
}
