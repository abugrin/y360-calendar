import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDayEventSegment, getVisibleHourRange, isAllDayEventOnDate, layoutDayEvents } from '../lib/calendar-layout';
import { addDaysToDateStr, formatEventTime, getEventDateKey, getEventTimeMinutes } from '../lib/datetime';
import type { CalendarEvent } from '../lib/types';

const monday = '2026-09-14';
function timed(id: string, start: string, end: string): CalendarEvent {
  return {
    event_id: id, ical_uid: id, summary: id,
    start: { date_time: start }, end: { date_time: end },
    created_at: '', updated_at: '', relation_type: 'ATTENDEE',
    rules: { visibility: 'PUBLIC', participant_can_invite: false, participant_can_edit: false },
  };
}
function sameDay(id: string, start: string, end: string): CalendarEvent {
  return timed(id, `${monday}T${start}:00+03:00`, `${monday}T${end}:00+03:00`);
}

test('timestamps with different offsets display on the Moscow day and hour', () => {
  assert.equal(getEventDateKey({ date_time: '2026-09-13T22:30:00Z' }), monday);
  assert.equal(getEventTimeMinutes('2026-09-13T22:30:00Z'), 90);
  assert.equal(formatEventTime('2026-09-14T10:00:00+05:00'), '08:00');
  assert.equal(getEventTimeMinutes('2026-09-14T10:30:00'), 630);
  assert.equal(getEventDateKey({ date: monday }), monday);
  assert.equal(getEventTimeMinutes('invalid'), null);
  assert.equal(getEventTimeMinutes('2026-09-14T25:00:00Z'), null);
  assert.equal(addDaysToDateStr('2026-12-31', 1), '2027-01-01');
});

test('overnight events are split into daily segments with exclusive midnight end', () => {
  const event = timed('night', '2026-09-13T23:00:00+03:00', '2026-09-15T00:00:00+03:00');
  assert.equal(getDayEventSegment(event, '2026-09-12'), null);
  assert.deepEqual(getDayEventSegment(event, '2026-09-13'), { event, startMin: 1380, endMin: 1440 });
  assert.deepEqual(getDayEventSegment(event, monday), { event, startMin: 0, endMin: 1440 });
  assert.equal(getDayEventSegment(event, '2026-09-15'), null);
});

test('all-day events cover every date until the exclusive end and stay outside time grid', () => {
  const event = { ...sameDay('leave', '09:00', '10:00'), start: { date: '2026-09-13' }, end: { date: '2026-09-16' } };
  assert.equal(isAllDayEventOnDate(event, '2026-09-12'), false);
  assert.equal(isAllDayEventOnDate(event, monday), true);
  assert.equal(isAllDayEventOnDate(event, '2026-09-15'), true);
  assert.equal(isAllDayEventOnDate(event, '2026-09-16'), false);
  assert.equal(getDayEventSegment(event, monday), null);
  assert.deepEqual(layoutDayEvents([event], monday, { start: 8, end: 21 }), []);
});

test('time range expands for early and late meetings without moving them into business hours', () => {
  const events = [sameDay('early', '06:30', '07:00'), sameDay('late', '22:00', '23:30')];
  const range = getVisibleHourRange(events, [monday]);
  assert.deepEqual(range, { start: 6, end: 24 });
  const items = layoutDayEvents(events, monday, range);
  assert.equal(items.length, 2);
  assert.equal(items[0].startMin, 390);
  assert.equal(items[1].startMin, 1320);
  assert.equal(items[1].endMin, 1410);
  assert.deepEqual(getVisibleHourRange(events, ['2026-09-15']), { start: 8, end: 21 });
});

test('overlapping chain reuses free columns and keeps the entire connected group consistent', () => {
  const events = [sameDay('c', '10:30', '12:00'), sameDay('a', '09:00', '10:00'), sameDay('b', '09:30', '11:00')];
  const items = layoutDayEvents(events, monday, { start: 8, end: 21 });
  assert.deepEqual(items.map((item) => [item.event.event_id, item.column, item.totalColumns]), [
    ['a', 0, 2], ['b', 1, 2], ['c', 0, 2],
  ]);
});

test('nested meetings occupy unique columns; disjoint groups recover the full width', () => {
  const events = [
    sameDay('outer', '09:00', '12:00'), sameDay('b', '09:00', '10:00'),
    sameDay('c', '09:30', '11:00'), sameDay('later', '13:00', '14:00'),
  ];
  const items = layoutDayEvents(events, monday, { start: 8, end: 21 });
  for (const a of items) {
    assert.ok(a.column >= 0 && a.column < a.totalColumns);
    assert.ok(a.topPct >= 0 && a.topPct + a.heightPct <= 100.000001);
    for (const b of items) {
      if (a !== b && a.startMin < b.endMin && a.endMin > b.startMin) assert.notEqual(a.column, b.column);
    }
  }
  assert.equal(items.find((item) => item.event.event_id === 'later')?.totalColumns, 1);
});

test('back-to-back meetings share a column and align exactly with hourly grid lines', () => {
  const events = [sameDay('a', '08:00', '09:00'), sameDay('b', '09:00', '10:00')];
  const items = layoutDayEvents(events, monday, { start: 8, end: 21 });
  assert.equal(items[0].heightPct, 100 / 13);
  assert.equal(items[1].topPct, 100 / 13);
  assert.deepEqual(items.map((item) => item.totalColumns), [1, 1]);
});

test('short end-of-day cards remain in bounds and minimum card heights participate in overlap detection', () => {
  const events = [
    sameDay('a', '09:00', '09:01'), sameDay('b', '09:05', '09:06'),
    timed('last', `${monday}T23:59:00+03:00`, '2026-09-15T00:00:00+03:00'),
  ];
  const items = layoutDayEvents(events, monday, { start: 0, end: 24 });
  assert.notEqual(items[0].column, items[1].column);
  for (const item of items) assert.ok(item.topPct + item.heightPct <= 100.000001);
  assert.equal(items.at(-1)?.endMin, 1440);
});

test('invalid, backwards and out-of-view intervals are omitted', () => {
  const events = [sameDay('backwards', '10:00', '09:00'), timed('invalid', 'invalid', 'invalid'), sameDay('early', '06:00', '07:00')];
  assert.deepEqual(layoutDayEvents(events, monday, { start: 8, end: 21 }), []);
});
