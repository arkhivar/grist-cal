import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importAttendance, IMPORT_ATTENDANCE_FIELDS } from '../server/import.mjs';
import { buildImportPlan, LESSON_FIELD_IDS, normalizeSnapshot } from '../server/grist-model.mjs';

const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const start = Date.parse('2026-10-12T23:00:00Z') / 1000;
const row = (id, extra = {}) => ({ id, fields: {
  datetime: start, per: ['L', 17], group2: ['L', 31], student: ['L', id], Calendar_Lesson: 0,
  notes: 'Existing private note', wage: 900, count: 1, ...extra,
} });

function mockClient({ attendance = [row(1), row(2)], lessons = [], beforeWrite, afterWrite, beforeRead, invalidSourceRevision = false } = {}) {
  const tables = {
    ALL_ATT: clone(attendance), Calendar_Lessons: clone(lessons),
    PERFORMANCE: [{ id: 17, fields: { A: 'Example Teacher', type: 'team', wage: 450 } },
      { id: 31, fields: { A: 'Example Group', type: 'group' } }],
    FOLKS: [{ id: 1, fields: { name: 'Example Student', balance: 800 } }],
  };
  const reads = [];
  const writes = [];
  const recalculate = () => {
    for (const record of tables.ALL_ATT) {
      const fields = record.fields;
      fields.Calendar_Source_Revision = invalidSourceRevision ? '' : hash([
        fields.datetime, fields.per, fields.group2, fields.student, fields.Calendar_Lesson,
      ]);
    }
    for (const record of tables.Calendar_Lessons) {
      record.fields.Calendar_Revision = hash(LESSON_FIELD_IDS.filter(field => field !== 'Calendar_Revision')
        .map(field => record.fields[field] ?? null));
    }
  };
  recalculate();
  let nextId = Math.max(0, ...tables.Calendar_Lessons.map(record => record.id)) + 1;
  const client = {
    async records(table, fields) {
      reads.push({ table, fields: [...fields] });
      await beforeRead?.({ table, tables, reads, writes });
      recalculate();
      return tables[table].map(record => ({ id: record.id,
        fields: Object.fromEntries(fields.map(field => [field, clone(record.fields[field])])) }));
    },
    async request(method, endpoint, body) {
      writes.push({ method, endpoint, body: clone(body) });
      const table = endpoint.split('/')[2];
      await beforeWrite?.({ table, tables, writes, body });
      recalculate();
      const params = new URLSearchParams(endpoint.split('?')[1]);
      const result = { recordIds: [], addRecordIds: [], updateRecordIds: [] };
      for (const operation of body.records) {
        if (Object.values(operation.require).some(Array.isArray)) throw new Error('unhashable type: list');
        const matches = tables[table].filter(record => Object.entries(operation.require)
          .every(([field, value]) => same(field === 'id' ? record.id : record.fields[field], value)));
        if (!matches.length && params.get('noadd') !== 'true') {
          const created = { id: nextId++, fields: { ...clone(operation.require), ...clone(operation.fields) } };
          tables[table].push(created);
          result.recordIds.push([created.id]);
          result.addRecordIds.push(created.id);
        } else if (matches.length === 1 && params.get('noupdate') !== 'true') {
          Object.assign(matches[0].fields, clone(operation.fields));
          result.recordIds.push([matches[0].id]);
          result.updateRecordIds.push([matches[0].id]);
        } else result.recordIds.push([]);
      }
      recalculate();
      await afterWrite?.({ table, tables, writes, body, result });
      return result;
    },
  };
  return { client, tables, reads, writes };
}

