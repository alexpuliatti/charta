import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyOperation, canonicalRecord, safeContentPath, safeSourceUrl, validateCatalog } from '../shared/model.mjs';
import { serializeMarkdown, stripFrontmatter } from '../shared/clip-markdown.mjs';

const fixture = () => ({ schemaVersion: 1, sourceCommit: 'test', library: { schemaVersion: 1, title: 'Test', inboxCollectionId: 'c_one' }, folders: [], collections: ['one', 'two'].map(name => ({ schemaVersion: 1, id: `c_${name}`, title: name, path: `content/collections/${name}/collection.json`, parentId: null, items: [] })), blocks: [] });

function markdownFixture() {
  const catalog = applyOperation(fixture(), {
    type: 'add-block', block: { id: 'b_article', title: 'Saved article', type: 'text', description: 'Original owner note', category: 'Reading', tags: ['original'], source: { url: 'https://example.com/article', capturedAt: '2026-11-15T10:00:00.000Z' } },
    body: 'The original **article** and [source link](https://example.com/reference).', collectionIds: ['c_one']
  }).catalog;
  const block = catalog.blocks[0];
  block.contentFormat = 'markdown';
  block.article = { author: 'Article author', published: '2026-11-14', description: 'Publisher description' };
  block.capture = { method: 'defuddle', kind: 'article', warning: 'Loaded article content' };
  block.summary = { status: 'ready', text: 'An untouched AI summary.', provider: 'test-model', editedByOwner: false };
  block.body = serializeMarkdown({
    title: block.title, url: block.source.url, capturedAt: block.source.capturedAt,
    description: block.description, category: block.category, tags: block.tags,
    article: block.article, extraction: block.capture, body: block.body
  });
  return catalog;
}

function markdownProperties(body) {
  assert.ok(body.startsWith('---\n'));
  const frontmatter = body.slice(4, body.indexOf('\n---', 4));
  return Object.fromEntries(frontmatter.split('\n').map(line => {
    const separator = line.indexOf(': ');
    return [line.slice(0, separator), JSON.parse(line.slice(separator + 2))];
  }));
}

test('one canonical block connects across collections without duplicated material', () => {
  const { catalog, writes } = applyOperation(fixture(), { type: 'add-block', block: { id: 'b_one', title: 'Example', type: 'link', source: { url: 'https://example.com/' } }, body: 'Original capture', collectionIds: ['c_one', 'c_two'] });
  assert.equal(catalog.blocks.length, 1);
  assert.equal(writes.length, 4);
  for (const collection of catalog.collections) assert.deepEqual(collection.items, [{ kind: 'block', id: 'b_one' }]);
  const result = applyOperation(catalog, { type: 'connect', blockId: 'b_one', collectionIds: ['c_two'] });
  assert.equal(result.catalog.blocks.length, 1);
  assert.equal(result.catalog.collections[0].items.length, 0);
  assert.equal(result.catalog.collections[1].items.length, 1);
  assert.equal(catalog.collections[0].items.length, 1, 'input snapshot remains immutable');
});

test('unsafe sources and paths cannot reach writes', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'https://owner:secret@example.com/private', 'https://token@example.com/']) assert.throws(() => safeSourceUrl(url));
  for (const path of ['../content/x', 'content/../secret', 'content/a\\b', 'content/active.svg', 'content/a%2fb', 'content/a.html']) assert.throws(() => safeContentPath(path));
  assert.throws(() => applyOperation(fixture(), { type: 'add-block', block: { title: 'Bad', source: { url: 'javascript:alert(1)' } }, collectionIds: [] }));
});

test('unknown membership targets reject the operation before output', () => {
  const input = fixture();
  assert.throws(() => applyOperation(input, { type: 'add-block', block: { id: 'b_unknown', title: 'Missing target' }, collectionIds: ['c_missing'] }));
  assert.equal(input.blocks.length, 0);
  input.collections[0].items = [{ kind: 'block', id: 'b_missing' }];
  assert.throws(() => validateCatalog(input), /Unknown connection target/);
});

test('collection rename preserves path, stable ID and incoming connections', () => {
  const input = fixture();
  input.collections[0].items.push({ kind: 'collection', id: 'c_two' });
  const { catalog } = applyOperation(input, { type: 'update-collection', id: 'c_two', title: 'Renamed' });
  assert.equal(catalog.collections[1].id, 'c_two');
  assert.equal(catalog.collections[1].path, input.collections[1].path);
  assert.deepEqual(catalog.collections[0].items, input.collections[0].items);
});

