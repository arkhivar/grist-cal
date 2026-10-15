import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAllAttStore } from '../server/all-att-store.mjs';
import { ALL_ATT_FIELDS, lessonVersion } from '../server/all-att-model.mjs';
import { DATE_REGISTRY_FIELDS } from '../server/date-registry.mjs';

const UID = '12345678-1234-4123-8123-123456789abc';
const NEW_UID = '22345678-1234-4123-8123-123456789abc';
const MUTATION = '32345678-1234-4123-8123-123456789abc';
const OTHER_MUTATION = '42345678-1234-4123-8123-123456789abc';
const ORIGINAL_MUTATION = '52345678-1234-4123-8123-123456789abc';
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const networkFailure = () => Object.assign(new Error('Sensitive upstream details'), { mayHaveMutated: true });
const blankCalendar = () => ({ Calendar_UID: '', Calendar_Title: '', Calendar_Group_Label: '', Calendar_Room: '',
  Calendar_Participants: '', Calendar_Checklist: '', Calendar_Status: '', Calendar_Notes: '',
  Calendar_Mutation: '', Calendar_Origin: '', Calendar_Parent: 0, Calendar_Attendance: '' });
function initialTables() {
  const fields = { ...blankCalendar(),
    start: Date.parse('2026-10-13T00:00:00Z') / 1000, end: Date.parse('2026-10-13T01:00:00Z') / 1000,
    t: ['L', 17], student: ['L'], group2: ['L', 40], notes: 'Untouched original notes',
    Calendar_UID: UID, Calendar_Title: 'Lesson A', Calendar_Group_Label: 'Group A', Calendar_Room: 'Room 2',
    Calendar_Checklist: '1/3', Calendar_Status: 'scheduled', Calendar_Notes: 'Calendar notes',
    Calendar_Mutation: ORIGINAL_MUTATION, Calendar_Origin: 'existing',
    datetime: 1791864000, per: ['L', 18], wage: 750, payment: 1200, Unknown_Formula: 500, Calendar_Lesson: 9 };
  return {
    PERFORMANCE: [{ id: 17, fields: { A: 'Teacher One', type: 'team' } },
      { id: 18, fields: { A: 'Teacher Two', type: 'team' } }, { id: 40, fields: { A: 'Group A', type: 'group' } }],
    FOLKS: [{ id: 31, fields: { name: 'Fictional Student', private_finance: 99 } },
      { id: 32, fields: { name: 'Another Fictional Student' } }],
    DateRegistry: [{ id: 101, fields: { Date: Date.parse('2026-10-13T00:00:00Z') / 1000,
      Day: 'Tuesday', Day_Parity: 1, Month_Parity: 1, Is_Weekend: false,
      School_Day: 'Teaching day', Holiday_Name: '', Academic_Term: 'Autumn', private_notes: 'Not for the calendar' } },
    { id: 102, fields: { Date: Date.parse('2026-10-14T00:00:00Z') / 1000,
      Day: 'Wednesday', Day_Parity: 0, Month_Parity: 1, Is_Weekend: false,
      School_Day: 'Closed', Holiday_Name: 'Fictional school holiday', Academic_Term: 'Autumn' } }],
    ALL_ATT: [{ id: 7, fields },
      { id: 55, fields: { ...fields, ...blankCalendar(), student: ['L', 31], Calendar_Parent: 7, notes: 'Attendance notes' } },
      { id: 56, fields: { ...fields, ...blankCalendar(), student: ['L', 32], group2: ['L'],
        Calendar_Title: 'Individual lesson', Calendar_Status: 'scheduled' } }],
    Calendar_Lessons: [{ id: 9, fields: { Title: 'Untouched old calendar' } }],
  };
}
function mockClient({ beforeMutation, afterMutation, response, rejectMutation, failReadback, failRegistry = false,
  invalidRevision = false } = {}) {
  const tables = initialTables();
  const reads = [];
  const writes = [];
  let nextId = 57;
  const recalculate = () => {
    for (const row of tables.ALL_ATT) {
      // Simulate the independent DateRegistry formula ref; it must never affect CAS.
      const localDay = new Date((row.fields.start + 10 * 3600) * 1000).toISOString().slice(0, 10);
      row.fields.Calendar_Date = tables.DateRegistry.find(date =>
        typeof date.fields.Date === 'number' && Number.isFinite(date.fields.Date) &&
        new Date(date.fields.Date * 1000).toISOString().slice(0, 10) === localDay)?.id || 0;
      row.fields.Calendar_Revision = invalidRevision ? 'formula-error' : createHash('sha256')
        .update(JSON.stringify(Object.fromEntries(ALL_ATT_FIELDS.filter(field => field !== 'Calendar_Revision')
          .map(field => [field, row.fields[field]])))).digest('hex');
    }
  };
  recalculate();
  return { tables, reads, writes,
    async records(table, fields) {
      recalculate();
      reads.push({ table, fields: [...fields] });
      if (table === 'DateRegistry' && failRegistry) throw new Error('Private registry URL and connection details');
      if (writes.length && table === 'ALL_ATT' && failReadback) throw new Error('Private upstream read failure');
      return tables[table].map(record => ({ id: record.id,
        fields: Object.fromEntries(fields.map(field => [field, clone(record.fields[field])])) }));
    },
    async request(method, endpoint, body) {
      writes.push({ method, endpoint, body: clone(body) });
      if (beforeMutation) await beforeMutation(tables, body);
      recalculate();
      if (rejectMutation) throw rejectMutation;
      assert.equal(method, 'PUT');
      assert.ok(endpoint.startsWith('/tables/ALL_ATT/records?'));
      const query = new URL(endpoint, 'https://example.test').searchParams;
      assert.equal(query.get('onmany'), 'none');
      assert.equal(query.get('noparse'), 'true');
      const recordIds = [];
      for (const operation of body.records) {
        assert.ok(Object.values(operation.require).every(value => !Array.isArray(value)), 'Grist lookup cannot hash RefLists');
        assert.ok(!Object.hasOwn(operation.fields, 'Calendar_Revision'), 'The revision is formula-only');
        const found = tables.ALL_ATT.filter(record => Object.entries(operation.require)
          .every(([field, value]) => equal(field === 'id' ? record.id : record.fields[field], value)));
        if (found.length > 1) { recordIds.push([]); continue; }
        if (found.length === 1) {
          if (query.get('noupdate') !== 'true') Object.assign(found[0].fields, clone(operation.fields));
          recordIds.push([found[0].id]);
        } else if (query.get('noadd') !== 'true') {
          const record = { id: nextId++, fields: { ...blankCalendar(), notes: '', ...clone(operation.require), ...clone(operation.fields) } };
          tables.ALL_ATT.push(record);
          recordIds.push([record.id]);
        } else recordIds.push([]);
      }
      if (afterMutation) await afterMutation(tables, body);
      recalculate();
      return response === undefined ? { recordIds } : response;
    },
  };
}
const freshDraft = () => ({ clientId: NEW_UID, type: 'lesson', title: 'New lesson', teacherId: 'per:17',
  start: '2026-10-14T10:00:00+10:00', end: '2026-10-14T11:00:00+10:00', group: '', room: '',
  participantText: '', checklist: '', notes: '', status: 'scheduled', lessonKind: 'group', studentIds: [], groupIds: [] });
