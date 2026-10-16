import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ATT_FIELDS, refs, classifyRow, lessonFields, lessonVersion, normalizeAllAttSnapshot } from '../server/all-att-model.mjs';

const start = Date.parse('2026-10-12T23:00:00Z') / 1000;
const record = (id, fields) => ({ id, fields });
const row = (id, extra = {}) => record(id, {
  start, end: start + 3600, Duration_Minutes: 60, t: ['L', 17], student: ['L', 1], group2: ['L'], notes: '', ...extra,
});
const header = (id, extra = {}) => row(id, { student: ['L'], group2: ['L', 31], ...extra });
const child = (id, parent = 10, extra = {}) => row(id, { group2: ['L', 31], Calendar_Parent: parent, ...extra });
const performance = [record(17, { name: 'Teacher One', label: 'team', wage: 87654 }),
  record(18, { name: 'Teacher Two', label: 'team' }), record(31, { name: 'Group A', label: 'group' })];
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
  assert.equal(result.lessons[0].title, 'Teacher One · Group A');
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

test('stored fractional duration stays exact and missing or invalid durations never display stale end times', () => {
  const durationMinutes = 45.1234567;
  const valid = row(1, { Duration_Minutes: durationMinutes, end: start + durationMinutes * 60 });
  const invalid = [undefined, null, '', '60', 0, -1, NaN, Infinity, false].map((duration, index) =>
    row(index + 2, { Duration_Minutes: duration }));
  const result = normalize([valid, ...invalid]);
  assert.deepEqual(result.lessons.map(lesson => [lesson.id, lesson.durationMinutes]), [['all-att:1', durationMinutes]]);
  assert.equal(result.meta.invalidLessons.length, invalid.length);
  assert.equal(result.attendance.length, invalid.length + 1, 'Invalid scheduling does not erase recorded attendance');
  assert.equal(lessonFields({}).Duration_Minutes, null);
  assert.notEqual(lessonVersion(valid), lessonVersion({ ...valid.fields, Duration_Minutes: durationMinutes + 0.0000001 }));
});

