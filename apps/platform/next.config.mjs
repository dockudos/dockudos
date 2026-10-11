// The dashboard reaches the platform API through its own origin (see src/proxy.ts), so the session cookie and the
// CSRF check (`Origin` must be the dashboard) work without CORS. The target is read at run time, not build time.
import { join } from 'node:path';

// The container image builds a self-contained server (`.next/standalone`); development and tests use the normal one.
const standalone = process.env['DOCKUDOS_STANDALONE'] === '1';

/** @type {import('next').NextConfig} */
export default {
  ...(standalone && {
    output: 'standalone',
    outputFileTracingRoot: join(import.meta.dirname, '../..'),
  }),
  transpilePackages: ['@dockudos/ui'],
  poweredByHeader: false,
  // Uploads of up to 10 MB pass through the proxy.
  experimental: { proxyClientMaxBodySize: '12mb' },
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ];
    return [
      // The preview runs MDX from the repository, which is code. It lives in a sandboxed frame with an opaque origin,
      // no network and no way to be framed by anyone else, so it cannot reach the dashboard's cookies or API.
      {
        source: '/preview-frame',
        headers: [
          ...common,
          {
            key: 'Content-Security-Policy',
            value:
              "sandbox allow-scripts; connect-src 'none'; frame-ancestors 'self'; form-action 'none'",
          },
        ],
      },
      {
        source: '/((?!preview-frame).*)',
        headers: [
          ...common,
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};
