export const DATE_REGISTRY_TABLE = 'DateRegistry';
export const DATE_REGISTRY_FIELDS = Object.freeze([
  'Date', 'Day', 'Day_Parity', 'Month_Parity', 'Is_Weekend', 'School_Day', 'Holiday_Name', 'Academic_Term',
]);
export const DATE_REGISTRY_ANCHOR = '2026-01-01';
const DAY_SECONDS = 86400;
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const schoolChoices = ['Unspecified', 'Teaching day', 'Closed'];
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fieldsOf = record => record?.fields || {};
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string' ? value : '';
const parity = value => ((value % 2) + 2) % 2;

function failure(code, message, summary) {
  return Object.assign(new Error(message), { code, ...(summary ? { summary } : {}) });
}

function dateEpoch(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw failure('DATE_REGISTRY_RANGE', 'Choose registry dates in YYYY-MM-DD format.');
  }
  const epoch = Date.parse(`${value}T00:00:00.000Z`) / 1000;
  if (!Number.isFinite(epoch) || Number(value.slice(0, 4)) < 1 || new Date(epoch * 1000).toISOString().slice(0, 10) !== value) {
    throw failure('DATE_REGISTRY_RANGE', 'Choose valid calendar dates for the registry range.');
  }
  return epoch;
}

function dateKey(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value % DAY_SECONDS !== 0) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    ? date.toISOString().slice(0, 10) : null;
}

export const DATE_REGISTRY_COLUMNS = [
  { id: 'Date', fields: { type: 'Date', isFormula: false } },
  { id: 'Day', fields: { type: 'Text', isFormula: true,
    formula: 'return ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[$Date.weekday()] if $Date else ""' } },
  { id: 'Day_Parity', fields: { type: 'Int', isFormula: true,
    formula: 'import datetime\nreturn ($Date - datetime.date(2026, 1, 1)).days % 2 if $Date else 0' } },
  { id: 'Month_Parity', fields: { type: 'Int', isFormula: true,
    formula: 'return (($Date.year - 2026) * 12 + $Date.month - 1) % 2 if $Date else 0' } },
  { id: 'Is_Weekend', fields: { type: 'Bool', isFormula: true,
    formula: 'return $Date.weekday() >= 5 if $Date else False' } },
  { id: 'School_Day', fields: { type: 'Choice', isFormula: false,
    widgetOptions: JSON.stringify({ choices: schoolChoices }) } },
  { id: 'Holiday_Name', fields: { type: 'Text', isFormula: false } },
  { id: 'Academic_Term', fields: { type: 'Text', isFormula: false } },
];

/** Grist's bundled moment.tzinfo implements Python tzinfo, including historical offsets. */
export function calendarDateFormula(sourceField = 'start', { sourceKind = 'datetime' } = {}) {
  if (!identifier.test(sourceField) || !['date', 'datetime'].includes(sourceKind)) {
    throw failure('DATE_REGISTRY_SCHEMA', 'Choose a valid date source column.');
  }
  const conversion = sourceKind === 'date'
    ? `value = $${sourceField}\nif not isinstance(value, datetime.date) or isinstance(value, datetime.datetime):\n  return 0\nday = value`
    : `value = $${sourceField}\nif not isinstance(value, datetime.datetime) or value.tzinfo is None:\n  return 0\nday = value.astimezone(moment.tzinfo("Asia/Vladivostok")).date()`;
  return `import datetime\n${sourceKind === 'datetime' ? 'import moment\n' : ''}${conversion}\n` +
    'matches = DateRegistry.lookupRecords(Date=day)\nreturn matches[0] if len(matches) == 1 else 0';
}

export const CALENDAR_DATE_COLUMN = { id: 'Calendar_Date', fields: {
  type: `Ref:${DATE_REGISTRY_TABLE}`, isFormula: true, formula: calendarDateFormula(),
} };

function assertColumns(existingColumns, expectedColumns, table) {
  const byId = new Map(existingColumns.map(column => [column.id, column.fields]));
  const missing = [];
  for (const column of expectedColumns) {
    const existing = byId.get(column.id);
    if (!existing) { missing.push(column); continue; }
    let choicesMatch = true;
    if (column.id === 'School_Day') {
      let choices;
      try { choices = JSON.parse(existing.widgetOptions || '{}').choices; } catch { /* Rejected below. */ }
      choicesMatch = Array.isArray(choices) && JSON.stringify(choices) === JSON.stringify(schoolChoices);
    }
    if (existing.type !== column.fields.type || Boolean(existing.isFormula) !== column.fields.isFormula ||
      (column.fields.isFormula ? existing.formula !== column.fields.formula : Boolean(existing.formula)) || !choicesMatch) {
      throw failure('DATE_REGISTRY_SCHEMA', `Date registry schema mismatch: ${table}.${column.id}. Existing columns were not modified.`);
    }
  }
  return missing;
}

