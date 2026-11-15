import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const items = value => Array.isArray(value) ? value : Object.values(value || {});
const id = value => String(value);
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const isChannel = row => row?.type === 'Channel' || row?.base_type === 'Channel';
const isBlock = row => row?.base_type === 'Block' || ['Text', 'Image', 'Link', 'Attachment', 'Embed', 'Pending'].includes(row?.type);

/** Reconcile actual returned rows with source counts without guessing why rows are absent. */
export function auditSnapshot(snapshot) {
  const channels = items(snapshot.channels), blocks = items(snapshot.blocks);
  const blockIds = new Set(blocks.map(block => id(block.id)));
  const channelIds = new Set(channels.map(channel => id(channel.id)));
  const primary = channels.filter(channel => channel.importScope !== 'reference');
  const referencedBlocks = new Set(), unresolvedBlocks = new Set(), unresolvedChannels = new Set();
  const rows = primary.map(channel => {
    const contents = snapshot.contents?.[id(channel.id)];
    const returned = Array.isArray(contents) ? contents : [];
    const blockRows = returned.filter(isBlock), channelRows = returned.filter(isChannel);
    for (const block of blockRows) { referencedBlocks.add(id(block.id)); if (!blockIds.has(id(block.id))) unresolvedBlocks.add(id(block.id)); }
    for (const child of channelRows) if (!channelIds.has(id(child.id))) unresolvedChannels.add(id(child.id));
    const reportedBlocks = count(channel.counts?.blocks), reportedChannels = count(channel.counts?.channels);
    return {
      id: channel.id, title: channel.title, scope: channel.importScope || 'unspecified', contentsFetched: Array.isArray(contents),
      reportedBlocks, returnedBlocks: blockRows.length,
      blockDifference: reportedBlocks === null ? null : reportedBlocks - blockRows.length,
      reportedChannels, returnedChannels: channelRows.length,
      channelDifference: reportedChannels === null ? null : reportedChannels - channelRows.length,
      reportedContents: count(channel.counts?.contents), returnedContents: returned.length,
      unknownContentRows: returned.filter(row => !isBlock(row) && !isChannel(row)).length,
    };
  });
  const missingChannelRefs = rows.filter(row => row.channelDifference > 0).map(row => ({
    channelId: row.id, title: row.title, reported: row.reportedChannels, returned: row.returnedChannels, missing: row.channelDifference,
  }));
  const total = key => rows.reduce((sum, row) => sum + (row[key] || 0), 0);
  const uniqueBlocks = new Map(blocks.map(block => [id(block.id), block]));
  const userCreatedBlockCount = snapshot.user?.id == null ? 0 : [...uniqueBlocks.values()].filter(block => block.user?.id != null && id(block.user.id) === id(snapshot.user.id)).length;
  return {
    primaryChannels: primary.length,
    referenceChannels: channels.filter(channel => channel.importScope === 'reference').length,
    channelsByScope: channels.reduce((map, channel) => { const scope = channel.importScope || 'unspecified'; map[scope] = (map[scope] || 0) + 1; return map; }, {}),
    uniqueBlocks: uniqueBlocks.size, blockRecordDuplicates: blocks.length - uniqueBlocks.size,
    userCreatedBlockCount, otherAuthorsBlockCount: uniqueBlocks.size - userCreatedBlockCount,
    uniqueBlocksInPrimaryChannels: referencedBlocks.size,
    blocksOutsidePrimaryChannels: [...blockIds].filter(blockId => !referencedBlocks.has(blockId)).length,
    accountInventory: {
      reportedOwnedChannels: count(snapshot.user?.counts?.channels),
      ownedChannelsEndpoint: snapshot.inventory?.ownedChannels || null,
      createdBlocksEndpoint: snapshot.inventory?.createdBlocks || null,
    },
    blockConnections: { reported: total('reportedBlocks'), returned: total('returnedBlocks'), allCountsMatch: rows.every(row => row.contentsFetched && row.reportedBlocks !== null && row.blockDifference === 0) },
    channelConnections: { reported: total('reportedChannels'), returned: total('returnedChannels') },
    missingChannelRefCount: missingChannelRefs.reduce((sum, row) => sum + row.missing, 0),
    missingChannelRefs,
    unresolvedMaterialReferenceIds: [...unresolvedBlocks].sort(),
    unresolvedChannelReferenceIds: [...unresolvedChannels].sort(),
    channels: rows,
    conclusion: 'Differences compare reported resource counts with returned rows. They do not establish whether absent channel references are private, deleted, inaccessible, or stale counts.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/audit-arena.mjs /path/to/snapshot.json');
  const snapshot = JSON.parse(await readFile(path.resolve(process.argv[2]), 'utf8'));
  console.log(JSON.stringify(auditSnapshot(snapshot), null, 2));
}
