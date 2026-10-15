import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { SCHOOL_TIME_ZONE, schoolToday, schoolInput, preciseSchoolInput, fromSchoolInput,
  formatSchoolTime, shiftDate, startOfWeek, selectCalendarLessons } from '../src/domain.js';
import { createDemoData } from '../src/demo-data.js';

test('school time crosses midnight correctly and round-trips with offsets', () => {
  assert.equal(SCHOOL_TIME_ZONE, 'Asia/Vladivostok');
  assert.equal(schoolToday(new Date('2026-10-12T14:01:00Z')), '2026-10-13');
  assert.equal(schoolInput('2026-10-12T14:01:00Z'), '2026-10-13T00:01');
  assert.equal(schoolInput('2026-10-12T09:01:00-05:00'), '2026-10-13T00:01');
  assert.equal(fromSchoolInput('2026-10-13T00:01'), '2026-10-12T14:01:00.000Z');
  assert.equal(formatSchoolTime('2026-10-13T09:15:00+10:00'), '09:15');
});

test('precise editor values retain seconds and milliseconds without changing minute-only formatting', () => {
  for (const [instant, input] of [
    ['2026-10-12T14:01:00.000Z', '2026-10-13T00:01'],
    ['2026-10-12T14:01:30.000Z', '2026-10-13T00:01:30'],
    ['2026-10-12T14:01:00.001Z', '2026-10-13T00:01:00.001'],
    ['2026-10-12T14:01:30.120Z', '2026-10-13T00:01:30.12'],
    ['2026-10-12T14:01:59.999Z', '2026-10-13T00:01:59.999'],
    ['1960-01-01T00:00:30.250Z', '1960-01-01T10:00:30.25'],
  ]) {
    assert.equal(preciseSchoolInput(instant), input);
    assert.equal(fromSchoolInput(input), instant);
    assert.equal(schoolInput(instant), input.slice(0, 16));
  }
  assert.equal(fromSchoolInput('2026-10-13T00:01:00'), '2026-10-12T14:01:00.000Z');
  assert.equal(fromSchoolInput('2026-10-13T00:01:30.1'), '2026-10-12T14:01:30.100Z');
  assert.equal(preciseSchoolInput('2026-10-13T00:01:30.125+10:00'), '2026-10-13T00:01:30.125');
});

test('date navigation is Monday-based and survives leap/month/year boundaries', () => {
  assert.equal(startOfWeek('2026-10-18'), '2026-10-12');
  assert.equal(startOfWeek('2026-10-12'), '2026-10-12');
  assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDate('2026-10-31', 1), '2026-11-01');
});

