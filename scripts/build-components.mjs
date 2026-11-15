import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildComponents({ check = false } = {}) {
  const vendor = path.join(root, 'web/vendor/react-bits');
  const manifest = JSON.parse(await readFile(path.join(vendor, 'source.json'), 'utf8'));
  for (const component of manifest.components) for (const file of component.files) {
    let source = await readFile(path.join(vendor, file.path), 'utf8');
    for (const patch of [...file.patches].reverse()) {
      if (!source.includes(patch.after)) throw new Error(`Missing documented React Bits patch in ${file.path}`);
      source = source.replaceAll(patch.after, patch.before);
    }
    const hash = createHash('sha256').update(source).digest('hex');
    if (hash !== file.upstreamSha256) throw new Error(`${file.path} differs from its recorded official React Bits source.`);
  }
  for (const entry of ['connections', 'archive-thinking']) {
    const result = await build({
      absWorkingDir: root, entryPoints: [`web/components/${entry}.jsx`],
      outfile: `web/vendor/${entry}-react.mjs`, bundle: true, format: 'esm',
      platform: 'browser', target: ['es2022'], jsx: 'automatic', minify: true,
      define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof',
      write: false, logLevel: 'silent',
    });
    for (const file of result.outputFiles) {
      if (check) {
        const previous = await readFile(file.path).catch(() => null);
        if (!previous?.equals(file.contents)) throw new Error(`${path.relative(root, file.path)} is out of date. Run npm run build:components.`);
      } else {
        await mkdir(path.dirname(file.path), { recursive: true });
        await writeFile(file.path, file.contents);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildComponents({ check: process.argv.includes('--check') });
}
