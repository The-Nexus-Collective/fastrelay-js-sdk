import type { FastrelayClient, FastrelayRequestOptions } from './client.ts';
import type {
  CursorPage,
  FastrelayActivity,
  FastrelayBookmark,
  FastrelayComment,
  FastrelayFeedActivityPin,
  FastrelayReaction,
  FastrelayRealtimeEvent,
  FeedActivityQuery,
  NotificationPage,
} from './types.ts';
import type { FeedTarget } from './utils.ts';

export class FastrelayFeed {
  readonly group: string;
  readonly feedId: string;
  private readonly client: FastrelayClient;

  constructor(client: FastrelayClient, group: string, id: string) {
    this.client = client;
    this.group = group.trim();
    this.feedId = id.trim();
    if (this.group === '' || this.feedId === '') {
      throw new TypeError('feed(group, id) requires both group and id.');
    }
  }

  get id(): string {
    return `${this.group}:${this.feedId}`;
  }

  /** Subscribe to realtime events for this feed. Returns an unsubscribe fn. */
  on(
    type: string,
    callback: (event: FastrelayRealtimeEvent) => void,
  ): () => void {
    const realtime = this.client.realtime;
    if (!realtime) {
      throw new Error(
        'Realtime is not initialized. Call connectUser(..., {realtime: true}).',
      );
    }
    const normalizedType = type.trim();
    if (normalizedType === '') {
      throw new TypeError('Event type must not be empty.');
    }
    return realtime.subscribeToFeed(this.id, callback, { type: normalizedType });
  }

  /** Subscribe to all realtime events for this feed. */
  onAny(callback: (event: FastrelayRealtimeEvent) => void): () => void {
    const realtime = this.client.realtime;
    if (!realtime) {
      throw new Error(
        'Realtime is not initialized. Call connectUser(..., {realtime: true}).',
      );
    }
    return realtime.subscribeToFeed(this.id, callback);
  }

  getOrCreate(
    request: Record<string, unknown> = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.getOrCreateFeed(this.group, this.feedId, request, options);
  }

  getActivities(
    query?: FeedActivityQuery,
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayActivity>> {
    return this.client.getFeedActivities(this.group, this.feedId, query, options);
  }

  getNotificationActivities(
    query?: FeedActivityQuery,
    options?: FastrelayRequestOptions,
  ): Promise<NotificationPage<FastrelayActivity>> {
    return this.client.getNotificationFeedActivities(
      this.group,
      this.feedId,
      query,
      options,
    );
  }

  getCapabilities(
    query?: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.getCapabilities({ feed: this.id, ...query }, options);
  }

  addActivity(
    activity: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayActivity> {
    const feeds = Array.isArray(activity.feeds)
      ? activity.feeds.map((entry) => String(entry))
      : [];
    if (!feeds.includes(this.id)) feeds.push(this.id);
    return this.client.addActivity({ ...activity, feeds }, options);
  }

  delete(options?: FastrelayRequestOptions): Promise<any> {
    return this.client.deleteFeed(this.group, this.feedId, options);
  }

  setVisibility(level: string, options?: FastrelayRequestOptions): Promise<any> {
    return this.client.setFeedVisibility(this.group, this.feedId, level, options);
  }

  updateSettings(
    settings: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.updateFeedSettings(this.group, this.feedId, settings, options);
  }

  addMember(
    userId: string,
    { role = 'member' }: { role?: string } = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.addFeedMember(this.group, this.feedId, { userId, role }, options);
  }

  removeMember(userId: string, options?: FastrelayRequestOptions): Promise<any> {
    return this.client.removeFeedMember(this.group, this.feedId, userId, options);
  }

  listMembers(
    query?: { limit?: number; cursor?: string },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.listFeedMembers(this.group, this.feedId, query, options);
  }

  follow(
    target: FeedTarget,
    { activityCopyLimit }: { activityCopyLimit?: number } = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.followFeed(
      this.group,
      this.feedId,
      {
        target,
        ...(activityCopyLimit !== undefined ? { activityCopyLimit } : {}),
      },
      options,
    );
  }

  batchFollow(
    targets: FeedTarget[],
    { activityCopyLimit }: { activityCopyLimit?: number } = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.batchFollowFeed(
      this.group,
      this.feedId,
      {
        targets,
        ...(activityCopyLimit !== undefined ? { activityCopyLimit } : {}),
      },
      options,
    );
  }

  unfollow(
    target: FeedTarget,
    { keepHistory }: { keepHistory?: boolean } = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.unfollowFeed(
      this.group,
      this.feedId,
      target,
      { keepHistory },
      options,
    );
  }

  listFollowers(
    query?: { limit?: number; cursor?: string },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.listFollowers(this.group, this.feedId, query, options);
  }

  listFollowing(
    query?: { limit?: number; cursor?: string },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.listFollowing(this.group, this.feedId, query, options);
  }

  listFollowRequests(
    query?: { status?: string },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.listFollowRequests(this.group, this.feedId, query, options);
  }

  approveFollowRequest(
    requestId: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.approveFollowRequest(this.group, this.feedId, requestId, options);
  }

  rejectFollowRequest(
    requestId: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.client.rejectFollowRequest(this.group, this.feedId, requestId, options);
  }

  addReaction(
    activityId: string,
    type: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayReaction> {
    return this.client.addReaction(activityId, type, options);
  }

  removeReaction(
    activityId: string,
    reactionId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.client.removeReaction(activityId, reactionId, options);
  }

  addComment(
    activityId: string,
    request: { text: string; parentId?: string; mentionedUsers?: string[] },
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayComment> {
    return this.client.addComment(activityId, request, options);
  }

  addBookmark(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayBookmark> {
    return this.client.addBookmark(activityId, options);
  }

  removeBookmark(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.client.removeBookmark(activityId, options);
  }

  pinActivity(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayFeedActivityPin> {
    return this.client.pinActivity(this.group, this.feedId, activityId, options);
  }

  unpinActivity(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.client.unpinActivity(this.group, this.feedId, activityId, options);
  }
}
