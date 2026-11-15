import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';

test('discovery offers all-media starting points, excludes stale vectors, and discards late loads after navigation', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'jelly-discover-'));
  const dom = new JSDOM('<main></main>', { url: 'https://archive.example/jelly/' });
  const container = dom.window.document.querySelector('main');
  let view;
  try {
    await cp(new URL('../web/discover.mjs', import.meta.url), path.join(fixture, 'discover.mjs'));
    await cp(new URL('../shared/', import.meta.url), path.join(fixture, 'shared'), { recursive: true });
    const { discoverySeeds, renderDiscover } = await import(pathToFileURL(path.join(fixture, 'discover.mjs')));
    const blocks = [
      { id: 'b_image', type: 'image', title: 'Cover Study', category: 'Graphic design', tags: ['covers'] },
      { id: 'b_image_two', type: 'image', title: 'Another Cover', category: 'Graphic design', tags: ['covers'] },
      { id: 'b_article', type: 'link', title: '<img src=x onerror=alert(1)>', category: 'Writing', tags: ['covers'] },
      { id: 'b_video', type: 'video', title: 'Motion Study', category: 'Graphic design', tags: ['motion'] },
    ];
    const entries = blocks.map((block, row) => ({ id: block.id, row }));
    const allowed = new Set(['b_image', 'b_article', 'b_video']);
    assert.deepEqual(discoverySeeds(blocks, allowed, 3).map(block => block.id), ['b_image', 'b_article', 'b_video'], 'a starting gallery includes each media type and skips stale rows');
    const index = {
      entries, byId: new Map(entries.map(entry => [entry.id, entry])), validIds: allowed,
      vectors: Float32Array.from([1, 0, 1, 0, 0.9, 0.1, 0, 1]), dimensions: 2,
      manifest: { model: { id: 'test-fixture' } },
      validation: { total: blocks.length, staleIds: ['b_image_two'], missingIds: [], orphanIds: [] },
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    let selected;
    view = renderDiscover(container, { blocks }, { selectedId: 'b_article', loadIndex: async () => index, onSelect: id => { selected = id; } });
    await settle();
    assert.equal(container.querySelector('.discover-anchor').textContent, blocks[2].title);
    assert.equal(container.querySelector('img'), null, 'record titles remain text in the selected context');
    assert.deepEqual([...container.querySelectorAll('.discover-fallback')].map(button => button.dataset.id), ['b_image', 'b_video'], 'neighbors cross media types while omitting the stale image');
    container.querySelector('.discover-fallback').click();
    assert.equal(selected, 'b_image', 'a neighbor becomes a new starting point');
    view.destroy();

    view = renderDiscover(container, { blocks }, { selectedId: 'b_image_two', loadIndex: async () => index });
    await settle();
    assert.match(container.querySelector('.discover-status').textContent, /not ready/);
    assert.equal(container.querySelector('.discover-anchor'), null, 'an outdated anchor must not imply verified similarity');
    view.destroy();

    let finish;
    view = renderDiscover(container, { blocks }, { loadIndex: () => new Promise(resolve => { finish = resolve; }) });
    await settle();
    view.destroy();
    container.textContent = 'Another page';
    finish(index);
    await settle();
    assert.equal(container.textContent, 'Another page', 'a load that finishes after navigation cannot replace the current page');

    view = renderDiscover(container, { blocks }, { loadIndex: async () => { throw new Error('404'); } });
    await settle();
    assert.match(container.querySelector('.discover-status').textContent, /aren’t available/);
    assert.equal(container.querySelectorAll('.discover-card').length, 0, 'an unavailable index never falls back to fabricated similarity');
    assert.equal(container.querySelector('.discover-input').disabled, true);
  } finally {
    view?.destroy();
    dom.window.close();
    await rm(fixture, { recursive: true, force: true });
  }
});

