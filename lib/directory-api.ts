import 'server-only';
import { createHash } from 'node:crypto';
import { apiFetch } from './api-client';
import { DirectoryAccessError, DirectoryCache } from './directory-cache';
import type { DirectoryUser } from './directory-types';
import { isValidEmail } from './validation';

const PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
const API_URL = 'https://cloud-api.yandex.net/v1/directory/organizations';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

function parseId(value: unknown): string {
  if (!record(value) || !((typeof value.id === 'string' && /^\d+$/.test(value.id)) ||
      (typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0))) {
    throw new Error('Некорректный идентификатор в справочнике сотрудников');
  }
  return String(value.id);
}

function parseUser(value: unknown, id: string): DirectoryUser {
  if (!record(value) || !isValidEmail(text(value.email))) {
    throw new Error('Некорректный ответ справочника сотрудников');
  }
  const name = record(value.name) ? value.name : {};
  const firstName = text(name.first);
  const lastName = text(name.last);
  const middleName = text(name.middle);
  return {
    id, email: text(value.email), firstName, lastName, middleName,
    displayName: text(value.display_name) || [firstName, lastName].filter(Boolean).join(' ') || text(value.email),
  };
}

/** Contract: get-users.md, verified 2026-09-17; limit/offset, not page/perPage. */
export async function loadDirectory(token: string, orgId: string): Promise<DirectoryUser[]> {
  const users: DirectoryUser[] = [];
  const ids = new Set<string>();
  let expectedTotal: number | undefined;
  let offset = 0;
  let limit = PAGE_SIZE;
  let processedUsers = 0;
  const signal = AbortSignal.timeout(120_000);

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${API_URL}/${encodeURIComponent(orgId)}/users`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    const response = await apiFetch(`directory:${orgId}`, url.toString(), {
      headers: { Authorization: `OAuth ${token}` }, cache: 'no-store', signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([400, 401, 403, 404].includes(response.status)) {
        throw new DirectoryAccessError(`Нет доступа к справочнику сотрудников (HTTP ${response.status})`);
      }
      throw new Error(`Справочник сотрудников недоступен (HTTP ${response.status})`);
    }
    const data: unknown = await response.json();
    if (!record(data) || !Array.isArray(data.items) ||
        typeof data.total !== 'number' || !Number.isSafeInteger(data.total) || data.total < 0 ||
        typeof data.limit !== 'number' || !Number.isSafeInteger(data.limit) || data.limit < 1 || data.limit > limit ||
        data.offset !== offset || data.items.length > data.limit ||
        (offset > 0 && data.limit !== limit)) {
      throw new Error('Некорректная пагинация справочника сотрудников');
    }
    limit = data.limit;
    expectedTotal ??= data.total;
    if (data.total !== expectedTotal) throw new Error('Справочник изменился во время загрузки. Повторите позже.');
    for (const item of data.items) {
      const id = parseId(item);
      if (ids.has(id)) throw new Error('Повторяющиеся страницы справочника сотрудников');
      ids.add(id);
      processedUsers++;
      if (record(item) && item.is_robot === true) continue;
      users.push(parseUser(item, id));
    }
    if (processedUsers === expectedTotal) return users;
    if (processedUsers > expectedTotal || data.items.length !== limit) {
      throw new Error('Неполный ответ справочника сотрудников');
    }
    offset += limit;
  }
  throw new Error('Превышен предел страниц справочника сотрудников');
}

const shared = globalThis as typeof globalThis & {
  directoryCache?: { identity: string; cache: DirectoryCache };
};

export function getDirectoryCache(): DirectoryCache {
  const token = process.env.TOKEN?.trim();
  const orgId = process.env.ORG_ID?.trim();
  if (!token || !orgId || !/^\d+$/.test(orgId)) {
    shared.directoryCache?.cache.dispose();
    shared.directoryCache = undefined;
    throw new Error('Для поиска сотрудников настройте TOKEN и ORG_ID на сервере');
  }
  const identity = createHash('sha256').update(`${orgId}:${token}`).digest('hex');
  if (shared.directoryCache?.identity !== identity) {
    shared.directoryCache?.cache.dispose();
    shared.directoryCache = { identity, cache: new DirectoryCache(() => loadDirectory(token, orgId)) };
  }
  return shared.directoryCache.cache;
}
