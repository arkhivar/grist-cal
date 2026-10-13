import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function filesIn(folder, extensions) {
  const entries = await readdir(path.join(root, folder), { withFileTypes: true });
  return entries.filter(e => e.isFile() && extensions.some(ext => e.name.endsWith(ext))).map(e => path.join(folder, e.name));
}
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const filename of [...await filesIn('src', ['.js']), ...await filesIn('scripts', ['.mjs'])]) run(['--check', filename]);
run(['scripts/verify-vendor.mjs']);
run(['--test', ...await filesIn('tests', ['.test.js'])]);
