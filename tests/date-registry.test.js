import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATE_REGISTRY_TABLE, DATE_REGISTRY_FIELDS, DATE_REGISTRY_COLUMNS, ALL_ATT_DATE_REGISTRY_COLUMN,
  calendarDateFormula, ensureDateRegistrySchema, inspectDateRegistry, normalizeDateRegistry,
  buildDateRegistryPlan, prepareDateRegistry,
} from '../server/date-registry.mjs';

const epoch = date => Date.parse(`${date}T00:00:00Z`) / 1000;
const record = (id, date, extra = {}) => ({ id, fields: { Date: date === null ? null : epoch(date), ...extra } });
const range = { startDate: '2026-01-01', endDate: '2026-01-03' };
const clone = value => structuredClone(value);

function schemaClient({ registry = [{ id: 'A', fields: { type: 'Any', isFormula: false } },
  { id: 'B', fields: { type: 'Any', isFormula: false } }, { id: 'C', fields: { type: 'Any', isFormula: false } }],
  source = [{ id: 'start', fields: { type: 'DateTime:Asia/Vladivostok', isFormula: false } }],
  sourceTable = 'ALL_ATT', registryExists = true } = {}) {
  const calls = [];
  const tables = [...(registryExists ? [{ id: 'DateRegistry' }] : []), { id: sourceTable }];
  return { calls, async request(method, path, body) {
    calls.push({ method, path, body: clone(body) });
    if (path === '/tables') return method === 'GET' ? { tables } : {};
    if (method === 'GET') return { columns: path.includes('/DateRegistry/') ? registry : source };
    assert.equal(method, 'POST');
    return {};
  } };
}

function dataClient(initial = [], { beforeWrite, afterWrite, beforeRead } = {}) {
  const rows = clone(initial);
  const reads = [];
  const writes = [];
  let nextId = Math.max(0, ...initial.map(row => row.id)) + 1;
  return { rows, reads, writes,
    async records(table, fields) {
      assert.equal(table, DATE_REGISTRY_TABLE);
      assert.deepEqual(fields, ['Date']);
      reads.push({ table, fields });
      await beforeRead?.({ rows, reads, writes });
      return rows.map(row => ({ id: row.id, fields: { Date: row.fields.Date } }));
    },
    async request(method, path, body) {
      writes.push({ method, path, body: clone(body) });
      assert.equal(method, 'PUT');
      const query = new URLSearchParams(path.split('?')[1]);
      assert.equal(query.get('noupdate'), 'true');
      assert.equal(query.get('onmany'), 'none');
      assert.equal(query.get('noparse'), 'true');
      await beforeWrite?.({ rows, reads, writes, body });
      const recordIds = [];
      for (const operation of body.records) {
        assert.deepEqual(Object.keys(operation.require), ['Date']);
        assert.deepEqual(operation.fields, {});
        const matching = rows.filter(row => row.fields.Date === operation.require.Date);
        if (!matching.length) {
          const row = { id: nextId++, fields: { ...operation.require } };
          rows.push(row);
          recordIds.push([row.id]);
        } else recordIds.push(matching.length === 1 ? [matching[0].id] : []);
      }
      await afterWrite?.({ rows, reads, writes, body });
      return { recordIds };
    },
  };
}

test('registry schema derives deterministic metadata while school policy remains manual', () => {
  assert.deepEqual(DATE_REGISTRY_FIELDS, DATE_REGISTRY_COLUMNS.map(column => column.id));
  const fields = Object.fromEntries(DATE_REGISTRY_COLUMNS.map(column => [column.id, column.fields]));
  assert.equal(fields.Date.type, 'Date');
  assert.equal(fields.Date.isFormula, false);
  for (const name of ['Day', 'Day_Parity', 'Month_Parity', 'Is_Weekend']) assert.equal(fields[name].isFormula, true);
  for (const name of ['School_Day', 'Holiday_Name', 'Academic_Term']) {
    assert.equal(fields[name].isFormula, false);
    assert.equal(fields[name].formula, undefined);
  }
  assert.deepEqual(JSON.parse(fields.School_Day.widgetOptions).choices, ['Unspecified', 'Teaching day', 'Closed']);
  assert.match(fields.Day_Parity.formula, /datetime\.date\(2026, 1, 1\)/);
  assert.match(fields.Month_Parity.formula, /\(\$Date.year - 2026\) \* 12/);
  assert.doesNotMatch(JSON.stringify(fields), /ALL_ATT|Transactions|lookupRecords|\.id/);
});

