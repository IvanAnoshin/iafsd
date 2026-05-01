import crypto from 'node:crypto';
import prisma from '@/lib/prisma';
import { normalizedKey } from '@/lib/dfsn';

const PASSKEY_CHALLENGE_TTL_MINUTES = 5;
const PASSKEY_RP_NAME = process.env.PASSKEY_RP_NAME || 'Friendscape';
const PASSKEY_USER_VERIFICATION = process.env.PASSKEY_USER_VERIFICATION || 'preferred';
const PASSKEY_TIMEOUT_MS = 60000;

export function base64urlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64urlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function getExpiryDate() {
  return new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MINUTES * 60 * 1000);
}

function randomChallenge() {
  return base64urlEncode(crypto.randomBytes(32));
}

export function getPasskeyRpId(request) {
  const configured = String(process.env.PASSKEY_RP_ID || '').trim();
  if (configured) return configured;

  const appPublicUrl = String(process.env.APP_PUBLIC_URL || '').trim();
  if (appPublicUrl) {
    try { return new URL(appPublicUrl).hostname; } catch {}
  }

  try { return new URL(request.url).hostname; } catch {}
  return 'localhost';
}

export function getPasskeyOrigin(request) {
  const configured = String(process.env.PASSKEY_ORIGIN || process.env.APP_PUBLIC_URL || '').trim();
  if (configured) {
    try { return new URL(configured).origin; } catch {}
  }
  try { return new URL(request.url).origin; } catch {}
  return null;
}

export function getAllowedPasskeyOrigins(request) {
  const origins = new Set();
  const requestOrigin = getPasskeyOrigin(request);
  if (requestOrigin) origins.add(requestOrigin);
  const configured = String(process.env.PASSKEY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of configured) {
    try { origins.add(new URL(item).origin); } catch {}
  }
  return origins;
}

function assertOrigin(clientOrigin, request) {
  const allowed = getAllowedPasskeyOrigins(request);
  if (!clientOrigin || !allowed.has(clientOrigin)) {
    const error = new Error('Passkey origin не совпадает с серверной настройкой.');
    error.status = 400;
    error.code = 'PASSKEY_BAD_ORIGIN';
    throw error;
  }
}

function parseClientData(value, expectedType, expectedChallenge, request) {
  let data;
  try {
    data = JSON.parse(base64urlDecode(value).toString('utf8'));
  } catch {
    const error = new Error('Некорректные clientDataJSON passkey.');
    error.status = 400;
    throw error;
  }

  if (data.type !== expectedType) {
    const error = new Error('Некорректный тип WebAuthn-операции.');
    error.status = 400;
    throw error;
  }
  if (data.challenge !== expectedChallenge) {
    const error = new Error('Passkey challenge устарел или не совпадает.');
    error.status = 400;
    error.code = 'PASSKEY_BAD_CHALLENGE';
    throw error;
  }
  assertOrigin(data.origin, request);
  return data;
}

function decodeCborItem(buffer, offset = 0) {
  if (offset >= buffer.length) throw new Error('CBOR: unexpected end');
  const first = buffer[offset++];
  const major = first >> 5;
  let additional = first & 0x1f;

  const readLength = () => {
    if (additional < 24) return additional;
    if (additional === 24) return buffer[offset++];
    if (additional === 25) { const value = buffer.readUInt16BE(offset); offset += 2; return value; }
    if (additional === 26) { const value = buffer.readUInt32BE(offset); offset += 4; return value; }
    if (additional === 27) { const value = Number(buffer.readBigUInt64BE(offset)); offset += 8; return value; }
    throw new Error('CBOR: unsupported indefinite length');
  };

  if (major === 0) return { value: readLength(), offset };
  if (major === 1) return { value: -1 - readLength(), offset };
  if (major === 2) {
    const length = readLength();
    const value = buffer.subarray(offset, offset + length);
    return { value, offset: offset + length };
  }
  if (major === 3) {
    const length = readLength();
    const value = buffer.subarray(offset, offset + length).toString('utf8');
    return { value, offset: offset + length };
  }
  if (major === 4) {
    const length = readLength();
    const value = [];
    for (let index = 0; index < length; index += 1) {
      const decoded = decodeCborItem(buffer, offset);
      value.push(decoded.value);
      offset = decoded.offset;
    }
    return { value, offset };
  }
  if (major === 5) {
    const length = readLength();
    const value = new Map();
    for (let index = 0; index < length; index += 1) {
      const key = decodeCborItem(buffer, offset);
      offset = key.offset;
      const entry = decodeCborItem(buffer, offset);
      offset = entry.offset;
      value.set(key.value, entry.value);
    }
    return { value, offset };
  }
  if (major === 6) {
    readLength();
    return decodeCborItem(buffer, offset);
  }
  if (major === 7) {
    if (additional === 20) return { value: false, offset };
    if (additional === 21) return { value: true, offset };
    if (additional === 22) return { value: null, offset };
  }
  throw new Error(`CBOR: unsupported major type ${major}`);
}