test('folders can contain new collections and material summaries are separate files', () => {
  let result = applyOperation(fixture(), { type: 'create-folder', id: 'f_research', title: 'Research' });
  result = applyOperation(result.catalog, { type: 'create-collection', id: 'c_nested', title: 'Reading', parentId: 'f_research' });
  assert.equal(result.catalog.collections.at(-1).path, 'content/collections/research/reading/collection.json');
  result = applyOperation(result.catalog, { type: 'add-block', block: { id: 'b_note', type: 'text', title: 'A note' }, body: 'Some text', collectionIds: ['c_nested'] });
  result = applyOperation(result.catalog, { type: 'update-block', id: 'b_note', patch: { summary: 'An owner-written summary.' } });
  assert.ok(result.writes.some(file => file.path.endsWith('/summary.json')));
  assert.ok(!JSON.parse(result.writes.find(file => file.path.endsWith('/block.json')).content).summary);
  assert.equal(result.catalog.blocks[0].summary.editedByOwner, true);
});

test('editing other fields preserves an unchanged AI summary and leaves blank summaries pending', () => {
  const added = applyOperation(fixture(), { type: 'add-block', block: { id: 'b_summary', title: 'A link' }, collectionIds: ['c_one'] });
  let edited = applyOperation(added.catalog, { type: 'update-block', id: 'b_summary', patch: { title: 'A new title', summary: '' }, body: '' });
  assert.equal(edited.catalog.blocks[0].summary, null);
  assert.ok(!edited.writes.some(file => file.path.endsWith('/summary.json') || file.path.endsWith('/body.md')));
  edited.catalog.blocks[0].summary = { status: 'ready', text: 'An AI summary.', provider: 'example-model', editedByOwner: false };
  edited = applyOperation(edited.catalog, { type: 'update-block', id: 'b_summary', patch: { description: 'A new note', summary: 'An AI summary.' } });
  assert.equal(edited.catalog.blocks[0].summary.editedByOwner, false);
  assert.ok(!edited.writes.some(file => file.path.endsWith('/summary.json')));
});

test('owner metadata edits keep Markdown exports in agreement with canonical records', () => {
  const original = markdownFixture();
  const input = applyOperation(original, { type: 'add-block', block: { id: 'b_unrelated', title: 'Another material' }, body: 'Keep this unrelated body.', collectionIds: ['c_two'] }).catalog;
  input.blocks[1].summary = { status: 'ready', text: 'A separate summary.', provider: 'manual', editedByOwner: true };
  const result = applyOperation(input, {
    type: 'update-block', id: 'b_article', patch: {
      title: 'Edited title', description: 'A revised owner note.', category: '  Reference  ', tags: ['#Archives', 'archives', 'Collecting'],
      source: { url: 'https://example.org/corrected', capturedAt: '2026-11-15T11:00:00.000Z' }
    }
  });
  const block = result.catalog.blocks[0];
  const record = JSON.parse(result.writes.find(entry => entry.path.endsWith('b_article/block.json')).content);
  const savedBody = result.writes.find(entry => entry.path.endsWith('b_article/body.md')).content;
  const properties = markdownProperties(savedBody);
  assert.equal(properties.title, record.title);
  assert.equal(properties.source, record.source.url);
  assert.equal(properties.created, record.source.capturedAt);
  assert.equal(properties.description, record.description);
  assert.equal(properties.category, record.category);
  assert.deepEqual(properties.tags, record.tags);
  assert.equal(properties.author, block.article.author);
  assert.equal(properties.published, block.article.published);
  assert.equal(properties.capture_kind, block.capture.kind);
  assert.equal(properties.capture_note, block.capture.warning);
  assert.equal(block.body, savedBody);
  assert.match(stripFrontmatter(savedBody), /The original \*\*article\*\* and \[source link\]/);
  assert.equal(savedBody.match(/^source: /gm).length, 1, 'frontmatter is replaced rather than nested');
  assert.deepEqual(block.summary, input.blocks[0].summary);
  assert.deepEqual(result.catalog.blocks[1], input.blocks[1]);
  assert.deepEqual(result.writes.map(entry => entry.path).sort(), ['content/blocks/b_article/block.json', 'content/blocks/b_article/body.md']);
  assert.equal(input.blocks[0].body, original.blocks[0].body, 'the input snapshot stays immutable');
});