test('import creates one grouped lesson and changes only the attendance link, with minimal source projections', async () => {
  const mock = mockClient();
  const original = clone(mock.tables.ALL_ATT);
  const progress = [];
  const result = await importAttendance({ client: mock.client, onProgress: value => progress.push(value) });
  assert.equal(result.createdLessonCount, 1);
  assert.equal(result.linkedRowCount, 2);
  assert.equal(result.status, 'complete');
  assert.equal(mock.tables.Calendar_Lessons.length, 1);
  const lessonId = mock.tables.Calendar_Lessons[0].id;
  assert.deepEqual(mock.tables.ALL_ATT.map(({ id, fields: { Calendar_Source_Revision, ...fields } }) => ({ id, fields })),
    original.map(({ id, fields: { Calendar_Source_Revision, ...fields } }) => ({ id, fields: { ...fields, Calendar_Lesson: lessonId } })));
  assert.deepEqual(mock.reads.slice(0, 4), [
    { table: 'ALL_ATT', fields: [...IMPORT_ATTENDANCE_FIELDS] },
    { table: 'PERFORMANCE', fields: ['A', 'type'] },
    { table: 'FOLKS', fields: ['name'] },
    { table: 'Calendar_Lessons', fields: [...LESSON_FIELD_IDS] },
  ]);
  assert.deepEqual(mock.reads.at(-1), { table: 'ALL_ATT', fields: ['Calendar_Lesson'] });
  for (const write of mock.writes) {
    assert.equal(write.method, 'PUT');
    assert.match(write.endpoint, /noparse=true/);
    assert.match(write.endpoint, /onmany=none/);
    if (write.endpoint.includes('/ALL_ATT/')) {
      assert.match(write.endpoint, /noadd=true/);
      for (const operation of write.body.records) {
        assert.deepEqual(Object.keys(operation.fields), ['Calendar_Lesson']);
        assert.deepEqual(Object.keys(operation.require), ['id', 'Calendar_Lesson', 'Calendar_Source_Revision', 'datetime']);
        assert.match(operation.require.Calendar_Source_Revision, /^[a-f0-9]{64}$/);
        assert.ok(Object.values(operation.require).every(value => !Array.isArray(value)));
      }
    } else {
      assert.match(write.endpoint, /noupdate=true/);
      assert.ok(write.body.records.every(operation => !Object.hasOwn(operation.fields, 'Calendar_Revision')));
    }
  }
  assert.ok(progress.length > 0 && progress.every(value => same(Object.keys(value), ['stage', 'completed', 'total'])));
  assert.doesNotMatch(JSON.stringify({ result, progress }), /Example|private|wage|balance/);
});

test('reruns and partial-import resumes reuse existing lesson identities without overwriting edited lessons', async () => {
  const mock = mockClient();
  await importAttendance({ client: mock.client });
  const existing = mock.tables.Calendar_Lessons[0];
  existing.fields.Title = 'Teacher changed the title';
  existing.fields.Start += 1800;
  existing.fields.End += 1800;
  existing.fields.Calendar_Revision = hash(LESSON_FIELD_IDS.filter(field => field !== 'Calendar_Revision')
    .map(field => existing.fields[field] ?? null));
  mock.tables.ALL_ATT[1].fields.Calendar_Lesson = 0;
  const expectedLesson = clone(existing);
  mock.writes.length = 0;
  const resumed = await importAttendance({ client: mock.client });
  assert.equal(resumed.reusedLessonCount, 1);
  assert.equal(resumed.newLessonCount, 0);
  assert.equal(resumed.linkedRowCount, 1);
  assert.deepEqual(mock.tables.Calendar_Lessons, [expectedLesson]);
  assert.ok(mock.writes.every(write => write.endpoint.includes('/ALL_ATT/')));
  mock.writes.length = 0;
  const again = await importAttendance({ client: mock.client });
  assert.equal(again.candidateLessonCount, 0);
  assert.equal(again.alreadyLinkedRowCount, 2);
  assert.equal(mock.writes.length, 0);
});

