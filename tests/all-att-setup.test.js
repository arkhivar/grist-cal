import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ALL_ATT_FIELDS } from '../server/all-att-model.mjs';
import { ALL_ATT_SETUP_FIELDS, buildAllAttPlan, loadAllAttSource, prepareAllAtt } from '../server/all-att-setup.mjs';

const clone = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const start = Date.parse('2026-10-12T23:00:00Z') / 1000;
const row = (id, extra = {}) => {
  const fields = {
    start, end: start + 3600, t: ['L', 17], group2: ['L', 31], student: ['L', id],
    Calendar_UID: '', Calendar_Parent: 0, Calendar_Status: '', Calendar_Origin: '', Calendar_Attendance: '',
    notes: 'Private existing note', datetime: start - 900, per: ['L', 18], wage: 900, count: 1,
    Calendar_Lesson: 700 + id, ...extra,
  };
  if (!Object.hasOwn(extra, 'Duration_Minutes')) fields.Duration_Minutes =
    typeof fields.start === 'number' && typeof fields.end === 'number' ? (fields.end - fields.start) / 60 : null;
  return { id, fields };
};
const derivedEnd = fields => typeof fields.start === 'number' && Number.isFinite(fields.start) &&
  typeof fields.Duration_Minutes === 'number' && Number.isFinite(fields.Duration_Minutes) && fields.Duration_Minutes > 0
  ? fields.start + fields.Duration_Minutes * 60 : null;

function mockClient({ attendance = [row(1), row(2)], beforeWrite, afterWrite, beforeRead, invalidRevision = false,
  deriveEnd = derivedEnd,
  legacyLessons = [{ id: 701, fields: { Title: 'Legacy lesson', Start: start } }] } = {}) {
  const tables = { ALL_ATT: clone(attendance), Calendar_Lessons: clone(legacyLessons) };
  const reads = [];
  const writes = [];
  let nextId = Math.max(0, ...attendance.map(record => record.id)) + 1;
  const recalculate = () => {
    for (const record of tables.ALL_ATT) {
      record.fields.Calendar_Parent ??= 0;
      record.fields.end = deriveEnd(record.fields);
      record.fields.Calendar_Revision = invalidRevision ? '' : hash(ALL_ATT_FIELDS.filter(field => field !== 'Calendar_Revision')
        .map(field => record.fields[field] ?? null));
    }
  };
  recalculate();
  const client = {
    async records(table, fields) {
      assert.ok(['ALL_ATT', 'Calendar_Lessons'].includes(table), 'Preparation never reads unrelated tables.');
      reads.push({ table, fields: [...fields] });
      await beforeRead?.({ tables, reads, writes });
      recalculate();
      return tables[table].map(record => ({ id: record.id,
        fields: Object.fromEntries(fields.map(field => [field, clone(record.fields[field])])) }));
    },
    async request(method, endpoint, body) {
      assert.equal(method, 'PUT');
      assert.match(endpoint, /^\/tables\/ALL_ATT\/records\?/);
      writes.push({ method, endpoint, body: clone(body) });
      await beforeWrite?.({ tables, writes, body, endpoint });
      recalculate();
      const params = new URLSearchParams(endpoint.split('?')[1]);
      const result = { recordIds: [], addRecordIds: [], updateRecordIds: [] };
      for (const operation of body.records) {
        assert.ok(!Object.hasOwn(operation.fields, 'end'), 'Formula end must never be written.');
        assert.ok(Object.values(operation.require).every(value => !Array.isArray(value)), 'RefLists cannot be CAS lookup predicates.');
        const matches = tables.ALL_ATT.filter(record => Object.entries(operation.require)
          .every(([field, value]) => same(field === 'id' ? record.id : record.fields[field], value)));
        if (!matches.length && params.get('noadd') !== 'true') {
          const created = { id: nextId++, fields: { ...clone(operation.require), ...clone(operation.fields) } };
          tables.ALL_ATT.push(created);
          result.recordIds.push([created.id]);
          result.addRecordIds.push(created.id);
        } else if (matches.length === 1 && params.get('noupdate') !== 'true') {
          Object.assign(matches[0].fields, clone(operation.fields));
          result.recordIds.push([matches[0].id]);
          result.updateRecordIds.push(matches[0].id);
        } else result.recordIds.push([]);
      }
      recalculate();
      await afterWrite?.({ tables, writes, body, endpoint, result });
      return result;
    },
  };
  return { client, tables, reads, writes };
}

