import { createAccessProxy } from '@dockudos/next/access';

// Applies the `access` rules from docs.json to every route: pages, /print, API routes and files.
// With no rules it does nothing. See "Protecting pages" in the documentation.
export const proxy = createAccessProxy();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
