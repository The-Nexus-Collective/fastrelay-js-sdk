import type { FastrelayClient } from './client.ts';
import type {
  FastrelayConnectionState,
  FastrelayRealtimeError,
  FastrelayRealtimeEvent,
  FastrelayVideoStatusEvent,
} from './types.ts';
import { parseJsonSafely, toAbsoluteUrl } from './utils.ts';

export type FastrelayTokenProvider = () => Promise<string> | string;

/** Minimal browser-WebSocket-shaped surface, injectable for tests / Node < 22. */
export interface FastrelayRealtimeSocket {
  send(data: string): void;
  close(): void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose:
    | ((event: { code?: number; reason?: string }) => void)
    | null;
  onerror: ((event?: unknown) => void) | null;
}

export type FastrelayRealtimeSocketFactory = (
  url: string,
) => FastrelayRealtimeSocket;

export interface FastrelayRealtimeOptions {
  client: FastrelayClient;
  token: string;
  tokenProvider?: FastrelayTokenProvider;
  socketFactory?: FastrelayRealtimeSocketFactory;
  subscribeDebounceMs?: number;
  deadConnectionTimeoutMs?: number;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

type Unsubscribe = () => void;

interface FeedListener {
  type?: string;
  callback: (event: FastrelayRealtimeEvent) => void;
}

const MAX_RECENT_EVENT_IDS = 1000;

export class FastrelayRealtime {
  private readonly client: FastrelayClient;
  private token: string;
  private readonly tokenProvider?: FastrelayTokenProvider;
  private readonly socketFactory: FastrelayRealtimeSocketFactory;
  private readonly subscribeDebounceMs: number;
  private readonly deadConnectionTimeoutMs: number;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;

  private readonly feedListeners = new Map<string, Set<FeedListener>>();
  private readonly acknowledgedFeeds = new Set<string>();
  private readonly pendingSubscribes = new Set<string>();
  private readonly pendingUnsubscribes = new Set<string>();
  private readonly recentEventIds = new Set<string>();

  private readonly eventListeners = new Set<(e: FastrelayRealtimeEvent) => void>();
  private readonly stateListeners = new Set<(s: FastrelayConnectionState) => void>();
  private readonly errorListeners = new Set<(e: FastrelayRealtimeError) => void>();
  private readonly videoListeners = new Set<(e: FastrelayVideoStatusEvent) => void>();

  private socket: FastrelayRealtimeSocket | null = null;
  private subscribeBatchTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deadConnectionTimer: ReturnType<typeof setInterval> | null = null;
  private lastServerMessageAt: number | null = null;

  private state: FastrelayConnectionState = 'disconnected';
  private shouldBeConnected = false;
  private disposed = false;
  private awaitingTokenRefresh = false;
  private hasConnectedAtLeastOnce = false;
  private generation = 0;
  private reconnectAttempt = 0;

  constructor(options: FastrelayRealtimeOptions) {
    this.client = options.client;
    this.token = options.token;
    this.tokenProvider = options.tokenProvider;
    this.socketFactory =
      options.socketFactory ??
      ((url) => new WebSocket(url) as unknown as FastrelayRealtimeSocket);
    this.subscribeDebounceMs = options.subscribeDebounceMs ?? 50;
    this.deadConnectionTimeoutMs = options.deadConnectionTimeoutMs ?? 90_000;
    this.reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 1_000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
  }

  get connectionState(): FastrelayConnectionState {
    return this.state;
  }

