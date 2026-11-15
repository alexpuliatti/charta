const clean = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const controls = /[\u0000-\u001f\u007f-\u009f]/u;

/** A stable key for matching category and tag names without changing their display. */
export function taxonomyKey(value) {
  return typeof value === 'string' ? clean(value).toLowerCase() : '';
}

export function normalizeCategory(value = 'Uncategorized') {
  if (typeof value !== 'string') throw new Error('Category must be text.');
  const category = clean(value) || 'Uncategorized';
  if (category.length > 80 || controls.test(category)) throw new Error('Category must be at most 80 characters without control characters.');
  return category;
}

export function normalizeTags(value = []) {
  if (!Array.isArray(value)) throw new Error('Tags must be an array of text labels.');
  const tags = [], seen = new Set();
  for (const input of value) {
    if (typeof input !== 'string') throw new Error('Each tag must be text.');
    const tag = clean(input).replace(/^#+/u, '').trim().toLowerCase();
    if (!tag || tag.length > 48 || controls.test(tag)) throw new Error('Each tag must contain 1 to 48 characters without control characters.');
    if (!seen.has(tag)) { seen.add(tag); tags.push(tag); }
  }
  if (tags.length > 20) throw new Error('A material can have at most 20 tags.');
  return tags;
}

/** Missing legacy fields remain usable without fabricating subject tags. */
export function normalizeTaxonomy(record) {
  return { category: normalizeCategory(record.category), tags: normalizeTags(record.tags) };
}
