const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
// SQL exposes stored RefLists as JSON integer arrays, while the records API uses ['L', ...ids].
// Only the reviewed reference columns are decoded: notes and names may themselves contain JSON text.
const REFERENCE_LIST_FIELDS = {
  ALL_ATT: new Set(['student', 'per', 'group2']),
  Calendar_Lessons: new Set(['Teacher', 'Group']),
};

function requestError(code, message, { status = 503, mayHaveMutated = false } = {}) {
  const error = new Error(message);
  Object.assign(error, { code, status, mayHaveMutated });
  return error;
}

function projectedValue(table, field, value) {
  if (!REFERENCE_LIST_FIELDS[table]?.has(field) || typeof value !== 'string') return value;
  let ids;
  try { ids = JSON.parse(value); } catch { /* Validated below without exposing the cell. */ }
  if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw requestError('GRIST_RESPONSE_INVALID', 'Grist returned an unreadable reference list.');
  }
  return ['L', ...ids];
}

/** Server-side only: never expose this client's credentials or upstream errors to a browser. */
export function createGristClient({ baseUrl, docId, apiKey, fetchImpl = fetch,
  timeoutMs = 15000, maxGetRetries = 2, sleepImpl = sleep } = {}) {
  let host;
  try { host = new URL(baseUrl); } catch { throw new Error('Configure a valid Grist server URL.'); }
  if (!['https:', 'http:'].includes(host.protocol) || host.username || host.password || host.search || host.hash ||
      typeof docId !== 'string' || !docId.trim() || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Configure a Grist server URL, document ID and API key.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxGetRetries) || maxGetRetries < 0 || maxGetRetries > 3) {
    throw new Error('Invalid Grist request timeout or retry limit.');
  }
  const prefix = `${host.href.replace(/\/$/, '')}/api/docs/${encodeURIComponent(docId)}`;

  async function request(method, endpoint, body) {
    method = String(method).toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || typeof endpoint !== 'string' ||
        !endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.includes('\\') ||
        endpoint.split('?')[0].split('/').includes('..')) {
      throw requestError('GRIST_REQUEST_INVALID', 'Invalid Grist request.', { status: 400 });
    }
    const readOnly = method === 'GET';
    const attempts = readOnly ? maxGetRetries + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let retryDelay = 150 * (2 ** attempt);
      let retryable = false;
      let failure;
      try {
        const response = await fetchImpl(prefix + endpoint, {
          method, redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          retryable = response.status === 429 || response.status >= 500;
          const retryAfter = Number(response.headers?.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0) retryDelay = Math.min(retryAfter * 1000, 1000);
          const denied = response.status === 401 || response.status === 403;
          failure = requestError(denied ? 'GRIST_ACCESS_DENIED' : 'GRIST_REQUEST_FAILED',
            denied ? 'The server could not access the Grist document. Check its connection settings.' :
              'Grist could not complete the request. Please try again.',
            { status: retryable ? 503 : 502, mayHaveMutated: !readOnly && (response.status >= 500 || response.status === 408) });
          // Upstream response bodies may contain private record values or connection details.
          await response.body?.cancel().catch(() => {});
        } else if (response.status === 204) {
          return null;
        } else {
          try { return await response.json(); }
          catch {
            failure = requestError('GRIST_RESPONSE_INVALID', 'Grist returned an unreadable response. Please refresh and try again.',
              { mayHaveMutated: !readOnly });
          }
        }
      } catch {
        retryable = true;
        failure = requestError(controller.signal.aborted ? 'GRIST_TIMEOUT' : 'GRIST_UNAVAILABLE',
          controller.signal.aborted ? 'The Grist request timed out. Please try again.' : 'Grist is temporarily unavailable. Please try again.',
          { mayHaveMutated: !readOnly });
      } finally { clearTimeout(timeout); }
      if (!retryable || attempt + 1 === attempts) throw failure;
      await sleepImpl(retryDelay);
    }
  }

  async function records(table, fields) {
    if (!IDENTIFIER.test(table) || !Array.isArray(fields) || !fields.length || fields.some(field => !IDENTIFIER.test(field))) {
      throw requestError('GRIST_REQUEST_INVALID', 'Explicit valid Grist field names are required.', { status: 400 });
    }
    const names = [...new Set(['id', ...fields])];
    const statement = `SELECT ${names.map(field => `"${field}"`).join(', ')} FROM "${table}"`;
    const response = await request('GET', `/sql?q=${encodeURIComponent(statement)}`);
    if (!Array.isArray(response?.records)) {
      throw requestError('GRIST_RESPONSE_INVALID', 'Grist returned an unreadable record list.');
    }
    return response.records.map(record => {
      const values = record.fields ?? record;
      const id = values.id ?? record.id;
      if (!Number.isSafeInteger(id) || id <= 0) throw requestError('GRIST_RESPONSE_INVALID', 'Grist returned an invalid record identifier.');
      return { id, fields: Object.fromEntries(names.filter(name => name !== 'id')
        .map(name => [name, projectedValue(table, name, values[name])])) };
    });
  }
  return { request, records };
}
