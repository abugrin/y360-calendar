import { DISPLAY_TIME_ZONE, toMoscowDateTime } from './datetime';
import { isValidDateOnly } from './validation';

export interface WeekRange {
  from: string;
  to: string;
  weekStart: string;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Calendar arithmetic is independent of the server/browser timezone. */
export function getWeekRange(weekStartStr?: string, now = new Date()): WeekRange {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const input = weekStartStr ?? today;
  if (!isValidDateOnly(input)) throw new Error('Некорректная дата недели');
  const monday = new Date(`${input}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStart = dateKey(monday);
  const saturday = new Date(monday);
  saturday.setUTCDate(saturday.getUTCDate() + 5);
  return { from: toMoscowDateTime(weekStart), to: toMoscowDateTime(dateKey(saturday)), weekStart };
}

export function getWeekDays(weekStartStr?: string): Date[] {
  const { weekStart } = getWeekRange(weekStartStr);
  const monday = new Date(`${weekStart}T00:00:00Z`);
  return Array.from({ length: 5 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(day.getUTCDate() + index);
    return new Date(`${dateKey(day)}T12:00:00`);
  });
}

export function shiftWeek(weekStartStr: string, direction: 'prev' | 'next'): string {
  const date = new Date(`${getWeekRange(weekStartStr).weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (direction === 'next' ? 7 : -7));
  return dateKey(date);
}
