const NAMESPACES = {
  language: '语言', artist: '作者', group: '社团', parody: '作品', character: '角色',
  cosplayer: 'Cosplayer', female: '女性', male: '男性', mixed: '混合',
  other: '其他', reclass: '分类', location: '地点',
};
const ALIASES = {
  l: 'language', lang: 'language', a: 'artist', g: 'group', circle: 'group',
  p: 'parody', series: 'parody', c: 'character', char: 'character', cos: 'cosplayer',
  f: 'female', m: 'male', x: 'mixed', o: 'other', r: 'reclass', loc: 'location',
};
const SEED_TAGS = [
  ['language', 'chinese', '中文'], ['language', 'english', '英语'],
  ['language', 'japanese', '日语'], ['language', 'korean', '韩语'],
  ['language', 'spanish', '西班牙语'], ['language', 'french', '法语'],
  ['language', 'german', '德语'], ['language', 'translated', '翻译'],
  ['other', 'full color', '全彩'], ['other', 'comic', '漫画'],
  ['other', 'anthology', '合集'], ['other', 'artbook', '画集'],
  ['other', 'story arc', '连续故事'], ['parody', 'original', '原创'],
].map(([namespace, tag, name]) => ({ namespace, tag, name }));

function normalizeTag(value) {
  if (!value || typeof value !== 'object') return null;
  const namespace = ALIASES[value.namespace] || value.namespace;
  const tag = typeof value.tag === 'string' ? value.tag.trim().replace(/\s+/g, ' ').toLowerCase() : '';
  if (!Object.hasOwn(NAMESPACES, namespace) || !tag || tag.length > 150 || /["$:\\\x00-\x1f]/.test(tag)) return null;
  const name = typeof value.name === 'string' ? value.name.slice(0, 160) : tag;
  return { namespace, tag, name, aliases: Array.isArray(value.aliases) ? value.aliases.filter(x => typeof x === 'string').slice(0, 20).map(x => x.slice(0, 160)) : [] };
}
function tagKey(tag) { return `${tag.namespace}:${tag.tag}`; }
function mergeTags(...lists) {
  const result = new Map();
  for (const list of lists) for (const item of list) {
    const tag = normalizeTag(item);
    if (tag) result.set(tagKey(tag), tag);
  }
  return [...result.values()];
}
function parseDictionary(value) {
  let items;
  if (Array.isArray(value)) items = value;
  else if (value && Array.isArray(value.data)) {
    items = value.data.flatMap(row => {
      if (!row || !Object.hasOwn(NAMESPACES, row.namespace) || !row.data || typeof row.data !== 'object') return [];
      return Object.entries(row.data).map(([tag, entry]) => ({ namespace: row.namespace, tag, name: entry?.name }));
    });
  } else throw new Error('词库格式不正确：需要标签数组或 EhTagTranslation JSON。');
  if (items.length > 100000) throw new Error('词库过大，最多支持 100000 个标签。');
  const tags = mergeTags(items);
  if (!tags.length) throw new Error('词库中没有有效标签。');
  return tags;
}
function serializeTag(item) {
  const tag = normalizeTag(item);
  if (!tag) throw new Error('无效标签。');
  const mode = item.mode === 'exclude' ? '-' : item.mode === 'or' ? '~' : '';
  const exactTag = `${tag.tag}${item.exact === false ? '' : '$'}`;
  const term = /\s/.test(tag.tag) ? `"${exactTag}"` : exactTag;
  return `${mode}${tag.namespace}:${term}`;
}
function parseQuery(query) {
  const selected = new Map();
  const rest = [];
  const tokens = String(query).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  // Keep incomplete quoted input intact instead of silently rewriting it.
  if ((String(query).match(/"/g) || []).length % 2) return { selected: [], base: String(query) };
  for (const token of tokens) {
    const match = token.match(/^([-~]?)([a-z]+):("[^"]+"|[^"$]+)(\$?)$/i);
    if (!match) { rest.push(token); continue; }
    const rawTag = match[3].replace(/^"|"$/g, '');
    const exact = !!match[4] || rawTag.endsWith('$');
    const tag = normalizeTag({ namespace: match[2].toLowerCase(), tag: rawTag.replace(/\$$/, '').replace(/_/g, ' ') });
    if (!tag) { rest.push(token); continue; }
    const item = { ...tag, mode: match[1] === '-' ? 'exclude' : match[1] === '~' ? 'or' : 'include', exact };
    const previous = selected.get(tagKey(tag));
    // Conflicting or repeated terms stay as raw text to preserve their meaning.
    if (previous) rest.push(token); else selected.set(tagKey(tag), item);
  }
  return { selected: [...selected.values()], base: rest.join(' ') };
}
function buildQuery(base, selected) {
  return [String(base).trim(), ...selected.map(serializeTag)].filter(Boolean).join(' ');
}
function searchTags(tags, query, namespace = '', favorites = [], view = 'all', recent = []) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const favoriteSet = new Set(favorites);
  const recentRanks = new Map(recent.map((key, index) => [key, index]));
  return tags.filter(tag => {
    const key = tagKey(tag);
    if (namespace && tag.namespace !== namespace) return false;
    if (view === 'favorites' && !favoriteSet.has(key)) return false;
    if (view === 'recent' && !recentRanks.has(key)) return false;
    const text = `${key} ${tag.name} ${(tag.aliases || []).join(' ')} ${NAMESPACES[tag.namespace]}`.toLowerCase();
    return words.every(word => text.includes(word));
  }).sort((a, b) => {
    if (view === 'recent') return recentRanks.get(tagKey(a)) - recentRanks.get(tagKey(b));
    return Number(favoriteSet.has(tagKey(b))) - Number(favoriteSet.has(tagKey(a)));
  });
}
