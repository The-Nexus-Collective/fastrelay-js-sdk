import type { FastrelayClient } from './client.ts';
import type {
  CursorPage,
  FastrelayActivity,
  NotificationPage,
} from './types.ts';

interface PollerHandlers<T> {
  limit?: number;
  onPage: (page: T) => void;
  onError?: (error: unknown) => void;
}

interface Poller {
  setInterval(ms: number): void;
  stop(): void;
}

/**
 * Polling fallback for environments without realtime. Each pollFeed /
 * pollNotifications call starts an independent poller; call the returned
 * function (or dispose()) to stop it.
 */
export class FeedPollingService {
  private readonly client: FastrelayClient;
  private readonly activeIntervalMs: number;
  private readonly backgroundIntervalMs: number;
  private readonly pollers = new Set<Poller>();
  private paused = false;

  constructor(
    client: FastrelayClient,
    {
      activeIntervalMs = 15_000,
      backgroundIntervalMs = 60_000,
    }: { activeIntervalMs?: number; backgroundIntervalMs?: number } = {},
  ) {
    this.client = client;
    this.activeIntervalMs = activeIntervalMs;
    this.backgroundIntervalMs = backgroundIntervalMs;
  }

  pollFeed(
    group: string,
    id: string,
    { limit = 25, onPage, onError }: PollerHandlers<CursorPage<FastrelayActivity>>,
  ): () => void {
    return this.startPoller(
      () => this.client.getFeedActivities(group, id, { limit }),
      onPage,
      onError,
    );
  }

  pollNotifications(
    group: string,
    id: string,
    {
      limit = 25,
      onPage,
      onError,
    }: PollerHandlers<NotificationPage<FastrelayActivity>>,
  ): () => void {
    return this.startPoller(
      () => this.client.getNotificationFeedActivities(group, id, { limit }),
      onPage,
      onError,
    );
  }

  pause(): void {
    this.paused = true;
    for (const poller of this.pollers) {
      poller.setInterval(this.backgroundIntervalMs);
    }
  }

  resume(): void {
    this.paused = false;
    for (const poller of this.pollers) {
      poller.setInterval(this.activeIntervalMs);
    }
  }

  dispose(): void {
    for (const poller of this.pollers) poller.stop();
    this.pollers.clear();
  }

  private startPoller<T>(
    fetchPage: () => Promise<T>,
    onPage: (page: T) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const page = await fetchPage();
        if (!stopped) onPage(page);
      } catch (error) {
        if (!stopped) onError?.(error);
      } finally {
        inFlight = false;
      }
    };

    const poller: Poller = {
      setInterval: (ms: number) => {
        if (timer !== null) clearInterval(timer);
        timer = setInterval(() => void poll(), ms);
      },
      stop: () => {
        stopped = true;
        if (timer !== null) clearInterval(timer);
        timer = null;
      },
    };

    poller.setInterval(
      this.paused ? this.backgroundIntervalMs : this.activeIntervalMs,
    );
    void poll();
    this.pollers.add(poller);

    return () => {
      poller.stop();
      this.pollers.delete(poller);
    };
  }
}
