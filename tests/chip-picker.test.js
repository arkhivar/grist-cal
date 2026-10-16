import test from 'node:test';
import assert from 'node:assert/strict';
import { createChipPicker } from '../src/chip-picker.js';

// This small event/element harness checks the controller contract, not browser
// layout, native focus behavior, or assistive-technology rendering.
class Element {
  constructor(document) {
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.classList = { toggle: (name, enabled) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      if (enabled) classes.add(name); else classes.delete(name);
      this.className = [...classes].join(' ');
    } };
  }
  append(...children) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  fire(type, extra = {}) {
    const event = { target: this, defaultPrevented: false, propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; }, ...extra };
    for (let current = this; current; current = current.parent) {
      for (const listener of current.listeners.get(type) || []) listener(event);
      if (event.propagationStopped) break;
    }
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; this.fire('focusin'); }
  scrollIntoView(options) { this.lastScroll = options; }
}

function setup() {
  const document = new Element();
  document.ownerDocument = document;
  document.createElement = () => new Element(document);
  const [panel, search, list, empty, status, teacher, subject, before, after] =
    Array.from({ length: 9 }, () => document.createElement());
  panel.hidden = true;
  search.id = 'lesson-picker-search';
  list.id = 'lesson-picker-options';
  panel.append(search, list, empty, status);
  document.append(panel, teacher, subject, before, after);
  const picker = createChipPicker({ panel, search, list, empty, status });
  const state = {
    selected: 'student:1', selections: [],
    catalog: [
      { key: 'student:1', name: 'Alex', kind: 'student', detail: 'Individual lesson' },
      { key: 'group:1', name: 'Alex', kind: 'group', detail: 'Group lesson' },
      { key: 'group:2', name: '<Group & friends>', kind: 'group' },
    ],
  };
  const options = {
    trigger: subject, label: 'student or group',
    getChoices: query => state.catalog.filter(choice => choice.name.toLowerCase().includes(query.toLowerCase())),
    getSelectedKey: () => state.selected,
    onSelect: choice => { state.selected = choice.key; state.selections.push(choice); },
    onTab: ({ backwards }) => (backwards ? before : after).focus(),
  };
  return { document, panel, search, list, empty, status, teacher, subject, before, after, picker, state, options };
}

test('opening focuses a searchable labelled list and keeps same-named students and groups distinct', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  assert.equal(ui.document.activeElement, ui.search);
  assert.equal(ui.subject.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.subject.getAttribute('aria-haspopup'), 'listbox');
  assert.equal(ui.search.getAttribute('aria-controls'), ui.list.id);
  assert.equal(ui.search.getAttribute('aria-label'), 'Search student or group');
  assert.equal(ui.search.getAttribute('aria-activedescendant'), ui.list.children[0].id);
  assert.equal(ui.list.children[0].getAttribute('aria-selected'), 'true');
  assert.equal(ui.list.children[0].children[1].textContent, 'Student · Individual lesson');
  assert.equal(ui.list.children[1].children[1].textContent, 'Group · Group lesson');
  assert.equal(ui.list.children[2].children[0].textContent, '<Group & friends>');
  assert.equal(ui.list.children[2].children[0].children.length, 0);
  ui.list.children[1].fire('click');
  assert.equal(ui.state.selected, 'group:1');
  assert.equal(ui.document.activeElement, ui.subject);
  assert.equal(ui.picker.isOpen(), false);
  ui.picker.open(ui.options);
  assert.equal(ui.search.getAttribute('aria-activedescendant'), ui.list.children[1].id);
  assert.deepEqual(ui.list.children[1].lastScroll, { block: 'nearest' });
});

test('keyboard navigation selects the active record and never submits the lesson form', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  const down = ui.search.fire('keydown', { key: 'ArrowDown' });
  assert.equal(down.defaultPrevented, true);
  assert.equal(ui.search.getAttribute('aria-activedescendant'), ui.list.children[1].id);
  assert.deepEqual(ui.list.children[1].lastScroll, { block: 'nearest' });
  ui.search.fire('keydown', { key: 'End' });
  assert.equal(ui.search.getAttribute('aria-activedescendant'), ui.list.children[2].id);
  ui.search.fire('keydown', { key: 'Home' });
  ui.search.fire('keydown', { key: 'ArrowUp' });
  assert.equal(ui.search.getAttribute('aria-activedescendant'), ui.list.children[0].id);
  ui.search.fire('keydown', { key: 'ArrowDown' });
  const enter = ui.search.fire('keydown', { key: 'Enter' });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(enter.propagationStopped, true);
  assert.equal(ui.state.selections[0].key, 'group:1');
  assert.equal(ui.picker.isOpen(), false);
});

