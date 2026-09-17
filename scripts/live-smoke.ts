/** Read-only integration check. Prints aggregate counts, never identities or tokens. */
import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import { loadDirectory, getDirectoryCache } from '../lib/directory-api';
import { getUserToken } from '../lib/yandex-auth';
import { getWeekEvents, getEventParticipants } from '../lib/calendar-api';
import { getWeekRange } from '../lib/week';
import { getSafeErrorMessage } from '../lib/api-client';

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => undefined, error: () => undefined });
  if (!process.env.TOKEN || !process.env.ORG_ID) throw new Error('Missing directory configuration');
  console.log(JSON.stringify({ configuration: 'present', calendarCredentials: Boolean(process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET) }));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let sampleEmail: string | undefined;
  globalThis.fetch = async (input, options) => {
    const response = await originalFetch(input, options);
    if (String(input).includes('/directory/organizations/')) {
      requests++;
      console.log(JSON.stringify({ directoryPage: requests, httpStatus: response.status }));
      if (response.ok && !sampleEmail) {
        const data = await response.clone().json();
        sampleEmail = data.items?.find((item: { is_robot?: boolean; is_dismissed?: boolean; is_enabled?: boolean }) =>
          !item.is_robot && !item.is_dismissed && item.is_enabled)?.email;
      }
    }
    return response;
  };

  const users = await loadDirectory(process.env.TOKEN, process.env.ORG_ID);
  console.log(JSON.stringify({ directory: 'passed', users: users.length, pages: requests }));
  const cache = getDirectoryCache();
  try {
    const [preload, concurrent] = await Promise.all([cache.search(''), cache.search('')]);
    assert.equal(preload.total, users.length);
    assert.equal(preload.loadedAt, concurrent.loadedAt);
    const afterLoad = requests;
    let fieldsChecked = 0;
    const configuredSample = process.env.CALENDAR_TEST_EMAIL?.trim();
    const sample = users.find((user) => user.email === (configuredSample || sampleEmail)) ?? (configuredSample ? undefined : users[0]);
    if (configuredSample && !sample) throw new Error('Configured calendar sample is absent from directory');
    if (sample) {
      for (const field of ['email', 'firstName', 'lastName', 'displayName'] as const) {
        const query = sample[field];
        if (query.length < 2) continue;
        assert.ok((await cache.search(query)).totalMatches > 0);
        fieldsChecked++;
      }
    }
    assert.equal(requests, afterLoad);
    console.log(JSON.stringify({ cache: 'passed', preloadSingleFlight: true, searchFieldsChecked: fieldsChecked, repeatedSearchProviderRequests: 0 }));
    if (sample && process.env.YANDEX_CLIENT_ID && process.env.YANDEX_CLIENT_SECRET) {
      try {
        const token = await getUserToken(sample.email);
        const events = await getWeekEvents(sample.email, token.access_token, getWeekRange(process.env.CALENDAR_TEST_WEEK || undefined).weekStart);
        console.log(JSON.stringify({ calendar: 'passed', events: events.length }));
        if (events[0]) {
          const participants = await getEventParticipants(sample.email, token.access_token, events[0].event_id, events[0].recurrence_id);
          console.log(JSON.stringify({ participants: 'passed', count: participants.length }));
        } else console.log(JSON.stringify({ participants: 'not-tested', reason: 'No events for sampled user and week' }));
      } catch (error) {
        console.log(JSON.stringify({ calendar: 'failed', reason: getSafeErrorMessage(error) }));
        process.exitCode = 1;
      }
    } else console.log(JSON.stringify({ calendar: 'not-tested', reason: 'No users or missing service application configuration' }));
  } finally {
    cache.dispose();
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const reason = message.includes('пагинация') ? 'Invalid pagination metadata' :
    message.includes('Некорректный ответ') ? 'Invalid directory user shape' :
    message.includes('Неполный') ? 'Incomplete directory response' :
    message.includes('изменился') ? 'Directory changed during pagination' :
    message.includes('Missing') ? 'Missing directory configuration' :
    'Check network, server configuration and provider access';
  console.error(JSON.stringify({ liveSmoke: 'failed', reason, errorType: error instanceof Error ? error.name : 'unknown' }));
  process.exitCode = 1;
});
