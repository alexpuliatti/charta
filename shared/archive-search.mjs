import { embeddingText } from './semantic.mjs';
import { resourceFolderPath } from './resource-routing.mjs';

const STOP = new Set('a about am an and are as at be been but by can could do for from has have how i im in into is it its me my of on or our recently that the their them there these they this to was were what when where which who why will with would you your writing write article articles looking look different saved resource resources should read find interesting please help want need using'.split(' '));
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
const words = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
export function searchTerms(query) {
  const all = words(query), meaningful = all.filter(word => !STOP.has(word));
  return [...new Set(meaningful.length ? meaningful : all)];
}

export function createKeywordIndex(catalog, { documents = new Map() } = {}) {
  const folders = new Map(catalog.blocks.map(block => [block.id, []]));
  for (const collection of catalog.collections) for (const item of collection.items || []) if (item.kind === 'block' && folders.has(item.id)) folders.get(item.id).push(resourceFolderPath(catalog, collection.id).join(' '));
  const rows = [...catalog.blocks.map(item => ({ item, entity: 'block', title: [item.title, item.source?.arena?.originalTitle].filter(Boolean).join(' '), taxonomy: [item.category, ...(item.tags || []), ...(folders.get(item.id) || [])].join(' '), body: [item.description, documents.get(item.id) || embeddingText(item), item.source?.url].filter(Boolean).join(' ') })),
    ...catalog.collections.map(item => ({ item, entity: 'collection', title: item.title, taxonomy: resourceFolderPath(catalog, item.id).join(' '), body: item.description || '' }))];
  const frequency = new Map();
  for (const row of rows) {
    row.title = normalize(row.title); row.taxonomy = normalize(row.taxonomy); row.body = normalize(row.body);
    row.tokens = new Map();
    for (const [field, weight] of [[row.title, 5], [row.taxonomy, 3], [row.body, 1]]) for (const token of words(field)) row.tokens.set(token, (row.tokens.get(token) || 0) + weight);
    row.length = Math.max(1, words(row.body).length);
    for (const token of row.tokens.keys()) frequency.set(token, (frequency.get(token) || 0) + 1);
  }
  const average = rows.reduce((sum, row) => sum + row.length, 0) / Math.max(1, rows.length);
  return { rows, search(query, { limit = 60, blocksOnly = false } = {}) {
    const terms = searchTerms(query); if (!terms.length) return [];
    const phrase = normalize(query).trim();
    return rows.filter(row => !blocksOnly || row.entity === 'block').map(row => {
      let score = 0, matches = 0;
      for (const term of terms) {
        let tf = row.tokens.get(term) || 0;
        if (!tf && term.length >= 3) {
          for (const [token, count] of row.tokens) if (token.startsWith(term) || (term.length > 4 && term.startsWith(token) && token.length > 3)) tf += count * .45;
        }
        if (!tf && terms.length === 1 && term.length < 3 && (row.title.includes(term) || row.taxonomy.includes(term))) tf = .4;
        if (!tf) continue;
        matches++;
        const df = frequency.get(term) || 1, idf = Math.log(1 + (rows.length - df + .5) / (df + .5));
        score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * row.length / Math.max(1, average)));
      }
      if (row.title.includes(phrase)) score += 5;
      score *= .45 + .55 * matches / terms.length;
      return { id: row.item.id, entity: row.entity, score, matches };
    }).filter(row => row.matches > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  } };
}

/** Reciprocal-rank fusion keeps keyword and cosine scores on comparable scales. */
export function fuseSearchResults(lexical, semantic, { limit = 30 } = {}) {
  const scores = new Map();
  for (const [rankings, field, weight] of [[lexical, 'keyword', .55], [semantic, 'semantic', .45]]) rankings.forEach((row, rank) => {
    const key = `${row.entity || 'block'}:${row.id}`;
    const item = scores.get(key) || { id: row.id, entity: row.entity || 'block', score: 0, keyword: false, semantic: false, semanticScore: null };
    item.score += weight / (24 + rank + 1); item[field] = true;
    if (field === 'semantic') item.semanticScore = row.score;
    scores.set(key, item);
  });
  return [...scores.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

export function searchPassages(text, query, { limit = 2, size = 650 } = {}) {
  const body = String(text || '').replace(/\s+/g, ' ').trim(); if (!body) return [];
  const terms = searchTerms(query), passages = [];
  for (let offset = 0; offset < body.length; offset += Math.max(1, size - 100)) {
    let start = offset, end = Math.min(body.length, offset + size);
    if (start) { const next = body.indexOf(' ', start); if (next >= 0 && next - start < 40) start = next + 1; }
    if (end < body.length) { const previous = body.lastIndexOf(' ', end); if (previous > start) end = previous; }
    const excerpt = body.slice(start, end), lower = normalize(excerpt);
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    passages.push({ text: excerpt, offset: start, score });
    if (end === body.length) break;
  }
  const selected = passages.sort((a, b) => b.score - a.score || a.offset - b.offset).filter((passage, index, all) => !all.slice(0, index).some(other => other.score >= passage.score && Math.abs(other.offset - passage.offset) < size / 2)).slice(0, limit);
  return selected.map(({ text, offset }) => ({ text, offset }));
}

export function parseArchiveAnswer(value, candidates) {
  let result; try { result = typeof value === 'string' ? JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g, '')) : value; } catch { throw new Error('ChatGPT returned an unreadable answer. Try again.'); }
  if (!result || typeof result.summary !== 'string' || result.summary.length > 12000 || !Array.isArray(result.resources)) throw new Error('ChatGPT returned an incomplete answer. Try again.');
  const allowed = new Map(candidates.map(item => [item.id, item])), seen = new Set();
  const resources = result.resources.flatMap(item => {
    if (!item || typeof item.id !== 'string') return [];
    const source = allowed.get(item.id);
    if (!source || seen.has(item.id) || typeof item.reason !== 'string') return [];
    const evidence = [...new Set(Array.isArray(item.evidence) ? item.evidence : [])].filter(index => Number.isInteger(index) && source.passages[index]);
    if (!evidence.length) return [];
    seen.add(item.id); return [{ id: item.id, reason: item.reason.slice(0, 2000), evidence: evidence.map(index => source.passages[index]) }];
  });
  if (result.resources.length && !resources.length) throw new Error('The model’s references did not match the retrieved archive evidence. Try again.');
  // Answers can link only to source IDs actually supplied to the model.
  const summary = result.summary.replace(/\[([^\]]+)\]/g, (match, id) => allowed.has(id) && seen.has(id) ? match : '');
  return { summary, resources, limitations: Array.isArray(result.limitations) ? result.limitations.filter(item => typeof item === 'string').slice(0, 6).map(item => item.slice(0, 1000)) : [] };
}
