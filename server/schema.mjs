export const LESSON_TABLE = 'Calendar_Lessons';
export const ATTENDANCE_LINK = 'Calendar_Lesson';
export const LESSON_REVISION_FORMULA = 'import hashlib\nreturn hashlib.sha256(repr(($Calendar_UID, $Title, $Start, $End, tuple($Teacher.id) if $Teacher else (), tuple($Group.id) if $Group else (), $Group_Label, $Room, $Participant_Notes, $Checklist, $Status, $Notes, $Mutation_ID, $Origin, $Import_Key)).encode("utf-8")).hexdigest()';
export const ATTENDANCE_REVISION_FORMULA = 'import hashlib\nreturn hashlib.sha256(repr(($datetime, tuple($per.id) if $per else (), tuple($group2.id) if $group2 else (), tuple($student.id) if $student else (), $Calendar_Lesson.id if $Calendar_Lesson else 0)).encode("utf-8")).hexdigest()';

export const LESSON_COLUMNS = [
  ['Calendar_UID', 'Text'], ['Title', 'Text'],
  ['Start', 'DateTime:Asia/Vladivostok'], ['End', 'DateTime:Asia/Vladivostok'],
  ['Teacher', 'RefList:PERFORMANCE'], ['Group', 'RefList:PERFORMANCE'],
  ['Group_Label', 'Text'], ['Room', 'Text'], ['Participant_Notes', 'Text'],
  ['Checklist', 'Text'], ['Status', 'Text'], ['Notes', 'Text'],
  ['Mutation_ID', 'Text'], ['Origin', 'Text'], ['Import_Key', 'Text'],
].map(([id, type]) => ({ id, fields: { type, isFormula: false } }));
LESSON_COLUMNS.push({ id: 'Calendar_Revision', fields: { type: 'Text', isFormula: true, formula: LESSON_REVISION_FORMULA } });

// Explicit setup only: a normal server start never changes the document schema.
export async function ensureCalendarSchema(client) {
  const tables = await client.request('GET', '/tables');
  if (!tables.tables.some(table => table.id === LESSON_TABLE)) {
    await client.request('POST', '/tables', { tables: [{ id: LESSON_TABLE, columns: LESSON_COLUMNS }] });
  }
  const current = await client.request('GET', `/tables/${LESSON_TABLE}/columns`);
  const byId = new Map(current.columns.map(column => [column.id, column.fields]));
  const missing = [];
  for (const column of LESSON_COLUMNS) {
    const existing = byId.get(column.id);
    if (!existing) missing.push(column);
    else if (existing.type !== column.fields.type || Boolean(existing.isFormula) !== column.fields.isFormula || (column.fields.isFormula && existing.formula !== column.fields.formula)) {
      throw new Error(`Calendar schema mismatch: ${column.id}. Existing columns were not modified.`);
    }
  }
  if (missing.length) await client.request('POST', `/tables/${LESSON_TABLE}/columns`, { columns: missing });
  const attendance = await client.request('GET', '/tables/ALL_ATT/columns');
  const link = attendance.columns.find(column => column.id === ATTENDANCE_LINK);
  if (!link) {
    await client.request('POST', '/tables/ALL_ATT/columns', { columns: [{ id: ATTENDANCE_LINK, fields: { type: `Ref:${LESSON_TABLE}`, isFormula: false } }] });
  } else if (link.fields.type !== `Ref:${LESSON_TABLE}` || link.fields.isFormula) {
    throw new Error('Calendar attendance link has an incompatible existing type. It was not modified.');
  }
  const revision = attendance.columns.find(column => column.id === 'Calendar_Source_Revision');
  if (!revision) {
    await client.request('POST', '/tables/ALL_ATT/columns', { columns: [{ id: 'Calendar_Source_Revision', fields: { type: 'Text', isFormula: true, formula: ATTENDANCE_REVISION_FORMULA } }] });
  } else if (revision.fields.type !== 'Text' || !revision.fields.isFormula || revision.fields.formula !== ATTENDANCE_REVISION_FORMULA) {
    throw new Error('Calendar source revision has an incompatible existing definition. It was not modified.');
  }
  return { lessonTable: LESSON_TABLE, attendanceLink: ATTENDANCE_LINK };
}
