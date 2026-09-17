import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DirectoryAccessError, DirectoryCache, DIRECTORY_TTL_MS, DIRECTORY_RETRY_MS } from '../lib/directory-cache';
import { loadDirectory } from '../lib/directory-api';
import type { DirectoryUser } from '../lib/directory-types';

const user: DirectoryUser = {
  id: '1', email: 'anna@example.test', firstName: 'Анна', lastName: 'Семёнова',
  middleName: 'Ивановна', displayName: 'Customer Success',
};
const noTimer = () => () => undefined;

test('directory caches one full load across concurrent searches and renews after one hour', async () => {
  let now = 0;
  let loads = 0;
  const cache = new DirectoryCache(async () => { loads++; return [user]; }, () => now, noTimer);
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.search('семенова анна')));
  assert.equal(loads, 1);
  assert.equal(results[0].users[0].email, user.email);
  for (const query of ['АННА', 'Ивановна', 'Success', 'anna@', 'Анна   Семёнова']) {
    assert.equal((await cache.search(query)).totalMatches, 1);
  }
  assert.deepEqual((await cache.search('')).users, []);
  assert.equal((await cache.search('нет совпадений')).totalMatches, 0);
  now = DIRECTORY_TTL_MS - 1;
  await cache.search('anna');
  assert.equal(loads, 1);
  now++;
  await Promise.all([cache.search('anna'), cache.search('анна')]);
  assert.equal(loads, 2);
});

test('partial refresh never replaces snapshot; errors back off and old data expires', async () => {
  let now = 0;
  let fail = false;
  let loads = 0;
  const cache = new DirectoryCache(async () => {
    loads++;
    if (fail) throw new Error('upstream failed');
    return [user];
  }, () => now, noTimer);
  await cache.search('anna');
  fail = true;
  now = DIRECTORY_TTL_MS;
  assert.equal((await cache.search('anna')).stale, true);
  assert.equal((await cache.search('anna')).users.length, 1);
  assert.equal(loads, 2);
  now += DIRECTORY_RETRY_MS;
  fail = false;
  assert.equal((await cache.search('anna')).stale, false);
  assert.equal(loads, 3);
  fail = true;
  now += DIRECTORY_TTL_MS * 24;
  await assert.rejects(cache.search('anna'));
});

test('cold-cache failures back off without permanently poisoning later loads', async () => {
  let now = 0;
  let loads = 0;
  const cache = new DirectoryCache(async () => {
    if (++loads === 1) throw new Error('unavailable');
    return [user];
  }, () => now, noTimer);
  await assert.rejects(cache.search('anna'));
  await assert.rejects(cache.search('anna'));
  assert.equal(loads, 1);
  now = DIRECTORY_RETRY_MS;
  assert.equal((await cache.search('anna')).users.length, 1);
});

test('revoked provider access immediately invalidates a previously cached directory', async () => {
  let now = 0;
  const cache = new DirectoryCache(async () => {
    if (now) throw new DirectoryAccessError('Forbidden');
    return [user];
  }, () => now, noTimer);
  await cache.search('anna');
  now = DIRECTORY_TTL_MS;
  await assert.rejects(cache.search('anna'), DirectoryAccessError);
  await assert.rejects(cache.search('anna'));
});

test('hourly refresh is scheduled even without another search and disposal cancels it', async () => {
  let now = 0;
  let refresh: (() => void) | undefined;
  let scheduledDelay = 0;
  let cancelled = false;
  let loads = 0;
  const cache = new DirectoryCache(async () => { loads++; return [user]; }, () => now, (callback, delay) => {
    refresh = callback;
    scheduledDelay = delay;
    return () => { cancelled = true; };
  });
  await cache.search('');
  assert.equal(scheduledDelay, DIRECTORY_TTL_MS);
  now = DIRECTORY_TTL_MS;
  refresh!();
  await cache.search('anna');
  assert.equal(loads, 2);
  cache.dispose();
  assert.equal(cancelled, true);
});

test('only the first twenty matches are returned to the browser', async () => {
  const cache = new DirectoryCache(async () => Array.from({ length: 1500 }, (_, i) => ({ ...user, id: String(i) })), Date.now, noTimer);
  const result = await cache.search('Анна');
  assert.equal(result.total, 1500);
  assert.equal(result.totalMatches, 1500);
  assert.equal(result.users.length, 20);
});

test('provider loads more than 1000 users using exact limit/offset contract', async (t) => {
  const offsets: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v1/directory/organizations/123/users');
    assert.equal(options.headers && (options.headers as Record<string, string>).Authorization, 'OAuth test-token');
    assert.equal(url.searchParams.get('limit'), '1000');
    const offset = Number(url.searchParams.get('offset'));
    offsets.push(offset);
    const items = Array.from({ length: offset === 0 ? 1000 : 501 }, (_, i) => ({
      id: String(offset + i + 1), email: `user${offset + i}@example.test`,
      name: { first: 'Анна', last: 'Семёнова' }, display_name: 'Display Name',
    }));
    return Response.json({ items, offset, limit: 1000, total: 1501 });
  });
  const result = await loadDirectory('test-token', '123');
  assert.deepEqual(offsets, [0, 1000]);
  assert.equal(result.length, 1501);
  assert.equal(result[1500].displayName, 'Display Name');
});

test('provider rejects incomplete pages instead of silently caching partial data', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    items: [{ id: '1', email: 'user@example.test' }], offset: 0, limit: 1000, total: 1501,
  }));
  await assert.rejects(loadDirectory('test-token', '456'), /Неполный/);
});

test('robots are excluded without truncating pagination, including full pages of robots', async (t) => {
  const offsets: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const offset = Number(new URL(String(input)).searchParams.get('offset'));
    offsets.push(offset);
    const items = offset === 0
      ? Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 1), is_robot: true }))
      : [{ id: '1001', email: 'human@example.test', is_robot: false }];
    return Response.json({ items, offset, limit: 1000, total: 1001 });
  });
  const result = await loadDirectory('test-token', 'robots-test');
  assert.deepEqual(offsets, [0, 1000]);
  assert.equal(result.length, 1);
  assert.equal(result[0].email, 'human@example.test');
});

test('a directory containing only robots is a valid empty employee list', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    items: [{ id: '1', email: 'robot@example.test', is_robot: true }], offset: 0, limit: 1000, total: 1,
  }));
  assert.deepEqual(await loadDirectory('test-token', 'robots-only'), []);
});

test('duplicate robot IDs still invalidate a snapshot instead of masking repeated pages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    items: [{ id: '1', is_robot: true }, { id: '1', is_robot: true }], offset: 0, limit: 1000, total: 2,
  }));
  await assert.rejects(loadDirectory('test-token', 'duplicate-robots'), /Повторяющиеся/);
});

test('provider rejects repeated pages and never exposes raw provider error text', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const offset = calls++ * 1000;
    return Response.json({ items: Array.from({ length: 1000 }, (_, i) => ({ id: String(i + 1), email: 'user@example.test' })), offset, limit: 1000, total: 2000 });
  });
  await assert.rejects(loadDirectory('test-token', '789'), /Повторяющиеся/);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ secret: 'DO-NOT-EXPOSE' }, { status: 403 }));
  await assert.rejects(loadDirectory('test-token', '789'), (error: Error) => !error.message.includes('DO-NOT-EXPOSE') && error.message.includes('403'));
});