test('planning uses the confirmed row kinds and exact start plus sorted teacher/group references', () => {
  const plan = buildAllAttPlan({ attendance: [
    row(1, { t: ['L', 18, 17], group2: ['L', 32, 31] }),
    row(2, { t: ['L', 17, 18, 17], group2: ['L', 31, 32] }),
    row(3, { group2: ['L'] }),
    row(4, { student: ['L'], group2: ['L'] }),
    row(5, { start: null }),
    row(6, { t: ['L'] }),
  ] });
  assert.equal(plan.candidates.length, 2);
  const grouped = plan.candidates.find(candidate => candidate.attendanceIds.length === 2);
  assert.deepEqual(grouped.attendanceIds, [1, 2]);
  assert.deepEqual(grouped.fields.t, ['L', 17, 18]);
  assert.deepEqual(grouped.fields.group2, ['L', 31, 32]);
  assert.deepEqual(grouped.fields.student, ['L']);
  assert.equal(grouped.fields.Duration_Minutes, 60);
  assert.equal(grouped.expectedEnd, start + 3600);
  assert.ok(!Object.hasOwn(grouped.fields, 'end'));
  assert.match(grouped.fields.Calendar_UID, /^all-att-group:[a-f0-9]{64}$/);
  assert.equal(plan.summary.individualLessonCount, 1);
  assert.equal(plan.summary.existingGroupHeaderCount, 1);
  assert.equal(plan.summary.undatedRowCount, 1);
  assert.deepEqual(plan.candidates.find(candidate => candidate.attendanceIds.includes(6)).fields.t, ['L']);
});

test('missing and inconsistent ends are reported instead of inventing lesson durations', () => {
  for (const children of [[row(1, { end: null })], [row(1), row(2, { end: start + 1800 })], [row(1, { end: start })]]) {
    const plan = buildAllAttPlan({ attendance: children });
    assert.equal(plan.candidates.length, 0);
    assert.equal(plan.conflicts.length, children.length);
    assert.ok(plan.conflicts.every(conflict => /end/.test(conflict.reason)));
  }
});

test('invalid stored source durations do not create headers from stale end values', () => {
  for (const Duration_Minutes of [undefined, null, 0, -1, Infinity, '60']) {
    const plan = buildAllAttPlan({ attendance: [row(1, { Duration_Minutes })] });
    assert.equal(plan.candidates.length, 0);
    assert.deepEqual(plan.conflicts, [{ id: 1, reason: 'missing-or-invalid-duration' }]);
  }
});

test('ambiguous headers and nonzero invalid parents remain conflicts without relinking', () => {
  const plan = buildAllAttPlan({ attendance: [row(1), row(2, { Calendar_Parent: 999 }),
    row(3, { group2: ['L'] }), row(4, { Calendar_Parent: 3 }),
    row(10, { student: ['L'] }), row(11, { student: ['L'] })] });
  assert.equal(plan.candidates.length, 0);
  assert.deepEqual(plan.conflicts, [
    { id: 1, reason: 'ambiguous-group-headers' },
    { id: 2, reason: 'invalid-existing-parent' },
    { id: 4, reason: 'invalid-existing-parent' },
  ]);
});

