import { buildLibrary } from './library.mjs';
import { fileURLToPath } from 'node:url';
import { syncReader } from './sync-reader.mjs';
import { buildComponents } from './build-components.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  await syncReader();
  await buildComponents();
  const catalog = await buildLibrary(root);
  console.log(`Built Charta: ${catalog.blocks.length} materials, ${catalog.collections.length} collections, ${catalog.folders.length} folders → dist/`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
