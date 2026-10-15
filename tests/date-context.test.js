import test from 'node:test';
import assert from 'node:assert/strict';
import { createDateContextIndex, dateContextFor, lessonDateDescription, setDateContextText, appendDateContextLabel } from '../src/date-context.js';

const registryDate = (date, extra = {}) => ({ id: 'date:1', date, day: 'Wednesday', dayParity: 'even',
  monthParity: 'even', isWeekend: false, schoolDay: 'unspecified', holidayName: '', academicTerm: '', ...extra });

test('only an explicit closed school day is shaded; weekends and holidays alone do not imply closure', () => {
  const index = createDateContextIndex([
    registryDate('2026-10-17', { isWeekend: true, holidayName: 'School celebration', academicTerm: 'Autumn' }),
    registryDate('2026-10-18', { isWeekend: true, schoolDay: 'teaching' }),
    registryDate('2026-10-19', { schoolDay: 'closed', holidayName: 'Autumn break' }),
  ]);
  assert.equal(dateContextFor(index, '2026-10-17').closed, false);
  assert.equal(dateContextFor(index, '2026-10-18').closed, false);
  assert.equal(dateContextFor(index, '2026-10-19').closed, true);
  assert.equal(dateContextFor(index, '2026-10-17').description, 'School day not specified · School celebration · Term: Autumn');
  assert.equal(dateContextFor(index, '2026-10-18').description, 'Teaching day');
  assert.equal(dateContextFor(index, '2026-10-19').label, 'Closed');
});

test('unknown school-day states remain unspecified without discarding descriptive metadata', () => {
  const index = createDateContextIndex([registryDate('2026-10-14', {
    schoolDay: 'maybe closed', holidayName: '  Open day  ', academicTerm: ' Term 1 ',
  })]);
  assert.deepEqual(dateContextFor(index, '2026-10-14'), {
    date: '2026-10-14', schoolDay: 'unspecified', closed: false, holidayName: 'Open day', academicTerm: 'Term 1',
    label: 'Open day', description: 'School day not specified · Open day · Term: Term 1',
  });
});

test('invalid and duplicate registry dates never choose an arbitrary closure state', () => {
  const index = createDateContextIndex([registryDate('2026-02-30', { schoolDay: 'closed' }),
    registryDate('2026-10-14', { schoolDay: 'closed' }), registryDate('2026-10-14', { schoolDay: 'teaching' }),
    registryDate('2026-10-14', { schoolDay: 'closed' }), null, registryDate('2026-10-15')]);
  assert.equal(index.size, 1);
  assert.equal(dateContextFor(index, '2026-10-14'), null);
  assert.equal(dateContextFor(index, '2026-02-30'), null);
  for (const value of [undefined, null, '', '2026-10-15T08:00', new Date(NaN)]) assert.equal(dateContextFor(index, value), null);
});

test('instant lookup changes date at Vladivostok midnight regardless of the device timezone', () => {
  const index = createDateContextIndex([registryDate('2026-10-14'), registryDate('2026-10-15', { schoolDay: 'closed' })]);
  const originalTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = timezone;
      assert.equal(dateContextFor(index, '2026-10-14T13:59:59.999Z').date, '2026-10-14');
      assert.equal(dateContextFor(index, '2026-10-14T14:00:00.000Z').date, '2026-10-15');
      assert.equal(dateContextFor(index, new Date('2026-10-14T14:00:00.000Z')).closed, true);
      assert.equal(dateContextFor(index, '2026-10-15T00:00:00+10:00').date, '2026-10-15');
    }
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('editor context treats inputs as school time and a lesson ending at midnight does not include the next date', () => {
  const index = createDateContextIndex([registryDate('2026-10-14', { schoolDay: 'teaching', academicTerm: 'Autumn' }),
    registryDate('2026-10-15', { schoolDay: 'closed', holidayName: 'Break' })]);
  assert.equal(lessonDateDescription(index, '2026-10-14T23:00', '2026-10-15T00:00'), '14 Oct: Teaching day · Term: Autumn');
  assert.equal(lessonDateDescription(index, '2026-10-14T23:00', '2026-10-15T00:01'),
    '14 Oct: Teaching day · Term: Autumn; 15 Oct: Closed day · Break');
  assert.equal(lessonDateDescription(index, '2026-10-15T09:00', '2026-10-15T10:00'), '15 Oct: Closed day · Break');
  assert.equal(lessonDateDescription(index, '2026-10-15T09:00', '2026-10-15T08:00'), '');
  assert.equal(lessonDateDescription(index, '', '2026-10-15T10:00'), '');
});

test('missing registry data leaves the demo unchanged and refreshed metadata replaces old context', () => {
  const empty = createDateContextIndex();
  assert.equal(dateContextFor(empty, '2026-10-14'), null);
  assert.equal(lessonDateDescription(empty, '2026-10-14T09:00', '2026-10-14T10:00'), '');
  const original = registryDate('2026-10-14', { schoolDay: 'closed' });
  const oldIndex = createDateContextIndex([original]);
  const refreshed = createDateContextIndex([{ ...original, schoolDay: 'teaching' }]);
  assert.equal(dateContextFor(oldIndex, '2026-10-14').closed, true);
  assert.equal(dateContextFor(refreshed, '2026-10-14').closed, false);
  assert.equal(original.schoolDay, 'closed');
});

test('holiday and term content is written only into text nodes, never interpreted as markup', () => {
  const malicious = '<img src=x onerror="alert(1)"> & <script>alert(2)</script>';
  const context = dateContextFor(createDateContextIndex([registryDate('2026-10-14', {
    holidayName: malicious, academicTerm: '" onclick="alert(3)',
  })]), '2026-10-14');
  const element = () => ({ textContent: '', hidden: true, children: [], attributes: {},
    set innerHTML(value) { assert.fail(`HTML assignment attempted: ${value}`); },
    append(child) { this.children.push(child); }, setAttribute(name, value) { this.attributes[name] = value; },
  });
  const output = element();
  setDateContextText(output, context.description);
  assert.equal(output.textContent, context.description);
  assert.equal(output.hidden, false);
  assert.deepEqual(output.children, []);
  const container = element();
  appendDateContextLabel(container, context, { createElement(tag) { assert.equal(tag, 'span'); return element(); } });
  assert.equal(container.children.length, 2);
  assert.equal(container.children[0].textContent, malicious);
  assert.equal(container.children[0].attributes['aria-hidden'], 'true');
  assert.equal(container.children[1].textContent, ` · ${context.description}`);
  assert.equal(container.title, context.description);
  setDateContextText(output, '');
  assert.equal(output.hidden, true);
});

test('unchanged editor context does not retrigger the live region while time fields change', () => {
  let text = '';
  let updates = 0;
  const element = { hidden: true, get textContent() { return text; },
    set textContent(value) { text = value; updates += 1; } };
  setDateContextText(element, '14 Oct: Teaching day');
  setDateContextText(element, '14 Oct: Teaching day');
  assert.equal(updates, 1);
  assert.equal(element.hidden, false);
  setDateContextText(element, '15 Oct: Closed day');
  assert.equal(updates, 2);
});
