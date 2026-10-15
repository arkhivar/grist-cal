import { fromSchoolInput, schoolToday, shiftDate } from './domain.js';

const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const text = value => typeof value === 'string' ? value.trim() : '';
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return shiftDate(value, 0) === value; } catch { return false; }
};

/** DateRegistry describes school dates; weekend/holiday labels never imply closure. */
export function createDateContextIndex(calendarDates = []) {
  const index = new Map();
  const ambiguous = new Set();
  for (const entry of Array.isArray(calendarDates) ? calendarDates : []) {
    if (!entry || !validDate(entry.date) || ambiguous.has(entry.date)) continue;
    if (index.has(entry.date)) {
      index.delete(entry.date);
      ambiguous.add(entry.date);
      continue;
    }
    const schoolDay = ['teaching', 'closed'].includes(entry.schoolDay) ? entry.schoolDay : 'unspecified';
    const holidayName = text(entry.holidayName);
    const academicTerm = text(entry.academicTerm);
    const description = [schoolDay === 'closed' ? 'Closed day' : schoolDay === 'teaching' ? 'Teaching day' : 'School day not specified',
      holidayName, academicTerm ? `Term: ${academicTerm}` : ''].filter(Boolean).join(' · ');
    index.set(entry.date, {
      date: entry.date, schoolDay, closed: schoolDay === 'closed', holidayName, academicTerm,
      label: schoolDay === 'closed' ? 'Closed' : holidayName,
      description,
    });
  }
  return index;
}

export function dateContextFor(index, dateOrInstant) {
  if (typeof dateOrInstant !== 'string' && !(dateOrInstant instanceof Date)) return null;
  let date;
  try {
    date = validDate(dateOrInstant) ? dateOrInstant : schoolToday(dateOrInstant);
  } catch { return null; }
  return index.get(date) || null;
}

/** datetime-local inputs are school wall time, and an end at midnight is exclusive. */
export function lessonDateDescription(index, startInput, endInput) {
  let start, end;
  try {
    start = fromSchoolInput(startInput);
    end = fromSchoolInput(endInput);
  } catch { return ''; }
  if (end <= start) return '';
  const firstDate = schoolToday(start);
  const lastDate = schoolToday(new Date(new Date(end).getTime() - 1));
  return [...index.values()].filter(context => context.date >= firstDate && context.date <= lastDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(context => `${dateLabel.format(new Date(`${context.date}T12:00:00Z`))}: ${context.description}`)
    .join('; ');
}

/** Keep registry labels in text nodes, including when Grist contains HTML-like text. */
export function setDateContextText(element, description) {
  // Do not repeatedly announce identical context while a user adjusts only the lesson time.
  if (element.textContent !== description) element.textContent = description;
  element.hidden = !description;
}

export function appendDateContextLabel(container, context, documentImpl = document) {
  if (!context) return;
  container.title = context.description;
  if (context.label) {
    const label = documentImpl.createElement('span');
    label.className = 'date-registry-day-label';
    label.textContent = context.label;
    label.setAttribute('aria-hidden', 'true');
    container.append(label);
  }
  const accessible = documentImpl.createElement('span');
  accessible.className = 'date-registry-description';
  accessible.textContent = ` · ${context.description}`;
  container.append(accessible);
}
