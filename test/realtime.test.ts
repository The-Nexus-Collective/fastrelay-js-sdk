import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FastrelayClient } from '../src/client.ts';
import {
  FastrelayRealtime,
  type FastrelayRealtimeSocket,
} from '../src/realtime.ts';

class FakeSocket implements FastrelayRealtimeSocket {
  sent: string[] = [];
  closed = false;
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function setup() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const client = new FastrelayClient({ apiKey: 'k', baseUrl: 'https://api.test' });
  const realtime = new FastrelayRealtime({
    client,
    token: 'jwt',
    socketFactory: (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    subscribeDebounceMs: 5,
    reconnectInitialDelayMs: 5,
    reconnectMaxDelayMs: 10,
  });
  return { client, realtime, sockets, urls };
}

test('connects with wss url and batches feed subscriptions', async () => {
  const { realtime, sockets, urls } = setup();
  realtime.connect();
  await wait(1);

  assert.equal(urls[0], 'wss://api.test/v1/realtime?token=jwt');

  const events: string[] = [];
  realtime.subscribeToFeed('user:john', (e) => events.push(e.type));
  realtime.subscribeToFeed('team:eng', () => {});

  sockets[0].open();
  await wait(20);

  const subscribe = JSON.parse(sockets[0].sent[0]);
  assert.deepEqual(subscribe, { type: 'subscribe', feeds: ['team:eng', 'user:john'] });

  sockets[0].receive({
    type: 'activity.created',
    feedId: 'user:john',
    eventId: 'e1',
    data: { activityId: 'a1' },
  });
  // Duplicate eventId dropped.
  sockets[0].receive({
    type: 'activity.created',
    feedId: 'user:john',
    eventId: 'e1',
    data: { activityId: 'a1' },
  });
  assert.deepEqual(events, ['activity.created']);

  realtime.dispose();
});

test('type filter and unsubscribe send unsubscribe frame', async () => {
  const { realtime, sockets } = setup();
  realtime.connect();
  await wait(1);
  sockets[0].open();

  const seen: string[] = [];
  const off = realtime.subscribeToFeed('user:john', (e) => seen.push(e.type), {
    type: 'comment.created',
  });
  await wait(20);

  sockets[0].receive({ type: 'activity.created', feedId: 'user:john', eventId: 'x1', data: {} });
  sockets[0].receive({ type: 'comment.created', feedId: 'user:john', eventId: 'x2', data: {} });
  assert.deepEqual(seen, ['comment.created']);

  off();
  await wait(20);
  const frames = sockets[0].sent.map((raw) => JSON.parse(raw));
  assert.deepEqual(frames.at(-1), { type: 'unsubscribe', feeds: ['user:john'] });

  realtime.dispose();
});

test('reconnects after drop and resubscribes desired feeds', async () => {
  const { realtime, sockets } = setup();
  const states: string[] = [];
  realtime.onStateChange((s) => states.push(s));
  realtime.connect();
  await wait(1);
  realtime.subscribeToFeed('user:john', () => {});
  sockets[0].open();
  await wait(20);

  sockets[0].onclose?.({ code: 1006, reason: 'dropped' });
  await wait(30);

  assert.equal(sockets.length, 2);
  sockets[1].open();
  await wait(5);
  assert.deepEqual(JSON.parse(sockets[1].sent[0]), {
    type: 'subscribe',
    feeds: ['user:john'],
  });
  assert.ok(states.includes('reconnecting'));
  assert.equal(realtime.connectionState, 'connected');

  realtime.dispose();
});

test('close code 4002 is fatal, no reconnect', async () => {
  const { realtime, sockets } = setup();
  const errors: string[] = [];
  realtime.onError((e) => errors.push(e.code));
  realtime.connect();
  await wait(1);
  sockets[0].open();
  sockets[0].onclose?.({ code: 4002, reason: 'bad token' });
  await wait(30);

  assert.equal(sockets.length, 1);
  assert.deepEqual(errors, ['INVALID_TOKEN']);
  realtime.dispose();
});

test('close code 4003 refreshes token via tokenProvider and reconnects', async () => {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const client = new FastrelayClient({ apiKey: 'k', baseUrl: 'https://api.test' });
  const realtime = new FastrelayRealtime({
    client,
    token: 'old',
    tokenProvider: async () => 'fresh',
    socketFactory: (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    subscribeDebounceMs: 5,
    reconnectInitialDelayMs: 5,
    reconnectMaxDelayMs: 10,
  });

  realtime.connect();
  await wait(1);
  sockets[0].open();
  sockets[0].onclose?.({ code: 4003, reason: 'expired' });
  await wait(30);

  assert.equal(sockets.length, 2);
  assert.equal(urls[1], 'wss://api.test/v1/realtime?token=fresh');
  assert.equal(client.token, 'fresh');
  realtime.dispose();
});

test('token refresh resolving after dispose neither writes token nor reconnects', async () => {
  let release!: (token: string) => void;
  const sockets: FakeSocket[] = [];
  const client = new FastrelayClient({ apiKey: 'k', baseUrl: 'https://api.test' });
  const realtime = new FastrelayRealtime({
    client,
    token: 'old',
    tokenProvider: () => new Promise<string>((resolve) => (release = resolve)),
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    subscribeDebounceMs: 5,
    reconnectInitialDelayMs: 5,
    reconnectMaxDelayMs: 10,
  });

  realtime.connect();
  await wait(1);
  sockets[0].open();
  sockets[0].onclose?.({ code: 4003, reason: 'expired' });
  await wait(10); // reconnect fires and blocks awaiting the token provider

  realtime.dispose();
  release('stale');
  await wait(10);

  assert.equal(client.token, undefined);
  assert.equal(sockets.length, 1);
});
