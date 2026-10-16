/** Historical teacher values remain editable on their own lesson, but cannot be assigned anew. */
export function getTeacherChoices(teachers, { mode = 'create', teacherId, visibleTeacherIds = [] } = {}) {
  // Demo teachers predate the live selectable flag and remain available.
  const choices = teachers.filter(teacher => teacher.selectable === true || teacher.selectable === undefined);
  if (mode === 'edit') {
    if (teacherId && !choices.some(teacher => teacher.id === teacherId)) {
      choices.push(teachers.find(teacher => teacher.id === teacherId)
        || { id: teacherId, name: 'Unavailable teacher', selectable: false });
    }
    return { choices, teacherId: teacherId || '' };
  }
  if (mode === 'duplicate') {
    return { choices, teacherId: choices.some(teacher => teacher.id === teacherId) ? teacherId : '' };
  }
  const visible = new Set(visibleTeacherIds);
  return { choices, teacherId: choices.find(teacher => visible.has(teacher.id))?.id || choices[0]?.id || '' };
}
