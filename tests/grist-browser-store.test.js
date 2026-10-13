import test from 'node:test';
import assert from 'node:assert/strict';
import { createGristStore, readCalendarConfig } from '../src/grist-store.js';

const token = 'synthetic-session-token';
const lesson = (changes = {}) => ({
  id: 'grist-lesson-1', type: 'lesson', title: 'Synthetic lesson', teacherId: 'per:17,18',
  start: '2026-10-13T00:00:00.000Z', end: '2026-10-13T01:00:00.000Z',
  status: 'scheduled', version: 1, ...changes,
});
const snapshot = (lessons = [lesson()]) => ({
  lessons,
  teachers: [{ id: 'per:17,18', name: 'Teacher A / Teacher B', color: '#2563eb' }],
  attendance: [{ id: 'attendance-1', type: 'attendance', lessonId: 'grist-lesson-1',
    studentId: 'student-1', studentName: 'Fictional student', sourceRowId: 41, status: 'recorded' }],
  meta: { unlinkedAttendanceCount: 0, latestLessonDate: '2026-10-13' },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('a lost create response retries with the same mutation and client identity', async t => {
  const submitted = [];
  const serverRows = new Map();
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path === '/api/snapshot') return json(snapshot([]));
    assert.equal(path, '/api/lessons');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['X-Calendar-Token'], token);
    const request = JSON.parse(options.body);
    submitted.push(request);
    const saved = serverRows.get(request.draft.clientId) || lesson({ title: request.draft.title });
    serverRows.set(request.draft.clientId, saved);
    if (submitted.length === 1) throw new TypeError('Synthetic response lost after commit');
    return json({ lesson: saved, snapshot: snapshot([saved]) });
  });
  const store = await createGristStore({ csrfToken: token });
  const draft = { clientId: 'synthetic-stable-client-id', title: 'New fictional lesson', type: 'lesson' };
  await assert.rejects(store.saveLesson(draft), { code: 'NETWORK_ERROR', outcomeUnknown: true });
  assert.equal(store.getSnapshot().lessons.length, 0, 'an unacknowledged create must not be invented locally');

  // A reconstructed form object may have a different property order while its payload is unchanged.
  const saved = await store.saveLesson({ type: draft.type, title: draft.title, clientId: draft.clientId });
  assert.equal(submitted[0].mutationId, submitted[1].mutationId);
  assert.equal(submitted[0].draft.clientId, submitted[1].draft.clientId);
  assert.ok(submitted[0].mutationId);
  assert.equal(serverRows.size, 1);
  assert.equal(store.getSnapshot().lessons[0].id, saved.id);
});

test('changing a failed draft uses a new mutation but retains its client create identity', async t => {
  const submitted = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path === '/api/snapshot') return json(snapshot([]));
    submitted.push(JSON.parse(options.body));
    return json({ error: { code: 'VALIDATION_ERROR', message: 'Synthetic validation failure.' } }, 400);
  });
  const store = await createGristStore({ csrfToken: token });
  const draft = { clientId: 'one-editor-id', title: '' };
  await assert.rejects(store.saveLesson(draft), { code: 'VALIDATION_ERROR', outcomeUnknown: false });
  draft.title = 'Corrected title';
  await assert.rejects(store.saveLesson(draft), { code: 'VALIDATION_ERROR' });
  assert.notEqual(submitted[0].mutationId, submitted[1].mutationId);
  assert.equal(submitted[0].draft.clientId, submitted[1].draft.clientId);
});

