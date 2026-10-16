function canonicalIds(ids = []) {
  return [...new Set(ids)].sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
}

function catalogMap(items) {
  // Catalogs are normalized by the adapter. Copy them so a refreshed snapshot or
  // a caller changing a returned choice cannot change an unsaved selection.
  return new Map(items.map(item => [item.id, { id: item.id, name: item.name }]));
}

function choiceName(id, catalog, kind) {
  return catalog.get(id)?.name || `${kind === 'student' ? 'Student' : 'Group'} #${id.split(':')[1]}`;
}

export function createLessonIdentityController({ lesson = {}, existing = false, students = [], groups = [] } = {}) {
  let studentCatalog = catalogMap(students);
  let groupCatalog = catalogMap(groups);
  let lessonKind = lesson.lessonKind || 'group';
  let studentIds = canonicalIds(lesson.studentIds);
  let groupIds = canonicalIds(lesson.groupIds);
  const initialIdentity = { lessonKind, studentIds: [...studentIds], groupIds: [...groupIds] };
  const selectionKind = existing ? (lessonKind === 'individual' ? 'student' : 'group') : null;

  const identityFields = () => ({ lessonKind, studentIds: [...studentIds], groupIds: [...groupIds] });
  const hasChanges = () => lessonKind !== initialIdentity.lessonKind ||
    studentIds.length !== initialIdentity.studentIds.length ||
    studentIds.some((id, index) => id !== initialIdentity.studentIds[index]) ||
    groupIds.length !== initialIdentity.groupIds.length ||
    groupIds.some((id, index) => id !== initialIdentity.groupIds[index]);
  // Omit unchanged references on saved lessons, including historical assignments
  // missing from the current catalogs. A name refresh is never an identity edit.
  const submissionFields = () => existing && !hasChanges() ? {} : identityFields();
  const getState = () => {
    const individual = lessonKind === 'individual';
    const ids = individual ? studentIds : groupIds;
    const catalog = individual ? studentCatalog : groupCatalog;
    const kind = individual ? 'student' : 'group';
    const referenceTitle = ids.map(id => choiceName(id, catalog, kind)).join(individual ? ', ' : ' · ') ||
      (individual ? 'Student not assigned' : 'Group not assigned');
    let selectionKey = null;
    if (individual && studentIds.length === 1 && groupIds.length === 0) selectionKey = studentIds[0];
    if (!individual && studentIds.length === 0 && groupIds.length <= 1) selectionKey = groupIds[0] || 'group:none';
    return { ...identityFields(), referenceTitle, selectionKey, selectionKind, locked: false, changed: hasChanges() };
  };

  return {
    getState,
    getChoices(query = '') {
      const choices = selectionKind === 'student' ? [] :
        [{ id: 'group:none', key: 'group:none', name: 'Group not assigned', kind: 'group', detail: 'Group lesson' }];
      for (const [kind, catalog] of [['student', studentCatalog], ['group', groupCatalog]]) {
        if (selectionKind && kind !== selectionKind) continue;
        choices.push(...[...catalog.values()]
          .sort((a, b) => a.name.localeCompare(b.name) || Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]))
          .map(({ id }) => ({ id, key: id, name: choiceName(id, catalog, kind), kind,
            detail: kind === 'student' ? 'Individual lesson' : 'Group lesson' })));
      }
      const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      return choices.filter(choice => {
        const searchable = `${choice.name} ${choice.kind} ${choice.detail}`.toLocaleLowerCase();
        return terms.every(term => searchable.includes(term));
      });
    },
    select(key) {
      const nextKind = key === 'group:none' || groupCatalog.has(key) ? 'group' : studentCatalog.has(key) ? 'student' : null;
      if (!nextKind) throw new Error('Choose an existing student or group.');
      if (selectionKind && nextKind !== selectionKind) {
        throw new Error(`Choose an existing ${selectionKind}; the saved lesson type cannot be changed.`);
      }
      if (key === 'group:none') {
        lessonKind = 'group';
        studentIds = [];
        groupIds = [];
      } else if (studentCatalog.has(key)) {
        lessonKind = 'individual';
        studentIds = [key];
        groupIds = [];
      } else if (groupCatalog.has(key)) {
        lessonKind = 'group';
        studentIds = [];
        groupIds = [key];
      } else {
        throw new Error('Choose an existing student or group.');
      }
      return getState();
    },
    updateCatalogs({ students: nextStudents, groups: nextGroups }) {
      if (nextStudents) studentCatalog = catalogMap(nextStudents);
      if (nextGroups) groupCatalog = catalogMap(nextGroups);
      return getState();
    },
    hasChanges,
    submissionFields,
  };
}
