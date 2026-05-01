import { NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'fs_session';

export function proxy(request) {
  const protectedPrefixes = ['/profile', '/feed', '/chat', '/people', '/settings'];
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (hasSession) return NextResponse.next();

  return NextResponse.redirect(new URL('/', request.url));
}

export const config = {
  matcher: ['/profile/:path*', '/feed/:path*', '/chat/:path*', '/people/:path*', '/settings/:path*'],
};
