import { mkdir, writeFile, rename, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArenaClient, readTemporaryToken } from './arena-client.mjs';

const asObject = body => body.data && !Array.isArray(body.data) ? body.data : body;
const kind = item => item.base_type === 'Channel' || item.type === 'Channel' ? 'channel' : 'block';

export async function collectArena(client, output, { log = console.log } = {}) {
  await mkdir(path.dirname(output), { recursive: true });
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const me = asObject(await client.get('/v3/me'));
  if (previous && previous.user.id !== me.id) throw new Error('The cached snapshot belongs to another account.');
  const user = { id: me.id, name: me.name, slug: me.slug, username: me.username, tier: me.tier, counts: me.counts };
  const snapshot = previous || { schemaVersion: 1, exportedAt: new Date().toISOString(), user, channels: [], blocks: [], contents: {}, groups: [], issues: [], inventory: {} };
  const channels = new Map(snapshot.channels.map(c => [String(c.id), c]));
  const blocks = new Map(snapshot.blocks.map(b => [String(b.id), b]));
  const checkpoint = async () => {
    snapshot.channels = [...channels.values()]; snapshot.blocks = [...blocks.values()];
    const temporary = `${output}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 }); await rename(temporary, output);
  };
  log(`Reading account inventory (${me.counts?.channels ?? '?'} channels reported).`);
  const owned = await client.list(`/v3/users/${me.id}/contents?type=Channel`);
  snapshot.inventory.ownedChannels = { fetched: owned.data.length, expected: owned.expected };
  for (const channel of owned.data) channels.set(String(channel.id), { ...channel, importScope: 'account' });
  const created = await client.list(`/v3/users/${me.id}/contents?type=Block`);
  snapshot.inventory.createdBlocks = { fetched: created.data.length, expected: created.expected };
  for (const block of created.data) blocks.set(String(block.id), block);
  const groups = await client.list(`/v3/users/${me.id}/groups`);
  snapshot.groups = groups.data.map(g => ({ id: g.id, name: g.name, slug: g.slug }));
  log(`Found ${owned.data.length} account channels, ${created.data.length} created blocks, and ${groups.data.length} groups.`);
  for (const group of groups.data) {
    try {
      const list = await client.list(`/v3/groups/${group.id}/contents?type=Channel`);
      for (const channel of list.data) if (!channels.has(String(channel.id))) channels.set(String(channel.id), { ...channel, importScope: 'group', importGroupId: group.id });
    } catch (error) { snapshot.issues.push({ resource: 'group', id: group.id, status: error.status || null, message: error.message }); }
  }
  await checkpoint();
  const primary = [...channels.values()].filter(c => c.importScope !== 'reference');
  for (let index = 0; index < primary.length; index++) {
    const channel = primary[index];
    const id = String(channel.id);
    if (snapshot.contents[id]) { log(`Channel ${index + 1}/${primary.length}: using saved checkpoint (${snapshot.contents[id].length} entries).`); continue; }
    try {
      const full = asObject(await client.get(`/v3/channels/${id}`));
      channels.set(id, { ...full, importScope: channel.importScope, ...(channel.importGroupId ? { importGroupId: channel.importGroupId } : {}) });
      const list = await client.list(`/v3/channels/${id}/contents?sort=position_asc`);
      snapshot.contents[id] = list.data;
      for (const entry of list.data) {
        if (kind(entry) === 'channel') {
          if (!channels.has(String(entry.id))) channels.set(String(entry.id), { ...entry, importScope: 'reference' });
        } else blocks.set(String(entry.id), { ...blocks.get(String(entry.id)), ...entry });
      }
      snapshot.inventory[`channel:${id}`] = { fetched: list.data.length, expected: list.expected, reported: full.counts?.contents };
      if (list.expected !== undefined && list.data.length !== list.expected) snapshot.issues.push({ resource: 'channel-count', id: channel.id, fetched: list.data.length, expected: list.expected });
      log(`Channel ${index + 1}/${primary.length}: ${list.data.length} entries captured.`);
      await checkpoint();
    } catch (error) { snapshot.issues.push({ resource: 'channel', id: channel.id, status: error.status || null, message: error.message }); await checkpoint(); log(`Channel ${index + 1}/${primary.length}: could not read (${error.status || 'network'}).`); }
  }
  // Resource lists normally contain full blocks. Fetch only incomplete records.
  const incomplete = [...blocks.values()].filter(b => !b.type || (b.type === 'Image' && !b.image) || (b.type === 'Attachment' && !b.attachment) || (b.type === 'Text' && !b.content));
  for (let index = 0; index < incomplete.length; index++) {
    const block = incomplete[index];
    try { blocks.set(String(block.id), { ...block, ...asObject(await client.get(`/v3/blocks/${block.id}`)) }); }
    catch (error) { snapshot.issues.push({ resource: 'block', id: block.id, status: error.status || null, message: error.message }); }
    if (index % 25 === 0) { await checkpoint(); log(`Hydrating incomplete records: ${index + 1}/${incomplete.length}.`); }
  }
  snapshot.completedAt = new Date().toISOString();
  await checkpoint();
  log(JSON.stringify({ snapshot: output, channels: snapshot.channels.length, primaryChannels: primary.length, blocks: snapshot.blocks.length, blockTypes: snapshot.blocks.reduce((map, block) => ({ ...map, [block.type]: (map[block.type] || 0) + 1 }), {}), privateChannels: snapshot.channels.filter(c => c.visibility === 'private' || c.status === 'private').length, issues: snapshot.issues.length }));
  return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node scripts/collect-arena.mjs /absolute/staging/snapshot.json');
  try { const token = await readTemporaryToken(); const client = new ArenaClient(token, { log: console.log }); await collectArena(client, path.resolve(output)); client.token = ''; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
