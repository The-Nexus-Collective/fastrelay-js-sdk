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

/**
 * A presigned direct upload reserved by `POST /v1/files/uploads`. PUT the file body to
 * `uploadUrl` with every entry of `requiredHeaders` before `expiresAt`, then call
 * `confirmFileUpload(fileId)`.
 */
export interface FastrelayFileUpload {
  fileId: string;
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
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

// ---- chat ------------------------------------------------------------------

export type FastrelayConversationKind = 'direct' | 'group';
export type FastrelayConversationRole = 'owner' | 'moderator' | 'member';
export type FastrelayMemberRestriction = 'banned' | 'muted';

export interface FastrelayConversationMember {
  userId: string;
  user?: FastrelayUser | null;
  role: FastrelayConversationRole | string;
  joinedAt: string;
  restriction?: FastrelayMemberRestriction | string | null;
  restrictionExpiresAt?: string | null;
  lastDeliveredSeq?: number | null;
  lastDeliveredAt?: string | null;
  lastReadSeq?: number | null;
  lastReadAt?: string | null;
  /** Set when the conversation has presence enabled; null otherwise. */
  online?: boolean | null;
  lastActiveAt?: string | null;
  /** Your own notification setting (`muteConversation`); absent on other members. */
  notificationsMuted?: boolean | null;
}

export interface FastrelayReplyPreview {
  id: string;
  seq?: number | null;
  userId?: string | null;
  text?: string | null;
  deleted: boolean;
}

export interface FastrelayMessage {
  id: string;
  conversationId: string;
  seq: number;
  /** `system` messages have no `userId`/`text`; `custom` holds `{ event, actorId, userIds }`. */
  type: 'regular' | 'system' | string;
  silent: boolean;
  userId?: string | null;
  text?: string | null;
  custom: Record<string, unknown>;
  replyToId?: string | null;
  replyTo?: FastrelayReplyPreview | null;
  /**
   * Reaction type to the ids of the first 100 users who added it, in the order they reacted.
   * Page the rest with `listMessageReactionUsers` when `reactionCounts` is higher.
   */
  reactions: Record<string, string[]>;
  /** Reaction type to the total number of users who added it. */
  reactionCounts: Record<string, number>;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FastrelayConversation {
  id: string;
  kind: FastrelayConversationKind | string;
  type: string;
  name?: string | null;
  image?: string | null;
  custom: Record<string, unknown>;
  presenceEnabled: boolean;
  frozen: boolean;
  createdBy?: string | null;
  lastMessageSeq: number;
  lastMessageAt?: string | null;
  truncatedSeq?: number | null;
  truncatedAt?: string | null;
  memberCount: number;
  /** The first 100 members by join time. Omitted from realtime events. */
  members?: FastrelayConversationMember[] | null;
  unreadCount?: number | null;
  /** Latest visible message. Query results only. */
  lastMessage?: FastrelayMessage | null;
  createdAt: string;
  updatedAt: string;
}

export interface FastrelayUnreadTotals {
  totalUnread: number;
  unreadConversations: number;
}

export interface FastrelayChatSync {
  /** Pass as `since` on the next sync. */
  serverTime: string;
  conversations: FastrelayConversation[];
  /** Created, edited or deleted messages in changed conversations not in `reloadConversationIds`. */
  messages: FastrelayMessage[];
  /** Requested conversations the user can no longer access. */
  removedConversationIds: string[];
  /** Conversations with too many changed messages; reload their history. */
  reloadConversationIds: string[];
  /** Too many conversations changed; reload them all via `queryConversations`. */
  reloadAll: boolean;
  unread: FastrelayUnreadTotals;
}

export interface FastrelayConversationFilter {
  kind?: FastrelayConversationKind;
  type?: string;
  /** Conversations containing all of these users. */
  members?: string[];
  /** JSON containment match against the conversation's `custom`. */
  custom?: Record<string, unknown>;
  frozen?: boolean;
  hasUnread?: boolean;
}

export interface FastrelayConversationQuery {
  filter?: FastrelayConversationFilter;
  sort?: 'lastMessageAt' | 'createdAt' | 'updatedAt' | 'unreadCount';
  direction?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

interface ChatEventBase<T extends string, D> {
  type: T;
  conversationId?: string | null;
  eventId: string;
  createdAt?: string;
  data: D;
}

export interface FastrelayReceiptData {
  userId: string;
  lastDeliveredSeq?: number | null;
  lastDeliveredAt?: string | null;
  lastReadSeq?: number | null;
  lastReadAt?: string | null;
}

/**
 * A chat event delivered over the realtime socket to the users it concerns — no feed
 * subscription needed. Narrow on `type` to get the typed `data`; unknown types from newer
 * servers arrive with raw `data`.
 */
export type FastrelayChatEvent =
  | ChatEventBase<'message.new' | 'message.updated' | 'message.deleted', { message: FastrelayMessage }>
  | ChatEventBase<'conversation.updated' | 'conversation.truncated', { conversation: FastrelayConversation }>
  | ChatEventBase<'conversation.deleted', Record<string, never>>
  | ChatEventBase<'member.added', { conversation: FastrelayConversation; userIds: string[] }>
  | ChatEventBase<'member.removed', { userId: string }>
  | ChatEventBase<'member.updated', { member: FastrelayConversationMember }>
  | ChatEventBase<'receipt.delivered' | 'receipt.read', FastrelayReceiptData>
  | ChatEventBase<'typing.start' | 'typing.stop', { userId: string }>
  | ChatEventBase<'presence.changed', { userId: string; online: boolean; lastActiveAt?: string | null }>
  | ChatEventBase<'unread.updated', { totals: FastrelayUnreadTotals }>;

/** Raw shape of any chat event, including types this SDK version does not know. */
export type FastrelayRawChatEvent = ChatEventBase<string, Record<string, unknown>>;

export interface FastrelayConnectionEstablished {
  connectionId: string;
  /** Server clock at connect; the first `syncChat({ since })` anchor. */
  serverTime: string;
  isReconnect: boolean;
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
