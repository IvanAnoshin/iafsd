const DEVICE_STORAGE_KEY = 'friendscape:e2ee:device:v2';
const DEVICE_LABEL = 'Friendscape Web';
const RECIPIENT_CACHE_TTL_MS = 30_000;
const recipientsCache = new Map();
const decryptedMessageCache = new Map();

function toBase64Url(bytes) {
  let binary = '';
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let index = 0; index < source.length; index += 1) {
    binary += String.fromCharCode(source[index]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const source = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = source.length % 4 === 0 ? '' : '='.repeat(4 - (source.length % 4));
  const binary = atob(source + padding);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function randomId(prefix = 'id') {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isValidLocalRecord(record) {
  return Boolean(
    record
    && typeof record === 'object'
    && record.deviceKeyId
    && record.identityPublicKey
    && record.identityPrivateKey
    && record.vaultKey
    && record.identityAlgorithm === 'ECDH_P256'
  );
}

function readStoredRecord() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidLocalRecord(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredRecord(record) {
  if (typeof window === 'undefined') return record;
  window.localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(record));
  recipientsCache.clear();
  decryptedMessageCache.clear();
  return record;
}

async function exportKeyToJson(key) {
  const jwk = await window.crypto.subtle.exportKey('jwk', key);
  return JSON.stringify(jwk);
}

async function importPrivateKey(jwkText) {
  const jwk = typeof jwkText === 'string' ? safeJsonParse(jwkText) : jwkText;
  if (!jwk) throw new Error('Локальный ключ устройства повреждён.');
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
}

async function importPublicKey(jwkText) {
  const jwk = typeof jwkText === 'string' ? safeJsonParse(jwkText) : jwkText;
  if (!jwk) throw new Error('Публичный ключ устройства повреждён.');
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function generateIdentityKeyPair() {
  if (!window?.crypto?.subtle) {
    throw new Error('Браузер не поддерживает Web Crypto API.');
  }
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits']
  );
  return {
    publicKey: await exportKeyToJson(keyPair.publicKey),
    privateKey: await exportKeyToJson(keyPair.privateKey),
    algorithm: 'ECDH_P256',
  };
}

async function deriveWrapKey(privateKey, publicKey) {
  const bits = await window.crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  return window.crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptAesGcm(rawKeyBytes, plaintextBytes, ivBytes) {
  const key = await window.crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, plaintextBytes);
  return new Uint8Array(ciphertext);
}

async function decryptAesGcm(rawKeyBytes, ciphertextBytes, ivBytes) {
  const key = await window.crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ciphertextBytes);
  return new Uint8Array(plaintext);
}

async function wrapContentKeyForRecipient(contentKeyBytes, publicKeyText) {
  const recipientPublicKey = await importPublicKey(publicKeyText);
  const ephemeralKeyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const wrapKey = await deriveWrapKey(ephemeralKeyPair.privateKey, recipientPublicKey);
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(iv);
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, contentKeyBytes);
  return {
    epk: await exportKeyToJson(ephemeralKeyPair.publicKey),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(encrypted)),
  };
}

async function unwrapContentKey(privateKey, envelope) {
  const peerPublicKey = await importPublicKey(envelope?.epk);
  const wrapKey = await deriveWrapKey(privateKey, peerPublicKey);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(envelope?.iv || '') },
    wrapKey,
    fromBase64Url(envelope?.ciphertext || '')
  );
  return new Uint8Array(decrypted);
}

async function fetchConversationRecipients(conversationId) {
  const cacheKey = String(conversationId || '').trim();
  if (!cacheKey) throw new Error('Не удалось определить чат для шифрования.');
  const cached = recipientsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const response = await fetch(`/api/chats/${cacheKey}/e2ee`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось получить ключи участников чата.');
  }
  recipientsCache.set(cacheKey, { payload, expiresAt: Date.now() + RECIPIENT_CACHE_TTL_MS });
  return payload;
}

export async function ensureLocalE2EERecord(options = {}) {
  const existing = readStoredRecord();
  if (existing) return existing;

  if (typeof window === 'undefined' || !window.crypto?.getRandomValues) {
    throw new Error('Браузер не поддерживает генерацию ключей для защищённых чатов.');
  }

  const identity = await generateIdentityKeyPair();
  const vaultKey = new Uint8Array(32);
  window.crypto.getRandomValues(vaultKey);

  const record = {
    version: 2,
    deviceKeyId: options.deviceKeyId || randomId('device'),
    deviceLabel: options.deviceLabel || DEVICE_LABEL,
    identityAlgorithm: identity.algorithm,
    identityPublicKey: identity.publicKey,
    identityPrivateKey: identity.privateKey,
    vaultKey: toBase64Url(vaultKey),
    createdAt: options.createdAt || new Date().toISOString(),
  };

  return writeStoredRecord(record);
}

