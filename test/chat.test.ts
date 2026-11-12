import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FastrelayClient } from '../src/client.ts';
import {
  FastrelayRealtime,
  type FastrelayRealtimeSocket,
} from '../src/realtime.ts';
import type {
  FastrelayChatEvent,
  FastrelayConnectionEstablished,
} from '../src/types.ts';

// ---- REST -------------------------------------------------------------------

function recordingClient(response: unknown = {}) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: any }> = [];
  const client = new FastrelayClient({
    apiKey: 'k',
    baseUrl: 'https://api.test',
    token: 'jwt',
    fetch: (async (input: any, init: any = {}) => {
      calls.push({
        method: init.method,
        url: String(input),
        headers: init.headers,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
      });
      return new Response(JSON.stringify(response), { status: 200 });
    }) as typeof fetch,
  });
  return { client, calls };
}

test('conversation endpoints send the documented method, path and body', async () => {
  const { client, calls } = recordingClient();

  await client.createConversation({ kind: 'direct', members: ['bob'] });
  await client.queryConversations({
    filter: { kind: 'group', members: ['bob'], custom: { team: 'eng' }, hasUnread: true },
    sort: 'unreadCount',
    limit: 10,
  });
  await client.getConversation('cnv_1');
  await client.updateConversation('cnv_1', { name: 'Eng', frozen: true });
  await client.deleteConversation('cnv_1');
  await client.truncateConversation('cnv_1', { systemMessage: false });
  await client.listConversationMembers('cnv_1', { limit: 50, cursor: 'c' });
  await client.addConversationMembers('cnv_1', ['carol']);
  await client.updateConversationMember('cnv_1', 'carol', {
    restriction: 'banned',
    restrictionExpiresAt: new Date('2030-01-01T00:00:00Z'),
  });
  await client.removeConversationMember('cnv_1', 'carol');

  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      ['POST', 'https://api.test/v1/conversations', { kind: 'direct', members: ['bob'] }],
      [
        'POST',
        'https://api.test/v1/conversations/query',
        {
          filter: { kind: 'group', members: ['bob'], custom: { team: 'eng' }, hasUnread: true },
          sort: 'unreadCount',
          limit: 10,
        },
      ],
      ['GET', 'https://api.test/v1/conversations/cnv_1', undefined],
      ['PATCH', 'https://api.test/v1/conversations/cnv_1', { name: 'Eng', frozen: true }],
      ['DELETE', 'https://api.test/v1/conversations/cnv_1', undefined],
      ['POST', 'https://api.test/v1/conversations/cnv_1/truncate', { systemMessage: false }],
      ['GET', 'https://api.test/v1/conversations/cnv_1/members?limit=50&cursor=c', undefined],
      ['POST', 'https://api.test/v1/conversations/cnv_1/members', { userIds: ['carol'] }],
      [
        'PATCH',
        'https://api.test/v1/conversations/cnv_1/members/carol',
        { restriction: 'banned', restrictionExpiresAt: '2030-01-01T00:00:00.000Z' },
      ],
      ['DELETE', 'https://api.test/v1/conversations/cnv_1/members/carol', undefined],
    ],
  );
  assert.equal(calls[0].headers.authorization, 'Bearer jwt');
});