const groupLesson = async store => (await store.getSnapshot()).lessons.find(lesson => lesson.id === 'all-att:7');

test('ALL_ATT snapshot projects scheduling sources and date metadata once, never the legacy lesson table', async () => {
  const client = mockClient();
  const snapshot = await createAllAttStore({ client }).getSnapshot();
  assert.deepEqual(snapshot.lessons.map(lesson => lesson.id).sort(), ['all-att:56', 'all-att:7']);
  assert.ok(snapshot.attendance.some(record => record.lessonId === 'all-att:7'));
  assert.deepEqual(client.reads, [{ table: 'ALL_ATT', fields: [...ALL_ATT_FIELDS] },
    { table: 'PERFORMANCE', fields: ['A', 'type'] }, { table: 'FOLKS', fields: ['name'] },
    { table: 'DateRegistry', fields: [...DATE_REGISTRY_FIELDS] }]);
  assert.ok(!JSON.stringify(snapshot).includes('private_finance'));
  assert.ok(!JSON.stringify(snapshot).includes('private_notes'));
  assert.ok(!ALL_ATT_FIELDS.includes('Calendar_Date'));
  assert.deepEqual(snapshot.calendarDates, [
    { id: 'date:101', date: '2026-10-13', day: 'Tuesday', dayParity: 1, monthParity: 1, isWeekend: false,
      schoolDay: 'teaching', holidayName: '', academicTerm: 'Autumn' },
    { id: 'date:102', date: '2026-10-14', day: 'Wednesday', dayParity: 0, monthParity: 1, isWeekend: false,
      schoolDay: 'closed', holidayName: 'Fictional school holiday', academicTerm: 'Autumn' },
  ]);
  assert.ok(snapshot.lessons.every(lesson => lesson.calendarDateId === 'date:101'));
  assert.equal(snapshot.meta.dateRegistry.available, true);
  assert.equal(snapshot.meta.dateRegistry.unmatchedLessonCount, 0);
});