test('preparation creates one header and changes only new parent links on preexisting rows', async () => {
  const mock = mockClient();
  const original = clone(mock.tables);
  const progress = [];
  const result = await prepareAllAtt({ client: mock.client, onProgress: value => progress.push(value) });
  assert.equal(result.status, 'complete');
  assert.equal(result.createdHeaderCount, 1);
  assert.equal(result.linkedRowCount, 2);
  assert.equal(mock.tables.ALL_ATT.length, 3);
  const header = mock.tables.ALL_ATT[2];
  assert.equal(header.fields.Calendar_Origin, 'all-att-group-header');
  assert.equal(header.fields.Calendar_Attendance, 'pending');
  assert.equal(header.fields.Duration_Minutes, 60);
  assert.equal(header.fields.end, start + 3600);
  assert.deepEqual(header.fields.student, ['L']);
  for (let i = 0; i < 2; i += 1) {
    const { Calendar_Revision: beforeRevision, ...before } = original.ALL_ATT[i].fields;
    const { Calendar_Revision: afterRevision, ...after } = mock.tables.ALL_ATT[i].fields;
    assert.deepEqual(after, { ...before, Calendar_Parent: header.id });
  }
  assert.deepEqual(mock.tables.Calendar_Lessons, original.Calendar_Lessons);
  assert.ok(mock.reads.every(read => same(read.fields, ALL_ATT_SETUP_FIELDS)));
  const link = mock.writes.find(write => write.endpoint.includes('noadd=true'));
  for (const operation of link.body.records) {
    assert.deepEqual(Object.keys(operation.fields), ['Calendar_Parent']);
    assert.deepEqual(Object.keys(operation.require), ['id', 'Calendar_Parent', 'Calendar_Revision']);
    assert.equal(operation.require.Calendar_Parent, 0);
  }
  assert.ok(progress.length && progress.every(value => same(Object.keys(value), ['stage', 'completed', 'total'])));
  assert.doesNotMatch(JSON.stringify({ result, progress }), /Private existing note|Legacy lesson|wage/);
  assert.deepEqual((await loadAllAttSource(mock.client)).attendance.length, 3);
});

test('existing group headers are reused without modifying their schedule or custom fields', async () => {
  const mock = mockClient({ attendance: [row(1), row(2), row(10, {
    student: ['L'], end: start + 5400, Calendar_UID: 'teacher-chosen-identity', Calendar_Title: 'Edited title',
    Calendar_Checklist: '2/6', Calendar_Status: 'cancelled',
  })] });
  const expectedHeader = clone(mock.tables.ALL_ATT[2]);
  const result = await prepareAllAtt({ client: mock.client });
  assert.equal(result.createdHeaderCount, 0);
  assert.equal(result.reusedHeaderCount, 1);
  assert.equal(result.linkedRowCount, 2);
  assert.deepEqual(mock.tables.ALL_ATT[2], expectedHeader);
  assert.ok(mock.writes.every(write => write.endpoint.includes('noadd=true')));
});

test('reruns preserve moved linked headers and never regroup already-linked children', async () => {
  const mock = mockClient();
  await prepareAllAtt({ client: mock.client });
  mock.tables.ALL_ATT[2].fields.start += 7200;
  mock.tables.ALL_ATT[2].fields.end += 7200;
  const before = clone(mock.tables);
  mock.writes.length = 0;
  const result = await prepareAllAtt({ client: mock.client });
  assert.equal(result.alreadyLinkedRowCount, 2);
  assert.equal(result.candidateHeaderCount, 0);
  assert.equal(mock.writes.length, 0);
  assert.deepEqual(mock.tables.ALL_ATT.slice(0, 2), before.ALL_ATT.slice(0, 2));
  mock.tables.ALL_ATT.push(row(11));
  const changed = await prepareAllAtt({ client: mock.client });
  assert.equal(changed.status, 'partial');
  assert.equal(changed.conflicts[0].reason, 'generated-header-moved-or-reused');
  assert.equal(mock.writes.length, 0);
  assert.equal(mock.tables.ALL_ATT[3].fields.Calendar_Parent, 0);
});

