import { createHash } from 'node:crypto';
import { schoolToday } from '../src/domain.js';
import { renderLessonTitle } from '../src/lesson-title.js';
export { refs } from './grist-model.mjs';
import { refs } from './grist-model.mjs';

export const ALL_ATT_FIELDS = Object.freeze([
  'start', 'end', 'Duration_Minutes', 't', 'student', 'group2', 'notes',
  'Calendar_UID', 'Calendar_Title', 'Calendar_Group_Label', 'Calendar_Room',
  'Calendar_Participants', 'Calendar_Checklist', 'Calendar_Status', 'Calendar_Notes',
  'Calendar_Mutation', 'Calendar_Parent', 'Calendar_Attendance', 'Calendar_Revision',
]);
export const PERFORMANCE_FIELDS = Object.freeze(['name', 'label']);

const palette = ['#4285f4', '#18875b', '#8e63ce', '#d59116', '#c55778', '#268e9b', '#7464b5', '#a5703d'];
const fieldsOf = record => record?.fields && typeof record.fields === 'object' ? record.fields : record || {};
const text = value => typeof value === 'string' ? value : '';
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const recordsById = records => new Map(records.filter(row => positiveId(row.id)).map(row => [row.id, fieldsOf(row)]));
const lessonId = id => `all-att:${id}`;
const teacherId = ids => ids.length ? `per:${ids.join(',')}` : 'unassigned';
const studentName = (id, folks) => text(folks.get(id)?.name).trim() || `Student #${id}`;
const performanceName = (id, performance, fallback) => {
  const value = text(performance.get(id)?.name);
  return value.trim() ? value : fallback;
};
const performanceLabel = fields => text(fields?.label).trim().toLocaleLowerCase();
const groupName = (id, performance) => performanceName(id, performance, `Group #${id}`);
// The length check also excludes the trailing newline accepted by RegExp's $.
const isPreparedGroupUid = value => typeof value === 'string' && value.length === 'all-att-group:'.length + 64 &&
  /^all-att-group:[a-f0-9]{64}$/.test(value);
const isLegacyCalendarUid = value => typeof value === 'string' && value === value.trim() && /^legacy-calendar:[1-9]\d*$/.test(value);

/** These are the user's row rules; blank student references identify a group header. */
export function classifyRow(record) {
  const fields = fieldsOf(record);
  if (!refs(fields.student).length) return 'group';
  return refs(fields.group2).length ? 'attendance' : 'individual';
}

/** Keep wire values intact for concurrency checks, including source classification fields. */
export function lessonFields(record) {
  const fields = fieldsOf(record);
  return Object.fromEntries(ALL_ATT_FIELDS.map(key => [key, Object.hasOwn(fields, key)
    ? structuredClone(fields[key])
    : ['start', 'end', 'Duration_Minutes', 't', 'student', 'group2'].includes(key) ? null : key === 'Calendar_Parent' ? 0 : '',
  ]));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}

export function lessonVersion(record) {
  return hash(JSON.stringify(canonical(lessonFields(record))));
}

function epochToIso(epoch) {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return null;
  // UI timestamps have millisecond precision; round floating epoch arithmetic
  // instead of truncating an intended millisecond just below its boundary.
  const date = new Date(Math.round(epoch * 1000));
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    ? date.toISOString() : null;
}

function makeTeacher(ids, performance) {
  const id = teacherId(ids);
  const names = ids.map(ref => performanceName(ref, performance, `Teacher #${ref}`));
  const name = names.length ? names.join(' + ') : 'Unassigned';
  return { id, name, sourceIds: [...ids],
    selectable: ids.length === 1 && performanceLabel(performance.get(ids[0])) === 'team',
    color: ids.length ? palette[parseInt(hash(id).slice(0, 8), 16) % palette.length] : '#71717a',
    // Team names already contain the school's chosen initials. Keep their case
    // and text instead of deriving a different abbreviation from them.
    initials: ids.length ? ids.map(ref => performanceName(ref, performance, '?')).join(' + ') : '—',
  };
}

