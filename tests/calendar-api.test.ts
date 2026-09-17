import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWeekEvents, getEventParticipants } from '../lib/calendar-api';
import { ApiError } from '../lib/api-client';

const event = {
  event_id: '019e8789-8457-7373-bec6-932a3b15c6b7',
  summary: 'Test event',
  start: { date_time: '2026-09-14T10:00:00+03:00' },
  end: { date_time: '2026-09-14T11:00:00+03:00' },
};

test('calendar pagination preserves the Moscow week interval on every page', async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(new URL(url));
    return Response.json(urls.length === 1 ? { items: [event], iteration_key: 'page-2' } : {
      items: [{ ...event, event_id: 'second' }],
    });
  });
  assert.equal((await getWeekEvents('week@example.test', 'test-token', '2026-09-14')).length, 2);
  for (const url of urls) {
    assert.equal(url.searchParams.get('from'), '2026-09-14T00:00:00+03:00');
    assert.equal(url.searchParams.get('to'), '2026-09-19T00:00:00+03:00');
    assert.equal(url.searchParams.get('time_zone'), 'Europe/Moscow');
    assert.equal(url.searchParams.get('limit'), '100');
    assert.equal(url.searchParams.has('from_date'), false);
    assert.equal(url.searchParams.has('to_date'), false);
    assert.ok(url.toString().includes('%2B03%3A00'));
    assert.equal(new Date(url.searchParams.get('from')!).toISOString(), '2026-09-13T21:00:00.000Z');
  }
  assert.equal(urls[1].searchParams.get('iteration_key'), 'page-2');
});

test('a repeated continuation key terminates instead of looping indefinitely', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ items: [], iteration_key: 'same-key' }));
  await assert.rejects(getWeekEvents('loop@example.test', 'test-token', '2026-09-14'), /повторил страницу/);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('malformed calendar pages and event shapes fail rather than becoming empty data', async (t) => {
  for (const payload of [{}, { items: null }, { items: [{}] }, { items: [], iteration_key: 123 }]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(payload));
    await assert.rejects(getWeekEvents('malformed@example.test', 'test-token', '2026-09-14'), ApiError);
    fetchMock.mock.restore();
  }
});

test('participants encode the event path and retain recurrence across pagination', async (t) => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(new URL(url));
    return Response.json(urls.length === 1 ? { items: [], iteration_key: 'next' } : { items: [] });
  });
  await getEventParticipants('participants@example.test', 'test-token', 'id/other?injected=true', '2026-09-14T10:00+03:00');
  for (const url of urls) {
    assert.ok(url.pathname.includes('id%2Fother%3Finjected%3Dtrue'));
    assert.equal(url.searchParams.get('recurrence_id'), '2026-09-14T10:00:00');
    assert.equal(url.searchParams.has('injected'), false);
  }
});

test('calendar provider errors have a safe public status and no payload echo', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'private calendar detail' }, { status: 403 }));
  await assert.rejects(getWeekEvents('error@example.test', 'test-token', '2026-09-14'), (error) =>
    error instanceof ApiError && error.status === 403 && !error.message.includes('private'));
});
