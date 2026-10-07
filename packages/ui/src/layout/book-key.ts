/** A stable element id for a page inside the book: `/guides/auth` becomes `doc-guides-auth`. */
export function bookKey(path: string): string {
  const slug = path.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-');
  return `doc-${slug || 'home'}`;
}
