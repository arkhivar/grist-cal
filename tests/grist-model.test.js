import test from 'node:test';
import assert from 'node:assert/strict';
import { refs, lessonFields, lessonVersion, LESSON_FIELD_IDS, buildImportPlan, normalizeSnapshot } from '../server/grist-model.mjs';

const start = Date.parse('2026-10-12T23:00:00Z') / 1000; // Tuesday 09:00 in Vladivostok.
const record = (id, fields) => ({ id, fields });
const performance = [
  record(17, { A: 'Anna Example', type: 'team', wage: 9876 }),
  record(18, { A: 'Mikhail Sample', type: 'team' }),
  record(31, { A: 'A2 morning', type: 'group' }),
  record(32, { A: '  InDiE ', type: 'group' }),
  record(33, { A: 'TRIAL', type: 'group' }),
];
const folks = [record(1, { name: 'Student One', balance: 12345 }), record(2, { name: 'Student Two' })];
const attendanceRow = (id, extra = {}) => record(id, {
  datetime: start, per: ['L', 17], group2: ['L', 31], student: ['L', 1], notes: '', Calendar_Lesson: 0, ...extra,
});
const plan = attendance => buildImportPlan({ attendance, performance, folks });
const lessonRecord = (extra = {}) => record(80, {
  ...plan([attendanceRow(1)]).candidates[0].fields, ...extra,
});

test('RefList decoding accepts positive numeric IDs only and is stable across duplicates/order', () => {
  assert.deepEqual(refs(['L', 18, 17, 18, 0, -1, '19', null, 2.5]), [17, 18]);
  for (const value of [null, undefined, 17, [], [17, 18], ['E', 'NameError'], '17']) assert.deepEqual(refs(value), []);
});

test('group lessons collapse duplicate student attendance into one event and retain source rows', () => {
  const result = plan([attendanceRow(3, { student: ['L', 2] }), attendanceRow(1), attendanceRow(2)]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].attendanceIds, [1, 2, 3]);
  assert.equal(result.candidates[0].fields.Start, start);
  assert.equal(result.candidates[0].fields.End, start + 3600);
  assert.equal(result.candidates[0].fields.Title, 'A2 morning');
  assert.equal(result.summary.attendanceToLinkCount, 3);
});

test('grouping uses exact start, sorted teacher set and sorted group set', () => {
  const result = plan([
    attendanceRow(1, { per: ['L', 18, 17], group2: ['L', 31, 33] }),
    attendanceRow(2, { per: ['L', 17, 18, 17], group2: ['L', 33, 31] }),
    attendanceRow(3, { per: ['L', 17] }),
    attendanceRow(4, { per: ['L', 18] }),
    attendanceRow(5, { per: ['L', 17], datetime: start + 86400 }),
    attendanceRow(6, { per: ['L', 17], datetime: start + 0.25 }),
  ]);
  assert.equal(result.candidates.length, 5);
  const multiple = result.candidates.find(candidate => candidate.attendanceIds.length === 2);
  assert.deepEqual(multiple.fields.Teacher, ['L', 17, 18]);
  assert.deepEqual(multiple.fields.Group, ['L', 31, 33]);
});

test('indie, trial, unknown and absent groups separate students while retaining duplicate source rows', () => {
  for (const group2 of [['L', 32], ['L', 33], ['L', 999], null]) {
    const result = plan([
      attendanceRow(1, { group2 }),
      attendanceRow(2, { group2, student: ['L', 2] }),
      attendanceRow(3, { group2 }),
    ]);
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(result.candidates.find(candidate => candidate.attendanceIds.includes(1)).attendanceIds, [1, 3]);
  }
});

test('unknown groups with no students stay separate, including missing teachers and malformed links', () => {
  const result = plan([
    attendanceRow(1, { group2: null, student: null, per: null }),
    attendanceRow(2, { group2: null, student: ['L'], per: null }),
    attendanceRow(3, { group2: ['L', 999], student: null, per: null }),
    attendanceRow(4, { group2: ['L', 999], student: ['E', 'LookupError'], per: null }),
    attendanceRow(5, { group2: ['L', 32], student: null, per: null }),
    attendanceRow(6, { group2: ['L', 32], student: null, per: null }),
  ]);
  assert.equal(result.candidates.length, 6);
  assert.ok(result.candidates.every(candidate => candidate.attendanceIds.length === 1));
  assert.ok(result.candidates.every(candidate => JSON.stringify(candidate.fields.Teacher) === '["L"]'));
  assert.equal(result.summary.isolatedMissingStudentRowCount, 6);
});

