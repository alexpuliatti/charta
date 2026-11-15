import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCategory, normalizeTags, taxonomyKey } from '../shared/taxonomy.mjs';

const VERSION = 'arena-taxonomy-1';
const FOLDERS = {
  design: { id: 'f_arena_design', slug: 'design', title: 'Design' },
  spaces: { id: 'f_arena_spaces', slug: 'spaces-and-objects', title: 'Spaces and objects' },
  art: { id: 'f_arena_art', slug: 'art-and-image', title: 'Art and image' },
  culture: { id: 'f_arena_culture', slug: 'culture-and-ideas', title: 'Culture and ideas' },
  technology: { id: 'f_arena_technology', slug: 'technology-and-tools', title: 'Technology and tools' },
  reference: { id: 'f_arena_reference', slug: 'reference', title: 'Reference' },
};
const CATEGORIES = {
  'Graphic design': 'design', 'Typography': 'design', 'Digital design': 'design', 'Motion design': 'design',
  'Architecture': 'spaces', 'Interiors': 'spaces', 'Objects and materials': 'spaces', 'Fashion': 'spaces',
  'Art': 'art', 'Illustration': 'art', 'Photography': 'art', 'Film and video': 'art',
  'Music and sound': 'culture', 'Writing and ideas': 'culture', 'Books and publishing': 'culture', 'Nature and science': 'culture',
  'Technology': 'technology', 'Tools and resources': 'technology', 'Reference': 'reference',
  'Information design': 'design', 'Speculative design': 'technology', 'Health and neurotechnology': 'technology',
  'Audio design': 'spaces', '3D and computational design': 'technology',
};
const TOPICS = [
  ['Typography', 'typography', /\btypograph\w*|\btypefaces?\b|\bfonts?\b|\blettering\b/iu],
  ['Graphic design', 'visual-identity', /\bidentit(?:y|ies)\b|\bbranding\b|\blogos?\b|\bbrand design\b/iu],
  ['Graphic design', 'graphic-design', /\bgraphic(?:s| design)?\b|\bvisual communication\b/iu],
  ['Graphic design', 'art-direction', /\bart direction\b|\bcreative direction\b/iu],
  ['Graphic design', 'editorial-design', /\beditorial\b|\bmagazines?\b|\bpublication design\b|\blayouts?\b/iu],
  ['Graphic design', 'posters', /\bposters?\b|\baffiches?\b/iu],
  ['Graphic design', 'packaging', /\bpackaging\b|\bpackage design\b/iu],
  ['Graphic design', 'print-design', /\bprint(?:ing|making)?\b|\brisograph\b|\bscreenprint\w*\b/iu],
  ['Digital design', 'web-design', /\bweb(?:site)? design\b|\bwebsites?\b|\blanding page\b|\bhomepage\b/iu],
  ['Digital design', 'interfaces', /\binterfaces?\b|\bui\b|\bux\b|\buser experience\b|\binteraction design\b/iu],
  ['Digital design', 'interaction-design', /\binteractiv\w*\b|\binteraction\b|\bgesture\w*\b/iu],
  ['Information design', 'information-design', /\binformation design\b|\bvisuali[sz]z?\w*\b|\bknowledge map\w*\b|\bdiagrams?\b|\bdata design\b/iu],
  ['Speculative design', 'speculative-design', /\bspeculativ\w*\b|\butopia\b|\butopian\b|\bdesign futures\b|\bcritical design\b/iu],
  ['Motion design', 'motion-design', /\bmotion\b|\banimation\b|\banimated\b|\bkinetic\b/iu],
  ['Architecture', 'architecture', /\barchitect\w*\b|\bbuildings?\b|\bfacades?\b|\burban(?:ism)?\b/iu],
  ['Interiors', 'interiors', /\binteriors?\b|\brooms?\b|\bdomestic\b|\bspatial design\b/iu],
  ['Objects and materials', 'furniture', /\bfurniture\b|\bchairs?\b|\btables?\b|\bsofas?\b|\bstools?\b|\bshel(?:f|ves)\b/iu],
  ['Objects and materials', 'lighting', /\blighting\b|\blamps?\b|\bluminaires?\b/iu],
  ['Objects and materials', 'product-design', /\bproduct design\b|\bindustrial design\b|\bobjects?\b/iu],
  ['Objects and materials', 'materials', /\bmaterials?\b|\bceramic\w*\b|\bporcelain\b|\bglass\b|\bwood\b|\btextiles?\b|\bfabric\b/iu],
  ['Fashion', 'fashion', /\bfashion\b|\bclothing\b|\bgarments?\b|\brunway\b|\bfootwear\b|\bjewel\w*\b/iu],
  ['Art', 'contemporary-art', /\bcontemporary art\b|\bartworks?\b|\bartists?\b|\bexhibitions?\b|\bgaller(?:y|ies)\b/iu],
  ['Art', 'painting', /\bpaint(?:ing|ings|er|ers)?\b|\bwatercolou?r\b/iu],
  ['Art', 'sculpture', /\bsculpt\w*\b|\binstallations?\b/iu],
  ['Art', 'collage', /\bcollages?\b|\bassemblage\b/iu],
  ['Illustration', 'illustration', /\billustrat\w*\b|\bdraw(?:ing|ings)?\b|\bsketch\w*\b|\bcomics?\b/iu],
  ['Photography', 'photography', /\bphotograph\w*\b|\bphotos?\b|\bcamera\w*\b|\bportraits?\b|\blens\b/iu],
  ['Film and video', 'film', /\bfilms?\b|\bcinema\w*\b|\bmovies?\b|\bcinematograph\w*\b/iu],
  ['Film and video', 'video', /\bvideos?\b|\bshowreels?\b|\bdocumentar\w*\b/iu],
  ['Music and sound', 'music', /\bmusic\b|\bsongs?\b|\balbums?\b|\bcompos\w*\b|\bconcerts?\b/iu],
  ['Music and sound', 'sound', /\bsound\w*\b|\baudio\b|\blistening\b|\bpodcasts?\b/iu],
  ['Audio design', 'audio-hardware', /\bloudspeakers?\b|\bspeakers?\b|\bheadphones?\b|\bsubwoofer\w*\b|\bamplifier\w*\b|\bhi-fi\b|\bacoustic\w*\b/iu],
  ['Books and publishing', 'books', /\bbooks?\b|\blibrar\w*\b|\breading\b|\bpublish\w*\b|\bzines?\b/iu],
  ['Writing and ideas', 'writing', /\bwriting\b|\bessays?\b|\bpoetry\b|\bpoems?\b|\bstories\b|\barticles?\b/iu],
  ['Writing and ideas', 'research', /\bresearch\b|\breferences?\b|\btheor\w*\b|\bphilosoph\w*\b/iu],
  ['Nature and science', 'nature', /\bnature\b|\blandscapes?\b|\bbotan\w*\b|\bplants?\b|\bflowers?\b|\banimals?\b/iu],
  ['Nature and science', 'science', /\bscience\b|\bbiolog\w*\b|\becolog\w*\b|\bgeolog\w*\b|\bclimate\b/iu],
  ['Technology', 'creative-coding', /\bcreative coding\b|\bgenerative\b|\bprocessing\b|\bp5\.js\b|\bshader\w*\b/iu],
  ['3D and computational design', '3d-design', /\b3d\b|\bblender\b|\bmodelling\b|\bmodeling\b|\brendering\b|\bgaussian splats?\b/iu],
  ['Health and neurotechnology', 'neurotechnology', /\bneuro\w*\b|\bbrain\b|\bmental health\b|\bcogniti\w*\b|\bbiofeedback\b|\beeg\b|\bneuromodulation\b/iu],
  ['Technology', 'artificial-intelligence', /\bartificial intelligence\b|\bmachine learning\b|\bneural\b|\bllms?\b|\bai\b/iu],
  ['Technology', 'programming', /\bprogramming\b|\bcode\b|\bcoding\b|\bjavascript\b|\bpython\b|\bgithub\b|\bsoftware\b/iu],
  ['Technology', 'web-culture', /\binternet\b|\bweb culture\b|\bpersonal web\b|\bdigital gardens?\b/iu],
  ['Technology', 'data-visualization', /\bdata visuali[sz]ation\b|\bnetworks?\b|\bdiagrams?\b|\binfograph\w*\b/iu],
  ['Tools and resources', 'tools', /\btools?\b|\bresources?\b|\btutorial\w*\b|\bhow to\b|\butilities\b/iu],
  ['Reference', 'archives', /\barchives?\b|\barchiving\b|\bcollections?\b|\bcollecting\b/iu],
  ['Reference', 'inspiration', /\binspiration\b|\breferences?\b|\bmoodboards?\b/iu],
];
const DOMAIN_TAGS = [
  [/github\.com$/u, 'Technology', ['programming', 'open-source']],
  [/fonts?\.|typefoundry|typography|typefaces/u, 'Typography', ['typography', 'typefaces']],
  [/archdaily\.com$|dezeen\.com$|designboom\.com$/u, 'Architecture', ['architecture', 'design-reference']],
  [/itsnicethat\.com$|bpando\.org$|brandnew|underconsideration\.com$/u, 'Graphic design', ['graphic-design', 'visual-culture']],
  [/vimeo\.com$|youtube\.com$|youtu\.be$/u, 'Film and video', ['video', 'moving-image']],
  [/soundcloud\.com$|bandcamp\.com$|spotify\.com$/u, 'Music and sound', ['music', 'listening']],
  [/read\.cv$|substack\.com$|medium\.com$/u, 'Writing and ideas', ['writing', 'reading']],
  [/are\.na$/u, 'Reference', ['collecting', 'research']],
  [/neuro|neurable|emotiv|inbrain|awear|mavehealth|tryhealium|touchpointsolution|mindfi|intellect\.co/u, 'Health and neurotechnology', ['neurotechnology', 'wellbeing']],
];

