import { getCurrentSession, touchSession } from '@/lib/auth';
import { sseComment, sseEvent, subscribeUserStream } from '@/lib/chat-realtime';
import { getUnreadSummary } from '@/lib/realtime-sync';
import { recordMessengerMetric } from '@/lib/chat-observability';

export const runtime = 'nodejs';

function resolveSinceId(request) {
  const url = new URL(request.url);
  const fromQuery = Number(url.searchParams.get('since') || 0);
  if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery;
  const fromHeader = Number(request.headers.get('last-event-id') || 0);
  if (Number.isInteger(fromHeader) && fromHeader > 0) return fromHeader;
  return null;
}

export async function GET(request) {
  const session = await getCurrentSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Требуется авторизация.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  await touchSession(session.id);

  const sinceId = resolveSinceId(request);
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sseComment('connected'));

      const subscription = await subscribeUserStream(session.user.id, (chunk) => controller.enqueue(chunk), { sinceId });
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(sseComment('keepalive'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);

      try {
        const unreadSummary = await getUnreadSummary(session.user.id);
        controller.enqueue(sseEvent('sync.unread', unreadSummary));
      } catch {
        // avoid breaking realtime stream if summary fetch fails
      }

      await recordMessengerMetric({
        userId: session.user.id,
        category: 'realtime',
        metric: 'stream_connect',
        outcome: subscription.resetRequired ? 'reset_required' : (sinceId ? 'replayed' : 'connected'),
        value: subscription.replayedCount,
        details: { sinceId, lastEventId: subscription.lastEventId, resetRequired: subscription.resetRequired },
      }).catch(() => null);

      controller.enqueue(sseEvent('stream.ready', {
        userId: session.user.id,
        connectedAt: new Date().toISOString(),
        replayedCount: subscription.replayedCount,
        resetRequired: subscription.resetRequired,
        sinceId,
        lastEventId: subscription.lastEventId,
      }));

      cleanup = () => {
        clearInterval(keepAlive);
        subscription.unsubscribe();
        try {
          controller.close();
        } catch {}
      };
    },
    cancel() {
      try {
        cleanup();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
