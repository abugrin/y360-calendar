import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/participants/route';

const eventId = '019e8789-8457-7373-bec6-932a3b15c6b7';
process.env.YANDEX_CLIENT_ID = 'test-client';
process.env.YANDEX_CLIENT_SECRET = 'test-secret';

test('participants rejects invalid inputs before impersonation', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const invalidQueries: Record<string, string>[] = [
    { email: 'bad', event_id: eventId },
    { email: 'user@example.test', event_id: '../other' },
    { email: 'user@example.test', event_id: eventId, recurrence_id: '2026-02-30T12:00:00' },
    { email: 'user@example.test', event_id: eventId, recurrence_id: '2026-09-14T25:00:00' },
  ];
  for (const query of invalidQueries) {
    const response = await GET(new NextRequest(`http://localhost/api/participants?${new URLSearchParams(query)}`));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('participants performs OAuth and pagination and prevents response caching', async (t) => {
  const participant = { participation_id: 'p1', participation_type: 'ATTENDEE', email: 'user@example.test', decision: 'ACCEPTED' };
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('oauth.yandex.ru')) return Response.json({ access_token: 'test-token', token_type: 'bearer', expires_in: 3600 });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('recurrence_id'), '2026-09-14T12:00:00');
    return Response.json(parsed.searchParams.has('iteration_key') ? { items: [] } : { items: [participant], iteration_key: 'page2' });
  });
  const query = new URLSearchParams({ email: 'route@example.test', event_id: eventId, recurrence_id: '2026-09-14T12:00:00+03:00' });
  const response = await GET(new NextRequest(`http://localhost/api/participants?${query}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { limit: 1, items: [participant] });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(fetchMock.mock.callCount(), 3);
});