export function plainText(value) {
  if (typeof value === 'string') return value.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim();
  return plainText(value?.plain || value?.markdown || value?.html || '');
}
const array = value => Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : [];
const unwrap = value => value?.data && !Array.isArray(value.data) ? value.data : value;
const slug = value => taxonomyKey(value).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 48);

function snapshotData(snapshot) {
  const channels = array(snapshot.channels).map(unwrap);
  const blocks = array(snapshot.blocks).map(unwrap);
  const memberships = new Map(blocks.map(block => [String(block.id), []]));
  const contents = snapshot.contents || snapshot.channelContents || snapshot.channel_contents || {};
  for (const channel of channels) {
    const items = contents[String(channel.id)]?.data || contents[String(channel.id)] || channel.contents?.data || channel.contents || [];
    for (const item of array(items)) {
      const resource = unwrap(item.block || item.item || item);
      if (memberships.has(String(resource.id))) memberships.get(String(resource.id)).push(channel);
    }
  }
  return { channels, blocks, memberships };
}

function sourceTags(record) {
  const raw = record.tags || record.metadata?.tags || [];
  const labeled = plainText(record.description).match(/(?:^|[|;])\s*tags?\s*:\s*([^|;\n]+)/iu)?.[1]?.split(',') || [];
  return [...array(raw), ...labeled].map(tag => typeof tag === 'string' ? tag : tag?.name || tag?.title).filter(Boolean).map(tag => tag.trim().slice(0, 48));
}

