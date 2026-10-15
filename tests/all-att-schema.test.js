import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ATT_COLUMNS, ALL_ATT_REVISION_FORMULA, ALL_ATT_HELPER_COLUMNS, ALL_ATT_HELPER_FIELDS,
  DURATION_MINUTES_COLUMN, END_COLUMN, END_FORMULA, ensureAllAttSchema } from '../server/all-att-schema.mjs';
import { ALL_ATT_FIELDS, lessonVersion } from '../server/all-att-model.mjs';

const sourceColumns = () => [
  ['start', 'DateTime:Asia/Vladivostok'], ['end', 'DateTime:Asia/Vladivostok'], ['t', 'RefList:PERFORMANCE'],
  ['student', 'RefList:FOLKS'], ['group2', 'RefList:PERFORMANCE'], ['notes', 'Text'],
].map(([id, type]) => id === 'end' ? structuredClone(END_COLUMN) : { id, fields: { type, isFormula: false, formula: '' } });

function clientFor(columns) {
  const calls = [];
  const storedColumns = structuredClone(columns);
  return { calls, async request(method, endpoint, body) {
    calls.push({ method, endpoint, body });
    if (method === 'GET') return { columns: storedColumns };
    assert.equal(method, 'POST');
    assert.equal(endpoint, '/tables/ALL_ATT/columns');
    assert.ok(body.columns.every(column => column.id.startsWith('Calendar_') || ALL_ATT_HELPER_FIELDS.includes(column.id)));
    storedColumns.push(...structuredClone(body.columns));
    return {};
  } };
}

test('ALL_ATT setup adds only missing columns after validating the derived end definition', async () => {
  const existing = sourceColumns();
  const before = structuredClone(existing);
  const client = clientFor(existing);
  const result = await ensureAllAttSchema(client);
  assert.equal(result.lessonTable, 'ALL_ATT');
  assert.equal(result.attendanceLink, 'Calendar_Parent');
  assert.equal(result.addedColumnCount, ALL_ATT_COLUMNS.length + ALL_ATT_HELPER_COLUMNS.length);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[1].body.columns, [...ALL_ATT_COLUMNS, ...ALL_ATT_HELPER_COLUMNS]);
  assert.deepEqual(existing, before);
  assert.equal(ALL_ATT_COLUMNS.find(column => column.id === 'Calendar_Parent').fields.type, 'Ref:ALL_ATT');
});

test('ALL_ATT schema setup is idempotent and does not alter unrelated legacy columns', async () => {
  const client = clientFor([...sourceColumns(), ...structuredClone(ALL_ATT_COLUMNS), ...structuredClone(ALL_ATT_HELPER_COLUMNS),
    { id: 'Calendar_Lesson', fields: { type: 'Ref:Calendar_Lessons', isFormula: false } },
    { id: 'Calendar_Source_Revision', fields: { type: 'Text', isFormula: true, formula: 'legacy formula' } }]);
  const result = await ensureAllAttSchema(client);
  assert.equal(result.addedColumnCount, 0);
  assert.equal(client.calls.length, 1);
});

test('Calendar_UID accepts only a preserved data-column UUID default for new records', async () => {
  for (const formula of ['UUID()', 'value or UUID()', '  UUID()\n']) {
    for (const recalcDeps of [null, ['L']]) {
      const columns = [...sourceColumns(), ...structuredClone(ALL_ATT_COLUMNS), ...structuredClone(ALL_ATT_HELPER_COLUMNS)];
      Object.assign(columns.find(column => column.id === 'Calendar_UID').fields,
        { formula, recalcWhen: 0, recalcDeps });
      const before = structuredClone(columns);
      const client = clientFor(columns);
      assert.equal((await ensureAllAttSchema(client)).addedColumnCount, 0);
      assert.equal(client.calls.length, 1, 'Accepted definitions must not be rewritten');
      assert.deepEqual(columns, before);
    }
  }
});

test('an accepted Calendar_UID default is preserved when other calendar columns are added', async () => {
  const columns = [...sourceColumns(), { id: 'Calendar_UID', fields: {
    type: 'Text', isFormula: false, formula: 'UUID()', recalcWhen: 0, recalcDeps: null,
  } }];
  const before = structuredClone(columns);
  const client = clientFor(columns);
  assert.equal((await ensureAllAttSchema(client)).addedColumnCount, ALL_ATT_COLUMNS.length + ALL_ATT_HELPER_COLUMNS.length - 1);
  assert.deepEqual(client.calls[1].body.columns, [...ALL_ATT_COLUMNS.filter(column => column.id !== 'Calendar_UID'), ...ALL_ATT_HELPER_COLUMNS]);
  assert.deepEqual(columns, before);
  assert.deepEqual(ALL_ATT_COLUMNS.find(column => column.id === 'Calendar_UID').fields,
    { type: 'Text', isFormula: false }, 'Default schema remains an ordinary writable data column');
});

