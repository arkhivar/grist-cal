import { LESSON_FIELD_IDS, buildImportPlan } from './grist-model.mjs';

export const IMPORT_ATTENDANCE_FIELDS = Object.freeze(['datetime', 'per', 'group2', 'student', 'Calendar_Lesson', 'Calendar_Source_Revision']);
const REVISION = /^[a-f0-9]{64}$/i;
const createEndpoint = '/tables/Calendar_Lessons/records?noupdate=true&onmany=none&noparse=true';
const linkEndpoint = '/tables/ALL_ATT/records?noadd=true&onmany=none&noparse=true';

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function importError(code, message, summary, mayHaveMutated = false) {
  const error = new Error(message);
  Object.assign(error, { code, status: code === 'IMPORT_IDENTITY_CONFLICT' ? 409 : 503,
    mayHaveMutated, summary: structuredClone({ ...summary, status: 'stopped' }) });
  return error;
}

export async function loadImportSource(client) {
  const [attendance, performance, folks, lessons] = await Promise.all([
    client.records('ALL_ATT', IMPORT_ATTENDANCE_FIELDS),
    client.records('PERFORMANCE', ['A', 'type']),
    client.records('FOLKS', ['name']),
    client.records('Calendar_Lessons', LESSON_FIELD_IDS),
  ]);
  return { attendance, performance, folks, lessons };
}