test('DateRegistry follows the Vladivostok date after a move without entering source writes or save readback', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  assert.equal(client.tables.ALL_ATT[0].fields.Calendar_Date, 101);
  client.reads.length = 0;
  const saved = await store.saveLesson({ ...lesson,
    start: '2026-10-13T14:30:00Z', end: '2026-10-13T15:30:00Z', calendarDateId: 'date:999', Calendar_Date: 999 },
  { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.start, '2026-10-13T14:30:00.000Z');
  assert.equal(client.tables.ALL_ATT[0].fields.Calendar_Date, 102, 'Derived ref recomputes without changing the save contract');
  assert.equal(client.tables.ALL_ATT[1].fields.Calendar_Date, 101, 'Moving a group does not move its attendance children');
  assert.equal(client.reads.filter(read => read.table === 'DateRegistry').length, 0);
  assert.ok(client.reads.filter(read => read.table === 'ALL_ATT').every(read => !read.fields.includes('Calendar_Date')));
  assert.deepEqual(client.writes[0].body.records[0].fields, {
    Calendar_Mutation: MUTATION, start: Date.parse('2026-10-13T14:30:00Z') / 1000,
    end: Date.parse('2026-10-13T15:30:00Z') / 1000,
  });
  const after = await store.getSnapshot();
  assert.equal(after.lessons.find(item => item.id === lesson.id).calendarDateId, 'date:102');
  assert.equal(after.lessons.find(item => item.id === 'all-att:56').calendarDateId, 'date:101');
  assert.equal(after.meta.dateRegistry.unmatchedLessonCount, 0);
  assert.equal(client.reads.filter(read => read.table === 'DateRegistry').length, 1);
});

test('DateRegistry metadata and derived reference changes do not invalidate an open lesson editor', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  client.tables.DateRegistry[0].id = 201;
  Object.assign(client.tables.DateRegistry[0].fields,
    { School_Day: 'Closed', Holiday_Name: 'New fictional holiday', Academic_Term: 'Revised term' });
  const refreshed = await store.getSnapshot();
  const current = refreshed.lessons.find(item => item.id === lesson.id);
  assert.equal(current.calendarDateId, 'date:201');
  assert.equal(current.version, lesson.version);
  assert.equal(client.tables.ALL_ATT[0].fields.Calendar_Date, 201);
  assert.equal(refreshed.calendarDates[0].holidayName, 'New fictional holiday');
  client.reads.length = 0;
  const saved = await store.saveLesson({ ...lesson, room: 'New room' },
    { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.room, 'New room');
  assert.equal(client.reads.filter(read => read.table === 'DateRegistry').length, 0);
  assert.deepEqual(client.writes[0].body.records[0].fields, { Calendar_Mutation: MUTATION, Calendar_Room: 'New room' });
});

test('missing and duplicate registry days warn without hiding or moving valid lessons', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const before = await store.getSnapshot();
  client.tables.DateRegistry.push({ id: 103, fields: { ...client.tables.DateRegistry[0].fields, Holiday_Name: 'Conflicting label' } });
  const duplicate = await store.getSnapshot();
  assert.deepEqual(duplicate.lessons.map(({ id, start, end }) => ({ id, start, end })),
    before.lessons.map(({ id, start, end }) => ({ id, start, end })));
  assert.deepEqual(duplicate.calendarDates.map(date => date.date), ['2026-10-14']);
  assert.ok(duplicate.lessons.every(lesson => lesson.calendarDateId === ''));
  assert.equal(duplicate.meta.dateRegistry.duplicateDateCount, 1);
  assert.equal(duplicate.meta.dateRegistry.duplicateRowCount, 2);
  assert.equal(duplicate.meta.dateRegistry.unmatchedLessonCount, 2);
  assert.equal(duplicate.meta.dateRegistry.unmatchedLessonDateCount, 1);
  client.tables.DateRegistry = [];
  const missing = await store.getSnapshot();
  assert.equal(missing.lessons.length, 2);
  assert.equal(missing.meta.dateRegistry.available, true);
  assert.equal(missing.meta.dateRegistry.duplicateDateCount, 0);
  assert.equal(missing.meta.dateRegistry.unmatchedLessonCount, 2);
  assert.equal(missing.meta.dateRegistry.unmatchedLessonDateCount, 1);
  assert.equal(client.writes.length, 0, 'Snapshot reads must never create registry rows');
});