test('an acknowledged create or update succeeds when the follow-up snapshot cannot refresh', async t => {
  for (const creating of [false, true]) {
    await t.test(creating ? 'create' : 'update', async t => {
      const before = snapshot(creating ? [] : [lesson()]);
      const acknowledged = lesson({ title: 'Acknowledged title', version: creating ? 1 : 2 });
      t.mock.method(globalThis, 'fetch', async path => path === '/api/snapshot'
        ? json(before)
        : json({ lesson: acknowledged, snapshot: null, refreshWarning: true }));
      const store = await createGristStore({ csrfToken: token });
      const published = [];
      store.subscribe(value => published.push(value));
      const saved = await store.saveLesson(creating
        ? { clientId: 'new-editor-id', title: acknowledged.title }
        : { id: acknowledged.id, title: acknowledged.title }, { expectedVersion: creating ? undefined : 1 });
      assert.equal(saved.refreshWarning, true);
      assert.equal(saved.id, acknowledged.id);
      assert.equal(published.length, 1);
      assert.deepEqual(store.getSnapshot().lessons, [acknowledged]);
      assert.deepEqual(store.getSnapshot().attendance, before.attendance);
      assert.deepEqual(store.getSnapshot().teachers, before.teachers);
    });
  }
});

test('failed refreshes preserve the last snapshot and leave the request queue usable', async t => {
  const before = snapshot();
  const after = snapshot([lesson({ title: 'Refreshed title', version: 2 })]);
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    reads += 1;
    if (reads === 1) return json(before);
    if (reads === 2) throw new TypeError('Synthetic offline state');
    if (reads === 3) return json({ lessons: [] });
    return json(after);
  });
  const store = await createGristStore({ csrfToken: token });
  let publications = 0;
  store.subscribe(() => { publications += 1; });
  await assert.rejects(store.refresh(), { code: 'NETWORK_ERROR', outcomeUnknown: false });
  assert.deepEqual(store.getSnapshot(), before);
  await assert.rejects(store.refresh(), { code: 'INVALID_RESPONSE' });
  assert.deepEqual(store.getSnapshot(), before);
  assert.equal(publications, 0, 'failed reads must not replace UI data');
  assert.deepEqual(await store.refresh(), after);
  assert.equal(publications, 1);
});

test('a subscriber exception cannot turn an acknowledged write into a failed save', async t => {
  const acknowledged = lesson({ title: 'Committed title', version: 2 });
  const reported = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async path => path === '/api/snapshot'
    ? json(snapshot()) : json({ lesson: acknowledged, snapshot: snapshot([acknowledged]) }));
  const store = await createGristStore({ csrfToken: token });
  store.subscribe(value => { value.lessons.length = 0; throw new Error('Synthetic renderer failure'); });
  let secondSubscriber;
  store.subscribe(value => { secondSubscriber = value; });
  const saved = await store.saveLesson({ id: acknowledged.id, title: acknowledged.title }, { expectedVersion: 1 });
  assert.equal(saved.version, 2);
  assert.equal(reported.mock.callCount(), 1);
  assert.deepEqual(secondSubscriber.lessons, [acknowledged]);
  assert.deepEqual(store.getSnapshot().lessons, [acknowledged]);
  secondSubscriber.lessons[0].title = 'External mutation';
  saved.title = 'Changed result';
  assert.equal(store.getSnapshot().lessons[0].title, 'Committed title');
});

test('an earlier slow refresh cannot overwrite a save requested while that read is in flight', async t => {
  const refreshStarted = deferred();
  const refreshResponse = deferred();
  const calls = [];
  let reads = 0;
  const acknowledged = lesson({ title: 'Newest title', version: 2 });
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push(options.method || 'GET');
    if (path === '/api/snapshot') {
      reads += 1;
      if (reads === 1) return json(snapshot());
      refreshStarted.resolve();
      return refreshResponse.promise;
    }
    return json({ lesson: acknowledged, snapshot: snapshot([acknowledged]) });
  });
  const store = await createGristStore({ csrfToken: token });
  const versions = [];
  store.subscribe(value => versions.push(value.lessons[0].version));
  const refreshing = store.refresh();
  await refreshStarted.promise;
  const saving = store.saveLesson({ id: acknowledged.id, title: acknowledged.title }, { expectedVersion: 1 });
  await Promise.resolve();
  assert.deepEqual(calls, ['GET', 'GET'], 'save waits for the earlier refresh to settle');
  refreshResponse.resolve(json(snapshot()));
  await Promise.all([refreshing, saving]);
  assert.deepEqual(versions, [1, 2]);
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  assert.equal(store.getSnapshot().lessons[0].title, 'Newest title');
});

