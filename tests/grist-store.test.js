import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGristClient } from '../server/grist-client.mjs';
import { createGristStore } from '../server/grist-store.mjs';
import { LESSON_FIELD_IDS, lessonVersion } from '../server/grist-model.mjs';

const UID = '12345678-1234-4123-8123-123456789abc';
const NEW_UID = '22345678-1234-4123-8123-123456789abc';
const MUTATION = '32345678-1234-4123-8123-123456789abc';
const OTHER_MUTATION = '42345678-1234-4123-8123-123456789abc';
const ORIGINAL_MUTATION = '52345678-1234-4123-8123-123456789abc';
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function initialTables() {
  return {
    PERFORMANCE: [{ id: 17, fields: { A: 'Teacher One', type: 'team' } },
      { id: 18, fields: { A: 'Teacher Two', type: 'team' } }, { id: 40, fields: { A: 'Group A', type: 'group' } }],
    FOLKS: [{ id: 31, fields: { name: 'Fictional Student', birth_date: 0, private_finance: 99 } }],
    ALL_ATT: [{ id: 55, fields: { datetime: 1791864000, student: ['L', 31], per: ['L', 17],
      group2: ['L', 40], notes: 'Original attendance notes', Calendar_Lesson: 7, wage: 750 } }],
    Calendar_Lessons: [{ id: 7, fields: { Calendar_UID: UID, Title: 'Lesson A',
      Start: Date.parse('2026-10-13T00:00:00Z') / 1000, End: Date.parse('2026-10-13T01:00:00Z') / 1000,
      Teacher: ['L', 17], Group: ['L', 40], Group_Label: 'Group A', Room: 'Room 2', Participant_Notes: '',
      Checklist: '1/3', Status: 'scheduled', Notes: 'Preserve lesson notes', Mutation_ID: ORIGINAL_MUTATION,
      Origin: 'attendance-import', Import_Key: 'fixed-import-key', Unknown_Formula: 500 } }],
  };
}

