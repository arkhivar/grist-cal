import { SCHOOL_TIME_ZONE, schoolToday, schoolInput, fromSchoolInput, formatSchoolTime, shiftDate, startOfWeek, selectCalendarLessons } from './domain.js';
import { createMemoryStore } from './memory-store.js';

const $ = (id) => document.getElementById(id);
const escape = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });
const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const dayName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function start() {
  if (!window.FullCalendar || !window.luxon) {
    $('visible-count').textContent = 'Calendar assets could not load. Reload to try again.';
    return;
  }
  let anchorDate = schoolToday();
  const requestedDate = new URLSearchParams(location.search).get('date');
  if (requestedDate) {
    try { fromSchoolInput(`${requestedDate}T12:00`); anchorDate = requestedDate; } catch { /* Ignore invalid demo date overrides. */ }
  }
  const store = createMemoryStore({ anchorDate, delayMs: 450 });
  let snapshot = store.getSnapshot();
  let selectedTeachers = new Set(snapshot.teachers.map(t => t.id));
  let miniMonth = anchorDate.slice(0, 7);
  let focusedDate = anchorDate;
  let currentStart = startOfWeek(anchorDate);
  let currentEnd = shiftDate(currentStart, 7);
  let calendar;
  let busy = false;
  let editor = null;
  let editorSaving = false;
  let toastTimer;
  let searchTimer;
  let editorOpener;
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
    $('save-state-text').textContent = value ? 'Saving…' : 'Demo ready';
    $('save-state').classList.toggle('is-saving', value);
    $('save-lesson').disabled = value;
    $('save-lesson').textContent = value && editorSaving ? 'Saving…' : 'Save lesson';
    $('close-editor').disabled = value;
    $('cancel-editor').disabled = value;
    // Freeze form inputs during submission so a late keystroke cannot be silently lost.
    for (const input of $('lesson-form').querySelectorAll('input,select,textarea')) input.disabled = value;
  }

  function armFailure() {
    if ($('fail-next-save').checked) {
      store.failNextSave();
      $('fail-next-save').checked = false;
    }
  }

  function getVisibleLessons() {
    return selectCalendarLessons(snapshot, { teacherIds: selectedTeachers, search: $('search').value });
  }

  function eventData() {
    return getVisibleLessons().map(lesson => {
      const teacher = snapshot.teachers.find(t => t.id === lesson.teacherId);
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
    $('empty-message').textContent = !selectedTeachers.size ? 'Select a teacher in the sidebar to see their lessons.' : $('search').value.trim() ? 'Try a different search or choose more teachers.' : 'Your week has room. Create a lesson or return to the demo week.';
    $('clear-filters').textContent = filtered ? 'Clear filters' : 'Go to demo week';
  }

  function renderEvents() {
    if (!calendar) return;
    calendar.batchRendering(() => {
      calendar.getEventSources().forEach(source => source.remove());
      calendar.addEventSource(eventData());
    });
    updateContext();
  }

  function renderTeachers() {
    $('teacher-list').innerHTML = snapshot.teachers.map(teacher => `<label class="teacher-filter" style="--teacher-color:${teacher.color}"><input type="checkbox" value="${teacher.id}" ${selectedTeachers.has(teacher.id) ? 'checked' : ''} aria-label="Show ${escape(teacher.name)}"><span class="teacher-avatar" aria-hidden="true">${escape(teacher.initials)}</span><span class="teacher-name">${escape(teacher.name)}</span></label>`).join('');
  }

  function renderMini() {
    const first = `${miniMonth}-01`;
    $('mini-title').textContent = monthName.format(new Date(`${first}T12:00:00Z`));
    const firstCell = startOfWeek(first);
    const selectedWeek = startOfWeek(focusedDate);
    $('mini-calendar').innerHTML = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(day => `<span class="mini-weekday" aria-hidden="true">${day}</span>`).join('') + Array.from({ length: 42 }, (_, i) => {
      const date = shiftDate(firstCell, i);
      const classes = ['mini-day', date.slice(0, 7) !== miniMonth ? 'outside' : '', date === anchorDate ? 'is-today' : '', date === focusedDate ? 'is-selected' : '', date >= selectedWeek && date < shiftDate(selectedWeek, 7) ? 'in-week' : ''].filter(Boolean).join(' ');
      const label = dayName.format(new Date(`${date}T12:00:00Z`));
      return `<button type="button" class="${classes}" data-date="${date}" aria-label="${escape(label)}" ${date === focusedDate ? 'aria-pressed="true"' : 'aria-pressed="false"'} ${date === anchorDate ? 'aria-current="date"' : ''}>${Number(date.slice(8))}</button>`;
    }).join('');
  }

  function moveMiniMonth(amount) {
    const date = new Date(`${miniMonth}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    miniMonth = date.toISOString().slice(0, 7);
    renderMini();
  }

  function closeMobileSidebar() {
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

  function confirmAction(title, message, label = 'Discard changes') {
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-yes').textContent = label;
    $('confirm-no').textContent = label === 'Reset demo' ? 'Keep my changes' : 'Keep editing';
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
    return Object.fromEntries(Array.from($('lesson-form').querySelectorAll('[name]'), input => [input.name, input.value]));
  }

  function isDirty() { return editor && JSON.stringify(rawDraft()) !== editor.initial; }

  function closeEditor() {
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
    $('attendance-count').textContent = `${records.length} ${records.length === 1 ? 'student' : 'students'}`;
    $('attendance-list').innerHTML = records.length ? records.map(row => `<div class="attendance-row"><span class="student-avatar" aria-hidden="true">${escape(row.studentName.split(' ').map(s => s[0]).slice(0, 2).join(''))}</span><div class="attendance-name">${escape(row.studentName)}${!row.studentId ? '<span class="attendance-note">Student link pending</span>' : ''}</div><span class="attendance-status" data-status="${escape(row.status)}">${row.status === 'pending' ? 'Not marked' : row.status === 'present' ? 'Present' : 'Absent'}</span></div>`).join('') : '<div class="empty-attendance">No student attendance entries yet. Saving this lesson creates its calendar record.</div>';
  }

  function openEditor(lessonId, range = {}) {
    if (busy) return;
    const existing = snapshot.lessons.find(lesson => lesson.id === lessonId);
    const day = range.date || focusedDate;
    const startTime = range.start || fromSchoolInput(`${day}T09:00`);
    const lesson = existing || {
      title: '', teacherId: [...selectedTeachers][0] || snapshot.teachers[0].id,
      group: '', start: startTime, end: range.end || new Date(new Date(startTime).getTime() + 3600000).toISOString(),
      room: '', participantText: '', checklist: '', status: 'scheduled', notes: '',
    };
    editorOpener = document.activeElement;
    $('editor-heading').textContent = existing ? 'Lesson details' : 'Create a lesson';
    $('editor-eyebrow').textContent = existing ? 'SCHOOL CALENDAR' : 'NEW LESSON';
    $('editor-version').textContent = existing ? 'Changes stay in this demo' : 'One lesson · one calendar event';
    $('lesson-teacher').innerHTML = snapshot.teachers.map(t => `<option value="${t.id}">${escape(t.name)}</option>`).join('');
    for (const input of $('lesson-form').querySelectorAll('[name]')) {
      input.value = ['start', 'end'].includes(input.name) ? schoolInput(lesson[input.name]) : lesson[input.name] || '';
    }
    $('form-error').hidden = true;
    $('draft-notice').hidden = true;
    renderAttendance(existing?.id);
    editor = { id: existing?.id, version: existing?.version, initial: JSON.stringify(rawDraft()) };
    closeMobileSidebar();
    $('lesson-dialog').showModal();
    $('lesson-title').focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editor || busy) return;
    let submitted;
    try {
      const raw = rawDraft();
      submitted = { ...raw, type: 'lesson', ...(editor.id ? { id: editor.id } : {}), start: fromSchoolInput(raw.start), end: fromSchoolInput(raw.end) };
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
      notify(`${currentEditor.id ? 'Lesson updated' : 'Lesson created'}${hiddenByTeacher ? '. Its teacher is currently hidden.' : '. Saved in this demo.'}`);
    } catch (error) {
      if (editor === currentEditor) {
        $('form-error').textContent = error.message;
        $('form-error').hidden = false;
      }
      notify(error.message, 'error');
    } finally {
      editorSaving = false;
      setBusy(false);
    }
  }

  async function saveCalendarChange(info, action) {
    if (busy) { info.revert(); return; }
    const original = snapshot.lessons.find(l => l.id === info.event.id);
    if (!original) { info.revert(); return; }
    setBusy(true);
    armFailure();
    try {
      await store.saveLesson({ id: original.id, start: info.event.start.toISOString(), end: info.event.end.toISOString() }, { expectedVersion: original.version });
      notify(`Lesson ${action}. Student attendance stayed linked.`);
    } catch (error) {
      info.revert();
      renderEvents();
      notify(`${error.message} The original time has been restored.`, 'error');
    } finally { setBusy(false); }
  }

  calendar = new FullCalendar.Calendar($('calendar'), {
    initialView: mobile.matches ? 'timeGridDay' : 'timeGridWeek',
    initialDate: anchorDate,
    now: requestedDate ? fromSchoolInput(`${anchorDate}T12:00`) : undefined,
    timeZone: SCHOOL_TIME_ZONE,
    locale: 'en-gb', firstDay: 1,
    headerToolbar: false, height: '100%',
    allDaySlot: false, slotMinTime: '00:00:00', slotMaxTime: '24:00:00', scrollTime: '08:00:00', scrollTimeReset: false,
    slotDuration: '00:30:00', slotLabelInterval: '01:00:00', snapDuration: '00:15:00',
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    editable: true, selectable: true, selectMirror: true, selectMinDistance: 4,
    eventAllow: () => !busy,
    selectAllow: () => !busy,
    eventMinHeight: 30, eventShortHeight: 42, dayMaxEvents: 3, nowIndicator: true,
    eventResizableFromStart: false, eventDisplay: 'block',
    longPressDelay: 350, eventLongPressDelay: 350, selectLongPressDelay: 350,
    handleWindowResize: true,
    events: eventData(),
    dayHeaderContent(info) {
      const date = schoolToday(info.date);
      const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIME_ZONE, weekday: 'short' }).format(info.date);
      const wrap = document.createElement('div');
      wrap.className = 'day-heading';
      const word = document.createElement('span'); word.className = 'day-name'; word.textContent = weekday;
      wrap.append(word);
      if (info.view.type !== 'dayGridMonth') {
        const number = document.createElement('span'); number.className = 'day-number'; number.textContent = Number(date.slice(8)); wrap.append(number);
      }
      return { domNodes: [wrap] };
    },
    datesSet(info) {
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
      info.el.setAttribute('aria-label', `${info.event.title}, ${longDate.format(info.event.start)}, ${formatSchoolTime(info.event.start)} to ${formatSchoolTime(info.event.end)}, ${info.event.extendedProps.teacherName}${info.event.extendedProps.status === 'cancelled' ? ', cancelled' : ''}`);
      info.el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openEditor(info.event.id); }
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

  store.subscribe(next => {
    snapshot = next;
    if (editor?.id && !editorSaving) {
      const current = snapshot.lessons.find(l => l.id === editor.id);
      renderAttendance(editor.id);
      if (!current || current.version !== editor.version) {
        $('draft-notice').textContent = 'Saved data changed. Your draft has been kept; reopen the lesson before saving again.';
        $('draft-notice').hidden = false;
      }
    }
    renderEvents();
  });

  $('brand-day').textContent = Number(anchorDate.slice(8));
  renderTeachers();
  calendar.render();
  syncSidebar();
  $('teacher-list').addEventListener('change', event => {
    const checkbox = event.target.closest('input');
    if (!checkbox) return;
    if (checkbox.checked) selectedTeachers.add(checkbox.value); else selectedTeachers.delete(checkbox.value);
    renderEvents();
  });
  $('show-all-teachers').addEventListener('click', () => {
    selectedTeachers = new Set(snapshot.teachers.map(t => t.id)); renderTeachers(); renderEvents();
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
    $('search').value = ''; selectedTeachers = new Set(snapshot.teachers.map(t => t.id));
    renderTeachers(); calendar.gotoDate(anchorDate); renderEvents();
  });
  $('sidebar-toggle').addEventListener('click', () => {
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
  $('close-editor').addEventListener('click', requestCloseEditor);
  $('cancel-editor').addEventListener('click', requestCloseEditor);
  $('lesson-dialog').addEventListener('cancel', event => { event.preventDefault(); void requestCloseEditor(); });
  async function refreshData() {
    snapshot = await store.refresh(); renderEvents();
    if (editor) {
      renderAttendance(editor.id);
      const current = snapshot.lessons.find(l => l.id === editor.id);
      const changed = editor.id && (!current || current.version !== editor.version);
      $('draft-notice').textContent = changed ? 'Saved data changed. Your draft has been kept; reopen the lesson before saving again.' : 'Data refreshed. Your lesson draft has been kept.';
      $('draft-notice').hidden = false;
    }
    notify(editor ? 'Data refreshed. Your lesson draft has been kept.' : 'Demo data refreshed.');
  }
  $('refresh-button').addEventListener('click', refreshData);
  $('refresh-editor').addEventListener('click', refreshData);
  $('reset-button').addEventListener('click', async () => {
    if (!await confirmAction('Reset the demo?', 'Restore all sample lessons and discard changes made in this tab.', 'Reset demo')) return;
    store.reset();
    if (editor) closeEditor();
    $('fail-next-save').checked = false;
    $('search').value = '';
    selectedTeachers = new Set(snapshot.teachers.map(t => t.id));
    renderTeachers(); calendar.gotoDate(anchorDate); renderEvents();
    notify('Demo reset. The sample week is ready.');
  });
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-done').addEventListener('click', () => $('help-dialog').close());
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
  document.addEventListener('keydown', event => {
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

document.addEventListener('DOMContentLoaded', start, { once: true });
