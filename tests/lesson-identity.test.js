import test from 'node:test';
import assert from 'node:assert/strict';
import { createLessonIdentityController } from '../src/lesson-identity.js';

const students = [{ id: 'folks:2', name: 'Student Two' }, { id: 'folks:10', name: 'Shared name' }];
const groups = [{ id: 'per:3', name: 'Group Three' }, { id: 'per:10', name: 'Shared name' }];
const create = (options = {}) => createLessonIdentityController({ students, groups, ...options });

test('new lessons default to an unassigned group without inventing a reference', () => {
  assert.deepEqual(create().getState(), {
    lessonKind: 'group', studentIds: [], groupIds: [], referenceTitle: 'Group not assigned', selectionKey: 'group:none', locked: false,
    selectionKind: null, changed: false,
  });
});

test('choosing a student or group infers lesson type and clears the other reference', () => {
  const controller = create();
  assert.equal(controller.select('folks:2').referenceTitle, 'Student Two');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] });
  assert.equal(controller.select('per:3').referenceTitle, 'Group Three');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'group', studentIds: [], groupIds: ['per:3'] });
  controller.select('folks:10');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'individual', studentIds: ['folks:10'], groupIds: [] });
  controller.select('group:none');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'group', studentIds: [], groupIds: [] });
});

test('students and groups with identical labels retain separate keys and kinds', () => {
  const controller = create();
  assert.deepEqual(controller.getChoices('shared name').map(({ key, kind }) => ({ key, kind })), [
    { key: 'folks:10', kind: 'student' }, { key: 'per:10', kind: 'group' },
  ]);
  assert.equal(controller.select('folks:10').lessonKind, 'individual');
  assert.equal(controller.select('per:10').lessonKind, 'group');
});

test('search matches exact names and readable type labels without truncating results', () => {
  const controller = create({ students: Array.from({ length: 250 }, (_, n) => ({ id: `folks:${n + 1}`, name: `Person ${n + 1}` })) });
  assert.equal(controller.getChoices('individual').length, 250);
  assert.equal(controller.getChoices('student').length, 250);
  assert.deepEqual(controller.getChoices('PERSON 25').map(choice => choice.name), ['Person 125', 'Person 225', 'Person 25', 'Person 250']);
  assert.equal(controller.getChoices('group lesson').length, groups.length + 1);
  assert.equal(controller.getChoices('not present').length, 0);
});

test('saved individual lessons allow choosing a current student and omit unchanged or reverted assignments', () => {
  const controller = create({ existing: true, lesson: { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] } });
  assert.equal(controller.getState().locked, false);
  assert.equal(controller.getState().selectionKind, 'student');
  assert.equal(controller.hasChanges(), false);
  assert.deepEqual(controller.submissionFields(), {});
  assert.deepEqual(controller.getChoices().map(choice => choice.key), ['folks:10', 'folks:2']);
  assert.equal(controller.getChoices('group').length, 0);
  assert.equal(controller.select('folks:10').referenceTitle, 'Shared name');
  assert.equal(controller.getState().changed, true);
  assert.equal(controller.hasChanges(), true);
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'individual', studentIds: ['folks:10'], groupIds: [] });
  controller.select('folks:2');
  assert.equal(controller.hasChanges(), false);
  assert.deepEqual(controller.submissionFields(), {});
});

test('saved group lessons allow another group or no group without converting to individual', () => {
  const controller = create({ existing: true, lesson: { lessonKind: 'group', studentIds: [], groupIds: ['per:3'] } });
  assert.equal(controller.getState().selectionKind, 'group');
  assert.deepEqual(controller.getChoices().map(choice => choice.key), ['group:none', 'per:3', 'per:10']);
  assert.deepEqual(controller.submissionFields(), {});
  controller.select('per:10');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'group', studentIds: [], groupIds: ['per:10'] });
  assert.equal(controller.select('group:none').referenceTitle, 'Group not assigned');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'group', studentIds: [], groupIds: [] });
  controller.select('per:3');
  assert.deepEqual(controller.submissionFields(), {});
});

test('saved lessons reject wrong-kind and unknown keys without changing the pending assignment', () => {
  const cases = [
    { lesson: { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] }, selected: 'folks:10', rejected: ['per:3', 'group:none'] },
    { lesson: { lessonKind: 'group', studentIds: [], groupIds: ['per:3'] }, selected: 'per:10', rejected: ['folks:2'] },
  ];
  for (const { lesson, selected, rejected } of cases) {
    const controller = create({ existing: true, lesson });
    controller.select(selected);
    const before = controller.getState();
    const payload = controller.submissionFields();
    for (const key of rejected) {
      assert.throws(() => controller.select(key), /saved lesson type cannot be changed/);
      assert.deepEqual(controller.getState(), before);
    }
    assert.throws(() => controller.select('missing'), /existing student or group/);
    assert.deepEqual(controller.submissionFields(), payload);
  }
});

