import { editableFields, storeError, validateLesson } from '../src/lesson-validation.js';
import { lessonTitleTextLength } from '../src/lesson-title.js';
import { schoolToday } from '../src/domain.js';
import { ALL_ATT_FIELDS, PERFORMANCE_FIELDS, classifyRow, lessonFields, lessonVersion, normalizeAllAttSnapshot } from './all-att-model.mjs';
import { DATE_REGISTRY_FIELDS, DATE_REGISTRY_TABLE, inspectDateRegistry } from './date-registry.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const referenceFields = ['t', 'student', 'group2'];
const identityFields = ['lessonKind', 'studentIds', 'groupIds'];
const validRevision = record => typeof record?.fields?.Calendar_Revision === 'string' && HASH.test(record.fields.Calendar_Revision);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fieldsByName = {
  title: 'Calendar_Title', teacherId: 't', group: 'Calendar_Group_Label', start: 'start',
  room: 'Calendar_Room', participantText: 'Calendar_Participants', checklist: 'Calendar_Checklist',
  status: 'Calendar_Status', notes: 'Calendar_Notes',
};
const conflictMessage = 'This lesson changed after you opened it. Reload it before saving again.';

function failure(code, message, status) {
  return Object.assign(storeError(code, message), { status });
}
function uncertain(deleting = false) {
  return Object.assign(failure(deleting ? 'DELETE_UNCERTAIN' : 'SAVE_UNCERTAIN', deleting
    ? 'The deletion could not be confirmed. Retry this same deletion to check safely.'
    : 'The save could not be confirmed. Keep your draft and retry this same save before starting another edit.', 503),
  { outcomeUnknown: true });
}
function rowIdFrom(id) {
  if (typeof id !== 'string' || !/^all-att:[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id.slice(8)))) {
    throw failure('VALIDATION_ERROR', 'Choose a valid ALL_ATT lesson.', 400);
  }
  return Number(id.slice(8));
}
function referenceValue(value) {
  if (value == null) return [];
  if (Array.isArray(value) && value[0] === 'L' && value.slice(1).every(id => Number.isSafeInteger(id) && id > 0)) {
    return [...new Set(value.slice(1))].sort((a, b) => a - b);
  }
  return value;
}
function matches(actual, expected) {
  // Grist can canonicalize an empty RefList to null or change its ordering.
  return Object.entries(expected).every(([field, value]) => referenceFields.includes(field)
    ? equal(referenceValue(actual[field]), referenceValue(value))
    // Python datetime rounds to microseconds; JS epoch arithmetic can differ by
    // a few floating-point units. Only the calculated end gets this tolerance.
    : field === 'end' && typeof value === 'number' && typeof actual[field] === 'number'
      ? Number.isFinite(value) && Number.isFinite(actual[field]) && Math.abs(actual[field] - value) <= 0.000002
      : equal(actual[field], value));
}
function canonicalIds(ids, prefix) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' ||
    !new RegExp(`^${prefix}:[1-9][0-9]*$`).test(id) || !Number.isSafeInteger(Number(id.slice(prefix.length + 1))))) {
    throw failure('VALIDATION_ERROR', 'Choose valid student and group references for this lesson.', 400);
  }
  return [...new Set(ids)].sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
}
function candidateFrom(draft, existing, snapshot, sourceDuration) {
  const candidate = existing ? structuredClone(existing) : {
    type: 'lesson', title: '', teacherId: '', group: '', start: '', end: '', room: '',
    participantText: '', checklist: '', status: 'scheduled', notes: '',
    lessonKind: 'group', studentIds: [], groupIds: [],
  };
  for (const field of [...editableFields, ...identityFields]) {
    if (Object.hasOwn(draft, field)) candidate[field] = structuredClone(draft[field]);
  }
  if (existing && Object.hasOwn(draft, 'start') && !Object.hasOwn(draft, 'end')) {
    // A partial move follows the same rule as a calendar drag: preserve minutes.
    try { candidate.end = new Date(Math.round(Date.parse(candidate.start) + sourceDuration * 60000)).toISOString(); }
    catch { throw failure('VALIDATION_ERROR', 'Choose a valid lesson start.', 400); }
  }
  candidate.studentIds = canonicalIds(candidate.studentIds, 'folks');
  candidate.groupIds = canonicalIds(candidate.groupIds, 'per');
  if (!['group', 'individual'].includes(candidate.lessonKind)) {
    throw failure('VALIDATION_ERROR', 'Choose a group or individual lesson.', 400);
  }
  if (existing) {
    if (identityFields.some(field => !equal(candidate[field], existing[field]))) {
      throw failure('VALIDATION_ERROR', 'The lesson type, student and group references cannot be changed on an existing lesson.', 400);
    }
  } else {
    if (candidate.lessonKind === 'group' && candidate.studentIds.length) {
      throw failure('VALIDATION_ERROR', 'A group lesson header cannot contain student attendance references.', 400);
    }
    if (candidate.lessonKind === 'individual' && (candidate.studentIds.length !== 1 || candidate.groupIds.length)) {
      throw failure('VALIDATION_ERROR', 'Choose exactly one student and no group for an individual lesson.', 400);
    }
    if (candidate.studentIds.some(id => !snapshot.students.some(student => student.id === id)) ||
      candidate.groupIds.some(id => !snapshot.groups.some(group => group.id === id))) {
      throw failure('VALIDATION_ERROR', 'Choose existing students and groups for this lesson.', 400);
    }
  }
  try {
    validateLesson(candidate, snapshot.teachers, { requireTitle: false, titleTextLength: lessonTitleTextLength });
    // The displayed title may be automatic. Omitted title metadata must retain
    // its original stored value, including whitespace, during unrelated edits.
    if (existing && !Object.hasOwn(draft, 'title')) candidate.title = existing.title;
    return candidate;
  }
  catch (error) { error.status = 400; throw error; }
}
function writableValues(candidate, teachers, { existing, retainedTeacherId, sourceDuration, preserveDuration }) {
  const teacher = teachers.find(({ id }) => id === candidate.teacherId);
  const teacherIds = teacher?.sourceIds;
  if (!Array.isArray(teacherIds) || teacherIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw failure('VALIDATION_ERROR', 'Choose a valid teacher for this lesson.', 400);
  }
  if (candidate.teacherId !== retainedTeacherId && teacher.selectable !== true) {
    throw failure('VALIDATION_ERROR', 'Choose a teacher labelled team in Grist.', 400);
  }
  const elapsed = Date.parse(candidate.end) - Date.parse(candidate.start);
  const unchangedDuration = existing && elapsed === Date.parse(existing.end) - Date.parse(existing.start);
  return {
    Calendar_Title: candidate.title, start: Date.parse(candidate.start) / 1000,
    // Preserve fractional stored values on moves, including precision finer than
    // the public ISO timestamps. Resizing derives a new value from the endpoints.
    Duration_Minutes: existing && (preserveDuration || unchangedDuration) ? sourceDuration : elapsed / 60000,
    t: ['L', ...teacherIds], Calendar_Group_Label: candidate.group, Calendar_Room: candidate.room,
    Calendar_Participants: candidate.participantText, Calendar_Checklist: candidate.checklist,
    Calendar_Status: candidate.status, Calendar_Notes: candidate.notes,
  };
}

