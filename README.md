# fastrelay Feed JS SDK

JavaScript/TypeScript SDK for [fastrelay](https://fastrelay.io) activity feeds and chat — feeds, activities, reactions, comments, polls, conversations and messages, video uploads, moderation, and realtime updates over WebSocket.

- Feed-first API: `fastrelay.feed(group, id)`
- Client-only by design: user (JWT) auth, no server secrets in the app
- Zero runtime dependencies — native `fetch`, `FormData`, `WebSocket`
- Realtime subscriptions with automatic reconnect + token refresh
- Polling fallback for non-realtime environments
- Direct-to-storage image uploads (presigned PUT) and video uploads (tus / Cloudflare Stream)
- Structured `FastrelayApiError` with rate-limit metadata

## Requirements

- Node.js >= 18 (>= 22 for native `WebSocket`, or pass `socketFactory`), or any modern browser.

## Install

```bash
npm install @fastrelay/js-sdk
```

## Quick start

```ts
import { FastrelayClient } from '@fastrelay/js-sdk';

const fastrelay = new FastrelayClient({
  apiKey: 'your_api_key',
  baseUrl: 'https://api.fastrelay.io',
});

await fastrelay.connectUser({ id: 'john' }, userJwt, {
  upsertUser: true,
  realtime: true,
  tokenProvider: async () => fetchFreshJwtFromYourBackend(),
});

const timeline = fastrelay.feed('timeline', 'john');

// Read
const page = await timeline.getActivities({ limit: 25 });

// Write
await timeline.addActivity({ type: 'post', text: 'Hello world' });

// Realtime — returns an unsubscribe function
const off = timeline.on('activity.created', (event) => {
  console.log('new activity', event.data);
});
```

## Authentication

The SDK is client-only: every request is sent with `Authorization: Bearer <user JWT>` once `connectUser()` or `setToken()` has been called. Per-request override via options: `{ auth: 'auto' | 'user' | 'none' }` (`'server'` throws — call server endpoints from your backend).

When `connectUser()` got a `tokenProvider`, an expired JWT renews itself: a request that answers `401` asks the provider for a fresh token, stores it (`setToken`, socket included) and is retried once. Concurrent 401s share one provider call; if the provider fails, the original `401` is thrown.

```ts
await fastrelay.getActivity('activity_id', { auth: 'user', idempotencyKey: 'key' });
```

## Activities, reactions, comments

```ts
const activity = await fastrelay.addActivity({ feeds: ['user:john'], type: 'post', text: 'hi' });
await fastrelay.addReaction(activity.id, 'like');
const comment = await fastrelay.addComment(activity.id, { text: 'Nice!' });
await fastrelay.addCommentReaction(comment.id, 'like');
const comments = await fastrelay.listComments(activity.id, { sort: 'top', limit: 10 });
```

Also available: bookmarks (`addBookmark`/`removeBookmark`/`listBookmarks`), pins (`feed.pinActivity`), polls (`createPoll`, `vote`), follows (`feed.follow`, `feed.listFollowers`), feed members, moderation (`createFlag`, `createMute`), feedback (`submitFeedback`), file upload (`uploadFile`, `uploadFileDirect`).

## Realtime

```ts
const realtime = fastrelay.realtime!;
realtime.onStateChange((state) => console.log(state)); // connecting/connected/reconnecting/disconnected
realtime.onError((error) => console.warn(error.code, error.message));
realtime.onVideoStatus((event) => console.log(event.type, event.videoId));

const off = realtime.subscribeToFeed('timeline:john', (event) => { ... });
off(); // unsubscribes (frames are batched over the socket)
```

Reconnects use exponential backoff with jitter; close code `4003` triggers a token refresh via `tokenProvider`, `4002`/`4029` are fatal. Duplicate `eventId`s are dropped.

## Chat

Direct and group conversations on the same user, token and socket as feeds.

```ts
// A direct conversation is returned as-is if it already exists.
const dm = await fastrelay.createConversation({ kind: 'direct', members: ['bob'] });
const group = await fastrelay.createConversation({ members: ['bob', 'carol'], name: 'Eng' });

// The user's conversations, most recent message first, with unread counts and last message.
const { data: inbox, nextCursor } = await fastrelay.queryConversations({
  filter: { hasUnread: true },
  limit: 20,
});

await fastrelay.sendMessage(dm.id, { text: 'Hi!' }, { idempotencyKey: crypto.randomUUID() });
const history = await fastrelay.listMessages(dm.id, { limit: 50 }); // ascending seq
const older = await fastrelay.listMessages(dm.id, { cursor: history.nextCursor!, direction: 'older' });

await fastrelay.markConversationRead(dm.id); // returns { totalUnread, unreadConversations }
const totals = await fastrelay.getUnreadTotals();
```

Also: `getConversation`, `updateConversation` (name, image, custom, `presenceEnabled`, `frozen`), `deleteConversation`, `truncateConversation`, `listConversationMembers`, `addConversationMembers`, `updateConversationMember` (role, `banned`/`muted` restriction), `removeConversationMember` (your own id leaves), `updateMessage`, `deleteMessage`. Block a user with `createMute(userId, { type: 'block' })`; report a message with `createFlag('message', messageId, { reason })`.

### Realtime chat

Chat events reach every member automatically — no subscription:

```ts
const realtime = fastrelay.realtime!;
realtime.startPresence(); // appear online; re-sent after reconnects, disconnect to go offline

realtime.onChatEvent((event) => {
  switch (event.type) {
    case 'message.new':
      render(event.data.message);
      realtime.markDelivered(event.data.message.conversationId, event.data.message.seq);
      break;
    case 'typing.start':
      showTyping(event.conversationId, event.data.userId);
      break;
    case 'unread.updated':
      setBadge(event.data.totals.totalUnread);
      break;
    // message.updated|deleted, conversation.updated|truncated|deleted, member.added|removed|updated,
    // receipt.delivered|read, typing.stop, presence.changed
  }
});

realtime.startTyping(conversationId); // stopTyping(conversationId) when done
if (!realtime.markRead(conversationId)) {
  await fastrelay.markConversationRead(conversationId); // socket not connected
}
```

`startTyping`/`stopTyping`/`markDelivered`/`markRead` are fire-and-forget: they return `false` and queue nothing while the socket is down. Typing has no server-side expiry — clear a `typing.start` you never got a `typing.stop` for after a few seconds.

### Catching up after a reconnect

```ts
let anchor: string | undefined;
realtime.onConnectionEstablished(async ({ serverTime }) => {
  if (!anchor) { anchor = serverTime; return; }
  const sync = await fastrelay.syncChat({ since: anchor, conversationIds: localConversationIds() });
  anchor = sync.serverTime;
  // Upsert sync.conversations and sync.messages by id; drop sync.removedConversationIds;
  // reload history for sync.reloadConversationIds, or everything if sync.reloadAll.
});
```

## Polling fallback

```ts
import { FeedPollingService } from '@fastrelay/js-sdk';

const polling = new FeedPollingService(fastrelay);
const stop = polling.pollFeed('timeline', 'john', {
  limit: 25,
  onPage: (page) => render(page.data),
});
// polling.pause() / polling.resume() / polling.dispose()
```

## File upload

`uploadFileDirect` sends an image or video straight to storage: it reserves the file, PUTs the bytes to a presigned URL and confirms the upload. The content type must be an `image/*` or `video/*` type that matches the bytes.

```ts
const file = await fastrelay.uploadFileDirect(photo, 'image/jpeg'); // Blob | ArrayBuffer | Uint8Array
console.log(file.url);
```

For other content types, `uploadFile(data, filename)` uploads through the API as multipart.

## Video upload

```ts
import { uploadVideoBytes } from '@fastrelay/js-sdk';

const result = await uploadVideoBytes(fastrelay, {
  data: fileBytes, // Uint8Array | ArrayBuffer
  filename: 'clip.mp4',
  mimeType: 'video/mp4',
  onProgress: ({ fraction }) => console.log(Math.round(fraction * 100), '%'),
});
// Wait for realtime `video.ready`, or poll fastrelay.getVideo(result.videoId)
```

## Error handling

```ts
import { FastrelayApiError } from '@fastrelay/js-sdk';

try {
  await fastrelay.getActivity('missing');
} catch (error) {
  if (error instanceof FastrelayApiError) {
    console.log(error.status, error.code, error.message, error.rateLimit);
  }
}
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node --test (needs Node 22.6+ to run .ts directly)
```
