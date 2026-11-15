import { normalizeTags } from './taxonomy.mjs';

export function normalizedResourceURL(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

export function resourceFolderPath(catalog, collectionId) {
  const collection = catalog.collections.find(item => item.id === collectionId);
  if (!collection) return [];
  const parts = [collection.title], seen = new Set();
  let id = collection.parentId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = catalog.folders.find(item => item.id === id);
    if (!folder) break;
    parts.unshift(folder.title); id = folder.parentId;
  }
  return parts;
}

export function resourceImportOperation(inspection, { id, files = [] } = {}) {
  const resource = inspection.resource;
  const originals = files.length ? files : inspection.downloadedFiles || [];
  return {
    type: 'import-resource', destinationPath: inspection.classification.path,
    classification: inspection.classification,
    block: { id, type: resource.type, title: resource.title, description: resource.description || '', category: resource.category, tags: resource.tags, source: resource.url ? { url: resource.url, title: resource.title, capturedAt: new Date().toISOString() } : {} },
    body: resource.body || '',
    attachments: originals.map((file, index) => ({ ...file, sha256: inspection.files[index]?.sha256 }))
  };
}

const sector = [
  ['neurotech', /neurotech|neuroscience|brain.computer|brain interfaces?|\beeg\b|neuromodulation/i],
  ['biotech', /biotech|\bbiolog(?:y|ical)\b|bioinformatics|\bgenomics\b|\bepigenomics\b|\bpharmacology\b|longevity|healthspan|lifespan|\baging\b|\bageing\b|therapeutic|gene therap|cryopreservation/i],
  ['medtech', /medtech|medical imaging|\bmri\b|diagnostic/i],
  ['creative tech', /creative tech|creative coding|creative engineering|generative art|art and technology/i],
  ['AI', /artificial intelligence|machine learning|\bai\b|\bllm\b|foundation models?/i],
  ['space tech', /satellite|aerospace|space technology|space tech/i],
];
const capitalized = value => value[0].toUpperCase() + value.slice(1);
const words = value => String(value || '').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu) || [];
const stop = new Set('the and for with from that this your you are our have has into about their its not can more all new design'.split(' '));

