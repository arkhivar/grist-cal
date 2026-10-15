import { createHash } from 'node:crypto';
import { ALL_ATT_FIELDS, classifyRow, refs } from './all-att-model.mjs';
import { LESSON_FIELD_IDS } from './grist-model.mjs';

export const ALL_ATT_SETUP_FIELDS = Object.freeze([...ALL_ATT_FIELDS]);
const REVISION = /^[a-f0-9]{64}$/i;
const createEndpoint = '/tables/ALL_ATT/records?noupdate=true&onmany=none&noparse=true';
const linkEndpoint = '/tables/ALL_ATT/records?noadd=true&onmany=none&noparse=true';
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const fieldsOf = record => record?.fields || {};
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size));

function validEpoch(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
}

function sourceKey(fields) {
  if (!validEpoch(fields.start)) return null;
  return JSON.stringify({ schema: 1, start: fields.start, teachers: refs(fields.t), groups: refs(fields.group2) });
}

function generatedUid(key) {
  return `all-att-group:${createHash('sha256').update(key).digest('hex')}`;
}

function sameCopiedValue(field, actual, expected) {
  if (['t', 'group2', 'student'].includes(field)) {
    // Grist may canonicalize an empty RefList to null. Validate before normalizing:
    // refs() alone would also turn malformed values into an apparently empty list.
    const valid = value => value === null || (Array.isArray(value) && value[0] === 'L' && value.slice(1).every(positiveId));
    return valid(actual) && valid(expected) && JSON.stringify(refs(actual)) === JSON.stringify(refs(expected));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function addToMap(map, key, value) {
  if (key === null || key === undefined || key === '') return;
  const values = map.get(key) || [];
  values.push(value);
  map.set(key, values);
}

/** Additive preparation: source cells and legacy Calendar_Lesson links are never rewritten. */
export function buildAllAttPlan({ attendance = [], legacyLessons = [] } = {}) {
  const byId = new Map();
  const headersByKey = new Map();
  const byUid = new Map();
  const linkedParentsByKey = new Map();
  const groups = new Map();
  const skipped = [];
  const conflicts = [];
  const candidates = [];
  let reusedLegacyLessonCount = 0;
  let ignoredLegacyLessonCount = 0;
  for (const record of attendance) {
    if (!positiveId(record.id)) {
      conflicts.push({ id: record.id, reason: 'invalid-row-id' });
      continue;
    }
    byId.set(record.id, record);
    const fields = fieldsOf(record);
    addToMap(byUid, fields.Calendar_UID, record);
    if (classifyRow(fields) === 'group') addToMap(headersByKey, sourceKey(fields), record);
  }

  for (const record of attendance) {
    if (!positiveId(record.id)) continue;
    const fields = fieldsOf(record);
    const kind = classifyRow(fields);
    if (kind !== 'attendance') {
      skipped.push({ id: record.id, reason: kind === 'individual' ? 'individual-lesson' : 'group-header' });
      continue;
    }
    const key = sourceKey(fields);
    const parent = fields.Calendar_Parent;
    if (parent !== undefined && parent !== null && parent !== '' && parent !== 0) {
      const target = byId.get(parent);
      if (!positiveId(parent) || !target || classifyRow(fieldsOf(target)) !== 'group') {
        conflicts.push({ id: record.id, reason: 'invalid-existing-parent' });
      } else {
        // A linked child's source date may intentionally differ from a moved header.
        skipped.push({ id: record.id, reason: 'already-linked' });
        addToMap(linkedParentsByKey, key, target);
      }
      continue;
    }
    if (!key) {
      skipped.push({ id: record.id, reason: fields.start === null || fields.start === undefined || fields.start === '' ?
        'missing-start' : 'invalid-start' });
      continue;
    }
    addToMap(groups, key, record);
  }

  for (const [key, children] of groups) {
    const uid = generatedUid(key);
    const headers = headersByKey.get(key) || [];
    const identityMatches = byUid.get(uid) || [];
    let reason;
    if (headers.length > 1) reason = 'ambiguous-group-headers';
    else if (identityMatches.length > 1) reason = 'duplicate-generated-identity';
    else if (identityMatches.length && (classifyRow(fieldsOf(identityMatches[0])) !== 'group' ||
      sourceKey(fieldsOf(identityMatches[0])) !== key || (headers.length && headers[0].id !== identityMatches[0].id))) {
      reason = 'generated-header-moved-or-reused';
    } else if ((linkedParentsByKey.get(key) || []).some(parent => !headers.length || parent.id !== headers[0].id)) {
      reason = 'existing-linked-group-mismatch';
    }
    const existing = headers[0];
    const first = fieldsOf(children[0]);
    const end = existing ? fieldsOf(existing).end : first.end;
    if (!reason && (!validEpoch(end) || end <= first.start)) reason = 'missing-or-invalid-end';
    if (!reason && !existing && children.some(child => fieldsOf(child).end !== end)) reason = 'inconsistent-group-end';
    if (!reason && fieldsOf(existing).Calendar_Status === 'deleted') reason = 'deleted-group-header';
    if (reason) {
      conflicts.push(...children.map(record => ({ id: record.id, reason })));
      continue;
    }
    candidates.push({
      key,
      attendanceIds: children.map(record => record.id).sort((a, b) => a - b),
      ...(existing ? { existingHeaderId: existing.id, existingHeaderRevision: fieldsOf(existing).Calendar_Revision } : {}),
      fields: {
        Calendar_UID: existing ? fieldsOf(existing).Calendar_UID || '' : uid,
        start: first.start, end, t: ['L', ...refs(first.t)], group2: ['L', ...refs(first.group2)], student: ['L'],
        Calendar_Status: 'scheduled', Calendar_Origin: 'all-att-group-header', Calendar_Attendance: 'pending',
      },
    });
  }

  // Preserve standalone calendar-created lessons only during an explicitly requested transition.
  // Historical attendance imports remain in their original table; they are never replayed here.
  const legacyById = new Map();
  for (const record of legacyLessons) {
    const fields = fieldsOf(record);
    if (fields.Origin !== 'calendar') { ignoredLegacyLessonCount += 1; continue; }
    if (!positiveId(record.id)) {
      conflicts.push({ id: record.id, source: 'Calendar_Lessons', reason: 'invalid-legacy-row-id' });
      continue;
    }
    addToMap(legacyById, record.id, record);
  }
  for (const [id, records] of legacyById) {
    const fields = fieldsOf(records[0]);
    const uid = `legacy-calendar:${id}`;
    const existing = byUid.get(uid) || [];
    if (records.length !== 1 || existing.length > 1 || (existing.length === 1 && classifyRow(fieldsOf(existing[0])) !== 'group')) {
      conflicts.push({ id, source: 'Calendar_Lessons', reason: 'ambiguous-legacy-identity' });
      continue;
    }
    if (existing.length === 1) { reusedLegacyLessonCount += 1; continue; }
    if (!validEpoch(fields.Start) || !validEpoch(fields.End) || fields.End <= fields.Start) {
      conflicts.push({ id, source: 'Calendar_Lessons', reason: 'invalid-legacy-schedule' });
      continue;
    }
    const copied = {
      Calendar_UID: uid, start: fields.Start, end: fields.End,
      t: ['L', ...refs(fields.Teacher)], group2: ['L', ...refs(fields.Group)], student: ['L'],
      Calendar_Title: fields.Title || '', Calendar_Group_Label: fields.Group_Label || '',
      Calendar_Room: fields.Room || '', Calendar_Participants: fields.Participant_Notes || '',
      Calendar_Checklist: fields.Checklist || '', Calendar_Notes: fields.Notes || '',
      Calendar_Status: ['cancelled', 'deleted'].includes(fields.Status) ? fields.Status : 'scheduled',
      Calendar_Origin: 'calendar-legacy', Calendar_Attendance: 'pending',
    };
    candidates.push({ key: sourceKey(copied), legacyLessonId: id, attendanceIds: [], fields: copied });
  }
  candidates.sort((a, b) => a.fields.start - b.fields.start || a.key.localeCompare(b.key));
  skipped.sort((a, b) => a.id - b.id);
  conflicts.sort((a, b) => (a.id || 0) - (b.id || 0));
  return {
    candidates, skipped, conflicts,
    summary: {
      sourceRowCount: attendance.length,
      candidateHeaderCount: candidates.length,
      newHeaderCount: candidates.filter(candidate => !candidate.existingHeaderId).length,
      reusedHeaderCount: candidates.filter(candidate => candidate.existingHeaderId).length,
      attendanceToLinkCount: candidates.reduce((count, candidate) => count + candidate.attendanceIds.length, 0),
      alreadyLinkedRowCount: skipped.filter(row => row.reason === 'already-linked').length,
      individualLessonCount: skipped.filter(row => row.reason === 'individual-lesson').length,
      existingGroupHeaderCount: skipped.filter(row => row.reason === 'group-header').length,
      undatedRowCount: skipped.filter(row => row.reason === 'missing-start' || row.reason === 'invalid-start').length,
      skippedRowCount: skipped.length,
      planningConflictRowCount: conflicts.length,
      newLegacyLessonCount: candidates.filter(candidate => candidate.legacyLessonId).length,
      reusedLegacyLessonCount, ignoredLegacyLessonCount,
    },
  };
}

export async function loadAllAttSource(client, { includeLegacyCalendar = false } = {}) {
  const [attendance, legacyLessons] = await Promise.all([
    client.records('ALL_ATT', ALL_ATT_SETUP_FIELDS),
    includeLegacyCalendar ? client.records('Calendar_Lessons', LESSON_FIELD_IDS) : Promise.resolve([]),
  ]);
  return { attendance, ...(includeLegacyCalendar ? { legacyLessons } : {}) };
}

function setupError(code, message, summary, mayHaveMutated = false) {
  return Object.assign(new Error(message), {
    code, status: code === 'ALL_ATT_IDENTITY_CONFLICT' ? 409 : 503, mayHaveMutated,
    summary: structuredClone({ ...summary, status: 'stopped' }),
  });
}

/** Prepare only new headers and new self-references; schema setup is a separate explicit action. */
export async function prepareAllAtt({ client, onProgress = () => {}, includeLegacyCalendar = false } = {}) {
  if (!client || typeof client.records !== 'function' || typeof client.request !== 'function') {
    throw new TypeError('A Grist client is required.');
  }
  const summary = {
    createdHeaderCount: 0, resolvedHeaderCount: 0, attemptedLinkRowCount: 0,
    linkedRowCount: 0, conflictedRowCount: 0, missingRowCount: 0, conditionalMissRowCount: 0,
    createBatchesCompleted: 0, linkBatchesCompleted: 0,
    preservedLegacyLessonCount: 0,
  };
  let hasWritten = false;
  const progress = (stage, completed, total) => {
    try { onProgress({ stage, completed, total }); } catch { /* Observers do not control saved writes. */ }
  };
  async function read(includeLegacy = false) {
    try { return await loadAllAttSource(client, { includeLegacyCalendar: includeLegacy }); }
    catch {
      throw setupError(hasWritten ? 'ALL_ATT_SETUP_UNCERTAIN' : 'ALL_ATT_SETUP_FAILED',
        hasWritten ? 'Preparation stopped because saved results could not be verified. Rerun preparation safely to resume.' :
          'Preparation could not read its source. No writes were attempted.', summary, hasWritten);
    }
  }
  async function write(endpoint, records) {
    try {
      const result = await client.request('PUT', endpoint, { records });
      hasWritten = true;
      return result;
    } catch (error) {
      const uncertain = error?.mayHaveMutated !== false;
      throw setupError(uncertain ? 'ALL_ATT_SETUP_UNCERTAIN' : 'ALL_ATT_SETUP_FAILED',
        uncertain ? 'Preparation stopped after a write whose outcome is unknown. Rerun preparation safely to resume with the same group identities.' :
          'Grist rejected a preparation write. Earlier batches may remain saved. Rerun preparation safely to resume.',
        summary, uncertain || hasWritten);
    }
  }

  progress('reading', 0, 1);
  const source = await read(includeLegacyCalendar);
  const plan = buildAllAttPlan(source);
  Object.assign(summary, plan.summary);
  const conflicts = [...plan.conflicts];
  progress('reading', 1, 1);
  if (!plan.candidates.length) {
    const status = conflicts.length ? 'partial' : 'complete';
    progress(status, 0, 0);
    return { ...summary, status, conflicts };
  }
  const originals = new Map(source.attendance.map(record => [record.id, fieldsOf(record)]));
  if (plan.candidates.some(candidate => candidate.attendanceIds.some(id => !REVISION.test(originals.get(id)?.Calendar_Revision || '')) ||
      (candidate.existingHeaderId && !REVISION.test(candidate.existingHeaderRevision || '')))) {
    throw setupError('ALL_ATT_SOURCE_REVISION_INVALID',
      'Source revisions are missing or invalid. Check the ALL_ATT calendar schema before preparing. No writes were attempted.', summary);
  }

  const newCandidates = plan.candidates.filter(candidate => !candidate.existingHeaderId);
  progress('creating-headers', 0, newCandidates.length);
  let processed = 0;
  for (const batch of chunks(newCandidates, 50)) {
    const result = await write(createEndpoint, batch.map(candidate => {
      const { Calendar_UID, ...fields } = candidate.fields;
      return { require: { Calendar_UID }, fields };
    }));
    if (Array.isArray(result?.addRecordIds)) summary.createdHeaderCount += result.addRecordIds.length;
    summary.createBatchesCompleted += 1;
    processed += batch.length;
    progress('creating-headers', processed, newCandidates.length);
  }

  const resolvedSource = await read();
  const resolvedById = new Map(resolvedSource.attendance.map(record => [record.id, record]));
  const expectedLinks = new Map();
  const expectedHeaders = new Map();
  for (const candidate of plan.candidates) {
    if (candidate.legacyLessonId) {
      const matches = resolvedSource.attendance.filter(record => fieldsOf(record).Calendar_UID === candidate.fields.Calendar_UID);
      if (matches.length !== 1 || classifyRow(fieldsOf(matches[0])) !== 'group') {
        throw setupError('ALL_ATT_IDENTITY_CONFLICT',
          'A preserved calendar lesson could not be resolved to exactly one header. No attendance links were attempted. Review its identity before resuming.', summary, hasWritten);
      }
      if (Object.entries(candidate.fields).some(([field, value]) => !sameCopiedValue(field, fieldsOf(matches[0])[field], value))) {
        conflicts.push({ id: candidate.legacyLessonId, source: 'Calendar_Lessons', reason: 'preserved-legacy-lesson-changed' });
        continue;
      }
      summary.preservedLegacyLessonCount += 1;
      continue;
    }
    const matches = resolvedSource.attendance.filter(record => classifyRow(fieldsOf(record)) === 'group' && sourceKey(fieldsOf(record)) === candidate.key);
    const identityMatches = candidate.existingHeaderId ? [resolvedById.get(candidate.existingHeaderId)].filter(Boolean) :
      resolvedSource.attendance.filter(record => fieldsOf(record).Calendar_UID === candidate.fields.Calendar_UID);
    if (matches.length !== 1 || identityMatches.length !== 1 || matches[0].id !== identityMatches[0].id) {
      throw setupError('ALL_ATT_IDENTITY_CONFLICT',
        'A group header changed or became ambiguous during preparation. No attendance links were attempted. Review the group headers before resuming.', summary, hasWritten);
    }
    const header = matches[0];
    const fields = fieldsOf(header);
    if (fields.Calendar_Status === 'deleted' || fields.end !== candidate.fields.end ||
        (candidate.existingHeaderId && fields.Calendar_Revision !== candidate.existingHeaderRevision)) {
      conflicts.push(...candidate.attendanceIds.map(id => ({ id, reason: 'header-changed-during-preparation' })));
      summary.conflictedRowCount += candidate.attendanceIds.length;
      continue;
    }
    expectedHeaders.set(header.id, { key: candidate.key, end: fields.end });
    for (const id of candidate.attendanceIds) expectedLinks.set(id, header.id);
  }
  summary.resolvedHeaderCount = expectedHeaders.size + summary.preservedLegacyLessonCount;

  const links = [...expectedLinks].map(([id, parent]) => ({
    // RefLists are unhashable in Grist lookup predicates. The formula hashes source values and the parent.
    require: { id, Calendar_Parent: 0, Calendar_Revision: originals.get(id).Calendar_Revision },
    fields: { Calendar_Parent: parent },
  }));
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
  const verified = await read();
  const verifiedById = new Map(verified.attendance.map(record => [record.id, fieldsOf(record)]));
  for (const [id, parent] of expectedLinks) {
    const child = verifiedById.get(id);
    const header = verifiedById.get(parent);
    const expected = expectedHeaders.get(parent);
    if (!child) {
      summary.missingRowCount += 1;
      conflicts.push({ id, reason: 'source-row-missing' });
    } else if (child.Calendar_Parent === parent && classifyRow(child) === 'attendance' &&
      sourceKey(child) === sourceKey(originals.get(id)) && child.end === originals.get(id).end &&
      JSON.stringify(refs(child.student)) === JSON.stringify(refs(originals.get(id).student)) && header && classifyRow(header) === 'group' &&
      sourceKey(header) === expected.key && header.end === expected.end && header.Calendar_Status !== 'deleted') {
      summary.linkedRowCount += 1;
    } else {
      summary.conflictedRowCount += 1;
      conflicts.push({ id, reason: child.Calendar_Parent !== parent ? 'source-changed-or-link-rejected' : 'linked-source-or-header-changed' });
    }
  }
  progress('verifying', expectedLinks.size, expectedLinks.size);
  const status = conflicts.length ? 'partial' : 'complete';
  progress(status, summary.linkedRowCount, expectedLinks.size);
  return { ...summary, status, conflicts };
}