test('a refresh requested during an in-flight save waits and reads the committed state', async t => {
  const saveStarted = deferred();
  const saveResponse = deferred();
  let persisted = snapshot();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async path => {
    if (path === '/api/snapshot') { reads += 1; return json(persisted); }
    saveStarted.resolve();
    return saveResponse.promise;
  });
  const store = await createGristStore({ csrfToken: token });
  const saving = store.saveLesson({ id: lesson().id, title: 'Changed' }, { expectedVersion: 1 });
  await saveStarted.promise;
  const refreshing = store.refresh();
  await Promise.resolve();
  assert.equal(reads, 1, 'refresh cannot read the old server state while the write is pending');
  const acknowledged = lesson({ title: 'Changed', version: 2 });
  persisted = snapshot([acknowledged]);
  saveResponse.resolve(json({ lesson: acknowledged, snapshot: persisted }));
  await Promise.all([saving, refreshing]);
  assert.equal(reads, 2);
  assert.equal(store.getSnapshot().lessons[0].version, 2);
});

test('conflicts forward the expected version and preserve the submitted object and current snapshot', async t => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path === '/api/snapshot') return json(snapshot());
    sent = JSON.parse(options.body);
    return json({ error: { code: 'VERSION_CONFLICT', message: 'This lesson changed in Grist.' } }, 409);
  });
  const store = await createGristStore({ csrfToken: token });
  const before = store.getSnapshot();
  const draft = { id: lesson().id, title: 'Unsubmitted form title' };
  const saving = store.saveLesson(draft, { expectedVersion: 1 });
  draft.title = 'Further typing while request queues';
  await assert.rejects(saving, { code: 'VERSION_CONFLICT', outcomeUnknown: false });
  assert.equal(sent.expectedVersion, 1);
  assert.equal(sent.draft.title, 'Unsubmitted form title', 'the adapter snapshots the submitted payload');
  assert.equal(draft.title, 'Further typing while request queues');
  assert.deepEqual(store.getSnapshot(), before);
});

test('unknown write outcomes from HTTP errors remain explicitly unknown', async t => {
  t.mock.method(globalThis, 'fetch', async path => path === '/api/snapshot'
    ? json(snapshot())
    : json({ error: { code: 'UPSTREAM_TIMEOUT', message: 'The write could not be confirmed.', outcomeUnknown: true } }, 502));
  const store = await createGristStore({ csrfToken: token });
  const before = store.getSnapshot();
  await assert.rejects(store.saveLesson({ id: lesson().id, title: 'Changed' }, { expectedVersion: 1 }),
    { code: 'UPSTREAM_TIMEOUT', outcomeUnknown: true });
  assert.deepEqual(store.getSnapshot(), before);
});

test('invalid server configuration or unavailable initial data fail without a demo fallback', async t => {
  let response = json({ mode: 'unexpected' });
  t.mock.method(globalThis, 'fetch', async () => response);
  await assert.rejects(readCalendarConfig(), { code: 'INVALID_CONFIG' });
  response = json({ mode: 'grist' });
  await assert.rejects(readCalendarConfig(), { code: 'INVALID_CONFIG' });
  response = json({ mode: 'demo' });
  assert.equal((await readCalendarConfig()).mode, 'demo');
  response = json({ error: { code: 'GRIST_UNAVAILABLE', message: 'Grist is unavailable.' } }, 503);
  await assert.rejects(createGristStore({ csrfToken: token }), { code: 'GRIST_UNAVAILABLE' });
});