test('undated and invalid dates remain unlinked, while previously linked rows are skipped', () => {
  const result = plan([
    attendanceRow(1, { datetime: null }), attendanceRow(2, { datetime: '' }),
    attendanceRow(3, { datetime: '2026-10-13' }), attendanceRow(4, { datetime: Infinity }),
    attendanceRow(5, { Calendar_Lesson: 80 }), attendanceRow(6),
  ]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].attendanceIds, [6]);
  assert.deepEqual(result.skipped.map(row => row.reason), ['missing-datetime', 'missing-datetime', 'invalid-datetime', 'invalid-datetime', 'already-linked']);
  assert.equal(result.summary.undatedRowCount, 2);
});

test('import identities survive source reordering and resume against an existing lesson without duplicates', () => {
  const rows = [attendanceRow(2), attendanceRow(1, { student: ['L', 2] })];
  const first = plan(rows);
  const again = plan([...rows].reverse());
  assert.deepEqual(first.candidates, again.candidates);
  const fields = first.candidates[0].fields;
  assert.match(fields.Calendar_UID, /^import:[a-f0-9]{64}$/);
  assert.equal(fields.Calendar_UID, `import:${fields.Import_Key}`);
  assert.equal(Object.hasOwn(fields, 'Calendar_Revision'), false);
  const resumed = buildImportPlan({ attendance: rows, performance, folks,
    lessons: [record(80, { ...fields, Title: 'Teacher edited this after import', Start: start + 1800 })] });
  assert.equal(resumed.candidates.length, 1);
  assert.equal(resumed.candidates[0].existingLessonId, 80);
  assert.equal(resumed.summary.newLessonCount, 0);
  assert.equal(resumed.summary.reusedLessonCount, 1);
  const linked = buildImportPlan({ attendance: rows.map(row => record(row.id, { ...row.fields, Calendar_Lesson: 80 })),
    performance, folks, lessons: [record(80, fields)] });
  assert.equal(linked.candidates.length, 0);
});

test('duplicate existing import identities are reported instead of choosing an arbitrary target', () => {
  const rows = [attendanceRow(1), attendanceRow(2)];
  const fields = plan(rows).candidates[0].fields;
  const result = buildImportPlan({ attendance: rows, performance, folks, lessons: [record(80, fields), record(81, fields)] });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.skipped, [{ id: 1, reason: 'duplicate-import-identity' }, { id: 2, reason: 'duplicate-import-identity' }]);
});

test('normalization emits only lesson-table events and student records remain linked without inferred status', () => {
  const lessons = [lessonRecord({ Teacher: ['L', 18, 17], Checklist: '2/7', Notes: 'Lesson note', Status: 'cancelled' })];
  const attendance = [
    attendanceRow(1, { Calendar_Lesson: 80, student: ['L', 2, 1], notes: 'absent?', count: 0, wage: 999 }),
    attendanceRow(2, { Calendar_Lesson: 80, student: null, notes: 'paid', count: 1, wage: 222 }),
    attendanceRow(3, { datetime: start, student: ['L', 1] }),
  ];
  const result = normalizeSnapshot({ attendance, performance, folks, lessons });
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].id, 'grist:80');
  assert.equal(result.lessons[0].teacherId, 'per:17,18');
  assert.equal(result.lessons[0].checklist, '2/7');
  assert.equal(result.lessons[0].status, 'cancelled');
  assert.equal(result.lessons[0].start, '2026-10-12T23:00:00.000Z');
  assert.equal(result.meta.latestLessonDate, '2026-10-13');
  assert.equal(result.meta.unlinkedAttendanceRowCount, 1);
  assert.equal(result.attendance.length, 4);
  assert.ok(result.attendance.every(row => row.status === 'recorded'));
  assert.deepEqual(result.attendance.map(row => row.id), ['att:1:1', 'att:1:2', 'att:2:missing', 'att:3:1']);
  assert.equal(result.attendance.find(row => row.id === 'att:2:missing').studentId, '');
  assert.equal(result.attendance.find(row => row.id === 'att:2:missing').lessonId, 'grist:80');
  assert.equal(result.attendance[0].notes, 'absent?');
  assert.doesNotMatch(JSON.stringify(result), /wage|balance|9876|12345/);
});