test('registry read failures preserve the usable schedule and expose only an aggregate warning', async () => {
  const client = mockClient({ failRegistry: true });
  const store = createAllAttStore({ client });
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.lessons.length, 2);
  assert.deepEqual(snapshot.calendarDates, []);
  assert.equal(snapshot.meta.dateRegistry.available, false);
  assert.equal(snapshot.meta.dateRegistry.unmatchedLessonCount, 2);
  assert.ok(!JSON.stringify(snapshot).includes('Private registry'));
  const lesson = snapshot.lessons.find(item => item.id === 'all-att:7');
  const saved = await store.saveLesson({ ...lesson, room: 'Still editable' },
    { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.room, 'Still editable');
  assert.equal(client.reads.filter(read => read.table === 'DateRegistry').length, 1);
});

test('registry fallback does not suppress errors reading the actual attendance source', async () => {
  const client = mockClient({ failRegistry: true });
  const originalRead = client.records.bind(client);
  client.records = (table, fields) => table === 'ALL_ATT'
    ? Promise.reject(Object.assign(new Error('Schedule unavailable'), { code: 'GRIST_UNAVAILABLE' }))
    : originalRead(table, fields);
  await assert.rejects(createAllAttStore({ client }).getSnapshot(), { code: 'GRIST_UNAVAILABLE' });
  assert.equal(client.writes.length, 0);
});

test('snapshot, create, edit and delete work with the entire legacy lesson schema absent', async () => {
  const client = mockClient();
  delete client.tables.Calendar_Lessons;
  const legacyFields = ['Calendar_Lesson', 'Calendar_Source_Revision'];
  for (const row of client.tables.ALL_ATT) for (const field of legacyFields) delete row.fields[field];
  const originalRows = clone(client.tables.ALL_ATT);
  const read = client.records.bind(client);
  const write = client.request.bind(client);
  const legacyAccesses = [];
  client.records = async (table, fields) => {
    if (table === 'Calendar_Lessons' || fields.some(field => legacyFields.includes(field))) {
      legacyAccesses.push({ operation: 'read', table, fields });
      throw new Error('The retired lesson table and reference columns do not exist.');
    }
    return read(table, fields);
  };
  client.request = async (method, endpoint, body) => {
    const keys = (body?.records || []).flatMap(record => [...Object.keys(record.require || {}), ...Object.keys(record.fields || {})]);
    if (endpoint.includes('Calendar_Lessons') || keys.some(field => legacyFields.includes(field))) {
      legacyAccesses.push({ operation: 'write', method, endpoint, keys });
      throw new Error('Writes cannot restore or depend on retired schema.');
    }
    return write(method, endpoint, body);
  };
  const store = createAllAttStore({ client });
  const initial = await store.getSnapshot();
  assert.equal(initial.lessons.length, 2);
  assert.ok(initial.attendance.some(record => record.lessonId === 'all-att:7'));
  const created = await store.saveLesson({ ...freshDraft(), lessonKind: 'individual', studentIds: ['folks:31'] },
    { mutationId: MUTATION });
  assert.equal(created.id, 'all-att:57');
  assert.equal((await store.getSnapshot()).lessons.length, 3);
  const edited = await store.saveLesson({ ...created, title: 'Edited after retiring old schema', teacherId: 'per:18',
    start: '2026-10-15T10:15:00+10:00', end: '2026-10-15T11:15:00+10:00' },
  { expectedVersion: created.version, mutationId: OTHER_MUTATION });
  assert.equal(edited.start, '2026-10-15T00:15:00.000Z');
  assert.equal(edited.teacherId, 'per:18');
  const refreshed = await store.getSnapshot();
  assert.equal(refreshed.lessons.find(lesson => lesson.id === created.id).title, edited.title);
  assert.deepEqual(await store.deleteLesson(edited.id,
    { expectedVersion: edited.version, mutationId: ORIGINAL_MUTATION }), { id: edited.id });
  const final = await store.getSnapshot();
  assert.deepEqual(final.lessons.map(lesson => lesson.id), initial.lessons.map(lesson => lesson.id));
  assert.deepEqual(final.attendance, initial.attendance);
  assert.deepEqual(client.tables.ALL_ATT.slice(0, originalRows.length), originalRows);
  assert.equal(client.tables.ALL_ATT.at(-1).fields.Calendar_Status, 'deleted');
  assert.equal(client.tables.ALL_ATT.at(-1).fields.Calendar_Attendance, 'pending');
  assert.ok(client.tables.ALL_ATT.every(row => legacyFields.every(field => !Object.hasOwn(row.fields, field))));
  assert.equal(Object.hasOwn(client.tables, 'Calendar_Lessons'), false);
  assert.equal(client.writes.length, 3);
  assert.deepEqual(legacyAccesses, []);
});

