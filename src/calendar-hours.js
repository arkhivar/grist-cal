import { fromSchoolInput, shiftDate } from './domain.js';

export const BUSINESS_START = '08:00:00';
export const BUSINESS_END = '22:00:00';
const schoolInstant = (date, time) => Date.parse(fromSchoolInput(`${date}T${time}`));

/** Count already-filtered lessons against daily school-time display windows. */
export function getHourVisibility(lessons, { startDate, endDate, businessHoursOnly }) {
  const periodStart = schoolInstant(startDate, '00:00:00');
  const periodEnd = schoolInstant(endDate, '00:00:00');
  const windows = [];
  if (businessHoursOnly) {
    for (let date = startDate; date < endDate; date = shiftDate(date, 1)) {
      windows.push([schoolInstant(date, BUSINESS_START), schoolInstant(date, BUSINESS_END)]);
    }
  }
  const result = { total: 0, shown: 0, outside: 0, clipped: 0 };
  const seen = new Set();
  for (const lesson of lessons) {
    const start = Math.max(Date.parse(lesson.start), periodStart);
    const end = Math.min(Date.parse(lesson.end), periodEnd);
    const identity = lesson.id ?? lesson;
    if (!(start < end) || seen.has(identity)) continue;
    seen.add(identity);
    result.total += 1;
    if (!businessHoursOnly) { result.shown += 1; continue; }
    const visibleDuration = windows.reduce((sum, [windowStart, windowEnd]) =>
      sum + Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart)), 0);
    if (!visibleDuration) result.outside += 1;
    else {
      result.shown += 1;
      if (visibleDuration < end - start) result.clipped += 1;
    }
  }
  return result;
}
