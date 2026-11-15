import { emptyPDFReading } from './shared/pdf-reading.mjs';

export function pdfStoreOptions(store, block) {
  const latest = () => store.catalog.blocks.find(item => item.id === block.id);
  return {
    getReading: asset => latest()?.pdfReading?.[asset.path] || emptyPDFReading(),
    async saveReading(asset, reading, expectedRevision) {
      const result = await store.apply({ type: 'save-pdf-reading', id: block.id, assetPath: asset.path, expectedRevision, reading: { notes: reading.notes, annotations: reading.annotations } });
      return result.catalog.blocks.find(item => item.id === block.id).pdfReading[asset.path];
    },
  };
}
