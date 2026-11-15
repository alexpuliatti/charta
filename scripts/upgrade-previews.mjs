import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary } from './library.mjs';
import { downloadAsset, mediaCandidates } from './arena-download.mjs';

/** Add full-size source screenshots while preserving thumbnails and authored records. */
export async function upgradePreviews(root, { download = downloadAsset, concurrency = 6, log = () => {} } = {}) {
  root = path.resolve(root);
  const catalog = await loadLibrary(root);
  const snapshot = JSON.parse(await readFile(path.join(root, 'content/imports/arena/source.json'), 'utf8'));
  const sources = new Map(snapshot.blocks.map(block => [String(block.id), block]));
  const pending = catalog.blocks.filter(block => block.assets.some(asset => asset.role === 'thumbnail') && !block.assets.some(asset => asset.mimeType.startsWith('image/') && asset.role !== 'thumbnail'));
  const report = { examined: pending.length, upgraded: 0, unavailable: 0, bytes: 0, failures: [] };
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const block = pending[cursor++], raw = sources.get(String(block.source?.arena?.id));
      const candidate = raw && mediaCandidates(raw).find(item => item.role === 'preview');
      if (!candidate) { report.unavailable++; continue; }
      try {
        const filename = path.join(root, block.path);
        const { asset } = await download(candidate, path.dirname(filename), { maxBytes: 30 * 1024 * 1024, timeoutMs: 20000 });
        const latest = JSON.parse(await readFile(filename, 'utf8'));
        if (latest.assets.some(item => item.role === 'preview')) continue;
        latest.assets.push(asset);
        const temporary = `${filename}.preview-${randomUUID()}`;
        await writeFile(temporary, `${JSON.stringify(latest, null, 2)}\n`, { flag: 'wx' });
        await rename(temporary, filename);
        report.upgraded++; report.bytes += asset.bytes;
        if (report.upgraded % 25 === 0) log(`${report.upgraded} full-size previews saved`);
      } catch (error) { report.failures.push({ id: block.id, message: error.message }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), 8) }, worker));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  upgradePreviews(fileURLToPath(new URL('../', import.meta.url)), { log: console.log })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
