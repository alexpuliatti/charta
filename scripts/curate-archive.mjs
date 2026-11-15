import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from './library.mjs';
import { canonicalRecord, safeContentPath } from '../shared/model.mjs';
import { normalizeTags } from '../shared/taxonomy.mjs';

const VERSION = 'artifact-curation-v1';
const slug = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); };
const sections = ['Writing', 'Graphic design', 'Interface design', 'Companies', 'Architecture', 'Objects', 'Sound', 'Technology', 'Culture'];

/** Checked-in plan is the review record. Applying it is deliberately a one-time migration. */
export async function applyCuration(root, plan, { apply = false } = {}) {
  const catalog = await loadLibrary(root);
  if (catalog.library.curation?.version === VERSION) throw new Error('This curation has already been applied. Use --check to audit it.');
  const byId = new Map(catalog.blocks.map(block => [block.id, block]));
  if (plan.version !== VERSION || plan.blocks.length !== catalog.blocks.length || new Set(plan.blocks.map(block => block.id)).size !== catalog.blocks.length) throw new Error('Plan must cover every material exactly once.');
  const memberships = new Map(), counts = {};
  for (const entry of plan.blocks) {
    const block = byId.get(entry.id);
    if (!block || entry.originalTitle !== block.title || !entry.title?.trim() || entry.title.split(/\s+/).length > 3 || !sections.includes(entry.section) || !entry.subsection?.trim()) throw new Error(`Invalid or outdated curation entry: ${entry.id}`);
    counts[entry.section] = (counts[entry.section] || 0) + 1;
    for (const membership of entry.memberships) {
      if (!sections.includes(membership.section) || !membership.subsection?.trim()) throw new Error(`Invalid membership: ${entry.id}`);
      const key = `${membership.section}/${membership.subsection}`;
      if (!memberships.has(key)) memberships.set(key, new Set());
      memberships.get(key).add(entry.id);
    }
  }
  for (const connection of plan.articleSuggestions) if (!byId.has(connection.sourceId) || !byId.has(connection.targetId) || connection.authoredLink !== false) throw new Error('Suggested reading connection must reference saved materials and remain distinct from authored links.');
  const report = { version: VERSION, createdAt: plan.generatedAt, materials: plan.blocks.length, sections: counts, subsections: memberships.size, visuallyReviewed: plan.blocks.filter(block => block.visualReview).length, extractedText: plan.blocks.filter(block => block.artifact?.text).length, sourceReviewNeeded: plan.blocks.filter(block => block.needsSourceReview).map(block => ({ id: block.id, title: block.title, reason: block.reason })), articleConnections: plan.articleSuggestions.length, originalCollections: catalog.collections.length, mediaPreserved: catalog.blocks.reduce((count, block) => count + block.assets.length, 0) };
  if (!apply) return report;

  const backup = { version: VERSION, createdAt: plan.generatedAt, library: catalog.library, folders: catalog.folders, collections: catalog.collections, blocks: catalog.blocks.map(block => ({ id: block.id, title: block.title, category: block.category, tags: block.tags, classification: block.classification, collectionIds: block.collectionIds, assetHashes: block.assets.map(asset => ({ path: asset.path, sha256: asset.sha256 })) })) };
  await save(path.join(root, 'content/imports/curation/before.json'), backup);
  const portablePlan = structuredClone(plan);
  portablePlan.summary = { blocks: plan.blocks.length, reviewed: plan.blocks.length, mediaPendingVisual: 0, sourceReviewNeeded: report.sourceReviewNeeded.length, sectionCounts: counts, articleSuggestions: plan.articleSuggestions.length };
  for (const entry of portablePlan.blocks) {
    if (entry.generatedThumbnail) entry.generatedThumbnail.sourcePath = entry.generatedThumbnail.path;
    if (entry.extractedText) entry.extractedText.sourcePath = `content/blocks/${entry.id}/${entry.artifact.textPath}`;
  }
  await save(path.join(root, 'content/imports/curation/plan.json'), portablePlan);
  const archive = path.join(root, 'content/collections/archive');
  await mkdir(archive, { recursive: true });
  await save(path.join(archive, 'folder.json'), { schemaVersion: 1, id: 'f_curated_archive', title: 'Archive', order: sections.length, source: { type: 'preserved-original-collections', version: VERSION } });
  for (const folder of catalog.folders.filter(folder => folder.parentId === null)) {
    const old = path.join(root, path.dirname(folder.path));
    await rename(old, path.join(archive, path.basename(old)));
  }
  for (const collection of catalog.collections.filter(collection => collection.parentId === null && collection.id !== catalog.library.inboxCollectionId)) {
    const old = path.join(root, path.dirname(collection.path));
    await rename(old, path.join(archive, path.basename(old)));
  }
  for (const [order, title] of sections.entries()) {
    const directory = path.join(root, 'content/collections', slug(title));
    await save(path.join(directory, 'folder.json'), { schemaVersion: 1, id: `f_curated_${slug(title).replaceAll('-', '_')}`, title, order, source: { type: 'artifact-curation', version: VERSION } });
    for (const [key, ids] of [...memberships].filter(([key]) => key.startsWith(`${title}/`)).sort(([left], [right]) => left.localeCompare(right))) {
      const subsection = key.slice(title.length + 1);
      const items = [...ids].map(id => byId.get(id)).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.id.localeCompare(right.id)).map(block => ({ kind: 'block', id: block.id }));
      await save(path.join(directory, slug(subsection), 'collection.json'), { schemaVersion: 1, id: `c_curated_${slug(title).replaceAll('-', '_')}_${slug(subsection).replaceAll('-', '_')}`, title: subsection, description: '', items, source: { type: 'artifact-curation', version: VERSION } });
    }
  }
  const suggestions = new Map();
  for (const connection of plan.articleSuggestions) for (const [from, to] of [[connection.sourceId, connection.targetId], [connection.targetId, connection.sourceId]]) {
    if (!suggestions.has(from)) suggestions.set(from, []);
    suggestions.get(from).push({ id: to, reason: connection.reason, method: 'curation-v1' });
  }
  for (const entry of plan.blocks) {
    const original = byId.get(entry.id), block = canonicalRecord(original);
    block.title = entry.title;
    block.category = entry.section;
    block.tags = normalizeTags(entry.tags);
    block.curation = { version: VERSION, reviewedAt: plan.generatedAt, section: entry.section, subsection: entry.subsection, genre: entry.genre, confidence: entry.confidence, needsSourceReview: Boolean(entry.needsSourceReview), evidence: entry.evidence || [], original: { title: original.title, category: original.category, tags: original.tags, collectionIds: original.collectionIds } };
    block.classification = { method: entry.visualReview ? 'artifact-visual-review-and-ocr' : 'saved-text-and-source-review', version: VERSION, visualAnalysis: Boolean(entry.visualReview), basis: entry.reason };
    if (entry.artifact) block.artifact = entry.artifact;
    if (entry.visualReview) for (const asset of block.assets) if (asset.mimeType.startsWith('image/')) asset.alt = entry.title;
    if (suggestions.has(block.id)) block.suggestedRelated = suggestions.get(block.id);
    if (entry.generatedThumbnail) {
      const source = path.join(root, entry.generatedThumbnail.path);
      const bytes = await readFile(entry.generatedThumbnail.sourcePath);
      if (hash(bytes) !== entry.generatedThumbnail.sha256) throw new Error('Generated thumbnail integrity mismatch.');
      await mkdir(path.dirname(source), { recursive: true });
      await writeFile(source, bytes);
      block.assets.push({ path: entry.generatedThumbnail.path.split('/').slice(3).join('/'), mimeType: 'image/jpeg', role: 'thumbnail', alt: entry.title, bytes: bytes.length, sha256: hash(bytes), derivation: { method: 'ffmpeg-representative-frame', timeSeconds: 1 } });
    }
    if (entry.extractedText) {
      const text = await readFile(entry.extractedText.sourcePath);
      if (hash(text) !== block.artifact.textSha256) throw new Error('Extracted text integrity mismatch.');
      await writeFile(path.join(root, path.dirname(original.path), block.artifact.textPath), text);
    }
    await save(path.join(root, original.path), block);
  }
  const library = { ...catalog.library, curation: { version: VERSION, completedAt: plan.generatedAt, materials: plan.blocks.length, reportPath: 'content/imports/curation/report.json' } };
  await save(path.join(root, 'content/library.json'), library);
  await save(path.join(root, 'content/imports/curation/report.json'), report);
  await checkCuration(root);
  return report;
}