test('the ALL_ATT DateRegistry reference converts its own timestamp and refuses absent or duplicate date matches', () => {
  const formula = calendarDateFormula();
  assert.equal(ALL_ATT_DATE_REGISTRY_COLUMN.id, 'DateRegistry');
  assert.equal(ALL_ATT_DATE_REGISTRY_COLUMN.fields.type, 'Ref:DateRegistry');
  assert.equal(ALL_ATT_DATE_REGISTRY_COLUMN.fields.formula, formula);
  assert.match(formula, /value = \$start/);
  assert.match(formula, /value\.astimezone\(moment\.tzinfo\("Asia\/Vladivostok"\)\)\.date\(\)/);
  assert.match(formula, /value\.tzinfo is None/);
  assert.match(formula, /DateRegistry\.lookupRecords\(Date=day\)/);
  assert.match(formula, /matches\[0\] if len\(matches\) == 1 else 0/);
  assert.doesNotMatch(formula, /Calendar_Parent|ALL_ATT|all\(|lookupOne|\.replace\(/);
  assert.match(calendarDateFormula('datetime'), /value = \$datetime/);
  const dateFormula = calendarDateFormula('date', { sourceKind: 'date' });
  assert.doesNotMatch(dateFormula, /moment|astimezone/);
  assert.match(dateFormula, /day = value/);
  for (const source of ['start\nreturn 1', '', '$start', 'a.b']) assert.throws(() => calendarDateFormula(source), { code: 'DATE_REGISTRY_SCHEMA' });
});

test('schema setup adds missing registry and source columns while preserving default A/B/C', async () => {
  const client = schemaClient();
  const result = await ensureDateRegistrySchema(client);
  const writes = client.calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, '/tables/DateRegistry/columns');
  assert.deepEqual(writes[0].body.columns, DATE_REGISTRY_COLUMNS);
  assert.ok(writes.every(call => call.body.columns.every(column => !['A', 'B', 'C'].includes(column.id))));
  assert.deepEqual(writes[1].body.columns, [ALL_ATT_DATE_REGISTRY_COLUMN]);
  assert.equal(result.referenceColumn, 'DateRegistry');
  assert.equal(result.addedRegistryColumnCount, 8);
  assert.equal(result.addedSourceColumnCount, 1);
});

test('schema setup is idempotent and supports separate Transactions or Date source links', async () => {
  const client = schemaClient({ registry: clone(DATE_REGISTRY_COLUMNS), source: [
    { id: 'datetime', fields: { type: 'DateTime:Asia/Vladivostok', isFormula: false } },
    { id: 'date', fields: { type: 'Date', isFormula: true, formula: '$datetime.date()' } },
    { id: 'Calendar_Date', fields: { type: 'Ref:DateRegistry', isFormula: true, formula: calendarDateFormula('datetime') } },
  ], sourceTable: 'Transactions' });
  const result = await ensureDateRegistrySchema(client, { sourceTable: 'Transactions', sourceField: 'datetime' });
  assert.equal(result.referenceColumn, 'Calendar_Date');
  assert.equal(result.addedRegistryColumnCount, 0);
  assert.equal(result.addedSourceColumnCount, 0);
  assert.equal(client.calls.filter(call => call.method !== 'GET').length, 0);
  const dateClient = schemaClient({ registry: clone(DATE_REGISTRY_COLUMNS), sourceTable: 'Transactions',
    source: [{ id: 'date', fields: { type: 'Date', isFormula: true, formula: '$datetime.date()' } }] });
  await ensureDateRegistrySchema(dateClient, { sourceTable: 'Transactions', sourceField: 'date' });
  assert.equal(dateClient.calls.at(-1).body.columns[0].id, 'Calendar_Date');
  assert.equal(dateClient.calls.at(-1).body.columns[0].fields.formula, calendarDateFormula('date', { sourceKind: 'date' }));
});

test('renamed ALL_ATT reference is idempotent and setup never recreates Calendar_Date', async () => {
  const source = [{ id: 'start', fields: { type: 'DateTime:Asia/Vladivostok', isFormula: false } },
    clone(ALL_ATT_DATE_REGISTRY_COLUMN)];
  const client = schemaClient({ registry: clone(DATE_REGISTRY_COLUMNS), source });
  const result = await ensureDateRegistrySchema(client);
  assert.equal(result.referenceColumn, 'DateRegistry');
  assert.equal(result.addedRegistryColumnCount, 0);
  assert.equal(result.addedSourceColumnCount, 0);
  assert.ok(client.calls.every(call => call.method === 'GET'));
  const before = clone(client.calls);
  await assert.rejects(ensureDateRegistrySchema(client, { referenceColumn: 'Calendar_Date' }),
    { code: 'DATE_REGISTRY_SCHEMA' });
  assert.deepEqual(client.calls, before, 'Explicit requests cannot restore the retired ALL_ATT column');
});

test('old-only ALL_ATT reference requires a rename before any additive setup writes', async () => {
  const source = [{ id: 'start', fields: { type: 'DateTime:Asia/Vladivostok', isFormula: false } },
    { ...clone(ALL_ATT_DATE_REGISTRY_COLUMN), id: 'Calendar_Date' }];
  const client = schemaClient({ source });
  await assert.rejects(ensureDateRegistrySchema(client), error =>
    error.code === 'DATE_REGISTRY_SCHEMA' && /Rename ALL_ATT.Calendar_Date to DateRegistry/.test(error.message));
  assert.ok(client.calls.every(call => call.method === 'GET'), 'Setup must not add duplicate links or partially change the registry');
});

test('schema validates all incompatible definitions before any write', async () => {
  const variants = [
    { registry: [{ id: 'Day_Parity', fields: { type: 'Int', isFormula: true, formula: '$id % 2' } }] },
    { registry: [{ id: 'Date', fields: { type: 'DateTime:UTC', isFormula: false } }] },
    { registry: [{ id: 'School_Day', fields: { type: 'Choice', isFormula: false, widgetOptions: '{}' } }] },
    { source: [{ id: 'start', fields: { type: 'Text', isFormula: false } }] },
    { source: [{ id: 'start', fields: { type: 'DateTime:Asia/Vladivostok', isFormula: false } },
      { id: 'DateRegistry', fields: { type: 'Ref:DateRegistry', isFormula: true, formula: 'old formula' } }] },
  ];
  for (const variant of variants) {
    const client = schemaClient(variant);
    await assert.rejects(ensureDateRegistrySchema(client), { code: 'DATE_REGISTRY_SCHEMA' });
    assert.ok(client.calls.every(call => call.method === 'GET'));
  }
});

test('missing registry may be created explicitly after source validation', async () => {
  const client = schemaClient({ registryExists: false });
  await ensureDateRegistrySchema(client);
  const creation = client.calls.find(call => call.method === 'POST' && call.path === '/tables');
  assert.deepEqual(creation.body.tables, [{ id: 'DateRegistry', columns: DATE_REGISTRY_COLUMNS }]);
});

test('registry normalization exposes school policy without inferring weekend closure', () => {
  const rows = normalizeDateRegistry([
    record(4, '2026-01-04', { School_Day: 'Teaching day', Holiday_Name: 'School event', Academic_Term: 'Term 2', private: 'omit' }),
    record(2, '2026-01-02', { School_Day: 'Closed' }), record(3, '2026-01-03'), record(1, '2026-01-01'),
  ]);
  assert.deepEqual(rows.map(row => row.id), ['date:1', 'date:2', 'date:3', 'date:4']);
  assert.deepEqual(rows.map(row => row.day), ['Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(rows.map(row => row.dayParity), [0, 1, 0, 1]);
  assert.deepEqual(rows.map(row => row.monthParity), [0, 0, 0, 0]);
  assert.deepEqual(rows.map(row => row.isWeekend), [false, false, true, true]);
  assert.deepEqual(rows.map(row => row.schoolDay), ['unspecified', 'closed', 'unspecified', 'teaching']);
  assert.equal(rows[3].holidayName, 'School event');
  assert.equal(rows[3].academicTerm, 'Term 2');
  assert.ok(!Object.hasOwn(rows[3], 'private'));
});

test('registry parity uses calendar distance across negative dates, leap days and month/year boundaries', () => {
  const rows = normalizeDateRegistry([
    record(1, '2025-12-31'), record(2, '2026-01-01'), record(3, '2026-01-03'),
    record(4, '2026-02-01'), record(5, '2026-12-31'), record(6, '2027-01-01'),
    record(7, '2024-02-28'), record(8, '2024-02-29'), record(9, '2024-03-01'),
  ]);
  const byDate = new Map(rows.map(row => [row.date, row]));
  assert.equal(byDate.get('2025-12-31').dayParity, 1);
  assert.equal(byDate.get('2026-01-01').dayParity, 0);
  assert.equal(byDate.get('2026-01-03').dayParity, 0, 'Missing occupied Jan 2 does not change calendar parity');
  assert.equal(byDate.get('2025-12-31').monthParity, 1);
  assert.equal(byDate.get('2026-02-01').monthParity, 1);
  assert.equal(byDate.get('2026-12-31').monthParity, 1);
  assert.equal(byDate.get('2027-01-01').monthParity, 0);
  assert.notEqual(byDate.get('2024-02-28').dayParity, byDate.get('2024-02-29').dayParity);
  assert.equal(byDate.get('2024-02-28').dayParity, byDate.get('2024-03-01').dayParity);
});

test('invalid and duplicate dates are excluded and reported without arbitrary matching', () => {
  const result = inspectDateRegistry([
    record(1, '2026-01-01'), record(2, '2026-01-01'), record(3, '2026-01-02'),
    record(4, null), record(5, '2026-01-03', { Date: epoch('2026-01-03') + 3600 }),
    record(6, '2026-01-04', { Date: '2026-01-04' }), record(0, '2026-01-05'),
  ]);
  assert.deepEqual(result.rows.map(row => row.date), ['2026-01-02']);
  assert.deepEqual(result.summary, { rowCount: 7, validDateCount: 1, duplicateDateCount: 1, duplicateRowCount: 2,
    missingDateRowCount: 1, invalidDateRowCount: 2, invalidRowIdCount: 1 });
  assert.equal(normalizeDateRegistry([record(1, '1970-01-01')])[0].date, '1970-01-01');
});

test('range planning is inclusive and bounded, including leap years', () => {
  const result = buildDateRegistryPlan([record(5, '2026-01-02')], range);
  assert.deepEqual(result.missingDates, [epoch('2026-01-01'), epoch('2026-01-03')]);
  assert.equal(result.summary.requestedDateCount, 3);
  assert.equal(result.summary.existingDateCount, 1);
  assert.equal(buildDateRegistryPlan([], { startDate: '2020-01-01', endDate: '2029-12-31' }).dates.length, 3653);
  for (const options of [
    { startDate: '2026-02-30', endDate: '2026-03-01' }, { startDate: '2026-01-02', endDate: '2026-01-01' },
    { ...range, maxDays: 2 }, { ...range, minDate: '2026-01-02' }, { ...range, maxDate: '2026-01-02' },
    { startDate: '0000-01-01', endDate: '2026-01-01' }, { ...range, maxDays: -1 },
  ]) assert.throws(() => buildDateRegistryPlan([], options), { code: 'DATE_REGISTRY_RANGE' });
});

test('preparation inserts only missing Date values and never overwrites manual policy or default columns', async () => {
  const existing = record(10, '2026-01-02', { School_Day: 'Teaching day', Holiday_Name: 'User text', Academic_Term: 'Term 2', A: 'retained' });
  const client = dataClient([existing]);
  const result = await prepareDateRegistry(client, range);
  assert.equal(result.complete, true);
  assert.equal(result.newDateCount, 2);
  assert.equal(result.confirmedDateCount, 3);
  assert.equal(client.rows.length, 3);
  assert.deepEqual(client.rows.find(row => row.id === 10), existing);
  assert.ok(client.rows.filter(row => row.id !== 10).every(row => Object.keys(row.fields).length === 1));
  const again = await prepareDateRegistry(client, range);
  assert.equal(again.newDateCount, 0);
  assert.equal(again.writeBatchCount, 0);
  assert.equal(client.writes.length, 1);
});

test('existing invalid dates stop preparation before any data mutation', async () => {
  for (const rows of [[record(1, null)], [record(1, '2026-01-01'), record(2, '2026-01-01')],
    [record(1, '2026-01-01', { Date: 123 })]]) {
    const client = dataClient(rows);
    await assert.rejects(prepareDateRegistry(client, range), { code: 'DATE_REGISTRY_INVALID' });
    assert.equal(client.writes.length, 0);
  }
});

test('lost write responses are resolved by readback and reruns remain idempotent', async () => {
  const client = dataClient([], { afterWrite: () => { throw new Error('Private upstream URL/token'); } });
  const result = await prepareDateRegistry(client, { ...range, batchSize: 2 });
  assert.equal(result.confirmedDateCount, 3);
  assert.equal(result.recoveredWriteBatchCount, 2);
  assert.equal(client.writes.length, 2);
  assert.equal(client.rows.length, 3);
  await prepareDateRegistry(client, range);
  assert.equal(client.writes.length, 2);
});

test('concurrent conditional preparation does not create duplicate days or change another writer policy', async () => {
  let waiting = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const client = dataClient([], { beforeWrite: async () => { if (++waiting === 2) release(); await barrier; },
    afterWrite: ({ rows }) => { rows[0].fields.School_Day = 'Closed'; } });
  const results = await Promise.all([prepareDateRegistry(client, range), prepareDateRegistry(client, range)]);
  assert.ok(results.every(result => result.complete));
  assert.equal(client.rows.length, 3);
  assert.equal(client.rows[0].fields.School_Day, 'Closed');
});

test('a concurrent manually introduced duplicate prevents a successful preparation claim', async () => {
  const client = dataClient([], { afterWrite: ({ rows }) => rows.push({ id: 999, fields: { Date: rows[0].fields.Date } }) });
  await assert.rejects(prepareDateRegistry(client, range), { code: 'DATE_REGISTRY_INVALID' });
});

test('unknown or incomplete outcomes preserve inserted rows and stop without blindly retrying', async () => {
  const failed = dataClient([], { beforeWrite: () => { throw new Error('private upstream'); } });
  await assert.rejects(prepareDateRegistry(failed, range), error =>
    error.code === 'DATE_REGISTRY_UNCERTAIN' && !error.message.includes('private'));
  assert.equal(failed.writes.length, 1);
  const unreadable = dataClient([], { beforeRead: ({ writes }) => { if (writes.length) throw new Error('private error'); } });
  await assert.rejects(prepareDateRegistry(unreadable, range), { code: 'DATE_REGISTRY_UNCERTAIN' });
  assert.equal(unreadable.rows.length, 3);
  assert.equal(unreadable.writes.length, 1);
});
