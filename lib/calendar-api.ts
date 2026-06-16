import type { CalendarEvent, GetEventsResponse } from './types';
import { apiFetch } from './api-client';
import {
  addDaysToDateStr,
  DISPLAY_TIME_ZONE,
  formatDateOnly,
  toMoscowDateTime,
} from './datetime';

const CALENDAR_API_URL = 'https://cloud-api.yandex.net/v1/calendar/events';

export interface WeekRange {
  from: string;
  to: string;
  /** Monday date (YYYY-MM-DD) for UI navigation. */
  weekStart: string;
}

/**
 * Returns the Monday–Friday range as RFC 3339 datetimes for the Calendar API.
 * `from` is inclusive, `to` is exclusive (Saturday 00:00 in Europe/Moscow).
 */
export function getWeekRange(weekStartStr?: string): WeekRange {
  let monday: Date;

  if (weekStartStr) {
    monday = new Date(`${weekStartStr}T00:00:00`);
  } else {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday = new Date(now);
    monday.setDate(now.getDate() + diff);
  }

  const weekStart = formatDateOnly(monday);
  const saturday = addDaysToDateStr(weekStart, 5);

  return {
    from: toMoscowDateTime(weekStart),
    to: toMoscowDateTime(saturday),
    weekStart,
  };
}

export function getWeekDays(weekStartStr?: string): Date[] {
  const { weekStart } = getWeekRange(weekStartStr);
  const monday = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function shiftWeek(weekStartStr: string, direction: 'prev' | 'next'): string {
  const date = new Date(`${weekStartStr}T00:00:00`);
  date.setDate(date.getDate() + (direction === 'next' ? 7 : -7));
  return formatDateOnly(date);
}

export async function getWeekEvents(
  email: string,
  accessToken: string,
  weekStartStr?: string,
): Promise<CalendarEvent[]> {
  const { from, to } = getWeekRange(weekStartStr);

  const allItems: CalendarEvent[] = [];
  let iterationKey: string | undefined;

  do {
    const url = new URL(CALENDAR_API_URL);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('time_zone', DISPLAY_TIME_ZONE);
    url.searchParams.set('limit', '100');
    if (iterationKey) {
      url.searchParams.set('iteration_key', iterationKey);
    }

    const response = await apiFetch(email, url.toString(), {
      headers: { Authorization: `OAuth ${accessToken}` },
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(
        `Ошибка Calendar API (${response.status}): ${error.message || response.statusText}`,
      );
    }

    const data: GetEventsResponse = await response.json();
    allItems.push(...(data.items ?? []));
    iterationKey = data.iteration_key;
  } while (iterationKey);

  return allItems;
}