function mockClient({ beforeMutation, afterMutation, response, rejectMutation, failReadback, invalidRevision = false } = {}) {
  const tables = initialTables();
  const reads = [];
  const writes = [];
  let nextId = 8;
  const recalculate = () => {
    for (const row of tables.Calendar_Lessons) {
      row.fields.Calendar_Revision = invalidRevision ? 'formula-error' : createHash('sha256')
        .update(JSON.stringify(Object.fromEntries(LESSON_FIELD_IDS.filter(field => field !== 'Calendar_Revision')
          .map(field => [field, row.fields[field]])))).digest('hex');
    }
  };
  recalculate();
  return { tables, reads, writes,
    async records(table, fields) {
      recalculate();
      reads.push({ table, fields: [...fields] });
      if (writes.length && table === 'Calendar_Lessons' && failReadback) throw new Error('Private upstream read failure');
      return tables[table].map(record => ({ id: record.id,
        fields: Object.fromEntries(fields.map(field => [field, clone(record.fields[field])])) }));
    },
    async request(method, endpoint, body) {
      writes.push({ method, endpoint, body: clone(body) });
      if (beforeMutation) await beforeMutation(tables, body);
      recalculate();
      if (rejectMutation) throw rejectMutation;
      assert.equal(method, 'PUT');
      assert.ok(endpoint.startsWith('/tables/Calendar_Lessons/records?'));
      const query = new URL(endpoint, 'https://example.test').searchParams;
      assert.equal(query.get('onmany'), 'none');
      assert.equal(query.get('noparse'), 'true');
      const recordIds = [];
      for (const operation of body.records) {
        assert.ok(Object.values(operation.require).every(value => !Array.isArray(value)), 'Grist lookup cannot hash RefLists');
        assert.ok(!Object.hasOwn(operation.fields, 'Calendar_Revision'), 'The revision is formula-only');
        const found = tables.Calendar_Lessons.filter(record => Object.entries(operation.require)
          .every(([field, value]) => equal(field === 'id' ? record.id : record.fields[field], value)));
        if (found.length > 1) { recordIds.push([]); continue; }
        if (found.length === 1) {
          if (query.get('noupdate') !== 'true') Object.assign(found[0].fields, clone(operation.fields));
          recordIds.push([found[0].id]);
        } else if (query.get('noadd') !== 'true') {
          const record = { id: nextId++, fields: { ...clone(operation.require), ...clone(operation.fields) } };
          tables.Calendar_Lessons.push(record);
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
  participantText: '', checklist: '', notes: '', status: 'scheduled' });
const networkFailure = () => Object.assign(new Error('Sensitive connection details must not escape'), { mayHaveMutated: true });

test('Grist client projects requested fields, normalizes SQL records and keeps credentials in headers', async () => {
  let call;
  const client = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'private-doc', apiKey: 'private-secret',
    fetchImpl: async (url, options) => {
      call = { url, options };
      return Response.json({ records: [{ fields: { id: 31, name: 'Student', unwanted: 'not returned' } }] });
    } });
  assert.deepEqual(await client.records('FOLKS', ['name']), [{ id: 31, fields: { name: 'Student' } }]);
  const url = new URL(call.url);
  assert.equal(url.searchParams.get('q'), 'SELECT "id", "name" FROM "FOLKS"');
  assert.equal(call.options.headers.Authorization, 'Bearer private-secret');
  assert.equal(call.options.redirect, 'error');
  assert.ok(!url.href.includes('private-secret'));
  await assert.rejects(client.records('FOLKS; DROP TABLE FOLKS', ['name']), { code: 'GRIST_REQUEST_INVALID' });
  await assert.rejects(client.records('FOLKS', ['*']), { code: 'GRIST_REQUEST_INVALID' });
  await assert.rejects(client.request('GET', '//different.example.test'), { code: 'GRIST_REQUEST_INVALID' });
});

test('Grist GET retries transient network, 429 and 5xx failures within the configured bound', async () => {
  const pauses = [];
  let calls = 0;
  const client = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'doc', apiKey: 'secret',
    sleepImpl: async ms => pauses.push(ms), fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error('ECONNRESET private-secret');
      if (calls === 2) return new Response('private body', { status: 429, headers: { 'Retry-After': '120' } });
      return Response.json({ records: [] });
    } });
  assert.deepEqual(await client.records('FOLKS', ['name']), []);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [150, 1000]);
  calls = 0;
  const unavailable = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'doc', apiKey: 'secret',
    sleepImpl: async () => {}, fetchImpl: async () => { calls++; return new Response('private-secret', { status: 503 }); } });
  await assert.rejects(unavailable.request('GET', '/tables'), error => error.status === 503 && !error.message.includes('private-secret'));
  assert.equal(calls, 3);
});

test('SQL storage RefLists decode only in known reference columns, preserving JSON-like text', async () => {
  const client = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'doc', apiKey: 'secret',
    fetchImpl: async url => {
      const query = new URL(url).searchParams.get('q');
      if (query.includes('"ALL_ATT"')) return Response.json({ records: [{ fields: {
        id: 55, student: '[1377]', per: '[18]', t: '[17,18]', group2: '[33]', notes: '[18]', Calendar_Lesson: 7,
      } }] });
      if (query.includes('"FOLKS"')) return Response.json({ records: [{ fields: { id: 1377, name: '[18]' } }] });
      return Response.json({ records: [{ fields: { id: 7, Teacher: '[18,17]', Group: '[]', Title: '[18]' } },
        { fields: { id: 8, Teacher: null, Group: null, Title: 'Empty refs' } }] });
    } });
  assert.deepEqual(await client.records('ALL_ATT', ['student', 'per', 't', 'group2', 'notes', 'Calendar_Lesson']),
    [{ id: 55, fields: { student: ['L', 1377], per: ['L', 18], t: ['L', 17, 18], group2: ['L', 33], notes: '[18]', Calendar_Lesson: 7 } }]);
  assert.deepEqual(await client.records('FOLKS', ['name']), [{ id: 1377, fields: { name: '[18]' } }]);
  assert.deepEqual(await client.records('Calendar_Lessons', ['Teacher', 'Group', 'Title']), [
    { id: 7, fields: { Teacher: ['L', 18, 17], Group: ['L'], Title: '[18]' } },
    { id: 8, fields: { Teacher: null, Group: null, Title: 'Empty refs' } },
  ]);
});

