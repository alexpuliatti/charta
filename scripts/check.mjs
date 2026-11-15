import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadLibrary } from './library.mjs';
import { syncReader } from './sync-reader.mjs';
import { buildComponents } from './build-components.mjs';
import { buildPDFStyles } from './pdf-styles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function checkDirectory(directory) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, file.name);
    if (file.isDirectory()) await checkDirectory(full);
    else if (/\.(mjs|js)$/.test(file.name)) execFileSync(process.execPath, ['--check', full], { stdio: 'inherit' });
  }
}
await syncReader({ check: true });
await buildComponents({ check: true });
await buildPDFStyles({ check: true });
for (const directory of ['web', 'shared', 'scripts', 'extension']) await checkDirectory(path.join(root, directory));
await loadLibrary(root);
console.log('JavaScript syntax and canonical content are valid.');