test('historical missing and multiple references remain visible but are not new choices', () => {
  const controller = create({ existing: true, lesson: { lessonKind: 'group', studentIds: [], groupIds: ['per:999', 'per:10', 'per:3', 'per:3'] } });
  assert.deepEqual(controller.getState(), {
    lessonKind: 'group', studentIds: [], groupIds: ['per:3', 'per:10', 'per:999'],
    referenceTitle: 'Group Three · Shared name · Group #999', selectionKey: null, selectionKind: 'group', locked: false, changed: false,
  });
  assert.deepEqual(controller.submissionFields(), {});
  assert.equal(controller.getChoices().some(choice => choice.key === 'per:999'), false);
  const individual = create({ existing: true, lesson: { lessonKind: 'individual', studentIds: ['folks:12', 'folks:2'], groupIds: [] } });
  assert.equal(individual.getState().referenceTitle, 'Student Two, Student #12');
  assert.equal(individual.getState().selectionKey, null);
  assert.deepEqual(individual.submissionFields(), {});
  assert.deepEqual(controller.select('per:10').groupIds, ['per:10']);
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'group', studentIds: [], groupIds: ['per:10'] });
  assert.deepEqual(individual.select('folks:10').studentIds, ['folks:10']);
  assert.deepEqual(individual.submissionFields(), { lessonKind: 'individual', studentIds: ['folks:10'], groupIds: [] });
});

test('saved historical missing references survive refresh until deliberately replaced', () => {
  const controller = create({ existing: true, lesson: { lessonKind: 'individual', studentIds: ['folks:99'], groupIds: [] } });
  assert.equal(controller.getState().referenceTitle, 'Student #99');
  controller.updateCatalogs({ students: [{ id: 'folks:2', name: 'Current Student' }] });
  assert.equal(controller.getState().selectionKey, 'folks:99');
  assert.deepEqual(controller.submissionFields(), {});
  assert.throws(() => controller.select('folks:99'), /existing student or group/);
  assert.deepEqual(controller.submissionFields(), {});
  controller.select('folks:2');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] });
});

test('saved assignment retries preserve the chosen student through renames and catalog removal', () => {
  const controller = create({ existing: true, lesson: { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] } });
  controller.updateCatalogs({ students: [{ id: 'folks:2', name: 'Renamed Original' }, students[1]] });
  assert.equal(controller.getState().referenceTitle, 'Renamed Original');
  assert.deepEqual(controller.submissionFields(), {});
  controller.select('folks:10');
  const failedSavePayload = controller.submissionFields();
  controller.updateCatalogs({ students: [{ id: 'folks:10', name: 'Renamed Selection' }] });
  assert.equal(controller.getState().referenceTitle, 'Renamed Selection');
  assert.deepEqual(controller.submissionFields(), failedSavePayload);
  controller.updateCatalogs({ students: [] });
  assert.equal(controller.getState().referenceTitle, 'Student #10');
  assert.deepEqual(controller.submissionFields(), failedSavePayload);
  assert.equal(controller.hasChanges(), true);
});

test('an untouched duplicate preserves missing or multiple references until explicitly replaced', () => {
  const controller = create({ lesson: { lessonKind: 'individual', studentIds: ['folks:99', 'folks:2'], groupIds: [] } });
  const expected = { lessonKind: 'individual', studentIds: ['folks:2', 'folks:99'], groupIds: [] };
  assert.deepEqual(controller.submissionFields(), expected);
  controller.updateCatalogs({ students: [{ id: 'folks:2', name: 'Renamed student' }] });
  assert.deepEqual(controller.submissionFields(), expected);
  assert.equal(controller.getState().referenceTitle, 'Renamed student, Student #99');
  controller.select('per:3');
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'group', studentIds: [], groupIds: ['per:3'] });
});

test('reference renames and catalog removal update labels without changing draft identity', () => {
  const controller = create();
  controller.select('folks:2');
  const payload = controller.submissionFields();
  assert.equal(controller.updateCatalogs({ students: [{ id: 'folks:2', name: '  Updated exact name  ' }] }).referenceTitle, '  Updated exact name  ');
  assert.deepEqual(controller.submissionFields(), payload);
  assert.equal(controller.updateCatalogs({ students: [] }).referenceTitle, 'Student #2');
  assert.equal(controller.getState().selectionKey, 'folks:2');
  assert.deepEqual(controller.submissionFields(), payload);
  assert.throws(() => controller.select('folks:2'), /existing student or group/);
  assert.deepEqual(controller.submissionFields(), payload);
});

test('catalog, returned state and payload objects cannot mutate a pending or failed-save draft', () => {
  const studentCatalog = students.map(item => ({ ...item }));
  const source = { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] };
  const controller = create({ lesson: source, students: studentCatalog });
  source.studentIds.push('folks:10');
  studentCatalog[0].name = 'Mutated outside controller';
  controller.getState().studentIds.push('folks:99');
  const choices = controller.getChoices();
  choices.find(choice => choice.key === 'folks:2').name = 'Mutated choice';
  const submitted = controller.submissionFields();
  submitted.studentIds.length = 0;
  submitted.lessonKind = 'group';
  assert.deepEqual(controller.submissionFields(), { lessonKind: 'individual', studentIds: ['folks:2'], groupIds: [] });
  assert.equal(controller.getState().referenceTitle, 'Student Two');
});

test('invalid selections leave the complete draft intact', () => {
  const controller = create();
  controller.select('per:3');
  const before = controller.getState();
  assert.throws(() => controller.select('folks:999'), /existing student or group/);
  assert.deepEqual(controller.getState(), before);
});

test('duplicate catalog entries appear once and retain exact name text', () => {
  const controller = create({ groups: [{ id: 'per:3', name: 'Old name' }, { id: 'per:3', name: '  Exact name  ' }] });
  assert.equal(controller.getChoices().filter(choice => choice.key === 'per:3').length, 1);
  assert.equal(controller.select('per:3').referenceTitle, '  Exact name  ');
});