test('teacher catalog includes team singles, stable observed combinations and Unassigned', () => {
  const result = normalizeSnapshot({ performance, folks,
    lessons: [lessonRecord({ Teacher: ['L', 18, 17] })], attendance: [attendanceRow(1, { per: null })] });
  assert.deepEqual(result.teachers.find(teacher => teacher.id === 'per:17,18').sourceIds, [17, 18]);
  assert.equal(result.teachers.find(teacher => teacher.id === 'per:17,18').name, 'Anna Example + Mikhail Sample');
  assert.ok(result.teachers.some(teacher => teacher.id === 'per:17'));
  assert.ok(result.teachers.some(teacher => teacher.id === 'per:18'));
  assert.ok(result.teachers.some(teacher => teacher.id === 'unassigned'));
  assert.ok(!result.teachers.some(teacher => teacher.id === 'per:31'));
  const reversed = normalizeSnapshot({ performance: [...performance].reverse(), lessons: [lessonRecord({ Teacher: ['L', 17, 18] })] });
  assert.equal(result.teachers.find(teacher => teacher.id === 'per:17,18').color,
    reversed.teachers.find(teacher => teacher.id === 'per:17,18').color);
});

test('invalid lessons never become events and cross-midnight epochs retain their actual date', () => {
  const midnight = Date.parse('2026-10-12T14:00:00Z') / 1000;
  const result = normalizeSnapshot({ attendance: [attendanceRow(1, { Calendar_Lesson: 80 })], lessons: [
    lessonRecord({ Start: midnight - 1800, End: midnight + 1800 }),
    record(81, { Start: null, End: midnight }), record(82, { Start: midnight, End: midnight }),
  ] });
  assert.equal(result.lessons.length, 1);
  assert.equal(result.lessons[0].start, '2026-10-12T13:30:00.000Z');
  assert.equal(result.lessons[0].end, '2026-10-12T14:30:00.000Z');
  assert.equal(result.meta.latestLessonDate, '2026-10-12');
  assert.equal(result.meta.invalidLessons.length, 2);
});

test('imported lessons wait for a source link while calendar-created lessons stay visible without attendance', () => {
  const imported = lessonRecord();
  const created = record(81, { ...imported.fields, Origin: 'calendar', Calendar_UID: 'new-calendar-lesson' });
  const pending = normalizeSnapshot({ attendance: [attendanceRow(1)], lessons: [imported, created], performance, folks });
  assert.deepEqual(pending.lessons.map(lesson => lesson.id), ['grist:81']);
  assert.equal(pending.meta.pendingImportLessonCount, 1);
  assert.equal(pending.meta.importedLessonCount, 0);
  const linked = normalizeSnapshot({ attendance: [attendanceRow(1, { Calendar_Lesson: 80 })],
    lessons: [imported, created], performance, folks });
  assert.deepEqual(linked.lessons.map(lesson => lesson.id), ['grist:80', 'grist:81']);
  assert.equal(linked.meta.pendingImportLessonCount, 0);
  assert.equal(linked.meta.importedLessonCount, 1);
  assert.equal(imported.fields.Origin, 'attendance-import');
});

test('CAS values preserve wire representation and versions include identity/provenance but exclude finance', () => {
  const original = lessonRecord({ Teacher: ['L', 18, 17], Checklist: '3/7' });
  const values = lessonFields(original);
  assert.deepEqual(Object.keys(values), LESSON_FIELD_IDS);
  assert.deepEqual(values.Teacher, ['L', 18, 17]);
  const version = lessonVersion(original);
  assert.equal(version, lessonVersion({ ...original.fields, wage: 100 }));
  assert.equal(version, lessonVersion(Object.fromEntries(Object.entries(original.fields).reverse())));
  for (const key of ['Title', 'Calendar_UID', 'Mutation_ID', 'Origin', 'Import_Key', 'Checklist', 'Calendar_Revision']) {
    assert.notEqual(version, lessonVersion({ ...original.fields, [key]: `changed ${key}` }));
  }
  values.Teacher.push(99);
  assert.deepEqual(original.fields.Teacher, ['L', 18, 17]);
});
