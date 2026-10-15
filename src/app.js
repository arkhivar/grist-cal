import { SCHOOL_TIME_ZONE, schoolToday, schoolInput, fromSchoolInput, formatSchoolTime, shiftDate, startOfWeek, selectCalendarLessons } from './domain.js';
import { createMemoryStore } from './memory-store.js';
import { createGristStore, readCalendarConfig } from './grist-store.js';
import { createDateContextIndex, dateContextFor, lessonDateDescription, setDateContextText, appendDateContextLabel } from './date-context.js';

const $ = (id) => document.getElementById(id);
const escape = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dayName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function showStartupFailure(error) {
  document.querySelector('.app-header').inert = true;
  $('sidebar').inert = true;
  $('connection-state').hidden = false;
  $('connection-state').dataset.state = 'error';
  $('connection-heading').textContent = 'Calendar could not connect';
  $('connection-message').textContent = error?.message || 'The calendar could not load. Try again.';
  $('connection-state').setAttribute('role', 'alert');
  $('retry-connection').hidden = false;
  $('retry-connection').onclick = () => location.reload();
  $('visible-count').textContent = 'Data unavailable';
  $('save-state-text').textContent = 'Connection failed';
  $('save-state').dataset.state = 'error';
  $('calendar-region').setAttribute('aria-busy', 'false');
}