/** Read scheduling and attendance from one table without inventing attendance for a booking. */
export function normalizeAllAttSnapshot({ attendance = [], performance = [], folks = [] } = {}) {
  const performanceById = recordsById(performance);
  const folksById = recordsById(folks);
  const rowsById = recordsById(attendance);
  const linkedHeaderIds = new Set(attendance.filter(row => positiveId(row.id) && classifyRow(row) === 'attendance')
    .map(row => fieldsOf(row).Calendar_Parent).filter(positiveId));
  const teachersById = new Map();
  const addTeacher = ids => {
    const id = teacherId(ids);
    if (!teachersById.has(id)) teachersById.set(id, makeTeacher(ids, performanceById));
    return id;
  };
  for (const [id, fields] of performanceById) {
    if (performanceLabel(fields) === 'team') addTeacher([id]);
  }
  addTeacher([]);
  const normalizedLessons = [];
  const groupHeaders = [];
  const invalidLessons = [];
  let deletedLessonCount = 0;
  let pendingImportLessonCount = 0;
  for (const record of attendance) {
    const fields = fieldsOf(record);
    const teacher = addTeacher(refs(fields.t));
    const lessonKind = classifyRow(fields);
    if (lessonKind === 'attendance') continue;
    const start = epochToIso(fields.start);
    const end = epochToIso(fields.end);
    const durationMinutes = fields.Duration_Minutes;
    const valid = positiveId(record.id) && start && end && fields.end > fields.start &&
      typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) && durationMinutes > 0;
    if (lessonKind === 'group' && valid) {
      groupHeaders.push({ id: lessonId(record.id), sourceRowId: record.id,
        start: fields.start, end: fields.end, durationMinutes, teacherRefs: refs(fields.t), groupRefs: refs(fields.group2),
        status: text(fields.Calendar_Status) || 'scheduled',
      });
    }
    if (fields.Calendar_Status === 'deleted') {
      if (positiveId(record.id)) deletedLessonCount += 1;
      continue;
    }
    if (!valid) {
      invalidLessons.push({ id: record.id, reason: 'invalid-lesson-time-or-id' });
      continue;
    }
    // Preparation creates headers before it conditionally links their source
    // rows. A partial preparation must not display an unrelated empty event.
    const preparedGroup = lessonKind === 'group' && isPreparedGroupUid(fields.Calendar_UID);
    if (preparedGroup && !linkedHeaderIds.has(record.id)) {
      pendingImportLessonCount += 1;
      continue;
    }
    const students = refs(fields.student);
    const groups = refs(fields.group2);
    const referencedGroupNames = groups.map(id => groupName(id, performanceById)).join(' · ');
    // The removed freeform label remains stored metadata, never a second,
    // potentially stale subject name after a group reference is changed.
    const group = referencedGroupNames;
    const referenceTitle = lessonKind === 'individual'
      ? students.map(id => studentName(id, folksById)).join(', ')
      : referencedGroupNames || 'Group not assigned';
    const autoTitle = `${teachersById.get(teacher).name} · ${referenceTitle}`;
    const titleOverride = text(fields.Calendar_Title);
    normalizedLessons.push({
      id: lessonId(record.id), sourceRowId: record.id, type: 'lesson', lessonKind,
      title: renderLessonTitle(titleOverride, autoTitle, referenceTitle), autoTitle, referenceTitle, titleOverride,
      teacherId: teacher, studentIds: students.map(id => `folks:${id}`),
      studentNames: students.map(id => studentName(id, folksById)), groupIds: groups.map(id => `per:${id}`),
      group, start, end, durationMinutes, room: text(fields.Calendar_Room), participantText: text(fields.Calendar_Participants),
      checklist: text(fields.Calendar_Checklist), status: fields.Calendar_Status === 'cancelled' ? 'cancelled' : 'scheduled',
      notes: text(fields.Calendar_Notes), version: lessonVersion(fields),
      origin: preparedGroup ? 'all-att-group-header' : lessonKind === 'group' && isLegacyCalendarUid(fields.Calendar_UID) ? 'calendar-legacy' : '',
    });
  }
  normalizedLessons.sort((a, b) => a.start.localeCompare(b.start) || a.sourceRowId - b.sourceRowId);
  groupHeaders.sort((a, b) => a.start - b.start || a.sourceRowId - b.sourceRowId);

  let attendanceRowCount = 0;
  let linkedRows = 0;
  let danglingRows = 0;
  let pendingAttendanceRowCount = 0;
  const normalizedAttendance = [];
  for (const record of attendance) {
    if (!positiveId(record.id)) continue;
    const fields = fieldsOf(record);
    const students = refs(fields.student);
    if (!students.length) continue;
    if (fields.Calendar_Attendance === 'pending') { pendingAttendanceRowCount += 1; continue; }
    attendanceRowCount += 1;
    const kind = classifyRow(fields);
    let linkedId = '';
    if (kind === 'individual') linkedId = lessonId(record.id);
    else if (positiveId(fields.Calendar_Parent)) {
      const parent = rowsById.get(fields.Calendar_Parent);
      if (parent && classifyRow(parent) === 'group') linkedId = lessonId(fields.Calendar_Parent);
      else danglingRows += 1;
    }
    if (linkedId) linkedRows += 1;
    for (const student of students) {
      normalizedAttendance.push({
        id: `att:${record.id}:${student}`, type: 'attendance', sourceRowId: record.id,
        lessonId: linkedId, studentId: `folks:${student}`, studentName: studentName(student, folksById),
        status: text(fields.Calendar_Attendance).trim() || 'recorded', notes: text(fields.notes),
      });
    }
  }
  const teachers = [...teachersById.values()].sort((a, b) =>
    (a.id === 'unassigned') - (b.id === 'unassigned') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const students = [...folksById].map(([id]) => ({ id: `folks:${id}`, name: studentName(id, folksById) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const referencedGroups = new Set(attendance.flatMap(row => refs(fieldsOf(row).group2)));
  const groupIds = new Set([...performanceById].filter(([, fields]) =>
    performanceLabel(fields) === 'group').map(([id]) => id));
  // Existing lessons retain missing group IDs and fallback labels, but new
  // bookings must not offer a deleted reference as an available group.
  referencedGroups.forEach(id => { if (performanceById.has(id)) groupIds.add(id); });
  const groups = [...groupIds].map(id => ({ id: `per:${id}`, name: groupName(id, performanceById) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    teachers, students, groups, lessons: normalizedLessons, attendance: normalizedAttendance, groupHeaders,
    meta: {
      source: 'grist', model: 'all-att', lessonCount: normalizedLessons.length,
      importedLessonCount: normalizedLessons.filter(lesson => lesson.origin === 'all-att-group-header').length,
      pendingImportLessonCount, deletedLessonCount, attendanceRowCount,
      linkedAttendanceRowCount: linkedRows, unlinkedAttendanceRowCount: attendanceRowCount - linkedRows,
      unlinkedAttendanceCount: attendanceRowCount - linkedRows, danglingAttendanceRowCount: danglingRows,
      pendingAttendanceRowCount, invalidLessons,
      latestLessonDate: normalizedLessons.length ? schoolToday(normalizedLessons.at(-1).start) : null,
    },
  };
}
