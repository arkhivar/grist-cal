import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/memory-store.js';
import { fromSchoolInput } from '../src/domain.js';

const makeStore = (extra = {}) => createMemoryStore({ anchorDate: '2026-10-13', delayMs: 0, ...extra });
const newLesson = () => ({ title: 'New lesson', teacherId: 'anna',
  start: fromSchoolInput('2026-10-13T10:00'), end: fromSchoolInput('2026-10-13T11:00') });

test('new lessons get stable IDs and do not silently create or mark attendance', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  const saved = await store.saveLesson({ ...newLesson(), financialRate: 999, type: 'lesson', version: 52 });
  assert.equal(saved.version, 1);
  assert.equal(saved.type, 'lesson');
  assert.equal(saved.status, 'scheduled');
  assert.equal(saved.financialRate, undefined);
  const updated = await store.saveLesson({ id: saved.id, title: 'Renamed' }, { expectedVersion: 1 });
  assert.equal(updated.id, saved.id);
  assert.equal(updated.version, 2);
  assert.deepEqual(store.getSnapshot().attendance, before.attendance);
  assert.deepEqual(store.getSnapshot().teachers, before.teachers);
});

test('moving and resizing a lesson preserve attendance links and manual checklist text', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  const lesson = before.lessons[0];
  const saved = await store.saveLesson({ id: lesson.id,
    start: fromSchoolInput('2026-10-14T14:15'), end: fromSchoolInput('2026-10-14T15:45'),
    attendance: [], studentId: '', salary: 500 }, { expectedVersion: lesson.version });
  assert.equal(saved.id, lesson.id);
  assert.equal(saved.checklist, lesson.checklist);
  assert.equal(saved.salary, undefined);
  assert.equal(saved.studentId, undefined);
  assert.deepEqual(store.getSnapshot().attendance, before.attendance);
});

test('a simulated failed save is atomic, notifies nobody, and only fails once', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  let notices = 0;
  store.subscribe(() => { notices += 1; });
  store.failNextSave();
  await assert.rejects(store.saveLesson(newLesson()), { code: 'SAVE_FAILED' });
  assert.deepEqual(store.getSnapshot(), before);
  assert.equal(notices, 0);
  await store.saveLesson(newLesson());
  assert.equal(notices, 1);
  assert.equal(store.getSnapshot().lessons.length, before.lessons.length + 1);
});

test('invalid drafts cannot mutate the store', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  const cases = [
    { ...newLesson(), title: '  ' },
    { ...newLesson(), teacherId: 'missing' },
    { ...newLesson(), end: newLesson().start },
    { ...newLesson(), end: fromSchoolInput('2026-10-15T11:00') },
    { ...newLesson(), start: '2026-02-30T10:00:00Z' },
    { ...newLesson(), start: new Date(newLesson().start) },
    { ...newLesson(), end: Date.parse(newLesson().end) },
    { ...newLesson(), type: 'attendance' },
    { ...newLesson(), status: 'paid' },
  ];
  for (const draft of cases) {
    await assert.rejects(store.saveLesson(draft), { code: 'VALIDATION_ERROR' });
    assert.deepEqual(store.getSnapshot(), before);
  }
  await assert.rejects(store.saveLesson({ ...newLesson(), id: 'unknown' }), { code: 'NOT_FOUND' });
});

test('text limits are enforced at the store boundary and accept their exact limit', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  const limits = { title: 160, group: 120, room: 120, participantText: 500, checklist: 60, notes: 2000 };
  for (const [field, limit] of Object.entries(limits)) {
    await assert.rejects(store.saveLesson({ ...newLesson(), [field]: 'x'.repeat(limit + 1) }),
      { code: 'VALIDATION_ERROR' });
  }
  assert.deepEqual(store.getSnapshot(), before);
  const exact = Object.fromEntries(Object.entries(limits).map(([field, limit]) => [field, 'x'.repeat(limit)]));
  const saved = await store.saveLesson({ ...newLesson(), ...exact });
  for (const [field, value] of Object.entries(exact)) assert.equal(saved[field], value);
});