test('message, read, unread and sync endpoints', async () => {
  const { client, calls } = recordingClient();

  await client.sendMessage(
    'cnv_1',
    { text: 'hi', replyToId: 'msg_0', silent: true },
    { idempotencyKey: 'send-1' },
  );
  await client.listMessages('cnv_1', { cursor: 40, direction: 'newer', limit: 20 });
  await client.listMessages('cnv_1', { around: 12 });
  await client.updateMessage('msg_1', { text: 'edited' });
  await client.deleteMessage('msg_1');
  await client.addMessageReaction('msg_1', '❤️');
  await client.removeMessageReaction('msg_1', '❤️');
  await client.muteConversation('cnv_1');
  await client.unmuteConversation('cnv_1');
  await client.markConversationRead('cnv_1');
  await client.markConversationRead('cnv_1', { seq: 7 });
  await client.getUnreadTotals();
  await client.syncChat({ since: new Date('2026-11-04T10:00:00Z') });

  assert.deepEqual(
    calls.map((c) => [c.method, c.url, c.body]),
    [
      [
        'POST',
        'https://api.test/v1/conversations/cnv_1/messages',
        { text: 'hi', replyToId: 'msg_0', silent: true },
      ],
      ['GET', 'https://api.test/v1/conversations/cnv_1/messages?cursor=40&direction=newer&limit=20', undefined],
      ['GET', 'https://api.test/v1/conversations/cnv_1/messages?around=12', undefined],
      ['PATCH', 'https://api.test/v1/messages/msg_1', { text: 'edited' }],
      ['DELETE', 'https://api.test/v1/messages/msg_1', undefined],
      ['POST', 'https://api.test/v1/messages/msg_1/reactions', { type: '❤️' }],
      ['DELETE', 'https://api.test/v1/messages/msg_1/reactions/%E2%9D%A4%EF%B8%8F', undefined],
      ['PUT', 'https://api.test/v1/conversations/cnv_1/notifications', { muted: true }],
      ['PUT', 'https://api.test/v1/conversations/cnv_1/notifications', { muted: false }],
      ['POST', 'https://api.test/v1/conversations/cnv_1/read', {}],
      ['POST', 'https://api.test/v1/conversations/cnv_1/read', { seq: 7 }],
      ['GET', 'https://api.test/v1/chat/unread', undefined],
      [
        'POST',
        'https://api.test/v1/chat/sync',
        { since: '2026-11-04T10:00:00.000Z', conversationIds: [] },
      ],
    ],
  );
  assert.equal(calls[0].headers['idempotency-key'], 'send-1');
});

test('blocking is a block-type mute', async () => {
  const { client, calls } = recordingClient();
  await client.createMute('alice', { type: 'block' });
  await client.removeMute('alice', { type: 'block' });
  assert.deepEqual(calls[0].body, { userId: 'alice', type: 'block' });
  assert.equal(calls[1].url, 'https://api.test/v1/moderation/mutes/alice?type=block');
});

// ---- realtime ---------------------------------------------------------------