export function getLocalE2EERecord() {
  return readStoredRecord();
}

export async function registerCurrentE2EEDevice(options = {}) {
  const record = options.record || await ensureLocalE2EERecord();
  const response = await fetch('/api/e2ee/device/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceKeyId: record.deviceKeyId,
      deviceLabel: record.deviceLabel,
      identityPublicKey: record.identityPublicKey,
      trustDevice: options.trustDevice === true,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось зарегистрировать защищённое устройство.');
  }
  return payload;
}

export async function prepareEncryptedMessagePayload(conversationId, text, options = {}) {
  const trimmed = String(text || '');
  if (!trimmed) return null;
  const allowPlaintextFallback = options.allowPlaintextFallback !== false;

  try {
    const record = await ensureLocalE2EERecord();
    const recipientsPayload = await fetchConversationRecipients(conversationId);
    const recipients = Array.isArray(recipientsPayload?.recipients) ? recipientsPayload.recipients : [];
    const missingRecipients = Array.isArray(recipientsPayload?.missing_user_ids) ? recipientsPayload.missing_user_ids : [];

    if (!recipients.length || missingRecipients.length) {
      if (allowPlaintextFallback) return null;
      if (!recipients.length) {
        throw new Error('Для этого чата ещё не подготовлены ключи защищённых устройств.');
      }
      throw new Error('Не все участники чата подготовили защищённые устройства.');
    }

    const contentKey = new Uint8Array(32);
    const contentIv = new Uint8Array(12);
    window.crypto.getRandomValues(contentKey);
    window.crypto.getRandomValues(contentIv);

    const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, text: trimmed }));
    const ciphertext = await encryptAesGcm(contentKey, plaintext, contentIv);

    const envelopeRecipients = {};
    for (const recipient of recipients) {
      if (!recipient?.public_key || recipient?.user_id == null) continue;
      envelopeRecipients[String(recipient.user_id)] = await wrapContentKeyForRecipient(contentKey, recipient.public_key);
    }

    if (!Object.keys(envelopeRecipients).length) {
      if (allowPlaintextFallback) return null;
      throw new Error('Не удалось подготовить ключи получателей для защищённого сообщения.');
    }

    return {
      text: '',
      localPlaintext: trimmed,
      encryption: {
        scheme: 'friendscape_ecdh_v1',
        senderDeviceId: record.deviceKeyId,
        ciphertext: JSON.stringify({
          version: 1,
          algorithm: 'AES-GCM',
          iv: toBase64Url(contentIv),
          ciphertext: toBase64Url(ciphertext),
        }),
        keyEnvelope: JSON.stringify({
          version: 1,
          algorithm: 'ECDH-P256+A256GCM',
          recipients: envelopeRecipients,
        }),
        contentHint: 'text',
      },
    };
  } catch (error) {
    if (allowPlaintextFallback) return null;
    throw error;
  }
}

function makeMessageCacheKey(message) {
  return String(message?.id || message?.client_id || '').trim();
}

export async function decryptMessagePayload(message) {
  if (!message?.is_encrypted && !message?.isEncrypted) return message;
  const key = makeMessageCacheKey(message);
  if (key && decryptedMessageCache.has(key)) {
    return { ...message, ...decryptedMessageCache.get(key) };
  }

  const encryption = message.encryption || {};
  const record = await ensureLocalE2EERecord();
  const privateKey = await importPrivateKey(record.identityPrivateKey);
  const ciphertextEnvelope = safeJsonParse(encryption.ciphertext || '', null);
  const keyEnvelope = safeJsonParse(encryption.key_envelope || encryption.keyEnvelope || '', null);
  const recipients = keyEnvelope?.recipients && typeof keyEnvelope.recipients === 'object' ? Object.values(keyEnvelope.recipients) : [];

  if (!ciphertextEnvelope?.ciphertext || !ciphertextEnvelope?.iv || !recipients.length) {
    return message;
  }

  let contentKey = null;
  for (const recipientEnvelope of recipients) {
    try {
      contentKey = await unwrapContentKey(privateKey, recipientEnvelope);
      if (contentKey) break;
    } catch {
      // try next envelope
    }
  }

  if (!contentKey) {
    return { ...message, decryption_error: true };
  }

  const plaintextBytes = await decryptAesGcm(
    contentKey,
    fromBase64Url(ciphertextEnvelope.ciphertext),
    fromBase64Url(ciphertextEnvelope.iv)
  );
  const decoded = safeJsonParse(new TextDecoder().decode(plaintextBytes), {});
  const patch = {
    text: typeof decoded?.text === 'string' ? decoded.text : message.text,
    preview_text: typeof decoded?.text === 'string' ? decoded.text : (message.preview_text || message.text),
    decrypted_locally: true,
    decryption_error: false,
    can_copy: Boolean(typeof decoded?.text === 'string' ? decoded.text.trim() : String(message.text || '').trim()),
  };
  if (key) decryptedMessageCache.set(key, patch);
  return { ...message, ...patch };
}

