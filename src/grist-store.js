// The browser talks only to the local server. Grist credentials never cross this boundary.
const copy = value => structuredClone(value);

function failure(code, message, outcomeUnknown = false) {
  return Object.assign(new Error(message), { code, outcomeUnknown });
}

function checkSnapshot(value) {
  if (!value || !Array.isArray(value.lessons) || !Array.isArray(value.teachers) || !Array.isArray(value.attendance)) {
    throw failure('INVALID_RESPONSE', 'The server returned incomplete calendar data. Try refreshing.');
  }
  return value;
}

async function request(path, options = {}) {
  const writing = options.method === 'POST';
  const deleting = path === '/api/lessons/delete';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    let response;
    try {
      response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal });
    } catch {
      throw failure('NETWORK_ERROR', deleting
        ? 'The connection was interrupted. The deletion may have reached Grist. Retry the same deletion to check safely.' : writing
        ? 'The connection was interrupted. The save may have reached Grist. Retry the same changes to check safely.'
        : 'Could not reach the calendar server. Check the connection and try again.', writing);
    }
    let body;
    try { body = await response.json(); }
    catch {
      throw failure('INVALID_RESPONSE', deleting
        ? 'The deletion response could not be read. Retry the same deletion to check whether it reached Grist.' : writing
        ? 'The save response could not be read. Retry the same changes to check whether they reached Grist.'
        : 'The server response could not be read. Try again.', writing);
    }
    if (!response.ok) {
      const error = body?.error;
      throw failure(error?.code || `HTTP_${response.status}`,
        typeof error?.message === 'string' ? error.message : 'The calendar request failed. Please try again.',
        Boolean(error?.outcomeUnknown));
    }
    return body;
  } finally { clearTimeout(timeout); }
}

export async function readCalendarConfig() {
  const config = await request('/api/config');
  if (!['demo', 'grist'].includes(config?.mode)) {
    throw failure('INVALID_CONFIG', 'The calendar server has not supplied a valid data mode. Check its configuration and retry.');
  }
  if (config.mode === 'grist' && (typeof config.csrfToken !== 'string' || !config.csrfToken)) {
    throw failure('INVALID_CONFIG', 'The calendar connection could not be initialized. Restart the server and retry.');
  }
  return config;
}

// Canonical keys retain the mutation identity when the same draft is retried after a lost response.
function stableKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableKey(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function createGristStore({ csrfToken } = {}) {
  if (typeof csrfToken !== 'string' || !csrfToken) throw failure('INVALID_CONFIG', 'A calendar session token is required. Reload the page.');
  let snapshot = checkSnapshot(await request('/api/snapshot'));
  const subscribers = new Set();
  const pendingMutations = new Map();
  let queue = Promise.resolve();
  const getSnapshot = () => copy(snapshot);
  const publish = next => {
    snapshot = checkSnapshot(next);
    for (const callback of [...subscribers]) {
      // A renderer failure does not turn an acknowledged server write into a failed save.
      try { callback(getSnapshot()); }
      catch { console.error('Calendar view could not update after receiving server data.'); }
    }
  };
  const sequential = action => {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  };
  return {
    getSnapshot,
    subscribe(callback) {
      if (typeof callback !== 'function') throw new TypeError('A subscriber must be a function.');
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    refresh() {
      // Serializing refresh with saves prevents an earlier read from replacing an acknowledged write.
      return sequential(async () => {
        publish(await request('/api/snapshot'));
        return getSnapshot();
      });
    },
    saveLesson(draft, { expectedVersion } = {}) {
      const submitted = copy(draft);
      const key = stableKey({ draft: submitted, expectedVersion });
      const mutationId = pendingMutations.get(key) || crypto.randomUUID();
      pendingMutations.set(key, mutationId);
      return sequential(async () => {
        const result = await request('/api/lessons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Calendar-Token': csrfToken },
          body: JSON.stringify({ draft: submitted, expectedVersion, mutationId }),
        });
        if (!result?.lesson || typeof result.lesson.id !== 'string') {
          throw failure('INVALID_RESPONSE', 'The save could not be confirmed. Retry the same changes to check whether they reached Grist.', true);
        }
        if (result.snapshot === null && result.refreshWarning === true) {
          const next = getSnapshot();
          const index = next.lessons.findIndex(lesson => lesson.id === result.lesson.id);
          if (index === -1) next.lessons.push(copy(result.lesson));
          else next.lessons[index] = copy(result.lesson);
          publish(next);
        } else {
          try { checkSnapshot(result.snapshot); }
          catch { throw failure('INVALID_RESPONSE', 'The save reached the server, but its latest data could not be read. Retry the same changes to check safely.', true); }
          publish(result.snapshot);
        }
        pendingMutations.delete(key);
        return { ...copy(result.lesson), ...(result.refreshWarning ? { refreshWarning: true } : {}) };
      });
    },
    deleteLesson(id, { expectedVersion } = {}) {
      const key = stableKey({ operation: 'delete', id, expectedVersion });
      const mutationId = pendingMutations.get(key) || crypto.randomUUID();
      pendingMutations.set(key, mutationId);
      return sequential(async () => {
        const result = await request('/api/lessons/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Calendar-Token': csrfToken },
          body: JSON.stringify({ id, expectedVersion, mutationId }),
        });
        if (result?.lessonId !== id) {
          throw failure('INVALID_RESPONSE', 'The deletion could not be confirmed. Retry the same deletion to check safely.', true);
        }
        if (result.snapshot === null && result.refreshWarning === true) {
          const next = getSnapshot();
          next.lessons = next.lessons.filter(lesson => lesson.id !== id);
          publish(next);
        } else {
          try { checkSnapshot(result.snapshot); }
          catch { throw failure('INVALID_RESPONSE', 'The deletion reached the server, but its latest data could not be read. Retry the same deletion to check safely.', true); }
          if (result.snapshot.lessons.some(lesson => lesson.id === id)) {
            throw failure('INVALID_RESPONSE', 'The deletion response still contains the lesson. Refresh or retry the same deletion to check safely.', true);
          }
          publish(result.snapshot);
        }
        pendingMutations.delete(key);
        return { id, ...(result.refreshWarning ? { refreshWarning: true } : {}) };
      });
    },
  };
}
