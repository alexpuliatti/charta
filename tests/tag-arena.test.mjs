import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyArenaSnapshot, plainText } from '../scripts/tag-arena.mjs';
import { normalizeTags } from '../shared/taxonomy.mjs';

const snapshot = () => ({
  channels: [
    { id: 1, title: 'Type references', description: { plain: 'Lettering, typography and typefaces.' } },
    { id: 2, title: 'Objects and spaces', description: { plain: 'Furniture and architecture.' } },
  ],
  blocks: [
    { id: 11, type: 'Image', title: 'A new typeface', description: { plain: 'A lettering reference.' }, tags: ['#Lettering', 'lettering'] },
    { id: 12, type: 'Link', title: 'A bamboo chair', source: { url: 'https://example.com/objects' } },
    { id: 13, type: 'Image', title: null },
    { id: 14, type: 'Attachment', title: null },
  ],
  contents: { 1: [{ id: 11 }, { id: 13 }], 2: [{ id: 12 }] },
});

test('classifies every resource using source metadata and shared channel context', () => {
  const data = snapshot();
  const before = structuredClone(data);
  const plan = classifyArenaSnapshot(data);
  assert.equal(Object.keys(plan.blocks).length, 4);
  assert.equal(plan.report.categorized, 4);
  assert.equal(plan.report.tagged, 4);
  assert.equal(plan.blocks[11].category, 'Typography');
  assert.ok(plan.blocks[11].tags.includes('lettering'));
  assert.ok(plan.blocks[13].tags.includes('typography'));
  for (const block of Object.values(plan.blocks)) {
    assert.deepEqual(block.tags, normalizeTags(block.tags));
    assert.ok(block.tags.length >= 3 && block.tags.length <= 8);
    assert.equal(block.classification.visualAnalysis, false);
    assert.equal(block.classification.method, 'assistant-assisted-rules');
  }
  assert.deepEqual(data, before, 'classification leaves original export intact');
});

test('reviewed per-channel folder decisions propagate to untitled contextual material', () => {
  const data = { channels: [{ id: 1, title: 'Collected' }], blocks: [{ id: 5, type: 'Image' }], contents: { 1: [{ id: 5 }] } };
  const plan = classifyArenaSnapshot(data, { overrides: { channels: { 1: { category: 'Art', tags: ['sculpture', 'installation'], folder: { id: 'f_art', title: 'Art', slug: 'art' } } } } });
  assert.equal(plan.channels[1].folder.id, 'f_art');
  assert.equal(plan.blocks[5].category, 'Art');
  assert.ok(plan.blocks[5].tags.includes('sculpture'));
});

test('explicit item overrides take precedence and repeated classification is deterministic', () => {
  const data = snapshot();
  const options = { overrides: { blocks: { 12: { category: 'Interiors', tags: ['bamboo', 'chairs'] } } } };
  const plan = classifyArenaSnapshot(data, options);
  assert.equal(plan.blocks[12].category, 'Interiors');
  assert.ok(plan.blocks[12].tags.includes('bamboo'));
  assert.equal(plan.blocks[12].classification.basis, 'reviewed-context');
  assert.deepEqual(plan, classifyArenaSnapshot(data, options));
});

test('handles object maps and preserves legacy original tags within the data limit', () => {
  const tags = Array.from({ length: 12 }, (_, i) => `source-tag-${i}`);
  const data = { channels: {}, blocks: { 1: { id: 1, type: 'Text', title: 'References', tags } }, contents: {} };
  const plan = classifyArenaSnapshot(data);
  for (const tag of tags) assert.ok(plan.blocks[1].tags.includes(tag));
  assert.equal(plainText({ plain: ' A   plain\n description ' }), 'A plain description');
  assert.equal(plainText('<p>Safe text</p>'), 'Safe text');
});
