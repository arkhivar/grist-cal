import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

test('local preview serves only public app assets and rejects private paths and writes', async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'] });
  const childClosed = once(child, 'close');
  let startupTimer;
  try {
    await Promise.race([once(child.stdout, 'data'), childClosed.then(() => { throw new Error('Preview server exited before startup'); }), new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('Preview startup timed out')), 5000); startupTimer.unref(); })]);
    clearTimeout(startupTimer);
    const origin = `http://127.0.0.1:${port}`;
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(await home.text(), /Grist Cal/);
    const code = await fetch(`${origin}/src/app.js`);
    assert.equal(code.status, 200);
    assert.match(code.headers.get('content-type'), /javascript/);
    for (const url of ['/.git/config', '/.env', '/AGENTS.md', '/package.json', '/docs/STATE.md', '/vendor/%2e%2e/%2e%2e/.git/config', '/src/..%5c.git/config']) {
      assert.equal((await fetch(origin + url)).status, 404, url);
    }
    assert.equal((await fetch(origin, { method: 'POST', body: 'test' })).status, 405);
  } finally {
    clearTimeout(startupTimer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await childClosed;
  }
});