test('malformed SQL reference lists fail safely instead of silently losing teacher/student identities', async () => {
  const client = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'doc', apiKey: 'secret',
    fetchImpl: async () => Response.json({ records: [{ fields: { id: 1, student: '["private-name"]' } }] }) });
  await assert.rejects(client.records('ALL_ATT', ['student']), error =>
    error.code === 'GRIST_RESPONSE_INVALID' && !error.message.includes('private-name'));
});

test('Grist mutations are never blindly retried and upstream bodies are sanitized', async () => {
  let calls = 0;
  const client = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'private-doc', apiKey: 'private-secret',
    fetchImpl: async () => { calls++; return new Response('private-secret private-doc https://private-school.test', { status: 500 }); } });
  await assert.rejects(client.request('PUT', '/tables/Calendar_Lessons/records', { records: [] }), error =>
    error.status === 503 && error.mayHaveMutated && !/private|school/.test(error.message));
  assert.equal(calls, 1);
});

test('Grist network timeout is bounded and sanitized', async () => {
  const client = createGristClient({ baseUrl: 'https://grist.example.test', docId: 'doc', apiKey: 'secret', timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('private timeout detail')), { once: true });
    }) });
  await assert.rejects(client.request('PUT', '/tables/Calendar_Lessons/records', {}),
    error => error.code === 'GRIST_TIMEOUT' && error.mayHaveMutated && error.status === 503);
});

test('snapshots read only scheduling and name projections from the four intended tables', async () => {
  const client = mockClient();
  const snapshot = await createGristStore({ client }).getSnapshot();
  assert.equal(snapshot.lessons.length, 1);
  assert.equal(snapshot.attendance[0].lessonId, 'grist:7');
  assert.deepEqual(client.reads, [
    { table: 'ALL_ATT', fields: ['datetime', 'notes', 'student', 'per', 'group2', 'Calendar_Lesson'] },
    { table: 'PERFORMANCE', fields: ['A', 'type'] }, { table: 'FOLKS', fields: ['name'] },
    { table: 'Calendar_Lessons', fields: [...LESSON_FIELD_IDS] },
  ]);
  assert.ok(!JSON.stringify(snapshot).includes('private_finance'));
});

test('updates encode epoch seconds and RefLists, preserve group links and never write attendance or arbitrary fields', async () => {
  const client = mockClient();
  const store = createGristStore({ client });
  const original = clone(client.tables);
  const lesson = (await store.getSnapshot()).lessons[0];
  const saved = await store.saveLesson({ ...lesson, teacherId: 'per:18', group: 'Display label only',
    start: '2026-10-14T14:15:00+10:00', end: '2026-10-14T15:45:00+10:00', status: 'cancelled',
    wage: 0, Group: ['L', 99], Calendar_UID: 'spoofed', attendance: [] },
  { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.id, 'grist:7');
  assert.equal(saved.start, '2026-10-14T04:15:00.000Z');
  assert.equal(saved.end, '2026-10-14T05:45:00.000Z');
  assert.equal(saved.checklist, '1/3');
  assert.equal(saved.status, 'cancelled');
  assert.deepEqual(client.tables.ALL_ATT, original.ALL_ATT);
  const fields = client.tables.Calendar_Lessons[0].fields;
  assert.deepEqual(fields.Teacher, ['L', 18]);
  assert.deepEqual(fields.Group, ['L', 40]);
  assert.equal(fields.Group_Label, 'Display label only');
  assert.equal(fields.Calendar_UID, UID);
  assert.equal(fields.Unknown_Formula, 500);
  assert.equal(fields.Start, Date.parse('2026-10-14T04:15:00Z') / 1000);
  assert.deepEqual(Object.keys(client.writes[0].body.records[0].fields).sort(),
    ['Mutation_ID', 'Teacher', 'Group_Label', 'Start', 'End', 'Status'].sort());
  assert.equal(client.writes[0].body.records[0].require.Mutation_ID, ORIGINAL_MUTATION);
  assert.equal(client.writes[0].body.records[0].require.id, 7);
  assert.match(client.writes[0].body.records[0].require.Calendar_Revision, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(client.writes[0].body.records[0].require, 'Teacher'), false);
  assert.equal(Object.hasOwn(client.writes[0].body.records[0].require, 'Group'), false);
});

test('atomic scalar revision detects reference-only changes between read and update', async () => {
  const client = mockClient({ beforeMutation: async tables => {
    tables.Calendar_Lessons[0].fields.Teacher = ['L', 18];
    tables.Calendar_Lessons[0].fields.Group = ['L', 99];
  } });
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Must not overwrite' },
    { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'VERSION_CONFLICT', status: 409 });
  assert.equal(client.tables.Calendar_Lessons[0].fields.Title, 'Lesson A');
  assert.deepEqual(client.tables.Calendar_Lessons[0].fields.Teacher, ['L', 18]);
  assert.deepEqual(client.tables.Calendar_Lessons[0].fields.Group, ['L', 99]);
});

