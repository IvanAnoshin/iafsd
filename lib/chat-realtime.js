import { publishRealtimeUsers, subscribeRealtimeUser } from '@/lib/realtime-transport';

const encoder = new TextEncoder();

function encodeEventEntry(entry) {
  return encoder.encode(`id: ${entry.id}
event: ${entry.event}
data: ${JSON.stringify(entry.payload)}

`);
}

export async function subscribeUserStream(userId, send, options = {}) {
  return subscribeRealtimeUser(userId, send, options, encodeEventEntry);
}

export function emitUserEvent(userId, event, payload) {
  return publishRealtimeUsers([userId], event, payload, encodeEventEntry);
}

export function emitUsersEvent(userIds, event, payload) {
  return publishRealtimeUsers(userIds, event, payload, encodeEventEntry);
}

export function sseComment(text = 'keepalive') {
  return encoder.encode(`: ${text}

`);
}

export function sseEvent(event, payload, options = {}) {
  const idLine = options?.id ? `id: ${options.id}
` : '';
  return encoder.encode(`${idLine}event: ${event}
data: ${JSON.stringify(payload)}

`);
}
