#!/usr/bin/env node
import process from 'node:process';

const BASE_URL = String(process.env.FRIENDSCAPE_SMOKE_BASE_URL || process.env.APP_PUBLIC_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PASSWORD = process.env.FRIENDSCAPE_SMOKE_PASSWORD || 'SmokePass123!';
const PREFIX = process.env.FRIENDSCAPE_SMOKE_PREFIX || `Smoke${Date.now().toString(36)}`;

const steps = [];

function logStep(name) {
  steps.push({ name, ok: true });
  console.log(`✓ ${name}`);
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function cookiePartsFromHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  if (!single) return [];
  return single.split(/,(?=\s*[^;,=]+=[^;,]+)/g).map((item) => item.trim()).filter(Boolean);
}

class SmokeClient {
  constructor(name) {
    this.name = name;
    this.cookies = new Map();
    this.csrfToken = '';
  }

  absorbCookies(headers) {
    for (const raw of cookiePartsFromHeaders(headers)) {
      const pair = raw.split(';')[0] || '';
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (!value) this.cookies.delete(key);
      else this.cookies.set(key, value);
      if (key === 'fs_csrf') this.csrfToken = value;
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(path, { method = 'GET', body, expected = [200], csrf = true } = {}) {
    const headers = {
      Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
      Origin: BASE_URL,
      'User-Agent': `FriendscapeSmoke/${this.name}`,
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf && this.csrfToken && !['GET', 'HEAD'].includes(method.toUpperCase())) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.absorbCookies(response.headers);

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');

    const expectedList = Array.isArray(expected) ? expected : [expected];
    if (!expectedList.includes(response.status)) {
      const details = typeof payload === 'string' ? payload.slice(0, 220) : JSON.stringify(payload);
      throw new Error(`${method} ${path} returned ${response.status}, expected ${expectedList.join('/')} — ${details}`);
    }
    return { status: response.status, payload, response };
  }

  async csrf() {
    const { payload } = await this.request('/api/auth/csrf', { expected: 200, csrf: false });
    this.csrfToken = payload?.csrfToken || this.csrfToken;
    return this.csrfToken;
  }
}

function userNames(label) {
  return {
    first_name: `${PREFIX}${label}`.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, '').slice(0, 24),
    last_name: 'Tester',
    password: PASSWORD,
  };
}

async function registerUser(label) {
  const client = new SmokeClient(label);
  const names = userNames(label);

  const started = await client.request('/api/auth/register/start', {
    method: 'POST',
    csrf: false,
    expected: 200,
    body: {
      ...names,
      confirm_password: PASSWORD,
    },
  });
  const registrationId = started.payload.registration_id;
  assert(registrationId, 'registration_id was not returned');

  await client.request('/api/auth/register/secret', {
    method: 'POST',
    csrf: false,
    expected: 200,
    body: { registration_id: registrationId, secret_answer: `secret-${PREFIX}-${label}` },
  });

  const dfsn = await client.request('/api/auth/register/dfsn/start', {
    method: 'POST',
    csrf: false,
    expected: 200,
    body: { registration_id: registrationId, route: '/register/dfsn', screen: 'smoke' },
  });
  const dfsnSessionId = dfsn.payload.dfsn_session_id;
  assert(dfsnSessionId, 'dfsn_session_id was not returned');

  await client.request('/api/auth/register/dfsn/finish', {
    method: 'POST',
    csrf: false,
    expected: 200,
    body: { registration_id: registrationId, dfsn_session_id: dfsnSessionId },
  });

  const completed = await client.request('/api/auth/register/complete', {
    method: 'POST',
    csrf: false,
    expected: 200,
    body: { registration_id: registrationId },
  });
  assert(completed.payload?.user?.id, 'registered user id was not returned');
  await client.csrf();

  return { client, names, user: completed.payload.user, backupCodes: completed.payload.backup_codes || [] };
}

async function smokeAuth() {
  const account = await registerUser('A');
  await account.client.request('/api/me', { expected: 200 });
  await account.client.request('/recover/phrase', { expected: [200, 307, 308] });
  await account.client.request('/api/auth/passkeys', { expected: 200 });
  await account.client.request('/api/auth/security/recovery-phrase', {
    method: 'POST',
    expected: 200,
    body: { password: PASSWORD },
  });
  await account.client.request('/api/auth/logout', { method: 'POST', expected: 200 });

  await account.client.request('/api/auth/login', {
    method: 'POST',
    csrf: false,
    expected: 200,
    body: {
      first_name: account.names.first_name,
      last_name: account.names.last_name,
      password: PASSWORD,
    },
  });
  await account.client.csrf();
  await account.client.request('/api/me', { expected: 200 });
  logStep('auth: register, recovery page, passkeys API, recovery phrase, logout, login');
  return account;
}

async function smokeFeed(account) {
  const created = await account.client.request('/api/feed/posts', {
    method: 'POST',
    expected: 201,
    body: { text: `Smoke post ${PREFIX}`, visibility: 'public' },
  });
  const postId = created.payload?.post?.id;
  assert(postId, 'created post id was not returned');

  await account.client.request(`/api/feed/posts/${postId}`, {
    method: 'PUT',
    expected: 200,
    body: { text: `Smoke post edited ${PREFIX}`, visibility: 'public' },
  });
  await account.client.request(`/api/posts/${postId}/like`, { method: 'POST', expected: 200, body: {} });
  await account.client.request(`/api/posts/${postId}/comments`, {
    method: 'POST',
    expected: 201,
    body: { text: `Smoke comment ${PREFIX}` },
  });
  await account.client.request(`/api/feed/posts/${postId}`, { method: 'DELETE', expected: 200 });
  logStep('feed: create, edit, like, comment, delete');
  return { postId };
}

async function smokeChat(accountA, accountB) {
  const direct = await accountA.client.request('/api/chats/direct', {
    method: 'POST',
    expected: 200,
    body: { target_user_id: accountB.user.id },
  });
  const conversationId = direct.payload?.conversation?.id;
  assert(conversationId, 'conversation id was not returned');

  const sent = await accountA.client.request(`/api/chats/${conversationId}/messages`, {
    method: 'POST',
    expected: 201,
    body: { text: `Smoke message ${PREFIX}` },
  });
  const messageId = sent.payload?.message?.id;
  assert(messageId, 'message id was not returned');

  await accountB.client.request(`/api/chats/${conversationId}/messages`, { expected: 200 });
  await accountB.client.request(`/api/messages/${messageId}/report`, {
    method: 'POST',
    expected: 201,
    body: { reason: 'smoke_test', details: 'Automated smoke report' },
  });
  await accountA.client.request('/api/messages/delete/batch', {
    method: 'DELETE',
    expected: 200,
    body: { messageIds: [messageId] },
  });
  logStep('chat: direct dialog, send, read, report, delete selected message');
}

async function smokeCommunities(accountA, accountB) {
  const publicCommunity = await accountA.client.request('/api/communities', {
    method: 'POST',
    expected: 201,
    body: {
      name: `Smoke Public ${PREFIX}`,
      slug: `smoke-public-${PREFIX}`,
      description: 'Public smoke community',
      visibility: 'public',
      rules: ['Be kind'],
    },
  });
  const publicSlug = publicCommunity.payload?.community?.slug;
  assert(publicSlug, 'public community slug was not returned');

  await accountA.client.request(`/api/communities/${publicSlug}/posts`, {
    method: 'POST',
    expected: 201,
    body: { text: `Smoke community post ${PREFIX}` },
  });
  await accountB.client.request(`/api/communities/${publicSlug}/membership`, {
    method: 'POST',
    expected: 200,
    body: { action: 'join' },
  });
  await accountB.client.request(`/api/communities/${publicSlug}/membership`, {
    method: 'POST',
    expected: 200,
    body: { action: 'leave' },
  });

  const closedCommunity = await accountA.client.request('/api/communities', {
    method: 'POST',
    expected: 201,
    body: {
      name: `Smoke Closed ${PREFIX}`,
      slug: `smoke-closed-${PREFIX}`,
      description: 'Closed smoke community',
      visibility: 'closed',
      rules: ['Requests only'],
    },
  });
  const closedSlug = closedCommunity.payload?.community?.slug;
  assert(closedSlug, 'closed community slug was not returned');

  await accountB.client.request(`/api/communities/${closedSlug}/membership`, {
    method: 'POST',
    expected: 200,
    body: { action: 'join', message: 'Smoke join request' },
  });
  const requests = await accountA.client.request(`/api/communities/${closedSlug}/requests`, { expected: 200 });
  const requestId = requests.payload?.requests?.[0]?.id;
  assert(requestId, 'join request id was not returned');

  await accountA.client.request(`/api/communities/${closedSlug}/requests/${requestId}`, {
    method: 'PATCH',
    expected: 200,
    body: { decision: 'approve' },
  });
  logStep('communities: create, post, join/leave, closed request, approve');
}

async function smokeNotifications(account) {
  await account.client.request('/api/notifications', { expected: 200 });
  await account.client.request('/api/notifications/read-all', { method: 'PUT', expected: 200, body: {} });
  logStep('notifications: list and mark all read');
}

async function main() {
  console.log(`Friendscape smoke base: ${BASE_URL}`);
  console.log(`Smoke prefix: ${PREFIX}`);

  const health = new SmokeClient('health');
  await health.request('/api/ready', { expected: [200, 503] });

  const accountA = await smokeAuth();
  const accountB = await registerUser('B');
  logStep('auth: second user registered for relational smoke');

  await smokeFeed(accountA);
  await smokeChat(accountA, accountB);
  await smokeCommunities(accountA, accountB);
  await smokeNotifications(accountA);

  console.log('\nSmoke result: OK');
  console.log(`Completed steps: ${steps.length}`);
}

main().catch((error) => {
  console.error('\nSmoke result: FAILED');
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
