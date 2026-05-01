import { NextResponse } from 'next/server';
import { verifyCsrf } from '@/lib/auth';

export async function POST(request) {
  const csrf = verifyCsrf(request);
  if (!csrf.ok) return csrf.response;

  return NextResponse.json(
    { error: 'Лента доступна только для просмотра агрегированных постов. Публикация доступна в профиле пользователя.' },
    { status: 403 }
  );
}