export async function decryptConversationItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(list.map((item) => decryptMessagePayload(item).catch(() => item)));
}

export async function createRecoveryBundle() {
  const record = await ensureLocalE2EERecord();
  if (!window?.crypto?.subtle) {
    throw new Error('Браузер не поддерживает создание recovery-файла.');
  }

  const backupKey = new Uint8Array(32);
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(backupKey);
  window.crypto.getRandomValues(iv);

  const secretPayload = {
    version: 2,
    identityAlgorithm: record.identityAlgorithm,
    identityPublicKey: record.identityPublicKey,
    identityPrivateKey: record.identityPrivateKey,
    vaultKey: record.vaultKey,
    createdAt: record.createdAt,
  };

  const encrypted = await encryptAesGcm(
    backupKey,
    new TextEncoder().encode(JSON.stringify(secretPayload)),
    iv
  );

  const encryptedBlob = JSON.stringify({
    version: 1,
    algorithm: 'AES-GCM',
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(encrypted),
    createdAt: new Date().toISOString(),
  });

  const recoveryFile = {
    version: 1,
    type: 'friendscape_e2ee_recovery',
    backupKey: toBase64Url(backupKey),
    createdAt: new Date().toISOString(),
    note: 'Храните этот файл отдельно от устройства. Без него старые защищённые чаты не восстановятся.',
  };

  return {
    encryptedBlob,
    recoveryFile,
    metadata: {
      deviceKeyId: record.deviceKeyId,
      format: 'friendscape_e2ee_recovery_v1',
      source: 'browser_local_v2',
      createdAt: recoveryFile.createdAt,
    },
  };
}

export async function saveRecoveryBundleToServer(bundle) {
  const response = await fetch('/api/e2ee/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      encryptedBlob: bundle.encryptedBlob,
      metadata: bundle.metadata,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось сохранить recovery-файл на сервере.');
  }
  return payload;
}

export function downloadRecoveryFile(bundle) {
  const content = JSON.stringify(bundle.recoveryFile, null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `friendscape-recovery-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function restoreLocalE2EEFromRecoveryFile(recoveryFile, encryptedBlob) {
  const parsedRecovery = typeof recoveryFile === 'string' ? safeJsonParse(recoveryFile) : recoveryFile;
  const parsedBlob = typeof encryptedBlob === 'string' ? safeJsonParse(encryptedBlob) : encryptedBlob;
  if (!parsedRecovery?.backupKey) {
    throw new Error('Recovery file повреждён или не подходит для восстановления.');
  }
  if (!parsedBlob?.ciphertext || !parsedBlob?.iv) {
    throw new Error('На сервере не найден зашифрованный backup ключей.');
  }

  const backupKey = fromBase64Url(parsedRecovery.backupKey);
  const plaintextBytes = await decryptAesGcm(
    backupKey,
    fromBase64Url(parsedBlob.ciphertext),
    fromBase64Url(parsedBlob.iv)
  );
  const payload = safeJsonParse(new TextDecoder().decode(plaintextBytes), null);
  if (!payload?.identityPublicKey || !payload?.identityPrivateKey || !payload?.vaultKey) {
    throw new Error('Recovery file не смог восстановить локальные ключи чата.');
  }

  const nextRecord = {
    version: 2,
    deviceKeyId: randomId('device'),
    deviceLabel: DEVICE_LABEL,
    identityAlgorithm: payload.identityAlgorithm || 'ECDH_P256',
    identityPublicKey: payload.identityPublicKey,
    identityPrivateKey: payload.identityPrivateKey,
    vaultKey: payload.vaultKey,
    createdAt: new Date().toISOString(),
  };

  return writeStoredRecord(nextRecord);
}


export async function loadE2EETransferState(deviceKeyId = '') {
  const query = deviceKeyId ? `?deviceKeyId=${encodeURIComponent(deviceKeyId)}` : '';
  const response = await fetch(`/api/e2ee/transfer${query}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось получить статус переноса устройства.');
  }
  return payload.transfer || null;
}