/** Explicit additive setup. Validate all existing definitions before the first schema write. */
export async function ensureDateRegistrySchema(client, {
  sourceTable = 'ALL_ATT', sourceField = 'start', referenceColumn = 'Calendar_Date',
} = {}) {
  if (![sourceTable, sourceField, referenceColumn].every(value => typeof value === 'string' && identifier.test(value)) ||
    sourceTable === DATE_REGISTRY_TABLE || sourceField === referenceColumn) {
    throw failure('DATE_REGISTRY_SCHEMA', 'Choose valid source and reference columns for the date registry.');
  }
  const tables = await client.request('GET', '/tables');
  const registryExists = tables.tables.some(table => table.id === DATE_REGISTRY_TABLE);
  if (!tables.tables.some(table => table.id === sourceTable)) {
    throw failure('DATE_REGISTRY_SCHEMA', 'The selected date source table does not exist.');
  }
  const [source, registry] = await Promise.all([
    client.request('GET', `/tables/${sourceTable}/columns`),
    registryExists ? client.request('GET', `/tables/${DATE_REGISTRY_TABLE}/columns`) : { columns: [] },
  ]);
  const sourceType = source.columns.find(column => column.id === sourceField)?.fields?.type;
  const sourceKind = sourceType === 'Date' ? 'date' : /^DateTime:[^\s]+$/.test(sourceType || '') ? 'datetime' : null;
  if (!sourceKind) throw failure('DATE_REGISTRY_SCHEMA', 'The selected source must be a Date or a DateTime column with an explicit timezone.');
  const reference = { id: referenceColumn, fields: { type: `Ref:${DATE_REGISTRY_TABLE}`, isFormula: true,
    formula: calendarDateFormula(sourceField, { sourceKind }) } };
  const missingRegistry = assertColumns(registry.columns, DATE_REGISTRY_COLUMNS, DATE_REGISTRY_TABLE);
  const missingSource = assertColumns(source.columns, [reference], sourceTable);
  if (!registryExists) {
    await client.request('POST', '/tables', { tables: [{ id: DATE_REGISTRY_TABLE, columns: missingRegistry }] });
  } else if (missingRegistry.length) {
    await client.request('POST', `/tables/${DATE_REGISTRY_TABLE}/columns`, { columns: missingRegistry });
  }
  if (missingSource.length) await client.request('POST', `/tables/${sourceTable}/columns`, { columns: missingSource });
  return { registryTable: DATE_REGISTRY_TABLE, sourceTable, sourceField, referenceColumn,
    addedRegistryColumnCount: missingRegistry.length, addedSourceColumnCount: missingSource.length };
}