test('ALL_ATT lesson edits write existing start/end/t and new calendar fields only', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const before = clone(client.tables);
  const lesson = await groupLesson(store);
  const saved = await store.saveLesson({ ...lesson, teacherId: 'per:18', group: 'Display label only',
    start: '2026-10-14T14:15:00+10:00', end: '2026-10-14T15:45:00+10:00', status: 'cancelled',
    notes: 'New calendar notes', wage: 0, student: ['L', 32], group2: ['L', 99], Calendar_UID: 'spoofed', attendance: [] },
  { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.start, '2026-10-14T04:15:00.000Z');
  assert.equal(saved.end, '2026-10-14T05:45:00.000Z');
  assert.equal(saved.id, lesson.id);
  assert.equal(saved.checklist, '1/3');
  assert.equal(saved.status, 'cancelled');
  assert.deepEqual(client.tables.Calendar_Lessons, before.Calendar_Lessons);
  assert.deepEqual(client.tables.ALL_ATT.slice(1), before.ALL_ATT.slice(1));
  const fields = client.tables.ALL_ATT[0].fields;
  for (const key of ['notes', 'datetime', 'per', 'wage', 'payment', 'Unknown_Formula', 'Calendar_Lesson', 'student', 'group2', 'Calendar_UID']) {
    assert.deepEqual(fields[key], before.ALL_ATT[0].fields[key], `${key} must be preserved`);
  }
  assert.deepEqual(fields.t, ['L', 18]);
  assert.equal(fields.start, Date.parse('2026-10-14T04:15:00Z') / 1000);
  assert.deepEqual(Object.keys(client.writes[0].body.records[0].fields).sort(),
    ['Calendar_Mutation', 't', 'Calendar_Group_Label', 'start', 'end', 'Calendar_Status', 'Calendar_Notes'].sort());
  assert.deepEqual(Object.keys(client.writes[0].body.records[0].require).sort(), ['Calendar_Revision', 'id']);
});

