import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, canonicalRecord, validateCatalog } from '../shared/model.mjs';
import { validatePDFReading, emptyPDFReading } from '../shared/pdf-reading.mjs';

const annotation = () => ({ id: 'h_first', page: 3, quote: 'A passage worth keeping', comment: 'My own thought', color: 'yellow', rects: [[.1, .2, .4, .03]] });
const fixture = () => ({ schemaVersion: 1, library: { schemaVersion: 1, title: 'Library' }, folders: [], collections: [], blocks: [{ schemaVersion: 1, id: 'b_book', path: 'content/blocks/b_book/block.json', type: 'file', title: 'Book', category: 'Reading', tags: ['books'], assets: [{ path: 'assets/book.pdf', mimeType: 'application/pdf', role: 'original' }, { path: 'assets/other.pdf', mimeType: 'application/pdf', role: 'original' }], related: [], source: {}, body: 'An untouched source', updatedAt: '2026-11-15T10:00:00Z' }] });
const save = (catalog, reading, revision = 0, assetPath = 'assets/book.pdf') => applyOperation(catalog, { type: 'save-pdf-reading', id: 'b_book', assetPath, expectedRevision: revision, reading });

test('PDF notes persist in canonical metadata while the original and source text stay intact', () => {
  const input = fixture(), result = save(input, { notes: 'My reading notes', annotations: [annotation()] });
  const saved = result.catalog.blocks[0], data = JSON.parse(result.writes[0].content);
  assert.equal(result.writes.length, 1);
  assert.match(result.writes[0].path, /block.json$/);
  assert.equal(data.pdfReading['assets/book.pdf'].revision, 1);
  assert.equal(data.pdfReading['assets/book.pdf'].annotations[0].comment, 'My own thought');
  assert.deepEqual(saved.assets, input.blocks[0].assets);
  assert.equal(saved.body, input.blocks[0].body);
  assert.equal(saved.updatedAt, input.blocks[0].updatedAt, 'reading does not reorder the library');
  assert.equal(input.blocks[0].pdfReading, undefined);
  assert.deepEqual(canonicalRecord(saved).pdfReading, data.pdfReading);
  assert.doesNotThrow(() => validateCatalog(result.catalog));
});

test('PDF save conflicts preserve newer notes and independent attachments have separate revisions', () => {
  const first = save(fixture(), { notes: 'First', annotations: [] }).catalog;
  assert.throws(() => save(first, { notes: 'Stale', annotations: [] }), /changed elsewhere/);
  const other = save(first, { notes: 'Other PDF', annotations: [] }, 0, 'assets/other.pdf').catalog;
  const latest = save(other, { notes: 'Revised', annotations: [annotation()] }, 1).catalog.blocks[0].pdfReading;
  assert.equal(latest['assets/book.pdf'].revision, 2);
  assert.equal(latest['assets/other.pdf'].notes, 'Other PDF');
});

test('malformed or oversized highlight geometry and references cannot enter canonical data', () => {
  for (const change of [{ page: 0 }, { color: 'red' }, { rects: [[.9, .5, .3, .03]] }, { rects: [[0, 0, Infinity, .03]] }, { quote: '' }, { comment: 'x'.repeat(20001) }]) {
    assert.throws(() => validatePDFReading({ ...emptyPDFReading(), annotations: [{ ...annotation(), ...change }] }));
  }
  assert.throws(() => save(fixture(), { notes: '', annotations: [] }, 0, 'assets/missing.pdf'), /could not be found/);
  assert.throws(() => validatePDFReading({ ...emptyPDFReading(), annotations: [annotation(), annotation()] }), /highlight/);
});
