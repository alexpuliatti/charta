import { mkdir, readFile, writeFile, cp, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from './library.mjs';
import { canonicalRecord } from '../shared/model.mjs';
import { normalizeTaxonomy } from '../shared/taxonomy.mjs';
import { mediaCandidates, downloadAsset } from './arena-download.mjs';

const text = value => typeof value === 'string' ? value : value?.plain || value?.markdown || '';
const slug = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'channel';
const blockId = id => `b_arena_${id}`;
const channelId = id => `c_arena_${id}`;
const isChannel = item => item.type === 'Channel' || item.base_type === 'Channel';
const validDate = value => Number.isNaN(Date.parse(value || '')) ? new Date().toISOString() : new Date(value).toISOString();
const writeJSON = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(data, null, 2)}\n`); };
async function maybeJSON(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } }

export function arenaChannelURL(channel) {
  if (channel.owner?.slug && channel.slug) return `https://www.are.na/${encodeURIComponent(channel.owner.slug)}/${encodeURIComponent(channel.slug)}`;
  return `https://www.are.na/channel/${channel.id}`;
}

export function arenaMaterialType(block) {
  if (block.type === 'Image') return 'image';
  if (block.type === 'Text') return 'text';
  if (block.type === 'Attachment') {
    const mime = block.attachment?.content_type || '';
    return mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';
  }
  return block.embed?.type === 'video' ? 'video' : 'link';
}

/** Keep real local edits, while replacing the clearly marked starter materials. */
async function prepareExisting(root, stage) {
  const existing = await loadLibrary(root);
  const content = path.join(stage, 'content');
  await cp(path.join(root, 'content'), content, { recursive: true, filter: file => !file.includes(`${path.sep}_generated`) });
  const keptBlocks = existing.blocks.filter(block => !block.sample);
  const keptBlockIds = new Set(keptBlocks.map(block => block.id));
  const keptCollections = existing.collections.filter(collection => !collection.sample || collection.id === existing.library.inboxCollectionId || collection.items.some(item => item.kind === 'block' && keptBlockIds.has(item.id)));
  const keptCollectionIds = new Set(keptCollections.map(collection => collection.id));
  for (const block of existing.blocks.filter(block => block.sample)) await rm(path.join(stage, path.dirname(block.path)), { recursive: true, force: true });
  for (const collection of existing.collections) {
    if (!keptCollectionIds.has(collection.id)) await rm(path.join(stage, path.dirname(collection.path)), { recursive: true, force: true });
    else {
      const record = canonicalRecord(collection);
      delete record.sample;
      record.items = record.items.filter(item => item.kind === 'block' ? keptBlockIds.has(item.id) : keptCollectionIds.has(item.id));
      await writeJSON(path.join(stage, collection.path), record);
    }
  }
  for (const folder of existing.folders) {
    if (!['f_research', 'f_references'].includes(folder.id)) continue;
    if (!keptCollections.some(collection => collection.path.startsWith(`${path.dirname(folder.path)}/`))) await rm(path.join(stage, path.dirname(folder.path)), { recursive: true, force: true });
  }
  return { existing, keptBlocks, keptCollections };
}

