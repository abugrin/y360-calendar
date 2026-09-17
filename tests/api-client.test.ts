import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiFetch, ApiError, getSafeErrorMessage, parseRetryAfterMs } from '../lib/api-client';

test('parallel requests reserve different rate-limit slots', async (t) => {
  const started = Date.now();
  const times: number[] = [];
  t.mock.method(globalThis, 'fetch', async () => {
    times.push(Date.now() - started);
    return new Response('{}');
  });
  await Promise.all(Array.from({ length: 8 }, () => apiFetch('concurrent@example.test', 'https://example.test')));
  assert.equal(times.length, 8);
  assert.ok(times[5] >= 150, `sixth request at ${times[5]}ms`);
  assert.ok(times[6] >= 330, `seventh request at ${times[6]}ms`);
  assert.ok(times[7] >= 520, `eighth request at ${times[7]}ms`);
});

test('Retry-After parses both numeric seconds and HTTP dates', () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(parseRetryAfterMs('1.5', now), 1500);
  assert.equal(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', now), 5000);
  assert.equal(parseRetryAfterMs(null, now), 0);
  assert.equal(parseRetryAfterMs('invalid', now), 0);
  assert.equal(parseRetryAfterMs('-1', now), 0);
});

test('long Retry-After returns 429 without retrying earlier than permitted', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', {
    status: 429, headers: { 'Retry-After': '3600' },
  }));
  assert.equal((await apiFetch('long-retry@example.test', 'https://example.test')).status, 429);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('retry releases the previous response and preserves options', async (t) => {
  let calls = 0;
  let released = false;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.equal((options.headers as Record<string, string>).Authorization, 'OAuth test-token');
    assert.ok(options.signal);
    calls += 1;
    return calls === 1 ? new Response(new ReadableStream({ cancel() { released = true; } }), {
      status: 429, headers: { 'Retry-After': '0.001' },
    }) : new Response('{}');
  });
  const response = await apiFetch('retry@example.test', 'https://example.test', {
    headers: { Authorization: 'OAuth test-token' },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(released, true);
});

test('aborted callers stop retries; untrusted network errors are not exposed', async (t) => {
  const controller = new AbortController();
  controller.abort();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('private upstream detail'); });
  await assert.rejects(apiFetch('abort@example.test', 'https://example.test', { signal: controller.signal }), (error) =>
    error instanceof ApiError && error.status === 504);
  assert.equal(fetchMock.mock.callCount(), 0);
  await assert.rejects(apiFetch('failure@example.test', 'https://example.test'), (error) =>
    error instanceof ApiError && error.status === 502 && !error.message.includes('private'));
  assert.equal(getSafeErrorMessage(new Error('secret')), 'Не удалось загрузить данные. Попробуйте позже.');
});

test('the per-identity queue rejects excess concurrent work', async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
  }));
  const requests = Array.from({ length: 101 }, () => apiFetch('bounded@example.test', 'https://example.test', { signal: controller.signal }));
  const settled = Promise.allSettled(requests);
  controller.abort();
  const results = await settled;
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.status === 429).length, 1);
});