function contextualClassification(record, channels = [], override = {}) {
  const title = plainText(record.title);
  const description = plainText(record.description).slice(0, 12000);
  const content = plainText(record.content).slice(0, 12000);
  const context = channels.map(channel => `${plainText(channel.title)} ${plainText(channel.description)}`).join(' ');
  const scores = new Map(), tags = [];
  const add = (category, tag, score) => {
    // Generic curation words should not outweigh a named subject such as typography.
    const subjectWeight = category === 'Reference' ? .25 : tag === 'research' ? .5 : 1;
    scores.set(category, (scores.get(category) || 0) + score * subjectWeight);
    if (tag) tags.push({ tag, score });
  };
  for (const [category, tag, regex] of TOPICS) {
    if (regex.test(title)) add(category, tag, 7);
    if (regex.test(description)) add(category, tag, 3);
    if (regex.test(content)) add(category, tag, 2);
    if (regex.test(context)) add(category, tag, 2);
  }
  for (const channel of channels) {
    if (channel._taxonomy?.category) add(channel._taxonomy.category, '', 3);
    // Only inherit the channel's two broad subject labels. More specific visual
    // properties (e.g. typography or furniture) need evidence in the item text.
    for (const tag of channel._taxonomy?.tags?.slice(0, 2) || []) tags.push({ tag, score: 1 });
  }
  const url = record.source?.url || record.url || record.embed?.url || '';
  let domain = '';
  try { domain = new URL(url).hostname.replace(/^www\./u, '').toLowerCase(); } catch { /* Untitled images can have no source URL. */ }
  for (const [pattern, category, labels] of DOMAIN_TAGS) if (pattern.test(domain)) labels.forEach(tag => add(category, tag, 3));
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const category = normalizeCategory(override.category || ranked[0]?.[0] || 'Reference');
  const type = taxonomyKey(record.type || record.class || '');
  const format = /image/u.test(type) ? 'image-reference' : /embed/u.test(type) ? 'embedded-media' : /attachment/u.test(type) ? 'downloadable-file' : /text/u.test(type) ? 'saved-text' : /link/u.test(type) ? 'web-reference' : 'collected-material';
  const inherited = channels.flatMap(channel => {
    const label = slug(channel.title);
    return label ? [label] : [];
  });
  const primaryTags = tags.sort((a, b) => b.score - a.score).map(item => item.tag);
  const categoryTag = slug(category);
  const candidates = [...sourceTags(record), ...(override.tags || []), ...primaryTags, ...inherited].filter(Boolean);
  const unique = [...new Map(candidates.map(tag => {
    const normalized = normalizeTags([tag])[0];
    return [normalized, normalized];
  })).values()];
  // Subject tags drive the graph. Only use broad format fallbacks when context is sparse.
  for (const fallback of [categoryTag, domain ? `source-${slug(domain)}`.slice(0, 48) : '', format, 'collected-reference']) {
    if (unique.length >= 3) break;
    if (fallback && !unique.includes(fallback)) unique.push(fallback);
  }
  const preserveCount = Math.min(20, normalizeTags(sourceTags(record).slice(0, 20)).length);
  const selectedTags = unique.slice(0, Math.max(8, preserveCount));
  return {
    category,
    tags: selectedTags,
    ...(override.title ? { title: plainText(override.title) } : {}),
    ...(override.description ? { description: plainText(override.description) } : {}),
    classification: {
      method: 'assistant-assisted-rules', version: VERSION,
      inputs: ['title', 'description', 'content-text', 'source-domain', 'channel-context', 'media-type'],
      visualAnalysis: false,
      basis: override.category ? 'reviewed-context' : ranked.length ? 'metadata-and-channel-context' : 'channel-and-format-fallback',
      sourceChannelIds: channels.map(channel => channel.id),
      ...(override.classification || {}),
    },
  };
}