export async function requestE2EEDeviceTransfer(options = {}) {
  const record = options.record || await ensureLocalE2EERecord();
  const response = await fetch('/api/e2ee/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create_request',
      targetDeviceKeyId: record.deviceKeyId,
      targetDeviceLabel: record.deviceLabel,
      targetDevicePublicKey: record.identityPublicKey,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось запросить перенос со старого устройства.');
  }
  return payload;
}

async function createDeviceTransferPackage(targetPublicKey, sourceRecord) {
  const transferKey = new Uint8Array(32);
  const iv = new Uint8Array(12);
  window.crypto.getRandomValues(transferKey);
  window.crypto.getRandomValues(iv);

  const secretPayload = {
    version: 2,
    identityAlgorithm: sourceRecord.identityAlgorithm,
    identityPublicKey: sourceRecord.identityPublicKey,
    identityPrivateKey: sourceRecord.identityPrivateKey,
    vaultKey: sourceRecord.vaultKey,
    createdAt: sourceRecord.createdAt,
  };

  const ciphertext = await encryptAesGcm(
    transferKey,
    new TextEncoder().encode(JSON.stringify(secretPayload)),
    iv
  );

  return {
    version: 1,
    algorithm: 'friendscape_device_transfer_v1',
    sourceDeviceKeyId: sourceRecord.deviceKeyId,
    createdAt: new Date().toISOString(),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
    wrappedKey: await wrapContentKeyForRecipient(transferKey, targetPublicKey),
  };
}

export async function approveE2EEDeviceTransfer(request) {
  const sourceRecord = await ensureLocalE2EERecord();
  if (!request?.id || !request?.target_device_public_key) {
    throw new Error('Запрос на перенос устройства повреждён.');
  }
  const transferPackage = await createDeviceTransferPackage(request.target_device_public_key, sourceRecord);
  const response = await fetch('/api/e2ee/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve_request',
      requestId: request.id,
      approverDeviceKeyId: sourceRecord.deviceKeyId,
      transferPackage,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось подтвердить перенос на новое устройство.');
  }
  return payload;
}

export async function restoreLocalE2EEFromTransferPackage(transferRequest) {
  const parsedPackage = safeJsonParse(JSON.stringify(transferRequest?.transfer_package || {}), null);
  if (!parsedPackage?.ciphertext || !parsedPackage?.iv || !parsedPackage?.wrappedKey) {
    throw new Error('На сервере ещё нет зашифрованного пакета переноса для этого устройства.');
  }

  const currentRecord = await ensureLocalE2EERecord();
  const privateKey = await importPrivateKey(currentRecord.identityPrivateKey);
  const transferKey = await unwrapContentKey(privateKey, parsedPackage.wrappedKey);
  const plaintextBytes = await decryptAesGcm(
    transferKey,
    fromBase64Url(parsedPackage.ciphertext),
    fromBase64Url(parsedPackage.iv)
  );
  const payload = safeJsonParse(new TextDecoder().decode(plaintextBytes), null);
  if (!payload?.identityPublicKey || !payload?.identityPrivateKey || !payload?.vaultKey) {
    throw new Error('Пакет переноса не смог восстановить ключи защищённых чатов.');
  }

  const nextRecord = {
    version: 2,
    deviceKeyId: currentRecord.deviceKeyId,
    deviceLabel: currentRecord.deviceLabel || DEVICE_LABEL,
    identityAlgorithm: payload.identityAlgorithm || 'ECDH_P256',
    identityPublicKey: payload.identityPublicKey,
    identityPrivateKey: payload.identityPrivateKey,
    vaultKey: payload.vaultKey,
    createdAt: new Date().toISOString(),
  };

  return writeStoredRecord(nextRecord);
}

export async function completeE2EEDeviceTransfer(requestId, targetDeviceKeyId) {
  const response = await fetch('/api/e2ee/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'complete_request',
      requestId,
      targetDeviceKeyId,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Не удалось завершить перенос устройства.');
  }
  return payload;
}
