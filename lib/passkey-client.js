'use client';

function bufferToBase64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToBuffer(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function ensurePasskeySupport() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('Этот браузер не поддерживает passkey/WebAuthn.');
  }
}

function prepareCreationOptions(publicKey) {
  return {
    ...publicKey,
    challenge: base64urlToBuffer(publicKey.challenge),
    user: {
      ...publicKey.user,
      id: base64urlToBuffer(publicKey.user.id),
    },
    excludeCredentials: (publicKey.excludeCredentials || []).map((item) => ({
      ...item,
      id: base64urlToBuffer(item.id),
    })),
  };
}

function prepareRequestOptions(publicKey) {
  return {
    ...publicKey,
    challenge: base64urlToBuffer(publicKey.challenge),
    allowCredentials: (publicKey.allowCredentials || []).map((item) => ({
      ...item,
      id: base64urlToBuffer(item.id),
    })),
  };
}

function serializeAttestationCredential(credential) {
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      attestationObject: bufferToBase64url(credential.response.attestationObject),
      transports: typeof credential.response.getTransports === 'function' ? credential.response.getTransports() : [],
    },
  };
}

function serializeAssertionCredential(credential) {
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment || null,
    response: {
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      authenticatorData: bufferToBase64url(credential.response.authenticatorData),
      signature: bufferToBase64url(credential.response.signature),
      userHandle: credential.response.userHandle ? bufferToBase64url(credential.response.userHandle) : null,
    },
  };
}

export async function registerPasskey({ password, label }) {
  ensurePasskeySupport();
  const optionsResponse = await fetch('/api/auth/passkeys/register/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, label }),
  });
  const optionsPayload = await optionsResponse.json().catch(() => ({}));
  if (!optionsResponse.ok) throw new Error(optionsPayload.error || 'Не удалось начать регистрацию passkey.');

  const credential = await navigator.credentials.create({
    publicKey: prepareCreationOptions(optionsPayload.publicKey),
  });
  if (!credential) throw new Error('Passkey-регистрация отменена.');

  const verifyResponse = await fetch('/api/auth/passkeys/register/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id: optionsPayload.challenge_id,
      label,
      credential: serializeAttestationCredential(credential),
    }),
  });
  const verifyPayload = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok) throw new Error(verifyPayload.error || 'Не удалось сохранить passkey.');
  return verifyPayload;
}

export async function authenticateWithPasskey({ firstName, lastName }) {
  ensurePasskeySupport();
  const optionsResponse = await fetch('/api/auth/passkeys/authenticate/options', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first_name: firstName, last_name: lastName }),
  });
  const optionsPayload = await optionsResponse.json().catch(() => ({}));
  if (!optionsResponse.ok) throw new Error(optionsPayload.error || 'Не удалось начать вход по passkey.');

  const credential = await navigator.credentials.get({
    publicKey: prepareRequestOptions(optionsPayload.publicKey),
  });
  if (!credential) throw new Error('Вход по passkey отменён.');

  const verifyResponse = await fetch('/api/auth/passkeys/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id: optionsPayload.challenge_id,
      credential: serializeAssertionCredential(credential),
      device_context: {
        screen_width: window.screen?.width ?? null,
        screen_height: window.screen?.height ?? null,
        hardware_concurrency: navigator.hardwareConcurrency ?? null,
        device_memory: navigator.deviceMemory ?? null,
        platform: navigator.platform ?? null,
      },
    }),
  });
  const verifyPayload = await verifyResponse.json().catch(() => ({}));
  if (!verifyResponse.ok) throw new Error(verifyPayload.error || 'Не удалось войти по passkey.');
  return verifyPayload;
}
