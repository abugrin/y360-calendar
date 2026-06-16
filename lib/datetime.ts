import type { EventDateTime } from './types';

export const DISPLAY_TIME_ZONE = 'Europe/Moscow';
const MOSCOW_OFFSET = '+03:00';

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** RFC 3339 datetime in Europe/Moscow (+03:00). */
export function toMoscowDateTime(dateStr: string, time = '00:00:00'): string {
  return `${dateStr}T${time}${MOSCOW_OFFSET}`;
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateOnly(date);
}

/**
 * Normalizes recurrence_id to YYYY-MM-DDTHH:mm:ss (no timezone),
 * as required by the Calendar API query parameter.
 */
export function normalizeRecurrenceId(recurrenceId: string): string {
  const withoutTz = recurrenceId.replace(/Z$/, '').replace(/([+-]\d{2}:\d{2})$/, '');
  return withoutTz.replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/, '$1:00');
}

export function getEventDateKey(start: EventDateTime): string | null {
  if (start.date_time) return start.date_time.split('T')[0];
  if (start.date) return start.date;
  return null;
}

export function getEventTimeMinutes(dateTime?: string): number | null {
  if (!dateTime) return null;
  const timePart = dateTime.split('T')[1];
  if (!timePart) return null;
  const [h, m] = timePart.split(/[Z+-]/)[0].split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function formatEventTime(dateTime?: string): string {
  if (!dateTime) return '—';
  const timePart = getEventTimeMinutes(dateTime);
  if (timePart === null) return '—';
  const h = Math.floor(timePart / 60);
  const m = timePart % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatEventFullDate(start: EventDateTime): string {
  const dateKey = getEventDateKey(start);
  if (!dateKey) return '—';
  const [year, month, day] = dateKey.split('-').map(Number);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${day} ${months[month - 1]} ${year}`;
}

export function isSameCalendarDay(day: Date, start: EventDateTime): boolean {
  const eventDate = getEventDateKey(start);
  if (!eventDate) return false;
  return eventDate === formatDateOnly(day);
}
