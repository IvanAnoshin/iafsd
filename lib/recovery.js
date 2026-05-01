import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { deriveDeviceDescriptor } from '@/lib/devices';
import { normalizeName, normalizedKey, formatRecoveryCode } from '@/lib/dfsn';

const DEFAULT_RECOVERY_TTL_MINUTES = 20;
const RECOVERY_WORDS = [
  'берег', 'искра', 'север', 'камень', 'туман', 'парус', 'ветер', 'ручей', 'сфера', 'линия',
  'озеро', 'сосна', 'орбита', 'пламя', 'мостик', 'книга', 'ландыш', 'сокол', 'звезда', 'капля',
  'маяк', 'облако', 'кварц', 'тропа', 'свет', 'луна', 'поле', 'ключ', 'волна', 'пиксель',
  'сад', 'гранит', 'нитка', 'радиус', 'лес', 'море', 'утро', 'пульс', 'арка', 'небо',
  'компас', 'пепел', 'орех', 'молния', 'дюна', 'знак', 'птица', 'трава', 'эхо', 'кедр',
];

export function getRecoveryPrompt() {
  return String(process.env.RECOVERY_SECRET_PROMPT || 'Введи свой секретный ответ').trim() || 'Введи свой секретный ответ';
}

export function getRecoveryExpiryDate() {
  const raw = Number(process.env.RECOVERY_SESSION_TTL_MINUTES || DEFAULT_RECOVERY_TTL_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECOVERY_TTL_MINUTES;
  return new Date(Date.now() + minutes * 60 * 1000);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

export function createRecoveryCompletionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function hashRecoveryCompletionToken(token) {
  return sha256(`recovery-complete:${String(token || '').trim()}`);
}

export function verifyRecoveryCompletionToken(recovery, token) {
  const metadata = recovery?.metadata && typeof recovery.metadata === 'object' ? recovery.metadata : {};
  const expected = String(metadata.completion_token_hash || '');
  const provided = hashRecoveryCompletionToken(token);
  if (!expected || !token) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function revokeUserSessionsForRecovery(userId, tx = prisma) {
  if (!userId) return { count: 0 };
  return tx.session.deleteMany({ where: { userId } });
}

export function normalizeRecoveryPhrase(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[ё]/g, 'е')
    .replace(/[^a-zа-я0-9\s-]+/gi, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function generateRecoveryPhrase(wordCount = 8) {
  const count = Math.max(6, Math.min(12, Number(wordCount) || 8));
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const randomIndex = crypto.randomInt(0, RECOVERY_WORDS.length);
    result.push(RECOVERY_WORDS[randomIndex]);
  }
  return result.join(' ');
}

export async function hashRecoveryPhrase(phrase) {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!normalized || normalized.split(' ').length < 4) {
    const error = new Error('Recovery-фраза должна содержать минимум 4 слова.');
    error.status = 400;
    throw error;
  }
  return bcrypt.hash(normalized, 10);
}

export async function countTrustedRecoveryDevices(userId, tx = prisma) {
  if (!userId) return 0;
  return tx.userDevice.count({
    where: {
      userId,
      trusted: true,
      pinHash: { not: null },
    },
  });
}

export async function listRecoveryReadiness(user, tx = prisma) {
  if (!user?.id) {
    return {
      has_recovery_phrase: false,
      trusted_recovery_devices: 0,
      passkeys_count: 0,
    };
  }

  const [trustedRecoveryDevices, passkeysCount] = await Promise.all([
    countTrustedRecoveryDevices(user.id, tx),
    tx.accountPasskey.count({ where: { userId: user.id, disabledAt: null } }).catch(() => 0),
  ]);

  return {
    has_recovery_phrase: Boolean(user.recoveryPhraseHash),
    trusted_recovery_devices: trustedRecoveryDevices,
    passkeys_count: passkeysCount,
  };
}

export function getAvailableRecoveryMethods(user, readiness = null) {
  const methods = [];
  if (user?.secretAnswerHash) {
    methods.push({
      key: 'secret_answer',
      label: 'Секретный ответ',
      prompt: getRecoveryPrompt(),
    });
  }

  const backupHashes = Array.isArray(user?.backupCodeHashes) ? user.backupCodeHashes : [];
  if (backupHashes.length) {
    methods.push({
      key: 'backup_code',
      label: 'Резервный код',
      remaining: backupHashes.length,
    });
  }

  if (user?.recoveryPhraseHash) {
    methods.push({
      key: 'recovery_phrase',
      label: 'Recovery-фраза',
    });
  }

  if (readiness?.trusted_recovery_devices > 0) {
    methods.push({
      key: 'trusted_device',
      label: 'Доверенное устройство + PIN',
      devices: readiness.trusted_recovery_devices,
    });
  }

  if (readiness?.passkeys_count > 0) {
    methods.push({
      key: 'passkey',
      label: 'Passkey',
      available: true,
    });
  }

  methods.push({
    key: 'support',
    label: 'Поддержка',
  });

  return methods;
}

export async function findRecoveryUser(firstNameInput, lastNameInput) {
  const firstName = normalizeName(firstNameInput);
  const lastName = normalizeName(lastNameInput);
  if (!firstName || !lastName) {
    return { firstName, lastName, key: null, user: null };
  }

  const key = normalizedKey(firstName, lastName);
  const user = await prisma.user.findUnique({ where: { normalizedKey: key } });
  return { firstName, lastName, key, user };
}

export async function cleanupExpiredRecoverySessionById(id) {
  if (!id) return null;
  const session = await prisma.recoverySession.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now() && session.status !== 'completed' && session.status !== 'expired') {
    const expired = await prisma.recoverySession.update({
      where: { id },
      data: { status: 'expired' },
      include: { user: true },
    });
    return expired;
  }
  return session;
}

export async function createRecoverySession(user, metadata = null) {
  await prisma.recoverySession.updateMany({
    where: {
      userId: user.id,
      status: { in: ['pending', 'verified'] },
    },
    data: { status: 'expired' },
  });

  return prisma.recoverySession.create({
    data: {
      userId: user.id,
      normalizedKey: user.normalizedKey,
      expiresAt: getRecoveryExpiryDate(),
      metadata,
    },
    include: { user: true },
  });
}

export function validateNewPassword(password, confirmPassword) {
  const normalizedPassword = String(password || '');
  const normalizedConfirm = String(confirmPassword || '');

  if (!normalizedPassword || !normalizedConfirm) {
    return 'Введите новый пароль и подтверждение.';
  }
  if (normalizedPassword.length < 8) {
    return 'Пароль должен быть не короче 8 символов.';
  }
  if (normalizedPassword !== normalizedConfirm) {
    return 'Пароли не совпадают.';
  }
  return null;
}

export async function verifyTrustedDeviceRecovery({ user, pin, request, tx = prisma }) {
  if (!user?.id) return { ok: false, reason: 'user_not_found' };
  const normalizedPin = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(normalizedPin)) return { ok: false, reason: 'invalid_pin_format' };

  const descriptor = deriveDeviceDescriptor({ request, deviceContext: {} });
  const device = await tx.userDevice.findFirst({
    where: {
      userId: user.id,
      fingerprint: descriptor.fingerprint,
      trusted: true,
      pinHash: { not: null },
    },
  });

  if (!device?.pinHash) return { ok: false, reason: 'trusted_device_not_found' };
  const ok = await bcrypt.compare(normalizedPin, device.pinHash);
  if (!ok) return { ok: false, reason: 'bad_device_pin' };

  return {
    ok: true,
    device: {
      id: device.id,
      label: device.label,
      platform: device.platform,
    },
  };
}