test('a failing subscriber cannot turn a committed save into an apparent failed save', async (t) => {
  const store = makeStore();
  const reportedErrors = t.mock.method(console, 'error', () => {});
  let notices = 0;
  store.subscribe(() => { throw new Error('Broken view'); });
  store.subscribe(() => { notices += 1; });
  const saved = await store.saveLesson(newLesson());
  assert.equal(saved.version, 1);
  assert.equal(store.getSnapshot().lessons.at(-1).id, saved.id);
  assert.equal(notices, 1);
  assert.equal(reportedErrors.mock.calls.length, 1);
  store.reset();
  assert.equal(notices, 2);
  assert.equal(reportedErrors.mock.calls.length, 2);
});

test('stale edits cannot overwrite a newer lesson version', async () => {
  const store = makeStore();
  const lesson = store.getSnapshot().lessons[0];
  await store.saveLesson({ id: lesson.id, room: 'Updated room' }, { expectedVersion: 1 });
  const fresh = store.getSnapshot();
  await assert.rejects(store.saveLesson({ id: lesson.id, title: 'Stale title' }, { expectedVersion: 1 }),
    { code: 'VERSION_CONFLICT' });
  assert.deepEqual(store.getSnapshot(), fresh);
});

test('two overlapping saves from the same version cannot both commit', async () => {
  const store = makeStore({ delayMs: 10 });
  const lesson = store.getSnapshot().lessons[0];
  const results = await Promise.allSettled([
    store.saveLesson({ id: lesson.id, title: 'First editor' }, { expectedVersion: lesson.version }),
    store.saveLesson({ id: lesson.id, title: 'Second editor' }, { expectedVersion: lesson.version }),
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'VERSION_CONFLICT');
  const saved = results.find(({ status }) => status === 'fulfilled').value;
  assert.deepEqual(store.getSnapshot().lessons.find(({ id }) => id === lesson.id), saved);
  assert.equal(saved.version, lesson.version + 1);
});

test('cancelling a lesson keeps the lesson identity and every student attendance value', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  const lesson = before.lessons[0];
  const cancelled = await store.saveLesson({ id: lesson.id, status: 'cancelled' }, { expectedVersion: lesson.version });
  assert.equal(cancelled.id, lesson.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.checklist, lesson.checklist);
  assert.deepEqual(store.getSnapshot().attendance, before.attendance);
});

test('soft deletion hides a lesson, retains attendance, and cannot be undone by a stale save', async () => {
  const store = makeStore();
  const before = store.getSnapshot();
  const lesson = before.lessons[0];
  const notices = [];
  store.subscribe(snapshot => { notices.push(snapshot); });
  assert.deepEqual(await store.deleteLesson(lesson.id, { expectedVersion: lesson.version }), { id: lesson.id });
  const after = store.getSnapshot();
  assert.deepEqual(after.lessons, before.lessons.slice(1));
  assert.deepEqual(after.attendance, before.attendance);
  assert.deepEqual(after.teachers, before.teachers);
  assert.deepEqual(notices, [after]);
  assert.deepEqual(await store.refresh(), after);
  assert.deepEqual(await store.deleteLesson(lesson.id, { expectedVersion: lesson.version }), { id: lesson.id });
  assert.equal(notices.length, 1);
  for (const options of [{ expectedVersion: lesson.version }, {}]) {
    await assert.rejects(store.saveLesson({ id: lesson.id, title: 'Resurrected' }, options), { code: 'NOT_FOUND' });
  }
  assert.deepEqual(store.getSnapshot(), after);
  assert.deepEqual(store.reset(), before);
});

