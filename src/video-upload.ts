import type { FastrelayClient } from './client.ts';

export interface FastrelayVideoUploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  fraction: number;
}

export interface FastrelayVideoUploadResult {
  videoId: string;
  uploadUrl: string;
  bytesUploaded: number;
}

export class FastrelayVideoUploadError extends Error {
  readonly statusCode?: number;
  readonly cause?: unknown;

  constructor(message: string, options: { statusCode?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'FastrelayVideoUploadError';
    this.statusCode = options.statusCode;
    this.cause = options.cause;
  }
}

const DEFAULT_CHUNK_SIZE = 50 * 1024 * 1024;

/**
 * Drives a tus 1.0.0 upload of `data` to `uploadUrl` (the pre-authorized
 * Cloudflare Stream endpoint returned by createVideoUploadUrl). Calls
 * `onProgress` after each PATCH chunk; resolves with the total bytes accepted.
 */
export async function tusUploadBytes({
  uploadUrl,
  data,
  chunkSize = DEFAULT_CHUNK_SIZE,
  onProgress,
  fetchImpl = fetch,
}: {
  uploadUrl: string;
  data: Uint8Array | ArrayBuffer;
  chunkSize?: number;
  onProgress?: (progress: FastrelayVideoUploadProgress) => void;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  if (uploadUrl.trim() === '') {
    throw new TypeError('uploadUrl must not be empty.');
  }
  if (chunkSize <= 0) {
    throw new TypeError('chunkSize must be positive.');
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const total = bytes.byteLength;

  const report = (bytesUploaded: number) =>
    onProgress?.({
      bytesUploaded,
      totalBytes: total,
      fraction: total <= 0 ? 0 : Math.min(1, Math.max(0, bytesUploaded / total)),
    });

  let offset = 0;
  report(0);

  while (offset < total) {
    const end = Math.min(offset + chunkSize, total);
    const chunk = bytes.slice(offset, end);

    const response = await fetchImpl(uploadUrl, {
      method: 'PATCH',
      headers: {
        'tus-resumable': '1.0.0',
        'upload-offset': String(offset),
        'content-type': 'application/offset+octet-stream',
      },
      body: chunk as unknown as BodyInit,
    });

    if (response.status !== 204 && response.status !== 200) {
      const body = await response.text().catch(() => '');
      throw new FastrelayVideoUploadError(
        `tus PATCH failed: ${response.status} ${response.statusText} ${body}`.trim(),
        { statusCode: response.status },
      );
    }

    const reportedOffset = Number.parseInt(
      response.headers.get('upload-offset') ?? '',
      10,
    );
    const nextOffset = Number.isNaN(reportedOffset)
      ? offset + chunk.byteLength
      : reportedOffset;
    // A non-advancing offset would loop forever; one past `total` would
    // report success for bytes the server never accepted.
    if (nextOffset <= offset || nextOffset > total) {
      throw new FastrelayVideoUploadError(
        `tus server reported invalid upload-offset ${nextOffset} ` +
          `(previous offset ${offset}, total ${total}).`,
        { statusCode: response.status },
      );
    }
    offset = nextOffset;
    report(offset);
  }

  return offset;
}

/**
 * High-level helper: mints a tus upload URL via the backend, then uploads
 * `data` directly to Cloudflare Stream. The caller listens for `video.ready`
 * on the realtime channel (or polls client.getVideo) for the final state.
 */
export async function uploadVideoBytes(
  client: FastrelayClient,
  {
    data,
    filename,
    mimeType,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    fetchImpl,
  }: {
    data: Uint8Array | ArrayBuffer;
    filename: string;
    mimeType: string;
    chunkSize?: number;
    onProgress?: (progress: FastrelayVideoUploadProgress) => void;
    fetchImpl?: typeof fetch;
  },
): Promise<FastrelayVideoUploadResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    throw new TypeError('uploadVideoBytes requires non-empty data.');
  }
  if (filename.trim() === '') {
    throw new TypeError('uploadVideoBytes requires a non-empty filename.');
  }
  if (!mimeType.trim().toLowerCase().startsWith('video/')) {
    throw new TypeError(
      `uploadVideoBytes requires a video/* mimeType (got "${mimeType}").`,
    );
  }

  const mint = await client.createVideoUploadUrl({
    filename,
    sizeBytes: bytes.byteLength,
    mimeType,
  });

  const uploaded = await tusUploadBytes({
    uploadUrl: mint.uploadUrl,
    data: bytes,
    chunkSize,
    onProgress,
    fetchImpl,
  });

  return {
    videoId: mint.videoId,
    uploadUrl: mint.uploadUrl,
    bytesUploaded: uploaded,
  };
}
