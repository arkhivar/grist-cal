export const SCHOOL_TIME_ZONE = 'Asia/Vladivostok';

const schoolFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHOOL_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function invalid(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function dateParts(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) throw invalid('Choose a valid date in YYYY-MM-DD format.');
  const [, year, month, day] = match.map(Number);
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (year < 1 || !Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year ||
      date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw invalid('Choose a valid calendar date.');
  }
  return { year, month, day, date };
}

function instantDate(instant) {
  if (typeof instant === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i.exec(instant);
    if (!match) throw invalid('A time must include its UTC offset.');
    dateParts(match[1]);
    if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) {
      throw invalid('Choose a valid time.');
    }
  } else if (!(instant instanceof Date) && typeof instant !== 'number') {
    throw invalid('Choose a valid date and time.');
  }
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw invalid('Choose a valid date and time.');
  return date;
}

function inSchool(instant) {
  return Object.fromEntries(schoolFormatter.formatToParts(instantDate(instant))
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
}

export function schoolToday(now = new Date()) {
  const { year, month, day } = inSchool(now);
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

export function schoolInput(instant) {
  const { year, month, day, hour, minute } = inSchool(instant);
  return `${year.padStart(4, '0')}-${month}-${day}T${hour}:${minute}`;
}

export function fromSchoolInput(input) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(input);
  if (!match) throw invalid('Choose a valid school date and time.');
  dateParts(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59) throw invalid('Choose a valid school time.');
  const target = Date.parse(`${input}:00.000Z`);
  let candidate = target;
  // Resolve the IANA-zone offset using UTC arithmetic, independent of the device timezone.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = inSchool(candidate);
    const projected = Date.parse(`${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.000Z`);
    const correction = target - projected;
    if (correction === 0) return new Date(candidate).toISOString();
    candidate += correction;
  }
  throw invalid('That local time does not exist in the school timezone.');
}

export function formatSchoolTime(instant) {
  const { hour, minute } = inSchool(instant);
  return `${hour}:${minute}`;
}

export function shiftDate(dateString, days) {
  if (!Number.isInteger(days)) throw invalid('The date shift must be a whole number of days.');
  const { date } = dateParts(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  const result = date.toISOString().slice(0, 10);
  dateParts(result);
  return result;
}

export function startOfWeek(dateString) {
  const { date } = dateParts(dateString);
  return shiftDate(dateString, -((date.getUTCDay() + 6) % 7));
}

export function selectCalendarLessons(snapshot, { teacherIds, search = '' } = {}) {
  const selectedTeachers = teacherIds == null ? null : new Set(teacherIds);
  const query = String(search).trim().toLocaleLowerCase();
  const teacherNames = new Map((snapshot.teachers || []).map((teacher) => [teacher.id, teacher.name]));
  const studentNames = new Map();
  for (const record of snapshot.attendance || []) {
    if (record.type !== 'attendance') continue;
    const names = studentNames.get(record.lessonId) || [];
    names.push(record.studentName || '');
    studentNames.set(record.lessonId, names);
  }
  return (snapshot.lessons || []).filter((lesson) => {
    if (lesson.type !== 'lesson' || lesson.status === 'deleted') return false;
    if (selectedTeachers && !selectedTeachers.has(lesson.teacherId)) return false;
    if (!query) return true;
    const searchable = [lesson.title, lesson.group, lesson.room, lesson.participantText,
      lesson.checklist, lesson.notes, teacherNames.get(lesson.teacherId),
      ...(studentNames.get(lesson.id) || [])];
    return searchable.filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
  });
}
