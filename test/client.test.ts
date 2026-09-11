import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FastrelayApiError } from '../src/error.ts';
import { FastrelayClient } from '../src/client.ts';
import {
  buildFeedActivityQuery,
  resolveFeedTarget,
  splitFeedId,
  toAbsoluteUrl,
} from '../src/utils.ts';

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: any, init: any = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('toAbsoluteUrl builds query, skips null/undefined, expands arrays', () => {
  const url = toAbsoluteUrl('http://x.test/api', '/v1/things', {
    limit: 10,
    cursor: undefined,
    tags: ['a', 'b'],
    flag: false,
  });
  assert.equal(url, 'http://x.test/api/v1/things?limit=10&tags=a&tags=b&flag=false');
});

test('buildFeedActivityQuery flattens markRead and filter', () => {
  const query = buildFeedActivityQuery({
    limit: 5,
    markRead: ['a', 'b'],
    filter: { type: 'post' },
  });
  assert.deepEqual(query, { limit: 5, markRead: 'a,b', 'filter[type]': 'post' });
});

test('resolveFeedTarget and splitFeedId', () => {
  assert.equal(resolveFeedTarget('user:john'), 'user:john');
  assert.equal(resolveFeedTarget({ group: 'user', id: 'john' }), 'user:john');
  assert.throws(() => resolveFeedTarget({}), TypeError);
  assert.deepEqual(splitFeedId('user:john:doe'), ['user', 'john:doe']);
  assert.throws(() => splitFeedId('nope'), TypeError);
});

test('request sends bearer token, idempotency key and json body', async () => {
  const { fetch, calls } = fakeFetch(() => jsonResponse({ id: 'a1' }));
  const client = new FastrelayClient({
    apiKey: 'key',
    baseUrl: 'http://x.test',
    token: 'jwt-token',
    fetch,
  });

  const result = await client.addActivity(
    { type: 'post', text: 'hi' },
    { idempotencyKey: 'idem-1' },
  );

  assert.deepEqual(result, { id: 'a1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x.test/v1/activities');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer jwt-token');
  assert.equal(headers['idempotency-key'], 'idem-1');
  assert.equal(headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    type: 'post',
    text: 'hi',
  });
});

test('auth mode user without token throws before any request', async () => {
  const { fetch, calls } = fakeFetch(() => jsonResponse({}));
  const client = new FastrelayClient({ apiKey: 'key', fetch });
  await assert.rejects(
    client.getActivity('a1', { auth: 'user' }),
    /requires a user token/,
  );
  assert.equal(calls.length, 0);
});

test('error responses become FastrelayApiError with rate limit metadata', async () => {
  const { fetch } = fakeFetch(() =>
    jsonResponse(
      {
        error: { message: 'Nope', code: 'FORBIDDEN', hint: 'ask nicely' },
        requestId: 'req-9',
      },
      403,
      { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '60' },
    ),
  );
  const client = new FastrelayClient({ apiKey: 'key', fetch });

  await assert.rejects(client.getActivity('a1'), (error: unknown) => {
    assert.ok(error instanceof FastrelayApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, 'FORBIDDEN');
    assert.equal(error.message, 'Nope');
    assert.equal(error.hint, 'ask nicely');
    assert.equal(error.requestId, 'req-9');
    assert.equal(error.path, '/v1/activities/a1');
    assert.equal(error.method, 'GET');
    assert.deepEqual(error.rateLimit, { limit: 100, remaining: 0, reset: 60 });
    return true;
  });
});

test('empty body resolves to null', async () => {
  const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
  const client = new FastrelayClient({ apiKey: 'key', token: 't', fetch });
  assert.equal(await client.deleteActivity('a1'), null);
});

test('connectUser failure rolls back token and closes previous realtime socket', async () => {
  const closes: number[] = [];
  const socketFactory = () => ({
    send() {},
    close() {
      closes.push(1);
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  });
  const { fetch } = fakeFetch((url) =>
    url.endsWith('/v1/users')
      ? jsonResponse({ error: { message: 'boom' } }, 500)
      : jsonResponse({}),
  );
  const client = new FastrelayClient({
    apiKey: 'k',
    baseUrl: 'http://x.test',
    fetch,
    socketFactory,
  });

  await client.connectUser({ id: 'u1' }, 'token-1', { realtime: true });
  assert.ok(client.realtime);

  await assert.rejects(
    client.connectUser({ id: 'u2' }, 'token-2', { upsertUser: true }),
    /boom/,
  );
  // Old socket closed before the upsert; user/token rolled back on failure.
  assert.equal(closes.length, 1);
  assert.equal(client.token, 'token-1');
  assert.deepEqual(client.user, { id: 'u1' });
  assert.equal(client.realtime, undefined);
});

test('feed helpers hit the right paths', async () => {
  const { fetch, calls } = fakeFetch(() => jsonResponse({ data: [], hasMore: false }));
  const client = new FastrelayClient({ apiKey: 'key', token: 't', fetch });
  const feed = client.feed('user', 'john');

  await feed.getActivities({ limit: 10, filter: { type: 'post' } });
  assert.equal(
    calls[0].url,
    'https://api.fastrelay.io/v1/feeds/user/john/activities?limit=10&filter%5Btype%5D=post',
  );

  await feed.addActivity({ type: 'post', text: 'hi' });
  assert.deepEqual(JSON.parse(String(calls[1].init.body)).feeds, ['user:john']);

  await feed.unfollow('team:eng', { keepHistory: true });
  assert.equal(calls[2].init.method, 'DELETE');
  assert.equal(
    calls[2].url,
    'https://api.fastrelay.io/v1/feeds/user/john/follows/team:eng?keepHistory=true',
  );
});
