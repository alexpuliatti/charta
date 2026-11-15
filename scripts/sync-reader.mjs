import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const copies = [
  ['web/menus.css', 'extension/menus.css'],
  ['web/assets/charta.svg', 'extension/assets/charta.svg'],
  ...[16, 32, 48, 128].map(size => [`web/assets/icons/charta-${size}.png`, `extension/assets/charta-${size}.png`]),
  ['shared/clip-markdown.mjs', 'extension/markdown.js'],
  ['extension/reader-render.js', 'web/reader-render.mjs'],
  ...['marked.umd.js', 'purify.min.js', 'marked-LICENSE', 'DOMPurify-LICENSE-APACHE', 'DOMPurify-LICENSE-MPL'].map(file => [`extension/vendor/${file}`, `web/vendor/${file}`])
];

export async function syncReader({ check = false } = {}) {
  for (const [source, destination] of copies) {
    const content = await readFile(path.join(root, source));
    if (check) {
      const copy = await readFile(path.join(root, destination)).catch(() => null);
      if (!copy?.equals(content)) throw new Error(`${destination} is out of date. Run npm run sync:reader.`);
    } else {
      await mkdir(path.dirname(path.join(root, destination)), { recursive: true });
      await writeFile(path.join(root, destination), content);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await syncReader({ check: process.argv.includes('--check') });
