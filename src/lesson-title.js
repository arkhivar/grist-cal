// Store only the editable text, so reference renames never freeze a student's/group's name.
// The versioned envelope lives in the existing Calendar_Title text column.
const TITLE_PREFIX = '@calendar-title/v1:';
export const TITLE_TEXT_LIMIT = 160;

function storedParts(raw) {
  if (!raw.startsWith(TITLE_PREFIX)) return null;
  try {
    const value = JSON.parse(raw.slice(TITLE_PREFIX.length));
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === 2 && typeof value.before === 'string' && typeof value.after === 'string'
      ? { before: value.before, after: value.after } : null;
  } catch { return null; }
}

export function parseLessonTitle(raw, automaticTitle, referenceTitle = automaticTitle) {
  const parts = storedParts(raw);
  if (parts) return parts;
  const legacy = raw.trim();
  if (!legacy) return { before: '', after: '' };
  for (const name of new Set([automaticTitle, referenceTitle])) {
    const at = name ? legacy.indexOf(name) : -1;
    if (at >= 0) return { before: legacy.slice(0, at), after: legacy.slice(at + name.length) };
  }
  // Keep older free-text titles visible alongside the now-fixed reference name.
  return { before: '', after: `· ${legacy}` };
}

export function encodeLessonTitle({ before, after }) {
  return before.trim() || after.trim() ? TITLE_PREFIX + JSON.stringify({ before, after }) : '';
}

function composeTitle({ before, after }, automaticTitle) {
  return [before.trim(), automaticTitle, after.trim()].filter(Boolean).join(' ');
}

export function renderLessonTitle(raw, automaticTitle, referenceTitle = automaticTitle) {
  return composeTitle(parseLessonTitle(raw, automaticTitle, referenceTitle), automaticTitle);
}

export function lessonTitleTextLength(raw) {
  const parts = storedParts(raw);
  return parts ? parts.before.length + parts.after.length : raw.trim().length;
}

export function createLessonTitleController({ automaticTitle, referenceTitle = automaticTitle, titleOverride = '', existing = false }) {
  let automatic = automaticTitle;
  let parts = parseLessonTitle(titleOverride, automatic, referenceTitle);
  const initial = { ...parts };
  const getState = () => ({ ...parts, automaticTitle: automatic, value: composeTitle(parts, automatic),
    textLength: parts.before.length + parts.after.length });
  return {
    getState,
    updateAutomatic(next) {
      automatic = next;
      return getState();
    },
    changeAffix(side, value) {
      if (!['before', 'after'].includes(side)) throw new Error('Choose text before or after the name.');
      parts = { ...parts, [side]: value };
      return getState();
    },
    // Untouched existing metadata is omitted, including older plain-text values.
    // Reverting an edit also restores the original dirty-draft state.
    submissionFields() {
      return existing && parts.before === initial.before && parts.after === initial.after
        ? {} : { title: encodeLessonTitle(parts) };
    },
  };
}
