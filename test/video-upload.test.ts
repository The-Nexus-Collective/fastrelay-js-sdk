import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tusUploadBytes } from '../src/video-upload.ts';

function tusResponse(offset: number | string) {
  return new Response(null, {
    status: 204,
    headers: { 'upload-offset': String(offset) },
  });
}

test('tus upload completes with server-reported offsets', async () => {
  let received = 0;
  const fetchImpl = (async (_url: any, init: any) => {
    received += (init.body as Uint8Array).byteLength;
    return tusResponse(received);
  }) as typeof fetch;

  const uploaded = await tusUploadBytes({
    uploadUrl: 'http://x.test/u',
    data: new Uint8Array(10),
    chunkSize: 4,
    fetchImpl,
  });
  assert.equal(uploaded, 10);
});

test('tus upload rejects a non-advancing server offset instead of looping', async () => {
  const fetchImpl = (async () => tusResponse(0)) as typeof fetch;
  await assert.rejects(
    tusUploadBytes({
      uploadUrl: 'http://x.test/u',
      data: new Uint8Array(10),
      chunkSize: 4,
      fetchImpl,
    }),
    /invalid upload-offset/,
  );
});

test('tus upload rejects an offset past the total instead of reporting success', async () => {
  const fetchImpl = (async () => tusResponse(99)) as typeof fetch;
  await assert.rejects(
    tusUploadBytes({
      uploadUrl: 'http://x.test/u',
      data: new Uint8Array(10),
      chunkSize: 4,
      fetchImpl,
    }),
    /invalid upload-offset/,
  );
});
