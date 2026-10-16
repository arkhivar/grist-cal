import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fromSchoolInput } from '../src/domain.js';
import { BUSINESS_START, BUSINESS_END, getHourVisibility } from '../src/calendar-hours.js';

const lesson = (id, start, end) => ({ id, start: fromSchoolInput(start), end: fromSchoolInput(end) });
const period = { startDate: '2026-10-13', endDate: '2026-10-14', businessHoursOnly: true };

test('school hours use exact half-open boundaries and preserve fractional edge overlaps', () => {
  assert.equal(BUSINESS_START, '08:00:00');
  assert.equal(BUSINESS_END, '22:00:00');
  const rows = [
    lesson('ends-at-opening', '2026-10-13T07:00', '2026-10-13T08:00'),
    lesson('starts-at-closing', '2026-10-13T22:00', '2026-10-13T23:00'),
    lesson('exact-window', '2026-10-13T08:00', '2026-10-13T22:00'),
    lesson('morning-edge', '2026-10-13T07:59:59.999', '2026-10-13T08:00:00.001'),
    lesson('evening-edge', '2026-10-13T21:59:59.999', '2026-10-13T22:00:00.001'),
    lesson('inside', '2026-10-13T09:00', '2026-10-13T10:00'),
  ];
  assert.deepEqual(getHourVisibility(rows, period), { total: 6, shown: 4, outside: 2, clipped: 2 });
});

test('overnight and multi-day lessons count once across separate daily windows', () => {
  const rows = [
    lesson('overnight-visible', '2026-10-13T21:00', '2026-10-14T09:00'),
    lesson('overnight-hidden', '2026-10-13T22:00', '2026-10-14T08:00'),
    lesson('multiple-days', '2026-10-13T09:00', '2026-10-15T09:00'),
  ];
  assert.deepEqual(getHourVisibility(rows, { ...period, endDate: '2026-10-16' }),
    { total: 3, shown: 2, outside: 1, clipped: 2 });
});

test('only the portion intersecting the requested school-date period is counted', () => {
  const rows = [
    lesson('ends-at-period-start', '2026-10-12T21:00', '2026-10-13T00:00'),
    lesson('starts-at-period-end', '2026-10-14T00:00', '2026-10-14T09:00'),
    lesson('visible-only-before-period', '2026-10-12T21:00', '2026-10-13T07:00'),
    lesson('visible-only-after-period', '2026-10-13T23:00', '2026-10-14T09:00'),
    lesson('arrives-in-period', '2026-10-12T21:00', '2026-10-13T09:00'),
    lesson('leaves-period', '2026-10-13T21:00', '2026-10-14T09:00'),
  ];
  assert.deepEqual(getHourVisibility(rows, period), { total: 4, shown: 2, outside: 2, clipped: 2 });
});

test('full-day mode includes every period-overlapping lesson without clipping', () => {
  const rows = [
    lesson('early', '2026-10-13T00:00', '2026-10-13T07:00'),
    lesson('overnight', '2026-10-12T21:00', '2026-10-13T09:00'),
    lesson('late', '2026-10-13T23:00', '2026-10-14T09:00'),
    lesson('outside-period', '2026-10-14T00:00', '2026-10-14T09:00'),
  ];
  assert.deepEqual(getHourVisibility(rows, { ...period, businessHoursOnly: false }),
    { total: 3, shown: 3, outside: 0, clipped: 0 });
});

test('counts distinct lesson identities without changing caller records or empty selections', () => {
  const one = lesson('one', '2026-10-13T09:00', '2026-10-13T10:00');
  const two = { ...one, id: 'two', status: 'cancelled' };
  const rows = Object.freeze([Object.freeze(one), Object.freeze({ ...one }), Object.freeze(two)]);
  assert.deepEqual(getHourVisibility(rows, period), { total: 2, shown: 2, outside: 0, clipped: 0 });
  assert.deepEqual(getHourVisibility([], period), { total: 0, shown: 0, outside: 0, clipped: 0 });
  assert.deepEqual(getHourVisibility(rows, { ...period, endDate: period.startDate }),
    { total: 0, shown: 0, outside: 0, clipped: 0 });
  assert.deepEqual(rows[0], lesson('one', '2026-10-13T09:00', '2026-10-13T10:00'));
});

test('daily windows cross month/year boundaries using school dates', () => {
  const rows = [lesson('new-year', '2026-12-31T21:00', '2027-01-01T09:00'),
    lesson('new-year-hidden', '2027-01-01T22:00', '2027-01-02T07:00')];
  assert.deepEqual(getHourVisibility(rows, { startDate: '2026-12-31', endDate: '2027-01-03', businessHoursOnly: true }),
    { total: 2, shown: 1, outside: 1, clipped: 1 });
});

test('visibility uses Asia/Vladivostok independently of the device timezone', () => {
  const moduleUrl = new URL('../src/calendar-hours.js', import.meta.url).href;
  const script = `import { getHourVisibility } from ${JSON.stringify(moduleUrl)};
    const rows = [
      {id:'morning',start:'2026-10-12T22:00:00.000Z',end:'2026-10-12T23:00:00.000Z'},
      {id:'night',start:'2026-10-13T12:00:00.000Z',end:'2026-10-13T13:00:00.000Z'},
      {id:'edge',start:'2026-10-12T21:30:00.000Z',end:'2026-10-12T22:30:00.000Z'}];
    console.log(JSON.stringify(getHourVisibility(rows, ${JSON.stringify(period)})));`;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, TZ } }).trim());
  assert.equal(new Set(results).size, 1);
  assert.deepEqual(JSON.parse(results[0]), { total: 3, shown: 2, outside: 1, clipped: 1 });
});