test('a lost delete response retains the lesson locally and retries with the same mutation identity', async t => {
  const submitted = [];
  const before = snapshot();
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (path === '/api/snapshot') return json(before);
    assert.equal(path, '/api/lessons/delete');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Calendar-Token'], token);
    submitted.push(JSON.parse(options.body));
    if (submitted.length === 1) throw new TypeError('Synthetic lost deletion response');
    return json({ lessonId: lesson().id, snapshot: snapshot([]) });
  });
  const store = await createGristStore({ csrfToken: token });
  await assert.rejects(store.deleteLesson(lesson().id, { expectedVersion: 1 }), { code: 'NETWORK_ERROR', outcomeUnknown: true });
  assert.deepEqual(store.getSnapshot(), before);
  assert.deepEqual(await store.deleteLesson(lesson().id, { expectedVersion: 1 }), { id: lesson().id });
  assert.equal(submitted[0].mutationId, submitted[1].mutationId);
  assert.equal(submitted[1].id, lesson().id);
  assert.equal(submitted[1].expectedVersion, 1);
  assert.equal(store.getSnapshot().lessons.length, 0);
  assert.deepEqual(store.getSnapshot().attendance, before.attendance);
});

test('an acknowledged delete removes only its lesson when the follow-up snapshot cannot refresh', async t => {
  const before = snapshot([lesson(), lesson({ id: 'another-lesson' })]);
  t.mock.method(globalThis, 'fetch', async path => path === '/api/snapshot' ? json(before)
    : json({ lessonId: lesson().id, snapshot: null, refreshWarning: true }));
  const store = await createGristStore({ csrfToken: token });
  let published;
  store.subscribe(value => { published = value; });
  const result = await store.deleteLesson(lesson().id, { expectedVersion: 1 });
  assert.deepEqual(result, { id: lesson().id, refreshWarning: true });
  assert.deepEqual(store.getSnapshot().lessons, [before.lessons[1]]);
  assert.deepEqual(store.getSnapshot().attendance, before.attendance);
  assert.deepEqual(store.getSnapshot().teachers, before.teachers);
  published.lessons.length = 0;
  assert.equal(store.getSnapshot().lessons.length, 1);
});

test('failed, stale and unverifiable deletes preserve the browser snapshot', async t => {
  const before = snapshot();
  let response;
  t.mock.method(globalThis, 'fetch', async path => path === '/api/snapshot' ? json(before) : response());
  const store = await createGristStore({ csrfToken: token });
  for (const [code, status, unknown] of [['DELETE_FAILED', 503, false], ['VERSION_CONFLICT', 409, false], ['DELETE_UNCERTAIN', 503, true]]) {
    response = () => json({ error: { code, message: 'Deletion failed safely.', outcomeUnknown: unknown } }, status);
    await assert.rejects(store.deleteLesson(lesson().id, { expectedVersion: 1 }), { code, outcomeUnknown: unknown });
    assert.deepEqual(store.getSnapshot(), before);
  }
  response = () => json({ lessonId: 'different-lesson', snapshot: snapshot([]) });
  await assert.rejects(store.deleteLesson(lesson().id, { expectedVersion: 1 }), { code: 'INVALID_RESPONSE', outcomeUnknown: true });
  response = () => json({ lessonId: lesson().id, snapshot: before });
  await assert.rejects(store.deleteLesson(lesson().id, { expectedVersion: 1 }), { code: 'INVALID_RESPONSE', outcomeUnknown: true });
  assert.deepEqual(store.getSnapshot(), before);
});

test('a refresh during deletion waits for the committed result and cannot restore the deleted lesson', async t => {
  const deleteStarted = deferred();
  const deleteResponse = deferred();
  let persisted = snapshot();
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async path => {
    if (path === '/api/snapshot') { reads++; return json(persisted); }
    assert.equal(path, '/api/lessons/delete');
    deleteStarted.resolve();
    return deleteResponse.promise;
  });
  const store = await createGristStore({ csrfToken: token });
  const deleting = store.deleteLesson(lesson().id, { expectedVersion: 1 });
  await deleteStarted.promise;
  const refreshing = store.refresh();
  await Promise.resolve();
  assert.equal(reads, 1);
  persisted = snapshot([]);
  deleteResponse.resolve(json({ lessonId: lesson().id, snapshot: persisted }));
  await Promise.all([deleting, refreshing]);
  assert.equal(reads, 2);
  assert.equal(store.getSnapshot().lessons.length, 0);
  assert.equal(store.getSnapshot().attendance.length, 1);
});
