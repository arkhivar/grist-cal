import { fromSchoolInput, schoolToday, shiftDate, startOfWeek } from './domain.js';

export function createDemoData(anchorDate = schoolToday()) {
  const monday = startOfWeek(anchorDate);
  const teachers = [
    { id: 'anna', name: 'Anna Petrova', color: '#4285f4', initials: 'AP' },
    { id: 'mikhail', name: 'Mikhail Orlov', color: '#18875b', initials: 'MO' },
    { id: 'elena', name: 'Elena Volkova', color: '#8e63ce', initials: 'EV' },
    { id: 'daniel', name: 'Daniel Brooks', color: '#d59116', initials: 'DB' },
  ];
  // All names and records in this module are fictional.
  const slots = [
    [0, '09:00', '10:15', 'anna', 'English · early birds', 'A2 · Group 1', 'Room 1'],
    [0, '11:00', '12:00', 'mikhail', 'Grammar workshop', 'A2 · Group 6', 'Room 2'],
    [0, '15:00', '16:30', 'elena', 'Creative writing', 'B1 · Group 2', 'Room 3'],
    [0, '15:30', '16:30', 'daniel', 'Conversation club', 'B2 · Group 3', 'Room 4'],
    [1, '09:30', '10:30', 'elena', 'Reading studio', 'A2 · Group 4', 'Room 3'],
    [1, '13:00', '14:30', 'anna', 'English · next steps', 'B1 · Group 2', 'Room 1'],
    [1, '16:00', '17:00', 'mikhail', 'Exam preparation', 'B1 · Group 7', 'Room 2'],
    [1, '18:00', '19:00', 'daniel', 'Speaking lab', 'B2 · Group 3', 'Online'],
    [2, '10:00', '11:30', 'mikhail', 'Grammar workshop', 'A2 · Group 6', 'Room 2'],
    [2, '14:00', '15:00', 'daniel', 'Conversation club', 'B1 · Group 5', 'Room 4'],
    [2, '16:00', '17:30', 'anna', 'English · early birds', 'A2 · Group 1', 'Room 1'],
    [3, '09:00', '10:00', 'daniel', 'Speaking lab', 'B2 · Group 3', 'Online'],
    [3, '12:00', '13:30', 'elena', 'Creative writing', 'B1 · Group 2', 'Room 3'],
    [3, '16:00', '17:00', 'mikhail', 'Listening practice', 'B1 · Group 7', 'Room 2'],
    [3, '16:15', '17:30', 'anna', 'English · next steps', 'B1 · Group 5', 'Room 1'],
    [4, '10:30', '11:30', 'anna', 'English · early birds', 'A2 · Group 1', 'Room 1'],
    [4, '14:00', '15:30', 'elena', 'Reading studio', 'A2 · Group 4', 'Room 3'],
    [4, '17:30', '19:00', 'daniel', 'Friday conversation', 'B2 · Group 3', 'Room 4'],
  ];
  const students = [
    'Sofia Morozova', 'Lev Sokolov', 'Eva Belova', 'Mark Volkov', 'Mila Semyonova',
    'Nikita Pavlov', 'Alisa Romanova', 'Timur Lebedev', 'Polina Kuznetsova',
    'Artyom Vinogradov', 'Vera Antonova', 'Kirill Smirnov',
  ];
  const lessons = slots.map(([day, start, end, teacherId, title, group, room], index) => {
    const date = shiftDate(monday, day);
    const count = 3 + (index % 4);
    return {
      id: `demo-lesson-${String(index + 1).padStart(2, '0')}`,
      type: 'lesson', title, teacherId, group,
      start: fromSchoolInput(`${date}T${start}`), end: fromSchoolInput(`${date}T${end}`),
      room, participantText: `${count} students`, checklist: `${index % 4}/4`,
      status: index === 11 ? 'cancelled' : 'scheduled',
      notes: index === 0 ? 'Warm-up, pair practice, and a short reading activity.' : '',
      version: 1,
    };
  });
  const attendance = lessons.flatMap((lesson, lessonIndex) => {
    const count = 3 + (lessonIndex % 4);
    return Array.from({ length: count }, (_, index) => {
      const studentIndex = (lessonIndex * 3 + index) % students.length;
      return {
        id: `${lesson.id}-attendance-${index + 1}`, type: 'attendance', lessonId: lesson.id,
        // An incomplete student link still describes attendance, never a calendar event.
        studentId: lessonIndex === 0 && index === 2 ? '' : `demo-student-${studentIndex + 1}`,
        studentName: students[studentIndex],
        status: lessonIndex < 2 ? (index === 1 ? 'absent' : 'present') : 'pending',
        notes: '',
      };
    });
  });
  return { teachers, lessons, attendance };
}
