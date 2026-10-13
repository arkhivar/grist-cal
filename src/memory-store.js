import { schoolToday } from './domain.js';
import { createDemoData } from './demo-data.js';
import { editableFields, storeError, validateLesson } from './lesson-validation.js';

const clone = (value) => structuredClone(value);

export function createMemoryStore({ anchorDate = schoolToday(), delayMs = 300 } = {}) {
  let state = createDemoData(anchorDate);
  let generation = 0;
  let nextId = 1;
  let failNext = false;
  const subscribers = new Set();
  const getSnapshot = () => clone(state);
  const notify = () => {
    for (const callback of [...subscribers]) {
      // The state has already been committed. A broken view must not report a failed save.
      try { callback(getSnapshot()); }
      catch (error) { console.error('Calendar subscriber failed after the state update.', error); }
    }
  };

  return {
    getSnapshot,
    subscribe(callback) {
      if (typeof callback !== 'function') throw new TypeError('A subscriber must be a function.');
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    async saveLesson(draft, { expectedVersion } = {}) {
      const submitted = clone(draft);
      const saveGeneration = generation;
      const shouldFail = failNext;
      failNext = false;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (generation !== saveGeneration) {
        throw storeError('SAVE_CANCELLED', 'The demo was reset. Open the lesson again to make changes.');
      }
      if (shouldFail) throw storeError('SAVE_FAILED', 'The demo save failed. Your changes were not saved; please try again.');
      if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted) ||
          (submitted.type && submitted.type !== 'lesson')) {
        throw storeError('VALIDATION_ERROR', 'Only lessons can be saved through the calendar.');
      }
      const existing = submitted.id ? state.lessons.find(({ id }) => id === submitted.id) : null;
      if (submitted.id && !existing) throw storeError('NOT_FOUND', 'This lesson no longer exists. Refresh the calendar.');
      if (existing && expectedVersion !== undefined && expectedVersion !== existing.version) {
        throw storeError('VERSION_CONFLICT', 'This lesson changed after you opened it. Reload it before saving again.');
      }
      const candidate = existing ? clone(existing) : {
        id: `lesson-${nextId}`, type: 'lesson', title: '', teacherId: '', group: '',
        start: '', end: '', room: '', participantText: '', checklist: '',
        status: 'scheduled', notes: '', version: 0,
      };
      for (const field of editableFields) {
        if (Object.hasOwn(submitted, field)) candidate[field] = submitted[field];
      }
      validateLesson(candidate, state.teachers);
      candidate.version += 1;
      if (existing) state.lessons = state.lessons.map((lesson) => lesson.id === existing.id ? candidate : lesson);
      else {
        state.lessons.push(candidate);
        nextId += 1;
      }
      notify();
      return clone(candidate);
    },
    failNextSave() { failNext = true; },
    reset() {
      generation += 1;
      state = createDemoData(anchorDate);
      nextId = 1;
      failNext = false;
      notify();
      return getSnapshot();
    },
    async refresh() { return getSnapshot(); },
  };
}
