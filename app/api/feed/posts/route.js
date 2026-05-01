import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Публикация из ленты отключена.' },
    { status: 405, headers: { Allow: '' } },
  );
}
