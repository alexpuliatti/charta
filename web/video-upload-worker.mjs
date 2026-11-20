import { Input, BlobSource, MP4, QTFF, WEBM, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, Conversion, Quality } from './vendor/mediabunny.mjs';
import { MAX_UPLOAD_BYTES } from './shared/uploads.mjs';

async function compressVideo(file) {
  if (!self.VideoEncoder || !self.VideoDecoder) return;
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM] });
  try {
    const videos = await input.getVideoTracks();
    if (videos.length !== 1) return;
    const track = videos[0];
    if (await track.hasHighDynamicRange() || await track.canBeTransparent()) return;
    const width = await track.getDisplayWidth(), height = await track.getDisplayHeight();
    const scale = Math.min(1, 1920 / Math.max(width, height));
    const duration = await input.computeDuration();
    if (!(Number.isFinite(duration) && duration > 0)) return;
    // Leave room for audio and container overhead within the saved-file limit.
    const byteBudget = Math.min(file.size * 0.8, MAX_UPLOAD_BYTES * 0.9);
    const bitrate = Math.min(4_000_000, Math.floor(byteBudget * 8 / duration) - 192_000);
    if (bitrate < 150_000) return;
    const video = {
      width: Math.max(2, 2 * Math.round(width * scale / 2)),
      height: Math.max(2, 2 * Math.round(height * scale / 2)),
      fit: 'contain', quality: new Quality({ bitrate }), allowTransformationMetadata: false,
    };
    for (const [format, codec] of [[new Mp4OutputFormat({ fastStart: false }), 'avc'], [new WebMOutputFormat(), 'vp9']]) {
      const target = new BufferTarget();
      const output = new Output({ target, format });
      const conversion = await Conversion.init({
        input, output, video: { ...video, codec }, showWarnings: false,
        tags: tags => ({ ...tags, creationTime: tags.creationTime ?? null }),
      });
      if (!conversion.isValid || conversion.discardedTracks.length) continue;
      const limit = Math.min(file.size, MAX_UPLOAD_BYTES);
      target.on('write', ({ end }) => {
        if (end > limit && conversion.state === 'executing') void conversion.cancel().catch(() => {});
      });
      let lastPercent = -1;
      conversion.onProgress = progress => {
        const percent = Math.floor(progress * 100);
        if (percent !== lastPercent) { self.postMessage({ percent }); lastPercent = percent; }
      };
      await conversion.execute();
      const bytes = target.buffer;
      if (bytes?.byteLength > 0 && bytes.byteLength < file.size && bytes.byteLength <= MAX_UPLOAD_BYTES) {
        return new File([bytes], `${file.name.replace(/\.[^.]+$/, '')}${format.fileExtension}`, { type: format.mimeType, lastModified: file.lastModified });
      }
      return;
    }
  } finally { input.dispose(); }
}

self.onmessage = async ({ data: original }) => {
  let file;
  try { file = await compressVideo(original); }
  catch { /* A browser without a working encoder can still save an in-limit original. */ }
  self.postMessage({ file });
};