test('connected-folder discovery reads only its selected project and caches independently of published sources', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'jelly-folder-discover-'));
  const dom = new JSDOM('<main></main>', { url: 'https://archive.example/jelly/' });
  let view;
  const originalFetch = globalThis.fetch;
  try {
    await cp(new URL('../web/discover.mjs', import.meta.url), path.join(fixture, 'discover.mjs'));
    await cp(new URL('../shared/', import.meta.url), path.join(fixture, 'shared'), { recursive: true });
    const { renderDiscover, semanticFolderFetcher } = await import(pathToFileURL(path.join(fixture, 'discover.mjs')));
    const { CLIP_MODEL, SEMANTIC_VERSION, embeddingInputHash, TEXT_MODEL, TEXT_SEMANTIC_VERSION, textEmbeddingInputHash } = await import(pathToFileURL(path.join(fixture, 'shared/semantic.mjs')));
    const blocks = [
      { id: 'b_a', type: 'text', title: 'Collecting Ideas', body: 'A saved article', tags: [], assets: [] },
      { id: 'b_b', type: 'image', title: 'Book Cover', tags: [], assets: [] },
      { id: 'b_c', type: 'file', title: 'Archive Book', tags: [], assets: [{ path: 'book.pdf', mimeType: 'application/pdf' }] },
    ];
    const vectors = new Float32Array(blocks.length * CLIP_MODEL.dimensions);
    vectors[0] = 1;
    vectors[CLIP_MODEL.dimensions] = 1;
    vectors[CLIP_MODEL.dimensions * 2] = 1;
    const bytes = new Uint8Array(vectors.buffer);
    const textVectors = new Float32Array(blocks.length * TEXT_MODEL.dimensions);
    for (let row = 0; row < blocks.length; row++) textVectors[row * TEXT_MODEL.dimensions] = 1;
    const textBytes = new Uint8Array(textVectors.buffer);
    const manifest = {
      schemaVersion: 1, inputVersion: SEMANTIC_VERSION, model: CLIP_MODEL,
      vectors: { path: 'vectors.bin', encoding: 'float32-le', sha256: createHash('sha256').update(bytes).digest('hex') },
      textIndex: { inputVersion: TEXT_SEMANTIC_VERSION, model: TEXT_MODEL, vectors: { path: 'text-vectors.bin', encoding: 'float32-le', sha256: createHash('sha256').update(textBytes).digest('hex') } },
      entries: await Promise.all(blocks.map(async (block, row) => ({ id: block.id, type: block.type, row, inputHash: await embeddingInputHash(block), textSource: { inputHash: await textEmbeddingInputHash(block) } }))),
    };
    const files = new Map([
      ['content/embeddings/index.json', new TextEncoder().encode(JSON.stringify(manifest))],
      ['content/embeddings/vectors.bin', bytes],
      ['content/embeddings/text-vectors.bin', textBytes],
    ]);
    function project() {
      const reads = [];
      const directory = prefix => ({
        async getDirectoryHandle(name, options) {
          assert.equal(options?.create, undefined, 'browsing must never create a directory');
          return directory(prefix + name + '/');
        },
        async getFileHandle(name, options) {
          assert.equal(options?.create, undefined, 'browsing must never create or write a file');
          const path = prefix + name;
          reads.push(path);
          if (!files.has(path)) throw new dom.window.DOMException('Not found', 'NotFoundError');
          return { async getFile() { return { async arrayBuffer() { const data = files.get(path); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); } }; } };
        },
      });
      return { handle: directory(''), reads };
    }
    const first = project(), second = project();
    const catalog = { blocks };
    const container = dom.window.document.querySelector('main');
    globalThis.fetch = () => { throw new Error('Connected-folder discovery must not use the published archive or network.'); };
    const ready = async () => {
      const deadline = Date.now() + 1500;
      while (!container.querySelector('.discover-card')) {
        if (Date.now() > deadline) assert.fail(container.textContent);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };
    for (const selectedId of ['b_a', 'b_b']) {
      view = renderDiscover(container, catalog, { selectedId, directoryHandle: first.handle });
      await ready();
      assert.equal(container.querySelector('.discover-card button').dataset.id, selectedId === 'b_a' ? 'b_c' : 'b_a');
      assert.equal(container.querySelector('.discover-context-label').dataset.space, selectedId === 'b_a' ? 'text' : 'multimodal');
      view.destroy();
    }
    const expectedReads = ['content/embeddings/index.json', 'content/embeddings/text-vectors.bin', 'content/embeddings/vectors.bin'];
    assert.deepEqual(first.reads.sort(), expectedReads, 'changing an anchor reuses both of the selected folder’s verified embedding spaces');
    view = renderDiscover(container, catalog, { selectedId: 'b_a', directoryHandle: second.handle });
    await ready();
    assert.deepEqual(second.reads.sort(), expectedReads, 'a different handle cannot reuse an unrelated source cache');
    const fetchFile = semanticFolderFetcher(first.handle, dom.window.document.baseURI);
    for (const input of ['https://elsewhere.example/content/embeddings/index.json', 'content/library.json', 'content/embeddings/index.json?other=1']) await assert.rejects(fetchFile(new URL(input, dom.window.document.baseURI)), /Unsupported/);
    await assert.rejects(fetchFile(new URL('content/embeddings/index.json', dom.window.document.baseURI), { method: 'POST' }), /Unsupported/);
    files.delete('content/embeddings/text-vectors.bin');
    assert.equal((await fetchFile(new URL('content/embeddings/text-vectors.bin', dom.window.document.baseURI))).status, 404, 'a missing folder text index never falls through to another archive');
  } finally {
    view?.destroy();
    globalThis.fetch = originalFetch;
    dom.window.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
