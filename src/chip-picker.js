// One searchable popup is shared by the teacher and student/group title chips.
// Choices are obtained again at selection time because the catalog can refresh
// while an editor is open.
export function createChipPicker({ panel, search, list, empty, status }) {
  const document = panel.ownerDocument;
  let session = null;
  let choices = [];
  let rows = [];
  let activeKey = null;

  function setActive(key, scroll = false) {
    activeKey = key;
    search.removeAttribute('aria-activedescendant');
    rows.forEach(({ choice, element }) => {
      const active = choice.key === key;
      element.classList.toggle('is-active', active);
      if (active) {
        search.setAttribute('aria-activedescendant', element.id);
        if (scroll) element.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function close(restoreFocus = false) {
    const previous = session;
    session = null;
    activeKey = null;
    search.removeAttribute('aria-activedescendant');
    search.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    if (!previous) return;
    previous.trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) previous.trigger.focus();
  }

  function choose(key) {
    if (!session) return;
    const currentSession = session;
    const choice = currentSession.getChoices(search.value).find(item => item.key === key);
    if (!choice) {
      refresh();
      status.textContent = 'This option is no longer available. Choose another option.';
      return;
    }
    if (currentSession.onSelect(choice) === false) {
      if (session === currentSession) refresh();
      return;
    }
    // A selection callback may already have closed the editor or opened a
    // different picker. Do not steal focus from its next action.
    if (session === currentSession) close(true);
  }

  function render(preserveActive) {
    if (!session) return;
    const previousKey = preserveActive ? activeKey : null;
    choices = session.getChoices(search.value);
    const selectedKey = session.getSelectedKey();
    search.removeAttribute('aria-activedescendant');
    rows = choices.map((choice, index) => {
      const element = document.createElement('div');
      element.id = `${list.id}-option-${index}`;
      element.className = 'chip-picker-option';
      element.setAttribute('role', 'option');
      element.setAttribute('aria-selected', String(choice.key === selectedKey));
      const name = document.createElement('span');
      name.className = 'chip-picker-option-name';
      name.textContent = choice.name;
      const detail = document.createElement('span');
      detail.className = 'chip-picker-option-detail';
      const kind = choice.kind ? choice.kind[0].toUpperCase() + choice.kind.slice(1) : '';
      detail.textContent = [kind, choice.detail].filter(Boolean).join(' · ');
      element.append(name, detail);
      // Keep DOM focus in the combobox so the active descendant and keyboard
      // navigation continue to work when an option is selected with a pointer.
      element.addEventListener('pointerdown', event => event.preventDefault());
      element.addEventListener('click', () => choose(choice.key));
      return { choice, element };
    });
    list.replaceChildren(...rows.map(row => row.element));
    empty.hidden = choices.length !== 0;
    status.textContent = choices.length === 0 ? 'No matching options.'
      : `${choices.length} ${choices.length === 1 ? 'option' : 'options'} available.`;
    const nextKey = [previousKey, selectedKey].find(key => choices.some(choice => choice.key === key))
      ?? choices[0]?.key ?? null;
    setActive(nextKey, true);
  }

  function refresh() { render(true); }

  function open(options) {
    if (session?.trigger === options.trigger) {
      close(true);
      return;
    }
    close();
    session = options;
    const { trigger, label } = options;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-controls', list.id);
    trigger.setAttribute('aria-expanded', 'true');
    list.setAttribute('aria-label', label);
    search.setAttribute('aria-label', `Search ${label}`);
    search.setAttribute('aria-controls', list.id);
    search.setAttribute('aria-autocomplete', 'list');
    search.setAttribute('aria-expanded', 'true');
    search.value = '';
    panel.hidden = false;
    render(false);
    search.focus();
  }

  search.addEventListener('input', () => render(false));
  panel.addEventListener('keydown', event => {
    if (!session) return;
    if (event.isComposing) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      const onTab = session.onTab;
      if (onTab) {
        event.preventDefault();
        event.stopPropagation();
      }
      close();
      onTab?.({ backwards: event.shiftKey });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (activeKey !== null) choose(activeKey);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!choices.length) return;
      const index = choices.findIndex(choice => choice.key === activeKey);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : event.key === 'ArrowDown' ? Math.min(index + 1, choices.length - 1)
          : Math.max(index - 1, 0);
      setActive(choices[nextIndex].key, true);
    }
  });

  function dismissOutside(event) {
    if (session && !panel.contains(event.target) && !session.trigger.contains(event.target)) close();
  }
  document.addEventListener('pointerdown', dismissOutside);
  document.addEventListener('focusin', dismissOutside);

  return { open, close, refresh, isOpen: () => session !== null };
}