test('missing or invalid calendar revision blocks updates before mutation', async () => {
  const client = mockClient({ invalidRevision: true });
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Unsafe without revision' },
    { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'SCHEMA_ERROR', status: 503 });
  assert.equal(client.writes.length, 0);
});

test('atomic conditional updates reject a competing save instead of overwriting it', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = mockClient({ beforeMutation: async () => { if (++waiting === 2) release(); await barrier; } });
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  const attempts = await Promise.allSettled([
    store.saveLesson({ ...lesson, title: 'First writer' }, { expectedVersion: lesson.version, mutationId: MUTATION }),
    store.saveLesson({ ...lesson, title: 'Second writer' }, { expectedVersion: lesson.version, mutationId: OTHER_MUTATION }),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find(result => result.status === 'rejected').reason;
  assert.equal(rejected.code, 'VERSION_CONFLICT');
  assert.equal(rejected.status, 409);
  assert.equal(client.tables.Calendar_Lessons.length, 1);
});

test('stale versions and invalid drafts fail before any mutation', async () => {
  const client = mockClient();
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  client.tables.Calendar_Lessons[0].fields.Room = 'Changed elsewhere';
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Stale' }, { expectedVersion: lesson.version, mutationId: MUTATION }),
    { code: 'VERSION_CONFLICT', status: 409 });
  await assert.rejects(store.saveLesson({ ...freshDraft(), teacherId: 'per:999' }, { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson({ ...freshDraft(), end: '2026-10-14T00:00:00Z' }, { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson({ ...freshDraft(), clientId: 'not-a-uuid' }, { mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson(freshDraft(), {}), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.saveLesson(lesson, { mutationId: MUTATION }), { code: 'VERSION_CONFLICT' });
  assert.equal(client.writes.length, 0);
});

test('concurrent duplicate creates with one client UUID create exactly one record', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = mockClient({ beforeMutation: async () => { if (++waiting === 2) release(); await barrier; } });
  const store = createGristStore({ client });
  const results = await Promise.all([
    store.saveLesson(freshDraft(), { mutationId: MUTATION }),
    store.saveLesson(freshDraft(), { mutationId: MUTATION }),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(client.tables.Calendar_Lessons.length, 2);
  assert.equal(client.tables.ALL_ATT.length, 1);
  assert.deepEqual(client.tables.Calendar_Lessons[1].fields.Group, ['L']);
  assert.ok(client.writes.every(write => write.endpoint.includes('noupdate=true')));
  await assert.rejects(store.saveLesson({ ...freshDraft(), title: 'Different intent' }, { mutationId: OTHER_MUTATION }),
    { code: 'VERSION_CONFLICT', status: 409 });
  assert.equal(client.tables.Calendar_Lessons.length, 2);
});

test('a lost successful create response resolves by UUID and payload without another write', async () => {
  const client = mockClient({ afterMutation: async () => { throw networkFailure(); } });
  const store = createGristStore({ client });
  const saved = await store.saveLesson(freshDraft(), { mutationId: MUTATION });
  assert.equal(saved.id, 'grist:8');
  assert.equal(client.writes.length, 1);
  const duplicate = await store.saveLesson(freshDraft(), { mutationId: MUTATION });
  assert.equal(duplicate.id, saved.id);
  assert.equal(client.writes.length, 1);
});

test('readback accepts Grist empty RefList canonicalization without weakening raw CAS fields', async () => {
  const client = mockClient({ afterMutation: async tables => {
    for (const row of tables.Calendar_Lessons) {
      for (const field of ['Group', 'Teacher']) {
        if (equal(row.fields[field], ['L'])) row.fields[field] = null;
      }
    }
  } });
  const store = createGristStore({ client });
  const draft = { ...freshDraft(), teacherId: 'unassigned' };
  const saved = await store.saveLesson(draft, { mutationId: MUTATION });
  assert.equal(saved.teacherId, 'unassigned');
  assert.deepEqual(client.tables.Calendar_Lessons[1].fields.Group, null);
  const retried = await store.saveLesson(draft, { mutationId: MUTATION });
  assert.equal(retried.id, saved.id);
  assert.equal(client.writes.length, 1);
});

test('lost update responses and explicit retries resolve the original mutation while keeping raw links', async () => {
  const client = mockClient({ afterMutation: async () => { throw networkFailure(); } });
  client.tables.Calendar_Lessons[0].fields.Teacher = ['L', 18, 17];
  client.tables.Calendar_Lessons[0].fields.Group_Label = '';
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  const draft = { ...lesson, title: 'Rescheduled title' };
  const saved = await store.saveLesson(draft, { expectedVersion: lesson.version, mutationId: MUTATION });
  const retried = await store.saveLesson(draft, { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.id, retried.id);
  assert.equal(saved.version, retried.version);
  assert.equal(client.writes.length, 1);
  assert.deepEqual(client.tables.Calendar_Lessons[0].fields.Teacher, ['L', 18, 17]);
  assert.equal(client.tables.Calendar_Lessons[0].fields.Group_Label, '');
});

test('legacy upsert response contracts still require matching readback before success', async () => {
  const client = mockClient({ response: {} });
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  const saved = await store.saveLesson({ ...lesson, room: 'New room' }, { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.equal(saved.room, 'New room');
  assert.equal(saved.version, lessonVersion(client.tables.Calendar_Lessons[0]));
});

test('a failed or unverifiable write does not claim success or modify linked attendance', async () => {
  const client = mockClient({ rejectMutation: networkFailure() });
  const store = createGristStore({ client });
  const before = clone(client.tables);
  const lesson = (await store.getSnapshot()).lessons[0];
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Uncertain' }, { expectedVersion: lesson.version, mutationId: MUTATION }),
    error => error.code === 'SAVE_UNCERTAIN' && error.status === 503 && error.outcomeUnknown && !/Sensitive|private/.test(error.message));
  assert.equal(client.writes.length, 1);
  assert.deepEqual(client.tables, before);
  const unreadable = mockClient({ failReadback: true });
  await assert.rejects(createGristStore({ client: unreadable }).saveLesson(freshDraft(), { mutationId: MUTATION }),
    { code: 'SAVE_UNCERTAIN', status: 503 });
  assert.equal(unreadable.writes.length, 1);
  assert.equal(unreadable.tables.Calendar_Lessons.length, 2);
});

test('an explicit upstream rejection is sanitized and does not pretend to be a successful save', async () => {
  const client = mockClient({ rejectMutation: Object.assign(new Error('secret-doc secret-key'), { mayHaveMutated: false, status: 502 }) });
  await assert.rejects(createGristStore({ client }).saveLesson(freshDraft(), { mutationId: MUTATION }),
    error => error.code === 'SAVE_FAILED' && error.status === 502 && !error.message.includes('secret'));
  assert.equal(client.tables.Calendar_Lessons.length, 1);
});

test('delete marks only the lesson status and mutation, preserving attendance and all other record data', async () => {
  const client = mockClient();
  const store = createGristStore({ client });
  const before = clone(client.tables);
  const lesson = (await store.getSnapshot()).lessons[0];
  const result = await store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION });
  assert.deepEqual(result, { id: lesson.id });
  assert.deepEqual(client.tables.ALL_ATT, before.ALL_ATT);
  assert.equal(client.tables.Calendar_Lessons.length, 1);
  const { Calendar_Revision, ...fields } = client.tables.Calendar_Lessons[0].fields;
  const { Calendar_Revision: oldRevision, ...originalFields } = before.Calendar_Lessons[0].fields;
  assert.deepEqual(fields, { ...originalFields, Status: 'deleted', Mutation_ID: MUTATION });
  assert.notEqual(Calendar_Revision, oldRevision);
  assert.deepEqual(client.writes[0].body.records[0].fields, { Status: 'deleted', Mutation_ID: MUTATION });
  assert.equal((await store.getSnapshot()).lessons.length, 0);
  assert.equal((await store.getSnapshot()).attendance[0].lessonId, lesson.id);
});

test('delete retry acknowledges only its own mutation and stale edits cannot resurrect a deleted lesson', async () => {
  const client = mockClient();
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  const options = { expectedVersion: lesson.version, mutationId: MUTATION };
  await store.deleteLesson(lesson.id, options);
  assert.deepEqual(await store.deleteLesson(lesson.id, options), { id: lesson.id });
  assert.equal(client.writes.length, 1);
  await assert.rejects(store.deleteLesson(lesson.id, { ...options, mutationId: OTHER_MUTATION }), { code: 'VERSION_CONFLICT', status: 409 });
  await assert.rejects(store.saveLesson({ ...lesson, title: 'Stale edit' }, { expectedVersion: lesson.version, mutationId: OTHER_MUTATION }),
    { code: 'VERSION_CONFLICT', status: 409 });
  assert.equal(client.writes.length, 1);
  assert.equal(client.tables.Calendar_Lessons[0].fields.Status, 'deleted');
});

test('delete and edit races use atomic revision checks so one operation cannot overwrite the other', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = mockClient({ beforeMutation: async () => { if (++waiting === 2) release(); await barrier; } });
  const store = createGristStore({ client });
  const attendance = clone(client.tables.ALL_ATT);
  const lesson = (await store.getSnapshot()).lessons[0];
  const results = await Promise.allSettled([
    store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }),
    store.saveLesson({ ...lesson, room: 'Concurrent room' }, { expectedVersion: lesson.version, mutationId: OTHER_MUTATION }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  assert.deepEqual(client.tables.ALL_ATT, attendance);
});

test('delete rejects missing identifiers, stale versions and invalid revision before writing', async () => {
  const client = mockClient();
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  await assert.rejects(store.deleteLesson('invalid', { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(store.deleteLesson(lesson.id, { mutationId: MUTATION }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(store.deleteLesson('grist:999', { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'NOT_FOUND' });
  client.tables.Calendar_Lessons[0].fields.Title = 'Changed elsewhere';
  await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }), { code: 'VERSION_CONFLICT' });
  assert.equal(client.writes.length, 0);
  const invalid = mockClient({ invalidRevision: true });
  await assert.rejects(createGristStore({ client: invalid }).deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }),
    { code: 'SCHEMA_ERROR' });
  assert.equal(invalid.writes.length, 0);
});

test('failed deletes preserve data and unknown outcomes remain explicit without blind retries', async () => {
  for (const known of [false, true]) {
    const client = mockClient({ rejectMutation: Object.assign(new Error('private-secret'), { mayHaveMutated: !known, status: 503 }) });
    const store = createGristStore({ client });
    const before = clone(client.tables);
    const lesson = (await store.getSnapshot()).lessons[0];
    await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version, mutationId: MUTATION }), error =>
      error.code === (known ? 'DELETE_FAILED' : 'DELETE_UNCERTAIN') && error.status === 503 &&
      Boolean(error.outcomeUnknown) === !known && !error.message.includes('private-secret'));
    assert.deepEqual(client.tables, before);
    assert.equal(client.writes.length, 1);
  }
});

test('lost delete responses resolve through readback and retry without a second mutation', async () => {
  const client = mockClient({ afterMutation: async () => { throw networkFailure(); } });
  const store = createGristStore({ client });
  const lesson = (await store.getSnapshot()).lessons[0];
  const options = { expectedVersion: lesson.version, mutationId: MUTATION };
  assert.deepEqual(await store.deleteLesson(lesson.id, options), { id: lesson.id });
  assert.deepEqual(await store.deleteLesson(lesson.id, options), { id: lesson.id });
  assert.equal(client.writes.length, 1);
  const unreadable = mockClient({ failReadback: true });
  await assert.rejects(createGristStore({ client: unreadable }).deleteLesson(lesson.id, options),
    { code: 'DELETE_UNCERTAIN', status: 503, outcomeUnknown: true });
  assert.equal(unreadable.tables.Calendar_Lessons[0].fields.Status, 'deleted');
  assert.equal(unreadable.writes.length, 1);
});
