import { NextResponse } from 'next/server';
import { getCurrentSession, touchSession } from '@/lib/auth';

function parseUrls(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) return NextResponse.json({ error: 'Требуется авторизация.' }, { status: 401 });
    await touchSession(session.id);

    const enabled = String(process.env.CHAT_CALLS_ENABLED || '1').trim() !== '0';
    const provider = String(process.env.WEBRTC_PROVIDER || 'native').trim() || 'native';
    const stunUrls = parseUrls(process.env.WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302');
    const turnUrls = parseUrls(process.env.WEBRTC_TURN_URLS || '');
    const turnUsername = String(process.env.WEBRTC_TURN_USERNAME || '').trim();
    const turnCredential = String(process.env.WEBRTC_TURN_CREDENTIAL || '').trim();

    return NextResponse.json({
      enabled,
      provider,
      ice_servers: [
        ...stunUrls.map((url) => ({ urls: url })),
        ...turnUrls.map((url) => ({
          urls: url,
          username: turnUsername || undefined,
          credential: turnCredential || undefined,
        })),
      ],
      features: {
        audio: true,
        video: true,
        signaling: true,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: 'Не удалось получить конфигурацию звонков.' }, { status: 500 });
  }
}