test('a moved manually created header is not recreated from its linked children on a later run', () => {
  const plan = buildAllAttPlan({ attendance: [row(1, { Calendar_Parent: 10 }), row(2),
    row(10, { student: ['L'], start: start + 7200, end: start + 10800 })] });
  assert.equal(plan.candidates.length, 0);
  assert.deepEqual(plan.conflicts, [{ id: 2, reason: 'existing-linked-group-mismatch' }]);
});

test('lost create and link responses stop without retries and resume using stable identities', async () => {
  for (const lostStage of ['noupdate=true', 'noadd=true']) {
    let loseResponse = true;
    const mock = mockClient({ afterWrite({ endpoint }) {
      if (endpoint.includes(lostStage) && loseResponse) {
        loseResponse = false;
        throw Object.assign(new Error('Private upstream detail'), { mayHaveMutated: true });
      }
    } });
    await assert.rejects(prepareAllAtt({ client: mock.client }), error => {
      assert.equal(error.code, 'ALL_ATT_SETUP_UNCERTAIN');
      assert.match(error.message, /rerun preparation safely/i);
      assert.doesNotMatch(JSON.stringify(error), /Private/);
      assert.equal(error.summary.status, 'stopped');
      return true;
    });
    assert.equal(mock.writes.length, lostStage === 'noupdate=true' ? 1 : 2);
    const resumed = await prepareAllAtt({ client: mock.client });
    assert.equal(resumed.status, 'complete');
    assert.equal(mock.tables.ALL_ATT.length, 3);
    assert.ok(mock.tables.ALL_ATT.slice(0, 2).every(record => record.fields.Calendar_Parent === 3));
    assert.equal(mock.writes.length, 2);
  }
});

test('conditional links preserve concurrent edits to dates, references, calendar data and existing parents', async () => {
  const changes = [{ start: start + 3600 }, { Duration_Minutes: 90 }, { t: ['L', 99] },
    { group2: ['L', 32] }, { student: ['L', 99] }, { Calendar_Parent: 999 }, { Calendar_Status: 'cancelled' }];
  const mock = mockClient({ attendance: Array.from({ length: 8 }, (_, i) => row(i + 1)),
    beforeWrite({ endpoint, tables }) {
      if (endpoint.includes('noadd=true')) changes.forEach((change, index) => Object.assign(tables.ALL_ATT[index].fields, change));
    },
  });
  const result = await prepareAllAtt({ client: mock.client });
  assert.equal(result.status, 'partial');
  assert.equal(result.conditionalMissRowCount, 7);
  assert.equal(result.conflictedRowCount, 7);
  assert.equal(result.linkedRowCount, 1);
  changes.forEach((change, index) => {
    for (const [field, value] of Object.entries(change)) assert.deepEqual(mock.tables.ALL_ATT[index].fields[field], value);
    assert.equal(mock.tables.ALL_ATT[index].fields.Calendar_Parent, index === 5 ? 999 : 0);
  });
});

test('missing or duplicate headers after creation stop before any child links', async () => {
  for (const mode of ['missing', 'duplicate']) {
    const mock = mockClient({ afterWrite({ endpoint, tables }) {
      if (!endpoint.includes('noupdate=true')) return;
      if (mode === 'missing') tables.ALL_ATT.pop();
      else tables.ALL_ATT.push({ id: 999, fields: clone(tables.ALL_ATT.at(-1).fields) });
    } });
    await assert.rejects(prepareAllAtt({ client: mock.client }), { code: 'ALL_ATT_IDENTITY_CONFLICT' });
    assert.equal(mock.writes.length, 1);
    assert.ok(mock.tables.ALL_ATT.slice(0, 2).every(record => record.fields.Calendar_Parent === 0));
  }
});

