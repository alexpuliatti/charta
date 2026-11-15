# Semantic browsing

**Discover** finds related material with two complementary pretrained models. Select an image or video for visual neighbors across the archive. Select writing or a document for related articles, notes, and documents. Suggestions never replace authored links or add media to the reading network. Scores from the two models are never mixed.

All 1,017 materials have genuine 512-dimensional [CLIP ViT-B/32](https://huggingface.co/openai/clip-vit-base-patch32) embeddings and 384-dimensional [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) text embeddings. They are generated locally with the MIT-licensed [CLIP ONNX conversion](https://huggingface.co/Xenova/clip-vit-base-patch32), Apache-2.0-licensed [MiniLM ONNX conversion](https://huggingface.co/Xenova/all-MiniLM-L6-v2), and [Transformers.js](https://huggingface.co/docs/transformers.js/v3.0.0/en/index). No API key, hosted embedding service, remote inference, or model download is needed to browse the published site.

## Inputs and limitations

- Articles, tweets, and notes use saved titles, bodies, descriptions, artifact text, summaries, and taxonomy. All saved text is divided into 75-token chunks, projected with CLIP, and pooled by chunk token count. Source URLs are never fetched by the embedding process.
- Images use actual optimized images or local thumbnails, fused with their saved text. The normalized image vector contributes 75%; the normalized text vector contributes 25%.
- Video embeddings represent a saved still plus text. They do not analyze motion, sound, or an unrecorded transcript. Documents use the complete saved extracted-text sidecar when present (verified against `artifact.textSha256`), plus a representative preview when available; scanned documents may have only OCR or a preview. Text documents weight text at 75% and preview imagery at 25%, so book contents contribute more than cover appearance. The browser catalog can keep a short text preview while inference reads every saved chunk. Audio uses saved text and cover imagery when present.

MiniLM reads the same saved text, OCR, descriptions, and complete document sidecars. Its 254-token content chunks receive CLS/SEP tokens, attention-mask mean pooling, L2 normalization, and token-count-weighted chunk pooling. All 1,841,940 characters from the 15 saved PDF text sidecars are included; the short browser catalog previews are not used as a substitute.

CLIP was trained for image/text alignment; MiniLM was trained for sentence/paragraph similarity and gives better reading recommendations. Reading and document anchors use MiniLM cosine among articles, notes, and files. Visual anchors use CLIP cosine across all material types. Raw cosine is not a calibrated confidence percentage. Long-document chunk pooling is an approximation and does not preserve document order. Neighbors remain suggestions, not factual claims or proof that sources are related.

`content/embeddings/index.json` records immutable model revisions, checksums, input methods, chunk counts, source image digests, limitations, and each material's input hashes. `vectors.bin` contains normalized CLIP vectors; `text-vectors.bin` contains normalized MiniLM vectors, both float32 little-endian. All three files total about 4.46 MiB. Both binary digests are verified when loaded. The browser checks current saved text and declared media/sidecar digests before returning neighbors; edited or new materials require regeneration. The local `--check` also verifies actual source bytes. An edited anchor is never silently compared using its old vector.

## Regenerate after editing

Requires Node.js 22.13 or later. Inference is a separate maintenance task; the static website keeps no runtime dependency on machine-learning packages. Install the pinned inference runtime in a directory outside the repository:

```sh
npm install --prefix /tmp/jelly-embedding-runtime @huggingface/transformers@3.8.1
node scripts/embed-library.mjs \
  --runtime /tmp/jelly-embedding-runtime/node_modules/@huggingface/transformers/dist/transformers.node.mjs \
  --model-dir /tmp/jelly-clip-model \
  --text-model-dir /tmp/jelly-minilm-model \
  --download-model --prepare
```

The preparation step downloads about 172 MiB of weights/tokenizer files from public Hugging Face repositories: CLIP revision `6b7c523703ae26e39be4b03774966f8571c7f523` and MiniLM revision `751bff37182d3f1213fa05d7196b954e230abad9`. Every file is verified against a pinned SHA-256 digest. Models remain outside the content archive and are reused locally.

Once titles, artifact text, and categorization are final:

```sh
node scripts/embed-library.mjs \
  --runtime /tmp/jelly-embedding-runtime/node_modules/@huggingface/transformers/dist/transformers.node.mjs \
  --model-dir /tmp/jelly-clip-model \
  --text-model-dir /tmp/jelly-minilm-model
node scripts/embed-library.mjs --check
```

The main command regenerates both indexes. `scripts/embed-text.mjs` can refresh only the text index when the existing CLIP inputs are current. Completed item vectors are cached by model-specific input hash in the system temporary directory; unchanged inputs reuse exact vectors. Cache files are maintenance intermediates and are not shipped. `--root`, `--out`, and `--limit` support isolated fixtures; a limited run generates only CLIP and records incomplete coverage. `--clip-only` also supports CLIP fixtures. Production generation fails if canonical inputs change during inference, and never rewrites saved content or authored connections.

Commit all three generated files and rebuild. They are preserved by content export and copied into GitHub Pages along with the archive. Future saves do not receive a fabricated fallback embedding: regenerate the indexes to include them.

## Resource intake

The local Add resource service reuses the installed CLIP and MiniLM models for content classification. New resources append one row to both indexes without recomputing existing vectors; both binary digests and the manifest are updated together. If inference is unavailable, the resource remains saved and ordinary browsing still works; prepare the models and rebuild the index to include it in Discover. Existing edited resources still require regeneration. The Age1 portfolio test is included in both indexes.
