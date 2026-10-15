import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ATT_FIELDS, refs, classifyRow, lessonFields, lessonVersion, normalizeAllAttSnapshot } from '../server/all-att-model.mjs';

const start = Date.parse('2026-10-12T23:00:00Z') / 1000;
const record = (id, fields) => ({ id, fields });
const row = (id, extra = {}) => record(id, {
  start, end: start + 3600, t: ['L', 17], student: ['L', 1], group2: ['L'], notes: '', ...extra,
});
const header = (id, extra = {}) => row(id, { student: ['L'], group2: ['L', 31], ...extra });
const child = (id, parent = 10, extra = {}) => row(id, { group2: ['L', 31], Calendar_Parent: parent, ...extra });
const performance = [record(17, { A: 'Teacher One', type: 'team', wage: 87654 }),
  record(18, { A: 'Teacher Two', type: 'team' }), record(31, { A: 'Group A', type: 'group' })];
const folks = [record(1, { name: 'Student One', balance: 998877 }), record(2, { name: 'Student Two' })];
const normalize = attendance => normalizeAllAttSnapshot({ attendance, performance, folks });

test('ALL_ATT classification follows student and group references, including no-student/no-group rows', () => {
  for (const student of [null, undefined, ['L'], ['E', 'Invalid'], [1], '1']) {
    assert.equal(classifyRow({ student, group2: ['L', 31] }), 'group');
    assert.equal(classifyRow({ student, group2: ['L'] }), 'group');
  }
  assert.equal(classifyRow(row(1)), 'individual');
  assert.equal(classifyRow(child(2)), 'attendance');
  assert.equal(classifyRow({ student: ['L', 2, 1, 2], group2: null }), 'individual');
  assert.deepEqual(refs(['L', 2, 1, 2, 0, '3', -1]), [1, 2]);
});

test('six group attendance rows and one header produce one event with six linked entries', () => {
  const rows = [header(10), ...Array.from({ length: 6 }, (_, index) => child(20 + index, 10, { student: ['L', index + 1] }))];
  const result = normalize(rows);
  assert.deepEqual(result.lessons.map(lesson => lesson.id), ['all-att:10']);
  assert.equal(result.lessons[0].lessonKind, 'group');
  assert.equal(result.lessons[0].title, 'Group A');
  assert.deepEqual(result.lessons[0].studentIds, []);
  assert.deepEqual(result.lessons[0].groupIds, ['per:31']);
  assert.equal(result.attendance.length, 6);
  assert.ok(result.attendance.every(entry => entry.lessonId === 'all-att:10'));
  assert.equal(result.meta.attendanceRowCount, 6);
  assert.equal(result.meta.linkedAttendanceRowCount, 6);
  assert.equal(result.meta.unlinkedAttendanceRowCount, 0);
});

test('an individual row owns one lesson and its attendance, while pending bookings do not mark attendance', () => {
  const result = normalize([row(1), row(2, { Calendar_Attendance: 'pending' }), row(3, { Calendar_Attendance: 'present' })]);
  assert.equal(result.lessons.length, 3);
  assert.equal(result.lessons[0].lessonKind, 'individual');
  assert.deepEqual(result.lessons[0].studentIds, ['folks:1']);
  assert.deepEqual(result.lessons[1].studentNames, ['Student One']);
  assert.deepEqual(result.lessons[0].groupIds, []);
  assert.deepEqual(result.attendance.map(entry => [entry.lessonId, entry.status]), [['all-att:1', 'recorded'], ['all-att:3', 'present']]);
  assert.equal(result.meta.pendingAttendanceRowCount, 1);
  assert.equal(result.meta.attendanceRowCount, 2);
  assert.equal(result.meta.unlinkedAttendanceRowCount, 0);
});

test('child rows require explicit parents; coincident times and teacher/group matches never infer links', () => {
  const result = normalize([header(10), row(11), child(20, 0), child(21, 999), child(22, 11), child(23, 10)]);
  assert.deepEqual(result.attendance.filter(entry => entry.sourceRowId >= 20).map(entry => entry.lessonId), ['', '', '', 'all-att:10']);
  assert.equal(result.meta.attendanceRowCount, 5);
  assert.equal(result.meta.linkedAttendanceRowCount, 2);
  assert.equal(result.meta.unlinkedAttendanceRowCount, 3);
  assert.equal(result.meta.danglingAttendanceRowCount, 2);
});

test('group attendance links survive moving the header, including different teacher and group references', () => {
  const source = [header(10, { start: start + 86400, end: start + 90000, t: ['L', 18], group2: ['L', 999] }), child(20)];
  const before = structuredClone(source);
  const result = normalize(source);
  assert.equal(result.lessons[0].start, '2026-10-13T23:00:00.000Z');
  assert.equal(result.lessons[0].teacherId, 'per:18');
  assert.equal(result.attendance[0].lessonId, 'all-att:10');
  assert.deepEqual(source, before);
});

test('cancellation and soft deletion preserve attendance and a deleted individual keeps its own attendance', () => {
  const source = [header(10, { Calendar_Status: 'deleted' }), child(20), row(21, { Calendar_Status: 'deleted' }),
    header(11, { Calendar_Status: 'cancelled' }), child(22, 11)];
  const before = structuredClone(source);
  const result = normalize(source);
  assert.deepEqual(result.lessons.map(lesson => [lesson.id, lesson.status]), [['all-att:11', 'cancelled']]);
  assert.equal(result.meta.deletedLessonCount, 2);
  assert.deepEqual(result.attendance.map(entry => entry.lessonId), ['all-att:10', 'all-att:21', 'all-att:11']);
  assert.equal(result.meta.unlinkedAttendanceRowCount, 0);
  assert.deepEqual(source, before);
});

