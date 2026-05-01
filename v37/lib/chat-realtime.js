const encoder = new TextEncoder();
const USER_EVENT_HISTORY_LIMIT = 250;

function getState() {
  if (!globalThis.__friendscapeChatRealtime) {
    globalThis.__friendscapeChatRealtime = {
      listeners: new Map(),
      history: new Map(),
      nextListenerId: 1,
      nextEventId: 1,
    };
  }
  return globalThis.__friendscapeChatRealtime;
}

function getUserListeners(userId) {
  const state = getState();
  const key = String(userId);
  if (!state.listeners.has(key)) state.listeners.set(key, new Map());
  return state.listeners.get(key);
}

function getUserHistory(userId) {
  const state = getState();
  const key = String(userId);
  if (!state.history.has(key)) state.history.set(key, []);
  return state.history.get(key);
}

function nextEventId() {
  const state = getState();
  const id = state.nextEventId;
  state.nextEventId += 1;
  return id;
}

function createEventEntry(event, payload) {
  return {
    id: nextEventId(),
    event,
    payload,
    createdAt: new Date().toISOString(),
  };
}

function encodeEventEntry(entry) {
  return encoder.encode(`id: ${entry.id}
event: ${entry.event}
data: ${JSON.stringify(entry.payload)}

`);
}

function storeUserEvent(userId, entry) {
  const history = getUserHistory(userId);
  history.push(entry);
  if (history.length > USER_EVENT_HISTORY_LIMIT) {
    history.splice(0, history.length - USER_EVENT_HISTORY_LIMIT);
  }
}

function replayEntriesForUser(userId, sinceId) {
  const history = getState().history.get(String(userId)) || [];
  if (!history.length) {
    return { entries: [], replayedCount: 0, resetRequired: false, lastEventId: null };
  }

  const lastEventId = history[history.length - 1]?.id || null;
  const numericSinceId = Number(sinceId);
  if (!Number.isInteger(numericSinceId) || numericSinceId <= 0) {
    return { entries: [], replayedCount: 0, resetRequired: false, lastEventId };
  }

  const earliestEventId = history[0]?.id || null;
  const resetRequired = Number.isInteger(earliestEventId) && numericSinceId < earliestEventId;
  const entries = history.filter((entry) => entry.id > numericSinceId);
  return {
    entries,
    replayedCount: entries.length,
    resetRequired,
    lastEventId,
  };
}

function emitUserEntry(userId, entry) {
  const listeners = getState().listeners.get(String(userId));
  storeUserEvent(userId, entry);
  if (!listeners?.size) return 0;
  let count = 0;
  const data = encodeEventEntry(entry);
  for (const send of listeners.values()) {
    try {
      send(data);
      count += 1;
    } catch {
      // listener cleanup happens on stream close
    }
  }
  return count;
}

export function subscribeUserStream(userId, send, options = {}) {
  const state = getState();
  const listeners = getUserListeners(userId);
  const id = state.nextListenerId++;
  listeners.set(id, send);

  const replay = replayEntriesForUser(userId, options?.sinceId || null);
  if (replay.entries.length) {
    for (const entry of replay.entries) {
      try {
        send(encodeEventEntry(entry));
      } catch {
        break;
      }
    }
  }

  return {
    replayedCount: replay.replayedCount,
    resetRequired: replay.resetRequired,
    lastEventId: replay.lastEventId,
    unsubscribe: () => {
      listeners.delete(id);
      if (!listeners.size) state.listeners.delete(String(userId));
    },
  };
}

export function emitUserEvent(userId, event, payload) {
  const entry = createEventEntry(event, payload);
  return emitUserEntry(userId, entry);
}

export function emitUsersEvent(userIds, event, payload) {
  const uniqueIds = [...new Set((userIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!uniqueIds.length) return 0;
  const entry = createEventEntry(event, payload);
  let count = 0;
  for (const userId of uniqueIds) count += emitUserEntry(userId, entry);
  return count;
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
