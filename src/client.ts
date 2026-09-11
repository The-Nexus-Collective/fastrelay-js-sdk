import { FastrelayApiError, type FastrelayRateLimit } from './error.ts';
import { FastrelayFeed } from './feed.ts';
import {
  FastrelayRealtime,
  type FastrelayRealtimeSocketFactory,
  type FastrelayTokenProvider,
} from './realtime.ts';
import type {
  CursorPage,
  FastrelayActivity,
  FastrelayBookmark,
  FastrelayComment,
  FastrelayCommentReaction,
  FastrelayFeedActivityPin,
  FastrelayFeedback,
  FastrelayFile,
  FastrelayModerationFlag,
  FastrelayPoll,
  FastrelayReaction,
  FastrelayUser,
  FastrelayUserMute,
  FastrelayVideo,
  FastrelayVideoUploadUrl,
  FeedActivityQuery,
  NotificationPage,
} from './types.ts';
import {
  buildFeedActivityQuery,
  parseJsonSafely,
  resolveFeedTarget,
  splitFeedId,
  toAbsoluteUrl,
  type FeedTarget,
  type QueryMap,
} from './utils.ts';

export type FastrelayAuthMode = 'auto' | 'user' | 'server' | 'none';

export interface FastrelayRequestOptions {
  auth?: FastrelayAuthMode;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface FastrelayClientOptions {
  apiKey: string;
  baseUrl?: string;
  token?: string;
  user?: Record<string, unknown>;
  fetch?: typeof fetch;
  socketFactory?: FastrelayRealtimeSocketFactory;
}

export interface ConnectUserOptions {
  upsertUser?: boolean;
  realtime?: boolean;
  tokenProvider?: FastrelayTokenProvider;
}

type ListQuery = { limit?: number; cursor?: string };

const enc = encodeURIComponent;

export class FastrelayClient {
  apiKey: string;
  baseUrl: string;
  token?: string;
  user?: Record<string, unknown>;
  realtime?: FastrelayRealtime;

  private readonly fetchImpl: typeof fetch;
  private readonly socketFactory?: FastrelayRealtimeSocketFactory;

  constructor(options: FastrelayClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.fastrelay.io';
    this.token = options.token;
    this.user = options.user ? { ...options.user } : undefined;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.socketFactory = options.socketFactory;
  }

  feed(group: string, id: string): FastrelayFeed {
    return new FastrelayFeed(this, group, id);
  }

  async connectUser(
    user: Record<string, unknown>,
    token: string,
    options: ConnectUserOptions = {},
  ): Promise<this> {
    const userId = user.id;
    if (userId === null || userId === undefined || String(userId) === '') {
      throw new TypeError('connectUser requires a user object with an id.');
    }
    if (token.trim() === '') {
      throw new TypeError('connectUser requires a JWT token string.');
    }

    // Drop the previous user's socket before any await so a failed upsert
    // can never leave the old session receiving events under the new token.
    if (this.realtime) {
      this.realtime.dispose();
      this.realtime = undefined;
    }

    const previousUser = this.user;
    const previousToken = this.token;
    this.user = { ...user };
    this.token = token;

    if (options.upsertUser) {
      try {
        await this.request('POST', '/v1/users', {
          body: {
            id: userId,
            displayName: user.displayName ?? user.name,
            profileData: user.profileData ?? user.data,
            ...(user.role !== null && user.role !== undefined
              ? { role: user.role }
              : {}),
          },
        });
      } catch (error) {
        this.user = previousUser;
        this.token = previousToken;
        throw error;
      }
    }

    if (options.realtime) {
      this.realtime = new FastrelayRealtime({
        client: this,
        token,
        tokenProvider: options.tokenProvider,
        socketFactory: this.socketFactory,
      });
      this.realtime.connect();
    }

    return this;
  }

  disconnectUser(): this {
    this.realtime?.dispose();
    this.realtime = undefined;
    this.user = undefined;
    this.token = undefined;
    return this;
  }

  setToken(token: string): this {
    this.token = token;
    this.realtime?.updateToken(token);
    return this;
  }

  setBaseUrl(baseUrl: string): this {
    this.baseUrl = baseUrl;
    this.realtime?.onBaseUrlChanged();
    return this;
  }

  close(): void {
    this.realtime?.dispose();
    this.realtime = undefined;
  }

