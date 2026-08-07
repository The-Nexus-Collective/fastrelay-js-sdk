// Wire models. The fastrelay API speaks camelCase JSON, so responses are used
// as-is; date fields are ISO-8601 strings.

export interface FastrelayUser {
  id: string;
  displayName?: string | null;
  profileData?: Record<string, unknown> | null;
  role?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FastrelayReaction {
  id: string;
  activityId: string;
  userId: string;
  user?: FastrelayUser | null;
  type: string;
  createdAt: string;
}

export interface FastrelayActivity {
  id: string;
  type: string;
  text?: string | null;
  userId: string;
  user?: FastrelayUser | null;
  feeds: string[];
  visibility: string;
  custom?: Record<string, unknown> | null;
  popularity: number;
  reactionCounts: Record<string, number>;
  commentCount: number;
  bookmarkCount: number;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  ownReactions?: FastrelayReaction[] | null;
}

export interface FastrelayComment {
  id: string;
  activityId: string;
  userId: string;
  user?: FastrelayUser | null;
  text: string;
  parentId?: string | null;
  mentionedUsers: string[];
  reactionCounts: Record<string, number>;
  score: number;
  createdAt: string;
  updatedAt: string;
}

export interface FastrelayCommentReaction {
  id: string;
  commentId: string;
  userId: string;
  type: string;
  createdAt: string;
}

export interface FastrelayBookmark {
  id: string;
  activityId: string;
  userId: string;
  createdAt: string;
}

export interface FastrelayFeedActivityPin {
  appId: string;
  feedId: string;
  activityId: string;
  pinnedAt: string;
  pinnedBy: string;
}

export interface FastrelayFeedback {
  id: string;
  activityId: string;
  userId: string;
  type: 'show_more' | 'show_less';
  createdAt: string;
}

export interface FastrelayFile {
  id: string;
  url: string;
  type: string;
  mimeType: string;
  size: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface FastrelayModerationFlag {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  description?: string | null;
  status: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface FastrelayPollOption {
  id: string;
  text: string;
  voteCount: number;
}

export interface FastrelayPoll {
  id: string;
  question: string;
  options: FastrelayPollOption[];
  totalVotes: number;
  userVote?: string | null;
  expiresAt?: string | null;
  isClosed: boolean;
}

export interface FastrelayUserMute {
  id: string;
  muterId?: string | null;
  mutedUserId: string;
  type: string;
  mutedBy?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface FastrelayVideo {
  id: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | string;
  provider: string;
  createdAt: string;
  hlsUrl?: string | null;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface FastrelayVideoUploadUrl {
  videoId: string;
  uploadUrl: string;
  protocol: string;
}

export interface FastrelayVideoStatusEvent {
  type: 'video.ready' | 'video.failed';
  videoId: string;
  video?: FastrelayVideo | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface CursorPage<T> {
  data: T[];
  nextCursor?: string | null;
  hasMore: boolean;
  pinned?: T[];
}

export interface NotificationGroup<T> {
  groupKey: string;
  activities: T[];
  activityCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface NotificationPage<T> extends CursorPage<T> {
  unseenCount?: number;
  unreadCount?: number;
  groups?: NotificationGroup<T>[];
}

export interface FastrelayRealtimeEvent {
  type: string;
  feedId: string;
  eventId: string;
  seq?: number | null;
  createdAt?: string;
  data: Record<string, unknown>;
}

export type FastrelayConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

export interface FastrelayRealtimeError {
  code: string;
  message: string;
  retryable: boolean;
  closeCode?: number | null;
  details?: unknown;
  hint?: string | null;
  cause?: unknown;
}

export interface FeedActivityQuery {
  limit?: number;
  cursor?: string;
  view?: string;
  markSeen?: boolean | string;
  markRead?: boolean | string | string[];
  filter?: Record<string, unknown>;
  [key: string]: unknown;
}