test('Calendar_UID rejects formula columns and unknown or record-change trigger settings before schema writes', async () => {
  const base = { type: 'Text', isFormula: false, formula: 'UUID()', recalcWhen: 0, recalcDeps: null };
  for (const patch of [
    { isFormula: true }, { type: 'Any' }, { formula: 'UUID() + "changed"' },
    { recalcWhen: 1 }, { recalcWhen: 2 }, { recalcWhen: undefined }, { recalcWhen: null }, { recalcWhen: '0' },
    { recalcDeps: ['L', 41] }, { recalcDeps: [41] }, { recalcDeps: undefined }, { recalcDeps: '[]' },
    { formula: 'value or UUID()', recalcDeps: ['L', 42] },
    { formula: 'value or UUID()', recalcWhen: 2 },
  ]) {
    const columns = [...sourceColumns(), { id: 'Calendar_UID', fields: { ...base, ...patch } }];
    const before = structuredClone(columns);
    const client = clientFor(columns);
    await assert.rejects(ensureAllAttSchema(client), /calendar schema mismatch: Calendar_UID/);
    assert.equal(client.calls.length, 1);
    assert.deepEqual(columns, before);
  }
  const client = clientFor([...sourceColumns(), { id: 'Calendar_Title', fields: base }]);
  await assert.rejects(ensureAllAttSchema(client), /calendar schema mismatch: Calendar_Title/);
  assert.equal(client.calls.length, 1, 'UUID default exception is limited to Calendar_UID');
});

test('source type, missing column and true source formula mismatches fail before any schema writes', async () => {
  const variants = [sourceColumns().filter(column => column.id !== 't')];
  for (const id of ['start', 'end', 't', 'student', 'group2']) {
    const changedType = sourceColumns();
    changedType.find(column => column.id === id).fields.type = 'Text';
    variants.push(changedType);
    const changedFormula = sourceColumns();
    changedFormula.find(column => column.id === id).fields.isFormula = id !== 'end';
    variants.push(changedFormula);
  }
  for (const columns of variants) {
    const client = clientFor(columns);
    await assert.rejects(ensureAllAttSchema(client), /Existing columns were not modified/);
    assert.equal(client.calls.length, 1);
  }
});

test('existing calendar type/formula mismatches are never overwritten or partially supplemented', async () => {
  for (const fields of [
    { type: 'Numeric', isFormula: false },
    { type: 'Text', isFormula: true, formula: '"other"' },
    { type: 'Text', isFormula: false, formula: '"trigger"' },
  ]) {
    const client = clientFor([...sourceColumns(), { id: 'Calendar_Title', fields }]);
    await assert.rejects(ensureAllAttSchema(client), /calendar schema mismatch: Calendar_Title/);
    assert.equal(client.calls.length, 1);
  }
  const client = clientFor([...sourceColumns(), { id: 'Calendar_Revision', fields: { type: 'Text', isFormula: true, formula: 'different' } }]);
  await assert.rejects(ensureAllAttSchema(client), /calendar schema mismatch: Calendar_Revision/);
  assert.equal(client.calls.length, 1);
});

test('scalar CAS revision covers every projected field except itself, including row classification', () => {
  for (const field of ALL_ATT_FIELDS.filter(field => field !== 'Calendar_Revision')) {
    assert.ok(ALL_ATT_REVISION_FORMULA.includes(`$${field}`), field);
  }
  assert.doesNotMatch(ALL_ATT_REVISION_FORMULA, /\$Calendar_Revision|Calendar_Lesson|Calendar_Source_Revision/);
  assert.match(ALL_ATT_REVISION_FORMULA, /sha256/);
  assert.match(ALL_ATT_REVISION_FORMULA, /tuple\(\$student\.id\)/);
  assert.match(ALL_ATT_REVISION_FORMULA, /\$Calendar_Parent\.id/);
});

