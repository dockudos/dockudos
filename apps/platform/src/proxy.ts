import { NextResponse, type NextRequest } from 'next/server';

/**
 * Forward `/api/v1/*` and `/auth/*` to the platform API. The address comes from `DOCKUDOS_API_URL` when the
 * request arrives, so one built image runs anywhere. The browser only ever talks to this origin.
 */
export function proxy(request: NextRequest) {
  const api = process.env['DOCKUDOS_API_URL'];
  if (!api)
    return new NextResponse('DOCKUDOS_API_URL is not set.', { status: 503 });
  const target = new URL(
    request.nextUrl.pathname + request.nextUrl.search,
    api,
  );
  return NextResponse.rewrite(target);
}

export const config = { matcher: ['/api/v1/:path*', '/auth/:path*'] };