test('search filters records, announces no matches, and ignores Enter with an empty list or composition', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  ui.search.value = 'friends';
  ui.search.fire('input');
  assert.equal(ui.list.children.length, 1);
  assert.equal(ui.status.textContent, '1 option available.');
  const composing = ui.search.fire('keydown', { key: 'Enter', isComposing: true });
  assert.equal(composing.defaultPrevented, true);
  assert.equal(ui.state.selections.length, 0);
  ui.search.value = 'No such person';
  ui.search.fire('input');
  assert.equal(ui.empty.hidden, false);
  assert.equal(ui.search.getAttribute('aria-activedescendant'), null);
  assert.equal(ui.status.textContent, 'No matching options.');
  assert.equal(ui.search.fire('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(ui.state.selections.length, 0);
  assert.equal(ui.picker.isOpen(), true);
});

test('Escape closes only the picker and Tab delegates focus without selecting', () => {
  const ui = setup();
  let editorEscapes = 0;
  ui.document.addEventListener('keydown', event => { if (event.key === 'Escape') editorEscapes++; });
  ui.picker.open(ui.options);
  const escape = ui.search.fire('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(editorEscapes, 0);
  assert.equal(ui.document.activeElement, ui.subject);
  assert.equal(ui.search.getAttribute('aria-activedescendant'), null);
  assert.equal(ui.subject.getAttribute('aria-expanded'), 'false');
  for (const backwards of [false, true]) {
    ui.picker.open(ui.options);
    const tab = ui.search.fire('keydown', { key: 'Tab', shiftKey: backwards });
    assert.equal(tab.defaultPrevented, true);
    assert.equal(ui.document.activeElement, backwards ? ui.before : ui.after);
    assert.equal(ui.picker.isOpen(), false);
  }
  assert.equal(ui.state.selections.length, 0);
});

test('same-trigger opening toggles closed, while switching chips resets query and expanded state', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  ui.picker.open(ui.options);
  assert.equal(ui.picker.isOpen(), false);
  assert.equal(ui.document.activeElement, ui.subject);
  ui.picker.open(ui.options);
  ui.search.value = 'Alex';
  ui.picker.open({ ...ui.options, trigger: ui.teacher, label: 'teacher' });
  assert.equal(ui.subject.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.teacher.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.search.value, '');
  assert.equal(ui.search.getAttribute('aria-label'), 'Search teacher');
});

test('pointer selection keeps search focus until choosing, and outside dismissal preserves destination focus', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  assert.equal(ui.list.children[1].fire('pointerdown').defaultPrevented, true);
  assert.equal(ui.document.activeElement, ui.search);
  ui.subject.fire('pointerdown');
  assert.equal(ui.picker.isOpen(), true);
  ui.after.focus();
  assert.equal(ui.picker.isOpen(), false);
  assert.equal(ui.document.activeElement, ui.after);
  ui.picker.open(ui.options);
  ui.before.fire('pointerdown');
  assert.equal(ui.picker.isOpen(), false);
  assert.equal(ui.state.selections.length, 0);
});

test('refresh preserves query and active identity across reordered catalogs', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  ui.search.value = 'Alex';
  ui.search.fire('input');
  ui.search.fire('keydown', { key: 'ArrowDown' });
  ui.state.catalog.reverse();
  ui.picker.refresh();
  assert.equal(ui.search.value, 'Alex');
  assert.equal(ui.search.getAttribute('aria-activedescendant'), ui.list.children[0].id);
  ui.search.fire('keydown', { key: 'Enter' });
  assert.equal(ui.state.selected, 'group:1');
});

test('selection rechecks the catalog and uses current data instead of a stale row object', () => {
  const ui = setup();
  ui.picker.open(ui.options);
  const staleRow = ui.list.children[1];
  ui.state.catalog = ui.state.catalog.filter(choice => choice.key !== 'group:1');
  staleRow.fire('click');
  assert.equal(ui.state.selections.length, 0);
  assert.equal(ui.picker.isOpen(), true);
  assert.match(ui.status.textContent, /no longer available/);
  ui.state.catalog[0] = { ...ui.state.catalog[0], name: 'Renamed student' };
  ui.list.children[0].fire('click');
  assert.equal(ui.state.selections[0].name, 'Renamed student');
});

test('a declined choice stays open, and a callback closing the editor keeps its destination focus', () => {
  const ui = setup();
  ui.picker.open({ ...ui.options, onSelect: () => false });
  ui.search.fire('keydown', { key: 'Enter' });
  assert.equal(ui.picker.isOpen(), true);
  ui.picker.close();
  ui.picker.open({ ...ui.options, onSelect: () => { ui.picker.close(); ui.after.focus(); } });
  ui.search.fire('keydown', { key: 'Enter' });
  assert.equal(ui.picker.isOpen(), false);
  assert.equal(ui.document.activeElement, ui.after);
});
