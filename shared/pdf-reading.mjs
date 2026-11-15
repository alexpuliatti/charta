export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'];
export const emptyPDFReading = () => ({ revision: 0, notes: '', annotations: [] });

export function validatePDFReading(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.notes !== 'string' || value.notes.length > 100000 || !Array.isArray(value.annotations) || value.annotations.length > 500) throw new Error('Invalid PDF notes or highlights.');
  const ids = new Set();
  for (const note of value.annotations) {
    if (!note || typeof note.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(note.id) || ids.has(note.id) || !Number.isSafeInteger(note.page) || note.page < 1 || note.page > 100000 || !HIGHLIGHT_COLORS.includes(note.color) || typeof note.quote !== 'string' || !note.quote.trim() || note.quote.length > 20000 || typeof note.comment !== 'string' || note.comment.length > 20000 || !Array.isArray(note.rects) || !note.rects.length || note.rects.length > 300) throw new Error('Invalid PDF highlight.');
    ids.add(note.id);
    for (const rect of note.rects) {
      if (!Array.isArray(rect) || rect.length !== 4 || rect.some(n => !Number.isFinite(n) || n < 0 || n > 1) || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > 1.001 || rect[1] + rect[3] > 1.001) throw new Error('Invalid PDF highlight position.');
    }
  }
  return value;
}

export function validatePDFReadings(block) {
  if (block.pdfReading === undefined) return;
  if (!block.pdfReading || typeof block.pdfReading !== 'object' || Array.isArray(block.pdfReading)) throw new Error('Invalid PDF reading data.');
  for (const [path, reading] of Object.entries(block.pdfReading)) {
    if (!block.assets?.some(asset => asset.path === path && asset.mimeType === 'application/pdf')) throw new Error('PDF notes must refer to a saved PDF.');
    validatePDFReading(reading);
  }
}
