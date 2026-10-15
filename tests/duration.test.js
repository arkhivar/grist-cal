import test from 'node:test';
import assert from 'node:assert/strict';
import { DURATION_PRESETS, durationMinutes, endForDuration, createDurationController } from '../src/duration.js';
import { fromSchoolInput, schoolInput } from '../src/domain.js';
import { createMemoryStore } from '../src/memory-store.js';

test('the exact 40, 60 and 80 minute presets change only the editor end', () => {
  assert.deepEqual(DURATION_PRESETS, [40, 60, 80]);
  const controller = createDurationController('2026-10-15T09:10', '2026-10-15T10:10');
  for (const [minutes, expectedEnd] of [[40, '2026-10-15T09:50'], [60, '2026-10-15T10:10'], [80, '2026-10-15T10:30']]) {
    const state = controller.selectDuration(String(minutes));
    assert.equal(state.start, '2026-10-15T09:10');
    assert.equal(state.end, expectedEnd);
    assert.equal(state.minutes, minutes);
    assert.equal(state.selection, String(minutes));
  }
});

test('preset arithmetic crosses school midnight, leap day and year boundaries', () => {
  assert.equal(endForDuration('2026-10-15T23:40', 40), '2026-10-16T00:20');
  assert.equal(endForDuration('2028-02-28T23:40', 60), '2028-02-29T00:40');
  assert.equal(endForDuration('2026-12-31T23:40', 80), '2027-01-01T01:00');
  assert.equal(durationMinutes('2026-12-31T23:40', '2027-01-01T01:00'), 80);
});

test('duration calculations stay identical under different device timezones', () => {
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone;
      assert.equal(endForDuration('2026-10-15T23:40', 80), '2026-10-16T01:00');
      assert.equal(durationMinutes('2026-10-15T23:40', '2026-10-16T01:00'), 80);
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('opening existing, duplicated or drag-selected custom times never snaps them to a preset', () => {
  for (const minutes of [1, 45, 55, 77, 90, 1440]) {
    const start = '2026-10-15T09:00';
    const end = endForDuration(start, minutes);
    const original = createDurationController(start, end);
    const duplicate = createDurationController(start, end);
    assert.deepEqual(original.getState(), { start, end, minutes, selection: 'custom', customLabel: `Custom (${minutes} min)` });
    assert.deepEqual(duplicate.getState(), original.getState());
  }
  assert.equal(createDurationController('2026-10-15T09:00', '2026-10-15T10:00').getState().selection, '60');
});

test('manual end changes derive the preset or custom duration without changing either time', () => {
  const controller = createDurationController('2026-10-15T09:00', '2026-10-15T10:00');
  const custom = controller.changeEnd('2026-10-15T10:17');
  assert.equal(custom.selection, 'custom');
  assert.equal(custom.customLabel, 'Custom (77 min)');
  assert.equal(custom.end, '2026-10-15T10:17');
  assert.equal(controller.changeEnd('2026-10-15T10:20').selection, '80');
  assert.equal(controller.changeEnd('2026-10-15T09:40').selection, '40');
});

test('start changes preserve current custom or preset durations, including a move across midnight', () => {
  const controller = createDurationController('2026-10-15T09:00', '2026-10-15T09:45');
  assert.equal(controller.changeStart('2026-10-15T23:40').end, '2026-10-16T00:25');
  assert.equal(controller.getState().minutes, 45);
  assert.equal(controller.getState().selection, 'custom');
  controller.selectDuration('80');
  assert.equal(controller.changeStart('2026-10-16T12:10').end, '2026-10-16T13:30');
  assert.equal(controller.getState().selection, '80');
});

test('choosing Custom keeps the current times and supports later manual edits', () => {
  const controller = createDurationController('2026-10-15T09:00', '2026-10-15T10:00');
  const state = controller.selectDuration('custom');
  assert.equal(state.selection, 'custom');
  assert.equal(state.customLabel, 'Custom (60 min)');
  assert.equal(state.start, '2026-10-15T09:00');
  assert.equal(state.end, '2026-10-15T10:00');
  assert.equal(controller.changeEnd('2026-10-15T09:47').minutes, 47);
  assert.equal(controller.changeStart('2026-10-16T11:00').end, '2026-10-16T11:47');
});

test('incomplete start input retains the chosen duration, but invalid manual ends are not overwritten', () => {
  const controller = createDurationController('2026-10-15T09:00', '2026-10-15T09:45');
  assert.equal(controller.changeStart('').end, '2026-10-15T09:45');
  assert.equal(controller.getState().minutes, 45);
  assert.equal(controller.selectDuration('40').end, '2026-10-15T09:45');
  assert.equal(controller.changeStart('2026-10-16T11:00').end, '2026-10-16T11:40');
  assert.equal(controller.changeEnd('').minutes, null);
  assert.equal(controller.changeStart('2026-10-16T12:00').end, '');
  assert.equal(controller.getState().selection, 'custom');
  assert.equal(controller.changeEnd('2026-10-16T11:00').minutes, null);
  assert.equal(controller.changeStart('2026-10-16T10:00').end, '2026-10-16T11:00');
  assert.equal(controller.getState().minutes, 60);
});

test('invalid times and unsupported presets never silently normalize or mutate the draft', () => {
  for (const [start, end] of [['', ''], ['2026-02-30T09:00', '2026-03-01T10:00'],
    ['2026-10-15T09:00', '2026-10-15T09:00'], ['2026-10-15T10:00', '2026-10-15T09:00']]) {
    assert.equal(durationMinutes(start, end), null);
  }
  for (const value of [0, -1, NaN, Infinity, 40.5]) assert.throws(() => endForDuration('2026-10-15T09:00', value));
  assert.throws(() => endForDuration('2026-02-30T09:00', 60));
  assert.throws(() => endForDuration('9999-12-31T23:50', 60));
  const controller = createDurationController('2026-10-15T09:00', '2026-10-15T09:45');
  const original = controller.getState();
  for (const value of ['45', '', '040', undefined]) {
    assert.throws(() => controller.selectDuration(value));
    assert.deepEqual(controller.getState(), original);
  }
});

test('a failed save and source refresh preserve the duration draft; retry saves canonical start/end', async () => {
  const store = createMemoryStore({ anchorDate: '2026-10-15', delayMs: 0 });
  const initial = store.getSnapshot();
  const lesson = initial.lessons[0];
  const controller = createDurationController(schoolInput(lesson.start), schoolInput(lesson.end));
  controller.selectDuration('40');
  controller.changeEnd(endForDuration(controller.getState().start, 47));
  const pending = controller.getState();
  const draft = { id: lesson.id, start: fromSchoolInput(pending.start), end: fromSchoolInput(pending.end) };
  store.failNextSave();
  await assert.rejects(store.saveLesson(draft, { expectedVersion: lesson.version }), { code: 'SAVE_FAILED' });
  assert.deepEqual(store.getSnapshot(), initial);
  await store.refresh();
  assert.deepEqual(controller.getState(), pending);
  const saved = await store.saveLesson(draft, { expectedVersion: lesson.version });
  assert.equal(saved.end, draft.end);
  assert.equal(saved.start, draft.start);
  assert.equal((Date.parse(saved.end) - Date.parse(saved.start)) / 60000, 47);
  assert.equal(Object.hasOwn(saved, 'duration'), false);
  assert.equal(Object.hasOwn(saved, 'minutes'), false);
  assert.deepEqual(store.getSnapshot().attendance, initial.attendance);
});