test('ALL_ATT existing row identity and source attendance rows cannot be edited as lessons', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  for (const patch of [{ lessonKind: 'individual' }, { studentIds: ['folks:31'] }, { groupIds: [] }]) {
    await assert.rejects(store.saveLesson({ ...lesson, ...patch }, { expectedVersion: lesson.version, mutationId: MUTATION }),
      { code: 'VALIDATION_ERROR', status: 400 });
  }
  await assert.rejects(store.saveLesson({ ...lesson, id: 'all-att:55' },
    { expectedVersion: lessonVersion(client.tables.ALL_ATT[1]), mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.deleteLesson('all-att:55',
    { expectedVersion: lessonVersion(client.tables.ALL_ATT[1]), mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  assert.equal(client.writes.length, 0);
});

test('ALL_ATT creates one row for an individual booking with pending attendance and no inherited history', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const before = clone(client.tables.ALL_ATT);
  const draft = { ...freshDraft(), lessonKind: 'individual', studentIds: ['folks:31'],
    Calendar_Attendance: 'present', Calendar_Parent: 7, datetime: 99, wage: 42 };
  const saved = await store.saveLesson(draft, { mutationId: MUTATION });
  assert.equal(saved.id, 'all-att:57');
  assert.equal(saved.lessonKind, 'individual');
  assert.deepEqual(saved.studentIds, ['folks:31']);
  assert.deepEqual(client.tables.ALL_ATT.slice(0, 3), before);
  assert.equal(client.tables.ALL_ATT.length, 4);
  assert.deepEqual(client.tables.ALL_ATT[3].fields.student, ['L', 31]);
  assert.deepEqual(client.tables.ALL_ATT[3].fields.group2, ['L']);
  assert.equal(client.tables.ALL_ATT[3].fields.Calendar_Attendance, 'pending');
  assert.equal(client.tables.ALL_ATT[3].fields.Calendar_Parent, 0);
  assert.equal(client.tables.ALL_ATT[3].fields.Calendar_Origin, 'calendar');
  assert.equal(client.tables.ALL_ATT[3].fields.wage, undefined);
  assert.equal(client.tables.ALL_ATT[3].fields.datetime, undefined);
  assert.ok(!(await store.getSnapshot()).attendance.some(row => row.lessonId === saved.id));
});

test('ALL_ATT duplicating a group copies scheduling references and checklist, never its attendance children', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const source = await groupLesson(store);
  const children = clone(client.tables.ALL_ATT.slice(1));
  const { id, version, ...draft } = source;
  const duplicate = await store.saveLesson({ ...draft, clientId: NEW_UID, status: 'scheduled' }, { mutationId: MUTATION });
  assert.equal(client.tables.ALL_ATT.length, 4);
  assert.equal(duplicate.checklist, source.checklist);
  assert.deepEqual(duplicate.groupIds, ['per:40']);
  assert.deepEqual(client.tables.ALL_ATT.slice(1, 3), children);
  assert.deepEqual(client.tables.ALL_ATT[3].fields.student, ['L']);
  assert.equal(client.tables.ALL_ATT[3].fields.Calendar_UID, NEW_UID);
  assert.ok(!(await store.getSnapshot()).attendance.some(row => row.lessonId === duplicate.id));
});

test('ALL_ATT creation rejects invalid classification, references, teacher, dates and identifiers without writes', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  for (const patch of [
    { lessonKind: 'attendance' }, { lessonKind: 'individual' },
    { lessonKind: 'individual', studentIds: ['folks:31', 'folks:32'] },
    { lessonKind: 'individual', studentIds: ['folks:31'], groupIds: ['per:40'] },
    { lessonKind: 'individual', studentIds: ['folks:999'] }, { studentIds: ['folks:31'] },
    { groupIds: ['per:999'] }, { groupIds: ['per:17'] }, { groupIds: ['per:0'] }, { groupIds: 'per:40' },
    { teacherId: 'per:999' }, { end: '2026-10-14T00:00:00Z' }, { clientId: 'invalid' },
  ]) await assert.rejects(store.saveLesson({ ...freshDraft(), ...patch }, { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson(freshDraft(), {}), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson({ ...freshDraft(), id: 'grist:7' }, { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson({ ...freshDraft(), id: 'all-att:7' }, { mutationId: MUTATION }), { code: 'VERSION_CONFLICT' });
  assert.equal(client.writes.length, 0);
});

test('ALL_ATT atomic revision catches concurrent reference or classification changes', async () => {
  for (const patch of [{ t: ['L', 18] }, { student: ['L', 31] }, { group2: ['L'] }]) {
    const client = mockClient({ beforeMutation: tables => Object.assign(tables.ALL_ATT[0].fields, patch) });
    const store = createAllAttStore({ client });
    const lesson = await groupLesson(store);
    await assert.rejects(store.saveLesson({ ...lesson, title: 'Must not overwrite' },
      { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'VERSION_CONFLICT', status: 409 });
    assert.equal(client.tables.ALL_ATT[0].fields.Calendar_Title, 'Lesson A');
    for (const [field, value] of Object.entries(patch)) assert.deepEqual(client.tables.ALL_ATT[0].fields[field], value);
  }
});

test('ALL_ATT dangling legacy group and teacher references can be retained but not assigned to new lessons', async () => {
  const client = mockClient();
  client.tables.ALL_ATT[0].fields.group2 = ['L', 999];
  client.tables.ALL_ATT[0].fields.t = ['L', 998];
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  await assert.rejects(store.saveLesson({ ...freshDraft(), groupIds: ['per:999'] },
    { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson({ ...freshDraft(), teacherId: 'per:998' },
    { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  const individual = (await store.getSnapshot()).lessons.find(item => item.id === 'all-att:56');
  await assert.rejects(store.saveLesson({ ...individual, teacherId: 'per:998' },
    { expectedVersion: individual.version, mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  assert.equal(client.writes.length, 0);
  await store.saveLesson({ ...lesson, room: 'Updated room' }, { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.deepEqual(client.tables.ALL_ATT[0].fields.t, ['L', 998]);
  assert.deepEqual(client.tables.ALL_ATT[0].fields.group2, ['L', 999]);
  assert.equal(client.tables.ALL_ATT[0].fields.Calendar_Room, 'Updated room');
});

test('ALL_ATT malformed revision blocks edits and deletes before mutation', async () => {
  const client = mockClient({ invalidRevision: true });
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Unsafe' },
    { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'SCHEMA_ERROR', status: 503 });
  await assert.rejects(store.deleteLesson(lesson.id,
    { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'SCHEMA_ERROR', status: 503 });
  assert.equal(client.writes.length, 0);
});

test('ALL_ATT atomic revision permits only one competing edit', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = mockClient({ beforeMutation: async () => { if (++waiting === 2) release(); await barrier; } });
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  const results = await Promise.allSettled([
    store.saveLesson({ ...lesson, title: 'First writer' }, { expectedVersion: lesson.version, mutationId: MUTATION }),
    store.saveLesson({ ...lesson, title: 'Second writer' }, { expectedVersion: lesson.version, mutationId: OTHER_MUTATION }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
});

test('ALL_ATT concurrent identical creates and lost responses resolve without duplicate rows', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = mockClient({ beforeMutation: async () => { if (++waiting === 2) release(); await barrier; },
    afterMutation: () => { throw networkFailure(); } });
  const store = createAllAttStore({ client });
  const results = await Promise.all([
    store.saveLesson(freshDraft(), { mutationId: MUTATION }), store.saveLesson(freshDraft(), { mutationId: MUTATION }),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(client.tables.ALL_ATT.length, 4);
  const retry = await store.saveLesson(freshDraft(), { mutationId: MUTATION });
  assert.equal(retry.id, results[0].id);
  assert.equal(client.writes.length, 2);
  await assert.rejects(store.saveLesson({ ...freshDraft(), title: 'Different intent' }, { mutationId: OTHER_MUTATION }),
    { code: 'VERSION_CONFLICT' });
});

test('ALL_ATT readback accepts empty RefList canonicalization and preserves raw unchanged refs', async () => {
  const client = mockClient({ afterMutation: tables => {
    for (const row of tables.ALL_ATT) for (const field of ['student', 'group2', 't']) {
      if (equal(row.fields[field], ['L'])) row.fields[field] = null;
    }
  } });
  const store = createAllAttStore({ client });
  const draft = { ...freshDraft(), teacherId: 'unassigned' };
  const saved = await store.saveLesson(draft, { mutationId: MUTATION });
  assert.equal(saved.teacherId, 'unassigned');
  assert.equal(client.tables.ALL_ATT[3].fields.student, null);
  assert.equal((await store.saveLesson(draft, { mutationId: MUTATION })).id, saved.id);
  assert.equal(client.writes.length, 1);
});

test('ALL_ATT lost edit response retries resolve their mutation and preserve original reference order', async () => {
  const client = mockClient({ afterMutation: () => { throw networkFailure(); } });
  client.tables.ALL_ATT[0].fields.t = ['L', 18, 17];
  client.tables.ALL_ATT[0].fields.Calendar_Group_Label = '';
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  const draft = { ...lesson, title: 'New title' };
  const options = { expectedVersion: lesson.version, mutationId: MUTATION };
  const saved = await store.saveLesson(draft, options);
  assert.equal((await store.saveLesson(draft, options)).version, saved.version);
  assert.equal(client.writes.length, 1);
  assert.deepEqual(client.tables.ALL_ATT[0].fields.t, ['L', 18, 17]);
  assert.equal(client.tables.ALL_ATT[0].fields.Calendar_Group_Label, '');
  await assert.rejects(store.saveLesson({ ...draft, title: 'Reused save ID' }, options), { code: 'VERSION_CONFLICT' });
});

test('ALL_ATT prepared group headers remain visible during save readback with their child links', async () => {
  const client = mockClient();
  client.tables.ALL_ATT[0].fields.Calendar_Origin = 'all-att-group-header';
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  const saved = await store.saveLesson({ ...lesson, room: 'Changed room' },
    { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.room, 'Changed room');
  assert.equal(saved.id, lesson.id);
  assert.equal(client.tables.ALL_ATT[1].fields.Calendar_Parent, 7);
});

test('ALL_ATT failures and missing readback remain explicit and preserve legacy records', async () => {
  for (const known of [false, true]) {
    const client = mockClient({ rejectMutation: Object.assign(new Error('private-secret'), { mayHaveMutated: !known, status: 503 }) });
    const store = createAllAttStore({ client });
    const before = clone(client.tables);
    const lesson = await groupLesson(store);
    await assert.rejects(store.saveLesson({ ...lesson, title: 'Rejected' }, { expectedVersion: lesson.version, mutationId: MUTATION }), error =>
      error.code === (known ? 'SAVE_FAILED' : 'SAVE_UNCERTAIN') && error.status === 503 &&
      Boolean(error.outcomeUnknown) === !known && !error.message.includes('private-secret'));
    assert.deepEqual(client.tables, before);
    assert.equal(client.writes.length, 1);
  }
  const unreadable = mockClient({ failReadback: true });
  await assert.rejects(createAllAttStore({ client: unreadable }).saveLesson(freshDraft(), { mutationId: MUTATION }),
    { code: 'SAVE_UNCERTAIN', status: 503, outcomeUnknown: true });
  assert.equal(unreadable.tables.ALL_ATT.length, 4);
});

test('ALL_ATT soft deletion changes two fields and preserves individual attendance plus linked children', async () => {
  for (const id of ['all-att:7', 'all-att:56']) {
    const client = mockClient();
    const store = createAllAttStore({ client });
    const lesson = (await store.getSnapshot()).lessons.find(item => item.id === id);
    const before = clone(client.tables);
    assert.deepEqual(await store.deleteLesson(id, { expectedVersion: lesson.version, mutationId: MUTATION }), { id });
    assert.deepEqual(client.writes[0].body.records[0].fields, { Calendar_Status: 'deleted', Calendar_Mutation: MUTATION });
    assert.deepEqual(client.tables.Calendar_Lessons, before.Calendar_Lessons);
    for (let index = 0; index < client.tables.ALL_ATT.length; index++) {
      const { Calendar_Revision, ...fields } = client.tables.ALL_ATT[index].fields;
      const { Calendar_Revision: ignored, ...old } = before.ALL_ATT[index].fields;
      assert.deepEqual(fields, client.tables.ALL_ATT[index].id === Number(id.slice(8))
        ? { ...old, Calendar_Status: 'deleted', Calendar_Mutation: MUTATION } : old);
    }
    assert.ok(!(await store.getSnapshot()).lessons.some(item => item.id === id));
  }
});

test('ALL_ATT delete retries resolve only their own mutation and stale editors cannot resurrect rows', async () => {
  const client = mockClient({ afterMutation: () => { throw networkFailure(); } });
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  const options = { expectedVersion: lesson.version, mutationId: MUTATION };
  await store.deleteLesson(lesson.id, options);
  assert.deepEqual(await store.deleteLesson(lesson.id, options), { id: lesson.id });
  await assert.rejects(store.deleteLesson(lesson.id, { ...options, mutationId: OTHER_MUTATION }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Stale edit' }, { ...options, mutationId: OTHER_MUTATION }), { code: 'VERSION_CONFLICT' });
  assert.equal(client.writes.length, 1);
});

test('ALL_ATT delete versus edit races allow only one conditional mutation', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = mockClient({ beforeMutation: async () => { if (++waiting === 2) release(); await barrier; } });
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  const children = clone(client.tables.ALL_ATT.slice(1));
  const results = await Promise.allSettled([
    store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }),
    store.saveLesson({ ...lesson, room: 'Concurrent room' }, { expectedVersion: lesson.version, mutationId: OTHER_MUTATION }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  assert.deepEqual(client.tables.ALL_ATT.slice(1), children);
});

test('ALL_ATT deletes reject stale and missing identifiers before mutation', async () => {
  const client = mockClient();
  const store = createAllAttStore({ client });
  const lesson = await groupLesson(store);
  const options = { expectedVersion: lesson.version, mutationId: MUTATION };
  await assert.rejects(store.deleteLesson('grist:7', options), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.deleteLesson('all-att:999', options), { code: 'NOT_FOUND' });
  await assert.rejects(store.deleteLesson(lesson.id, { mutationId: MUTATION }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version }), { code: 'VALIDATION_ERROR' });
  client.tables.ALL_ATT[0].fields.Calendar_Room = 'Changed elsewhere';
  await assert.rejects(store.deleteLesson(lesson.id, options), { code: 'VERSION_CONFLICT' });
  assert.equal(client.writes.length, 0);
});

test('ALL_ATT failed deletions preserve rows and unavailable readback remains uncertain', async () => {
  for (const known of [false, true]) {
    const client = mockClient({ rejectMutation: Object.assign(new Error('private-secret'), { mayHaveMutated: !known, status: 503 }) });
    const store = createAllAttStore({ client });
    const before = clone(client.tables);
    const lesson = await groupLesson(store);
    await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }), error =>
      error.code === (known ? 'DELETE_FAILED' : 'DELETE_UNCERTAIN') && error.status === 503 &&
      Boolean(error.outcomeUnknown) === !known && !error.message.includes('private-secret'));
    assert.deepEqual(client.tables, before);
    assert.equal(client.writes.length, 1);
  }
  const unreadable = mockClient({ failReadback: true });
  const store = createAllAttStore({ client: unreadable });
  const lesson = await groupLesson(store);
  await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }),
    { code: 'DELETE_UNCERTAIN', status: 503, outcomeUnknown: true });
  assert.equal(unreadable.tables.ALL_ATT[0].fields.Calendar_Status, 'deleted');
});