/** Import the user's explicit account snapshot. No Are.na token is needed for CDN downloads. */
export async function importArena(snapshot, plan, { root, stage, cacheDirectory, concurrency = 4, log = console.log, downloader = downloadAsset } = {}) {
  if (!snapshot.completedAt) throw new Error('Finish the account snapshot before importing.');
  if (!/^\d+$/.test(String(snapshot.user?.id)) || [...snapshot.blocks, ...snapshot.channels].some(record => !/^\d+$/.test(String(record.id)))) throw new Error('Are.na resource IDs must be positive numeric IDs.');
  if (new Set(snapshot.blocks.map(b => String(b.id))).size !== snapshot.blocks.length || new Set(snapshot.channels.map(c => String(c.id))).size !== snapshot.channels.length) throw new Error('The snapshot contains duplicate resource IDs.');
  if (!path.isAbsolute(stage) || path.resolve(stage) === path.resolve(root)) throw new Error('Use a separate absolute staging directory for imports.');
  if (snapshot.blocks.some(block => !plan.blocks?.[block.id])) throw new Error('The tagging plan does not cover every material.');
  if (snapshot.channels.some(channel => !plan.channels?.[channel.id])) throw new Error('The tagging plan does not cover every channel.');
  const priorState = await maybeJSON(path.join(stage, '.import-state.json'));
  if (priorState && priorState.sourceUserId !== snapshot.user.id) throw new Error('The staging library belongs to another Are.na account.');
  const fresh = !priorState;
  const retained = fresh ? await prepareExisting(root, stage) : { existing: await loadLibrary(root) };
  await writeJSON(path.join(stage, '.import-state.json'), { sourceUserId: snapshot.user.id, sourceSnapshotDate: snapshot.exportedAt });
  const report = { schemaVersion: 1, importedAt: new Date().toISOString(), sourceUser: { id: snapshot.user.id, name: snapshot.user.name, slug: snapshot.user.slug }, accountChannels: snapshot.channels.filter(c => c.importScope !== 'reference').length, linkedChannelReferences: snapshot.channels.filter(c => c.importScope === 'reference').length, materials: snapshot.blocks.length, sourceIssues: snapshot.issues || [], media: { originals: 0, thumbnails: 0, cached: 0, bytes: 0, failures: [], embeddedVideos: [] }, classification: plan.report || {}, connectionCounts: {}, privateChannels: snapshot.channels.filter(c => c.visibility === 'private').map(c => c.id) };
  const folders = new Map();
  for (const channel of snapshot.channels) {
    const folder = plan.channels[channel.id].folder;
    if (!folder?.id || !/^[a-zA-Z][a-zA-Z0-9_-]{0,100}$/.test(folder.id) || !/^[a-z0-9-]+$/.test(folder.slug)) throw new Error('Invalid classification folder.');
    folders.set(folder.id, folder);
  }
  let folderOrder = 0;
  for (const folder of folders.values()) await writeJSON(path.join(stage, 'content/collections', folder.slug, 'folder.json'), { schemaVersion: 1, id: folder.id, title: folder.title, order: folderOrder++, source: { type: 'arena-import-organization' } });
  const channelMap = new Map(snapshot.channels.map(channel => [String(channel.id), channel]));
  const blockMap = new Map(snapshot.blocks.map(block => [String(block.id), block]));
  const connected = new Set();
  for (const channel of snapshot.channels) {
    const classification = plan.channels[channel.id];
    const items = [], seen = new Set();
    for (const resource of snapshot.contents[channel.id] || []) {
      const kind = isChannel(resource) ? 'collection' : 'block';
      if (kind === 'collection' && String(resource.id) === String(channel.id)) continue;
      if (!(kind === 'collection' ? channelMap : blockMap).has(String(resource.id))) throw new Error(`Missing imported connection target ${resource.id}.`);
      const key = `${kind}:${resource.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = { kind, id: kind === 'collection' ? channelId(resource.id) : blockId(resource.id) };
      if (resource.connection) item.sourceConnection = resource.connection;
      items.push(item);
      if (kind === 'block') connected.add(String(resource.id));
    }
    const title = text(channel.title).trim() || `Are.na channel ${channel.id}`;
    const record = { schemaVersion: 1, id: channelId(channel.id), title, description: text(channel.description), category: classification.category, tags: classification.tags, items, createdAt: validDate(channel.created_at), updatedAt: validDate(channel.updated_at), source: { url: arenaChannelURL(channel), arena: { id: channel.id, slug: channel.slug, visibility: channel.visibility, importScope: channel.importScope, originalCounts: channel.counts, originalOwner: channel.owner, metadata: channel.metadata || {} } } };
    await writeJSON(path.join(stage, 'content/collections', classification.folder.slug, `${slug(channel.slug || title)}-${channel.id}`, 'collection.json'), record);
    report.connectionCounts[channel.id] = { blocks: items.filter(i => i.kind === 'block').length, linkedChannels: items.filter(i => i.kind === 'collection').length, sourceReported: channel.counts?.contents, reference: channel.importScope === 'reference' };
  }
  const now = new Date().toISOString();
  let completed = 0;
  let cursor = 0;
  async function worker() {
    while (cursor < snapshot.blocks.length) {
      const raw = snapshot.blocks[cursor++];
      const id = blockId(raw.id), directory = path.join(stage, 'content/blocks', id);
      const previous = await maybeJSON(path.join(directory, 'block.json'));
      const classification = plan.blocks[raw.id];
      const context = classification.classification?.sourceChannelIds?.map(id => channelMap.get(String(id))?.title).filter(Boolean)[0];
      const title = text(classification.title || raw.title).trim() || `${raw.type || 'Material'}${context ? ` · ${context}` : ''} · ${raw.id}`;
      const sourceUrl = raw.source?.url || `https://www.are.na/block/${raw.id}`;
      const record = { schemaVersion: 1, id, type: arenaMaterialType(raw), title, description: text(classification.description || raw.description), ...normalizeTaxonomy(classification), assets: [], related: previous?.related || [], createdAt: validDate(raw.created_at), updatedAt: validDate(raw.updated_at), classification: classification.classification, source: { url: sourceUrl, title: raw.source?.title || title, capturedAt: now, ...(raw.embed?.url || raw.embed?.source_url || raw.embed?.type === 'video' ? { embedUrl: raw.embed?.url || raw.embed?.source_url || sourceUrl } : {}), arena: { id: raw.id, url: `https://www.are.na/block/${raw.id}`, type: raw.type, visibility: raw.visibility, originalTitle: raw.title || '', createdAt: raw.created_at, updatedAt: raw.updated_at, addedBy: raw.user ? { id: raw.user.id, name: raw.user.name, slug: raw.user.slug } : null, metadata: raw.metadata || {} } } };
      const body = raw.content?.markdown || raw.content?.plain || (typeof raw.content === 'string' ? raw.content : '');
      await mkdir(directory, { recursive: true });
      if (body) { record.bodyPath = 'body.md'; await writeFile(path.join(directory, 'body.md'), body); }
      if (raw.embed?.type === 'video' && !raw.attachment?.url) report.media.embeddedVideos.push({ id: raw.id, source: sourceUrl, localOriginalAvailable: false });
      for (const candidate of mediaCandidates(raw)) {
        let asset;
        const existingAsset = previous?.source?.arena?.updatedAt === raw.updated_at && previous.assets?.find(a => a.role === candidate.role);
        if (existingAsset) {
          try { const stat = await lstat(path.join(directory, existingAsset.path)); if (stat.isFile() && stat.size === existingAsset.bytes) asset = existingAsset; } catch { /* A missing partial download is retried. */ }
        }
        try {
          if (!asset) {
            const result = await downloader(candidate, directory, { cacheDirectory });
            asset = result.asset;
            if (result.status === 'cached') report.media.cached++;
          } else report.media.cached++;
          record.assets.push(asset);
          const countKey = asset.role === 'original' ? 'originals' : asset.role === 'preview' ? 'previews' : 'thumbnails';
          report.media[countKey] = (report.media[countKey] || 0) + 1;
          report.media.bytes += asset.bytes;
        } catch (error) {
          report.media.failures.push({ arenaId: raw.id, role: candidate.role, code: error.code || 'DOWNLOAD_FAILED', status: error.status || null, message: error.message });
          log(`Media unavailable: block ${raw.id}, ${candidate.role} (${error.code || 'network'}).`);
        }
      }
      // Existing optimized derivatives remain valid only for an unchanged source.
      if (previous?.source?.arena?.updatedAt === raw.updated_at) record.assets.push(...(previous.assets || []).filter(a => a.role === 'optimized'));
      await writeJSON(path.join(directory, 'block.json'), record);
      completed++;
      if (completed % 20 === 0 || completed === snapshot.blocks.length) {
        await writeJSON(path.join(stage, '.media-progress.json'), { completed, total: snapshot.blocks.length, bytes: report.media.bytes, failures: report.media.failures.length });
        log(`Imported ${completed}/${snapshot.blocks.length} materials · ${Math.round(report.media.bytes / 1048576)} MiB saved · ${report.media.failures.length} media failures.`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, Math.max(1, concurrency)) }, worker));
  const inboxId = retained.existing.library.inboxCollectionId;
  // Older libraries can retain their destination; new libraries leave unfiled materials in the archive.
  if (inboxId) {
    const currentInbox = (await loadLibrary(stage)).collections.find(c => c.id === inboxId);
    if (!currentInbox) throw new Error('Missing legacy collection after staging import.');
    const inbox = canonicalRecord(currentInbox);
    const seen = new Set(inbox.items.map(i => `${i.kind}:${i.id}`));
    for (const raw of snapshot.blocks.filter(block => !connected.has(String(block.id)))) {
      const id = blockId(raw.id); if (!seen.has(`block:${id}`)) inbox.items.push({ kind: 'block', id });
    }
    await writeJSON(path.join(stage, currentInbox.path), inbox);
  }
  report.unfiledMaterials = snapshot.blocks.filter(block => !connected.has(String(block.id))).length;
  await writeJSON(path.join(stage, 'content/library.json'), { ...retained.existing.library, title: 'Charta', description: 'Your Are.na library, organized and connected.', sampleContent: false, importedFrom: { service: 'are.na', userId: snapshot.user.id, username: snapshot.user.slug, importedAt: report.importedAt } });
  const sourceDirectory = path.join(stage, 'content/imports/arena');
  report.completedAt = new Date().toISOString();
  await writeJSON(path.join(sourceDirectory, 'source.json'), snapshot);
  await writeJSON(path.join(sourceDirectory, 'classification.json'), plan);
  await writeJSON(path.join(sourceDirectory, 'report.json'), report);
  await loadLibrary(stage);
  await writeJSON(path.join(stage, '.import-complete.json'), { completedAt: new Date().toISOString(), materials: snapshot.blocks.length });
  log(JSON.stringify({ stage, materials: snapshot.blocks.length, accountChannels: report.accountChannels, linkedReferences: report.linkedChannelReferences, unfiled: report.unfiledMaterials, originals: report.media.originals, thumbnails: report.media.thumbnails, bytes: report.media.bytes, failures: report.media.failures.length }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [snapshotPath, planPath, stage] = process.argv.slice(2);
  if (!stage) throw new Error('Usage: node scripts/import-arena.mjs snapshot.json classification.json staging-library-root');
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    await importArena(snapshot, plan, { root, stage: path.resolve(stage), cacheDirectory: path.join(path.dirname(path.resolve(stage)), 'media-cache') });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
