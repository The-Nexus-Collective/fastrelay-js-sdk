# fastrelay Feed JS SDK

JavaScript/TypeScript SDK for [fastrelay](https://fastrelay.io) activity feeds — feeds, activities, reactions, comments, polls, video uploads, moderation, and realtime updates over WebSocket.

- Feed-first API: `fastrelay.feed(group, id)`
- Client-only by design: user (JWT) auth, no server secrets in the app
- Zero runtime dependencies — native `fetch`, `FormData`, `WebSocket`
- Realtime subscriptions with automatic reconnect + token refresh
- Polling fallback for non-realtime environments
- Direct-to-storage video uploads (tus / Cloudflare Stream)
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

Also available: bookmarks (`addBookmark`/`removeBookmark`/`listBookmarks`), pins (`feed.pinActivity`), polls (`createPoll`, `vote`), follows (`feed.follow`, `feed.listFollowers`), feed members, moderation (`createFlag`, `createMute`), feedback (`submitFeedback`), file upload (`uploadFile`).

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
