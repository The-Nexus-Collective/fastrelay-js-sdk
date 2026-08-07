import type { FeedActivityQuery } from './types.ts';

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null | undefined>;

export type QueryMap = Record<string, unknown>;

export function toAbsoluteUrl(
  baseUrl: string,
  path: string,
  query?: QueryMap,
): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && item !== undefined) {
            url.searchParams.append(key, String(item));
          }
        }
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }

  return url.toString();
}

export function buildFeedActivityQuery(options?: FeedActivityQuery): QueryMap {
  if (!options) return {};

  const query: QueryMap = {};
  if ('limit' in options) query.limit = options.limit;
  if ('cursor' in options) query.cursor = options.cursor;
  if ('view' in options) query.view = options.view;
  if ('markSeen' in options) query.markSeen = options.markSeen;

  if ('markRead' in options) {
    const markRead = options.markRead;
    query.markRead = Array.isArray(markRead) ? markRead.join(',') : markRead;
  }

  if (options.filter && typeof options.filter === 'object') {
    for (const [key, value] of Object.entries(options.filter)) {
      query[`filter[${key}]`] = value;
    }
  }

  return query;
}

export type FeedTarget = string | { group: string; id: string };

export function resolveFeedTarget(target: unknown): string {
  if (typeof target === 'string' && target.length > 0) {
    return target;
  }
  if (target && typeof target === 'object') {
    const { group, id } = target as { group?: unknown; id?: unknown };
    if (
      typeof group === 'string' &&
      group.length > 0 &&
      typeof id === 'string' &&
      id.length > 0
    ) {
      return `${group}:${id}`;
    }
  }
  throw new TypeError(
    "target must be a feed string like 'user:john' or {group, id}.",
  );
}

export function splitFeedId(feedId: string): [group: string, id: string] {
  const separatorIndex = feedId.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === feedId.length - 1) {
    throw new TypeError(
      `Invalid feed id '${feedId}'. Expected format '{group}:{id}'.`,
    );
  }
  return [feedId.slice(0, separatorIndex), feedId.slice(separatorIndex + 1)];
}

export function parseJsonSafely(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
