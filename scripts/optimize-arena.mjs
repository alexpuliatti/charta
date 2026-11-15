import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, stat, lstat, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optimizePreviews } from './optimize-previews.mjs';

const VERSION = 'jelly-media-1';
const MAX_OUTPUT_BYTES = 95 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/x-m4v', 'video/quicktime']);
const IMAGE_SETTINGS = Object.freeze({ format: 'webp', maxLongEdge: 2000, quality: 84, method: 6, alpha: 'preserved', exifOrientation: 'applied', animated: 'preserve-original' });
const VIDEO_SETTINGS = Object.freeze({ format: 'mp4', videoCodec: 'h264', audioCodec: 'aac', maxLongEdge: 1280, maxFps: 30, crf: 25, preset: 'medium', threads: 2, fastStart: true });

const IMAGE_SCRIPT = String.raw`
import sys,json,io
from PIL import Image,ImageOps,ImageCms
source,destination=sys.argv[1:3]
with Image.open(source) as original:
    if getattr(original,'is_animated',False) and getattr(original,'n_frames',1)>1:
        print(json.dumps({'status':'animated-original','frames':original.n_frames}));sys.exit(0)
    image=ImageOps.exif_transpose(original)
    alpha=image.mode in ('RGBA','LA') or (image.mode=='P' and 'transparency' in image.info)
    mode='RGBA' if alpha else 'RGB'
    profile=image.info.get('icc_profile')
    if profile:
        try:
            image=ImageCms.profileToProfile(image,ImageCms.ImageCmsProfile(io.BytesIO(profile)),ImageCms.createProfile('sRGB'),outputMode=mode)
        except Exception:
            image=image.convert(mode)
    else:
        image=image.convert(mode)
    image.thumbnail((2000,2000),Image.Resampling.LANCZOS)
    image.save(destination,format='WEBP',quality=84,method=6,exact=True)
    print(json.dumps({'status':'optimized','width':image.width,'height':image.height,'alpha':alpha}))
`;

