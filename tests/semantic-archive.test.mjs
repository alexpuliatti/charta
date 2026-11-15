import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildLibrary, loadLibrary } from '../scripts/library.mjs';

test('static and Pages builds preserve embedding sidecars as binary archive content', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-semantic-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (file, content) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, typeof content === 'object' && !Buffer.isBuffer(content) ? JSON.stringify(content) : content);
  };
  await put('content/library.json', { schemaVersion: 1, title: 'Archive fixture', inboxCollectionId: 'c_inbox' });
  await put('content/collections/inbox/collection.json', { schemaVersion: 1, id: 'c_inbox', title: 'Inbox', items: [] });
  const manifestPath = 'content/embeddings/index.json';
  const vectorsPath = 'content/embeddings/vectors.bin';
  const textVectorsPath = 'content/embeddings/text-vectors.bin';
  const binary = Buffer.from([0, 255, 128, 0, 17, 42, 0, 201]);
  const textBinary = Buffer.from([0, 128, 27, 222, 255, 0, 123, 0]);
  const extraFiles = [manifestPath, textVectorsPath, vectorsPath];
  await put(manifestPath, { schemaVersion: 1, fixture: true, vectors: { path: 'vectors.bin' }, textIndex: { vectors: { path: 'text-vectors.bin' } } });
  await put(vectorsPath, binary);
  await put(textVectorsPath, textBinary);
  await put('web/index.html', '<title>Archive fixture</title>');
  for (const file of ['discover.mjs', 'discover.css']) await cp(new URL(`../web/${file}`, import.meta.url), path.join(root, 'web', file));
  await mkdir(path.join(root, 'shared'));
  await cp(new URL('../shared/semantic.mjs', import.meta.url), path.join(root, 'shared/semantic.mjs'));
  const source = await loadLibrary(root);
  assert.deepEqual(source.extraFiles, extraFiles);
  for (const publish of [false, true]) {
    const out = path.join(root, publish ? 'pages' : 'dist');
    const built = await buildLibrary(root, out, { publish, env: {} });
    assert.deepEqual(built.extraFiles, extraFiles);
    assert.deepEqual(await readFile(path.join(out, vectorsPath)), binary, 'NUL and non-UTF-8 bytes must survive the static build unchanged');
    assert.deepEqual(await readFile(path.join(out, textVectorsPath)), textBinary, 'the reading index keeps its own exact binary representation');
    assert.deepEqual(await readFile(path.join(out, manifestPath)), await readFile(path.join(root, manifestPath)));
    for (const file of ['discover.mjs', 'discover.css', 'shared/semantic.mjs']) assert.ok((await readFile(path.join(out, file))).length > 0);
    const generated = JSON.parse(await readFile(path.join(out, 'content/_generated/catalog.json'), 'utf8'));
    assert.deepEqual(generated.extraFiles, extraFiles, 'portable exports can discover every embedding artifact');
  }
});
