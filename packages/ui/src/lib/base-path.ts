/** Prefix a root-relative path with the site's base path (static export on a sub-path, e.g. GitHub Pages). */
export const withBase = (url: string) =>
  url.startsWith('/') && !url.startsWith('//')
    ? `${process.env.NEXT_PUBLIC_DOCKUDOS_BASE_PATH ?? ''}${url}`
    : url;