test('stored duration alone is added without changing the derived end or UID default', async () => {
  const columns = [...sourceColumns(), ...structuredClone(ALL_ATT_COLUMNS)];
  Object.assign(columns.find(column => column.id === 'Calendar_UID').fields,
    { formula: 'value or UUID()', recalcWhen: 0, recalcDeps: null });
  const before = structuredClone(columns);
  const client = clientFor(columns);
  assert.equal((await ensureAllAttSchema(client)).addedColumnCount, 1);
  assert.deepEqual(client.calls[1].body.columns, [DURATION_MINUTES_COLUMN]);
  assert.deepEqual(columns, before);
  assert.equal(columns.find(column => column.id === 'end').fields.formula, END_FORMULA);
  assert.equal((await ensureAllAttSchema(client)).addedColumnCount, 0);
  assert.equal(client.calls.filter(call => call.method === 'POST').length, 1, 'Repeated setup must not rewrite the helper or other columns');
});

test('duration is stored without a trigger and the end formula adds positive finite elapsed UTC minutes', () => {
  assert.equal(DURATION_MINUTES_COLUMN.id, 'Duration_Minutes');
  assert.equal(DURATION_MINUTES_COLUMN.fields.type, 'Numeric');
  assert.deepEqual(DURATION_MINUTES_COLUMN.fields, { type: 'Numeric', isFormula: false });
  assert.deepEqual(END_COLUMN, { id: 'end', fields: {
    type: 'DateTime:Asia/Vladivostok', isFormula: true, formula: END_FORMULA,
  } });
  assert.match(END_FORMULA, /isinstance\(start_at, datetime.datetime\)/);
  assert.match(END_FORMULA, /start_at.tzinfo is None/);
  assert.match(END_FORMULA, /isinstance\(minutes, bool\) or not isinstance\(minutes, \(int, float\)\)/);
  assert.match(END_FORMULA, /not math.isfinite\(minutes\) or minutes <= 0/);
  assert.match(END_FORMULA, /start_at\.astimezone\(datetime.timezone.utc\) \+ datetime.timedelta\(minutes=minutes\)/);
  assert.match(END_FORMULA, /\.astimezone\(start_at.tzinfo\)/);
  assert.match(END_FORMULA, /except \(TypeError, ValueError, OverflowError\)/);
  assert.doesNotMatch(END_FORMULA, /round\(|int\(|\$end|Calendar_Parent/);
});

test('unsafe existing duration definitions fail before any schema additions', async () => {
  for (const patch of [
    { type: 'Text' }, { type: 'Int' }, { isFormula: true }, { formula: '($end - $start).seconds / 60' },
    { formula: '60' }, { formula: 'value or 60', recalcWhen: 0, recalcDeps: null },
  ]) {
    const columns = [...sourceColumns(), { id: 'Duration_Minutes', fields: { ...DURATION_MINUTES_COLUMN.fields, ...patch } }];
    const before = structuredClone(columns);
    const client = clientFor(columns);
    await assert.rejects(ensureAllAttSchema(client), /calendar schema mismatch: Duration_Minutes/);
    assert.equal(client.calls.length, 1, 'Base calendar columns must not be partially added before discovering a helper mismatch');
    assert.deepEqual(columns, before);
  }
});

test('stored duration joins the source projection and concurrency revision without changing the 13 calendar columns', () => {
  assert.equal(ALL_ATT_COLUMNS.length, 13);
  assert.deepEqual(ALL_ATT_HELPER_FIELDS, ['Duration_Minutes']);
  assert.ok(!ALL_ATT_COLUMNS.some(column => column.id === 'Duration_Minutes'));
  assert.ok(ALL_ATT_FIELDS.includes('Duration_Minutes'));
  assert.match(ALL_ATT_REVISION_FORMULA, /\$Duration_Minutes/);
  const source = { start: 1791864000, end: 1791867600, t: ['L', 17], student: ['L'], group2: ['L', 31] };
  assert.notEqual(lessonVersion(source), lessonVersion({ ...source, Duration_Minutes: 60 }));
  assert.equal(lessonVersion(source), lessonVersion({ ...source, Duration_Minutes: null }));
});

test('setup rejects an old end trigger or unknown derived formula instead of migrating definitions', async () => {
  for (const fields of [
    { type: 'DateTime:Asia/Vladivostok', isFormula: false, formula: '$start + 3600', recalcWhen: 0, recalcDeps: ['L', 35] },
    { type: 'DateTime:Asia/Vladivostok', isFormula: true, formula: '$start + datetime.timedelta(hours=1)' },
  ]) {
    const columns = sourceColumns();
    columns.find(column => column.id === 'end').fields = fields;
    const before = structuredClone(columns);
    const client = clientFor(columns);
    await assert.rejects(ensureAllAttSchema(client), /end must derive from start and Duration_Minutes/);
    assert.deepEqual(columns, before);
    assert.equal(client.calls.length, 1);
  }
});