/** Ambiguous dates are excluded, never resolved by arbitrary row order. */
export function inspectDateRegistry(records = []) {
  const byDate = new Map();
  const summary = { rowCount: records.length, validDateCount: 0, duplicateDateCount: 0, duplicateRowCount: 0,
    missingDateRowCount: 0, invalidDateRowCount: 0, invalidRowIdCount: 0 };
  for (const record of records) {
    if (!positiveId(record.id)) { summary.invalidRowIdCount += 1; continue; }
    const value = fieldsOf(record).Date;
    if (value === null || value === undefined || value === '') { summary.missingDateRowCount += 1; continue; }
    const key = dateKey(value);
    if (!key) { summary.invalidDateRowCount += 1; continue; }
    const rows = byDate.get(key) || [];
    rows.push(record);
    byDate.set(key, rows);
  }
  const rows = [];
  for (const [date, matches] of byDate) {
    if (matches.length !== 1) {
      summary.duplicateDateCount += 1;
      summary.duplicateRowCount += matches.length;
      continue;
    }
    const record = matches[0];
    const fields = fieldsOf(record);
    const instant = new Date(fields.Date * 1000);
    const weekday = instant.getUTCDay();
    const dayParity = parity((fields.Date - dateEpoch(DATE_REGISTRY_ANCHOR)) / DAY_SECONDS);
    const monthParity = parity((instant.getUTCFullYear() - 2026) * 12 + instant.getUTCMonth());
    rows.push({ id: `date:${record.id}`, date,
      day: text(fields.Day) || days[weekday],
      dayParity: [0, 1].includes(fields.Day_Parity) ? fields.Day_Parity : dayParity,
      monthParity: [0, 1].includes(fields.Month_Parity) ? fields.Month_Parity : monthParity,
      isWeekend: typeof fields.Is_Weekend === 'boolean' ? fields.Is_Weekend : weekday === 0 || weekday === 6,
      schoolDay: fields.School_Day === 'Teaching day' ? 'teaching' : fields.School_Day === 'Closed' ? 'closed' : 'unspecified',
      holidayName: text(fields.Holiday_Name), academicTerm: text(fields.Academic_Term),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  summary.validDateCount = rows.length;
  return { rows, summary };
}

export function normalizeDateRegistry(records = []) { return inspectDateRegistry(records).rows; }

function assertValidRegistry(records) {
  const inspected = inspectDateRegistry(records);
  const summary = inspected.summary;
  if (summary.duplicateDateCount || summary.missingDateRowCount || summary.invalidDateRowCount || summary.invalidRowIdCount) {
    throw failure('DATE_REGISTRY_INVALID', 'DateRegistry contains duplicate, missing or invalid dates. Resolve those rows before preparation; existing records were not overwritten.', summary);
  }
  return inspected;
}

/** Inclusive bounded range. Planning is read-only; it does not repair existing registry rows. */
export function buildDateRegistryPlan(records = [], {
  startDate, endDate, minDate = '0001-01-01', maxDate = '9999-12-31', maxDays = 36600,
} = {}) {
  const start = dateEpoch(startDate);
  const end = dateEpoch(endDate);
  const minimum = dateEpoch(minDate);
  const maximum = dateEpoch(maxDate);
  if (!Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > 3660000 || minimum > maximum ||
    start < minimum || end > maximum || start > end || (end - start) / DAY_SECONDS + 1 > maxDays) {
    throw failure('DATE_REGISTRY_RANGE', 'The requested registry range exceeds its configured bounds.');
  }
  const { rows, summary: existingSummary } = assertValidRegistry(records);
  const existing = new Set(rows.map(row => row.date));
  const dates = [];
  const missingDates = [];
  for (let epoch = start; epoch <= end; epoch += DAY_SECONDS) {
    dates.push(epoch);
    if (!existing.has(dateKey(epoch))) missingDates.push(epoch);
  }
  return { dates, missingDates, summary: { startDate, endDate, requestedDateCount: dates.length,
    existingDateCount: dates.length - missingDates.length, newDateCount: missingDates.length,
    registryRowCount: existingSummary.rowCount } };
}

/** Idempotent inserts keyed by Date. Never update an existing date or its manually maintained policy. */
export async function prepareDateRegistry(client, { batchSize = 100, ...range } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw failure('DATE_REGISTRY_RANGE', 'Choose a date preparation batch size from 1 to 500.');
  }
  const read = () => client.records(DATE_REGISTRY_TABLE, ['Date']);
  const plan = buildDateRegistryPlan(await read(), range);
  let writeBatchCount = 0;
  let recoveredWriteBatchCount = 0;
  let latest;
  for (let offset = 0; offset < plan.missingDates.length; offset += batchSize) {
    const batch = plan.missingDates.slice(offset, offset + batchSize);
    writeBatchCount += 1;
    try {
      await client.request('PUT', `/tables/${DATE_REGISTRY_TABLE}/records?noupdate=true&onmany=none&noparse=true`, {
        records: batch.map(Date => ({ require: { Date }, fields: {} })),
      });
    } catch {
      // A timeout may follow a committed insert. Read back before deciding;
      // never replay a write blindly or overwrite a manual record.
      try { latest = assertValidRegistry(await read()); }
      catch (error) {
        if (error.code === 'DATE_REGISTRY_INVALID') throw error;
        throw failure('DATE_REGISTRY_UNCERTAIN', 'Date preparation could not be confirmed. Rerun preparation to resume safely.');
      }
      const confirmed = new Set(latest.rows.map(row => row.date));
      if (!batch.every(epoch => confirmed.has(dateKey(epoch)))) {
        throw failure('DATE_REGISTRY_UNCERTAIN', 'Date preparation was incomplete or could not be confirmed. Rerun preparation to resume safely.');
      }
      recoveredWriteBatchCount += 1;
    }
  }
  try { latest = assertValidRegistry(await read()); }
  catch (error) {
    if (error.code === 'DATE_REGISTRY_INVALID') throw error;
    throw failure('DATE_REGISTRY_UNCERTAIN', 'The final date registry could not be read. Rerun preparation to verify safely.');
  }
  const confirmed = new Set(latest.rows.map(row => row.date));
  const confirmedDateCount = plan.dates.filter(epoch => confirmed.has(dateKey(epoch))).length;
  if (confirmedDateCount !== plan.dates.length) {
    throw failure('DATE_REGISTRY_UNCERTAIN', 'Date preparation did not confirm every requested day. Rerun preparation to resume safely.');
  }
  return { ...plan.summary, confirmedDateCount, writeBatchCount, recoveredWriteBatchCount, complete: true };
}
