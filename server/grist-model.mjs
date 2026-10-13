import { createHash } from 'node:crypto';
import { schoolToday } from '../src/domain.js';

export const LESSON_FIELD_IDS = Object.freeze([
  'Calendar_UID', 'Title', 'Start', 'End', 'Teacher', 'Group', 'Group_Label',
  'Room', 'Participant_Notes', 'Checklist', 'Status', 'Notes', 'Mutation_ID', 'Origin', 'Import_Key', 'Calendar_Revision',
]);

const palette = ['#4285f4', '#18875b', '#8e63ce', '#d59116', '#c55778', '#268e9b', '#7464b5', '#a5703d'];
const specialGroups = new Set(['indie', 'trial']);
const fieldsOf = (record) => record?.fields && typeof record.fields === 'object' ? record.fields : record || {};
const text = (value) => typeof value === 'string' ? value : '';
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const recordsById = (records) => new Map(records.filter(record => positiveId(record.id)).map(record => [record.id, fieldsOf(record)]));

/** Decode only valid Grist RefList cells. Deduplicate and sort for stable identities. */
export function refs(value) {
  if (!Array.isArray(value) || value[0] !== 'L') return [];
  return [...new Set(value.slice(1).filter(positiveId))].sort((a, b) => a - b);
}

/** Raw wire values are retained here: these fields also form the API's CAS predicate. */
export function lessonFields(recordOrFields) {
  const fields = fieldsOf(recordOrFields);
  return Object.fromEntries(LESSON_FIELD_IDS.map(key => [key,
    Object.hasOwn(fields, key) ? structuredClone(fields[key]) : ['Start', 'End', 'Teacher', 'Group'].includes(key) ? null : '',
  ]));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

/** Hash editable/identity fields and the server revision, excluding unrelated Grist columns. */
export function lessonVersion(recordOrFields) {
  return hash(JSON.stringify(canonical(lessonFields(recordOrFields))));
}

function epochToIso(epoch) {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return null;
  const date = new Date(epoch * 1000);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString();
}

function teacherId(ids) { return ids.length ? `per:${ids.join(',')}` : 'unassigned'; }

function personName(id, folks) { return text(folks.get(id)?.name).trim() || `Student #${id}`; }

function groupNames(ids, performance) {
  return ids.map(id => text(performance.get(id)?.A).trim() || `Group #${id}`);
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join('').toLocaleUpperCase();
}

function makeTeacher(ids, performance) {
  const id = teacherId(ids);
  const names = ids.map(ref => text(performance.get(ref)?.A).trim() || `Teacher #${ref}`);
  const name = names.length ? names.join(' + ') : 'Unassigned';
  return {
    id, name, sourceIds: [...ids],
    color: ids.length ? palette[parseInt(hash(id).slice(0, 8), 16) % palette.length] : '#71717a',
    initials: ids.length > 1 ? names.slice(0, 2).map(part => Array.from(part)[0]).join('').toLocaleUpperCase() : initials(name),
  };
}

/** Plan additive imports only. The caller performs schema and record writes. */
export function buildImportPlan({ attendance = [], performance = [], folks = [], lessons = [] } = {}) {
  const performanceById = recordsById(performance);
  const folksById = recordsById(folks);
  const existingByUid = new Map();
  for (const record of lessons) {
    if (!positiveId(record.id)) continue;
    const uid = text(fieldsOf(record).Calendar_UID);
    if (!uid) continue;
    const matches = existingByUid.get(uid) || [];
    matches.push(record.id);
    existingByUid.set(uid, matches);
  }

  const groups = new Map();
  const skipped = [];
  let isolatedMissingStudentRows = 0;
  for (const record of attendance) {
    const fields = fieldsOf(record);
    if (!positiveId(record.id)) {
      skipped.push({ id: record.id, reason: 'invalid-row-id' });
      continue;
    }
    if (positiveId(fields.Calendar_Lesson)) {
      skipped.push({ id: record.id, reason: 'already-linked' });
      continue;
    }
    if (fields.datetime === null || fields.datetime === undefined || fields.datetime === '') {
      skipped.push({ id: record.id, reason: 'missing-datetime' });
      continue;
    }
    const start = fields.datetime;
    if (!epochToIso(start) || !epochToIso(start + 3600)) {
      skipped.push({ id: record.id, reason: 'invalid-datetime' });
      continue;
    }
    const teachers = refs(fields.per);
    const groupRefs = refs(fields.group2);
    const students = refs(fields.student);
    const knownGroups = groupRefs.length > 0 && groupRefs.every(id =>
      text(performanceById.get(id)?.type).trim().toLocaleLowerCase() === 'group');
    const special = groupRefs.some(id => specialGroups.has(text(performanceById.get(id)?.A).trim().toLocaleLowerCase()));
    const byStudent = !knownGroups || special;
    const isolate = byStudent && students.length === 0;
    if (isolate) isolatedMissingStudentRows += 1;
    const key = JSON.stringify({ schema: 1, start, teachers, groups: groupRefs,
      ...(byStudent ? { students } : {}), ...(isolate ? { attendanceRow: record.id } : {}) });
    if (!groups.has(key)) groups.set(key, { start, teachers, groupRefs, students: new Set(), attendanceIds: new Set(), byStudent });
    const group = groups.get(key);
    group.attendanceIds.add(record.id);
    students.forEach(student => group.students.add(student));
  }

  const candidates = [];
  for (const [key, group] of groups) {
    const importKey = hash(key);
    const uid = `import:${importKey}`;
    const attendanceIds = [...group.attendanceIds].sort((a, b) => a - b);
    const existing = existingByUid.get(uid) || [];
    if (existing.length > 1) {
      skipped.push(...attendanceIds.map(id => ({ id, reason: 'duplicate-import-identity' })));
      continue;
    }
    const names = [...group.students].sort((a, b) => a - b).map(id => personName(id, folksById));
    const groupLabel = groupNames(group.groupRefs, performanceById).join(' · ');
    const title = [groupLabel || 'Individual lesson', ...(group.byStudent && names.length ? [names.join(', ')] : [])].join(' · ');
    candidates.push({
      fields: {
        Calendar_UID: uid, Title: title.slice(0, 160), Start: group.start, End: group.start + 3600,
        Teacher: ['L', ...group.teachers], Group: ['L', ...group.groupRefs], Group_Label: groupLabel.slice(0, 120),
        Room: '', Participant_Notes: '', Checklist: '', Status: 'scheduled', Notes: '',
        Mutation_ID: '', Origin: 'attendance-import', Import_Key: importKey,
      },
      attendanceIds,
      ...(existing.length === 1 ? { existingLessonId: existing[0] } : {}),
    });
  }
  candidates.sort((a, b) => a.fields.Start - b.fields.Start || a.fields.Import_Key.localeCompare(b.fields.Import_Key));
  skipped.sort((a, b) => (a.id || 0) - (b.id || 0));
  return {
    candidates,
    skipped,
    summary: {
      attendanceRowCount: attendance.length,
      candidateLessonCount: candidates.length,
      newLessonCount: candidates.filter(candidate => !candidate.existingLessonId).length,
      reusedLessonCount: candidates.filter(candidate => candidate.existingLessonId).length,
      attendanceToLinkCount: candidates.reduce((count, candidate) => count + candidate.attendanceIds.length, 0),
      skippedRowCount: skipped.length,
      alreadyLinkedRowCount: skipped.filter(row => row.reason === 'already-linked').length,
      undatedRowCount: skipped.filter(row => row.reason === 'missing-datetime').length,
      invalidDateRowCount: skipped.filter(row => row.reason === 'invalid-datetime').length,
      isolatedMissingStudentRowCount: isolatedMissingStudentRows,
    },
  };
}

/** Expose only scheduling and attendance data, never finance or unrelated source columns. */
export function normalizeSnapshot({ attendance = [], performance = [], folks = [], lessons = [] } = {}) {
  const performanceById = recordsById(performance);
  const folksById = recordsById(folks);
  const lessonRowsById = recordsById(lessons);
  const linkedLessonIds = new Set(attendance.filter(record => positiveId(record.id))
    .map(record => fieldsOf(record).Calendar_Lesson).filter(positiveId));
  const teachersById = new Map();
  const addTeacher = (ids) => {
    const id = teacherId(ids);
    if (!teachersById.has(id)) teachersById.set(id, makeTeacher(ids, performanceById));
    return id;
  };
  for (const record of performance) {
    if (positiveId(record.id) && text(fieldsOf(record).type).trim().toLocaleLowerCase() === 'team') addTeacher([record.id]);
  }
  // Keep Unassigned available for new lessons and for incomplete imported records.
  addTeacher([]);
  for (const row of attendance) addTeacher(refs(fieldsOf(row).per));
  const invalidLessons = [];
  let pendingImportLessonCount = 0;
  let deletedLessonCount = 0;
  const normalizedLessons = [];
  for (const record of lessons) {
    const fields = fieldsOf(record);
    // Retain the source row and attendance links; deletion only hides the event.
    // Tombstones are neither invalid schedules nor imports waiting for a link.
    if (fields.Status === 'deleted') {
      if (positiveId(record.id)) deletedLessonCount += 1;
      continue;
    }
    const teacher = addTeacher(refs(fields.Teacher));
    const start = epochToIso(fields.Start);
    const end = epochToIso(fields.End);
    if (!positiveId(record.id) || !start || !end || fields.End <= fields.Start) {
      invalidLessons.push({ id: record.id, reason: 'invalid-lesson-time-or-id' });
      continue;
    }
    // An import creates lessons before conditionally linking attendance. A stopped
    // import or a source edit can leave an orphan; keep it resumable in Grist but
    // do not present it as a scheduled event until a source row actually links it.
    // Calendar-created lessons intentionally have no attendance yet and stay visible.
    if (text(fields.Origin) === 'attendance-import' && !linkedLessonIds.has(record.id)) {
      pendingImportLessonCount += 1;
      continue;
    }
    normalizedLessons.push({
      id: `grist:${record.id}`, sourceRowId: record.id, type: 'lesson',
      title: text(fields.Title).trim() || 'Untitled lesson', teacherId: teacher,
      group: text(fields.Group_Label) || groupNames(refs(fields.Group), performanceById).join(' · '),
      start, end, room: text(fields.Room), participantText: text(fields.Participant_Notes),
      checklist: text(fields.Checklist), status: fields.Status === 'cancelled' ? 'cancelled' : 'scheduled',
      notes: text(fields.Notes), version: lessonVersion(fields), origin: text(fields.Origin),
    });
  }
  normalizedLessons.sort((a, b) => a.start.localeCompare(b.start) || a.sourceRowId - b.sourceRowId);

  let linkedRows = 0;
  let danglingRows = 0;
  const normalizedAttendance = [];
  for (const record of attendance) {
    if (!positiveId(record.id)) continue;
    const fields = fieldsOf(record);
    const lessonId = positiveId(fields.Calendar_Lesson) ? `grist:${fields.Calendar_Lesson}` : '';
    if (lessonId) {
      linkedRows += 1;
      if (!lessonRowsById.has(fields.Calendar_Lesson)) danglingRows += 1;
    }
    const students = refs(fields.student);
    for (const studentId of students.length ? students : [null]) {
      normalizedAttendance.push({
        id: `att:${record.id}:${studentId || 'missing'}`, type: 'attendance', sourceRowId: record.id,
        lessonId, studentId: studentId ? `folks:${studentId}` : '',
        studentName: studentId ? personName(studentId, folksById) : 'Student link pending',
        status: 'recorded', notes: text(fields.notes),
      });
    }
  }
  const validAttendanceRows = attendance.filter(row => positiveId(row.id)).length;
  const teachers = [...teachersById.values()].sort((a, b) =>
    (a.id === 'unassigned') - (b.id === 'unassigned') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    teachers,
    lessons: normalizedLessons,
    attendance: normalizedAttendance,
    meta: {
      source: 'grist', lessonCount: normalizedLessons.length,
      importedLessonCount: normalizedLessons.filter(lesson => lesson.origin === 'attendance-import').length,
      pendingImportLessonCount,
      deletedLessonCount,
      attendanceRowCount: validAttendanceRows,
      linkedAttendanceRowCount: linkedRows,
      unlinkedAttendanceRowCount: validAttendanceRows - linkedRows,
      unlinkedAttendanceCount: validAttendanceRows - linkedRows,
      danglingAttendanceRowCount: danglingRows,
      invalidLessons,
      latestLessonDate: normalizedLessons.length ? schoolToday(normalizedLessons.at(-1).start) : null,
    },
  };
}
