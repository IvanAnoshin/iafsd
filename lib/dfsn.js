import crypto from 'node:crypto';

export function normalizeName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function normalizedKey(firstName, lastName) {
  return `${firstName.toLowerCase()}:${lastName.toLowerCase()}`;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (!values.length) return 0;
  const avg = average(values);
  return average(values.map((value) => Math.pow(value - avg, 2)));
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function uniqueKeys(events) {
  const counter = new Map();
  for (const event of events) {
    const key = String(event.key || '').trim() || 'unknown';
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  const top = [...counter.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

export function computeDfsnFeatures({ typingEvents = [], mouseEvents = [], scrollEvents = [], startedAt, endedAt, route = 'unknown', screen = 'unknown' }) {
  const delays = typingEvents
    .map((event) => toNumber(event.delay))
    .filter((value) => value > 0);

  const typingSpeed = delays.length ? 60000 / average(delays) : 0;
  const typingVariance = delays.length ? variance(delays) : 0;

  const correctionCount = typingEvents.filter(
    (event) => event.backspace || event.corrected || String(event.key || '').toLowerCase() === 'backspace'
  ).length;
  const correctionRate = typingEvents.length ? correctionCount / typingEvents.length : 0;

  const mouseSpeeds = mouseEvents
    .map((event) => toNumber(event.speed))
    .filter((value) => value > 0);
  const mouseSpeed = average(mouseSpeeds);

  const mouseAccuracySamples = [];
  for (let index = 1; index < mouseEvents.length - 1; index += 1) {
    const p1 = mouseEvents[index - 1];
    const p2 = mouseEvents[index];
    const p3 = mouseEvents[index + 1];

    const dx = toNumber(p3.x) - toNumber(p1.x);
    const dy = toNumber(p3.y) - toNumber(p1.y);
    const denominator = Math.sqrt(dx * dx + dy * dy);
    if (!denominator) continue;

    const numerator = Math.abs(
      (toNumber(p3.x) - toNumber(p1.x)) * (toNumber(p1.y) - toNumber(p2.y)) -
        (toNumber(p1.x) - toNumber(p2.x)) * (toNumber(p3.y) - toNumber(p1.y))
    );

    const deviation = numerator / denominator;
    const accuracy = 1 / (1 + deviation / 20);
    mouseAccuracySamples.push(accuracy);
  }
  const mouseAccuracy = average(mouseAccuracySamples);

  const hoverLatencies = [];
  for (let index = 1; index < mouseEvents.length; index += 1) {
    const current = mouseEvents[index];
    const previous = mouseEvents[index - 1];
    const timeGap = toNumber(current.timestamp) - toNumber(previous.timestamp);
    if (timeGap > 180 && timeGap < 5000) {
      hoverLatencies.push(timeGap);
    }
  }
  const hoverLatency = average(hoverLatencies);

  const scrollDepth = scrollEvents.reduce((sum, event) => sum + Math.abs(toNumber(event.delta)), 0);
  const scrollSpeed = average(
    scrollEvents.map((event) => Math.abs(toNumber(event.speed))).filter((value) => value > 0)
  );

  const sessionDuration = startedAt && endedAt
    ? Math.max(0, (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
    : 0;

  const activeHours = startedAt ? [new Date(startedAt).getHours()] : [];

  const pattern = [
    typingSpeed / 1000,
    typingVariance / 1000,
    mouseSpeed / 1000,
    mouseAccuracy,
    scrollDepth / 1000,
    sessionDuration / 60,
    correctionRate,
    hoverLatency / 1000,
    scrollSpeed / 1000,
  ];

  const qualityFlags = [];
  if (typingEvents.length < 12) qualityFlags.push('low_typing_events');
  if (mouseEvents.length < 8) qualityFlags.push('low_mouse_events');
  if (scrollEvents.length === 0) qualityFlags.push('no_scroll_events');
  if (sessionDuration > 0 && sessionDuration < 5) qualityFlags.push('short_session');
  if (correctionRate > 0.35) qualityFlags.push('high_correction_rate');
  if (typingSpeed > 1200) qualityFlags.push('extreme_typing_speed');
  if (mouseSpeed > 5000) qualityFlags.push('extreme_mouse_speed');

  const summaries = {
    typing_event_total: typingEvents.length,
    mouse_event_total: mouseEvents.length,
    scroll_event_total: scrollEvents.length,
    correction_total: correctionCount,
    top_key: uniqueKeys(typingEvents),
    screen_dwell_total: sessionDuration,
    navigation_length: 1,
    navigation_signature: route || screen || 'unknown',
  };

  return {
    typingSpeed,
    typingVariance,
    correctionRate,
    mouseSpeed,
    mouseAccuracy,
    hoverLatency,
    scrollDepth,
    scrollSpeed,
    sessionDuration,
    activeHours,
    pattern,
    qualityFlags,
    summaries,
  };
}

export function mergeBehavioralProfile(previousProfile, nextProfile) {
  if (!previousProfile) {
    return {
      typing_speed: nextProfile.typingSpeed,
      typing_variance: nextProfile.typingVariance,
      mouse_speed: nextProfile.mouseSpeed,
      mouse_accuracy: nextProfile.mouseAccuracy,
      scroll_depth: nextProfile.scrollDepth,
      session_duration: nextProfile.sessionDuration,
      active_hours: nextProfile.activeHours,
      pattern: nextProfile.pattern,
      updated_at: new Date().toISOString(),
    };
  }

  const blend = (oldValue, newValue) => {
    if (!oldValue) return newValue;
    return oldValue * 0.7 + newValue * 0.3;
  };

  return {
    typing_speed: blend(Number(previousProfile.typing_speed || 0), nextProfile.typingSpeed),
    typing_variance: blend(Number(previousProfile.typing_variance || 0), nextProfile.typingVariance),
    mouse_speed: blend(Number(previousProfile.mouse_speed || 0), nextProfile.mouseSpeed),
    mouse_accuracy: blend(Number(previousProfile.mouse_accuracy || 0), nextProfile.mouseAccuracy),
    scroll_depth: blend(Number(previousProfile.scroll_depth || 0), nextProfile.scrollDepth),
    session_duration: blend(Number(previousProfile.session_duration || 0), nextProfile.sessionDuration),
    active_hours: Array.from(
      new Set([...(previousProfile.active_hours || []), ...(nextProfile.activeHours || [])])
    ).slice(-12),
    pattern: nextProfile.pattern,
    updated_at: new Date().toISOString(),
  };
}

export function generateBackupCodes(count = 10) {
  const codes = new Set();
  while (codes.size < count) {
    const left = String(crypto.randomInt(0, 1000)).padStart(3, '0');
    const right = String(crypto.randomInt(0, 1000)).padStart(3, '0');
    codes.add(`${left}-${right}`);
  }
  return [...codes];
}

export function formatRecoveryCode(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}