test('invalid schedules never become events, and invalid headers do not discard explicit historical links', () => {
  const result = normalize([header(10, { start: null }), child(20), row(21, { end: start }), row(22, { start: '2026-10-13' }),
    header(11, { end: Infinity }), row(23, { start: -1e20, end: -1e20 + 1 }), row(-1)]);
  assert.equal(result.lessons.length, 0);
  assert.equal(result.meta.invalidLessons.length, 6);
  assert.equal(result.attendance.find(entry => entry.sourceRowId === 20).lessonId, 'all-att:10');
  assert.deepEqual(result.groupHeaders, []);
});

test('epoch conversion and latest date use Vladivostok even across UTC and school midnight', () => {
  const midnight = Date.parse('2026-10-12T14:00:00Z') / 1000;
  const result = normalize([row(1, { start: midnight - 1800, end: midnight + 1800 }), row(2)]);
  assert.equal(result.lessons[0].start, '2026-10-12T13:30:00.000Z');
  assert.equal(result.lessons[0].end, '2026-10-12T14:30:00.000Z');
  assert.equal(result.lessons[1].start, '2026-10-12T23:00:00.000Z');
  assert.equal(result.meta.latestLessonDate, '2026-10-13');
});

test('missing and multiple teachers remain explicit and deterministic; option catalogs expose only names', () => {
  const result = normalize([row(1, { t: ['L', 18, 17, 18], student: ['L', 2, 1] }), header(10, { t: null, group2: ['L', 999] })]);
  assert.equal(result.lessons[0].teacherId, 'per:17,18');
  assert.equal(result.lessons[1].teacherId, 'unassigned');
  assert.deepEqual(result.teachers.find(teacher => teacher.id === 'per:17,18').sourceIds, [17, 18]);
  assert.ok(result.teachers.some(teacher => teacher.id === 'per:17'));
  assert.equal(result.teachers.find(teacher => teacher.id === 'per:17,18').name, 'Teacher One + Teacher Two');
  assert.deepEqual(result.students, [{ id: 'folks:1', name: 'Student One' }, { id: 'folks:2', name: 'Student Two' }]);
  assert.ok(result.groups.some(group => group.id === 'per:31'));
  assert.ok(!result.groups.some(group => group.id === 'per:999'));
  assert.deepEqual(result.lessons[1].groupIds, ['per:999']);
  assert.equal(result.lessons[1].group, 'Group #999');
  assert.doesNotMatch(JSON.stringify(result), /wage|balance|87654|998877/);
});

test('calendar metadata stays separate from original attendance notes and no money/note infers attendance status', () => {
  const result = normalize([row(1, { notes: 'Absent? Paid?', wage: 0, count: 0, Calendar_Title: 'Lesson title',
    Calendar_Notes: 'Schedule note', Calendar_Checklist: '3/9', Calendar_Room: 'Room 1', Calendar_Participants: 'Bring book' })]);
  assert.equal(result.lessons[0].title, 'Lesson title');
  assert.equal(result.lessons[0].notes, 'Schedule note');
  assert.equal(result.lessons[0].checklist, '3/9');
  assert.equal(result.lessons[0].room, 'Room 1');
  assert.equal(result.lessons[0].participantText, 'Bring book');
  assert.equal(result.attendance[0].notes, 'Absent? Paid?');
  assert.equal(result.attendance[0].status, 'recorded');
});

test('generated group headers wait for explicit child linkage and retain metadata for resumable preparation', () => {
  const generated = header(10, { Calendar_Origin: 'all-att-group-header' });
  const pending = normalize([generated, child(20, 0), header(11, { Calendar_Origin: 'calendar' })]);
  assert.deepEqual(pending.lessons.map(lesson => lesson.id), ['all-att:11']);
  assert.equal(pending.meta.pendingImportLessonCount, 1);
  assert.equal(pending.groupHeaders.length, 2);
  const ready = normalize([generated, child(20)]);
  assert.equal(ready.lessons.length, 1);
  assert.equal(ready.meta.pendingImportLessonCount, 0);
  assert.equal(ready.meta.importedLessonCount, 1);
  const deleted = normalize([header(10, { Calendar_Origin: 'all-att-group-header', Calendar_Status: 'deleted' })]);
  assert.equal(deleted.meta.pendingImportLessonCount, 0);
  assert.equal(deleted.meta.deletedLessonCount, 1);
});

test('versions cover every source and calendar field, preserve wire values, and exclude legacy/financial fields', () => {
  const original = row(1, { t: ['L', 18, 17], Calendar_Parent: 0 });
  const version = lessonVersion(original);
  const values = lessonFields(original);
  assert.deepEqual(Object.keys(values), ALL_ATT_FIELDS);
  assert.deepEqual(values.t, ['L', 18, 17]);
  assert.equal(version, lessonVersion({ ...original.fields, wage: 500, Calendar_Lesson: 99, Calendar_Source_Revision: 'unused' }));
  assert.equal(version, lessonVersion(Object.fromEntries(Object.entries(original.fields).reverse())));
  for (const key of ALL_ATT_FIELDS) {
    assert.notEqual(version, lessonVersion({ ...original.fields, [key]: `changed ${key}` }), key);
  }
  values.t.push(99);
  assert.deepEqual(original.fields.t, ['L', 18, 17]);
  assert.notEqual(version, lessonVersion({ ...original.fields, student: ['L'] }));
  assert.notEqual(version, lessonVersion({ ...original.fields, group2: ['L', 31] }));
});