export function classifyResource(resource, catalog) {
  const identity = [resource.title, resource.description].filter(Boolean).join('\n');
  const text = [identity, resource.body?.slice(0, 24000), resource.url, resource.originalName].filter(Boolean).join('\n');
  const tags = [];
  // Page identity outweighs incidental topics in news, papers, and portfolio lists.
  const domain = (sector.find(([, expression]) => expression.test(identity)) || sector.find(([, expression]) => expression.test(text)))?.[0];
  if (domain) tags.push(domain.replaceAll(' ', '-').toLowerCase());
  const choose = (path, reason, confidence = .88) => ({ path, category: path[0] || 'Uncategorized', tags: normalizeTags([...tags, resource.type === 'text' ? 'notes' : resource.type, ...(path.slice(1).map(item => item.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')))]).slice(0, 8), reason, confidence, method: 'content-rules-v1' });

  const fund = /venture capital|venture fund|vc fund|\binvest(?:ment|or|ing|s)\b|early.backer|backing.{0,60}(?:founder|compan)|longevity fund/i.test(text);
  if (fund) {
    const label = domain === 'biotech' ? 'Biotech funds' : domain === 'neurotech' ? 'Neurotech funds' : domain === 'creative tech' ? 'Creative tech funds' : domain === 'AI' ? 'AI funds' : /deep.tech|engineering moonshot/i.test(text) ? 'Deep tech funds' : 'Generalist funds';
    return choose(['Companies', 'VC funds', label], `The saved page describes an investor${domain ? ` focused on ${domain}` : ''}.`);
  }
  if (/\bnonprofit\b|non-profit|not.for.profit|\bfoundation\b|focused.research.organization/i.test(text)) return choose(['Companies', 'Nonprofits', domain === 'neurotech' ? 'Neurotech nonprofits' : domain === 'AI' ? 'AI nonprofits' : 'Science nonprofits'], 'The content describes a nonprofit or research foundation.');
  if (/\bstartups?\b/.test(text.toLowerCase()) && domain) return choose(['Companies', 'Startups', `${capitalized(domain)} startups`], `The content describes a ${domain} startup.`);
  let homepage = false;
  try { homepage = resource.type === 'link' && /^\/?$/.test(new URL(resource.url).pathname); } catch {}
  if (homepage && domain === 'biotech' && /\b(?:builds?|develops?|provides?|platform|company)\b/i.test(identity)) return choose(['Companies', 'Health technology', 'Biotech'], 'The company develops technology for biology and biotech research.');
  if (/\bstudio\b|design practice|creative workshop|in-house agenc/i.test(text)) {
    const label = /brand|web design|websites/.test(text.toLowerCase()) && domain !== 'creative tech' ? 'Brand & web studios' : /production|fabrication|construction/i.test(text) ? 'Production studios' : /foresight|think.tank/i.test(text) ? 'Strategy & foresight' : 'Creative tech studios';
    return choose(['Companies', 'Studios', label], 'The content describes a creative or design studio.');
  }
  const rules = [
    [/typeface|typograph|font family|font foundry/i, ['Graphic design', 'Typography'], 'The content focuses on typography.'],
    [/editorial design|book design|magazine|publication design/i, ['Graphic design', 'Editorial'], 'The content focuses on editorial design.'],
    [/brand identity|visual identity|logo design|branding/i, ['Graphic design', 'Identity'], 'The content focuses on brand identity.'],
    [/motion design|animation|animated|kinetic/i, ['Graphic design', 'Motion'], 'The content focuses on motion and animation.'],
    [/interface design|user interface|\bui\b|design system|component library/i, ['Interface design', 'Components'], 'The content focuses on interfaces and components.'],
    [/interior|living room|bedroom|spatial design/i, ['Architecture', 'Interiors'], 'The content focuses on interiors.'],
    [/architecture|building|facade|urban design/i, ['Architecture', resource.type === 'file' || resource.type === 'text' ? 'Theory' : 'Buildings'], 'The content focuses on architecture.'],
    [/furniture|chair|sofa|stool|table design/i, ['Objects', 'Furniture'], 'The content focuses on furniture.'],
    [/lighting|luminaire|\blamp\b/i, ['Objects', 'Lighting'], 'The content focuses on lighting.'],
    [/loudspeaker|headphone|amplifier|hi.fi|speaker/i, ['Sound', 'Speakers'], 'The content focuses on audio equipment.'],
    [/musical instrument|synthesi[sz]er|\bguitar\b|\bpiano\b/i, ['Sound', 'Instruments'], 'The content focuses on musical instruments.'],
    [/creative coding|generative art|\bshader\b|\bp5\.js\b/i, ['Technology', 'Creative coding'], 'The content focuses on creative coding.'],
    [/neurotechnology|brain.computer|\beeg\b/i, ['Technology', 'Neurotechnology'], 'The content focuses on neurotechnology.'],
    [/artificial intelligence|machine learning|\bllm\b|\bai\b/i, ['Technology', 'AI'], 'The content focuses on artificial intelligence.'],
    [/photograph|photography|photo series|portrait/i, ['Culture', 'Photography'], 'The content focuses on photography.'],
    [/painting|sculpture|exhibition|artwork|\bcollage\b/i, ['Culture', 'Art'], 'The content focuses on art.'],
  ];
  for (const evidence of [identity, text]) for (const [pattern, path, reason] of rules) if (pattern.test(evidence)) return choose(path, reason, .8);

  // Learn vocabulary from the owner's folders and their saved examples.
  const input = new Set(words(text).filter(word => !stop.has(word)));
  const candidates = catalog.collections.filter(collection => !collection.source?.external && collection.source?.arena?.importScope !== 'reference');
  const blockMap = new Map(catalog.blocks.map(block => [block.id, block]));
  const documents = candidates.map(collection => {
    const path = resourceFolderPath(catalog, collection.id);
    const examples = collection.items.filter(item => item.kind === 'block').map(item => blockMap.get(item.id)).filter(Boolean);
    const names = new Set(words(path.join(' ')).filter(word => !stop.has(word)));
    const vocabulary = new Set(examples.flatMap(block => words([block.title, ...(block.tags || []), block.description].join(' '))).filter(word => !stop.has(word)));
    return { path, names, vocabulary };
  });
  const frequencies = new Map();
  for (const doc of documents) for (const word of doc.vocabulary) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  const ranked = documents.map(doc => ({ ...doc, score: [...input].reduce((score, word) => score + (doc.names.has(word) ? 3 : doc.vocabulary.has(word) ? Math.log(1 + documents.length / (frequencies.get(word) || 1)) : 0), 0) })).sort((a, b) => b.score - a.score);
  if (ranked[0]?.score >= 7 && ranked[0].score - (ranked[1]?.score || 0) >= 1) return choose(ranked[0].path, 'The content matches topics already saved in this folder.', .65);
  if (resource.type === 'text' && !resource.url) return choose(['Writing', 'Notes'], 'Pasted text is saved as a note.', .45);
  return choose([], 'Saved in All materials because no folder matched confidently.', .2);
}