test('header changes between planning and resolution leave child links untouched', async () => {
  const mock = mockClient({ attendance: [row(1), row(10, { student: ['L'] })], beforeRead({ reads, tables }) {
    if (reads.length === 2) tables.ALL_ATT[1].fields.Calendar_Title = 'Concurrent title';
  } });
  const result = await prepareAllAtt({ client: mock.client });
  assert.equal(result.status, 'partial');
  assert.equal(result.conflictedRowCount, 1);
  assert.equal(mock.writes.length, 0);
  assert.equal(mock.tables.ALL_ATT[0].fields.Calendar_Parent, 0);
});

test('readback detects headers edited during linking and never reports those links as fully verified', async () => {
  const mock = mockClient({ beforeWrite({ endpoint, tables }) {
    if (endpoint.includes('noadd=true')) tables.ALL_ATT.at(-1).fields.start += 60;
  } });
  const result = await prepareAllAtt({ client: mock.client });
  assert.equal(result.status, 'partial');
  assert.equal(result.linkedRowCount, 0);
  assert.equal(result.conflictedRowCount, 2);
  assert.ok(result.conflicts.every(conflict => conflict.reason === 'linked-source-or-header-changed'));
  // Source CAS cannot atomically lock another row; the readback reports this race without rewriting either side.
  assert.ok(mock.tables.ALL_ATT.slice(0, 2).every(record => record.fields.Calendar_Parent === 3));
});

test('invalid source revisions stop before writes; missing readback rows are reported', async () => {
  const invalid = mockClient({ invalidRevision: true });
  await assert.rejects(prepareAllAtt({ client: invalid.client }), { code: 'ALL_ATT_SOURCE_REVISION_INVALID' });
  assert.equal(invalid.writes.length, 0);
  const removed = mockClient({ beforeWrite({ endpoint, tables }) {
    if (endpoint.includes('noadd=true')) tables.ALL_ATT.splice(0, 1);
  } });
  const result = await prepareAllAtt({ client: removed.client, onProgress() { throw new Error('Ignored observer failure'); } });
  assert.equal(result.status, 'partial');
  assert.equal(result.missingRowCount, 1);
  assert.equal(result.conditionalMissRowCount, 1);
  assert.equal(result.linkedRowCount, 1);
});

test('preparation batches 50 header creations and 100 links without touching legacy tables', async () => {
  const manyGroups = mockClient({ attendance: Array.from({ length: 51 }, (_, index) => row(index + 1, {
    start: start + index * 3600, end: start + (index + 1) * 3600,
  })) });
  assert.equal((await prepareAllAtt({ client: manyGroups.client })).createdHeaderCount, 51);
  assert.deepEqual(manyGroups.writes.filter(write => write.endpoint.includes('noupdate=true')).map(write => write.body.records.length), [50, 1]);
  const manyChildren = mockClient({ attendance: Array.from({ length: 101 }, (_, index) => row(index + 1)) });
  assert.equal((await prepareAllAtt({ client: manyChildren.client })).linkedRowCount, 101);
  assert.deepEqual(manyChildren.writes.filter(write => write.endpoint.includes('noadd=true')).map(write => write.body.records.length), [100, 1]);
});

