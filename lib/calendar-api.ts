import 'server-only';
import type { CalendarEvent, EventDateTime, Participant } from './types';
import { apiFetch, ApiError } from './api-client';
import { DISPLAY_TIME_ZONE, normalizeRecurrenceId } from './datetime';
import { getWeekRange } from './week';

const CALENDAR_API_URL = 'https://cloud-api.yandex.net/v1/calendar/events';
const MAX_PAGES = 1_000;
const PAGINATION_TIMEOUT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEventDateTime(value: unknown): value is EventDateTime {
  return isRecord(value) &&
    (typeof value.date === 'string' || typeof value.date_time === 'string') &&
    (value.date === undefined || typeof value.date === 'string') &&
    (value.date_time === undefined || typeof value.date_time === 'string');
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!isRecord(value) || typeof value.event_id !== 'string' ||
      typeof value.summary !== 'string' || !isEventDateTime(value.start) || !isEventDateTime(value.end)) return false;
  for (const key of ['description', 'location', 'organizer', 'relation_type', 'recurrence_id']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return false;
  }
  if (value.repetition != null) {
    if (!isRecord(value.repetition) || typeof value.repetition.freq !== 'string') return false;
    const weekly = value.repetition.weekly;
    if (weekly != null && (!isRecord(weekly) || !Array.isArray(weekly.week_days) ||
        !weekly.week_days.every((day) => typeof day === 'string'))) return false;
  }
  return true;
}

function isParticipant(value: unknown): value is Participant {
  return isRecord(value) && ['participation_id', 'participation_type', 'email', 'decision']
    .every((key) => typeof value[key] === 'string');
}

async function getAllPages<T>(
  email: string,
  accessToken: string,
  baseUrl: URL,
  isItem: (value: unknown) => value is T,
  callerSignal?: AbortSignal,
): Promise<T[]> {
  const allItems: T[] = [];
  const seenKeys = new Set<string>();
  const deadline = AbortSignal.timeout(PAGINATION_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([deadline, callerSignal]) : deadline;
  let iterationKey: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', '100');
    if (iterationKey) url.searchParams.set('iteration_key', iterationKey);
    const response = await apiFetch(email, url.toString(), {
      headers: { Authorization: `OAuth ${accessToken}` },
      cache: 'no-store',
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = [403, 404, 429].includes(response.status) ? response.status : 502;
      throw new ApiError(`Не удалось загрузить данные календаря (Calendar API ${response.status}).`, status);
    }

    const data: unknown = await response.json().catch(() => null);
    if (!isRecord(data) || !Array.isArray(data.items) || data.items.length > 100 ||
        !data.items.every(isItem) ||
        (data.iteration_key !== undefined && typeof data.iteration_key !== 'string')) {
      throw new ApiError('Calendar API вернул некорректный ответ.');
    }
    allItems.push(...data.items);
    iterationKey = data.iteration_key as string | undefined;
    if (!iterationKey) return allItems;
    if (seenKeys.has(iterationKey)) throw new ApiError('Calendar API повторил страницу результатов.');
    seenKeys.add(iterationKey);
  }
  throw new ApiError('Превышен лимит страниц Calendar API.');
}

export async function getWeekEvents(
  email: string,
  accessToken: string,
  weekStartStr?: string,
): Promise<CalendarEvent[]> {
  const { from, to } = getWeekRange(weekStartStr);
  const url = new URL(CALENDAR_API_URL);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('time_zone', DISPLAY_TIME_ZONE);
  return getAllPages(email, accessToken, url, isCalendarEvent);
}

export async function getEventParticipants(
  email: string,
  accessToken: string,
  eventId: string,
  recurrenceId?: string,
  signal?: AbortSignal,
): Promise<Participant[]> {
  const url = new URL(`${CALENDAR_API_URL}/${encodeURIComponent(eventId)}/participants`);
  if (recurrenceId) url.searchParams.set('recurrence_id', normalizeRecurrenceId(recurrenceId));
  return getAllPages(email, accessToken, url, isParticipant, signal);
}
