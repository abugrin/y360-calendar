import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWeekRange, getWeekDays, shiftWeek } from '../lib/week';
import { isValidDateOnly, isValidEmail } from '../lib/validation';

test('week boundaries use Moscow date and normalize arbitrary dates to Monday', () => {
  assert.equal(getWeekRange(undefined, new Date('2026-09-20T21:30:00Z')).weekStart, '2026-09-21');
  assert.deepEqual(getWeekRange('2026-09-17'), { weekStart: '2026-09-14', from: '2026-09-14T00:00:00+03:00', to: '2026-09-19T00:00:00+03:00' });
  assert.equal(shiftWeek('2025-12-29', 'next'), '2026-01-05');
  assert.equal(getWeekDays('2026-09-17').length, 5);
});

test('invalid dates and emails are rejected before calling providers', () => {
  for (const date of ['2026-02-29', '2026-13-01', '2026-01-32', 'invalid']) {
    assert.equal(isValidDateOnly(date), false);
    assert.throws(() => getWeekRange(date));
  }
  assert.equal(isValidDateOnly('2024-02-29'), true);
  for (const email of ['name', 'a@b', 'a\n@example.test', 'a@b@example.test']) assert.equal(isValidEmail(email), false);
  assert.equal(isValidEmail('first.last+tag@example.test'), true);
});