function decodeCbor(buffer) {
  return decodeCborItem(Buffer.from(buffer), 0).value;
}

function parseCredentialPublicKey(coseBuffer) {
  const cose = decodeCbor(coseBuffer);
  if (!(cose instanceof Map)) throw new Error('COSE public key должен быть map.');
  const kty = cose.get(1);
  const alg = cose.get(3);
  const crv = cose.get(-1);
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (kty !== 2 || alg !== -7 || crv !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
    const error = new Error('Поддерживаются только passkeys ES256/P-256.');
    error.status = 400;
    error.code = 'PASSKEY_UNSUPPORTED_KEY';
    throw error;
  }
  return {
    kty: 'EC',
    crv: 'P-256',
    x: base64urlEncode(x),
    y: base64urlEncode(y),
    alg: 'ES256',
    ext: true,
  };
}

function parseRegistrationAuthData(authData, rpId) {
  if (authData.length < 55) throw new Error('Authenticator data слишком короткие.');
  const expectedRpHash = crypto.createHash('sha256').update(rpId).digest();
  const actualRpHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(expectedRpHash, actualRpHash)) {
    const error = new Error('Passkey создан для другого домена.');
    error.status = 400;
    error.code = 'PASSKEY_BAD_RP_ID';
    throw error;
  }
  const flags = authData[32];
  const counter = authData.readUInt32BE(33);
  const userPresent = Boolean(flags & 0x01);
  const attested = Boolean(flags & 0x40);
  if (!userPresent || !attested) {
    const error = new Error('Authenticator не подтвердил присутствие пользователя.');
    error.status = 400;
    throw error;
  }
  const credentialIdLength = authData.readUInt16BE(53);
  const credentialIdStart = 55;
  const credentialIdEnd = credentialIdStart + credentialIdLength;
  const credentialId = authData.subarray(credentialIdStart, credentialIdEnd);
  const publicKeyBuffer = authData.subarray(credentialIdEnd);
  const publicKey = parseCredentialPublicKey(publicKeyBuffer);
  return { credentialId, publicKey, counter, flags };
}

function parseAuthenticationAuthData(authData, rpId) {
  if (authData.length < 37) throw new Error('Authenticator data слишком короткие.');
  const expectedRpHash = crypto.createHash('sha256').update(rpId).digest();
  const actualRpHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(expectedRpHash, actualRpHash)) {
    const error = new Error('Passkey используется на другом домене.');
    error.status = 400;
    error.code = 'PASSKEY_BAD_RP_ID';
    throw error;
  }
  const flags = authData[32];
  const counter = authData.readUInt32BE(33);
  if (!Boolean(flags & 0x01)) {
    const error = new Error('Authenticator не подтвердил присутствие пользователя.');
    error.status = 400;
    throw error;
  }
  return { flags, counter };
}

function serializeCredentialDescriptor(passkey) {
  return {
    id: passkey.credentialId,
    type: 'public-key',
    transports: Array.isArray(passkey.transports) ? passkey.transports : undefined,
  };
}

export function serializePasskey(passkey) {
  return {
    id: passkey.id,
    label: passkey.label,
    created_at: passkey.createdAt,
    updated_at: passkey.updatedAt,
    last_used_at: passkey.lastUsedAt,
    disabled_at: passkey.disabledAt,
    transports: Array.isArray(passkey.transports) ? passkey.transports : [],
    metadata: passkey.metadata || {},
  };
}

export async function createPasskeyRegistrationOptions({ user, request, label = '' }) {
  const rpId = getPasskeyRpId(request);
  const challenge = randomChallenge();
  const existing = await prisma.accountPasskey.findMany({
    where: { userId: user.id, disabledAt: null },
    select: { credentialId: true, transports: true },
  });
  const record = await prisma.passkeyChallenge.create({
    data: {
      userId: user.id,
      normalizedKey: user.normalizedKey,
      challenge,
      type: 'registration',
      expiresAt: getExpiryDate(),
      metadata: { label: String(label || '').trim().slice(0, 80), rpId },
    },
  });

  return {
    challenge_id: record.id,
    publicKey: {
      challenge,
      rp: { name: PASSKEY_RP_NAME, id: rpId },
      user: {
        id: base64urlEncode(Buffer.from(`user:${user.id}`)),
        name: user.normalizedKey,
        displayName: `${user.firstName} ${user.lastName}`.trim(),
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        userVerification: PASSKEY_USER_VERIFICATION,
        residentKey: 'preferred',
      },
      timeout: PASSKEY_TIMEOUT_MS,
      attestation: 'none',
      excludeCredentials: existing.map(serializeCredentialDescriptor),
    },
  };
}