test('conditional links preserve concurrently changed dates, groups, students, teachers and existing links', async () => {
  const changes = [
    { datetime: start + 3600 }, { group2: ['L', 32] }, { student: ['L', 99] },
    { per: ['L', 18] }, { Calendar_Lesson: 999 },
  ];
  const mock = mockClient({ attendance: Array.from({ length: 6 }, (_, i) => row(i + 1)),
    beforeWrite({ table, tables }) {
      if (table === 'ALL_ATT') changes.forEach((change, index) => Object.assign(tables.ALL_ATT[index].fields, change));
    },
  });
  const result = await importAttendance({ client: mock.client });
  assert.equal(result.status, 'partial');
  assert.equal(result.conflictedRowCount, 5);
  assert.equal(result.conditionalMissRowCount, 5);
  assert.equal(result.linkedRowCount, 1);
  changes.forEach((change, index) => {
    for (const [field, value] of Object.entries(change)) assert.deepEqual(mock.tables.ALL_ATT[index].fields[field], value);
    assert.equal(mock.tables.ALL_ATT[index].fields.Calendar_Lesson, index === 4 ? 999 : 0);
  });
});

test('a partial import followed by changed-source rerun keeps the abandoned lesson hidden and resumable', async () => {
  let changeSource = true;
  const mock = mockClient({ attendance: [row(1)], beforeWrite({ table, tables }) {
    if (table === 'ALL_ATT' && changeSource) {
      changeSource = false;
      tables.ALL_ATT[0].fields.datetime += 3600;
    }
  } });
  const snapshot = () => normalizeSnapshot({ attendance: mock.tables.ALL_ATT, lessons: mock.tables.Calendar_Lessons,
    performance: mock.tables.PERFORMANCE, folks: mock.tables.FOLKS });
  const partial = await importAttendance({ client: mock.client });
  assert.equal(partial.status, 'partial');
  assert.equal(mock.tables.Calendar_Lessons.length, 1);
  assert.equal(snapshot().lessons.length, 0);
  assert.equal(snapshot().meta.pendingImportLessonCount, 1);
  const abandoned = clone(mock.tables.Calendar_Lessons[0]);
  const resumed = await importAttendance({ client: mock.client });
  assert.equal(resumed.status, 'complete');
  assert.equal(mock.tables.Calendar_Lessons.length, 2);
  assert.deepEqual(mock.tables.Calendar_Lessons[0], abandoned);
  assert.equal(snapshot().lessons.length, 1);
  assert.equal(snapshot().lessons[0].sourceRowId, mock.tables.ALL_ATT[0].fields.Calendar_Lesson);
  assert.equal(snapshot().meta.pendingImportLessonCount, 1);
});

test('a creation interrupted before linking is hidden until a successful resume attaches its attendance', async () => {
  let loseResponse = true;
  const mock = mockClient({ afterWrite({ table }) {
    if (table === 'Calendar_Lessons' && loseResponse) {
      loseResponse = false;
      throw Object.assign(new Error('Simulated lost response'), { mayHaveMutated: true });
    }
  } });
  const snapshot = () => normalizeSnapshot({ attendance: mock.tables.ALL_ATT, lessons: mock.tables.Calendar_Lessons,
    performance: mock.tables.PERFORMANCE, folks: mock.tables.FOLKS });
  await assert.rejects(importAttendance({ client: mock.client }), { code: 'IMPORT_UNCERTAIN' });
  assert.equal(snapshot().lessons.length, 0);
  assert.equal(snapshot().meta.pendingImportLessonCount, 1);
  await importAttendance({ client: mock.client });
  assert.equal(mock.tables.Calendar_Lessons.length, 1);
  assert.equal(snapshot().lessons.length, 1);
  assert.equal(snapshot().meta.pendingImportLessonCount, 0);
});

test('missing or invalid source revisions stop before any write is attempted', async () => {
  const mock = mockClient({ invalidSourceRevision: true });
  await assert.rejects(importAttendance({ client: mock.client }), { code: 'IMPORT_SOURCE_REVISION_INVALID' });
  assert.equal(mock.writes.length, 0);
  assert.equal(mock.tables.Calendar_Lessons.length, 0);
});

