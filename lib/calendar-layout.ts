import type { CalendarEvent } from './types';
import { addDaysToDateStr, getEventDateKey, getEventTimeMinutes } from './datetime';

export interface HourRange {
  start: number;
  end: number;
}

export interface EventSegment {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
}

export interface PositionedEvent extends EventSegment {
  topPct: number;
  heightPct: number;
  column: number;
  totalColumns: number;
  colorIndex: number;
}

export function isAllDayEvent(event: CalendarEvent): boolean {
  return Boolean(event.start.date && !event.start.date_time);
}

export function isAllDayEventOnDate(event: CalendarEvent, dateKey: string): boolean {
  if (!isAllDayEvent(event) || !event.start.date) return false;
  const endDate = event.end.date ?? addDaysToDateStr(event.start.date, 1);
  return dateKey >= event.start.date && dateKey < endDate;
}

/** Clip a timed event to one Moscow day, treating its end as exclusive. */
export function getDayEventSegment(event: CalendarEvent, dateKey: string): EventSegment | null {
  if (isAllDayEvent(event)) return null;
  const startDate = getEventDateKey(event.start);
  const endDate = getEventDateKey(event.end);
  const startTime = getEventTimeMinutes(event.start.date_time);
  const endTime = getEventTimeMinutes(event.end.date_time);
  if (!startDate || !endDate || startTime === null || endTime === null) return null;
  if (endDate < startDate || (endDate === startDate && endTime <= startTime)) return null;
  if (dateKey < startDate || dateKey > endDate) return null;
  const startMin = dateKey === startDate ? startTime : 0;
  const endMin = dateKey === endDate ? endTime : 24 * 60;
  return endMin > startMin ? { event, startMin, endMin } : null;
}

export function getVisibleHourRange(events: CalendarEvent[], dateKeys: string[]): HourRange {
  let start = 8;
  let end = 21;
  for (const dateKey of dateKeys) {
    for (const event of events) {
      const segment = getDayEventSegment(event, dateKey);
      if (!segment) continue;
      start = Math.min(start, Math.floor(segment.startMin / 60));
      end = Math.max(end, Math.ceil(segment.endMin / 60));
    }
  }
  return { start, end };
}

/** Allocate columns within connected overlap groups, including minimum card height. */
export function layoutDayEvents(events: CalendarEvent[], dateKey: string, range: HourRange): PositionedEvent[] {
  const lower = range.start * 60;
  const upper = range.end * 60;
  const totalMinutes = upper - lower;
  if (totalMinutes <= 0) return [];
  const minimumMinutes = Math.min(20, totalMinutes);
  const items = events.flatMap((event, colorIndex) => {
    const segment = getDayEventSegment(event, dateKey);
    if (!segment || segment.endMin <= lower || segment.startMin >= upper) return [];
    const startMin = Math.min(Math.max(segment.startMin, lower), upper - minimumMinutes);
    const endMin = Math.min(Math.max(segment.endMin, startMin + minimumMinutes), upper);
    return [{
      event, startMin, endMin, colorIndex,
      topPct: ((startMin - lower) / totalMinutes) * 100,
      heightPct: ((endMin - startMin) / totalMinutes) * 100,
      column: 0, totalColumns: 1,
    }];
  }).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.colorIndex - b.colorIndex);

  let group: PositionedEvent[] = [];
  let groupEnd = lower;
  let columnEnds: number[] = [];
  function finishGroup() {
    for (const item of group) item.totalColumns = columnEnds.length;
  }
  for (const item of items) {
    if (item.startMin >= groupEnd) {
      finishGroup();
      group = [];
      columnEnds = [];
    }
    let column = columnEnds.findIndex((endMin) => endMin <= item.startMin);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = item.endMin;
    item.column = column;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  finishGroup();
  return items;
}
