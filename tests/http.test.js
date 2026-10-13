import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createCalendarServer } from '../server/http.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function withServer(store, fn) {
  const server = createCalendarServer({ root, store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('live API rejects foreign origins, host rebinding and missing write tokens', async () => {
  let writes = 0;
  const store = { getSnapshot: async () => ({ teachers: [], lessons: [], attendance: [] }), saveLesson: async () => { writes++; return { id: 'grist:1' }; } };
  await withServer(store, async origin => {
    const config = await (await fetch(`${origin}/api/config`)).json();
    assert.equal(config.mode, 'grist');
    assert.ok(config.csrfToken.length >= 64);
    assert.deepEqual(Object.keys(config).sort(), ['csrfToken', 'label', 'mode']);
    for (const headers of [{ Origin: 'https://example.com' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await fetch(`${origin}/api/snapshot`, { headers })).status, 403);
    }
    const forgedHost = await new Promise((resolve, reject) => {
      const req = request(`${origin}/api/config`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(forgedHost, 403);
    assert.equal((await fetch(`${origin}/api/lessons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"draft":{}}' })).status, 403);
    assert.equal((await fetch(`${origin}/api/lessons`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Calendar-Token': config.csrfToken, Origin: 'https://example.com' }, body: '{"draft":{}}' })).status, 403);
    assert.equal(writes, 0);
    const response = await fetch(`${origin}/api/lessons`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Calendar-Token': config.csrfToken, Origin: origin }, body: JSON.stringify({ draft: { title: 'Test' }, expectedVersion: 'v', mutationId: 'm' }) });
    assert.equal(response.status, 200);
    assert.equal(writes, 1);
    assert.equal((await response.json()).lesson.id, 'grist:1');
    for (const name of ['/server/grist-client.mjs', '/server/schema.mjs', '/.env.local', '/docs/STATE.md']) assert.equal((await fetch(origin + name)).status, 404);
  });
});

test('an acknowledged write stays successful if refreshing the snapshot fails', async () => {
  await withServer({ saveLesson: async () => ({ id: 'grist:42', title: 'Saved' }), getSnapshot: async () => { throw new Error('private upstream information'); } }, async origin => {
    const { csrfToken } = await (await fetch(`${origin}/api/config`)).json();
    const response = await fetch(`${origin}/api/lessons`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Calendar-Token': csrfToken }, body: '{"draft":{}}' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { lesson: { id: 'grist:42', title: 'Saved' }, snapshot: null, refreshWarning: true });
    const read = await fetch(`${origin}/api/snapshot`);
    assert.equal(read.status, 502);
    assert.doesNotMatch(await read.text(), /private upstream/);
  });
});

test('a refresh after an acknowledged write cannot join an older pending read', async () => {
  let resolveOldRead;
  let version = 1;
  let reads = 0;
  let signalFirstRead;
  const firstReadStarted = new Promise(resolve => { signalFirstRead = resolve; });
  const store = {
    getSnapshot: async () => {
      reads++;
      if (reads === 1) { signalFirstRead(); return new Promise(resolve => { resolveOldRead = resolve; }); }
      return { version };
    },
    saveLesson: async () => { version = 2; return { id: 'grist:1', version }; },
  };
  await withServer(store, async origin => {
    const oldRead = fetch(`${origin}/api/snapshot`);
    await firstReadStarted;
    const { csrfToken } = await (await fetch(`${origin}/api/config`)).json();
    const save = await fetch(`${origin}/api/lessons`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Calendar-Token': csrfToken }, body: '{"draft":{}}' });
    assert.equal((await save.json()).snapshot.version, 2);
    const newRead = await fetch(`${origin}/api/snapshot`);
    assert.equal((await newRead.json()).version, 2);
    resolveOldRead({ version: 1 });
    assert.equal((await (await oldRead).json()).version, 1);
  });
});

test('conflicts are 409, uncertain outcomes are explicit, and malformed bodies cannot reach writes', async () => {
  let code = 'VERSION_CONFLICT';
  await withServer({ getSnapshot: async () => ({}), saveLesson: async () => { throw Object.assign(new Error('Safe failure message'), { code, outcomeUnknown: code === 'SAVE_UNCERTAIN' }); } }, async origin => {
    const { csrfToken } = await (await fetch(`${origin}/api/config`)).json();
    const headers = { 'Content-Type': 'application/json', 'X-Calendar-Token': csrfToken };
    const post = body => fetch(`${origin}/api/lessons`, { method: 'POST', headers, body });
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('null')).status, 400);
    assert.equal((await post('{"draft":{}}')).status, 409);
    code = 'SAVE_UNCERTAIN';
    const uncertain = await post('{"draft":{}}');
    assert.equal(uncertain.status, 503);
    assert.equal((await uncertain.json()).error.outcomeUnknown, true);
  });
});
