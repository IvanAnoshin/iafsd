import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { normalizeName, normalizedKey, formatRecoveryCode } from '@/lib/dfsn';

const DEFAULT_RECOVERY_TTL_MINUTES = 20;

export function getRecoveryPrompt() {
  return String(process.env.RECOVERY_SECRET_PROMPT || 'Введи свой секретный ответ').trim() || 'Введи свой секретный ответ';
}

export function getRecoveryExpiryDate() {
  const raw = Number(process.env.RECOVERY_SESSION_TTL_MINUTES || DEFAULT_RECOVERY_TTL_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECOVERY_TTL_MINUTES;
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function getAvailableRecoveryMethods(user) {
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

export async function verifyRecoveryMethod(user, method, payload) {
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

  return { ok: false, reason: 'unsupported_method' };
}
