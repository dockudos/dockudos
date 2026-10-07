import type { ReactNode } from 'react';

/** A numbered procedure: `<Steps><Step title="Install">…</Step></Steps>`. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="dk-steps">{children}</ol>;
}

export function Step({
  title,
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <li className="dk-step">
      {title && <h3 className="dk-step-title">{title}</h3>}
      <div className="dk-step-body">{children}</div>
    </li>
  );
}