test('owner edits replace supplied Markdown metadata and preserve a deliberately cleared description', () => {
  const input = markdownFixture();
  delete input.blocks[0].source.capturedAt;
  const result = applyOperation(input, {
    type: 'update-block', id: 'b_article', patch: { description: '' },
    body: '---\ntitle: "Forged title"\nsource: "https://unrelated.example"\ndescription: "Old description"\ntags: ["forged"]\n---\n\nNew **article** text.'
  });
  const block = result.catalog.blocks[0];
  const properties = markdownProperties(block.body);
  assert.equal(properties.title, block.title);
  assert.equal(properties.source, block.source.url);
  assert.equal(properties.created, block.createdAt, 'legacy captures fall back to their canonical creation date');
  assert.equal(properties.description, undefined, 'clearing the owner note must not restore a publisher description');
  assert.deepEqual(properties.tags, block.tags);
  assert.match(stripFrontmatter(block.body), /New \*\*article\*\* text\./);
  assert.doesNotMatch(block.body, /forged|unrelated\.example|Old description/);
  assert.deepEqual(block.summary, input.blocks[0].summary);
});

test('connecting a Markdown article synchronizes taxonomy without touching source text or summaries', () => {
  const input = markdownFixture();
  const result = applyOperation(input, { type: 'connect', blockId: 'b_article', collectionIds: ['c_one', 'c_two'], taxonomy: { category: 'Knowledge', tags: ['#Networks', 'Systems'] } });
  const block = result.catalog.blocks[0];
  const properties = markdownProperties(block.body);
  assert.equal(properties.category, block.category);
  assert.deepEqual(properties.tags, ['networks', 'systems']);
  assert.equal(stripFrontmatter(block.body), stripFrontmatter(input.blocks[0].body));
  assert.deepEqual(block.summary, input.blocks[0].summary);
  assert.deepEqual(block.source, input.blocks[0].source);
  assert.deepEqual(result.writes.map(entry => entry.path).sort(), ['content/blocks/b_article/block.json', 'content/blocks/b_article/body.md', 'content/collections/two/collection.json']);
  const unchanged = applyOperation(result.catalog, { type: 'connect', blockId: 'b_article', collectionIds: ['c_one', 'c_two'], taxonomy: { category: 'Knowledge', tags: ['networks', 'systems'] } });
  assert.ok(!unchanged.writes.some(entry => entry.path.endsWith('/body.md')), 'unchanged metadata does not rewrite the body');
  const summaryOnly = applyOperation(result.catalog, { type: 'update-block', id: 'b_article', patch: { summary: 'Owner-written summary.' } });
  assert.equal(summaryOnly.catalog.blocks[0].body, result.catalog.blocks[0].body);
  assert.ok(!summaryOnly.writes.some(entry => entry.path.endsWith('/body.md')));
});

test('stored Markdown accepts full capture bodies with frontmatter and enforces the 2 MiB UTF-8 limit', () => {
  const input = markdownFixture();
  const fullCapture = serializeMarkdown({ title: 'Saved article', url: input.blocks[0].source.url, category: 'Reading', tags: [], body: 'A'.repeat(500000) });
  assert.ok(fullCapture.length > 500000);
  const result = applyOperation(input, { type: 'update-block', id: 'b_article', patch: {}, body: fullCapture });
  assert.match(result.catalog.blocks[0].body, /A{500000}/);
  assert.ok(new TextEncoder().encode(result.catalog.blocks[0].body).byteLength < 2 * 1024 * 1024);
  assert.throws(() => applyOperation(input, { type: 'update-block', id: 'b_article', patch: {}, body: 'é'.repeat(1024 * 1024 + 1) }), /2 MiB/);
  assert.throws(() => applyOperation(input, { type: 'update-block', id: 'b_article', patch: {}, body: 'A'.repeat(2 * 1024 * 1024) }), /2 MiB/, 'the serialized frontmatter also counts toward the archive limit');
});