test('duplicate import identities stop the import before attendance links are attempted', async () => {
  const base = mockClient();
  const fields = buildImportPlan({ attendance: base.tables.ALL_ATT, performance: base.tables.PERFORMANCE,
    folks: base.tables.FOLKS, lessons: [] }).candidates[0].fields;
  const duplicate = mockClient({ lessons: [{ id: 50, fields }, { id: 51, fields }] });
  await assert.rejects(importAttendance({ client: duplicate.client }), { code: 'IMPORT_IDENTITY_CONFLICT' });
  assert.equal(duplicate.writes.length, 0);
  const race = mockClient({ afterWrite({ table, tables }) {
    if (table === 'Calendar_Lessons') tables.Calendar_Lessons.push({ id: 999, fields: clone(tables.Calendar_Lessons[0].fields) });
  } });
  await assert.rejects(importAttendance({ client: race.client }), { code: 'IMPORT_IDENTITY_CONFLICT' });
  assert.ok(race.writes.every(write => write.endpoint.includes('/Calendar_Lessons/')));
  assert.ok(race.tables.ALL_ATT.every(record => record.fields.Calendar_Lesson === 0));
});

test('an unknown create outcome aborts without retry and a full rerun resumes idempotently', async () => {
  let loseResponse = true;
  const mock = mockClient({ afterWrite({ table }) {
    if (table === 'Calendar_Lessons' && loseResponse) {
      loseResponse = false;
      throw Object.assign(new Error('Private upstream detail'), { mayHaveMutated: true });
    }
  } });
  await assert.rejects(importAttendance({ client: mock.client }), error => {
    assert.equal(error.code, 'IMPORT_UNCERTAIN');
    assert.match(error.message, /rerun the import safely/i);
    assert.doesNotMatch(JSON.stringify(error), /Private/);
    assert.equal(error.summary.status, 'stopped');
    return true;
  });
  assert.equal(mock.writes.length, 1);
  assert.equal(mock.tables.Calendar_Lessons.length, 1);
  assert.ok(mock.tables.ALL_ATT.every(record => record.fields.Calendar_Lesson === 0));
  const resumed = await importAttendance({ client: mock.client });
  assert.equal(resumed.reusedLessonCount, 1);
  assert.equal(resumed.linkedRowCount, 2);
  assert.equal(mock.tables.Calendar_Lessons.length, 1);
});

test('unknown link outcomes are not retried and rerunning does not relink completed rows', async () => {
  let loseResponse = true;
  const mock = mockClient({ afterWrite({ table }) {
    if (table === 'ALL_ATT' && loseResponse) {
      loseResponse = false;
      throw Object.assign(new Error('Connection dropped'), { mayHaveMutated: true });
    }
  } });
  await assert.rejects(importAttendance({ client: mock.client }), { code: 'IMPORT_UNCERTAIN' });
  assert.equal(mock.writes.length, 2);
  const before = clone(mock.tables);
  const result = await importAttendance({ client: mock.client });
  assert.equal(result.candidateLessonCount, 0);
  assert.equal(mock.writes.length, 2);
  assert.deepEqual(mock.tables, before);
});

test('creates are batched at 50 and links at 100 with final verification', async () => {
  const separate = mockClient({ attendance: Array.from({ length: 51 }, (_, i) => row(i + 1, { datetime: start + i * 3600 })) });
  const created = await importAttendance({ client: separate.client });
  assert.equal(created.createdLessonCount, 51);
  assert.deepEqual(separate.writes.filter(write => write.endpoint.includes('/Calendar_Lessons/')).map(write => write.body.records.length), [50, 1]);
  const shared = mockClient({ attendance: Array.from({ length: 101 }, (_, i) => row(i + 1)) });
  const linked = await importAttendance({ client: shared.client });
  assert.equal(linked.linkedRowCount, 101);
  assert.deepEqual(shared.writes.filter(write => write.endpoint.includes('/ALL_ATT/')).map(write => write.body.records.length), [100, 1]);
});

test('verification reports a row removed during import and progress errors cannot interrupt saved writes', async () => {
  const mock = mockClient({ beforeWrite({ table, tables }) {
    if (table === 'ALL_ATT') tables.ALL_ATT.pop();
  } });
  const result = await importAttendance({ client: mock.client, onProgress() { throw new Error('Broken progress view'); } });
  assert.equal(result.status, 'partial');
  assert.equal(result.missingRowCount, 1);
  assert.equal(result.conditionalMissRowCount, 1);
  assert.equal(result.linkedRowCount, 1);
});