class FakeSocket implements FastrelayRealtimeSocket {
  sent: string[] = [];
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  frames() {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function connected() {
  const sockets: FakeSocket[] = [];
  const realtime = new FastrelayRealtime({
    client: new FastrelayClient({ apiKey: 'k', baseUrl: 'https://api.test' }),
    token: 'jwt',
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
  sockets[0].onopen?.();
  return { realtime, sockets };
}

const message = {
  id: 'msg_1',
  conversationId: 'cnv_1',
  seq: 3,
  type: 'regular',
  silent: false,
  userId: 'bob',
  text: 'hi',
  custom: {},
  createdAt: '2026-11-04T10:00:00Z',
  updatedAt: '2026-11-04T10:00:00Z',
};

test('chat events without feedId reach chat listeners, not feed listeners, deduped', async () => {
  const { realtime, sockets } = await connected();
  const chat: FastrelayChatEvent[] = [];
  const feed: string[] = [];
  realtime.onChatEvent((e) => chat.push(e));
  realtime.onEvent((e) => feed.push(e.type));

  const event = {
    type: 'message.new',
    conversationId: 'cnv_1',
    eventId: 'ev1',
    createdAt: '2026-11-04T10:00:00Z',
    data: { message },
  };
  sockets[0].receive(event);
  sockets[0].receive(event);
  sockets[0].receive({
    type: 'presence.changed',
    eventId: 'ev2',
    data: { userId: 'bob', online: true },
  });
  sockets[0].receive({ type: 'reaction.added', eventId: 'ev3', data: { x: 1 } });

  assert.deepEqual(feed, []);
  assert.deepEqual(
    chat.map((e) => [e.type, e.conversationId]),
    [
      ['message.new', 'cnv_1'],
      ['presence.changed', null],
      ['reaction.added', null],
    ],
  );
  const first = chat[0];
  assert.ok(first.type === 'message.new');
  assert.equal(first.data.message.text, 'hi');
  assert.deepEqual(chat[2].data, { x: 1 });

  realtime.dispose();
});

test('feed events still route to feed listeners only', async () => {
  const { realtime, sockets } = await connected();
  const chat: string[] = [];
  const feed: string[] = [];
  realtime.onChatEvent((e) => chat.push(e.type));
  realtime.onEvent((e) => feed.push(e.type));

  sockets[0].receive({ type: 'activity.created', feedId: 'user:john', eventId: 'f1', data: {} });

  assert.deepEqual(feed, ['activity.created']);
  assert.deepEqual(chat, []);
  realtime.dispose();
});

test('client chat messages serialize to the wire protocol', async () => {
  const { realtime, sockets } = await connected();

  assert.equal(realtime.startTyping('cnv_1'), true);
  assert.equal(realtime.stopTyping('cnv_1'), true);
  assert.equal(realtime.markDelivered('cnv_1', 5), true);
  assert.equal(realtime.markRead('cnv_1'), true);
  assert.equal(realtime.markRead('cnv_1', 6), true);

  assert.deepEqual(sockets[0].frames(), [
    { type: 'typing.start', conversationId: 'cnv_1' },
    { type: 'typing.stop', conversationId: 'cnv_1' },
    { type: 'message.delivered', conversationId: 'cnv_1', seq: 5 },
    { type: 'conversation.read', conversationId: 'cnv_1' },
    { type: 'conversation.read', conversationId: 'cnv_1', seq: 6 },
  ]);

  assert.throws(() => realtime.startTyping('  '), TypeError);
  assert.throws(() => realtime.markDelivered('cnv_1', 0), TypeError);
  assert.throws(() => realtime.markRead('cnv_1', 1.5), TypeError);
  realtime.dispose();
});

test('chat messages are not queued while disconnected', async () => {
  const { realtime, sockets } = await connected();
  sockets[0].onclose?.({ code: 1006 });

  assert.equal(realtime.startTyping('cnv_1'), false);
  assert.equal(realtime.markRead('cnv_1'), false);
  assert.deepEqual(sockets[0].sent, []);
  realtime.dispose();
});

test('presence.start is sent now and replayed after every reconnect', async () => {
  const { realtime, sockets } = await connected();
  realtime.startPresence();
  assert.deepEqual(sockets[0].frames(), [{ type: 'presence.start' }]);

  sockets[0].onclose?.({ code: 1006 });
  await wait(30);
  assert.equal(sockets.length, 2);
  sockets[1].onopen?.();
  assert.deepEqual(sockets[1].frames(), [{ type: 'presence.start' }]);
  realtime.dispose();
});

test('presence requested before connecting is sent on open', async () => {
  const sockets: FakeSocket[] = [];
  const realtime = new FastrelayRealtime({
    client: new FastrelayClient({ apiKey: 'k', baseUrl: 'https://api.test' }),
    token: 'jwt',
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  realtime.startPresence();
  realtime.connect();
  await wait(1);
  assert.deepEqual(sockets[0].sent, []);
  sockets[0].onopen?.();
  assert.deepEqual(sockets[0].frames(), [{ type: 'presence.start' }]);
  realtime.dispose();
});

test('connection.established exposes serverTime and whether it is a reconnect', async () => {
  const { realtime, sockets } = await connected();
  const seen: FastrelayConnectionEstablished[] = [];
  realtime.onConnectionEstablished((e) => seen.push(e));

  sockets[0].receive({
    type: 'connection.established',
    connectionId: 'c1',
    serverTime: '2026-11-04T10:00:00Z',
  });
  sockets[0].onclose?.({ code: 1006 });
  await wait(30);
  sockets[1].onopen?.();
  sockets[1].receive({
    type: 'connection.established',
    connectionId: 'c2',
    serverTime: '2026-11-04T10:05:00Z',
  });

  assert.deepEqual(seen, [
    { connectionId: 'c1', serverTime: '2026-11-04T10:00:00Z', isReconnect: false },
    { connectionId: 'c2', serverTime: '2026-11-04T10:05:00Z', isReconnect: true },
  ]);
  realtime.dispose();
});
