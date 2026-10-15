import { fromSchoolInput, schoolInput } from './domain.js';

export const DURATION_PRESETS = Object.freeze([40, 60, 80]);

/** Editor inputs are Vladivostok wall times; duration arithmetic uses explicit UTC instants. */
export function durationMinutes(startInput, endInput) {
  try {
    const minutes = (Date.parse(fromSchoolInput(endInput)) - Date.parse(fromSchoolInput(startInput))) / 60000;
    return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
  } catch { return null; }
}

export function endForDuration(startInput, minutes) {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) throw new RangeError('Choose a positive whole-minute duration.');
  const start = Date.parse(fromSchoolInput(startInput));
  const end = schoolInput(new Date(start + minutes * 60000));
  // Reject an out-of-range result rather than writing a value the editor cannot round-trip.
  fromSchoolInput(end);
  return end;
}

/** This controller owns only unsaved editor times, never store data or an extra duration field. */
export function createDurationController(startInput, endInput) {
  let start = startInput;
  let end = endInput;
  let minutes = durationMinutes(start, end);
  let customSelected = false;

  const getState = () => ({
    start, end, minutes,
    selection: !customSelected && DURATION_PRESETS.includes(minutes) ? String(minutes) : 'custom',
    customLabel: minutes === null ? 'Custom (edit end time)' : `Custom (${minutes} min)`,
  });

  function applyDuration() {
    if (minutes === null) return;
    // A datetime-local control can be temporarily empty during typing. Keep the end
    // and chosen duration until the user supplies a complete, valid start again.
    try { end = endForDuration(start, minutes); } catch { /* Save validation remains authoritative. */ }
  }

  return {
    getState,
    changeStart(value) {
      start = value;
      if (minutes === null) minutes = durationMinutes(start, end);
      else applyDuration();
      return getState();
    },
    changeEnd(value) {
      end = value;
      minutes = durationMinutes(start, end);
      customSelected = false;
      return getState();
    },
    selectDuration(value) {
      if (value === 'custom') customSelected = true;
      else {
        if (!DURATION_PRESETS.some(preset => String(preset) === String(value))) {
          throw new RangeError('Choose a supported duration preset.');
        }
        minutes = Number(value);
        customSelected = false;
        applyDuration();
      }
      return getState();
    },
  };
}
