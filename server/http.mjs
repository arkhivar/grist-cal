import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const allowed = ['/index.html', '/src/', '/vendor/'];
const statusByCode = { VALIDATION_ERROR: 400, VERSION_CONFLICT: 409, NOT_FOUND: 404, GRIST_AUTH: 502, SCHEMA_ERROR: 503, SAVE_UNCERTAIN: 503, DELETE_UNCERTAIN: 503 };
const publicErrors = new Set(['VALIDATION_ERROR', 'VERSION_CONFLICT', 'NOT_FOUND', 'SCHEMA_ERROR', 'SAVE_UNCERTAIN', 'SAVE_FAILED', 'DELETE_UNCERTAIN', 'DELETE_FAILED', 'GRIST_ACCESS_DENIED', 'GRIST_REQUEST_FAILED', 'GRIST_RESPONSE_INVALID', 'GRIST_TIMEOUT', 'GRIST_UNAVAILABLE', 'GRIST_REQUEST_INVALID']);
const fail = (code, message) => Object.assign(new Error(message), { code });

function sameToken(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function readJson(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw fail('VALIDATION_ERROR', 'Send JSON lesson data.');
  let length = 0;
  const parts = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 32768) throw fail('VALIDATION_ERROR', 'The lesson request is too large.');
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw fail('VALIDATION_ERROR', 'The lesson request is not valid JSON.'); }
}

export function createCalendarServer({ root, store = null }) {
  const csrfToken = randomBytes(32).toString('hex');
  let snapshotRequest = null;
  let writeTail = Promise.resolve();
  function snapshot() {
    if (!snapshotRequest) {
      const pending = store.getSnapshot().finally(() => { if (snapshotRequest === pending) snapshotRequest = null; });
      snapshotRequest = pending;
    }
    return snapshotRequest;
  }
  const server = createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    };
    const json = (status, data) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const text = (status, body = '') => { res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(body); };
    try {
      const port = server.address()?.port;
      const validHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!validHosts.includes(req.headers.host)) return text(403, 'Local access only');
      const origin = `http://${req.headers.host}`;
      const url = new URL(req.url, origin);
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return text(403, 'Same-origin access required');
        if (pathname === '/api/config' && req.method === 'GET') return json(200, { mode: store ? 'grist' : 'demo', label: store ? 'Grist sandbox' : 'Sample school', csrfToken: store ? csrfToken : null });
        if (!store) return json(404, { error: { code: 'NOT_CONNECTED', message: 'This server is running the local demo.' } });
        if (pathname === '/api/snapshot' && req.method === 'GET') return json(200, await snapshot());
        if (['/api/lessons', '/api/lessons/delete'].includes(pathname) && req.method === 'POST') {
          if (!sameToken(req.headers['x-calendar-token'], csrfToken)) return text(403, 'Reload the calendar before saving');
          const body = await readJson(req);
          const deleting = pathname === '/api/lessons/delete';
          if (!body || typeof body !== 'object' || Array.isArray(body) || (deleting ? typeof body.id !== 'string' : !body.draft)) {
            throw fail('VALIDATION_ERROR', deleting ? 'Supply a lesson identifier.' : 'Supply a lesson draft.');
          }
          const save = writeTail.then(async () => {
            const options = { expectedVersion: body.expectedVersion, mutationId: body.mutationId };
            const saved = deleting ? await store.deleteLesson(body.id, options) : await store.saveLesson(body.draft, options);
            const result = deleting ? { lessonId: saved.id } : { lesson: saved };
            snapshotRequest = null;
            // A committed write remains successful even when a subsequent read fails.
            try { return { ...result, snapshot: await store.getSnapshot() }; }
            catch { return { ...result, snapshot: null, refreshWarning: true }; }
          });
          writeTail = save.catch(() => {});
          return json(200, await save);
        }
        return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'This calendar operation is not available.' } });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return text(405);
      const requested = pathname === '/' ? '/index.html' : pathname;
      if (requested.includes('\\') || requested.split('/').some(p => p.startsWith('.')) || !allowed.some(p => p.endsWith('/') ? requested.startsWith(p) : requested === p)) return text(404, 'Not found');
      const filename = path.resolve(root, '.' + requested);
      if (!filename.startsWith(path.resolve(root) + path.sep) || !(await stat(filename)).isFile()) return text(404, 'Not found');
      const data = await readFile(filename);
      res.writeHead(200, { ...headers, 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (req.url?.startsWith('/api/')) {
        const known = publicErrors.has(error.code);
        const status = statusByCode[error.code] || (known && [400, 404, 409, 502, 503].includes(error.status) ? error.status : 502);
        return json(status, { error: { code: known ? error.code : 'CONNECTION_ERROR', message: known ? error.message : 'Could not reach Grist. Try refreshing the calendar.', ...(error.outcomeUnknown ? { outcomeUnknown: true } : {}) } });
      }
      text(404, 'Not found');
    }
  });
  return server;
}
