import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ATT_COLUMNS, ALL_ATT_REVISION_FORMULA, ensureAllAttSchema } from '../server/all-att-schema.mjs';
import { ALL_ATT_FIELDS } from '../server/all-att-model.mjs';

const sourceColumns = () => [
  ['start', 'DateTime:Asia/Vladivostok'], ['end', 'DateTime:Asia/Vladivostok'], ['t', 'RefList:PERFORMANCE'],
  ['student', 'RefList:FOLKS'], ['group2', 'RefList:PERFORMANCE'], ['notes', 'Text'],
].map(([id, type]) => ({ id, fields: { type, isFormula: false, formula: id === 'end' ? '$start + 3600' : '' } }));

function clientFor(columns) {
  const calls = [];
  return { calls, async request(method, endpoint, body) {
    calls.push({ method, endpoint, body });
    if (method === 'GET') return { columns };
    assert.equal(method, 'POST');
    assert.equal(endpoint, '/tables/ALL_ATT/columns');
    assert.ok(body.columns.every(column => column.id.startsWith('Calendar_')));
    return {};
  } };
}

test('ALL_ATT setup adds only new columns and leaves source/end trigger formulas untouched', async () => {
  const existing = sourceColumns();
  const before = structuredClone(existing);
  const client = clientFor(existing);
  const result = await ensureAllAttSchema(client);
  assert.equal(result.lessonTable, 'ALL_ATT');
  assert.equal(result.attendanceLink, 'Calendar_Parent');
  assert.equal(result.addedColumnCount, ALL_ATT_COLUMNS.length);
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[1].body.columns, ALL_ATT_COLUMNS);
  assert.deepEqual(existing, before);
  assert.equal(ALL_ATT_COLUMNS.find(column => column.id === 'Calendar_Parent').fields.type, 'Ref:ALL_ATT');
});

test('ALL_ATT schema setup is idempotent and does not alter unrelated legacy columns', async () => {
  const client = clientFor([...sourceColumns(), ...structuredClone(ALL_ATT_COLUMNS),
    { id: 'Calendar_Lesson', fields: { type: 'Ref:Calendar_Lessons', isFormula: false } },
    { id: 'Calendar_Source_Revision', fields: { type: 'Text', isFormula: true, formula: 'legacy formula' } }]);
  const result = await ensureAllAttSchema(client);
  assert.equal(result.addedColumnCount, 0);
  assert.equal(client.calls.length, 1);
});

test('source type, missing column and true source formula mismatches fail before any schema writes', async () => {
  const variants = [sourceColumns().filter(column => column.id !== 't')];
  for (const id of ['start', 'end', 't', 'student', 'group2']) {
    const changedType = sourceColumns();
    changedType.find(column => column.id === id).fields.type = 'Text';
    variants.push(changedType);
    const changedFormula = sourceColumns();
    changedFormula.find(column => column.id === id).fields.isFormula = true;
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
