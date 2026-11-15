// Loaded only when a PDF opens. The viewer handles selectable text, links,
// search, and a bounded rendering queue for long documents.
export async function createPDFEngine(options) {
  const pdfjs = await import('./vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
  const { EventBus, PDFViewer, PDFLinkService, PDFFindController, LinkTarget } = await import('./vendor/pdfjs/pdf_viewer.mjs');
  const abort = new AbortController();
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({ container: options.scroll, viewer: options.pages, eventBus, linkService, findController, abortSignal: abort.signal, annotationMode: pdfjs.AnnotationMode.ENABLE, annotationEditorMode: -1, enableScripting: false, enableAutoLinking: false, enableSelectionRendering: false, maxCanvasPixels: 8 * 1024 * 1024, imageResourcesPath: new URL('./vendor/pdfjs/images/', import.meta.url).href });
  linkService.setViewer(viewer);
  let pdf = null, destroyed = false;
  const listen = (event, callback) => eventBus.on(event, data => { if (!destroyed) callback(data); });
  listen('pagesinit', () => {
    viewer.currentScaleValue = options.scale || 'page-width';
    viewer.currentPageNumber = Math.max(1, Math.min(pdf.numPages, options.page || 1));
    options.onReady?.(pdf.numPages);
  });
  listen('pagechanging', ({ pageNumber }) => options.onPage?.(pageNumber));
  listen('scalechanging', ({ scale }) => options.onScale?.(scale));
  listen('pagerendered', ({ pageNumber, error }) => error ? options.onError?.(error) : options.onRendered?.(pageNumber));
  listen('textlayerrendered', ({ pageNumber }) => options.onText?.(pageNumber));
  listen('updatefindmatchescount', ({ matchesCount }) => options.onMatches?.(matchesCount));
  listen('updatefindcontrolstate', ({ state, matchesCount }) => options.onMatches?.(matchesCount || { current: 0, total: 0 }, state));
  const task = pdfjs.getDocument({ url: options.url, withCredentials: false, isEvalSupported: false, enableXfa: false, cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href, standardFontDataUrl: new URL('./vendor/pdfjs/standard_fonts/', import.meta.url).href, wasmUrl: new URL('./vendor/pdfjs/wasm/', import.meta.url).href, iccUrl: new URL('./vendor/pdfjs/iccs/', import.meta.url).href });
  task.onProgress = ({ loaded, total }) => options.onProgress?.(loaded, total);
  task.onPassword = (submit, reason) => options.onPassword?.(submit, reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
  const ready = task.promise.then(document => {
    if (destroyed) return;
    pdf = document;
    linkService.setDocument(pdf);
    viewer.setDocument(pdf);
    return pdf;
  });
  // The owning view may close while the engine itself is being created.
  ready.catch(() => {});
  return {
    ready,
    goToPage(page) { if (pdf) viewer.currentPageNumber = Math.max(1, Math.min(pdf.numPages, page)); },
    setScale(value) { if (pdf) viewer.currentScaleValue = value; },
    zoom(direction) { if (pdf) viewer.currentScaleValue = Math.max(.25, Math.min(4, viewer.currentScale * (direction > 0 ? 1.15 : 1 / 1.15))); },
    find(query, { again = false, previous = false } = {}) { eventBus.dispatch('find', { source: viewer, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false }); },
    outline() { return pdf?.getOutline() || Promise.resolve(null); },
    destination(dest) { return linkService.goToDestination(dest); },
    refresh() { if (pdf) { if (typeof viewer.currentScaleValue === 'string' && viewer.currentScaleValue.startsWith('page-')) viewer.currentScaleValue = viewer.currentScaleValue; viewer.update(); } },
    destroy() {
      destroyed = true;
      abort.abort();
      viewer.setDocument(null);
      linkService.setDocument(null);
      return task.destroy().catch(() => {});
    },
  };
}
