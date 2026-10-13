import { editableFields, storeError, validateLesson } from '../src/lesson-validation.js';
import { LESSON_FIELD_IDS, lessonFields, lessonVersion, normalizeSnapshot } from './grist-model.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validRevision = record => typeof record?.fields?.Calendar_Revision === 'string' && /^[a-f0-9]{64}$/.test(record.fields.Calendar_Revision);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fieldsByName = {
  title: 'Title', teacherId: 'Teacher', group: 'Group_Label', start: 'Start', end: 'End',
  room: 'Room', participantText: 'Participant_Notes', checklist: 'Checklist', status: 'Status', notes: 'Notes',
};
const conflictMessage = 'This lesson changed after you opened it. Reload it before saving again.';

function failure(code, message, status) {
  const error = storeError(code, message);
  error.status = status;
  return error;
}
function uncertain() {
  return Object.assign(failure('SAVE_UNCERTAIN', 'The save could not be confirmed. Keep your draft and retry this same save before starting another edit.', 503),
    { outcomeUnknown: true });
}
function referenceValue(value) {
  if (value == null) return [];
  if (Array.isArray(value) && value[0] === 'L' && value.slice(1).every(id => Number.isSafeInteger(id) && id > 0)) {
    return [...new Set(value.slice(1))].sort((a, b) => a - b);
  }
  return value;
}
function matches(actual, expected) {
  // Grist may canonicalize empty RefLists to null or their ID order on storage.
  // Only readback comparison is semantic; CAS predicates retain every original wire value.
  return Object.entries(expected).every(([field, value]) => ['Teacher', 'Group'].includes(field)
    ? equal(referenceValue(actual[field]), referenceValue(value)) : equal(actual[field], value));
}
function candidateFrom(draft, existing, teachers) {
  const candidate = existing ? structuredClone(existing) : {
    type: 'lesson', title: '', teacherId: '', group: '', start: '', end: '', room: '',
    participantText: '', checklist: '', status: 'scheduled', notes: '',
  };
  for (const field of editableFields) {
    if (Object.hasOwn(draft, field)) candidate[field] = draft[field];
  }
  try { return validateLesson(candidate, teachers); }
  catch (error) { error.status = 400; throw error; }
}
function writableValues(candidate, teachers) {
  const teacher = teachers.find(({ id }) => id === candidate.teacherId);
  const teacherIds = teacher?.sourceIds;
  if (!Array.isArray(teacherIds) || teacherIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw failure('VALIDATION_ERROR', 'Choose a valid teacher for this lesson.', 400);
  }
  return {
    Title: candidate.title, Start: Date.parse(candidate.start) / 1000, End: Date.parse(candidate.end) / 1000,
    Teacher: ['L', ...teacherIds], Group_Label: candidate.group, Room: candidate.room,
    Participant_Notes: candidate.participantText, Checklist: candidate.checklist,
    Status: candidate.status, Notes: candidate.notes,
  };
}

