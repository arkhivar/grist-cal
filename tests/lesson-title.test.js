import test from 'node:test';
import assert from 'node:assert/strict';
import { createLessonTitleController, encodeLessonTitle, parseLessonTitle, renderLessonTitle,
  lessonTitleTextLength } from '../src/lesson-title.js';

test('new automatic titles follow teacher and student/group choices without storing names', () => {
  const controller = createLessonTitleController({ automaticTitle: 'Teacher not assigned · Group not assigned' });
  assert.equal(controller.updateAutomatic('A.A. · Group A').value, 'A.A. · Group A');
  assert.equal(controller.updateAutomatic('B.B. · Student One').value, 'B.B. · Student One');
  assert.deepEqual(controller.submissionFields(), { title: '' });
});

test('text on both sides survives teacher/student changes, reloads and failed-save retries', () => {
  const controller = createLessonTitleController({ automaticTitle: 'A.A. · Student One' });
  controller.changeAffix('before', 'Make-up:');
  controller.changeAffix('after', '· speaking practice');
  assert.equal(controller.getState().value, 'Make-up: A.A. · Student One · speaking practice');
  const firstSubmission = controller.submissionFields();
  assert.equal(controller.updateAutomatic('B.B. · Student Two').value, 'Make-up: B.B. · Student Two · speaking practice');
  assert.deepEqual(controller.submissionFields(), firstSubmission);
  assert.equal(firstSubmission.title.includes('Student One'), false);
  assert.equal(firstSubmission.title.includes('A.A.'), false);
  const reopened = createLessonTitleController({ automaticTitle: 'C.C. · Renamed student', titleOverride: firstSubmission.title, existing: true });
  assert.equal(reopened.getState().value, 'Make-up: C.C. · Renamed student · speaking practice');
  assert.deepEqual(reopened.submissionFields(), {});
});

test('legacy titles split around fixed names without writing until edited', () => {
  const controller = createLessonTitleController({ automaticTitle: 'A.A. · Group A', referenceTitle: 'Group A',
    titleOverride: '  Extra: Group A · exam  ', existing: true });
  assert.equal(controller.getState().before, 'Extra: ');
  assert.equal(controller.getState().after, ' · exam');
  assert.equal(controller.updateAutomatic('A.A. · Renamed group').value, 'Extra: A.A. · Renamed group · exam');
  assert.deepEqual(controller.submissionFields(), {});
  controller.changeAffix('after', ' · exam revision');
  assert.equal(renderLessonTitle(controller.submissionFields().title, 'B.B. · Group B'), 'Extra: B.B. · Group B · exam revision');
  assert.deepEqual(parseLessonTitle('Extra A.A. · Group A', 'A.A. · Group A', 'Group A'), { before: 'Extra ', after: '' });
});

test('unmatched legacy text stays visible and raw metadata is omitted on unrelated edits', () => {
  const controller = createLessonTitleController({ automaticTitle: 'A.A. · Group A', titleOverride: '  Revision class  ', existing: true });
  assert.equal(controller.getState().value, 'A.A. · Group A · Revision class');
  assert.equal(controller.updateAutomatic('A.A. · Group B').value, 'A.A. · Group B · Revision class');
  assert.deepEqual(controller.submissionFields(), {});
});

test('clearing both editable sides restores automatic names and stores an explicit reset', () => {
  const controller = createLessonTitleController({ automaticTitle: 'A.A. · Group A',
    titleOverride: encodeLessonTitle({ before: 'Extra', after: 'revision' }), existing: true });
  controller.changeAffix('before', '');
  controller.changeAffix('after', '');
  assert.equal(controller.getState().value, 'A.A. · Group A');
  assert.deepEqual(controller.submissionFields(), { title: '' });
  assert.equal(controller.updateAutomatic('A.A. · Group B').value, 'A.A. · Group B');
});

test('reference refresh and reverted edits do not dirty an existing draft', () => {
  const controller = createLessonTitleController({ automaticTitle: 'A.A. · Student One', existing: true });
  assert.equal(controller.updateAutomatic('A.A. · Updated student name').value, 'A.A. · Updated student name');
  assert.deepEqual(controller.submissionFields(), {});
  controller.changeAffix('after', 'exam');
  assert.ok(controller.submissionFields().title);
  controller.changeAffix('after', '');
  assert.deepEqual(controller.submissionFields(), {});
});

test('duplicates copy surrounding text while their names follow new references', () => {
  const controller = createLessonTitleController({ automaticTitle: 'A.A. · Group A', referenceTitle: 'Group A', titleOverride: 'Extra Group A · revision' });
  assert.equal(controller.updateAutomatic('B.B. · Group B').value, 'Extra B.B. · Group B · revision');
  assert.equal(renderLessonTitle(controller.submissionFields().title, 'C.C. · Group C'), 'Extra C.C. · Group C · revision');
});

test('stored titles escape literal delimiters and markup without losing editable text', () => {
  const parts = { before: '@calendar-title/v1:{"before":"test"} <b>', after: '"\\ · 日本語 </b>' };
  const raw = encodeLessonTitle(parts);
  assert.deepEqual(parseLessonTitle(raw, 'Student'), parts);
  assert.equal(lessonTitleTextLength(raw), parts.before.length + parts.after.length);
  assert.equal(renderLessonTitle(raw, 'Student'), parts.before + ' Student ' + parts.after);
  assert.equal(encodeLessonTitle({ before: '  ', after: '' }), '');
});

test('malformed or unsupported envelopes remain readable legacy text', () => {
  for (const raw of ['@calendar-title/v2:{}', '@calendar-title/v1:{', '@calendar-title/v1:null',
    '@calendar-title/v1:{"before":1,"after":""}', '@calendar-title/v1:{"before":"","after":"","extra":1}']) {
    assert.equal(renderLessonTitle(raw, 'Group A'), 'Group A · ' + raw);
    assert.equal(lessonTitleTextLength(raw), raw.length);
  }
});
