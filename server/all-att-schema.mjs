export const ALL_ATT_TABLE = 'ALL_ATT';

// The source references are included so an external edit that changes a row's
// classification invalidates an open calendar editor just like a schedule edit.
export const ALL_ATT_REVISION_FORMULA = 'import hashlib\nreturn hashlib.sha256(repr(($start, $end, $Duration_Minutes, tuple($t.id) if $t else (), tuple($student.id) if $student else (), tuple($group2.id) if $group2 else (), $notes, $Calendar_UID, $Calendar_Title, $Calendar_Group_Label, $Calendar_Room, $Calendar_Participants, $Calendar_Checklist, $Calendar_Status, $Calendar_Notes, $Calendar_Mutation, $Calendar_Parent.id if $Calendar_Parent else 0, $Calendar_Attendance)).encode("utf-8")).hexdigest()';

export const ALL_ATT_COLUMNS = [
  ['Calendar_UID', 'Text'], ['Calendar_Title', 'Text'], ['Calendar_Group_Label', 'Text'],
  ['Calendar_Room', 'Text'], ['Calendar_Participants', 'Text'], ['Calendar_Checklist', 'Text'],
  ['Calendar_Status', 'Text'], ['Calendar_Notes', 'Text'], ['Calendar_Mutation', 'Text'],
  ['Calendar_Parent', 'Ref:ALL_ATT'], ['Calendar_Attendance', 'Text'],
].map(([id, type]) => ({ id, fields: { type, isFormula: false } }));
ALL_ATT_COLUMNS.push({ id: 'Calendar_Revision', fields: {
  type: 'Text', isFormula: true, formula: ALL_ATT_REVISION_FORMULA,
} });

// Duration is stored without a default. New calendar lessons supply it explicitly;
// incomplete Grist rows stay undated until both inputs are valid.
export const DURATION_MINUTES_COLUMN = { id: 'Duration_Minutes', fields: {
  type: 'Numeric', isFormula: false,
} };
export const ALL_ATT_HELPER_COLUMNS = [DURATION_MINUTES_COLUMN];
export const ALL_ATT_HELPER_FIELDS = Object.freeze(ALL_ATT_HELPER_COLUMNS.map(column => column.id));

// Add elapsed time in UTC rather than wall-clock time across historical DST.
// Export the exact definition for the separately authorized schema migration.
export const END_FORMULA = 'import datetime\nimport math\nstart_at = $start\nminutes = $Duration_Minutes\nif not isinstance(start_at, datetime.datetime) or start_at.tzinfo is None:\n  return None\nif isinstance(minutes, bool) or not isinstance(minutes, (int, float)):\n  return None\ntry:\n  if not math.isfinite(minutes) or minutes <= 0:\n    return None\n  return (start_at.astimezone(datetime.timezone.utc) + datetime.timedelta(minutes=minutes)).astimezone(start_at.tzinfo)\nexcept (TypeError, ValueError, OverflowError):\n  return None';
export const END_COLUMN = { id: 'end', fields: {
  type: 'DateTime:Asia/Vladivostok', isFormula: true, formula: END_FORMULA,
} };

const SOURCE_COLUMNS = [
  ['start', 'DateTime:Asia/Vladivostok'], ['end', 'DateTime:Asia/Vladivostok'],
  ['t', 'RefList:PERFORMANCE'], ['student', 'RefList:FOLKS'], ['group2', 'RefList:PERFORMANCE'], ['notes', 'Text'],
];

function isUidDefault(columnId, fields) {
  // Grist schema.py: DEFAULT (0) runs on new records and on recalcDeps changes.
  // With no dependencies, explicitly supplied client/preparation IDs stay intact.
  const emptyDependencies = fields.recalcDeps === null ||
    (Array.isArray(fields.recalcDeps) && fields.recalcDeps.length === 1 && fields.recalcDeps[0] === 'L');
  const formula = typeof fields.formula === 'string' ? fields.formula.trim() : '';
  return columnId === 'Calendar_UID' && fields.type === 'Text' && fields.isFormula === false &&
    fields.recalcWhen === 0 && emptyDependencies && ['UUID()', 'value or UUID()'].includes(formula);
}

/** Explicit setup validates everything first and only adds missing calendar/helper columns. */
export async function ensureAllAttSchema(client) {
  const current = await client.request('GET', `/tables/${ALL_ATT_TABLE}/columns`);
  const byId = new Map(current.columns.map(column => [column.id, column.fields]));
  for (const [id, type] of SOURCE_COLUMNS) {
    const existing = byId.get(id);
    if (!existing || existing.type !== type) {
      throw new Error(`ALL_ATT source schema mismatch: ${id}. Existing columns were not modified.`);
    }
    // Setup validates the authorized duration migration; it never performs it.
    if (id === 'end' && (!existing.isFormula || existing.formula !== END_FORMULA)) {
      throw new Error('ALL_ATT source schema mismatch: end must derive from start and Duration_Minutes. Existing columns were not modified.');
    }
    if (['start', 't', 'student', 'group2'].includes(id) && existing.isFormula) {
      throw new Error(`ALL_ATT source column ${id} must be editable. Existing columns were not modified.`);
    }
  }
  const missing = [];
  for (const column of [...ALL_ATT_COLUMNS, ...ALL_ATT_HELPER_COLUMNS]) {
    const existing = byId.get(column.id);
    if (!existing) missing.push(column);
    else if (existing.type !== column.fields.type || Boolean(existing.isFormula) !== column.fields.isFormula
      || (column.fields.isFormula && existing.formula !== column.fields.formula)
      || (!column.fields.isFormula && Boolean(existing.formula) && !isUidDefault(column.id, existing))) {
      throw new Error(`ALL_ATT calendar schema mismatch: ${column.id}. Existing columns were not modified.`);
    }
  }
  if (missing.length) await client.request('POST', `/tables/${ALL_ATT_TABLE}/columns`, { columns: missing });
  return { lessonTable: ALL_ATT_TABLE, attendanceLink: 'Calendar_Parent', addedColumnCount: missing.length };
}
