// Reproduce Charta's packaged Defuddle artifact. This is a maintainer-only
// download step; the extension never fetches executable code at runtime.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const destination = new URL('../extension/vendor/', import.meta.url);
const packages = [
  { name: 'defuddle', version: '0.19.2', file: 'dist/index.full.js', output: 'defuddle.js', license: 'LICENSE', integrity: 'sha512-FY+a9Byo3uS04SQnQjLaguNoEA0Y58vXTB1XvvnOkO6M0zo897ipekv2Unci42QEY70emZ6OLe7C0vPojr1JEA==', sha256: 'b5a828bc49b863837931c3b59b97112a30b700b7fcd34dbe6e2a379dc1da379d' },
  // Versions in Defuddle's 0.19.2 lockfile. The full browser bundle includes
  // their MIT code; preserve the notices even though they are already bundled.
  { name: 'turndown', version: '7.2.0', license: 'LICENSE' },
  { name: 'mathml-to-latex', version: '1.8.0', license: 'LICENSE.md' },
  { name: 'temml', version: '0.13.3', license: 'LICENSE' },
  { name: '@xmldom/xmldom', version: '0.9.10', license: 'LICENSE', licenseName: 'xmldom' }
];

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(new URL('licenses/', destination), { recursive: true });
const provenance = [];
for (const item of packages) {
  const basename = item.name.split('/').at(-1);
  const url = `https://registry.npmjs.org/${item.name}/-/${basename}-${item.version}.tgz`;
  const tarball = await download(url);
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  if (item.integrity && integrity !== item.integrity) throw new Error(`Integrity mismatch for ${item.name}`);
  const extract = file => execFileSync('tar', ['-xzOf', '-', `package/${file}`], { input: tarball, maxBuffer: 10_000_000 });
  const license = extract(item.license);
  await writeFile(new URL(`licenses/${item.licenseName || basename}-MIT.txt`, destination), license);
  const record = { name: item.name, version: item.version, tarball: url, integrity, license: 'MIT' };
  if (item.file) {
    const bundle = extract(item.file);
    const sha256 = createHash('sha256').update(bundle).digest('hex');
    if (sha256 !== item.sha256) throw new Error(`Bundle checksum mismatch for ${item.name}`);
    await writeFile(new URL(item.output, destination), bundle);
    Object.assign(record, { source: item.file, output: item.output, sha256 });
  }
  provenance.push(record);
}
await writeFile(new URL('defuddle.provenance.json', destination), `${JSON.stringify({
  upstream: 'https://github.com/kepano/defuddle/tree/0.19.2',
  clipperReference: 'https://github.com/obsidianmd/obsidian-clipper',
  packages: provenance
}, null, 2)}\n`);
console.log('Vendored Defuddle 0.19.2 and bundled MIT notices.');