export async function verifyPasskeyRegistration({ user, request, challengeId, credential, label = '' }) {
  const challenge = await prisma.passkeyChallenge.findFirst({
    where: {
      id: String(challengeId || ''),
      userId: user.id,
      type: 'registration',
      consumedAt: null,
    },
  });
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    const error = new Error('Passkey challenge устарел. Начните регистрацию заново.');
    error.status = 400;
    throw error;
  }

  parseClientData(credential?.response?.clientDataJSON, 'webauthn.create', challenge.challenge, request);

  const attestationObject = decodeCbor(base64urlDecode(credential?.response?.attestationObject));
  const authData = attestationObject instanceof Map ? attestationObject.get('authData') : null;
  if (!Buffer.isBuffer(authData)) {
    const error = new Error('Некорректный attestationObject.');
    error.status = 400;
    throw error;
  }

  const rpId = challenge.metadata?.rpId || getPasskeyRpId(request);
  const parsed = parseRegistrationAuthData(authData, rpId);
  const credentialId = base64urlEncode(parsed.credentialId);
  const finalLabel = String(label || challenge.metadata?.label || '').trim().slice(0, 80) || 'Passkey';
  const transports = Array.isArray(credential?.response?.transports) ? credential.response.transports.slice(0, 8) : [];

  const passkey = await prisma.$transaction(async (tx) => {
    await tx.passkeyChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    return tx.accountPasskey.create({
      data: {
        userId: user.id,
        credentialId,
        publicKey: JSON.stringify(parsed.publicKey),
        counter: parsed.counter || 0,
        label: finalLabel,
        transports,
        metadata: {
          rpId,
          authenticatorAttachment: credential?.authenticatorAttachment || null,
          flags: parsed.flags,
        },
      },
    });
  });

  return passkey;
}

export async function createPasskeyAuthenticationOptions({ firstName, lastName, request }) {
  const key = normalizedKey(firstName, lastName);
  const user = await prisma.user.findUnique({ where: { normalizedKey: key } });
  if (!user) return { user: null, options: null };

  const passkeys = await prisma.accountPasskey.findMany({
    where: { userId: user.id, disabledAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!passkeys.length) return { user, options: null };

  const rpId = getPasskeyRpId(request);
  const challenge = randomChallenge();
  const record = await prisma.passkeyChallenge.create({
    data: {
      userId: user.id,
      normalizedKey: user.normalizedKey,
      challenge,
      type: 'authentication',
      expiresAt: getExpiryDate(),
      metadata: { rpId },
    },
  });

  return {
    user,
    options: {
      challenge_id: record.id,
      publicKey: {
        challenge,
        timeout: PASSKEY_TIMEOUT_MS,
        rpId,
        userVerification: PASSKEY_USER_VERIFICATION,
        allowCredentials: passkeys.map(serializeCredentialDescriptor),
      },
    },
  };
}

export async function verifyPasskeyAuthentication({ request, challengeId, credential }) {
  const challenge = await prisma.passkeyChallenge.findFirst({
    where: {
      id: String(challengeId || ''),
      type: 'authentication',
      consumedAt: null,
    },
    include: { user: true },
  });
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    const error = new Error('Passkey challenge устарел. Начните вход заново.');
    error.status = 400;
    throw error;
  }

  parseClientData(credential?.response?.clientDataJSON, 'webauthn.get', challenge.challenge, request);
  const credentialId = credential?.id || credential?.rawId;
  const passkey = await prisma.accountPasskey.findFirst({
    where: {
      userId: challenge.userId,
      credentialId: String(credentialId || ''),
      disabledAt: null,
    },
    include: { user: true },
  });
  if (!passkey) {
    const error = new Error('Passkey не найден или отключён.');
    error.status = 404;
    throw error;
  }

  const authData = base64urlDecode(credential?.response?.authenticatorData);
  const clientDataJSON = base64urlDecode(credential?.response?.clientDataJSON);
  const signature = base64urlDecode(credential?.response?.signature);
  const rpId = challenge.metadata?.rpId || getPasskeyRpId(request);
  const parsed = parseAuthenticationAuthData(authData, rpId);
  const signedData = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: JSON.parse(passkey.publicKey), format: 'jwk' });
  } catch {
    const error = new Error('Сохранённый passkey повреждён.');
    error.status = 500;
    throw error;
  }

  const ok = crypto.verify('sha256', signedData, publicKey, signature);
  if (!ok) {
    const error = new Error('Passkey-подпись не прошла проверку.');
    error.status = 401;
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.passkeyChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
    await tx.accountPasskey.update({
      where: { id: passkey.id },
      data: {
        counter: parsed.counter > passkey.counter ? parsed.counter : passkey.counter,
        lastUsedAt: new Date(),
        metadata: { ...(passkey.metadata || {}), lastFlags: parsed.flags, lastRpId: rpId },
      },
    });
  });

  return { user: passkey.user, passkey };
}

export async function disablePasskey({ userId, passkeyId }) {
  return prisma.accountPasskey.update({
    where: { id: passkeyId, userId },
    data: { disabledAt: new Date() },
  });
}
