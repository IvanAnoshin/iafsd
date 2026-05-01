import prisma, { prismaPgPool } from '@/lib/prisma';
import { logError, logInfo, logWarn } from '@/lib/monitoring';

const HISTORY_LIMIT = Math.max(25, Number(process.env.REALTIME_HISTORY_LIMIT || 250));
const CLEANUP_DAYS = Math.max(1, Number(process.env.REALTIME_EVENT_RETENTION_DAYS || 3));
const rawPgChannel = String(process.env.REALTIME_PG_CHANNEL || 'friendscape_realtime').replace(/[^a-zA-Z0-9_]/g, '_');
const PG_CHANNEL = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(rawPgChannel) ? rawPgChannel : 'friendscape_realtime';
const PROCESS_ID = `${process.pid || 0}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

const state = {
  listeners: new Map(),
  history: new Map(),
  nextListenerId: 1,
  nextMemoryEventId: 1,
  pgListening: false,
  pgStarting: false,
  pgClient: null,
  pgRetryTimer: null,
  pgLastErrorAt: 0,
};

function normalizeTransport(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (['postgres', 'pg', 'db', 'database'].includes(mode)) return 'postgres';
  if (['memory', 'local', 'in-memory', 'process'].includes(mode)) return 'memory';
  return process.env.NODE_ENV === 'production' ? 'postgres' : 'memory';
}

export function getRealtimeTransportName() {
  return normalizeTransport(process.env.REALTIME_TRANSPORT || process.env.REALTIME_PROVIDER);
}

export function getRealtimeRuntimeInfo() {
  return {
    transport: getRealtimeTransportName(),
    processId: PROCESS_ID,
    channel: getRealtimeTransportName() === 'postgres' ? PG_CHANNEL : null,
    localListeners: [...state.listeners.values()].reduce((sum, item) => sum + item.size, 0),
    localUsers: state.listeners.size,
    historyLimit: HISTORY_LIMIT,
    retentionDays: CLEANUP_DAYS,
  };
}

function validUserId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function uniqueUserIds(userIds) {
  return [...new Set((userIds || []).map(validUserId).filter(Boolean))];
}

function listenersFor(userId) {
  const key = String(userId);
  if (!state.listeners.has(key)) state.listeners.set(key, new Map());
  return state.listeners.get(key);
}

function historyFor(userId) {
  const key = String(userId);
  if (!state.history.has(key)) state.history.set(key, []);
  return state.history.get(key);
}

function memoryEventId() {
  const id = state.nextMemoryEventId;
  state.nextMemoryEventId += 1;
  return id;
}

function expiresAt() {
  return new Date(Date.now() + CLEANUP_DAYS * 24 * 60 * 60 * 1000);
}

function makeEntry({ id, userId, event, payload, origin = PROCESS_ID, createdAt = new Date().toISOString() }) {
  return {
    id: Number(id) || memoryEventId(),
    userId: Number(userId) || null,
    event: String(event || 'message'),
    payload: payload ?? null,
    origin: origin || null,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt || new Date().toISOString()),
  };
}

function storeEntry(userId, entry) {
  const history = historyFor(userId);
  history.push(entry);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
}

function deliverLocal(userId, entry, encodeEntry) {
  const id = validUserId(userId);
  if (!id) return 0;

  storeEntry(id, entry);

  const listeners = state.listeners.get(String(id));
  if (!listeners?.size) return 0;

  let delivered = 0;
  const data = encodeEntry(entry);
  for (const send of listeners.values()) {
    try {
      send(data);
      delivered += 1;
    } catch {
      // stream cleanup happens on close/cancel
    }
  }
  return delivered;
}

function replayMemory(userId, sinceId) {
  const history = state.history.get(String(userId)) || [];
  if (!history.length) return { entries: [], replayedCount: 0, resetRequired: false, lastEventId: null };

  const lastEventId = history[history.length - 1]?.id || null;
  const numericSinceId = Number(sinceId);
  if (!Number.isInteger(numericSinceId) || numericSinceId <= 0) {
    return { entries: [], replayedCount: 0, resetRequired: false, lastEventId };
  }

  const earliestEventId = history[0]?.id || null;
  const resetRequired = Number.isInteger(earliestEventId) && numericSinceId < earliestEventId;
  const entries = history.filter((entry) => Number(entry.id) > numericSinceId);
  return { entries, replayedCount: entries.length, resetRequired, lastEventId };
}

async function replayPostgres(userId, sinceId) {
  const numericSinceId = Number(sinceId);
  if (!Number.isInteger(numericSinceId) || numericSinceId <= 0 || !prisma?.realtimeEvent) {
    const latest = prisma?.realtimeEvent
      ? await prisma.realtimeEvent.findFirst({ where: { userId }, orderBy: { id: 'desc' }, select: { id: true } }).catch(() => null)
      : null;
    return { entries: [], replayedCount: 0, resetRequired: false, lastEventId: latest?.id || null };
  }

  const [entries, earliest, latest] = await Promise.all([
    prisma.realtimeEvent.findMany({
      where: { userId, id: { gt: numericSinceId }, expiresAt: { gt: new Date() } },
      orderBy: { id: 'asc' },
      take: HISTORY_LIMIT,
    }),
    prisma.realtimeEvent.findFirst({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { id: 'asc' }, select: { id: true } }),
    prisma.realtimeEvent.findFirst({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' }, select: { id: true } }),
  ]).catch((error) => {
    logError('realtime.replay_failed', error, { userId });
    return [[], null, null];
  });

  const resetRequired = Boolean(earliest?.id && numericSinceId < earliest.id);
  return {
    entries: entries.map((item) => makeEntry(item)),
    replayedCount: entries.length,
    resetRequired,
    lastEventId: latest?.id || null,
  };
}

async function publishPostgres(userIds, event, payload, encodeEntry) {
  if (!prisma?.realtimeEvent || !prismaPgPool?.query) return;

  try {
    const rows = await prisma.$transaction(
      userIds.map((userId) => prisma.realtimeEvent.create({
        data: {
          userId,
          event: String(event || 'message'),
          payload: payload ?? {},
          origin: PROCESS_ID,
          expiresAt: expiresAt(),
        },
        select: { id: true, userId: true, event: true, payload: true, origin: true, createdAt: true },
      }))
    );

    for (const row of rows) {
      deliverLocal(row.userId, makeEntry(row), encodeEntry);
    }

    for (let index = 0; index < rows.length; index += 200) {
      const notifyPayload = JSON.stringify({ origin: PROCESS_ID, ids: rows.slice(index, index + 200).map((row) => row.id) });
      await prismaPgPool.query('SELECT pg_notify($1, $2)', [PG_CHANNEL, notifyPayload]);
    }
  } catch (error) {
    logError('realtime.publish_postgres_failed', error, { event, userCount: userIds.length });
  }
}

async function handlePgNotification(message, encodeEntry) {
  let data;
  try {
    data = JSON.parse(message.payload || '{}');
  } catch {
    return;
  }
  if (!data || data.origin === PROCESS_ID) return;
  const ids = Array.isArray(data.ids) ? data.ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : [];
  if (!ids.length || !prisma?.realtimeEvent) return;

  try {
    const rows = await prisma.realtimeEvent.findMany({ where: { id: { in: ids }, expiresAt: { gt: new Date() } } });
    for (const row of rows) {
      deliverLocal(row.userId, makeEntry(row), encodeEntry);
    }
  } catch (error) {
    logError('realtime.pg_notification_failed', error, { count: ids.length });
  }
}

export async function ensureRealtimeTransport(encodeEntry) {
  if (getRealtimeTransportName() !== 'postgres') return { transport: 'memory', listening: false };
  if (state.pgListening || state.pgStarting) return { transport: 'postgres', listening: state.pgListening };
  if (!prismaPgPool?.connect) return { transport: 'postgres', listening: false, error: 'pg pool unavailable' };

  state.pgStarting = true;
  try {
    const client = await prismaPgPool.connect();
    state.pgClient = client;
    client.on('notification', (message) => handlePgNotification(message, encodeEntry));
    client.on('error', (error) => {
      state.pgListening = false;
      state.pgClient = null;
      const now = Date.now();
      if (now - state.pgLastErrorAt > 30000) {
        state.pgLastErrorAt = now;
        logError('realtime.pg_listener_error', error);
      }
      try { client.release(true); } catch {}
      schedulePgReconnect(encodeEntry);
    });
    await client.query(`LISTEN ${PG_CHANNEL}`);
    state.pgListening = true;
    logInfo('realtime.pg_listener_ready', { channel: PG_CHANNEL, processId: PROCESS_ID });
  } catch (error) {
    logError('realtime.pg_listener_start_failed', error, { channel: PG_CHANNEL });
    schedulePgReconnect(encodeEntry);
  } finally {
    state.pgStarting = false;
  }

  return { transport: 'postgres', listening: state.pgListening };
}

function schedulePgReconnect(encodeEntry) {
  if (state.pgRetryTimer) return;
  state.pgRetryTimer = setTimeout(() => {
    state.pgRetryTimer = null;
    ensureRealtimeTransport(encodeEntry).catch((error) => logError('realtime.pg_reconnect_failed', error));
  }, 3000);
  state.pgRetryTimer.unref?.();
}

export async function subscribeRealtimeUser(userId, send, options = {}, encodeEntry) {
  const id = validUserId(userId);
  if (!id) throw new Error('Invalid realtime user id');

  await ensureRealtimeTransport(encodeEntry);

  const listeners = listenersFor(id);
  const listenerId = state.nextListenerId++;
  listeners.set(listenerId, send);

  const transport = getRealtimeTransportName();
  const replay = transport === 'postgres'
    ? await replayPostgres(id, options?.sinceId || null)
    : replayMemory(id, options?.sinceId || null);

  for (const entry of replay.entries) {
    try {
      send(encodeEntry(entry));
    } catch {
      break;
    }
  }

  return {
    transport,
    replayedCount: replay.replayedCount,
    resetRequired: replay.resetRequired,
    lastEventId: replay.lastEventId,
    unsubscribe: () => {
      listeners.delete(listenerId);
      if (!listeners.size) state.listeners.delete(String(id));
    },
  };
}

export function publishRealtimeUsers(userIds, event, payload, encodeEntry) {
  const ids = uniqueUserIds(userIds);
  if (!ids.length) return 0;

  if (getRealtimeTransportName() === 'postgres') {
    ensureRealtimeTransport(encodeEntry).catch((error) => logError('realtime.ensure_before_publish_failed', error));
    publishPostgres(ids, event, payload, encodeEntry).catch((error) => logError('realtime.publish_background_failed', error));
    return state.listeners.size;
  }

  const entry = makeEntry({ event, payload, origin: PROCESS_ID });
  let delivered = 0;
  for (const userId of ids) delivered += deliverLocal(userId, entry, encodeEntry);
  return delivered;
}

export async function cleanupRealtimeEvents({ olderThan = new Date(), deleteRows = false, db = prisma } = {}) {
  if (!db?.realtimeEvent) return { matched: 0, deleted: 0 };
  const where = { expiresAt: { lt: olderThan } };
  const matched = await db.realtimeEvent.count({ where });
  if (!deleteRows || !matched) return { matched, deleted: 0 };
  const result = await db.realtimeEvent.deleteMany({ where });
  return { matched, deleted: result.count };
}