test('epoch conversion rounds fractional-second floating arithmetic to the UI millisecond boundary', () => {
  const end = start + 60.007 - 0.0000002;
  const result = normalize([row(1, { end, Duration_Minutes: (end - start) / 60 })]);
  assert.equal(result.lessons[0].end, '2026-10-12T23:01:00.007Z');
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

test('teacher choices use exact Grist initials and only individual team rows are selectable', () => {
  const result = normalizeAllAttSnapshot({ performance: [
    record(17, { name: 'aB', label: 'team', A: 'Obsolete name', type: 'group' }),
    record(18, { name: 'яю', label: ' TEAM ' }), record(19, { name: '', label: 'team' }),
    record(31, { name: 'Group B', label: 'group' }), record(32, { name: 'Other', label: 'guest' }),
    record(33, { name: 'Old tag', type: 'team' }),
  ], attendance: [row(1, { t: ['L', 17, 18] }), row(2, { t: ['L', 31] }),
    row(3, { t: ['L', 999] }), row(4, { t: ['L', 32] }), row(5, { group2: ['L', 31] })] });
  const byId = new Map(result.teachers.map(teacher => [teacher.id, teacher]));
  assert.deepEqual(result.teachers.filter(teacher => teacher.selectable).map(teacher => teacher.id).sort(), ['per:17', 'per:18', 'per:19']);
  assert.equal(byId.get('per:17').name, 'aB');
  assert.equal(byId.get('per:17').initials, 'aB');
  assert.equal(byId.get('per:18').initials, 'яю');
  assert.equal(byId.get('per:19').name, 'Teacher #19', 'A blank name needs an explicit identity fallback');
  assert.equal(byId.get('per:19').initials, '?');
  assert.equal(byId.get('per:17,18').name, 'aB + яю');
  for (const id of ['per:17,18', 'per:31', 'per:32', 'per:999', 'unassigned']) assert.equal(byId.get(id).selectable, false);
  assert.ok(!byId.has('per:33'), 'Obsolete type does not supply team eligibility');
  assert.deepEqual(result.groups, [{ id: 'per:31', name: 'Group B' }]);
  assert.doesNotMatch(JSON.stringify(result), /Obsolete name|Old tag/);
});

test('calendar metadata stays separate from original attendance notes and no money/note infers attendance status', () => {
  const result = normalize([row(1, { notes: 'Absent? Paid?', wage: 0, count: 0, Calendar_Title: 'Lesson title',
    Calendar_Notes: 'Schedule note', Calendar_Checklist: '3/9', Calendar_Room: 'Room 1', Calendar_Participants: 'Bring book' })]);
  assert.equal(result.lessons[0].title, 'Teacher One · Student One · Lesson title');
  assert.equal(result.lessons[0].notes, 'Schedule note');
  assert.equal(result.lessons[0].checklist, '3/9');
  assert.equal(result.lessons[0].room, 'Room 1');
  assert.equal(result.lessons[0].participantText, 'Bring book');
  assert.equal(result.attendance[0].notes, 'Absent? Paid?');
  assert.equal(result.attendance[0].status, 'recorded');
});

test('automatic titles use reference names while explicit overrides and group metadata stay separate', () => {
  const rows = [row(1, { Calendar_Title: '  Student One · Exam preparation  ', Calendar_Group_Label: 'Old group label' }),
    header(10, { Calendar_Title: 'Custom title', Calendar_Group_Label: 'Custom group label' }),
    header(11, { group2: ['L'], Calendar_Title: '  ', Calendar_Group_Label: 'Custom group label' })];
  const before = structuredClone(rows);
  const result = normalize(rows);
  assert.deepEqual(result.lessons.map(lesson => lesson.referenceTitle), ['Student One', 'Group A', 'Group not assigned']);
  assert.deepEqual(result.lessons.map(lesson => lesson.autoTitle),
    ['Teacher One · Student One', 'Teacher One · Group A', 'Teacher One · Group not assigned']);
  assert.deepEqual(result.lessons.map(lesson => lesson.title),
    ['Teacher One · Student One · Exam preparation', 'Teacher One · Group A · Custom title', 'Teacher One · Group not assigned']);
  assert.deepEqual(result.lessons.map(lesson => lesson.titleOverride), ['  Student One · Exam preparation  ', 'Custom title', '  ']);
  assert.deepEqual(result.lessons.map(lesson => lesson.group), ['', 'Group A', '']);
  assert.deepEqual(rows, before);
  assert.equal(lessonFields(rows[0]).Calendar_Title, '  Student One · Exam preparation  ');
  assert.notEqual(lessonVersion(rows[0]), lessonVersion({ ...rows[0].fields, Calendar_Title: 'Changed metadata' }));
});

test('group reassignment displays and searches current reference names without rewriting the old label', () => {
  const source = header(10, { Calendar_Group_Label: 'Former group' });
  const before = normalize([source]);
  source.fields.group2 = ['L', 999];
  const after = normalize([source]);
  assert.equal(before.lessons[0].group, 'Group A');
  assert.equal(after.lessons[0].group, 'Group #999');
  assert.equal(after.lessons[0].title, 'Teacher One · Group #999');
  assert.equal(source.fields.Calendar_Group_Label, 'Former group');
  assert.notEqual(lessonVersion(source), lessonVersion({ ...source.fields, Calendar_Group_Label: 'Changed metadata' }));
  assert.doesNotMatch(JSON.stringify(after.lessons), /Former group/);
});

test('missing and multiple title references use stable readable names without lesson prefixes', () => {
  const result = normalize([row(1, { student: ['L', 999, 2, 1, 2] }), header(10, { group2: ['L', 999, 31, 31] })]);
  assert.deepEqual(result.lessons.map(lesson => lesson.title),
    ['Teacher One · Student One, Student Two, Student #999', 'Teacher One · Group A · Group #999']);
});

test('automatic titles retain exact teacher initials and readable missing or multiple teacher identities', () => {
  const result = normalizeAllAttSnapshot({ attendance: [row(1), row(2, { t: ['L'] }), row(3, { t: ['L', 999, 18, 17] })],
    performance: performance.map(record => record.id === 17 ? { ...record, fields: { ...record.fields, name: 'aB' } } : record), folks });
  assert.deepEqual(result.lessons.map(lesson => lesson.autoTitle),
    ['aB · Student One', 'Unassigned · Student One', 'aB + Teacher Two + Teacher #999 · Student One']);
  assert.ok(result.lessons.every(lesson => lesson.referenceTitle === 'Student One'));
});

test('reference name updates change displayed titles without changing raw lesson revisions', () => {
  const attendance = [row(1), row(2, { Calendar_Title: 'Custom student lesson' }), header(10, { Calendar_Group_Label: 'Retained label' })];
  const before = normalize(attendance);
  const after = normalizeAllAttSnapshot({ attendance,
    performance: performance.map(record => [17, 31].includes(record.id)
      ? { ...record, fields: { ...record.fields, name: record.id === 17 ? 'New teacher' : 'Renamed group' } } : record),
    folks: folks.map(record => record.id === 1 ? { ...record, fields: { ...record.fields, name: 'Renamed student' } } : record),
  });
  assert.deepEqual(after.lessons.map(lesson => lesson.title),
    ['New teacher · Renamed student', 'New teacher · Renamed student · Custom student lesson', 'New teacher · Renamed group']);
  assert.deepEqual(after.lessons.map(lesson => lesson.autoTitle),
    ['New teacher · Renamed student', 'New teacher · Renamed student', 'New teacher · Renamed group']);
  assert.deepEqual(after.lessons.map(lesson => lesson.version), before.lessons.map(lesson => lesson.version));
});

test('generated group headers wait for explicit child linkage and retain metadata for resumable preparation', () => {
  const generatedUid = `all-att-group:${'a'.repeat(64)}`;
  const generated = header(10, { Calendar_UID: generatedUid });
  const pending = normalize([generated, child(20, 0), header(11, { Calendar_UID: 'manual-identity' })]);
  assert.deepEqual(pending.lessons.map(lesson => lesson.id), ['all-att:11']);
  assert.equal(pending.meta.pendingImportLessonCount, 1);
  assert.equal(pending.groupHeaders.length, 2);
  const ready = normalize([generated, child(20)]);
  assert.equal(ready.lessons.length, 1);
  assert.equal(ready.meta.pendingImportLessonCount, 0);
  assert.equal(ready.meta.importedLessonCount, 1);
  assert.equal(ready.lessons[0].origin, 'all-att-group-header');
  const deleted = normalize([header(10, { Calendar_UID: generatedUid, Calendar_Status: 'deleted' })]);
  assert.equal(deleted.meta.pendingImportLessonCount, 0);
  assert.equal(deleted.meta.deletedLessonCount, 1);
});

test('only exact prepared group UIDs hide unlinked headers; manual, UUID, legacy and malformed IDs remain visible', () => {
  const preparedUid = `all-att-group:${'0123456789abcdef'.repeat(4)}`;
  const visibleUids = [undefined, null, '', 'teacher-picked', '618ab656-1d93-4e6c-87ee-f82918c222b4', 'legacy-calendar:701',
    'all-att-group:', `all-att-group:${'a'.repeat(63)}`, `all-att-group:${'a'.repeat(65)}`,
    `all-att-group:${'A'.repeat(64)}`, `all-att-group:${'g'.repeat(64)}`, `${preparedUid}:extra`,
    `${preparedUid}\n`, ` ${preparedUid}`, `prefix:${preparedUid}`];
  const rows = visibleUids.map((Calendar_UID, index) => header(index + 1, { Calendar_UID, Calendar_Origin: 'all-att-group-header' }));
  const result = normalize([...rows, header(100, { Calendar_UID: preparedUid }),
    row(101, { Calendar_UID: preparedUid })]);
  assert.deepEqual(result.lessons.map(lesson => lesson.sourceRowId), [...rows.map(row => row.id), 101]);
  assert.equal(result.meta.pendingImportLessonCount, 1);
  assert.equal(result.meta.importedLessonCount, 0);
  assert.equal(result.lessons.find(lesson => lesson.sourceRowId === 6).origin, 'calendar-legacy');
  assert.equal(result.lessons.find(lesson => lesson.sourceRowId === 101).origin, '');
});

test('removed Calendar_Origin values cannot affect visibility, versions or normalized lesson metadata', () => {
  const source = [header(10, { Calendar_UID: 'manual' }), child(20), row(30)];
  const expected = normalize(source);
  for (const Calendar_Origin of ['', 'calendar', 'attendance-import', 'all-att-group-header', 'private legacy value']) {
    const withRemovedColumn = source.map(row => ({ ...row, fields: { ...row.fields, Calendar_Origin } }));
    assert.deepEqual(normalize(withRemovedColumn), expected);
    assert.equal(lessonVersion(withRemovedColumn[0]), lessonVersion(source[0]));
  }
  assert.ok(!ALL_ATT_FIELDS.includes('Calendar_Origin'));
  assert.ok(!Object.hasOwn(lessonFields({ Calendar_Origin: 'unused' }), 'Calendar_Origin'));
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
