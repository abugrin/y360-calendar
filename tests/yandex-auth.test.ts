import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getUserToken } from '../lib/yandex-auth';
import { ApiError } from '../lib/api-client';

process.env.YANDEX_CLIENT_ID = 'test-client';
process.env.YANDEX_CLIENT_SECRET = 'test-secret';

test('concurrent case-normalized identities share one exchange and short token cache', async (t) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    assert.equal((options.body as URLSearchParams).get('subject_token'), 'alice@example.test');
    await pending;
    return Response.json({ access_token: 'test-access', token_type: 'bearer', expires_in: 60 });
  });
  const first = getUserToken(' Alice@Example.test ');
  const second = getUserToken('alice@example.test');
  release();
  assert.equal((await first).access_token, 'test-access');
  assert.equal((await second).access_token, 'test-access');
  assert.ok((await getUserToken('alice@example.test')).expires_in > 0);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('malformed OAuth responses are never cached and the next exchange can recover', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return Response.json(calls === 1 ? { access_token: 'bad', expires_in: -1 } : {
      access_token: 'valid', token_type: 'bearer', expires_in: 3600,
    });
  });
  await assert.rejects(getUserToken('recovery@example.test'), ApiError);
  assert.equal((await getUserToken('recovery@example.test')).access_token, 'valid');
  assert.equal(calls, 2);
});

test('OAuth response errors do not disclose provider payloads', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error_description: 'private token value' }, { status: 401 }));
  await assert.rejects(getUserToken('denied@example.test'), (error) =>
    error instanceof ApiError && error.status === 502 && !error.message.includes('private'));
});

test('invalid email is rejected before credentials or network calls', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  await assert.rejects(getUserToken('bad-email'), (error) => error instanceof ApiError && error.status === 400);
  assert.equal(fetchMock.mock.callCount(), 0);
});