test('canonical mutation files reload through the repository loader', async () => {
  const { loadLibrary } = await import('../scripts/library.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-model-'));
  try {
    const input = fixture();
    await mkdir(path.join(root, 'content'), { recursive: true });
    await writeFile(path.join(root, 'content/library.json'), JSON.stringify(input.library));
    for (const collection of input.collections) {
      await mkdir(path.dirname(path.join(root, collection.path)), { recursive: true });
      const { path: ignored, parentId, ...record } = collection;
      await writeFile(path.join(root, collection.path), JSON.stringify(record));
    }
    const result = applyOperation(input, { type: 'add-block', block: { id: 'b_roundtrip', type: 'text', title: 'A durable note' }, body: 'The exact source text.', collectionIds: ['c_one', 'c_two'] });
    for (const entry of result.writes) {
      await mkdir(path.dirname(path.join(root, entry.path)), { recursive: true });
      await writeFile(path.join(root, entry.path), entry.content);
    }
    const loaded = await loadLibrary(root);
    assert.equal(loaded.blocks[0].body, 'The exact source text.');
    assert.deepEqual(loaded.blocks[0].collectionIds, ['c_one', 'c_two']);
    assert.ok(!JSON.parse(await readFile(path.join(root, 'content/blocks/b_roundtrip/block.json'), 'utf8')).collectionIds);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('moving a collection changes its physical file while preserving its ID and incoming links', async () => {
  const { loadLibrary } = await import('../scripts/library.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-move-'));
  try {
    const input = fixture();
    input.folders.push({ schemaVersion: 1, id: 'f_research', title: 'Research', path: 'content/collections/research/folder.json', parentId: null });
    input.collections.push({ schemaVersion: 1, id: 'c_collision', title: 'Existing collection', items: [], path: 'content/collections/research/two/collection.json', parentId: 'f_research' });
    input.collections[0].items.push({ kind: 'collection', id: 'c_two' });
    await mkdir(path.join(root, 'content'), { recursive: true });
    await writeFile(path.join(root, 'content/library.json'), JSON.stringify(input.library));
    for (const record of [...input.folders, ...input.collections]) {
      await mkdir(path.dirname(path.join(root, record.path)), { recursive: true });
      await writeFile(path.join(root, record.path), JSON.stringify(canonicalRecord(record)));
    }
    const result = applyOperation(input, { type: 'update-collection', id: 'c_two', parentId: 'f_research' });
    assert.ok(result.writes.some(entry => entry.path === 'content/collections/two/collection.json' && entry.content === null));
    for (const entry of result.writes) {
      if (entry.content === null) await rm(path.join(root, entry.path));
      else {
        await mkdir(path.dirname(path.join(root, entry.path)), { recursive: true });
        await writeFile(path.join(root, entry.path), entry.content);
      }
    }
    const loaded = await loadLibrary(root);
    const moved = loaded.collections.find(c => c.id === 'c_two');
    assert.equal(moved.path, 'content/collections/research/two-c_two/collection.json');
    assert.equal(moved.parentId, 'f_research');
    assert.deepEqual(loaded.collections.find(c => c.id === 'c_one').items, [{ kind: 'collection', id: 'c_two' }]);
    await assert.rejects(readFile(path.join(root, 'content/collections/two/collection.json')), { code: 'ENOENT' });
    assert.equal(input.collections[1].path, 'content/collections/two/collection.json');
    assert.throws(() => applyOperation(loaded, { type: 'update-collection', id: 'c_two', parentId: 'f_missing' }), /Parent folder/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('browser export creates a standard ZIP with canonical files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jelly-export-'));
  const previousDocument = globalThis.document, previousLocation = globalThis.location;
  try {
    await mkdir(path.join(root, 'shared'));
    await copyFile(new URL('../web/store.mjs', import.meta.url), path.join(root, 'store.mjs'));
    for (const name of ['operations.mjs', 'github.mjs', 'browser-draft.mjs']) await copyFile(new URL(`../web/${name}`, import.meta.url), path.join(root, name));
    await copyFile(new URL('../shared/model.mjs', import.meta.url), path.join(root, 'shared/model.mjs'));
    await copyFile(new URL('../shared/canvas.mjs', import.meta.url), path.join(root, 'shared/canvas.mjs'));
    await copyFile(new URL('../shared/taxonomy.mjs', import.meta.url), path.join(root, 'shared/taxonomy.mjs'));
    for (const file of ['uploads.mjs', 'resource-routing.mjs', 'canvas.mjs', 'pdf-reading.mjs', 'operations.mjs']) await copyFile(new URL(`../shared/${file}`, import.meta.url), path.join(root, 'shared', file));
    await copyFile(new URL('../shared/clip-markdown.mjs', import.meta.url), path.join(root, 'shared/clip-markdown.mjs'));
    globalThis.document = { baseURI: 'https://example.test/Jelly/' };
    globalThis.location = { pathname: '/Jelly/' };
    const { LibraryStore, createZip } = await import(`file://${path.join(root, 'store.mjs')}`);
    const archive = await new LibraryStore(fixture(), 'browser').exportContent({ download: false });
    const data = new DataView(await archive.arrayBuffer());
    assert.equal(data.getUint32(0, true), 0x04034b50);
    assert.equal(data.getUint32(data.byteLength - 22, true), 0x06054b50);
    assert.equal(data.getUint16(data.byteLength - 14, true), 3, 'library and two collection records');
    const known = new DataView(await createZip([{ path: 'hello.txt', bytes: new TextEncoder().encode('hello') }]).arrayBuffer());
    assert.equal(known.getUint32(14, true), 0x3610a686, 'standard CRC32 checksum');
  } finally {
    globalThis.document = previousDocument; globalThis.location = previousLocation;
    await rm(root, { recursive: true, force: true });
  }
});

test('folder renaming preserves the hierarchy and only empty folders can be deleted', () => {
  let result = applyOperation(fixture(), { type: 'create-folder', id: 'f_parent', title: 'Parent' });
  result = applyOperation(result.catalog, { type: 'create-collection', id: 'c_child', title: 'Child', parentId: 'f_parent' });
  const originalPath = result.catalog.folders[0].path;
  result = applyOperation(result.catalog, { type: 'update-folder', id: 'f_parent', title: 'New name' });
  assert.equal(result.catalog.folders[0].title, 'New name');
  assert.equal(result.catalog.folders[0].path, originalPath);
  assert.equal(result.catalog.collections.at(-1).parentId, 'f_parent');
  assert.throws(() => applyOperation(result.catalog, { type: 'delete-folder', id: 'f_parent' }), /contents/);
  result = applyOperation(result.catalog, { type: 'delete-collection', id: 'c_child' });
  result = applyOperation(result.catalog, { type: 'delete-folder', id: 'f_parent' });
  assert.equal(result.catalog.folders.length, 0);
  assert.deepEqual(result.writes, [{ path: originalPath, content: null }]);
});

test('collection deletion preserves shared materials and removes incoming collection references', () => {
  let catalog = applyOperation(fixture(), { type: 'add-block', block: { id: 'b_kept', title: 'Keep me' }, collectionIds: ['c_one', 'c_two'] }).catalog;
  catalog.collections[0].items.push({ kind: 'collection', id: 'c_two' });
  const result = applyOperation(catalog, { type: 'delete-collection', id: 'c_two' });
  assert.equal(result.catalog.blocks.length, 1);
  assert.deepEqual(result.catalog.blocks[0].collectionIds, ['c_one']);
  assert.deepEqual(result.catalog.collections[0].items, [{ kind: 'block', id: 'b_kept' }]);
  assert.deepEqual(result.writes.filter(entry => entry.content === null).map(entry => entry.path), ['content/collections/two/collection.json']);
  const withoutInbox = applyOperation(result.catalog, { type: 'delete-collection', id: 'c_one' });
  assert.equal(withoutInbox.catalog.library.inboxCollectionId, undefined);
  assert.equal(withoutInbox.catalog.collections.length, 0);
  assert.equal(withoutInbox.catalog.blocks.length, 1);
  assert.deepEqual(withoutInbox.catalog.blocks[0].collectionIds, []);
  assert.equal(JSON.parse(withoutInbox.writes.find(w => w.path === 'content/library.json').content).inboxCollectionId, undefined);
  const saved = applyOperation(withoutInbox.catalog, { type: 'add-block', block: { id: 'b_unfiled', title: 'Unfiled note', type: 'text' }, body: 'Saved without a collection.' });
  assert.deepEqual(saved.catalog.blocks.find(b => b.id === 'b_unfiled').collectionIds, []);
  assert.deepEqual(saved.writes.map(w => w.path), ['content/blocks/b_unfiled/block.json', 'content/blocks/b_unfiled/body.md']);
});
