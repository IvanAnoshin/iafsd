import { NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'fs_session';
const PROTECTED_PREFIXES = ['/profile', '/feed', '/chat', '/people', '/settings', '/communities', '/stories', '/feedback'];

function applyNoStore(response) {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  return response;
}

export function proxy(request) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!hasSession) {
    return applyNoStore(NextResponse.redirect(new URL('/', request.url)));
  }

  return applyNoStore(NextResponse.next());
}

export const config = {
  matcher: [
    '/profile/:path*',
    '/feed/:path*',
    '/chat/:path*',
    '/people/:path*',
    '/settings/:path*',
    '/communities/:path*',
    '/stories/:path*',
    '/feedback/:path*',
  ],
};