export function createAllAttStore({ client } = {}) {
  if (!client || typeof client.records !== 'function' || typeof client.request !== 'function') throw new Error('A Grist client is required.');

  async function lessonRows() { return client.records('ALL_ATT', ALL_ATT_FIELDS); }
  async function readTables() {
    const [attendance, performance, folks] = await Promise.all([
      lessonRows(), client.records('PERFORMANCE', PERFORMANCE_FIELDS), client.records('FOLKS', ['name']),
    ]);
    return { attendance, performance, folks };
  }
  async function readCalendarDates() {
    try {
      const records = await client.records(DATE_REGISTRY_TABLE, DATE_REGISTRY_FIELDS);
      return { available: true, ...inspectDateRegistry(records) };
    } catch {
      // Calendar metadata is optional for displaying and editing a valid schedule.
      // Keep private upstream details out of the snapshot when this read fails.
      return { available: false, ...inspectDateRegistry([]) };
    }
  }
  async function getSnapshot() {
    // Load date metadata once per snapshot; save preflight/readback do not need it.
    const [tables, registry] = await Promise.all([readTables(), readCalendarDates()]);
    const snapshot = normalizeAllAttSnapshot(tables);
    const dates = new Map(registry.rows.map(row => [row.date, row]));
    const unmatchedDates = new Set();
    let unmatchedLessonCount = 0;
    for (const lesson of snapshot.lessons) {
      const date = schoolToday(lesson.start);
      lesson.calendarDateId = dates.get(date)?.id || '';
      if (!lesson.calendarDateId) {
        unmatchedDates.add(date);
        unmatchedLessonCount += 1;
      }
    }
    return { ...snapshot, calendarDates: registry.rows, meta: { ...snapshot.meta,
      dateRegistry: { ...registry.summary, available: registry.available,
        unmatchedLessonCount, unmatchedLessonDateCount: unmatchedDates.size },
    } };
  }
  function savedLesson(tables, record) {
    if (!validRevision(record)) throw uncertain();
    const attendance = [...tables.attendance.filter(row => row.id !== record.id), record];
    const lesson = normalizeAllAttSnapshot({ ...tables, attendance }).lessons.find(item => item.id === `all-att:${record.id}`);
    if (!lesson) throw uncertain();
    return lesson;
  }

  async function saveLesson(draft, { expectedVersion, mutationId } = {}) {
    if (!draft || typeof draft !== 'object' || Array.isArray(draft) || (draft.type && draft.type !== 'lesson')) {
      throw failure('VALIDATION_ERROR', 'Only lessons can be saved through the calendar.', 400);
    }
    if (typeof mutationId !== 'string' || !UUID.test(mutationId)) throw failure('VALIDATION_ERROR', 'A valid save identifier is required.', 400);
    const isUpdate = Boolean(draft.id);
    const rowId = isUpdate ? rowIdFrom(draft.id) : null;
    if (isUpdate && (typeof expectedVersion !== 'string' || !HASH.test(expectedVersion))) {
      throw failure('VERSION_CONFLICT', 'Open the lesson again before saving it.', 409);
    }
    if (!isUpdate && (typeof draft.clientId !== 'string' || !UUID.test(draft.clientId))) {
      throw failure('VALIDATION_ERROR', 'A valid new-lesson identifier is required.', 400);
    }
    const tables = await readTables();
    const snapshot = normalizeAllAttSnapshot(tables);
    const current = isUpdate ? tables.attendance.find(record => record.id === rowId) : null;
    if (isUpdate && !current) throw failure('NOT_FOUND', 'This lesson no longer exists. Refresh the calendar.', 404);
    if (isUpdate && classifyRow(current) === 'attendance') {
      throw failure('VALIDATION_ERROR', 'Student attendance rows cannot be edited as calendar lessons.', 400);
    }
    if (isUpdate && current.fields.Calendar_Status === 'deleted') {
      throw failure('VERSION_CONFLICT', 'This lesson was deleted. Refresh the calendar before making another change.', 409);
    }
    if (isUpdate && !validRevision(current)) {
      throw failure('SCHEMA_ERROR', 'The calendar revision formula is unavailable. Check the Grist calendar setup before saving.', 503);
    }
    const displayedLesson = isUpdate ? snapshot.lessons.find(lesson => lesson.id === draft.id) : null;
    const existing = displayedLesson ? { ...displayedLesson,
      title: typeof current.fields.Calendar_Title === 'string' ? current.fields.Calendar_Title : '',
    } : null;
    if (isUpdate && !existing) throw failure('VERSION_CONFLICT', 'This lesson needs valid scheduling data before it can be edited.', 409);
    const sourceDuration = current?.fields.Duration_Minutes;
    if (isUpdate && (typeof sourceDuration !== 'number' || !Number.isFinite(sourceDuration) || sourceDuration <= 0)) {
      throw failure('SCHEMA_ERROR', 'This lesson needs a valid stored duration before it can be edited.', 503);
    }
    const candidate = candidateFrom(draft, existing, snapshot, sourceDuration);
    const duplicate = isUpdate ? [] : tables.attendance.filter(record => record.fields.Calendar_UID === draft.clientId);
    // A completed creation may be retried after its teacher loses the team label.
    // Matching the saved values below confirms it without assigning a new teacher.
    const created = duplicate.length === 1 ? snapshot.lessons.find(lesson => lesson.sourceRowId === duplicate[0].id) : null;
    const values = writableValues(candidate, snapshot.teachers, { existing, retainedTeacherId: (existing || created)?.teacherId, sourceDuration,
      preserveDuration: isUpdate && Object.hasOwn(draft, 'start') && !Object.hasOwn(draft, 'end') });

    if (!isUpdate) {
      const createFields = { Calendar_UID: draft.clientId, ...values,
        student: ['L', ...candidate.studentIds.map(id => Number(id.slice(6)))],
        group2: ['L', ...candidate.groupIds.map(id => Number(id.slice(4)))],
        Calendar_Mutation: mutationId, Calendar_Parent: 0, Calendar_Attendance: 'pending' };
      const expected = { ...createFields, end: createFields.start + createFields.Duration_Minutes * 60 };
      delete expected.Calendar_Mutation;
      if (duplicate.length) {
        if (duplicate.length === 1 && matches(lessonFields(duplicate[0]), expected)) return savedLesson(tables, duplicate[0]);
        throw failure('VERSION_CONFLICT', 'This new-lesson identifier already belongs to a different lesson. Refresh before continuing.', 409);
      }
      let writeFailure;
      try {
        await client.request('PUT', '/tables/ALL_ATT/records?noupdate=true&onmany=none&noparse=true',
          { records: [{ require: { Calendar_UID: draft.clientId }, fields: createFields }] });
      } catch (error) { writeFailure = error; }
      let rows;
      try { rows = await lessonRows(); } catch { throw uncertain(); }
      const saved = rows.filter(record => record.fields.Calendar_UID === draft.clientId);
      if (saved.length === 1 && matches(lessonFields(saved[0]), expected)) return savedLesson({ ...tables, attendance: rows }, saved[0]);
      if (saved.length) throw failure('VERSION_CONFLICT', 'This new-lesson identifier already belongs to a different lesson. Refresh before continuing.', 409);
      if (writeFailure?.mayHaveMutated === false) {
        throw failure('SAVE_FAILED', 'Grist did not accept the lesson. Your draft has been kept; please try again.', writeFailure.status || 503);
      }
      throw uncertain();
    }

    const originalFields = lessonFields(current);
    // A lost response can be resolved by its mutation even when the original version is now stale.
    if (originalFields.Calendar_Mutation === mutationId) {
      // A move preserves the raw duration even if it contains fractional
      // milliseconds that the public timestamps cannot express. Rounding the
      // old endpoints independently can make a repeated end differ by 1 ms.
      const sameEnd = equal(candidate.end, existing.end) || (!Number.isInteger(sourceDuration * 60000) &&
        Math.abs(Date.parse(candidate.end) - Date.parse(existing.end)) <= 1);
      if (sameEnd && editableFields.filter(field => field !== 'end').every(field => equal(candidate[field], existing[field]))) {
        return savedLesson(tables, current);
      }
      throw failure('VERSION_CONFLICT', 'This save identifier was already used for another edit. Refresh before continuing.', 409);
    }
    if (lessonVersion(current) !== expectedVersion) throw failure('VERSION_CONFLICT', conflictMessage, 409);
    const changes = { Calendar_Mutation: mutationId };
    for (const field of editableFields) {
      if (field !== 'end' && !equal(candidate[field], existing[field])) changes[fieldsByName[field]] = values[fieldsByName[field]];
    }
    if (!equal(values.Duration_Minutes, sourceDuration)) changes.Duration_Minutes = values.Duration_Minutes;
    const expected = { ...originalFields, ...changes };
    if (Object.hasOwn(changes, 'start') || Object.hasOwn(changes, 'Duration_Minutes')) {
      expected.end = expected.start + expected.Duration_Minutes * 60;
    }
    delete expected.Calendar_Revision;
    let result;
    let writeFailure;
    try {
      // The scalar revision covers the raw source and calendar fields, including RefLists.
      // It avoids unhashable RefLists in Grist upsert predicates and checks atomically.
      result = await client.request('PUT', '/tables/ALL_ATT/records?noadd=true&onmany=none&noparse=true',
        { records: [{ require: { id: current.id, Calendar_Revision: current.fields.Calendar_Revision }, fields: changes }] });
    } catch (error) { writeFailure = error; }
    let rows;
    try { rows = await lessonRows(); } catch { throw uncertain(); }
    const saved = rows.find(record => record.id === rowId);
    if (saved && matches(lessonFields(saved), expected)) return savedLesson({ ...tables, attendance: rows }, saved);
    const explicitMiss = Array.isArray(result?.recordIds?.[0]) && result.recordIds[0].length === 0;
    if (explicitMiss || (saved && lessonVersion(saved) !== expectedVersion)) {
      throw failure('VERSION_CONFLICT', conflictMessage, 409);
    }
    if (writeFailure?.mayHaveMutated === false) {
      throw failure('SAVE_FAILED', 'Grist did not accept the change. Your draft has been kept; please try again.', writeFailure.status || 503);
    }
    throw uncertain();
  }

  async function deleteLesson(id, { expectedVersion, mutationId } = {}) {
    const rowId = rowIdFrom(id);
    if (typeof mutationId !== 'string' || !UUID.test(mutationId)) {
      throw failure('VALIDATION_ERROR', 'A valid deletion identifier is required.', 400);
    }
    if (typeof expectedVersion !== 'string' || !HASH.test(expectedVersion)) {
      throw failure('VERSION_CONFLICT', 'Open the lesson again before deleting it.', 409);
    }
    const rows = await lessonRows();
    const current = rows.find(record => record.id === rowId);
    if (!current) throw failure('NOT_FOUND', 'This lesson no longer exists. Refresh the calendar.', 404);
    if (classifyRow(current) === 'attendance') {
      throw failure('VALIDATION_ERROR', 'Student attendance rows cannot be deleted through the calendar.', 400);
    }
    if (!validRevision(current)) {
      throw failure('SCHEMA_ERROR', 'The calendar revision formula is unavailable. Check the Grist calendar setup before deleting.', 503);
    }
    const originalFields = lessonFields(current);
    if (originalFields.Calendar_Status === 'deleted') {
      if (originalFields.Calendar_Mutation === mutationId) return { id };
      throw failure('VERSION_CONFLICT', 'This lesson was already deleted. Refresh the calendar.', 409);
    }
    if (originalFields.Calendar_Mutation === mutationId || lessonVersion(current) !== expectedVersion) {
      throw failure('VERSION_CONFLICT', 'This lesson changed after you opened it. Refresh before deleting it.', 409);
    }
    const changes = { Calendar_Status: 'deleted', Calendar_Mutation: mutationId };
    const expected = { ...originalFields, ...changes };
    delete expected.Calendar_Revision;
    let result;
    let writeFailure;
    try {
      result = await client.request('PUT', '/tables/ALL_ATT/records?noadd=true&onmany=none&noparse=true',
        { records: [{ require: { id: current.id, Calendar_Revision: current.fields.Calendar_Revision }, fields: changes }] });
    } catch (error) { writeFailure = error; }
    let verified;
    try { verified = await lessonRows(); } catch { throw uncertain(true); }
    const saved = verified.find(record => record.id === rowId);
    if (saved && matches(lessonFields(saved), expected)) {
      if (!validRevision(saved)) throw uncertain(true);
      return { id };
    }
    const explicitMiss = Array.isArray(result?.recordIds?.[0]) && result.recordIds[0].length === 0;
    if (explicitMiss || (saved && lessonVersion(saved) !== expectedVersion)) {
      throw failure('VERSION_CONFLICT', 'This lesson changed while deleting it. Refresh before trying again.', 409);
    }
    if (writeFailure?.mayHaveMutated === false) {
      throw failure('DELETE_FAILED', 'Grist did not accept the deletion. The lesson has been kept; please try again.', writeFailure.status || 503);
    }
    throw uncertain(true);
  }
  return { getSnapshot, saveLesson, deleteLesson };
}