export function createGristStore({ client } = {}) {
  if (!client || typeof client.records !== 'function' || typeof client.request !== 'function') throw new Error('A Grist client is required.');

  async function readTables() {
    const [attendance, performance, folks, lessons] = await Promise.all([
      client.records('ALL_ATT', ['datetime', 'notes', 'student', 'per', 'group2', 'Calendar_Lesson']),
      client.records('PERFORMANCE', ['A', 'type']),
      client.records('FOLKS', ['name']),
      client.records('Calendar_Lessons', LESSON_FIELD_IDS),
    ]);
    return { attendance, performance, folks, lessons };
  }
  async function getSnapshot() { return normalizeSnapshot(await readTables()); }
  function savedLesson(tables, record) {
    if (!validRevision(record)) throw uncertain();
    const lesson = normalizeSnapshot({ ...tables, lessons: [record] }).lessons.find(item => item.id === `grist:${record.id}`);
    if (!lesson) throw uncertain();
    return lesson;
  }
  async function lessonRows() { return client.records('Calendar_Lessons', LESSON_FIELD_IDS); }

  async function saveLesson(draft, { expectedVersion, mutationId } = {}) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || (draft.type && draft.type !== 'lesson')) {
      throw failure('VALIDATION_ERROR', 'Only lessons can be saved through the calendar.', 400);
    }
    if (typeof mutationId !== 'string' || !UUID.test(mutationId)) throw failure('VALIDATION_ERROR', 'A valid save identifier is required.', 400);
    const isUpdate = Boolean(draft.id);
    if (isUpdate && (typeof draft.id !== 'string' || !/^grist:[1-9][0-9]*$/.test(draft.id) || !Number.isSafeInteger(Number(draft.id.slice(6))))) {
      throw failure('VALIDATION_ERROR', 'Choose a valid Grist lesson.', 400);
    }
    if (isUpdate && (typeof expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(expectedVersion))) {
      throw failure('VERSION_CONFLICT', 'Open the lesson again before saving it.', 409);
    }
    if (!isUpdate && (typeof draft.clientId !== 'string' || !UUID.test(draft.clientId))) {
      throw failure('VALIDATION_ERROR', 'A valid new-lesson identifier is required.', 400);
    }
    const tables = await readTables();
    const snapshot = normalizeSnapshot(tables);
    const rowId = isUpdate ? Number(draft.id.slice(6)) : null;
    const current = isUpdate ? tables.lessons.find(record => record.id === rowId) : null;
    if (isUpdate && !current) throw failure('NOT_FOUND', 'This lesson no longer exists. Refresh the calendar.', 404);
    if (isUpdate && !validRevision(current)) {
      throw failure('SCHEMA_ERROR', 'The calendar revision formula is unavailable. Check the Grist calendar setup before saving.', 503);
    }
    const existing = isUpdate ? snapshot.lessons.find(lesson => lesson.id === draft.id) : null;
    if (isUpdate && !existing) throw failure('VERSION_CONFLICT', 'This lesson needs valid scheduling data before it can be edited.', 409);
    const candidate = candidateFrom(draft, existing, snapshot.teachers);
    const values = writableValues(candidate, snapshot.teachers);

    if (!isUpdate) {
      const createFields = { Calendar_UID: draft.clientId, ...values, Group: ['L'],
        Mutation_ID: mutationId, Origin: 'calendar', Import_Key: '' };
      const expected = { ...createFields };
      delete expected.Mutation_ID;
      const duplicate = tables.lessons.filter(record => record.fields.Calendar_UID === draft.clientId);
      if (duplicate.length) {
        if (duplicate.length === 1 && matches(lessonFields(duplicate[0]), expected)) return savedLesson(tables, duplicate[0]);
        throw failure('VERSION_CONFLICT', 'This new-lesson identifier already belongs to a different lesson. Refresh before continuing.', 409);
      }
      let writeFailure;
      try {
        await client.request('PUT', '/tables/Calendar_Lessons/records?noupdate=true&onmany=none&noparse=true',
          { records: [{ require: { Calendar_UID: draft.clientId }, fields: createFields }] });
      } catch (error) { writeFailure = error; }
      let rows;
      try { rows = await lessonRows(); } catch { throw uncertain(); }
      const saved = rows.filter(record => record.fields.Calendar_UID === draft.clientId);
      if (saved.length === 1 && matches(lessonFields(saved[0]), expected)) return savedLesson(tables, saved[0]);
      if (saved.length) throw failure('VERSION_CONFLICT', 'This new-lesson identifier already belongs to a different lesson. Refresh before continuing.', 409);
      if (writeFailure?.mayHaveMutated === false) {
        throw failure('SAVE_FAILED', 'Grist did not accept the lesson. Your draft has been kept; please try again.', writeFailure.status || 503);
      }
      throw uncertain();
    }

    const originalFields = lessonFields(current);
    // A retry after a lost response must resolve the original mutation, even though its version advanced.
    if (originalFields.Mutation_ID === mutationId) {
      if (editableFields.every(field => equal(candidate[field], existing[field]))) return savedLesson(tables, current);
      throw failure('VERSION_CONFLICT', 'This save identifier was already used for another edit. Refresh before continuing.', 409);
    }
    if (lessonVersion(current) !== expectedVersion) throw failure('VERSION_CONFLICT', conflictMessage, 409);
    const changes = { Mutation_ID: mutationId };
    for (const field of editableFields) {
      if (!equal(candidate[field], existing[field])) changes[fieldsByName[field]] = values[fieldsByName[field]];
    }
    const expected = { ...originalFields, ...changes };
    // This formula changes automatically after a write and is never assigned by the calendar.
    delete expected.Calendar_Revision;
    // Grist cannot hash RefLists in an upsert lookup. Its revision formula covers those
    // references plus all scalar fields and is checked atomically by the engine.
    const requireFields = Object.fromEntries(Object.entries(originalFields)
      .filter(([field]) => !['Teacher', 'Group'].includes(field)));
    let result;
    let writeFailure;
    try {
      result = await client.request('PUT', '/tables/Calendar_Lessons/records?noadd=true&onmany=none&noparse=true',
        { records: [{ require: { id: rowId, ...requireFields, Calendar_Revision: current.fields.Calendar_Revision }, fields: changes }] });
    } catch (error) { writeFailure = error; }
    let rows;
    try { rows = await lessonRows(); } catch { throw uncertain(); }
    const saved = rows.find(record => record.id === rowId);
    if (saved && matches(lessonFields(saved), expected)) return savedLesson(tables, saved);
    const explicitMiss = Array.isArray(result?.recordIds?.[0]) && result.recordIds[0].length === 0;
    if (explicitMiss || (saved && lessonVersion(saved) !== expectedVersion)) {
      throw failure('VERSION_CONFLICT', conflictMessage, 409);
    }
    if (writeFailure?.mayHaveMutated === false) {
      throw failure('SAVE_FAILED', 'Grist did not accept the change. Your draft has been kept; please try again.', writeFailure.status || 503);
    }
    throw uncertain();
  }
  return { getSnapshot, saveLesson };
}
