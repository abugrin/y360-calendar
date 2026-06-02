import type { CalendarEvent, GetEventsResponse } from './types';
import { apiFetch } from './api-client';

const CALENDAR_API_URL = 'https://cloud-api.yandex.net/v1/calendar/events';
const TIME_ZONE = 'Europe/Moscow';

export interface WeekRange {
  fromDate: string;
  toDate: string;
}

/**
 * Returns the Monday and Friday dates (YYYY-MM-DD) for the week
 * containing the given date string (or current week if omitted).
 */
export function getWeekRange(weekStartStr?: string): WeekRange {
  let monday: Date;

  if (weekStartStr) {
    monday = new Date(weekStartStr + 'T00:00:00');
  } else {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    monday = new Date(now);
    monday.setDate(now.getDate() + diff);
  }

  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);

  return {
    fromDate: formatDate(monday),
    toDate: formatDate(friday),
  };
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getWeekDays(weekStartStr?: string): Date[] {
  const { fromDate } = getWeekRange(weekStartStr);
  const monday = new Date(fromDate + 'T00:00:00');
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function shiftWeek(weekStartStr: string, direction: 'prev' | 'next'): string {
  const date = new Date(weekStartStr + 'T00:00:00');
  date.setDate(date.getDate() + (direction === 'next' ? 7 : -7));
  return formatDate(date);
}

export async function getWeekEvents(
  email: string,
  accessToken: string,
  weekStartStr?: string,
): Promise<CalendarEvent[]> {
  const { fromDate, toDate } = getWeekRange(weekStartStr);

  const allItems: CalendarEvent[] = [];
  let iterationKey: string | undefined;

  do {
    const url = new URL(CALENDAR_API_URL);
    url.searchParams.set('from_date', fromDate);
    url.searchParams.set('to_date', toDate);
    url.searchParams.set('time_zone', TIME_ZONE);
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