/** Add lesson records and conditional attendance links. Schema setup is a separate explicit step. */
export async function importAttendance({ client, onProgress = () => {} } = {}) {
  if (!client || typeof client.records !== 'function' || typeof client.request !== 'function') {
    throw new TypeError('A Grist client is required.');
  }
  const summary = {
    createdLessonCount: 0, resolvedLessonCount: 0, attemptedLinkRowCount: 0,
    linkedRowCount: 0, conflictedRowCount: 0, missingRowCount: 0, conditionalMissRowCount: 0,
    createBatchesCompleted: 0, linkBatchesCompleted: 0,
  };
  let hasWritten = false;
  const progress = (stage, completed, total) => {
    // Progress observers must not convert an applied write into an apparent import failure.
    try { onProgress({ stage, completed, total }); } catch { /* The import remains authoritative. */ }
  };
  async function read(operation) {
    try { return await operation(); }
    catch {
      throw importError(hasWritten ? 'IMPORT_UNCERTAIN' : 'IMPORT_FAILED',
        hasWritten ? 'The import stopped because its saved results could not be verified. Rerun the import safely to resume; existing lessons will not be overwritten.' :
          'The import could not read its source data. No import writes were attempted. Please try again.', summary, hasWritten);
    }
  }
  async function write(endpoint, records) {
    try {
      const result = await client.request('PUT', endpoint, { records });
      hasWritten = true;
      return result;
    } catch (error) {
      const uncertain = error?.mayHaveMutated !== false;
      throw importError(uncertain ? 'IMPORT_UNCERTAIN' : 'IMPORT_FAILED',
        uncertain ? 'The import stopped after a write whose outcome is unknown. Do not repeat individual writes; rerun the import safely to resume using the same lesson identities.' :
          'Grist rejected an import write. Earlier completed batches may remain saved. Rerun the import safely to resume without overwriting existing lessons.',
        summary, uncertain || hasWritten);
    }
  }

  progress('reading', 0, 1);
  const source = await read(() => loadImportSource(client));
  progress('reading', 1, 1);
  const plan = buildImportPlan(source);
  Object.assign(summary, plan.summary);
  if (plan.skipped.some(row => row.reason === 'duplicate-import-identity')) {
    throw importError('IMPORT_IDENTITY_CONFLICT',
      'Multiple calendar lessons share an import identity. Resolve the duplicate identities before rerunning the import. No import writes were attempted.', summary);
  }
  if (!plan.candidates.length) {
    progress('complete', 0, 0);
    return { ...summary, status: 'complete' };
  }
  const attendanceById = new Map(source.attendance.map(record => [record.id, record.fields]));
  if (plan.candidates.some(candidate => candidate.attendanceIds.some(id =>
    typeof attendanceById.get(id)?.Calendar_Source_Revision !== 'string' ||
    !REVISION.test(attendanceById.get(id).Calendar_Source_Revision)))) {
    throw importError('IMPORT_SOURCE_REVISION_INVALID',
      'Attendance source revisions are missing or invalid. Check the calendar schema before rerunning. No import writes were attempted.', summary);
  }

  const newCandidates = plan.candidates.filter(candidate => !candidate.existingLessonId);
  progress('creating-lessons', 0, newCandidates.length);
  let processed = 0;
  for (const batch of chunks(newCandidates, 50)) {
    const records = batch.map(candidate => {
      const { Calendar_UID, ...fields } = candidate.fields;
      return { require: { Calendar_UID }, fields };
    });
    const result = await write(createEndpoint, records);
    // This count represents upstream-confirmed creations, not records another importer may have created.
    if (Array.isArray(result?.addRecordIds)) summary.createdLessonCount += result.addRecordIds.length;
    summary.createBatchesCompleted += 1;
    processed += batch.length;
    progress('creating-lessons', processed, newCandidates.length);
  }

  const lessonRows = await read(() => client.records('Calendar_Lessons', LESSON_FIELD_IDS));
  const byUid = new Map();
  for (const record of lessonRows) {
    const uid = record.fields.Calendar_UID;
    const matches = byUid.get(uid) || [];
    matches.push(record.id);
    byUid.set(uid, matches);
  }
  const expectedLinks = new Map();
  for (const candidate of plan.candidates) {
    const matches = byUid.get(candidate.fields.Calendar_UID) || [];
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0]) || matches[0] <= 0) {
      throw importError('IMPORT_IDENTITY_CONFLICT',
        'An import identity could not be resolved to exactly one calendar lesson. No attendance links were attempted. Check the calendar lesson identities before rerunning.',
        summary, hasWritten);
    }
    if (candidate.existingLessonId && matches[0] !== candidate.existingLessonId) {
      throw importError('IMPORT_IDENTITY_CONFLICT',
        'An existing imported lesson changed identity during the import. No attendance links were attempted. Check the calendar lesson identities before rerunning.',
        summary, hasWritten);
    }
    for (const attendanceId of candidate.attendanceIds) expectedLinks.set(attendanceId, matches[0]);
  }
  summary.resolvedLessonCount = plan.candidates.length;

  const links = [...expectedLinks].map(([id, lessonId]) => {
    const original = attendanceById.get(id);
    return {
      // Grist lookup predicates require hashable values; RefLists cannot be matched directly.
      require: { id, Calendar_Lesson: original.Calendar_Lesson || 0,
        Calendar_Source_Revision: original.Calendar_Source_Revision, datetime: original.datetime },
      fields: { Calendar_Lesson: lessonId },
    };
  });
  progress('linking-attendance', 0, links.length);
  for (const batch of chunks(links, 100)) {
    summary.attemptedLinkRowCount += batch.length;
    const result = await write(linkEndpoint, batch);
    if (Array.isArray(result?.recordIds)) {
      summary.conditionalMissRowCount += result.recordIds.filter(ids => Array.isArray(ids) && ids.length === 0).length;
    }
    summary.linkBatchesCompleted += 1;
    progress('linking-attendance', summary.attemptedLinkRowCount, links.length);
  }

  progress('verifying', 0, expectedLinks.size);
  const verified = await read(() => client.records('ALL_ATT', ['Calendar_Lesson']));
  const verifiedById = new Map(verified.map(record => [record.id, record.fields.Calendar_Lesson]));
  for (const [id, lessonId] of expectedLinks) {
    if (!verifiedById.has(id)) summary.missingRowCount += 1;
    else if (verifiedById.get(id) === lessonId) summary.linkedRowCount += 1;
    else summary.conflictedRowCount += 1;
  }
  progress('verifying', expectedLinks.size, expectedLinks.size);
  const status = summary.conflictedRowCount || summary.missingRowCount ? 'partial' : 'complete';
  progress(status, summary.linkedRowCount, expectedLinks.size);
  return { ...summary, status };
}
