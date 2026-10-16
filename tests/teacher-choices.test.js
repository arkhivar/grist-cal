import test from 'node:test';
import assert from 'node:assert/strict';
import { getTeacherChoices } from '../src/teacher-choices.js';

const teachers = [
  { id: 'unassigned', name: 'Unassigned', selectable: false },
  { id: 'per:1+2', name: 'AB + CD', selectable: false },
  { id: 'per:8', name: 'Former teacher', selectable: false },
  { id: 'per:99', name: 'Missing teacher', selectable: false },
  { id: 'per:1', name: '  A.B.  ', selectable: true },
  { id: 'per:2', name: 'C&D <E>', selectable: true },
];

test('new lessons offer only assignable teachers and preserve Grist display names verbatim', () => {
  const result = getTeacherChoices(teachers);
  assert.deepEqual(result.choices, teachers.slice(4));
  assert.equal(result.choices[0].name, '  A.B.  ');
  assert.equal(result.choices[1].name, 'C&D <E>');
  assert.equal(result.teacherId, 'per:1');
});

test('new lessons default to the first eligible visible teacher, skipping historical values', () => {
  const result = getTeacherChoices(teachers, { visibleTeacherIds: new Set(['unassigned', 'per:99', 'per:2']) });
  assert.equal(result.teacherId, 'per:2');
  assert.deepEqual(result.choices, teachers.slice(4));
  assert.equal(getTeacherChoices(teachers, { visibleTeacherIds: ['per:2', 'per:1'] }).teacherId, 'per:1');
});

test('when all eligible teachers are hidden, new lessons use the first eligible teacher', () => {
  for (const visibleTeacherIds of [[], ['per:8', 'per:1+2'], ['unknown']]) {
    assert.equal(getTeacherChoices(teachers, { visibleTeacherIds }).teacherId, 'per:1');
  }
});

test('an existing historical teacher is kept without exposing other historical choices', () => {
  for (const teacher of teachers.slice(0, 4)) {
    const result = getTeacherChoices(teachers, { mode: 'edit', teacherId: teacher.id, visibleTeacherIds: ['per:2'] });
    assert.equal(result.teacherId, teacher.id);
    assert.deepEqual(result.choices, [...teachers.slice(4), teacher]);
  }
});

test('an existing eligible teacher stays selected even when hidden and is not listed twice', () => {
  const result = getTeacherChoices(teachers, { mode: 'edit', teacherId: 'per:1', visibleTeacherIds: ['per:2'] });
  assert.equal(result.teacherId, 'per:1');
  assert.deepEqual(result.choices, teachers.slice(4));
});

test('an existing value missing from the catalog retains its identity instead of being reassigned', () => {
  const result = getTeacherChoices(teachers, { mode: 'edit', teacherId: 'per:404' });
  assert.equal(result.teacherId, 'per:404');
  assert.deepEqual(result.choices.at(-1), { id: 'per:404', name: 'Unavailable teacher', selectable: false });
});

test('duplicates of historical or unknown teachers require an explicit eligible selection', () => {
  for (const teacherId of [...teachers.slice(0, 4).map(teacher => teacher.id), 'per:404', undefined]) {
    const result = getTeacherChoices(teachers, { mode: 'duplicate', teacherId, visibleTeacherIds: ['per:2'] });
    assert.equal(result.teacherId, '');
    assert.deepEqual(result.choices, teachers.slice(4));
  }
});

test('duplicates retain an eligible source teacher even when that teacher is hidden', () => {
  const result = getTeacherChoices(teachers, { mode: 'duplicate', teacherId: 'per:1', visibleTeacherIds: ['per:2'] });
  assert.equal(result.teacherId, 'per:1');
  assert.deepEqual(result.choices, teachers.slice(4));
});

test('no eligible teachers means an empty selection while existing values can still be preserved', () => {
  const historical = teachers.slice(0, 4);
  assert.deepEqual(getTeacherChoices(historical), { choices: [], teacherId: '' });
  assert.deepEqual(getTeacherChoices([], { mode: 'duplicate', teacherId: 'per:1' }), { choices: [], teacherId: '' });
  const existing = getTeacherChoices(historical, { mode: 'edit', teacherId: 'unassigned' });
  assert.deepEqual(existing, { choices: [historical[0]], teacherId: 'unassigned' });
});

test('demo teachers without the selectable flag remain available for creation, edits and duplicates', () => {
  const demo = [{ id: 'alice', name: 'Alice' }, { id: 'boris', name: 'Boris' }];
  const before = structuredClone(demo);
  assert.deepEqual(getTeacherChoices(demo, { visibleTeacherIds: ['boris'] }), { choices: demo, teacherId: 'boris' });
  for (const mode of ['edit', 'duplicate']) {
    assert.deepEqual(getTeacherChoices(demo, { mode, teacherId: 'alice' }), { choices: demo, teacherId: 'alice' });
  }
  assert.deepEqual(demo, before);
});