test('invalid dates, times, and timezone-less instants are rejected', () => {
  for (const input of ['2026-02-29T12:00', '2026-04-31T12:00', '2026-13-01T12:00',
    '2026-10-13T24:00', '2026-10-13T12:60', 'garbage', '0000-01-01T00:00',
    '2026-10-13T12:00:60', '2026-10-13T12:00:00.1234', '2026-10-13T12:00.5',
    '2026-10-13T12:00:30Z', '2026-10-13T12:00:30.']) {
    assert.throws(() => fromSchoolInput(input), { code: 'VALIDATION_ERROR' });
  }
  assert.throws(() => schoolInput('2026-02-30T12:00:00Z'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => schoolInput('2026-10-13T12:00'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => shiftDate('2026-02-30', 1), { code: 'VALIDATION_ERROR' });
  assert.throws(() => shiftDate('2026-10-13', 1.5), { code: 'VALIDATION_ERROR' });
});

test('school date calculations are identical under different process timezones', () => {
  const moduleUrl = new URL('../src/domain.js', import.meta.url).href;
  const script = `import {schoolToday, schoolInput, preciseSchoolInput, fromSchoolInput, startOfWeek} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify([schoolToday(new Date('2026-10-12T14:01:00Z')),
      schoolInput('2026-10-12T14:01:00Z'), fromSchoolInput('2026-10-13T09:00'), startOfWeek('2026-10-18'),
      preciseSchoolInput('2026-10-12T14:01:30.125Z'), fromSchoolInput('2026-10-13T00:01:30.125')]));`;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'].map((TZ) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, TZ } }).trim());
  assert.equal(new Set(results).size, 1);
  assert.deepEqual(JSON.parse(results[0]), ['2026-10-13', '2026-10-13T00:01', '2026-10-12T23:00:00.000Z', '2026-10-12',
    '2026-10-13T00:01:30.125', '2026-10-12T14:01:30.125Z']);
});

test('fixtures anchor to the school week, keep stable IDs, and use only explicit lessons as events', () => {
  const first = createDemoData('2026-10-13');
  const second = createDemoData('2026-10-20');
  assert.equal(first.lessons.length, 18);
  assert.equal(first.teachers.length, 4);
  assert.deepEqual(first.lessons.map(({ id }) => id), second.lessons.map(({ id }) => id));
  assert.equal(schoolInput(first.lessons[0].start), '2026-10-12T09:00');
  assert.equal(schoolInput(second.lessons[0].start), '2026-10-19T09:00');
  assert.ok(first.attendance.some(({ studentId }) => !studentId));
  for (const lesson of first.lessons) {
    const records = first.attendance.filter(({ lessonId }) => lessonId === lesson.id);
    assert.ok(records.length >= 3 && records.length <= 6);
    assert.ok(records.every(({ type }) => type === 'attendance'));
  }
  const contaminated = { ...first, lessons: [...first.lessons, ...first.attendance, { id: 'unknown', studentId: '' }] };
  assert.equal(selectCalendarLessons(contaminated).length, first.lessons.length);
});

test('filters combine teachers and search without deriving event identity from attendance', () => {
  const data = createDemoData('2026-10-13');
  const anna = selectCalendarLessons(data, { teacherIds: ['anna'] });
  assert.ok(anna.length > 0 && anna.every(({ teacherId }) => teacherId === 'anna'));
  assert.equal(selectCalendarLessons(data, { teacherIds: [] }).length, 0);
  assert.deepEqual(selectCalendarLessons(data, { search: 'ANNA PETROVA' }), anna);
  const attendance = data.attendance.find(({ studentId }) => !studentId);
  assert.ok(selectCalendarLessons(data, { search: attendance.studentName }).some(({ id }) => id === attendance.lessonId));
  assert.equal(selectCalendarLessons(data, { teacherIds: ['mikhail'], search: 'Conversation' }).length, 0);
  assert.ok(selectCalendarLessons(data, { search: '0/4' }).length > 0);
});

test('event selection excludes deleted lessons even from an unfiltered snapshot', () => {
  const data = createDemoData('2026-10-13');
  const deleted = { ...data.lessons[0], status: 'deleted' };
  const cancelled = { ...data.lessons[1], status: 'cancelled' };
  const snapshot = { ...data, lessons: [deleted, cancelled, ...data.lessons.slice(2)] };
  assert.ok(!selectCalendarLessons(snapshot).some(lesson => lesson.id === deleted.id));
  assert.ok(!selectCalendarLessons(snapshot, { search: deleted.title }).some(lesson => lesson.id === deleted.id));
  assert.ok(selectCalendarLessons(snapshot).some(lesson => lesson.id === cancelled.id));
});

test('student search includes a pending individual booking without creating attendance', () => {
  const data = createDemoData('2026-10-13');
  const pending = { ...data.lessons[0], title: 'Preparation lesson', studentNames: ['Synthetic New Student'] };
  const snapshot = { ...data, lessons: [pending], attendance: [] };
  assert.equal(selectCalendarLessons(snapshot, { search: 'synthetic new student' }).length, 1);
  assert.equal(snapshot.attendance.length, 0);
  assert.equal(selectCalendarLessons(snapshot, { teacherIds: [], search: 'synthetic new student' }).length, 0);
});
