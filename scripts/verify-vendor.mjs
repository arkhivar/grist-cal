import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'vendor/manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
  throw new Error('Unsupported vendor manifest schema.');
}

const declared = new Set();
for (const asset of manifest.assets) {
  if (!/^vendor\/[A-Za-z0-9._/-]+$/.test(asset.path) || asset.path.split('/').includes('..')) {
    throw new Error(`Invalid vendor path: ${asset.path}`);
  }
  if (declared.has(asset.path)) throw new Error(`Duplicate vendor entry: ${asset.path}`);
  declared.add(asset.path);
  if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isInteger(asset.bytes)) {
    throw new Error(`Missing integrity metadata: ${asset.path}`);
  }
  const bytes = await readFile(path.join(root, asset.path));
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== asset.sha256 || bytes.length !== asset.bytes) {
    throw new Error(`Vendor integrity mismatch: ${asset.path}`);
  }
}

async function checkInventory(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const filename = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await checkInventory(filename);
    else if (!entry.isFile()) throw new Error(`Unsupported vendor entry: ${filename}`);
    else if (filename !== 'vendor/manifest.json' && !declared.has(filename)) {
      throw new Error(`Vendor file is not recorded in manifest: ${filename}`);
    }
  }
}
await checkInventory('vendor');
console.log(`Verified ${declared.size} vendored files against SHA-256 manifest.`);