test('failed and stale deletions are atomic and failure simulation is consumed once', async () => {
  const store = makeStore();
  const lesson = store.getSnapshot().lessons[0];
  const updated = await store.saveLesson({ id: lesson.id, room: 'New room' }, { expectedVersion: lesson.version });
  const before = store.getSnapshot();
  let notices = 0;
  store.subscribe(() => { notices += 1; });
  await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: lesson.version }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(store.deleteLesson('missing'), { code: 'NOT_FOUND' });
  await assert.rejects(store.deleteLesson(null), { code: 'VALIDATION_ERROR' });
  store.failNextSave();
  await assert.rejects(store.deleteLesson(lesson.id, { expectedVersion: updated.version }), { code: 'SAVE_FAILED' });
  assert.deepEqual(store.getSnapshot(), before);
  assert.equal(notices, 0);
  await store.deleteLesson(lesson.id, { expectedVersion: updated.version });
  assert.equal(notices, 1);
  assert.deepEqual(store.getSnapshot().attendance, before.attendance);
});

test('overlapping edit and delete from the same version cannot both commit', async () => {
  for (const deleteFirst of [true, false]) {
    const store = makeStore({ delayMs: 10 });
    const before = store.getSnapshot();
    const lesson = before.lessons[0];
    const remove = () => store.deleteLesson(lesson.id, { expectedVersion: lesson.version });
    const edit = () => store.saveLesson({ id: lesson.id, title: 'Concurrent edit' }, { expectedVersion: lesson.version });
    const results = await Promise.allSettled(deleteFirst ? [remove(), edit()] : [edit(), remove()]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, deleteFirst ? 'NOT_FOUND' : 'VERSION_CONFLICT');
    const current = store.getSnapshot().lessons.find(row => row.id === lesson.id);
    if (deleteFirst) assert.equal(current, undefined);
    else assert.equal(current.title, 'Concurrent edit');
    assert.deepEqual(store.getSnapshot().attendance, before.attendance);
  }
});

test('reset prevents an in-flight deletion from removing a restored lesson', async () => {
  const store = makeStore({ delayMs: 25 });
  const before = store.getSnapshot();
  const lesson = before.lessons[0];
  const pending = store.deleteLesson(lesson.id, { expectedVersion: lesson.version });
  store.reset();
  await assert.rejects(pending, { code: 'SAVE_CANCELLED' });
  assert.deepEqual(store.getSnapshot(), before);
});

test('reset invalidates an in-flight save, including when IDs are reused', async () => {
  const store = makeStore({ delayMs: 25 });
  const original = store.getSnapshot();
  const pending = store.saveLesson({ id: original.lessons[0].id, title: 'Will be reset' }, { expectedVersion: 1 });
  store.reset();
  await assert.rejects(pending, { code: 'SAVE_CANCELLED' });
  assert.deepEqual(store.getSnapshot(), original);
});

test('snapshots, drafts, saved objects, and subscriber payloads are isolated copies', async () => {
  const store = makeStore({ delayMs: 5 });
  const snapshot = store.getSnapshot();
  snapshot.lessons[0].title = 'External edit';
  snapshot.teachers[0].financialRate = 200;
  assert.notEqual(store.getSnapshot().lessons[0].title, 'External edit');
  assert.equal(store.getSnapshot().teachers[0].financialRate, undefined);
  let observerTitle;
  store.subscribe((data) => { data.lessons.at(-1).title = 'Mutated callback'; });
  const unsubscribe = store.subscribe((data) => { observerTitle = data.lessons.at(-1).title; });
  const draft = newLesson();
  const pending = store.saveLesson(draft);
  draft.title = 'Changed while awaiting';
  const saved = await pending;
  assert.equal(saved.title, 'New lesson');
  assert.equal(observerTitle, 'New lesson');
  saved.title = 'External saved edit';
  assert.equal(store.getSnapshot().lessons.at(-1).title, 'New lesson');
  unsubscribe();
  await store.saveLesson({ id: saved.id, title: 'Another title' });
  assert.equal(observerTitle, 'New lesson');
  const refreshed = await store.refresh();
  refreshed.attendance[0].status = 'edited';
  assert.notEqual(store.getSnapshot().attendance[0].status, 'edited');
});