test('optional legacy preparation preserves standalone scheduling metadata and ignores historical imports', async () => {
  const legacyLessons = [{ id: 701, fields: {
    Calendar_UID: 'original-uuid', Origin: 'calendar', Start: start + 7200, End: start + 9000,
    Teacher: ['L', 18, 17], Group: ['L'], Title: 'Standalone lesson', Group_Label: 'Manual group',
    Room: 'Room 2', Participant_Notes: 'Manual participants', Checklist: '1/3', Notes: 'Saved lesson note', Status: 'cancelled',
  } }, { id: 702, fields: { Origin: 'attendance-import', Start: start, End: start + 3600 } }];
  const mock = mockClient({ attendance: [], legacyLessons });
  const result = await prepareAllAtt({ client: mock.client, includeLegacyCalendar: true });
  assert.equal(result.status, 'complete');
  assert.equal(result.newLegacyLessonCount, 1);
  assert.equal(result.ignoredLegacyLessonCount, 1);
  assert.equal(result.preservedLegacyLessonCount, 1);
  assert.equal(mock.tables.ALL_ATT.length, 1);
  const copied = mock.tables.ALL_ATT[0];
  assert.equal(copied.fields.Calendar_UID, 'legacy-calendar:701');
  assert.equal(copied.fields.Calendar_Origin, 'calendar-legacy');
  assert.equal(copied.fields.Calendar_Attendance, 'pending');
  assert.equal(copied.fields.Calendar_Status, 'cancelled');
  assert.equal(copied.fields.Calendar_Title, 'Standalone lesson');
  assert.equal(copied.fields.Calendar_Checklist, '1/3');
  assert.equal(copied.fields.Calendar_Room, 'Room 2');
  assert.equal(copied.fields.Calendar_Notes, 'Saved lesson note');
  assert.equal(copied.fields.Calendar_Participants, 'Manual participants');
  assert.equal(copied.fields.Duration_Minutes, 30);
  assert.equal(copied.fields.end, start + 9000);
  assert.deepEqual(copied.fields.t, ['L', 17, 18]);
  assert.deepEqual(copied.fields.student, ['L']);
  assert.deepEqual(mock.tables.Calendar_Lessons, legacyLessons);
  assert.equal(mock.reads.filter(read => read.table === 'Calendar_Lessons').length, 1);
  copied.fields.start += 1800;
  copied.fields.end += 1800;
  copied.fields.Calendar_Title = 'Edited after migration';
  const writesBefore = mock.writes.length;
  const resumed = await prepareAllAtt({ client: mock.client, includeLegacyCalendar: true });
  assert.equal(resumed.reusedLegacyLessonCount, 1);
  assert.equal(resumed.newLegacyLessonCount, 0);
  assert.equal(mock.writes.length, writesBefore);
  assert.equal(copied.fields.Calendar_Title, 'Edited after migration');
  assert.deepEqual(mock.tables.Calendar_Lessons, legacyLessons);
});

test('legacy copying is opt-in, keeps coincident standalone lessons distinct and rejects invalid identities', async () => {
  const legacy = { id: 701, fields: { Origin: 'calendar', Start: start, End: start + 3600, Teacher: ['L', 17], Group: ['L', 31] } };
  const mock = mockClient({ attendance: [], legacyLessons: [legacy] });
  const normal = await prepareAllAtt({ client: mock.client });
  assert.equal(normal.newLegacyLessonCount, 0);
  assert.equal(mock.writes.length, 0);
  assert.ok(mock.reads.every(read => read.table === 'ALL_ATT'));
  const distinct = buildAllAttPlan({ attendance: [row(1, { student: ['L'] })], legacyLessons: [legacy] });
  assert.equal(distinct.candidates.length, 1, 'A coincident source header is never assumed to be the same standalone event.');
  assert.equal(distinct.candidates[0].legacyLessonId, 701);
  const duplicate = buildAllAttPlan({ attendance: [row(1, { student: ['L'], Calendar_UID: 'legacy-calendar:701' }),
    row(2, { student: ['L'], Calendar_UID: 'legacy-calendar:701' })], legacyLessons: [legacy] });
  assert.equal(duplicate.candidates.length, 0);
  assert.equal(duplicate.conflicts[0].reason, 'ambiguous-legacy-identity');
  const invalid = buildAllAttPlan({ legacyLessons: [{ id: 1, fields: { Origin: 'calendar', Start: start, End: null } }] });
  assert.equal(invalid.candidates.length, 0);
  assert.equal(invalid.conflicts[0].reason, 'invalid-legacy-schedule');
});

