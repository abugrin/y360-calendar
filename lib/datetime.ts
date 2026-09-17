import type { EventDateTime } from './types';

export const DISPLAY_TIME_ZONE = 'Europe/Moscow';
const MOSCOW_OFFSET = '+03:00';
const displayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

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
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  if (start.date_time) return getDisplayDateTime(start.date_time)?.dateKey ?? null;
  if (start.date) return start.date;
  return null;
}

/** Offset-free Calendar API values use the requested Europe/Moscow timezone. */
function getDisplayDateTime(dateTime: string): { dateKey: string; minutes: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateTime)) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/i.test(dateTime);
  const instant = new Date(hasOffset ? dateTime : `${dateTime}${MOSCOW_OFFSET}`);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(displayFormatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function getEventTimeMinutes(dateTime?: string): number | null {
  if (!dateTime) return null;
  return getDisplayDateTime(dateTime)?.minutes ?? null;
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