async function fileExists(filename) {
  try { return await stat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function safeAssetPath(value) {
  if (typeof value !== 'string' || !value.startsWith('assets/') || value.includes('\\') || /[\u0000-\u001f?#%]/u.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe media asset path.');
  return value;
}
async function assertRegularFile(filename) {
  const information = await lstat(filename);
  if (!information.isFile() || information.isSymbolicLink()) throw new Error('Media inputs must be regular files.');
  return information;
}
async function digest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: options.env || process.env });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Media processing timed out.')); }, options.timeout || 30 * 60 * 1000);
    child.stdout.on('data', chunk => { if (stdout.length < 100000) stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Media encoder failed (${code}): ${stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500)}`));
    });
  });
}

export function videoArguments(source, destination) {
  const scale = "scale=w='max(2,trunc(iw*min(1,1280/max(iw,ih))/2)*2)':h='max(2,trunc(ih*min(1,1280/max(iw,ih))/2)*2)':flags=lanczos,setsar=1,fps=fps='min(source_fps,30)'";
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2', '-i', source,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-vf', scale,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-pix_fmt', 'yuv420p', '-threads', '2',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', destination];
}

export async function discoverTools(tools, options = {}) {
  const python = options.python || process.env.JELLY_PYTHON || 'python3';
  const directory = path.resolve(tools);
  const probe = 'import sys,json;sys.path.insert(0,sys.argv[1]);import PIL,imageio_ffmpeg;print(json.dumps({"pillow":PIL.__version__,"ffmpeg":imageio_ffmpeg.get_ffmpeg_exe(),"ffmpegVersion":imageio_ffmpeg.get_ffmpeg_version()}))';
  const result = await runProcess(python, ['-c', probe, directory], { timeout: 30000 });
  return { python, directory, ...JSON.parse(result.stdout) };
}

async function optimizeImage(source, destination, tools) {
  const environment = { ...process.env, PYTHONPATH: [tools.directory, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
  const result = await runProcess(tools.python, ['-c', IMAGE_SCRIPT, source, destination], { env: environment, timeout: 3 * 60 * 1000 });
  return JSON.parse(result.stdout.trim());
}
async function optimizeVideo(source, destination, tools) {
  await runProcess(tools.ffmpeg, videoArguments(source, destination));
  return { status: 'optimized' };
}

function targetPath(original, sourceHash, kind) {
  const basename = path.posix.basename(original.path, path.posix.extname(original.path)).replace(/[^a-zA-Z0-9_-]/gu, '-').slice(0, 75) || 'media';
  return `assets/display-web-${basename}-${sourceHash.slice(0, 10)}.${kind === 'image' ? 'webp' : 'mp4'}`;
}
function sameSource(record, original) {
  return record.assets?.some(asset => asset.role === 'original' && asset.path === original.path && asset.mimeType === original.mimeType);
}
async function updateRecord(filename, original, sourceHash, candidate, encodedAsset) {
  const latest = JSON.parse(await readFile(filename, 'utf8'));
  if (!sameSource(latest, original) || await digest(candidate) !== sourceHash) throw new Error('Original media changed during optimization; record left untouched.');
  const retained = (latest.assets || []).filter(asset => !(asset.role === 'optimized' && asset.optimization?.sourceAsset === original.path && asset.optimization?.processor === VERSION));
  if (encodedAsset) retained.push(encodedAsset);
  latest.assets = retained;
  const temporary = `${filename}.optimize-${randomUUID()}`;
  try { await writeFile(temporary, `${JSON.stringify(latest, null, 2)}\n`, { flag: 'wx' }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}

/** Produce browser copies while preserving original media and all authored metadata. */
export async function optimizeArena(root, options = {}) {
  root = path.resolve(root);
  const complete = await fileExists(path.join(root, '.import-complete.json'));
  let archivedReport;
  try { archivedReport = JSON.parse(await readFile(path.join(root, 'content/imports/arena/report.json'), 'utf8')); } catch { /* Initial or partial imports have no completed report. */ }
  if (!complete && !archivedReport?.completedAt) throw new Error('Import is not complete. Optimization requires .import-complete.json or a completed import report.');
  const log = options.log || (() => {});
  const tools = options.tools || await discoverTools(options.toolsDirectory || process.env.JELLY_MEDIA_TOOLS || path.join(path.dirname(root), 'tools'), options);
  const previews = await optimizePreviews(root, { toolsDirectory: tools.directory, python: tools.python });
  const imageRunner = options.optimizeImage || ((source, destination) => optimizeImage(source, destination, tools));
  const videoRunner = options.optimizeVideo || ((source, destination) => optimizeVideo(source, destination, tools));
  const base = path.join(root, 'content', 'blocks');
  const files = (await readdir(base, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => path.join(base, entry.name, 'block.json')).sort();
  const report = {
    schemaVersion: 1, processor: VERSION, startedAt: new Date().toISOString(),
    tools: { pillow: tools.pillow, ffmpegVersion: tools.ffmpegVersion }, settings: { image: IMAGE_SETTINGS, video: VIDEO_SETTINGS },
    images: { candidates: 0, optimized: 0, cached: 0, animatedOriginal: 0, smallerOriginal: 0, failed: 0 },
    videos: { candidates: 0, optimized: 0, cached: 0, smallerOriginal: 0, failed: 0 },
    originalBytes: 0, browserBytes: 0, bytesSavedForBrowser: 0, issues: [], previews,
  };
  let completedImages = 0, completedVideos = 0;
  const queue = [...files];
  async function processRecord(filename) {
    await assertRegularFile(filename);
    const record = JSON.parse(await readFile(filename, 'utf8'));
    for (const original of (record.assets || []).filter(asset => asset.role === 'original' && (IMAGE_TYPES.has(asset.mimeType) || VIDEO_TYPES.has(asset.mimeType)))) {
      const kind = IMAGE_TYPES.has(original.mimeType) ? 'image' : 'video';
      const statistics = kind === 'image' ? report.images : report.videos;
      statistics.candidates++;
      const directory = path.dirname(filename);
      const source = path.join(directory, safeAssetPath(original.path));
      let temporary, sourceBytes = 0;
      try {
        sourceBytes = (await assertRegularFile(source)).size;
        report.originalBytes += sourceBytes;
        const sourceHash = await digest(source);
        const existing = record.assets.find(asset => asset.role === 'optimized' && asset.optimization?.processor === VERSION && asset.optimization?.sourceAsset === original.path && asset.optimization?.sourceSha256 === sourceHash);
        if (existing) {
          const cachedFile = path.join(directory, safeAssetPath(existing.path));
          const cached = await fileExists(cachedFile);
          if (cached?.isFile() && cached.size === existing.bytes && await digest(cachedFile) === existing.sha256) {
            statistics.cached++; report.browserBytes += cached.size; continue;
          }
        }
        const relative = targetPath(original, sourceHash, kind);
        const destination = path.join(directory, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        temporary = path.join(path.dirname(destination), `.optimize-${randomUUID()}.${kind === 'image' ? 'webp' : 'mp4'}`);
        const result = await (kind === 'image' ? imageRunner : videoRunner)(source, temporary, original);
        if (result.status === 'animated-original') {
          statistics.animatedOriginal++; report.browserBytes += sourceBytes;
          await updateRecord(filename, original, sourceHash, source, null); continue;
        }
        const optimizedBytes = (await assertRegularFile(temporary)).size;
        const mustConvert = kind === 'video' && (original.mimeType === 'video/quicktime' || /\.mov$/iu.test(original.path));
        if (!optimizedBytes || optimizedBytes > MAX_OUTPUT_BYTES) throw new Error('Optimized file is empty or exceeds the 95 MiB asset limit.');
        if (optimizedBytes >= sourceBytes && !mustConvert) {
          statistics.smallerOriginal++; report.browserBytes += sourceBytes;
          await updateRecord(filename, original, sourceHash, source, null); continue;
        }
        const outputHash = await digest(temporary);
        const encodedAsset = {
          path: relative, mimeType: kind === 'image' ? 'image/webp' : 'video/mp4', role: 'optimized',
          alt: original.alt || record.title || '', bytes: optimizedBytes, sha256: outputHash,
          ...(result.width ? { width: result.width, height: result.height } : {}),
          optimization: { processor: VERSION, sourceAsset: original.path, sourceSha256: sourceHash, originalBytes: sourceBytes, settings: kind === 'image' ? IMAGE_SETTINGS : VIDEO_SETTINGS },
        };
        await rename(temporary, destination); temporary = undefined;
        await updateRecord(filename, original, sourceHash, source, encodedAsset);
        statistics.optimized++; report.browserBytes += optimizedBytes;
      } catch (error) {
        statistics.failed++; report.browserBytes += sourceBytes;
        report.issues.push({ blockId: record.id, asset: original.path, reason: String(error.message).slice(0, 700) });
      } finally {
        if (temporary) await rm(temporary, { force: true });
        if (kind === 'image') { completedImages++; if (completedImages % 25 === 0) log(`Images: ${completedImages} processed (${report.images.optimized} optimized, ${report.images.cached} cached, ${report.images.failed} unavailable).`); }
        else { completedVideos++; if (completedVideos % 5 === 0) log(`Videos: ${completedVideos} processed (${report.videos.optimized} optimized, ${report.videos.cached} cached, ${report.videos.failed} unavailable).`); }
      }
    }
  }
  async function worker() { while (queue.length) await processRecord(queue.shift()); }
  await Promise.all([worker(), worker()]);
  report.completedAt = new Date().toISOString();
  report.bytesSavedForBrowser = report.originalBytes - report.browserBytes;
  const reportFile = path.join(root, 'content', 'imports', 'arena', 'optimization.json');
  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const runningAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningAsScript) {
  const args = process.argv.slice(2);
  const root = args[0];
  const toolsIndex = args.indexOf('--tools');
  if (!root) { console.error('Usage: node scripts/optimize-arena.mjs /path/to/staged-library [--tools /path/to/private/tools]'); process.exitCode = 1; }
  else {
    try {
      const report = await optimizeArena(root, { toolsDirectory: toolsIndex >= 0 ? args[toolsIndex + 1] : undefined, log: console.log });
      console.log(JSON.stringify({ images: report.images, videos: report.videos, originalBytes: report.originalBytes, browserBytes: report.browserBytes, bytesSavedForBrowser: report.bytesSavedForBrowser, issues: report.issues.length }, null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