export async function checkCuration(root) {
  const catalog = await loadLibrary(root);
  const before = await json(path.join(root, 'content/imports/curation/before.json'));
  const plan = await json(path.join(root, 'content/imports/curation/plan.json'));
  const retiredCollections = new Map();
  const retiredPath = catalog.library.curation?.retiredCollectionsPath;
  if (retiredPath) {
    safeContentPath(retiredPath);
    if (!retiredPath.startsWith('content/imports/curation/') || !retiredPath.endsWith('.json')) throw new Error('Invalid retired collection history path.');
    const history = await json(path.join(root, retiredPath));
    if (history.schemaVersion !== 1 || !Array.isArray(history.collections)) throw new Error('Invalid retired collection history.');
    for (const collection of history.collections) {
      if (collection?.schemaVersion !== 1 || typeof collection.id !== 'string' || !Array.isArray(collection.items) || retiredCollections.has(collection.id)) throw new Error('Invalid retired collection history.');
      retiredCollections.set(collection.id, collection);
    }
  }
  const originalCollections = new Map(catalog.collections.map(collection => [collection.id, collection]));
  for (const collection of before.collections) {
    const preserved = originalCollections.get(collection.id) || retiredCollections.get(collection.id);
    if (JSON.stringify(preserved?.items) !== JSON.stringify(collection.items)) throw new Error(`Original collection changed: ${collection.id}`);
  }
  const current = new Map(catalog.blocks.map(block => [block.id, block]));
  if (before.blocks.some(block => !current.has(block.id))) throw new Error('An original material is missing.');
  for (const old of before.blocks) {
    const block = current.get(old.id), entry = plan.blocks.find(entry => entry.id === old.id);
    if (!block || block.title !== entry.title || block.title.split(/\s+/).length > 3 || block.category !== entry.section || !block.tags.length || !block.collectionIds.some(id => id.startsWith('c_curated_'))) throw new Error(`Incomplete curation: ${old.id}`);
    for (const asset of old.assetHashes) if (!block.assets.some(value => value.path === asset.path && value.sha256 === asset.sha256)) throw new Error(`Original asset changed: ${old.id}`);
    if (block.artifact?.textPath) {
      const bytes = await readFile(path.join(root, path.dirname(block.path), block.artifact.textPath));
      if (hash(bytes) !== block.artifact.textSha256) throw new Error(`Extracted text changed: ${block.id}`);
    }
  }
  return { materials: catalog.blocks.length, originalMaterials: before.blocks.length, addedMaterials: current.size - before.blocks.length, originalCollections: before.collections.length, retiredCollections: retiredCollections.size, curatedCollections: catalog.collections.filter(collection => collection.id.startsWith('c_curated_')).length, preservedAssets: before.blocks.reduce((count, block) => count + block.assetHashes.length, 0), state: 'ready' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), root = path.resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd());
  if (args.includes('--check')) console.log(JSON.stringify(await checkCuration(root), null, 2));
  else {
    const file = args.includes('--plan') ? args[args.indexOf('--plan') + 1] : path.join(root, 'content/imports/curation/plan.json');
    console.log(JSON.stringify(await applyCuration(root, await json(file), { apply: args.includes('--apply') }), null, 2));
  }
}