async function start() {
  document.querySelector('.app-header').inert = true;
  $('sidebar').inert = true;
  $('calendar-region').setAttribute('aria-busy', 'true');
  if (!window.FullCalendar || !window.luxon) {
    throw new Error('Calendar assets could not load. Reload to try again.');
  }
  const config = await readCalendarConfig();
  const isLive = config.mode === 'grist';
  const sourceLabel = isLive ? (config.label || 'Grist sandbox') : 'Sample school';
  const readyText = isLive ? 'Connected to Grist' : 'Demo ready';
  document.body.dataset.mode = config.mode;
  document.title = `Grist Cal · ${isLive ? sourceLabel : 'Demo'}`;
  for (const id of ['mode-badge', 'context-mode', 'editor-mode']) $(id).textContent = isLive ? 'Live' : 'Demo';
  $('data-label').textContent = sourceLabel;
  $('data-description').textContent = isLive ? 'Lessons and attendance use ALL_ATT. Edits remain after reload.' : 'Fictional lessons. Changes last until you reset or reload.';
  $('mode-card').setAttribute('aria-label', isLive ? 'Grist connection and refresh' : 'Demo controls');
  $('reset-button').hidden = isLive;
  $('demo-tools').hidden = isLive;
  $('help-introduction').textContent = isLive
    ? `This calendar is connected to ${sourceLabel}. Creating, editing, moving and resizing lessons saves to Grist. Student attendance from ALL_ATT is shown read-only; scheduling does not mark attendance.`
    : 'This is your standalone school calendar demo. All lessons and students are fictional.';
  $('attendance-hint').textContent = isLive
    ? 'Read-only records from ALL_ATT. Recorded rows do not establish whether a student was present. Attendance stays linked when a lesson moves; scheduling does not mark attendance.'
    : 'Attendance stays linked when a lesson moves. Scheduling does not mark students present.';
  document.querySelector('.profile-avatar').setAttribute('aria-label', sourceLabel);
  let anchorDate = schoolToday();
  let requestedDate = new URLSearchParams(location.search).get('date');
  if (requestedDate) {
    try { fromSchoolInput(`${requestedDate}T12:00`); if (!isLive) anchorDate = requestedDate; }
    catch { requestedDate = null; }
  }
  $('connection-message').textContent = isLive ? 'Loading lessons and linked attendance from Grist…' : 'Preparing your fictional school schedule…';
  const store = isLive ? await createGristStore({ csrfToken: config.csrfToken }) : createMemoryStore({ anchorDate, delayMs: 450 });
  let snapshot = store.getSnapshot();
  let dateContexts = createDateContextIndex(snapshot.calendarDates);
  let dateContextVersion = JSON.stringify(snapshot.calendarDates || []);
  let selectedTeachers = new Set(snapshot.teachers.map(t => t.id));
  let includeNewTeachers = true;
  let focusedDate = requestedDate || anchorDate;
  let miniMonth = focusedDate.slice(0, 7);
  let currentStart = startOfWeek(focusedDate);
  let currentEnd = shiftDate(currentStart, 7);
  let calendar;
  let busy = false;
  let editor = null;
  let editorSaving = false;
  let refreshing = false;
  let toastTimer;
  let searchTimer;
  let editorOpener;
  let lessonMenu = null;
  let teacherMenu = null;
  const mobile = window.matchMedia('(max-width: 760px)');

  function notify(message, kind = 'success') {
    clearTimeout(toastTimer);
    $('toast-message').textContent = message;
    $('toast').dataset.kind = kind;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, kind === 'error' ? 10000 : 5500);
  }

  function setBusy(value) {
    busy = value;
    if (value) delete $('save-state').dataset.state;
    $('save-state-text').textContent = value ? 'Saving…' : readyText;
    $('save-state').classList.toggle('is-saving', value);
    $('save-lesson').disabled = value || refreshing;
    $('save-lesson').textContent = value && editorSaving ? 'Saving…' : 'Save lesson';
    $('close-editor').disabled = value;
    $('cancel-editor').disabled = value;
    $('refresh-button').disabled = value || refreshing;
    $('refresh-editor').disabled = value || refreshing;
    $('lesson-actions').disabled = value || refreshing;
    // Freeze form inputs during submission so a late keystroke cannot be silently lost.
    for (const input of $('lesson-form').querySelectorAll('input,select,textarea')) input.disabled = value;
    if (isLive && editor) syncLessonIdentity();
  }

  function armFailure() {
    if (!isLive && $('fail-next-save').checked) {
      store.failNextSave();
      $('fail-next-save').checked = false;
    }
  }

  function getVisibleLessons() {
    return selectCalendarLessons(snapshot, { teacherIds: selectedTeachers, search: $('search').value });
  }

  function eventData() {
    return getVisibleLessons().map(lesson => {
      const teacher = snapshot.teachers.find(t => t.id === lesson.teacherId) || { name: 'Unassigned', color: '#71717a' };
      return {
        id: lesson.id, title: lesson.title, start: lesson.start, end: lesson.end,
        backgroundColor: `${teacher.color}20`, borderColor: teacher.color,
        textColor: '#24304a', classNames: lesson.status === 'cancelled' ? ['lesson-cancelled'] : [],
        extendedProps: { ...lesson, teacherName: teacher.name, color: teacher.color },
      };
    });
  }

  function updateContext() {
    const startInstant = fromSchoolInput(`${currentStart}T00:00`);
    const endInstant = fromSchoolInput(`${currentEnd}T00:00`);
    const count = getVisibleLessons().filter(l => l.start < endInstant && l.end > startInstant).length;
    const filtered = selectedTeachers.size !== snapshot.teachers.length || $('search').value.trim();
    $('visible-count').textContent = `${count} ${count === 1 ? 'lesson' : 'lessons'}${filtered ? ' shown' : ''}`;
    $('empty-state').hidden = count > 0;
    const latestDate = latestLessonDate();
    $('empty-message').textContent = !selectedTeachers.size ? 'Select a teacher in the sidebar to see their lessons.' : $('search').value.trim() ? 'Try a different search or choose more teachers.' : isLive ? (latestDate ? 'There are no lessons in this period. Jump to the latest scheduled lesson or create one.' : 'Your Grist calendar has room. Create the first lesson.') : 'Your week has room. Create a lesson or return to the demo week.';
    $('clear-filters').textContent = filtered ? 'Clear filters' : isLive ? (latestDate ? 'Go to latest lesson' : 'Create a lesson') : 'Go to demo week';
    const unlinked = Number(snapshot.meta?.unlinkedAttendanceCount) || 0;
    $('attendance-link-note').hidden = !isLive || !unlinked;
    $('attendance-link-note').textContent = `${unlinked} ALL_ATT ${unlinked === 1 ? 'row is' : 'rows are'} not linked to a lesson yet.`;
  }

  function latestLessonDate() {
    if (snapshot.meta?.latestLessonDate) return snapshot.meta.latestLessonDate;
    const latest = snapshot.lessons.reduce((current, lesson) => !current || lesson.start > current ? lesson.start : current, null);
    return latest ? schoolToday(latest) : null;
  }

  function renderEvents() {
    if (!calendar) return;
    closeLessonMenu();
    calendar.batchRendering(() => {
      calendar.getEventSources().forEach(source => source.remove());
      calendar.addEventSource(eventData());
    });
    updateContext();
  }

  function renderTeachers() {
    const list = $('teacher-list');
    const focused = teacherMenu?.opener || (list.contains(document.activeElement) ? document.activeElement : null);
    const focusedId = focused?.dataset.teacherOptions ?? focused?.value;
    closeTeacherMenu();
    list.innerHTML = snapshot.teachers.map(teacher => `<div class="teacher-filter" style="--teacher-color:${escape(teacher.color || '#71717a')}"><label><input type="checkbox" value="${escape(teacher.id)}" ${selectedTeachers.has(teacher.id) ? 'checked' : ''} aria-label="Show ${escape(teacher.name)}"><span class="teacher-avatar" aria-hidden="true">${escape(teacher.initials || teacher.name.slice(0, 2))}</span><span class="teacher-name" title="${escape(teacher.name)}">${escape(teacher.name)}</span></label><button type="button" class="icon-button teacher-options" data-teacher-options="${escape(teacher.id)}" aria-label="Calendar options for ${escape(teacher.name)}" title="Calendar options for ${escape(teacher.name)}" aria-haspopup="menu" aria-controls="teacher-menu" aria-expanded="false"><svg class="icon" aria-hidden="true"><use href="#i-more"/></svg></button></div>`).join('');
    if (focused) {
      const replacement = [...list.querySelectorAll(focused.matches('button') ? 'button' : 'input')]
        .find(element => (element.dataset.teacherOptions ?? element.value) === focusedId);
      restoreMenuFocus(replacement || $('show-all-teachers'));
    }
  }

  function setTeacherVisibility(ids, includeNew = false) {
    closeTeacherMenu(true);
    selectedTeachers = new Set(ids);
    includeNewTeachers = includeNew;
    // Keep the sidebar controls in place so filtering does not lose keyboard focus.
    for (const checkbox of $('teacher-list').querySelectorAll('input')) checkbox.checked = selectedTeachers.has(checkbox.value);
    renderEvents();
  }

  function renderMini() {
    const first = `${miniMonth}-01`;
    $('mini-title').textContent = monthName.format(new Date(`${first}T12:00:00Z`));
    const firstCell = startOfWeek(first);
    const selectedWeek = startOfWeek(focusedDate);
    $('mini-calendar').innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(day => `<span class="mini-weekday" aria-hidden="true">${day}</span>`).join('') + Array.from({ length: 42 }, (_, i) => {
      const date = shiftDate(firstCell, i);
      const context = dateContextFor(dateContexts, date);
      const classes = ['mini-day', date.slice(0, 7) !== miniMonth ? 'outside' : '', date === anchorDate ? 'is-today' : '', date === focusedDate ? 'is-selected' : '', date >= selectedWeek && date < shiftDate(selectedWeek, 7) ? 'in-week' : '', context?.closed ? 'is-school-closed' : ''].filter(Boolean).join(' ');
      const label = `${dayName.format(new Date(`${date}T12:00:00Z`))}${context ? ` · ${context.description}` : ''}`;
      return `<button type="button" class="${classes}" data-date="${date}" aria-label="${escape(label)}" ${context ? `title="${escape(context.description)}"` : ''} ${date === focusedDate ? 'aria-pressed="true"' : 'aria-pressed="false"'} ${date === anchorDate ? 'aria-current="date"' : ''}>${Number(date.slice(8))}</button>`;
    }).join('');
  }

  function moveMiniMonth(amount) {
    const date = new Date(`${miniMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    miniMonth = date.toISOString().slice(0, 7);
    renderMini();
  }

  function closeMobileSidebar() {
    closeTeacherMenu(true);
    const focusWasInside = $('sidebar').contains(document.activeElement);
    document.body.classList.remove('sidebar-open');
    $('sidebar-backdrop').hidden = true;
    if (mobile.matches) {
      $('sidebar-toggle').setAttribute('aria-expanded', 'false');
      $('sidebar').inert = true;
      if (focusWasInside) $('sidebar-toggle').focus();
    }
  }

  function syncSidebar() {
    if (mobile.matches) closeMobileSidebar();
    else {
      document.body.classList.remove('sidebar-open');
      $('sidebar-backdrop').hidden = true;
      $('sidebar-toggle').setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-collapsed')));
      $('sidebar').inert = document.body.classList.contains('sidebar-collapsed');
    }
    requestAnimationFrame(() => calendar?.updateSize());
  }

  function confirmAction(title, message, label = 'Discard changes', cancelLabel) {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-yes').textContent = label;
    $('confirm-no').textContent = cancelLabel || (label === 'Reset demo' ? 'Keep my changes' : 'Keep editing');
    $('confirm-yes').classList.toggle('danger', label === 'Delete lesson');
    $('confirm-dialog').showModal();
    $('confirm-no').focus();
    return new Promise(resolve => {
      const finish = result => {
        $('confirm-dialog').close();
        $('confirm-yes').removeEventListener('click', yes);
        $('confirm-no').removeEventListener('click', no);
        $('confirm-dialog').removeEventListener('cancel', cancel);
        resolve(result);
      };
      const yes = () => finish(true);
      const no = () => finish(false);
      const cancel = event => { event.preventDefault(); finish(false); };
      $('confirm-yes').addEventListener('click', yes);
      $('confirm-no').addEventListener('click', no);
      $('confirm-dialog').addEventListener('cancel', cancel);
    });
  }

  function rawDraft() {
    const draft = Object.fromEntries(Array.from($('lesson-form').querySelectorAll('[name]'), input => [input.name, input.value]));
    if (isLive) {
      draft.lessonKind = $('lesson-kind').value;
      draft.studentIds = draft.lessonKind === 'individual' ? JSON.parse($('lesson-student').value || '[]') : [];
      draft.groupIds = draft.lessonKind === 'group' ? JSON.parse($('lesson-group-ref').value || '[]') : [];
    }
    return draft;
  }

  function referenceChoices(id, choices, selectedIds, placeholder) {
    const select = $(id);
    const selected = [...(selectedIds || [])].sort();
    const options = [{ ids: [], name: placeholder }, ...choices.map(item => ({ ids: [item.id], name: item.name }))];
    // Preserve existing combinations and missing references without silently substituting a person/group.
    if (selected.length && !options.some(option => JSON.stringify(option.ids) === JSON.stringify(selected))) {
      options.push({ ids: selected, name: selected.map(ref => choices.find(item => item.id === ref)?.name || ref).join(' + ') });
    }
    select.innerHTML = options.map(option => `<option value="${escape(JSON.stringify(option.ids))}">${escape(option.name)}</option>`).join('');
    select.value = JSON.stringify(selected);
  }

  function syncLessonIdentity() {
    if (!isLive) return;
    const individual = $('lesson-kind').value === 'individual';
    $('lesson-student-field').hidden = !individual;
    $('lesson-group-ref-field').hidden = individual;
    for (const id of ['lesson-kind', 'lesson-student', 'lesson-group-ref']) $(id).disabled = busy || Boolean(editor?.id);
    $('lesson-identity-hint').textContent = editor?.id
      ? 'The lesson type and student/group links are kept when editing. Scheduling changes do not mark attendance.'
      : individual ? 'Choose one student. Booking this lesson does not record attendance.' : 'Choose a group, or leave it unassigned. Attendance can be linked later.';
  }

  function isDirty() { return editor && JSON.stringify(rawDraft()) !== editor.initial; }

  function renderEditorDateContext() {
    setDateContextText($('lesson-date-context'), lessonDateDescription(dateContexts, $('lesson-start').value, $('lesson-end').value));
  }

  function closeEditor() {
    closeLessonMenu();
    $('lesson-dialog').close();
    editor = null;
    if (editorOpener?.isConnected && !editorOpener.closest('[inert]') && editorOpener.getClientRects().length) editorOpener.focus({ preventScroll: true });
    else $('sidebar-toggle').focus({ preventScroll: true });
  }

  async function requestCloseEditor() {
    if (busy) return;
    if (isDirty() && !await confirmAction('Discard unsaved changes?', 'Your saved lesson will stay as it is.')) return;
    closeEditor();
  }

  function renderAttendance(lessonId) {
    const records = snapshot.attendance.filter(row => row.type === 'attendance' && row.lessonId === lessonId);
    const distinctStudents = new Set(records.map(row => row.studentId).filter(Boolean)).size;
    $('attendance-count').textContent = isLive
      ? `${records.length} attendance ${records.length === 1 ? 'entry' : 'entries'}`
      : `${records.length} ${records.length === 1 ? 'student' : 'students'}`;
    $('attendance-count').title = `${distinctStudents} distinct linked ${distinctStudents === 1 ? 'student' : 'students'}. Multiple entries may share a source row or student.`;
    const statuses = { pending: 'Not marked', present: 'Present', absent: 'Absent', recorded: 'Recorded in ALL_ATT', excused: 'Excused', late: 'Late' };
    $('attendance-list').innerHTML = records.length ? records.map(row => {
      const name = row.studentName || 'Student not linked';
      const notes = typeof row.notes === 'string' ? row.notes : '';
      const source = row.sourceRowId != null ? `<span class="attendance-source">ALL_ATT row ${escape(row.sourceRowId)}</span>` : '';
      return `<div class="attendance-row"><span class="student-avatar" aria-hidden="true">${escape(name.split(' ').map(s => s[0]).slice(0, 2).join(''))}</span><div class="attendance-name">${escape(name)}${!row.studentId ? '<span class="attendance-note">Student link pending</span>' : ''}${source}${notes ? `<span class="attendance-note">${escape(notes)}</span>` : ''}</div><span class="attendance-status" data-status="${escape(row.status)}">${escape(statuses[row.status] || 'Not marked')}</span></div>`;
    }).join('') : `<div class="empty-attendance">${isLive ? 'No attendance has been recorded for this lesson yet. Saving a booking does not mark attendance.' : 'No student attendance entries yet. Saving this lesson creates its calendar record.'}</div>`;
  }

  function openEditor(lessonId, range = {}, duplicate) {
    if (busy || refreshing) return;
    closeLessonMenu();
    closeTeacherMenu(true);
    const existing = snapshot.lessons.find(lesson => lesson.id === lessonId);
    const day = range.date || focusedDate;
    const startTime = range.start || fromSchoolInput(`${day}T09:00`);
    const lesson = existing || duplicate || {
      title: '', teacherId: [...selectedTeachers][0] || snapshot.teachers[0]?.id || 'unassigned',
      group: '', start: startTime, end: range.end || new Date(new Date(startTime).getTime() + 3600000).toISOString(),
      room: '', participantText: '', checklist: '', status: 'scheduled', notes: '',
    };
    editorOpener = document.activeElement;
    $('editor-heading').textContent = duplicate ? 'Duplicate lesson' : existing ? 'Lesson details' : 'Create a lesson';
    $('editor-eyebrow').textContent = duplicate ? 'NEW COPY' : existing ? 'SCHOOL CALENDAR' : 'NEW LESSON';
    $('lesson-actions').hidden = !existing;
    $('editor-version').textContent = isLive ? 'Saves to Grist' : existing ? 'Changes stay in this demo' : 'One lesson · one calendar event';
    $('lesson-teacher').innerHTML = snapshot.teachers.map(t => `<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('');
    $('lesson-identity-fields').hidden = !isLive;
    document.querySelector('label[for="lesson-group"]').textContent = isLive ? 'Group label (optional)' : 'Group';
    if (isLive) {
      $('lesson-kind').value = lesson.lessonKind || 'group';
      referenceChoices('lesson-student', snapshot.students || [], lesson.studentIds, 'Choose a student');
      referenceChoices('lesson-group-ref', snapshot.groups || [], lesson.groupIds, 'Group not assigned');
    }
    for (const input of $('lesson-form').querySelectorAll('[name]')) {
      input.value = ['start', 'end'].includes(input.name) ? schoolInput(lesson[input.name]) : lesson[input.name] || '';
    }
    $('form-error').hidden = true;
    $('draft-notice').hidden = true;
    if (duplicate) {
      $('draft-notice').textContent = 'This is a new lesson. Change its date or details, then save. Attendance is not copied.';
      $('draft-notice').hidden = false;
    }
    renderAttendance(existing?.id);
    editor = { id: existing?.id, clientId: crypto.randomUUID(), version: existing?.version, initial: JSON.stringify(rawDraft()) };
    renderEditorDateContext();
    syncLessonIdentity();
    closeMobileSidebar();
    $('lesson-dialog').showModal();
    $('lesson-title').focus();
  }

  function restoreMenuFocus(target) {
    if (target?.isConnected && !target.closest('[inert]') && target.getClientRects().length) target.focus({ preventScroll: true });
    else $('sidebar-toggle').focus({ preventScroll: true });
  }

  function closeLessonMenu(restoreFocus = false) {
    if (!lessonMenu) return;
    const target = lessonMenu.opener;
    lessonMenu = null;
    $('lesson-menu').hidden = true;
    target?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) restoreMenuFocus(target);
  }

  function closeTeacherMenu(restoreFocus = false) {
    if (!teacherMenu) return;
    const { opener } = teacherMenu;
    teacherMenu = null;
    $('teacher-menu').hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    if (restoreFocus) restoreMenuFocus(opener);
  }

  function positionMenu(menu, opener, point) {
    const anchor = opener.getBoundingClientRect();
    const bounds = menu.getBoundingClientRect();
    const x = point?.x ?? anchor.right - bounds.width;
    const y = point?.y ?? anchor.bottom + 5;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  }

  function openTeacherMenu(opener) {
    const teacher = snapshot.teachers.find(item => item.id === opener.dataset.teacherOptions);
    if (!teacher) return;
    if (teacherMenu?.opener === opener) { closeTeacherMenu(true); return; }
    closeLessonMenu();
    closeTeacherMenu();
    teacherMenu = { id: teacher.id, opener };
    const menu = $('teacher-menu');
    menu.setAttribute('aria-label', `Calendar options for ${teacher.name}`);
    $('teacher-menu-title').textContent = teacher.name;
    opener.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    positionMenu(menu, opener);
    $('display-only-teacher').focus({ preventScroll: true });
  }

  function openLessonMenu(id, opener, point) {
    if (busy || refreshing || $('confirm-dialog').open) return;
    const lesson = snapshot.lessons.find(item => item.id === id);
    if (!lesson) return;
    closeTeacherMenu();
    closeLessonMenu();
    const menu = $('lesson-menu');
    // A menu opened from the modal must share its top layer and focus scope.
    ($('lesson-dialog').open ? $('lesson-dialog') : document.body).append(menu);
    lessonMenu = { lesson: structuredClone(lesson), opener };
    if (editor?.id === id) lessonMenu.lesson.version = editor.version;
    menu.setAttribute('aria-label', `Actions for ${lesson.title}`);
    $('lesson-menu-title').textContent = lesson.title;
    opener.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    positionMenu(menu, opener, point);
    $('duplicate-lesson').focus({ preventScroll: true });
  }

  async function duplicateLesson() {
    const target = lessonMenu;
    if (!target || busy || refreshing) return;
    closeLessonMenu(true);
    if (editor && isDirty() && !await confirmAction('Duplicate saved lesson?', 'Your unsaved edits will be discarded. The copy uses the saved lesson details.', 'Duplicate', 'Keep editing')) return;
    if (editor) closeEditor();
    const copy = { ...target.lesson, status: 'scheduled' };
    openEditor(null, {}, copy);
  }

  async function deleteLesson() {
    const target = lessonMenu;
    if (!target || busy || refreshing) return;
    closeLessonMenu(true);
    const message = `Remove “${target.lesson.title}” from the calendar? Its attendance records will be kept.${isDirty() ? ' Unsaved edits will be discarded.' : ''}`;
    if (!await confirmAction('Delete lesson?', message, 'Delete lesson', 'Keep lesson')) return;
    setBusy(true);
    armFailure();
    try {
      const result = await store.deleteLesson(target.lesson.id, { expectedVersion: target.lesson.version });
      if (editor?.id === target.lesson.id) closeEditor();
      else restoreMenuFocus(target.opener);
      notify(`Lesson deleted${isLive ? ' from the Grist calendar' : ''}. Attendance records were kept.${result.refreshWarning ? ' Other data could not refresh; use Refresh data when connected.' : ''}`);
    } catch (error) {
      const message = `${error.message}${error.outcomeUnknown ? ' Refresh to check, or retry deleting this same lesson.' : ''}`;
      if (editor?.id === target.lesson.id) { $('form-error').textContent = message; $('form-error').hidden = false; }
      notify(message, 'error');
    } finally { setBusy(false); restoreMenuFocus(target.opener); }
  }

  $('duplicate-lesson').addEventListener('click', () => { void duplicateLesson(); });
  $('delete-lesson').addEventListener('click', () => { void deleteLesson(); });
  $('lesson-actions').addEventListener('click', () => {
    if (lessonMenu) closeLessonMenu(true);
    else if (editor?.id) openLessonMenu(editor.id, $('lesson-actions'));
  });
  $('lesson-menu').addEventListener('keydown', event => {
    const items = [$('duplicate-lesson'), $('delete-lesson')];
    const current = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      items[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation(); closeLessonMenu(true);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (lessonMenu && !$('lesson-menu').contains(event.target) && !lessonMenu.opener.contains(event.target)) closeLessonMenu(true);
    if (teacherMenu && !$('teacher-menu').contains(event.target) && !teacherMenu.opener.contains(event.target)) closeTeacherMenu(true);
  });
  document.addEventListener('focusin', event => {
    if (teacherMenu && !$('teacher-menu').contains(event.target) && !teacherMenu.opener.contains(event.target)) closeTeacherMenu();
  });
  document.addEventListener('scroll', () => { closeLessonMenu(true); closeTeacherMenu(true); }, true);
  window.addEventListener('resize', () => { closeLessonMenu(true); closeTeacherMenu(true); });
  $('teacher-menu').addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      $('display-only-teacher').focus({ preventScroll: true });
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeTeacherMenu(true);
    } else if (event.key === 'Tab') {
      // Continue normal tab order from the menu's opener, including Shift+Tab.
      closeTeacherMenu(true);
    }
  });
  $('display-only-teacher').addEventListener('click', () => {
    if (teacherMenu) setTeacherVisibility([teacherMenu.id]);
  });

  async function saveEditor(event) {
    event.preventDefault();
    if (!editor || busy || refreshing) return;
    let submitted;
    try {
      const raw = rawDraft();
      submitted = { ...raw, type: 'lesson', ...(editor.id ? { id: editor.id } : isLive ? { clientId: editor.clientId } : {}), start: fromSchoolInput(raw.start), end: fromSchoolInput(raw.end) };
      if (!$('lesson-form').reportValidity()) return;
    } catch (error) {
      $('form-error').textContent = error.message;
      $('form-error').hidden = false;
      return;
    }
    const currentEditor = editor;
    editorSaving = true;
    setBusy(true);
    $('form-error').hidden = true;
    armFailure();
    try {
      const saved = await store.saveLesson(submitted, { expectedVersion: currentEditor.version });
      closeEditor();
      const hiddenByTeacher = !selectedTeachers.has(saved.teacherId);
      notify(`${currentEditor.id ? 'Lesson updated' : 'Lesson created'}. ${isLive ? 'Saved to Grist.' : 'Saved in this demo.'}${hiddenByTeacher ? ' Its teacher is currently hidden.' : ''}${saved.refreshWarning ? ' Other calendar data could not refresh; use Refresh data when connected.' : ''}`);
    } catch (error) {
      if (editor === currentEditor) {
        $('form-error').textContent = `${error.message}${error.outcomeUnknown ? ' Keep this draft and retry unchanged to safely confirm the save.' : ''}`;
        $('form-error').hidden = false;
      }
      notify(error.message, 'error');
    } finally {
      editorSaving = false;
      setBusy(false);
    }
  }

  async function saveCalendarChange(info, action) {
    if (busy || refreshing) { info.revert(); return; }
    const original = snapshot.lessons.find(l => l.id === info.event.id);
    if (!original) { info.revert(); return; }
    setBusy(true);
    armFailure();
    try {
      const saved = await store.saveLesson({ id: original.id, start: info.event.start.toISOString(), end: info.event.end.toISOString() }, { expectedVersion: original.version });
      notify(`Lesson ${action}${isLive ? ' in Grist' : ''}. Student attendance stayed linked.${saved.refreshWarning ? ' Other calendar data could not refresh; use Refresh data when connected.' : ''}`);
    } catch (error) {
      info.revert();
      renderEvents();
      if (isLive && error.outcomeUnknown) {
        try {
          await store.refresh();
          notify('The save response was interrupted. The calendar now shows the latest Grist data; check the lesson time before editing again.', 'error');
        } catch {
          notify('The save could not be confirmed and Grist could not refresh. The displayed time is the last known value; refresh to verify before editing again.', 'error');
        }
      } else notify(`${error.message}${isLive ? ' Refresh to check the latest Grist data.' : ' The original time has been restored.'}`, 'error');
    } finally { setBusy(false); }
  }

  function dateRenderHooks() {
    return {
      dayCellClassNames(info) {
        return dateContextFor(dateContexts, info.date)?.closed ? ['is-school-closed'] : [];
      },
      dayHeaderClassNames(info) {
        // Month headers describe recurring weekdays, not specific school dates.
        return info.view.type !== 'dayGridMonth' && dateContextFor(dateContexts, info.date)?.closed ? ['is-school-closed'] : [];
      },
      dayHeaderContent(info) {
        const date = schoolToday(info.date);
        const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIME_ZONE, weekday: 'short' }).format(info.date);
        const wrap = document.createElement('div');
        wrap.className = 'day-heading';
        const word = document.createElement('span'); word.className = 'day-name'; word.textContent = weekday;
        wrap.append(word);
        if (info.view.type !== 'dayGridMonth') {
          const number = document.createElement('span'); number.className = 'day-number'; number.textContent = Number(date.slice(8)); wrap.append(number);
          appendDateContextLabel(wrap, dateContextFor(dateContexts, date));
        }
        return { domNodes: [wrap] };
      },
      dayCellContent(info) {
        const context = dateContextFor(dateContexts, info.date);
        // FullCalendar v6 supports true to retain its default day-number rendering.
        if (info.view.type !== 'dayGridMonth' || !context) return true;
        const wrap = document.createElement('span'); wrap.className = 'date-registry-month-date';
        const number = document.createElement('span'); number.textContent = info.dayNumberText;
        wrap.append(number);
        appendDateContextLabel(wrap, context);
        return { domNodes: [wrap] };
      },
    };
  }

  calendar = new FullCalendar.Calendar($('calendar'), {
    initialView: mobile.matches ? 'timeGridDay' : 'timeGridWeek',
    initialDate: focusedDate,
    now: requestedDate && !isLive ? fromSchoolInput(`${anchorDate}T12:00`) : undefined,
    timeZone: SCHOOL_TIME_ZONE,
    locale: 'en-gb', firstDay: 1,
    headerToolbar: false, height: '100%',
    allDaySlot: false, slotMinTime: '00:00:00', slotMaxTime: '24:00:00', scrollTime: '08:00:00', scrollTimeReset: false,
    slotDuration: '00:30:00', slotLabelInterval: '01:00:00', snapDuration: '00:15:00',
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    editable: true, selectable: true, selectMirror: true, selectMinDistance: 4,
    eventAllow: () => !busy && !refreshing,
    selectAllow: () => !busy && !refreshing,
    eventMinHeight: 30, eventShortHeight: 42, dayMaxEvents: 3, nowIndicator: true,
    slotEventOverlap: false,
    eventResizableFromStart: false, eventDisplay: 'block',
    longPressDelay: 350, eventLongPressDelay: 350, selectLongPressDelay: 350,
    handleWindowResize: true,
    events: eventData(),
    ...dateRenderHooks(),
    datesSet(info) {
      closeLessonMenu();
      closeTeacherMenu(true);
      currentStart = info.startStr.slice(0, 10);
      currentEnd = info.endStr.slice(0, 10);
      $('view-title').textContent = info.view.title;
      $('view-select').value = info.view.type;
      if (calendar) focusedDate = schoolToday(calendar.getDate());
      miniMonth = focusedDate.slice(0, 7);
      renderMini();
      updateContext();
    },
    eventContent(info) {
      const lesson = info.event.extendedProps;
      const inner = document.createElement('div'); inner.className = 'event-inner';
      const time = document.createElement('div'); time.className = 'event-time';
      time.textContent = `${formatSchoolTime(info.event.start)} – ${formatSchoolTime(info.event.end)}`;
      const title = document.createElement('div'); title.className = 'event-title'; title.textContent = `${lesson.status === 'cancelled' ? 'Cancelled · ' : ''}${info.event.title || 'New lesson'}`;
      // Selection previews are temporary FullCalendar events without lesson metadata.
      const meta = document.createElement('div'); meta.className = 'event-meta'; meta.textContent = lesson.teacherName ? `${lesson.teacherName.split(' ')[0]} · ${lesson.room || lesson.group || 'Room to be confirmed'}` : '';
      inner.append(time, title, meta);
      return { domNodes: [inner] };
    },
    eventDidMount(info) {
      if (info.isMirror) return;
      info.el.dataset.lessonId = info.event.id;
      info.el.style.setProperty('--teacher-color', info.event.extendedProps.color);
      info.el.tabIndex = 0;
      info.el.setAttribute('role', 'button');
      info.el.setAttribute('aria-haspopup', 'menu');
      info.el.setAttribute('aria-expanded', 'false');
      info.el.setAttribute('aria-controls', 'lesson-menu');
      info.el.setAttribute('aria-label', `${info.event.title}, ${longDate.format(info.event.start)}, ${formatSchoolTime(info.event.start)} to ${formatSchoolTime(info.event.end)}, ${info.event.extendedProps.teacherName}${info.event.extendedProps.status === 'cancelled' ? ', cancelled' : ''}`);
      info.el.addEventListener('keydown', event => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault(); event.stopPropagation(); openLessonMenu(info.event.id, info.el);
        } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openEditor(info.event.id); }
      });
      info.el.addEventListener('contextmenu', event => {
        event.preventDefault(); event.stopPropagation();
        openLessonMenu(info.event.id, info.el, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
      });
    },
    eventClick(info) { info.jsEvent.preventDefault(); openEditor(info.event.id); },
    dateClick(info) {
      if (info.allDay) openEditor(null, { date: info.dateStr.slice(0, 10) });
      else openEditor(null, { start: info.date.toISOString() });
    },
    select(info) {
      calendar.unselect();
      if (info.allDay) openEditor(null, { date: info.startStr.slice(0, 10) });
      else openEditor(null, { start: info.start.toISOString(), end: info.end.toISOString() });
    },
    eventDrop(info) { void saveCalendarChange(info, 'moved'); },
    eventResize(info) { void saveCalendarChange(info, 'resized'); },
    noEventsContent: 'No lessons in this period. Create one or choose another date.',
  });

  function acceptSnapshot(next) {
    snapshot = next;
    const nextDateVersion = JSON.stringify(snapshot.calendarDates || []);
    if (nextDateVersion !== dateContextVersion) {
      dateContextVersion = nextDateVersion;
      dateContexts = createDateContextIndex(snapshot.calendarDates);
      // New hook identities make v6 rerender both cell classes and custom date content.
      calendar.batchRendering(() => {
        for (const [option, value] of Object.entries(dateRenderHooks())) calendar.setOption(option, value);
      });
      renderMini();
    }
    if (editor) renderEditorDateContext();
    selectedTeachers = new Set(snapshot.teachers.filter(teacher => includeNewTeachers || selectedTeachers.has(teacher.id)).map(teacher => teacher.id));
    renderTeachers();
    if (editor?.id && !editorSaving) {
      const current = snapshot.lessons.find(l => l.id === editor.id);
      renderAttendance(editor.id);
      if (!current || current.version !== editor.version) {
        $('draft-notice').textContent = 'Saved data changed. Your draft has been kept; reopen the lesson before saving again.';
        $('draft-notice').hidden = false;
      }
    }
    renderEvents();
  }
  store.subscribe(acceptSnapshot);

  $('brand-day').textContent = Number(anchorDate.slice(8));
  renderTeachers();
  calendar.render();
  $('connection-state').hidden = true;
  $('calendar-region').setAttribute('aria-busy', 'false');
  document.querySelector('.app-header').inert = false;
  $('save-state-text').textContent = readyText;
  syncSidebar();
  $('teacher-list').addEventListener('change', event => {
    const checkbox = event.target.closest('input');
    if (!checkbox) return;
    if (checkbox.checked) selectedTeachers.add(checkbox.value); else selectedTeachers.delete(checkbox.value);
    includeNewTeachers = selectedTeachers.size === snapshot.teachers.length;
    renderEvents();
  });
  $('teacher-list').addEventListener('click', event => {
    const opener = event.target.closest('[data-teacher-options]');
    if (opener) openTeacherMenu(opener);
  });
  $('teacher-list').addEventListener('keydown', event => {
    const opener = event.target.closest('[data-teacher-options]');
    if (opener && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); openTeacherMenu(opener);
    }
  });
  $('hide-all-teachers').addEventListener('click', () => setTeacherVisibility([]));
  $('show-all-teachers').addEventListener('click', () => {
    setTeacherVisibility(snapshot.teachers.map(t => t.id), true);
  });
  $('mini-previous').addEventListener('click', () => moveMiniMonth(-1));
  $('mini-next').addEventListener('click', () => moveMiniMonth(1));
  $('mini-calendar').addEventListener('click', event => {
    const button = event.target.closest('[data-date]');
    if (!button) return;
    focusedDate = button.dataset.date; calendar.gotoDate(focusedDate); renderMini(); closeMobileSidebar();
  });
  $('today-button').addEventListener('click', () => { focusedDate = anchorDate; calendar.gotoDate(anchorDate); });
  $('previous-button').addEventListener('click', () => calendar.prev());
  $('next-button').addEventListener('click', () => calendar.next());
  $('view-select').addEventListener('change', () => calendar.changeView($('view-select').value));
  $('create-button').addEventListener('click', () => openEditor());
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderEvents, 100); });
  $('clear-filters').addEventListener('click', () => {
    const filtered = selectedTeachers.size !== snapshot.teachers.length || $('search').value.trim();
    $('search').value = ''; selectedTeachers = new Set(snapshot.teachers.map(t => t.id));
    includeNewTeachers = true;
    renderTeachers();
    if (!isLive) calendar.gotoDate(anchorDate);
    else if (!filtered) {
      const latest = latestLessonDate();
      if (latest) calendar.gotoDate(latest);
      else openEditor();
    }
    renderEvents();
  });
  $('sidebar-toggle').addEventListener('click', () => {
    closeTeacherMenu(true);
    if (mobile.matches) {
      const open = document.body.classList.toggle('sidebar-open');
      $('sidebar-backdrop').hidden = !open;
      $('sidebar').inert = !open;
      $('sidebar-toggle').setAttribute('aria-expanded', String(open));
    } else {
      document.body.classList.toggle('sidebar-collapsed');
      $('sidebar').inert = document.body.classList.contains('sidebar-collapsed');
      $('sidebar-toggle').setAttribute('aria-expanded', String(!document.body.classList.contains('sidebar-collapsed')));
      requestAnimationFrame(() => calendar.updateSize());
    }
  });
  $('sidebar-backdrop').addEventListener('click', closeMobileSidebar);
  mobile.addEventListener('change', syncSidebar);
  $('lesson-form').addEventListener('submit', saveEditor);
  $('lesson-kind').addEventListener('change', syncLessonIdentity);
  $('lesson-start').addEventListener('input', renderEditorDateContext);
  $('lesson-end').addEventListener('input', renderEditorDateContext);
  $('close-editor').addEventListener('click', requestCloseEditor);
  $('cancel-editor').addEventListener('click', requestCloseEditor);
  $('lesson-dialog').addEventListener('cancel', event => { event.preventDefault(); void requestCloseEditor(); });
  async function refreshData() {
    if (busy || refreshing) return;
    closeLessonMenu(true);
    refreshing = true;
    $('refresh-button').disabled = true;
    $('refresh-editor').disabled = true;
    $('save-lesson').disabled = true;
    $('lesson-actions').disabled = true;
    $('save-state-text').textContent = 'Refreshing…';
    $('save-state').classList.add('is-saving');
    delete $('save-state').dataset.state;
    try {
      const next = await store.refresh();
      if (!isLive) acceptSnapshot(next);
      if (editor) {
        renderAttendance(editor.id);
        const current = snapshot.lessons.find(l => l.id === editor.id);
        const changed = editor.id && (!current || current.version !== editor.version);
        $('draft-notice').textContent = changed ? 'Saved data changed. Your draft has been kept; reopen the lesson before saving again.' : 'Data refreshed. Your lesson draft has been kept.';
        $('draft-notice').hidden = false;
      }
      $('save-state-text').textContent = readyText;
      notify(editor ? 'Data refreshed. Your lesson draft has been kept.' : isLive ? 'Latest Grist data loaded.' : 'Demo data refreshed.');
    } catch (error) {
      $('save-state-text').textContent = 'Refresh failed';
      $('save-state').dataset.state = 'error';
      if (editor) {
        $('draft-notice').textContent = 'Refresh failed. Your lesson draft has been kept; try refreshing again when connected.';
        $('draft-notice').hidden = false;
      }
      notify(error.message, 'error');
    } finally {
      refreshing = false;
      $('refresh-button').disabled = busy;
      $('refresh-editor').disabled = busy;
      $('save-lesson').disabled = busy;
      $('lesson-actions').disabled = busy;
      $('save-state').classList.remove('is-saving');
    }
  }
  $('refresh-button').addEventListener('click', refreshData);
  $('refresh-editor').addEventListener('click', refreshData);
  $('reset-button').addEventListener('click', async () => {
    if (isLive || busy) return;
    if (!await confirmAction('Reset the demo?', 'Restore all sample lessons and discard changes made in this tab.', 'Reset demo')) return;
    store.reset();
    if (editor) closeEditor();
    $('fail-next-save').checked = false;
    $('search').value = '';
    selectedTeachers = new Set(snapshot.teachers.map(t => t.id));
    includeNewTeachers = true;
    renderTeachers(); calendar.gotoDate(anchorDate); renderEvents();
    notify('Demo reset. The sample week is ready.');
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-done').addEventListener('click', () => $('help-dialog').close());
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
  document.addEventListener('keydown', event => {
    if (lessonMenu || teacherMenu) return;
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) { closeMobileSidebar(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); openEditor(); }
    else if (event.key.toLowerCase() === 't') calendar.gotoDate(anchorDate);
    else if (event.key === '/') { event.preventDefault(); $('search').focus(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); calendar.prev(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); calendar.next(); }
  });
  window.addEventListener('beforeunload', event => {
    if (isDirty() || busy) { event.preventDefault(); event.returnValue = ''; }
  });
}

document.addEventListener('DOMContentLoaded', () => { start().catch(showStartupFailure); }, { once: true });
