import { schoolInput } from './domain.js';

export const editableFields = ['title', 'teacherId', 'group', 'start', 'end', 'room',
  'participantText', 'checklist', 'status', 'notes'];
const textFields = ['title', 'teacherId', 'group', 'room', 'participantText', 'checklist', 'notes'];
const textLimits = { title: 160, group: 120, room: 120, participantText: 500, checklist: 60, notes: 2000 };


export function storeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function validateLesson(lesson, teachers) {
  for (const field of textFields) {
    if (typeof lesson[field] !== 'string') {
      throw storeError('VALIDATION_ERROR', `The ${field} field must be text.`);
    }
  }
  lesson.title = lesson.title.trim();
  for (const [field, limit] of Object.entries(textLimits)) {
    if (lesson[field].length > limit) {
      throw storeError('VALIDATION_ERROR', `The ${field} field must be ${limit} characters or fewer.`);
    }
  }
  if (!lesson.title) throw storeError('VALIDATION_ERROR', 'Give the lesson a title.');
  if (!teachers.some(({ id }) => id === lesson.teacherId)) {
    throw storeError('VALIDATION_ERROR', 'Choose a teacher for this lesson.');
  }
  for (const field of ['start', 'end']) {
    if (typeof lesson[field] !== 'string') {
      throw storeError('VALIDATION_ERROR', `The lesson ${field} must be an ISO date and time with a UTC offset.`);
    }
    schoolInput(lesson[field]);
  }
  const start = new Date(lesson.start);
  const end = new Date(lesson.end);
  if (end <= start) throw storeError('VALIDATION_ERROR', 'The lesson must end after it starts.');
  if (end - start > 24 * 60 * 60 * 1000) {
    throw storeError('VALIDATION_ERROR', 'A lesson can last at most 24 hours.');
  }
  if (!['scheduled', 'cancelled'].includes(lesson.status)) {
    throw storeError('VALIDATION_ERROR', 'Choose a valid lesson status.');
  }
  lesson.start = start.toISOString();
  lesson.end = end.toISOString();
  return lesson;
}