/** Classifies metadata only. It never claims to inspect image pixels or watch videos. */
export function classifyArenaSnapshot(snapshot, options = {}) {
  const { channels, blocks, memberships } = snapshotData(snapshot);
  const overrides = options.overrides || {};
  const channelPlan = {};
  for (const channel of channels) {
    const override = overrides.channels?.[String(channel.id)] || {};
    const classified = contextualClassification(channel, [], override);
    const folder = override.folder || FOLDERS[CATEGORIES[classified.category] || 'reference'];
    channelPlan[channel.id] = { folder, category: classified.category, tags: classified.tags, classification: classified.classification };
  }
  const blockPlan = {};
  for (const block of blocks) {
    const contexts = (memberships.get(String(block.id)) || []).map(channel => ({ ...channel, _taxonomy: channelPlan[channel.id] }));
    const override = overrides.blocks?.[String(block.id)] || {};
    blockPlan[block.id] = contextualClassification(block, contexts, override);
  }
  const values = Object.values(blockPlan);
  return {
    schemaVersion: 1, method: 'assistant-assisted-rules', version: VERSION,
    channels: channelPlan, blocks: blockPlan,
    report: {
      channels: channels.length, blocks: blocks.length,
      categorized: values.filter(block => block.category && block.category !== 'Uncategorized').length,
      tagged: values.filter(block => block.tags.length >= 3).length,
      contextFallbacks: values.filter(block => block.classification.basis === 'channel-and-format-fallback').length,
      categories: Object.fromEntries([...new Set(values.map(block => block.category))].sort().map(category => [category, values.filter(block => block.category === category).length])),
    },
  };
}

const runningAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runningAsScript) {
  const [source, destination, overrideFile] = process.argv.slice(2);
  if (!source || !destination) {
    console.error('Usage: node scripts/tag-arena.mjs snapshot.json classification.json [reviewed-overrides.json]');
    process.exitCode = 1;
  } else {
    const snapshot = JSON.parse(await readFile(source, 'utf8'));
    const overrides = overrideFile ? JSON.parse(await readFile(overrideFile, 'utf8')) : {};
    const plan = classifyArenaSnapshot(snapshot, { overrides });
    await writeFile(destination, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(JSON.stringify(plan.report, null, 2));
  }
}
