import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCalendarSchema, LESSON_COLUMNS } from '../server/schema.mjs';

test('schema setup only adds the named lesson table and attendance reference', async () => {
  const calls = [];
  const client = { async request(method, path, body) {
    calls.push({ method, path, body });
    if (method === 'POST') return {};
    if (path === '/tables') return { tables: [{ id: 'ALL_ATT' }] };
    if (path.includes('Calendar_Lessons')) return { columns: structuredClone(LESSON_COLUMNS) };
    return { columns: [{ id: 'datetime', fields: { type: 'DateTime:Asia/Vladivostok' } }] };
  } };
  await ensureCalendarSchema(client);
  const writes = calls.filter(call => call.method !== 'GET');
  assert.equal(writes.length, 3);
  assert.equal(writes[0].path, '/tables');
  assert.equal(writes[1].body.columns[0].id, 'Calendar_Lesson');
  assert.equal(writes[2].body.columns[0].id, 'Calendar_Source_Revision');
  assert.ok(writes.every(call => call.method === 'POST'));
});

test('existing incompatible schema is rejected without changing columns', async () => {
  const writes = [];
  const client = { async request(method, path, body) {
    if (method !== 'GET') writes.push(body);
    if (path === '/tables') return { tables: [{ id: 'Calendar_Lessons' }] };
    return { columns: LESSON_COLUMNS.map(column => column.id === 'Start' ? { id: 'Start', fields: { type: 'Text', isFormula: false } } : column) };
  } };
  await assert.rejects(ensureCalendarSchema(client), /schema mismatch/);
  assert.equal(writes.length, 0);
});
