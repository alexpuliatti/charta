import { readFile, writeFile, rename, rm, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROCESSOR = 'charta-preview-webp-1';
const ENCODE = String.raw`
import sys,json,io
from PIL import Image,ImageOps
with Image.open(sys.argv[1]) as source:
    if getattr(source,'is_animated',False):
        print(json.dumps({'skipped':True}));sys.exit(0)
    image=ImageOps.exif_transpose(source)
    image=image.convert('RGBA' if image.mode in ('RGBA','LA') or 'transparency' in image.info else 'RGB')
    image.thumbnail((2560,2560),Image.Resampling.LANCZOS)
    lossy=io.BytesIO();image.save(lossy,'WEBP',quality=90,method=4,exact=True)
    lossless=io.BytesIO();image.save(lossless,'WEBP',lossless=True,method=4,exact=True)
    # Prefer crisp lossless screenshots when the storage difference is small.
    data=lossless.getvalue() if len(lossless.getvalue())<=len(lossy.getvalue())*1.25 else lossy.getvalue()
    with open(sys.argv[2],'wb') as output:output.write(data)
    print(json.dumps({'width':image.width,'height':image.height,'lossless':data==lossless.getvalue()}))
`;

export async function optimizePreview(asset, directory, { toolsDirectory = process.env.JELLY_MEDIA_TOOLS, python = 'python3' } = {}) {
  if (asset.role !== 'preview' || asset.optimization?.processor === PROCESSOR) return asset;
  const source = path.join(directory, asset.path), temporary = path.join(directory, `assets/.preview-${randomUUID()}.webp`);
  try {
    const metadata = await new Promise((resolve, reject) => {
      const child = spawn(python, ['-c', ENCODE, source, temporary], { env: { ...process.env, PYTHONPATH: [toolsDirectory, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Preview encoding timed out.')); }, 60000);
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { error = (error + data).slice(-1500); });
      child.once('error', failure => { clearTimeout(timeout); reject(failure); });
      child.once('close', code => { clearTimeout(timeout); if (code) reject(new Error(`Preview encoding failed: ${error}`)); else { try { resolve(JSON.parse(output)); } catch { reject(new Error('Invalid encoder result.')); } } });
    });
    if (metadata.skipped) return asset;
    const bytes = await readFile(temporary);
    if (bytes.length >= asset.bytes) return asset;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const relative = `assets/preview-${hash.slice(0, 24)}.webp`;
    await rename(temporary, path.join(directory, relative));
    return { ...asset, path: relative, mimeType: 'image/webp', bytes: bytes.length, sha256: hash,
      originalName: asset.originalName.replace(/\.[^.]+$/, '') + '.webp',
      optimization: { processor: PROCESSOR, sourceBytes: asset.bytes, ...metadata } };
  } finally { await rm(temporary, { force: true }); }
}

export async function optimizePreviews(root, options = {}) {
  const base = path.join(root, 'content/blocks'), entries = await readdir(base, { withFileTypes: true });
  const report = { optimized: 0, beforeBytes: 0, afterBytes: 0, failures: [] }; let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor++]; if (!entry.isDirectory()) continue;
      const directory = path.join(base, entry.name), filename = path.join(directory, 'block.json');
      try {
        const record = await readFile(filename, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!record) continue;
        const source = record.assets.find(asset => asset.role === 'preview' && asset.optimization?.processor !== PROCESSOR);
        if (!source) continue;
        const optimized = await optimizePreview(source, directory, options);
        report.beforeBytes += source.bytes; report.afterBytes += optimized.bytes;
        if (source.path === optimized.path) continue;
        const latest = JSON.parse(await readFile(filename, 'utf8'));
        const index = latest.assets.findIndex(asset => asset.path === source.path && asset.sha256 === source.sha256);
        if (index < 0) continue;
        latest.assets[index] = optimized;
        const temporary = `${filename}.optimize-${randomUUID()}`;
        await writeFile(temporary, `${JSON.stringify(latest, null, 2)}\n`); await rename(temporary, filename);
        await rm(path.join(directory, source.path));
        report.optimized++;
      } catch (error) { report.failures.push({ id: entry.name, message: error.message }); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  optimizePreviews(fileURLToPath(new URL('../', import.meta.url)), { toolsDirectory: process.argv[2] })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