  // ---- capabilities & users ------------------------------------------------

  getCapabilities(
    query: { feed?: string } = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('GET', '/v1/me/capabilities', {
      query: { feed: query.feed },
      options,
    });
  }

  getUser(id: string, options?: FastrelayRequestOptions): Promise<FastrelayUser> {
    return this.request('GET', `/v1/users/${enc(id)}`, { options });
  }

  updateUser(
    id: string,
    request: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayUser> {
    return this.request('PATCH', `/v1/users/${enc(id)}`, {
      body: request,
      options,
    });
  }

  // ---- feeds ---------------------------------------------------------------

  getOrCreateFeed(
    group: string,
    id: string,
    request: Record<string, unknown> = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('POST', `/v1/feeds/${enc(group)}/${enc(id)}`, {
      body: request,
      options,
    });
  }

  getFeedActivities(
    group: string,
    id: string,
    query?: FeedActivityQuery,
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayActivity>> {
    return this.request('GET', `/v1/feeds/${enc(group)}/${enc(id)}/activities`, {
      query: buildFeedActivityQuery(query),
      options,
    });
  }

  getNotificationFeedActivities(
    group: string,
    id: string,
    query?: FeedActivityQuery,
    options?: FastrelayRequestOptions,
  ): Promise<NotificationPage<FastrelayActivity>> {
    return this.getFeedActivities(group, id, query, options) as Promise<
      NotificationPage<FastrelayActivity>
    >;
  }

  deleteFeed(
    group: string,
    id: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('DELETE', `/v1/feeds/${enc(group)}/${enc(id)}`, {
      options,
    });
  }

  setFeedVisibility(
    group: string,
    id: string,
    level: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('PUT', `/v1/feeds/${enc(group)}/${enc(id)}/visibility`, {
      body: { level },
      options,
    });
  }

  updateFeedSettings(
    group: string,
    id: string,
    request: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('PUT', `/v1/feeds/${enc(group)}/${enc(id)}/settings`, {
      body: request,
      options,
    });
  }

  addFeedMember(
    group: string,
    id: string,
    request: { userId: string; role?: string },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('POST', `/v1/feeds/${enc(group)}/${enc(id)}/members`, {
      body: request,
      options,
    });
  }

  removeFeedMember(
    group: string,
    id: string,
    userId: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request(
      'DELETE',
      `/v1/feeds/${enc(group)}/${enc(id)}/members/${enc(userId)}`,
      { options },
    );
  }

  listFeedMembers(
    group: string,
    id: string,
    query?: ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('GET', `/v1/feeds/${enc(group)}/${enc(id)}/members`, {
      query: { limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  followFeed(
    group: string,
    id: string,
    request: { target: FeedTarget; activityCopyLimit?: number },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('POST', `/v1/feeds/${enc(group)}/${enc(id)}/follows`, {
      body: { ...request, target: resolveFeedTarget(request.target) },
      options,
    });
  }

  batchFollowFeed(
    group: string,
    id: string,
    request: { targets: FeedTarget[]; activityCopyLimit?: number },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request(
      'POST',
      `/v1/feeds/${enc(group)}/${enc(id)}/follows/batch`,
      {
        body: {
          ...(request.activityCopyLimit !== undefined
            ? { activityCopyLimit: request.activityCopyLimit }
            : {}),
          targets: (request.targets ?? []).map(resolveFeedTarget),
        },
        options,
      },
    );
  }

  unfollowFeed(
    group: string,
    id: string,
    target: FeedTarget,
    { keepHistory }: { keepHistory?: boolean } = {},
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    const [targetGroup, targetId] = splitFeedId(resolveFeedTarget(target));
    return this.request(
      'DELETE',
      `/v1/feeds/${enc(group)}/${enc(id)}/follows/${enc(targetGroup)}:${enc(targetId)}`,
      { query: { keepHistory }, options },
    );
  }

  listFollowers(
    group: string,
    id: string,
    query?: ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('GET', `/v1/feeds/${enc(group)}/${enc(id)}/followers`, {
      query: { limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  listFollowing(
    group: string,
    id: string,
    query?: ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request('GET', `/v1/feeds/${enc(group)}/${enc(id)}/following`, {
      query: { limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  listFollowRequests(
    group: string,
    id: string,
    query?: { status?: string },
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request(
      'GET',
      `/v1/feeds/${enc(group)}/${enc(id)}/follow-requests`,
      { query: { status: query?.status }, options },
    );
  }

  approveFollowRequest(
    group: string,
    id: string,
    requestId: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request(
      'POST',
      `/v1/feeds/${enc(group)}/${enc(id)}/follow-requests/${enc(requestId)}/approve`,
      { options },
    );
  }

  rejectFollowRequest(
    group: string,
    id: string,
    requestId: string,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    return this.request(
      'POST',
      `/v1/feeds/${enc(group)}/${enc(id)}/follow-requests/${enc(requestId)}/reject`,
      { options },
    );
  }

  // ---- activities ------------------------------------------------------

  addActivity(
    request: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayActivity> {
    return this.request('POST', '/v1/activities', { body: request, options });
  }

  getActivity(
    id: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayActivity> {
    return this.request('GET', `/v1/activities/${enc(id)}`, { options });
  }

  updateActivity(
    id: string,
    request: Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayActivity> {
    return this.request('PATCH', `/v1/activities/${enc(id)}`, {
      body: request,
      options,
    });
  }

  deleteActivity(id: string, options?: FastrelayRequestOptions): Promise<any> {
    return this.request('DELETE', `/v1/activities/${enc(id)}`, { options });
  }

  batchGetActivities(
    requestOrIds: string[] | Record<string, unknown>,
    options?: FastrelayRequestOptions,
  ): Promise<any> {
    const body = Array.isArray(requestOrIds)
      ? { ids: requestOrIds }
      : requestOrIds;
    return this.request('POST', '/v1/activities/batch', { body, options });
  }

  // ---- reactions -------------------------------------------------------

  addReaction(
    activityId: string,
    type: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayReaction> {
    return this.request('POST', `/v1/activities/${enc(activityId)}/reactions`, {
      body: { type },
      options,
    });
  }

  removeReaction(
    activityId: string,
    reactionId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/activities/${enc(activityId)}/reactions/${enc(reactionId)}`,
      { options },
    );
  }

  listReactions(
    activityId: string,
    query?: { type?: string } & ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayReaction>> {
    return this.request('GET', `/v1/activities/${enc(activityId)}/reactions`, {
      query: { type: query?.type, limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  // ---- comments --------------------------------------------------------

  addComment(
    activityId: string,
    request: { text: string; parentId?: string; mentionedUsers?: string[] },
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayComment> {
    return this.request('POST', `/v1/activities/${enc(activityId)}/comments`, {
      body: {
        text: request.text,
        ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
        ...(request.mentionedUsers !== undefined
          ? { mentionedUsers: request.mentionedUsers }
          : {}),
      },
      options,
    });
  }

  updateComment(
    commentId: string,
    request: { text: string },
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayComment> {
    return this.request('PATCH', `/v1/comments/${enc(commentId)}`, {
      body: { text: request.text },
      options,
    });
  }

  deleteComment(
    commentId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.request('DELETE', `/v1/comments/${enc(commentId)}`, { options });
  }

  listComments(
    activityId: string,
    query?: { sort?: string } & ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayComment>> {
    return this.request('GET', `/v1/activities/${enc(activityId)}/comments`, {
      query: { sort: query?.sort, limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  listReplies(
    commentId: string,
    query?: ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayComment>> {
    return this.request('GET', `/v1/comments/${enc(commentId)}/replies`, {
      query: { limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  addCommentReaction(
    commentId: string,
    type: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayCommentReaction> {
    return this.request('POST', `/v1/comments/${enc(commentId)}/reactions`, {
      body: { type },
      options,
    });
  }

  removeCommentReaction(
    commentId: string,
    reactionId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/comments/${enc(commentId)}/reactions/${enc(reactionId)}`,
      { options },
    );
  }

  // ---- bookmarks & pins --------------------------------------------------

  addBookmark(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayBookmark> {
    return this.request('POST', `/v1/activities/${enc(activityId)}/bookmarks`, {
      options,
    });
  }

  removeBookmark(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/activities/${enc(activityId)}/bookmarks`,
      { options },
    );
  }

  listBookmarks(
    query?: ListQuery,
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayBookmark>> {
    return this.request('GET', '/v1/me/bookmarks', {
      query: { limit: query?.limit, cursor: query?.cursor },
      options,
    });
  }

  pinActivity(
    group: string,
    id: string,
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayFeedActivityPin> {
    return this.request(
      'POST',
      `/v1/feeds/${enc(group)}/${enc(id)}/activities/${enc(activityId)}/pin`,
      { options },
    );
  }

  unpinActivity(
    group: string,
    id: string,
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/feeds/${enc(group)}/${enc(id)}/activities/${enc(activityId)}/pin`,
      { options },
    );
  }

  // ---- polls -------------------------------------------------------------

  createPoll(
    activityId: string,
    request: {
      question: string;
      options: Array<{ text: string } & Record<string, string>>;
      maxVotesPerUser?: number;
      anonymous?: boolean;
      expiresAt?: string | Date;
    },
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayPoll> {
    return this.request('POST', `/v1/activities/${enc(activityId)}/polls`, {
      body: {
        question: request.question,
        options: request.options,
        maxVotesPerUser: request.maxVotesPerUser ?? 1,
        anonymous: request.anonymous ?? false,
        ...(request.expiresAt !== undefined
          ? {
              expiresAt:
                request.expiresAt instanceof Date
                  ? request.expiresAt.toISOString()
                  : request.expiresAt,
            }
          : {}),
      },
      options,
    });
  }

  getPollForActivity(
    activityId: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayPoll> {
    return this.request('GET', `/v1/activities/${enc(activityId)}/polls`, {
      options,
    });
  }

  getPoll(pollId: string, options?: FastrelayRequestOptions): Promise<FastrelayPoll> {
    return this.request('GET', `/v1/polls/${enc(pollId)}`, { options });
  }

  vote(
    pollId: string,
    optionId: string,
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayPoll> {
    return this.request('POST', `/v1/polls/${enc(pollId)}/votes`, {
      body: { optionId },
      options,
    });
  }

  removeVote(pollId: string, options?: FastrelayRequestOptions): Promise<void> {
    return this.request('DELETE', `/v1/polls/${enc(pollId)}/votes`, { options });
  }

  // ---- files & videos ------------------------------------------------------

  async uploadFile(
    data: Blob | ArrayBuffer | Uint8Array,
    filename: string,
    { type }: { type?: string } = {},
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayFile> {
    const blob =
      data instanceof Blob ? data : new Blob([data as BlobPart]);
    if (blob.size === 0) {
      throw new TypeError('uploadFile requires non-empty data.');
    }
    if (filename.trim() === '') {
      throw new TypeError('uploadFile requires a non-empty filename.');
    }

    const form = new FormData();
    form.append('file', blob, filename);
    if (type && type.trim() !== '') {
      form.append('type', type.trim());
    }

    return this.request('POST', '/v1/files', { form, options });
  }

  deleteFile(fileId: string, options?: FastrelayRequestOptions): Promise<void> {
    return this.request('DELETE', `/v1/files/${enc(fileId)}`, { options });
  }

  createVideoUploadUrl(
    request: { filename: string; sizeBytes: number; mimeType: string },
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayVideoUploadUrl> {
    return this.request('POST', '/v1/videos/upload-url', {
      body: request,
      options,
    });
  }

  getVideo(videoId: string, options?: FastrelayRequestOptions): Promise<FastrelayVideo> {
    return this.request('GET', `/v1/videos/${enc(videoId)}`, { options });
  }

  deleteVideo(videoId: string, options?: FastrelayRequestOptions): Promise<void> {
    return this.request('DELETE', `/v1/videos/${enc(videoId)}`, { options });
  }

  // ---- feedback & moderation -------------------------------------------

  submitFeedback(
    activityId: string,
    type: 'show_more' | 'show_less',
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayFeedback> {
    if (type !== 'show_more' && type !== 'show_less') {
      throw new TypeError("Feedback type must be 'show_more' or 'show_less'.");
    }
    return this.request('POST', `/v1/activities/${enc(activityId)}/feedback`, {
      body: { type },
      options,
    });
  }

  createFlag(
    targetType: string,
    targetId: string,
    request: { reason: string; description?: string },
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayModerationFlag> {
    return this.request('POST', '/v1/moderation/flags', {
      body: {
        targetType,
        targetId,
        reason: request.reason,
        ...(request.description !== undefined
          ? { description: request.description }
          : {}),
      },
      options,
    });
  }

  deleteFlag(flagId: string, options?: FastrelayRequestOptions): Promise<void> {
    return this.request('DELETE', `/v1/moderation/flags/${enc(flagId)}`, {
      options,
    });
  }

  createMute(
    userId: string,
    { type = 'personal', expiresAt }: { type?: string; expiresAt?: string | Date } = {},
    options?: FastrelayRequestOptions,
  ): Promise<FastrelayUserMute> {
    return this.request('POST', '/v1/moderation/mutes', {
      body: {
        userId,
        type,
        ...(expiresAt !== undefined
          ? {
              expiresAt:
                expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
            }
          : {}),
      },
      options,
    });
  }

  removeMute(
    userId: string,
    { type = 'personal' }: { type?: string } = {},
    options?: FastrelayRequestOptions,
  ): Promise<void> {
    return this.request('DELETE', `/v1/moderation/mutes/${enc(userId)}`, {
      query: { type },
      options,
    });
  }

  listMutes(
    query: { type?: string } & ListQuery = {},
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayUserMute>> {
    return this.request('GET', '/v1/moderation/mutes', {
      query: {
        type: query.type ?? 'personal',
        limit: query.limit,
        cursor: query.cursor,
      },
      options,
    });
  }

  getMutedUsers(
    query: { type?: string } & ListQuery = {},
    options?: FastrelayRequestOptions,
  ): Promise<CursorPage<FastrelayUserMute>> {
    return this.listMutes(query, options);
  }

  // ---- transport -----------------------------------------------------------

  async request(
    method: string,
    path: string,
    {
      query,
      body,
      form,
      options = {},
    }: {
      query?: QueryMap;
      body?: unknown;
      form?: FormData;
      options?: FastrelayRequestOptions;
    } = {},
  ): Promise<any> {
    const authorization = this.buildAuthorization(options.auth ?? 'auto');
    const url = toAbsoluteUrl(this.baseUrl, path, query);

    const headers: Record<string, string> = { accept: 'application/json' };
    if (authorization) headers.authorization = authorization;
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }
    Object.assign(headers, options.headers);

    let requestBody: BodyInit | undefined;
    if (form) {
      requestBody = form; // fetch sets the multipart content-type + boundary
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: requestBody,
    });
    const text = await response.text();
    const parsed = parseJsonSafely(text);

    if (response.status < 200 || response.status >= 300) {
      const parsedMap =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : undefined;
      const errorPayload = parsedMap?.error;
      const errorMap =
        errorPayload && typeof errorPayload === 'object'
          ? (errorPayload as Record<string, unknown>)
          : undefined;

      throw new FastrelayApiError({
        message: String(
          errorMap?.message ??
            parsedMap?.message ??
            `fastrelay API request failed (${response.status} ${response.statusText}).`.trim(),
        ),
        status: response.status,
        code: errorMap?.code !== undefined ? String(errorMap.code) : undefined,
        details: errorMap?.details,
        hint: errorMap?.hint !== undefined ? String(errorMap.hint) : undefined,
        docUrl:
          errorMap?.docUrl !== undefined ? String(errorMap.docUrl) : undefined,
        requestId:
          parsedMap?.requestId !== undefined
            ? String(parsedMap.requestId)
            : undefined,
        path,
        method,
        rateLimit: readRateLimit(response.headers),
      });
    }

    if (parsed === null || parsed === '') return null;
    return parsed;
  }

  private buildAuthorization(auth: FastrelayAuthMode): string | undefined {
    switch (auth) {
      case 'none':
        return undefined;
      case 'server':
        throw new Error(
          'Server auth is not supported: this SDK is client-only. ' +
            'Call server endpoints from your backend.',
        );
      case 'user':
        if (!this.token) {
          throw new Error(
            'This request requires a user token. Call connectUser() or setToken().',
          );
        }
        return `Bearer ${this.token}`;
      case 'auto':
        return this.token ? `Bearer ${this.token}` : undefined;
    }
  }
}

function readRateLimit(headers: Headers): FastrelayRateLimit | undefined {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (limit === null && remaining === null && reset === null) return undefined;

  const parse = (value: string | null) => {
    if (value === null) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  return { limit: parse(limit), remaining: parse(remaining), reset: parse(reset) };
}