  onEvent(callback: (event: FastrelayRealtimeEvent) => void): Unsubscribe {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  onStateChange(callback: (state: FastrelayConnectionState) => void): Unsubscribe {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  onError(callback: (error: FastrelayRealtimeError) => void): Unsubscribe {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  onVideoStatus(callback: (event: FastrelayVideoStatusEvent) => void): Unsubscribe {
    this.videoListeners.add(callback);
    return () => this.videoListeners.delete(callback);
  }

  /**
   * Listen to events for one feed. Subscribes over the socket on the first
   * listener and unsubscribes when the last one is removed.
   */
  subscribeToFeed(
    feedId: string,
    callback: (event: FastrelayRealtimeEvent) => void,
    { type }: { type?: string } = {},
  ): Unsubscribe {
    if (this.disposed) {
      throw new Error('FastrelayRealtime is disposed.');
    }
    const normalizedFeedId = feedId.trim();
    if (normalizedFeedId === '') {
      throw new TypeError('feedId must not be empty.');
    }

    let listeners = this.feedListeners.get(normalizedFeedId);
    if (!listeners) {
      listeners = new Set();
      this.feedListeners.set(normalizedFeedId, listeners);
      this.pendingUnsubscribes.delete(normalizedFeedId);
      this.pendingSubscribes.add(normalizedFeedId);
      this.scheduleSubscribeBatch();
    }

    const listener: FeedListener = { type: type?.trim() || undefined, callback };
    listeners.add(listener);

    return () => {
      const current = this.feedListeners.get(normalizedFeedId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.feedListeners.delete(normalizedFeedId);
        this.acknowledgedFeeds.delete(normalizedFeedId);
        this.pendingSubscribes.delete(normalizedFeedId);
        this.pendingUnsubscribes.add(normalizedFeedId);
        this.scheduleSubscribeBatch();
      }
    };
  }

  updateToken(token: string): void {
    this.token = token;
  }

  onBaseUrlChanged(): void {
    if (!this.shouldBeConnected || this.disposed) return;
    this.scheduleReconnect({ immediate: true });
  }

  connect(): void {
    if (this.disposed) return;
    this.shouldBeConnected = true;
    this.cancelReconnectTimer();
    void this.openSocket(this.hasConnectedAtLeastOnce);
  }

  disconnect({ clearSubscriptions = false } = {}): void {
    if (this.disposed) return;

    this.shouldBeConnected = false;
    this.awaitingTokenRefresh = false;
    this.cancelReconnectTimer();
    this.cancelSubscribeBatch();
    this.pendingSubscribes.clear();
    this.pendingUnsubscribes.clear();
    this.closeSocketResources();
    this.acknowledgedFeeds.clear();

    if (clearSubscriptions) {
      this.feedListeners.clear();
    }

    this.setState('disconnected');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.shouldBeConnected = false;
    this.cancelReconnectTimer();
    this.cancelSubscribeBatch();
    this.stopDeadConnectionMonitor();
    this.closeSocketResources();
    this.feedListeners.clear();
    this.eventListeners.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.videoListeners.clear();
  }

  // ---- internals ---------------------------------------------------------

  private async openSocket(isReconnect: boolean): Promise<void> {
    if (this.disposed || !this.shouldBeConnected) return;

    if (this.awaitingTokenRefresh) {
      const refreshed = await this.refreshToken();
      if (this.disposed || !this.shouldBeConnected) return;
      if (!refreshed) {
        this.scheduleReconnect();
        return;
      }
      this.awaitingTokenRefresh = false;
    }

    const token = this.token.trim();
    if (token === '') {
      this.emitError({
        code: 'MISSING_TOKEN',
        message: 'Realtime connection requires a non-empty token.',
        retryable: false,
      });
      this.setState('disconnected');
      return;
    }

    this.closeSocketResources();

    const generation = ++this.generation;
    this.setState(isReconnect ? 'reconnecting' : 'connecting');

    const httpUrl = toAbsoluteUrl(this.client.baseUrl, '/v1/realtime', { token });
    const wsUrl = httpUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

    let socket: FastrelayRealtimeSocket;
    try {
      socket = this.socketFactory(wsUrl);
    } catch (error) {
      this.emitError({
        code: 'CONNECTION_DROPPED',
        message: 'Failed to open realtime socket.',
        retryable: true,
        cause: error,
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    this.lastServerMessageAt = Date.now();
    this.startDeadConnectionMonitor();

    socket.onopen = () => this.onConnected(generation, isReconnect);
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleRawMessage(event.data, generation);
      }
    };
    socket.onclose = (event) =>
      this.onDisconnected(generation, event.code ?? null, event.reason ?? null);
    socket.onerror = () => {
      // The paired close event carries the actionable detail; nothing to do here.
    };
  }

  private onConnected(generation: number, _wasReconnect: boolean): void {
    if (this.disposed || generation !== this.generation) return;

    this.reconnectAttempt = 0;
    this.cancelReconnectTimer();
    this.setState('connected');
    this.hasConnectedAtLeastOnce = true;

    for (const feed of this.feedListeners.keys()) {
      if (!this.acknowledgedFeeds.has(feed)) {
        this.pendingSubscribes.add(feed);
      }
    }
    this.flushSubscriptionBatch();
  }

  private onDisconnected(
    generation: number,
    closeCode: number | null,
    reason: string | null,
  ): void {
    if (this.disposed || generation !== this.generation) return;

    this.stopDeadConnectionMonitor();
    this.acknowledgedFeeds.clear();
    this.setState('disconnected');

    if (!this.shouldBeConnected) return;

    if (closeCode === 4029 || closeCode === 4002) {
      this.shouldBeConnected = false;
      this.emitError({
        code: closeCode === 4029 ? 'CONNECTION_LIMIT_EXCEEDED' : 'INVALID_TOKEN',
        message:
          closeCode === 4029
            ? 'Realtime connection limit exceeded for this user or app.'
            : 'Realtime token is invalid.',
        retryable: false,
        closeCode,
        details: reason,
      });
      return;
    }

    if (closeCode === 4003) {
      if (!this.tokenProvider) {
        this.shouldBeConnected = false;
        this.emitError({
          code: 'TOKEN_EXPIRED',
          message:
            'Realtime token expired and no tokenProvider was configured.',
          retryable: false,
          closeCode,
          details: reason,
        });
        return;
      }
      this.awaitingTokenRefresh = true;
      this.scheduleReconnect({ immediate: true });
      return;
    }

    this.emitError({
      code: 'CONNECTION_DROPPED',
      message: 'Realtime connection dropped.',
      retryable: true,
      closeCode,
      details: reason,
    });
    this.scheduleReconnect();
  }

  private handleRawMessage(rawMessage: string, generation: number): void {
    if (this.disposed || generation !== this.generation) return;

    this.lastServerMessageAt = Date.now();

    const decoded = parseJsonSafely(rawMessage);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      return;
    }
    const payload = decoded as Record<string, unknown>;
    const type = String(payload.type ?? '');

    switch (type) {
      case 'connection.established':
      case 'heartbeat':
      case 'server.going_away':
        return;
      case 'subscribe.success':
        for (const feed of toStringArray(payload.feeds)) {
          this.acknowledgedFeeds.add(feed);
        }
        return;
      case 'unsubscribe.success':
        for (const feed of toStringArray(payload.feeds)) {
          this.acknowledgedFeeds.delete(feed);
        }
        return;
      case 'subscribe.error':
      case 'error':
        this.emitControlError(type, payload);
        return;
      case 'video.ready':
      case 'video.failed': {
        const videoId = String(payload.videoId ?? '');
        if (videoId === '') return;
        const event = payload as unknown as FastrelayVideoStatusEvent;
        for (const listener of [...this.videoListeners]) listener(event);
        return;
      }
    }

    const event: FastrelayRealtimeEvent = {
      type,
      feedId: String(payload.feedId ?? ''),
      eventId: String(payload.eventId ?? ''),
      seq: typeof payload.seq === 'number' ? payload.seq : null,
      createdAt:
        payload.createdAt !== undefined ? String(payload.createdAt) : undefined,
      data:
        payload.data && typeof payload.data === 'object'
          ? (payload.data as Record<string, unknown>)
          : {},
    };

    if (event.type === '' || event.feedId === '') return;
    if (event.eventId !== '' && !this.trackEventId(event.eventId)) return;

    this.dispatchEvent(event);
  }

  private dispatchEvent(event: FastrelayRealtimeEvent): void {
    for (const listener of [...this.eventListeners]) listener(event);

    const feedListeners = this.feedListeners.get(event.feedId);
    if (!feedListeners) return;
    for (const listener of [...feedListeners]) {
      if (!listener.type || listener.type === event.type) {
        listener.callback(event);
      }
    }
  }

  private emitControlError(type: string, payload: Record<string, unknown>): void {
    const errorMap =
      payload.error && typeof payload.error === 'object'
        ? (payload.error as Record<string, unknown>)
        : {};
    const code = String(
      errorMap.code ??
        (type === 'subscribe.error' ? 'SUBSCRIBE_ERROR' : 'REALTIME_ERROR'),
    );
    this.emitError({
      code,
      message: String(
        errorMap.message ??
          (type === 'subscribe.error'
            ? 'Feed subscription failed.'
            : 'Realtime error received from server.'),
      ),
      retryable: code !== 'CONNECTION_LIMIT_EXCEEDED' && code !== 'INVALID_TOKEN',
      details: errorMap.details,
      hint: errorMap.hint !== undefined ? String(errorMap.hint) : undefined,
    });
  }

  private trackEventId(eventId: string): boolean {
    if (this.recentEventIds.has(eventId)) return false;
    this.recentEventIds.add(eventId);
    if (this.recentEventIds.size > MAX_RECENT_EVENT_IDS) {
      const oldest = this.recentEventIds.values().next().value;
      if (oldest !== undefined) this.recentEventIds.delete(oldest);
    }
    return true;
  }

  private scheduleSubscribeBatch(): void {
    if (this.disposed || this.subscribeBatchTimer !== null) return;
    this.subscribeBatchTimer = setTimeout(() => {
      this.subscribeBatchTimer = null;
      this.flushSubscriptionBatch();
    }, this.subscribeDebounceMs);
  }

  private flushSubscriptionBatch(): void {
    if (this.disposed || this.state !== 'connected') return;

    if (this.pendingSubscribes.size > 0) {
      const feeds = [...this.pendingSubscribes].sort();
      this.pendingSubscribes.clear();
      this.send({ type: 'subscribe', feeds });
    }
    if (this.pendingUnsubscribes.size > 0) {
      const feeds = [...this.pendingUnsubscribes].sort();
      this.pendingUnsubscribes.clear();
      this.send({ type: 'unsubscribe', feeds });
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket || this.disposed) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (error) {
      this.emitError({
        code: 'SEND_FAILED',
        message: 'Failed to send realtime message.',
        retryable: true,
        cause: error,
        details: payload,
      });
    }
  }

  private setState(state: FastrelayConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private emitError(error: FastrelayRealtimeError): void {
    if (this.disposed) return;
    for (const listener of [...this.errorListeners]) listener(error);
  }

  private startDeadConnectionMonitor(): void {
    this.stopDeadConnectionMonitor();
    const frequency = Math.max(1000, Math.round(this.deadConnectionTimeoutMs / 3));
    this.deadConnectionTimer = setInterval(() => {
      if (this.disposed || !this.shouldBeConnected) return;
      if (this.lastServerMessageAt === null) return;
      if (Date.now() - this.lastServerMessageAt < this.deadConnectionTimeoutMs) {
        return;
      }
      this.emitError({
        code: 'DEAD_CONNECTION_TIMEOUT',
        message:
          'No realtime heartbeat/messages received within the dead connection timeout.',
        retryable: true,
      });
      this.scheduleReconnect({ immediate: true });
    }, frequency);
  }

  private stopDeadConnectionMonitor(): void {
    if (this.deadConnectionTimer !== null) {
      clearInterval(this.deadConnectionTimer);
      this.deadConnectionTimer = null;
    }
  }

  private scheduleReconnect({ immediate = false } = {}): void {
    if (this.disposed || !this.shouldBeConnected) return;
    if (this.reconnectTimer !== null) return;

    const delay = immediate ? 0 : this.nextReconnectDelay();
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket(true);
    }, delay);
  }

  private nextReconnectDelay(): number {
    const exponent = Math.min(this.reconnectAttempt, 10);
    const rawDelay = this.reconnectInitialDelayMs * 2 ** exponent;
    const cappedDelay = Math.min(rawDelay, this.reconnectMaxDelayMs);
    const jitter = 0.8 + Math.random() * 0.4;
    this.reconnectAttempt += 1;
    return Math.max(1, Math.round(cappedDelay * jitter));
  }

  private cancelReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cancelSubscribeBatch(): void {
    if (this.subscribeBatchTimer !== null) {
      clearTimeout(this.subscribeBatchTimer);
      this.subscribeBatchTimer = null;
    }
  }

  private closeSocketResources(): void {
    this.stopDeadConnectionMonitor();
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      try {
        this.socket.close();
      } catch {
        // Already closed.
      }
      this.socket = null;
    }
  }

  private async refreshToken(): Promise<boolean> {
    if (!this.tokenProvider) {
      this.emitError({
        code: 'TOKEN_PROVIDER_MISSING',
        message: 'Realtime token refresh requested but tokenProvider is null.',
        retryable: false,
      });
      return false;
    }
    const generation = this.generation;
    try {
      const token = await this.tokenProvider();
      // A dispose or newer connection attempt during the await means this
      // token belongs to a dead session; never write it into the client.
      if (this.disposed || generation !== this.generation) return false;
      if (token.trim() === '') {
        throw new Error('tokenProvider returned an empty token.');
      }
      this.token = token;
      this.client.setToken(token);
      return true;
    } catch (error) {
      this.emitError({
        code: 'TOKEN_REFRESH_FAILED',
        message: 'Failed to refresh realtime token.',
        retryable: true,
        cause: error,
      });
      return false;
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '')).filter((entry) => entry !== '');
}
