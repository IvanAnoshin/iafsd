import { NextResponse } from 'next/server';
import { CSRF_COOKIE, applyCsrfCookie, createCsrfToken } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildHeaders() {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

export async function GET(request) {
  const existingToken = request.cookies.get(CSRF_COOKIE)?.value || null;
  const csrfToken = existingToken || createCsrfToken();
  const response = NextResponse.json(
    {
      csrfToken,
      headerName: 'x-csrf-token',
      cookieName: CSRF_COOKIE,
    },
    {
      headers: buildHeaders(),
    }
  );

  applyCsrfCookie(response, csrfToken);
  return response;
}