export async function verifyRecoveryMethod(user, method, payload, context = {}) {
  if (!user) return { ok: false, reason: 'user_not_found' };

  if (method === 'secret_answer') {
    const secretAnswer = String(payload?.secret_answer || '').trim();
    if (!secretAnswer) return { ok: false, reason: 'missing_secret_answer' };
    if (!user.secretAnswerHash) return { ok: false, reason: 'secret_not_configured' };
    const ok = await bcrypt.compare(secretAnswer, user.secretAnswerHash);
    return ok ? { ok: true } : { ok: false, reason: 'invalid_secret_answer' };
  }

  if (method === 'backup_code') {
    const backupCode = formatRecoveryCode(payload?.backup_code);
    if (!backupCode) return { ok: false, reason: 'missing_backup_code' };
    const hashes = Array.isArray(user.backupCodeHashes) ? user.backupCodeHashes : [];
    for (let index = 0; index < hashes.length; index += 1) {
      const ok = await bcrypt.compare(backupCode, String(hashes[index]));
      if (ok) return { ok: true, matchedIndex: index };
    }
    return { ok: false, reason: 'invalid_backup_code' };
  }

  if (method === 'recovery_phrase') {
    const phrase = normalizeRecoveryPhrase(payload?.recovery_phrase);
    if (!phrase) return { ok: false, reason: 'missing_recovery_phrase' };
    if (!user.recoveryPhraseHash) return { ok: false, reason: 'recovery_phrase_not_configured' };
    const ok = await bcrypt.compare(phrase, user.recoveryPhraseHash);
    return ok ? { ok: true } : { ok: false, reason: 'invalid_recovery_phrase' };
  }

  if (method === 'trusted_device') {
    return verifyTrustedDeviceRecovery({ user, pin: payload?.device_pin, request: context.request, tx: context.tx || prisma });
  }

  return { ok: false, reason: 'unsupported_method' };
}
