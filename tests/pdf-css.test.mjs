import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { JSDOM } from 'jsdom';

// Resolve the real stylesheet imports: jsdom does not fetch imported CSS by
// default, which would otherwise hide collisions in the vendored PDF viewer.
async function stylesheet(url) {
  let source = await readFile(url, 'utf8');
  const imports = [...source.matchAll(/@import\s+url\(\s*['"]([^'"]+)['"]\s*\)\s*;/g)];
  const contents = await Promise.all(imports.map(match => stylesheet(new URL(match[1], url))));
  imports.forEach((match, index) => { source = source.replace(match[0], contents[index]); });
  return source;
}

test('PDF viewer styles leave library navigation and document defaults intact', async () => {
  const url = new URL('../web/index.html', import.meta.url);
  const dom = new JSDOM(await readFile(url, 'utf8'), { url: 'https://example.test/Jelly/' });
  try {
    const { document } = dom.window;
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    const styles = await Promise.all(links.map(async link => {
      const source = await stylesheet(new URL(link.getAttribute('href'), url));
      return (await transform(source, { loader: 'css', supported: { nesting: false } })).code;
    }));
    let pdfStyle, pdfCSS;
    links.forEach((link, index) => {
      const style = document.createElement('style');
      if (link.getAttribute('href') === './pdf.css') {
        pdfStyle = style;
        pdfCSS = styles[index];
      } else style.textContent = styles[index];
      link.replaceWith(style);
    });
    assert.ok(pdfStyle, 'the test exercises the PDF stylesheet loaded by the application');

    const fixture = document.createElement('div');
    fixture.innerHTML = '<div class="textLayer" id="outside-text-layer">Library text</div><section class="custom-pdf-reader"><div class="pdfViewer"><div class="page"><div class="textLayer">PDF text</div></div></div></section>';
    document.body.append(fixture);
    const computed = element => dom.window.getComputedStyle(element);
    const sidebar = document.querySelector('#sidebar');
    const layout = () => {
      const style = computed(sidebar);
      return Object.fromEntries(['position', 'width', 'minWidth', 'maxWidth', 'padding', 'borderRadius', 'borderTopWidth'].map(property => [property, style[property]]));
    };
    const navigation = layout();
    assert.equal(navigation.position, 'fixed');
    assert.equal(computed(document.documentElement).colorScheme, 'dark');

    pdfStyle.textContent = pdfCSS;

    assert.deepEqual(layout(), navigation, 'loading the PDF viewer must not restyle Charta’s sidebar');
    const root = computed(document.documentElement);
    assert.equal(root.colorScheme, 'dark', 'the PDF viewer must not change the application color scheme');
    for (const property of ['--viewer-container-height', '--button-primary-bg-color']) {
      assert.equal(root.getPropertyValue(property), '', `${property} must not be installed on the document root`);
      assert.notEqual(computed(document.querySelector('.custom-pdf-reader')).getPropertyValue(property), '', `${property} remains available inside the PDF reader`);
    }
    assert.equal(computed(document.querySelector('#outside-text-layer')).position, 'static');
    assert.equal(computed(document.querySelector('.custom-pdf-reader .textLayer')).position, 'absolute', 'PDF text keeps its viewer positioning');
    assert.match(computed(document.querySelector('.custom-pdf-reader .pdfViewer')).padding, /--pdfViewer-padding-bottom/, 'PDF page layout rules remain active');
  } finally {
    dom.window.close();
  }
});
