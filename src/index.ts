export {
  FastrelayClient,
  type ConnectUserOptions,
  type FastrelayAuthMode,
  type FastrelayClientOptions,
  type FastrelayRequestOptions,
} from './client.ts';
export { FastrelayApiError, type FastrelayRateLimit } from './error.ts';
export { FastrelayFeed } from './feed.ts';
export { FeedPollingService } from './polling.ts';
export {
  FastrelayRealtime,
  type FastrelayRealtimeOptions,
  type FastrelayRealtimeSocket,
  type FastrelayRealtimeSocketFactory,
  type FastrelayTokenProvider,
} from './realtime.ts';
export * from './types.ts';
export {
  buildFeedActivityQuery,
  resolveFeedTarget,
  splitFeedId,
  type FeedTarget,
} from './utils.ts';
export {
  FastrelayVideoUploadError,
  tusUploadBytes,
  uploadVideoBytes,
  type FastrelayVideoUploadProgress,
  type FastrelayVideoUploadResult,
} from './video-upload.ts';
