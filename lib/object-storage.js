import crypto from 'node:crypto';

const DEFAULT_REGION = 'auto';
const DEFAULT_SERVICE = 's3';

function clipSlash(value = '') {
  return String(value || '').trim().replace(/\/+$/g, '');
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function intEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

function hmac(key, value, output) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest(output);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function dateStamp(date = new Date()) {
  return amzDate(date).slice(0, 8);
}

function encodeSegment(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function encodeObjectKey(key = '') {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map(encodeSegment)
    .join('/');
}

function normalizeObjectKey(key = '') {
  return String(key || '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'r2' || raw === 'cloudflare-r2') return 'r2';
  if (raw === 'yandex' || raw === 'yandex-s3' || raw === 'yc') return 'yandex';
  if (raw === 'object' || raw === 's3' || raw === 's3-compatible') return 's3';
  return raw || 'local';
}

export function getObjectStorageConfig(prefix = 'COMMUNITY_MEDIA') {
  const provider = normalizeProvider(process.env[`${prefix}_STORAGE`] || process.env.STORAGE_PROVIDER || 'local');
  const endpoint = clipSlash(process.env[`${prefix}_S3_ENDPOINT`] || process.env[`${prefix}_ENDPOINT`] || process.env.STORAGE_ENDPOINT || '');
  const bucket = String(process.env[`${prefix}_S3_BUCKET`] || process.env[`${prefix}_BUCKET`] || process.env.STORAGE_BUCKET || '').trim();
  const region = String(process.env[`${prefix}_S3_REGION`] || process.env[`${prefix}_REGION`] || process.env.STORAGE_REGION || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const accessKeyId = String(process.env[`${prefix}_S3_ACCESS_KEY_ID`] || process.env[`${prefix}_ACCESS_KEY_ID`] || process.env.STORAGE_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env[`${prefix}_S3_SECRET_ACCESS_KEY`] || process.env[`${prefix}_SECRET_ACCESS_KEY`] || process.env.STORAGE_SECRET_ACCESS_KEY || '').trim();
  const publicBaseUrl = clipSlash(process.env[`${prefix}_PUBLIC_BASE_URL`] || process.env.STORAGE_PUBLIC_BASE_URL || '');
  const forcePathStyle = boolEnv(`${prefix}_S3_FORCE_PATH_STYLE`, boolEnv('STORAGE_FORCE_PATH_STYLE', true));
  const privateAccess = boolEnv(`${prefix}_PRIVATE`, boolEnv('STORAGE_PRIVATE', !publicBaseUrl));
  const signedReadTtlSeconds = intEnv(`${prefix}_SIGNED_READ_TTL_SECONDS`, intEnv('STORAGE_SIGNED_READ_TTL_SECONDS', 300));
  const cacheControl = String(process.env[`${prefix}_CACHE_CONTROL`] || process.env.STORAGE_CACHE_CONTROL || 'public, max-age=31536000, immutable').trim();

  return {
    provider,
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    forcePathStyle,
    privateAccess,
    signedReadTtlSeconds,
    cacheControl,
    service: DEFAULT_SERVICE,
    enabled: ['s3', 'r2', 'yandex'].includes(provider),
  };
}

export function assertObjectStorageConfig(config) {
  if (!config?.enabled) return;
  const missing = [];
  if (!config.endpoint) missing.push('endpoint');
  if (!config.bucket) missing.push('bucket');
  if (!config.accessKeyId) missing.push('access_key_id');
  if (!config.secretAccessKey) missing.push('secret_access_key');
  if (missing.length) {
    throw Object.assign(new Error(`Не настроено объектное хранилище: ${missing.join(', ')}.`), { status: 500, code: 'OBJECT_STORAGE_CONFIG_MISSING' });
  }
}

function credentialsScope(config, date) {
  return `${date}/${config.region}/${config.service}/aws4_request`;
}

function signingKey(config, date) {
  const kDate = hmac(`AWS4${config.secretAccessKey}`, date);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, config.service);
  return hmac(kService, 'aws4_request');
}

function canonicalQuery(query = {}) {
  return Object.entries(query)
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])
    .map(([key, value]) => [encodeSegment(key), encodeSegment(value)])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function canonicalHeaders(headers = {}) {
  const entries = Object.entries(headers)
    .map(([key, value]) => [String(key).toLowerCase().trim(), String(value).trim().replace(/\s+/g, ' ')])
    .filter(([key]) => Boolean(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    canonical: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signed: entries.map(([key]) => key).join(';'),
  };
}

function requestTarget(config, key) {
  assertObjectStorageConfig(config);
  const endpoint = new URL(config.endpoint);
  const encodedKey = encodeObjectKey(normalizeObjectKey(key));
  if (!config.forcePathStyle) {
    const host = `${config.bucket}.${endpoint.host}`;
    const pathname = `/${encodedKey}`;
    return { url: `${endpoint.protocol}//${host}${pathname}`, host, pathname };
  }
  const basePath = endpoint.pathname.replace(/\/+$/g, '');
  const pathname = `${basePath}/${encodeSegment(config.bucket)}/${encodedKey}`.replace(/\/+/g, '/');
  return { url: `${endpoint.protocol}//${endpoint.host}${pathname}`, host: endpoint.host, pathname };
}

function authorizationHeader({ method, key, config, headers, query = {}, payloadHash, now = new Date() }) {
  const amz = amzDate(now);
  const stamp = dateStamp(now);
  const scope = credentialsScope(config, stamp);
  const { canonical, signed } = canonicalHeaders(headers);
  const target = requestTarget(config, key);
  const canonicalRequest = [
    method,
    target.pathname,
    canonicalQuery(query),
    canonical,
    signed,
    payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amz,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signature = hmac(signingKey(config, stamp), stringToSign, 'hex');
  return {
    amz,
    signature,
    signedHeaders: signed,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    target,
  };
}

export function getObjectPublicUrl(key, config = getObjectStorageConfig()) {
  const normalizedKey = normalizeObjectKey(key);
  if (config.publicBaseUrl) return `${config.publicBaseUrl}/${encodeObjectKey(normalizedKey)}`;
  const target = requestTarget(config, normalizedKey);
  return target.url;
}

export function getObjectStorageKeyFromPublicUrl(url, config = getObjectStorageConfig()) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  if (config.publicBaseUrl && raw.startsWith(`${config.publicBaseUrl}/`)) {
    return decodeURIComponent(raw.slice(config.publicBaseUrl.length + 1));
  }
  return null;
}

export async function putObject({ key, body, contentType = 'application/octet-stream', cacheControl, config = getObjectStorageConfig() }) {
  const normalizedKey = normalizeObjectKey(key);
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const payloadHash = sha256Hex(buffer);
  const now = new Date();
  const target = requestTarget(config, normalizedKey);
  const headers = {
    host: target.host,
    'content-type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate(now),
    ...(cacheControl ? { 'cache-control': cacheControl } : {}),
  };
  const signed = authorizationHeader({ method: 'PUT', key: normalizedKey, config, headers, payloadHash, now });
  const response = await fetch(target.url, {
    method: 'PUT',
    headers: { ...headers, authorization: signed.authorization },
    body: buffer,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Не удалось загрузить файл в объектное хранилище (${response.status}).`), { status: 502, detail: detail.slice(0, 500) });
  }
  return { key: normalizedKey, bytes: buffer.length, etag: response.headers.get('etag') };
}


function decodeXmlText(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlTagValue(block = '', tag = '') {
  const match = String(block || '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXmlText(match[1]) : '';
}

function parseListObjectsXml(xml = '') {
  const text = String(xml || '');
  const contents = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => {
    const block = match[1] || '';
    const size = Number(xmlTagValue(block, 'Size'));
    return {
      key: xmlTagValue(block, 'Key'),
      lastModified: xmlTagValue(block, 'LastModified') || null,
      size: Number.isFinite(size) ? size : null,
      etag: xmlTagValue(block, 'ETag').replace(/^"|"$/g, '') || null,
    };
  }).filter((item) => item.key);
  const truncated = xmlTagValue(text, 'IsTruncated') === 'true';
  const nextContinuationToken = xmlTagValue(text, 'NextContinuationToken') || null;
  return { contents, truncated, nextContinuationToken };
}

export async function deleteObject({ key, config = getObjectStorageConfig() }) {
  const normalizedKey = normalizeObjectKey(key);
  const payloadHash = sha256Hex(Buffer.alloc(0));
  const now = new Date();
  const target = requestTarget(config, normalizedKey);
  const headers = {
    host: target.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate(now),
  };
  const signed = authorizationHeader({ method: 'DELETE', key: normalizedKey, config, headers, payloadHash, now });
  const response = await fetch(target.url, { method: 'DELETE', headers: { ...headers, authorization: signed.authorization } });
  if (response.status === 404) return { deleted: false, missing: true, key: normalizedKey };
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`Не удалось удалить файл из объектного хранилища (${response.status}).`), { status: 502, detail: detail.slice(0, 500) });
  }
  return { deleted: true, key: normalizedKey };
}

export function createPresignedGetUrl({ key, ttlSeconds, config = getObjectStorageConfig() }) {
  const normalizedKey = normalizeObjectKey(key);
  const now = new Date();
  const amz = amzDate(now);
  const stamp = dateStamp(now);
  const scope = credentialsScope(config, stamp);
  const target = requestTarget(config, normalizedKey);
  const headers = { host: target.host };
  const ttl = Math.max(30, Math.min(Number(ttlSeconds || config.signedReadTtlSeconds || 300), 60 * 60 * 24));
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(ttl),
    'X-Amz-SignedHeaders': 'host',
  };
  const { canonical, signed } = canonicalHeaders(headers);
  const canonicalRequest = [
    'GET',
    target.pathname,
    canonicalQuery(query),
    canonical,
    signed,
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(config, stamp), stringToSign, 'hex');
  return `${target.url}?${canonicalQuery({ ...query, 'X-Amz-Signature': signature })}`;
}


export async function listObjects({ prefix = '', maxKeys = 1000, config = getObjectStorageConfig() }) {
  assertObjectStorageConfig(config);
  const normalizedPrefix = normalizeObjectKey(prefix);
  const objects = [];
  let continuationToken = null;
  do {
    const query = {
      'list-type': '2',
      'max-keys': String(Math.max(1, Math.min(Number(maxKeys) || 1000, 1000))),
      ...(normalizedPrefix ? { prefix: normalizedPrefix } : {}),
      ...(continuationToken ? { 'continuation-token': continuationToken } : {}),
    };
    const payloadHash = sha256Hex(Buffer.alloc(0));
    const now = new Date();
    const target = requestTarget(config, '');
    const headers = {
      host: target.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate(now),
    };
    const signed = authorizationHeader({ method: 'GET', key: '', config, headers, query, payloadHash, now });
    const response = await fetch(`${target.url}?${canonicalQuery(query)}`, { method: 'GET', headers: { ...headers, authorization: signed.authorization } });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw Object.assign(new Error(`Не удалось получить список объектов (${response.status}).`), { status: 502, detail: detail.slice(0, 500) });
    }
    const xml = await response.text();
    const parsed = parseListObjectsXml(xml);
    objects.push(...parsed.contents);
    continuationToken = parsed.truncated ? parsed.nextContinuationToken : null;
  } while (continuationToken);
  return objects;
}