test('legacy readback accepts canonical null empty RefLists and equivalent reference ordering', async () => {
  const mock = mockClient({ attendance: [], legacyLessons: [{ id: 701, fields: {
    Origin: 'calendar', Start: start, End: start + 3600, Teacher: ['L', 17, 18], Group: ['L'],
  } }], afterWrite({ endpoint, tables }) {
    if (!endpoint.includes('noupdate=true')) return;
    const copied = tables.ALL_ATT.at(-1).fields;
    copied.group2 = null;
    copied.student = null;
    copied.t = ['L', 18, 17];
  } });
  const result = await prepareAllAtt({ client: mock.client, includeLegacyCalendar: true });
  assert.equal(result.status, 'complete');
  assert.equal(result.preservedLegacyLessonCount, 1);
  assert.deepEqual(result.conflicts, []);
  const writesBefore = mock.writes.length;
  const resumed = await prepareAllAtt({ client: mock.client, includeLegacyCalendar: true });
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.reusedLegacyLessonCount, 1);
  assert.equal(mock.writes.length, writesBefore);
});

test('legacy readback rejects malformed reference values instead of treating them as empty lists', async () => {
  for (const invalid of [undefined, '', [], ['L', 0], ['L', '17'], ['E', 'Invalid']]) {
    const mock = mockClient({ attendance: [], legacyLessons: [{ id: 701, fields: {
      Origin: 'calendar', Start: start, End: start + 3600, Teacher: ['L'], Group: ['L'],
    } }], afterWrite({ endpoint, tables }) {
      if (endpoint.includes('noupdate=true')) tables.ALL_ATT.at(-1).fields.t = invalid;
    } });
    const result = await prepareAllAtt({ client: mock.client, includeLegacyCalendar: true });
    assert.equal(result.status, 'partial');
    assert.equal(result.preservedLegacyLessonCount, 0);
    assert.equal(result.conflicts[0].reason, 'preserved-legacy-lesson-changed');
  }
});

test('fractional durations are copied without rounding and derived-end readback precedes attendance linking', async () => {
  const duration = 45.1234567;
  const source = row(1, { end: start + duration * 60 });
  const mock = mockClient({ attendance: [source] });
  const result = await prepareAllAtt({ client: mock.client });
  assert.equal(result.status, 'complete');
  const header = mock.tables.ALL_ATT.at(-1).fields;
  assert.equal(header.Duration_Minutes, (source.fields.end - source.fields.start) / 60);
  assert.equal(header.end, source.fields.end);
  assert.equal(result.linkedRowCount, 1);
  assert.equal(mock.tables.ALL_ATT[0].fields.Duration_Minutes, source.fields.Duration_Minutes);

  for (const offset of [0.000001, 0.01]) {
    const checked = mockClient({ deriveEnd: fields => derivedEnd(fields) + (fields.Calendar_Origin === 'all-att-group-header' ? offset : 0) });
    const checkedResult = await prepareAllAtt({ client: checked.client });
    assert.equal(checkedResult.status, offset < 0.000002 ? 'complete' : 'partial');
    assert.equal(checkedResult.linkedRowCount, offset < 0.000002 ? 2 : 0);
    assert.equal(checked.writes.filter(write => write.endpoint.includes('noadd=true')).length, offset < 0.000002 ? 1 : 0);
  }
});

test('legacy copy readback verifies the formula end rather than trusting the written duration', async () => {
  const mock = mockClient({ attendance: [], legacyLessons: [{ id: 701, fields: {
    Origin: 'calendar', Start: start, End: start + 2700.5, Teacher: ['L'], Group: ['L'],
  } }], deriveEnd: fields => derivedEnd(fields) + 60 });
  const result = await prepareAllAtt({ client: mock.client, includeLegacyCalendar: true });
  assert.equal(result.status, 'partial');
  assert.equal(result.preservedLegacyLessonCount, 0);
  assert.deepEqual(result.conflicts, [{ id: 701, source: 'Calendar_Lessons', reason: 'preserved-legacy-lesson-changed' }]);
});
