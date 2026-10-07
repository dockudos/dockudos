import type { ComponentProps } from 'react';

/**
 * Every Markdown table. A rounded frame that scrolls sideways on a narrow screen (and can be
 * scrolled from the keyboard), with the table itself filling the frame.
 */
export function Table(props: ComponentProps<'table'>) {
  return (
    <div className="dk-table" tabIndex={0}>
      <table {...props} />
    </div>
  );
}
