// ==UserScript==
// @name         eh工具
// @namespace    https://github.com/xcy1221/EhTool
// @version      0.5.4
// @description  左侧浮动eh工具：标签组合与搜索、评论区收起、明暗配色、画廊连续阅读
// @match        https://e-hentai.org/*
// @match        https://exhentai.org/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @homepageURL  https://github.com/xcy1221/EhTool
// @supportURL   https://github.com/xcy1221/EhTool/issues
// @updateURL    https://raw.githubusercontent.com/xcy1221/EhTool/main/dist/eh-search-tool.meta.js
// @downloadURL  https://raw.githubusercontent.com/xcy1221/EhTool/main/dist/eh-search-tool.user.js
// ==/UserScript==

(() => {
'use strict';
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

const STORE = 'eh-search-tool:v1';
const SITE_THEME = location.hostname === 'exhentai.org' ? 'dark' : 'light';
const UI_STORE = 'eh-search-tool:ui:v1';
const READER_DEFAULTS = Object.freeze({ enabled: true, ahead: 5, behind: 3, concurrency: 2, imageRetries: 1, retryInterval: 3, timeout: 15000, maxWidth: 1100, gap: 8 });

function readStore(key, fallback) {
  try {
    return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch { return fallback; }
}
function writeStore(key, value) {
  if (typeof GM_setValue === 'function') GM_setValue(key, value);
  else localStorage.setItem(key, JSON.stringify(value));
}
function boundedNumber(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function readUI() {
  const raw = readStore(UI_STORE, {});
  const reader = raw?.reader;
  return {
    theme: ['light', 'dark'].includes(raw?.theme) ? raw.theme : SITE_THEME,
    sections: raw?.sections && typeof raw.sections === 'object' ? raw.sections : {},
    comments: { enabled: raw?.comments?.enabled !== false, collapsed: raw?.comments?.collapsed === true },
    reader: {
      ...READER_DEFAULTS,
      enabled: reader?.enabled !== false,
      ahead: boundedNumber(reader?.ahead, READER_DEFAULTS.ahead, 0, 20),
      behind: boundedNumber(reader?.behind, READER_DEFAULTS.behind, 0, 20),
      concurrency: boundedNumber(reader?.concurrency, READER_DEFAULTS.concurrency, 1, 4),
      imageRetries: boundedNumber(reader?.imageRetries, READER_DEFAULTS.imageRetries, 0, 20),
      retryInterval: boundedNumber(reader?.retryInterval, READER_DEFAULTS.retryInterval, 0, 300),
      maxWidth: boundedNumber(reader?.maxWidth, READER_DEFAULTS.maxWidth, 320, 2400),
      gap: boundedNumber(reader?.gap, READER_DEFAULTS.gap, 0, 40),
    },
  };
}
function updateUI(patch) {
  const previous = readStore(UI_STORE, {});
  writeStore(UI_STORE, { ...previous, ...patch,
    sections: { ...previous?.sections, ...patch.sections },
    reader: { ...previous?.reader, ...patch.reader },
    comments: { ...previous?.comments, ...patch.comments },
  });
}
function setupSections(root, onError) {
  const saved = readUI().sections;
  root.querySelectorAll('details[data-section]').forEach(section => {
    const key = section.dataset.section;
    if (typeof saved[key] === 'boolean') section.open = saved[key];
    section.addEventListener('toggle', () => {
      if (!section.isConnected) return;
      if (readUI().sections[key] === section.open) return;
      try { updateUI({ sections: { [key]: section.open } }); }
      catch { onError?.('无法保存展开状态。'); }
    });
  });
}
function setupTheme(root, button, onError) {
  function apply(theme) {
    root.host.dataset.theme = theme;
    button.textContent = theme === 'dark' ? '浅色' : '深色';
    button.setAttribute('aria-label', theme === 'dark' ? '切换为浅色配色' : '切换为深色配色');
  }
  apply(readUI().theme);
  button.addEventListener('click', () => {
    const theme = root.host.dataset.theme === 'dark' ? 'light' : 'dark';
    try { updateUI({ theme }); apply(theme); }
    catch { onError?.('无法保存配色设置。'); }
  });
}

function setupGalleryLinks() {
  const settings = readStore(STORE, {});
  let enabled = settings?.galleryNewTabs !== false;
  let focus = settings?.galleryFocus !== false;
  const originals = new Map();
  function isGallery(link) {
    try {
      const url = new URL(link.href);
      return url.protocol === 'https:' && ['e-hentai.org', 'exhentai.org'].includes(url.hostname) && /^\/g\/\d+\/[a-z0-9]+\/?$/i.test(url.pathname);
    } catch { return false; }
  }
  function restore(link, original) {
    if (original.target === null) link.removeAttribute('target'); else link.setAttribute('target', original.target);
    if (original.rel === null) link.removeAttribute('rel'); else link.setAttribute('rel', original.rel);
  }
  function update(link) {
    if (!enabled || !isGallery(link)) {
      if (originals.has(link)) { restore(link, originals.get(link)); originals.delete(link); }
      return;
    }
    if (!originals.has(link)) originals.set(link, { target: link.getAttribute('target'), rel: link.getAttribute('rel') });
    link.target = '_blank'; link.relList.add('noopener');
  }
  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches('a[href]')) update(node);
    node.querySelectorAll('a[href]').forEach(update);
  }
  scan(document.documentElement);
  document.addEventListener('click', event => {
    if (!enabled || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || typeof GM_openInTab !== 'function') return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || !isGallery(link)) return;
    try { GM_openInTab(link.href, { active: focus, insert: true, setParent: true }); }
    catch { return; }
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') update(record.target);
      else record.addedNodes.forEach(scan);
    }
    for (const link of originals.keys()) if (!link.isConnected) originals.delete(link);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  return { setFocus(value) { focus = value; }, setEnabled(value) {
    enabled = value;
    if (enabled) scan(document.documentElement);
    else { for (const [link, original] of originals) restore(link, original); originals.clear(); }
  } };
}

function readerPage(value, base = location.href) {
  try {
    const url = new URL(value, base);
    const source = new URL(base);
    const match = url.pathname.match(/^\/s\/[a-z0-9]+\/(\d+)-([1-9]\d*)\/?$/i);
    if (url.origin !== source.origin || !['https:', 'http:'].includes(url.protocol) || !match) return null;
    return { url: url.href, gid: match[1], index: Number(match[2]) };
  } catch { return null; }
}
function parseReaderPage(doc, value) {
  const page = readerPage(value);
  const image = doc.querySelector('#img');
  if (!page || !image) throw new Error('无法识别图片页，可能需要重新登录或已达到站点限制。');
  let imageUrl;
  try { imageUrl = new URL(image.getAttribute('src'), value); } catch {}
  if (!image.getAttribute('src') || !imageUrl || !['https:', 'http:'].includes(imageUrl.protocol)) throw new Error('图片地址不可用。');
  const links = [...doc.querySelectorAll('a[href]')];
  const reloadControl = doc.querySelector('#loadfail, a[onclick*="nl("]');
  const reloadToken = reloadControl?.getAttribute('onclick')?.match(/\bnl\(\s*(?:'([\w-]{1,200})'|"([\w-]{1,200})"|(\d{1,200}))\s*\)/);
  const reload = new URL(page.url);
  if (reloadToken) reload.searchParams.set('nl', reloadToken[1] || reloadToken[2] || reloadToken[3]);
  function adjacent(delta, selector) {
    const preferred = doc.querySelector(selector);
    for (const link of [preferred, ...links]) {
      if (!link) continue;
      const info = readerPage(link.getAttribute('href'), value);
      if (info?.gid === page.gid && info.index === page.index + delta) return info.url;
    }
    return null;
  }
  const counters = [...doc.querySelectorAll('#i2 .sn span, #i4 .sn span, .sn span')].map(el => Number(el.textContent.trim())).filter(Number.isInteger);
  const total = counters.findLast(number => number >= page.index) || null;
  const gallery = links.map(link => {
    try {
      const url = new URL(link.getAttribute('href'), value);
      return url.origin === new URL(value).origin && new RegExp('^/g/' + page.gid + '/[a-z0-9]+/?$', 'i').test(url.pathname) ? url.href : null;
    } catch { return null; }
  }).find(Boolean);
  return {
    ...page, imageUrl: imageUrl.href, reloadUrl: reloadToken ? reload.href : null, prev: adjacent(-1, '#prev'), next: adjacent(1, '#next'), total, gallery,
    width: image.naturalWidth || Number(image.getAttribute('width')) || parseFloat(image.style.width) || 0,
    height: image.naturalHeight || Number(image.getAttribute('height')) || parseFloat(image.style.height) || 0,
  };
}
function readerBounds(first, last, direction, config, total) {
  return {
    first: Math.max(1, first - (direction > 0 ? config.behind : config.ahead)),
    last: Math.min(total || Infinity, last + (direction > 0 ? config.ahead : config.behind)),
  };
}

function setupContinuousReader() {
  if (!readerPage(location.href) || document.getElementById('eh-continuous-reader')) return;
  if (!document.querySelector('#img')) {
    const observer = new MutationObserver(() => {
      if (document.querySelector('#img')) { observer.disconnect(); clearTimeout(timeout); setupContinuousReader(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 10000);
    window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timeout); }, { once: true });
    return;
  }
  let initial;
  try { initial = parseReaderPage(document, location.href); } catch { return; }
  const nativeImage = document.querySelector('#img');
  let restoreSource = nativeImage.getAttribute('src');
  const nativeStyle = nativeImage.getAttribute('style');
  const nativeMarker = document.createComment('eh-reader-image');
  nativeImage.before(nativeMarker);
  function restoreNative() {
    if (nativeMarker.parentNode) nativeMarker.parentNode.insertBefore(nativeImage, nativeMarker.nextSibling);
    if (nativeStyle === null) nativeImage.removeAttribute('style'); else nativeImage.setAttribute('style', nativeStyle);
  }
  const host = document.createElement('div');
  host.id = 'eh-continuous-reader';
  const root = host.attachShadow({ mode: 'open' });
  document.body.append(host);
  let stop = () => {};
  function launcher() {
    host.classList.add('inactive');
    root.innerHTML = '<style>' + READER_STYLE + '</style><button id="reader-start">连续阅读</button>';
    host.dataset.theme = readUI().theme;
    root.getElementById('reader-start').addEventListener('click', () => {
      try { updateUI({ reader: { enabled: true } }); } catch {}
      start();
    });
  }
  function start() {
    try { initial = parseReaderPage(document, location.href); } catch {}
    host.classList.remove('inactive');
    root.innerHTML = '<style>' + READER_STYLE + '</style>' +
      '<header><strong>连续阅读</strong><span id="reader-progress" role="status"></span><a id="reader-gallery">画廊</a><button id="reader-theme"></button>' +
      '<details data-section="reader-settings"><summary>设置</summary><div class="reader-settings"><label>沿方向预加载<input id="reader-ahead" type="number" min="0" max="20"></label><label>反方向保留<input id="reader-behind" type="number" min="0" max="20"></label><label>最大宽度<input id="reader-width" type="number" min="320" max="2400" step="10"></label><label>图片间距<input id="reader-gap" type="number" min="0" max="40"></label><label>自动重试次数<input id="reader-retries" type="number" min="0" max="20"></label><label>重试间隔（秒）<input id="reader-retry-interval" type="number" min="0" max="300"></label><p class="reader-hint">0 次关闭自动重试；手动重试立即执行。</p><p id="reader-status" role="status"></p></div></details>' +
      '<button id="reader-close">返回原页</button></header><main id="reader-scroll" tabindex="0" aria-label="纵向连续阅读"><div id="reader-pages"></div></main>';
    const $ = id => root.getElementById(id);
    const scroll = $('reader-scroll'), list = $('reader-pages');
    const gallery = $('reader-gallery');
    if (initial.gallery) gallery.href = initial.gallery; else gallery.hidden = true;
    setupTheme(root, $('reader-theme'), message => { $('reader-status').textContent = message; });
    setupSections(root, message => { $('reader-status').textContent = message; });
    let config = readUI().reader;
    let nativeTaken = false, restoring = false;
    let active = true, direction = 1, lastTop = 0, frame = 0, total = initial.total;
    let bounds = readerBounds(initial.index, initial.index, direction, config, total);
    const records = new Map(), tasks = new Map();
    let viewAnchor = null, viewWidth = scroll.clientWidth;
    function ordered() { return [...records.values()].sort((a, b) => a.index - b.index); }
    function inside(index) { return index >= bounds.first && index <= bounds.last; }
    function visible() {
      const viewport = scroll.getBoundingClientRect();
      const pages = ordered().filter(record => {
        const rect = record.element.getBoundingClientRect();
        return rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1;
      });
      if (pages.length) return { first: pages[0].index, last: pages.at(-1).index };
      // A resize or an exceptionally long gap can temporarily leave no page intersecting.
      const nearest = ordered().reduce((best, record) => {
        const distance = Math.abs(record.element.getBoundingClientRect().top - viewport.top);
        return !best || distance < best.distance ? { index: record.index, distance } : best;
      }, null);
      return { first: nearest?.index || initial.index, last: nearest?.index || initial.index };
    }
    function preservePosition(change) {
      const viewport = scroll.getBoundingClientRect();
      const anchor = ordered().find(record => record.element.getBoundingClientRect().bottom > viewport.top + 1);
      const before = anchor?.element.getBoundingClientRect().top;
      change();
      if (anchor) scroll.scrollTop += anchor.element.getBoundingClientRect().top - before;
      lastTop = scroll.scrollTop;
    }
    function layout(record) {
      const info = record.info;
      const width = info?.width || initial.width || config.maxWidth;
      const height = info?.height || initial.height || width * 1.4;
      record.element.style.width = Math.min(width, config.maxWidth) + 'px';
      record.element.style.aspectRatio = width + ' / ' + height;
    }
    function add(index, url, info = null) {
      if (records.has(index)) return records.get(index);
      const element = document.createElement('figure');
      element.dataset.page = index;
      element.dataset.state = 'idle';
      const caption = document.createElement('figcaption'); caption.textContent = '第 ' + index + ' 张';
      const placeholder = document.createElement('div'); placeholder.className = 'placeholder'; placeholder.textContent = '等待加载';
      element.append(caption, placeholder);
      const record = { index, url, info, element, placeholder, image: null, error: false, reloadUrl: info?.reloadUrl, refresh: false, recoveries: 0, retryTimer: null, retryStarted: 0, retryError: null };
      records.set(index, record); layout(record);
      const following = ordered().find(other => other.index > index);
      preservePosition(() => list.insertBefore(element, following?.element || null));
      return record;
    }
    function neighbors() {
      for (const record of ordered()) {
        if (!record.info) continue;
        for (const [index, url] of [[record.index - 1, record.info.prev], [record.index + 1, record.info.next]]) {
          if (url && inside(index)) add(index, url);
        }
      }
    }
    function release(record) {
      if (record.image) {
        if (record.image === nativeImage) {
          if (!restoring) nativeImage.removeAttribute('src');
          restoreNative();
        } else { record.image.removeAttribute('src'); record.image.remove(); }
        record.image = null;
      }
      if (!record.error) { record.element.dataset.state = 'idle'; record.placeholder.hidden = false; record.placeholder.textContent = '滚动到此处重新加载'; }
    }
    function clearRetry(record) {
      if (record.retryTimer !== null) clearTimeout(record.retryTimer);
      record.retryTimer = null;
    }
    function waitRetry(record, error, started = Date.now()) {
      clearRetry(record);
      record.error = false; record.info = null; record.refresh = true;
      record.retryStarted = started; record.retryError = error;
      release(record);
      record.element.dataset.state = 'retry-wait';
      const delay = Math.max(0, config.retryInterval * 1000 - (Date.now() - started));
      const text = document.createElement('span');
      text.textContent = '加载失败，' + Math.ceil(delay / 1000) + ' 秒后重试（' + record.recoveries + '/' + config.imageRetries + '）';
      const button = document.createElement('button'); button.textContent = '立即重试';
      button.addEventListener('click', () => retryRecord(record));
      record.placeholder.replaceChildren(text, button);
      record.retryTimer = setTimeout(() => {
        record.retryTimer = null;
        if (!active || !inside(record.index)) return;
        record.element.dataset.state = 'idle';
        record.placeholder.textContent = '正在重试…';
        schedule();
      }, delay);
    }
    function applyRetryConfig() {
      for (const record of records.values()) {
        if (!inside(record.index)) continue;
        if (record.retryTimer !== null) {
          if (record.recoveries > config.imageRetries) fail(record, record.retryError);
          else waitRetry(record, record.retryError, record.retryStarted);
        } else if (record.error && record.recoveries < config.imageRetries) {
          record.recoveries++; waitRetry(record, record.retryError);
        }
      }
      schedule();
    }
    function fail(record, error) {
      clearRetry(record); record.retryError = error;
      record.error = true; record.element.dataset.state = 'error';
      record.placeholder.hidden = false; record.placeholder.replaceChildren();
      const text = document.createElement('span'); text.textContent = '第 ' + record.index + ' 张加载失败：' + error.message;
      const retry = document.createElement('button'); retry.textContent = '重试';
      retry.addEventListener('click', () => {
        retryRecord(record);
      });
      record.placeholder.append(text, retry);
    }
    function retryRecord(record) {
      clearRetry(record);
      tasks.get(record.index)?.cancel(); tasks.delete(record.index);
      record.error = false; record.info = null; record.refresh = true; record.recoveries = 0;
      release(record); schedule();
    }
    function finish(record, task, error) {
      if (tasks.get(record.index) !== task) return;
      tasks.delete(record.index);
      if (!active || task.cancelled) return;
      if (error && record.recoveries < config.imageRetries) {
        record.recoveries++; waitRetry(record, error);
      } else if (error) fail(record, error);
      schedule();
    }
    function fetchPage(record) {
      const controller = new AbortController();
      const task = { kind: 'page', cancelled: false, cancel() { this.cancelled = true; controller.abort(); clearTimeout(timer); } };
      tasks.set(record.index, task); record.element.dataset.state = 'fetching';
      record.placeholder.textContent = '正在读取图片页…';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeout);
      (async () => {
        const target = record.refresh && record.reloadUrl ? record.reloadUrl : record.url;
        const response = await fetch(target, { credentials: 'same-origin', cache: record.refresh ? 'reload' : 'default', signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const page = readerPage(response.url || record.url);
        if (page?.gid !== initial.gid || page.index !== record.index) throw new Error('图片页发生跳转，请返回原页检查。');
        const info = parseReaderPage(new DOMParser().parseFromString(await response.text(), 'text/html'), page.url);
        if (!active || task.cancelled) return;
        preservePosition(() => { record.info = info; record.reloadUrl = info.reloadUrl; record.refresh = false; layout(record); });
        if (info.total) total = info.total;
      })().then(() => finish(record, task), error => finish(record, task, timedOut ? new Error('请求超时') : error)).finally(() => clearTimeout(timer));
    }
    function loadImage(record) {
      const useNative = !nativeTaken && record.index === initial.index && nativeImage.getAttribute('src') && nativeImage.src === record.info.imageUrl;
      const image = useNative ? nativeImage : document.createElement('img');
      if (useNative) { nativeTaken = true; nativeImage.removeAttribute('style'); }
      else { image.alt = '第 ' + record.index + ' 张'; image.decoding = 'async'; }
      const task = { kind: 'image', cancelled: false, finished: false, cancel() { this.cancelled = true; cleanup(); release(record); } };
      tasks.set(record.index, task); record.image = image;
      record.element.dataset.state = 'loading'; record.placeholder.textContent = '正在加载图片…';
      const timer = setTimeout(() => done(new Error('图片加载超时')), config.timeout);
      const onLoad = () => done();
      const onError = () => done(new Error('图片地址失效或网络异常'));
      function cleanup() { clearTimeout(timer); image.removeEventListener('load', onLoad); image.removeEventListener('error', onError); }
      function done(error) {
        if (task.cancelled || task.finished || !active) return;
        task.finished = true; cleanup();
        if (error) release(record);
        else {
          preservePosition(() => {
            record.info.width = image.naturalWidth || record.info.width;
            record.info.height = image.naturalHeight || record.info.height;
            layout(record);
          });
          if (record.index === initial.index) restoreSource = record.info.imageUrl;
          record.recoveries = 0; record.retryError = null;
          record.element.dataset.state = 'loaded'; record.placeholder.hidden = true;
        }
        finish(record, task, error);
      }
      image.addEventListener('load', onLoad); image.addEventListener('error', onError);
      record.element.append(image);
      if (!useNative) image.src = record.info.imageUrl;
      else if (image.complete) queueMicrotask(() => done(image.naturalWidth ? undefined : new Error('原站图片未加载成功')));
    }
    function reconcile() {
      frame = 0;
      if (!active) return;
      const range = visible();
      const anchorRect = records.get(range.first)?.element.getBoundingClientRect();
      if (anchorRect?.height) viewAnchor = { index: range.first, fraction: (scroll.getBoundingClientRect().top - anchorRect.top) / anchorRect.height };
      viewWidth = scroll.clientWidth;
      bounds = readerBounds(range.first, range.last, direction, config, total);
      host.dataset.direction = direction > 0 ? 'down' : 'up';
      host.dataset.first = bounds.first; host.dataset.last = bounds.last;
      $('reader-progress').textContent = '第 ' + range.first + ' 张' + (total ? ' / ' + total : '');
      neighbors();
      for (const [index, task] of tasks) if (!inside(index)) { task.cancel(); tasks.delete(index); }
      for (const record of records.values()) if (!inside(record.index)) {
        clearRetry(record); record.recoveries = 0; release(record);
      }
      const priority = record => {
        if (record.index >= range.first && record.index <= range.last) return -1000;
        return direction > 0
          ? record.index > range.last ? record.index - range.last : 100 + range.first - record.index
          : record.index < range.first ? range.first - record.index : 100 + record.index - range.last;
      };
      const queue = ordered().filter(record => inside(record.index) && !record.image && !record.error && record.retryTimer === null && !tasks.has(record.index)).sort((a, b) => priority(a) - priority(b));
      for (const record of queue) {
        if (tasks.size >= config.concurrency) break;
        if (record.info) loadImage(record); else fetchPage(record);
      }
    }
    function schedule() { if (active && !frame) frame = requestAnimationFrame(reconcile); }
    function onScroll() {
      const delta = scroll.scrollTop - lastTop;
      if (Math.abs(delta) > 1) direction = delta > 0 ? 1 : -1;
      lastTop = scroll.scrollTop; schedule();
    }
    function onKey(event) {
      const target = event.composedPath()[0];
      if (event.ctrlKey || event.metaKey || event.altKey || target?.matches?.('input, select, textarea, button, summary, a') || target?.isContentEditable) return;
      let amount = 0;
      const key = event.key.toLowerCase();
      if (['arrowdown', 's'].includes(key)) amount = 80;
      else if (['arrowup', 'w'].includes(key)) amount = -80;
      else if (key === 'pagedown' || key === ' ') amount = scroll.clientHeight * (event.shiftKey ? -0.85 : 0.85);
      else if (key === 'pageup') amount = -scroll.clientHeight * 0.85;
      else if (key === 'home') amount = -scroll.scrollTop;
      else if (key === 'end') amount = scroll.scrollHeight;
      else if (['arrowleft', 'arrowright', 'a', 'd'].includes(key)) {
        const index = visible().first + (['arrowleft', 'a'].includes(key) ? -1 : 1);
        const page = records.get(index);
        if (page) amount = page.element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      } else if (key === 'r') {
        const record = records.get(visible().first);
        if (record) retryRecord(record);
      } else if (key === 'escape') { stop(); launcher(); }
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (amount) scroll.scrollBy({ top: amount, behavior: 'auto' });
    }
    function applyConfig() {
      preservePosition(() => { list.style.gap = config.gap + 'px'; for (const record of records.values()) layout(record); });
      schedule();
    }
    function onResize() {
      const saved = viewAnchor, widthChanged = scroll.clientWidth !== viewWidth;
      applyConfig();
      const page = saved && records.get(saved.index)?.element;
      if (widthChanged && page) {
        const rect = page.getBoundingClientRect();
        scroll.scrollTop += rect.top - scroll.getBoundingClientRect().top + saved.fraction * rect.height;
        lastTop = scroll.scrollTop;
      }
      viewWidth = scroll.clientWidth;
    }
    for (const [id, key, min, max] of [['reader-ahead', 'ahead', 0, 20], ['reader-behind', 'behind', 0, 20], ['reader-width', 'maxWidth', 320, 2400], ['reader-gap', 'gap', 0, 40], ['reader-retries', 'imageRetries', 0, 20], ['reader-retry-interval', 'retryInterval', 0, 300]]) {
      $(id).value = config[key];
      $(id).addEventListener('change', () => {
        const value = Number($(id).value);
        if ($(id).value === '' || !Number.isInteger(value) || value < min || value > max) { $(id).value = config[key]; $('reader-status').textContent = '请输入 ' + min + '–' + max + ' 的整数。'; return; }
        try {
          updateUI({ reader: { [key]: value } }); config = readUI().reader;
          if (key === 'imageRetries' || key === 'retryInterval') applyRetryConfig(); else applyConfig();
          $('reader-status').textContent = '已保存并应用。';
        }
        catch { $('reader-status').textContent = '无法保存阅读设置。'; }
      });
    }
    stop = () => {
      if (!active) return;
      restoring = true; active = false; cancelAnimationFrame(frame);
      for (const task of tasks.values()) task.cancel();
      tasks.clear();
      for (const record of records.values()) { clearRetry(record); release(record); }
      records.clear();
      scroll.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey, true);
      resizeObserver?.disconnect();
      restoreNative();
      if (nativeImage.getAttribute('src') !== restoreSource) nativeImage.setAttribute('src', restoreSource);
    };
    $('reader-close').addEventListener('click', () => { stop(); launcher(); });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    resizeObserver?.observe(scroll);
    add(initial.index, initial.url, { ...initial });
    applyConfig();
    scroll.focus({ preventScroll: true });
  }
  window.addEventListener('pagehide', () => { stop(); launcher(); });
  window.addEventListener('pageshow', event => { if (event.persisted && readUI().reader.enabled) start(); });
  if (readUI().reader.enabled) start(); else launcher();
}

function setupGalleryComments() {
  if (!/^\/g\/\d+\/[a-z\d]+\/?$/i.test(location.pathname) || !readUI().comments.enabled) return;
  const ownerDocument = document;
  function mountComments() {
    const comments = ownerDocument.getElementById('cdiv');
    if (!comments || ownerDocument.getElementById('eh-gallery-comments')) return !!comments;
    const host = ownerDocument.createElement('div');
    host.id = 'eh-gallery-comments';
    host.dataset.theme = readUI().theme;
    const root = host.attachShadow({ mode: 'open' });
    const style = ownerDocument.createElement('style');
    style.textContent = COMMENTS_STYLE;
    const bar = ownerDocument.createElement('div');
    const label = ownerDocument.createElement('span');
    label.textContent = '画廊评论';
    const toggle = ownerDocument.createElement('button');
    toggle.type = 'button';
    toggle.id = 'comments-toggle';
    bar.append(label, toggle);
    root.append(style, bar);
    comments.before(host);
    const original = { hidden: comments.hidden, display: comments.style.getPropertyValue('display'), priority: comments.style.getPropertyPriority('display') };
    let collapsed = readUI().comments.collapsed;
    function render() {
      if (collapsed) {
        comments.hidden = true;
        comments.style.setProperty('display', 'none', 'important');
      } else {
        comments.hidden = original.hidden;
        if (original.display) comments.style.setProperty('display', original.display, original.priority);
        else comments.style.removeProperty('display');
      }
      toggle.textContent = collapsed ? '展开评论区' : '收起评论区';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    }
    toggle.addEventListener('click', () => { collapsed = !collapsed; render(); });
    render();
    return true;
  }
  if (mountComments()) return;
  const observer = new MutationObserver(() => { if (mountComments()) observer.disconnect(); });
  observer.observe(ownerDocument.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  setTimeout(() => observer.disconnect(), 10000);
}

const STYLE = ":host {\n  --text:#29372f; --muted:#637164; --surface:#fff; --subtle:#f2f6f1; --border:#ced9cc; --hover:#eaf3e6;\n  --accent:#426c49; --accent-hover:#355a3c; --on-accent:#fff; --shadow:#17291b33;\n  --include:#2d6b31; --include-bg:#eaf5e5; --include-border:#84b87c; --include-solid:#3d773f;\n  --exclude:#a04a3e; --exclude-bg:#fceeea; --exclude-border:#d49c91; --exclude-solid:#b45a4e;\n  --or:#4c6693; --or-bg:#f1f5fc; --or-border:#8aa5d1; --or-solid:#4c6693;\n  color-scheme:light;\n}\n:host([data-theme=dark]) {\n  --text:#e2e7df; --muted:#acb7a7; --surface:#292c28; --subtle:#22251f; --border:#505747; --hover:#394331;\n  --accent:#526d3d; --accent-hover:#627e4b; --on-accent:#fff; --shadow:#0007;\n  --include:#b3d9a9; --include-bg:#30412b; --include-border:#66835a; --include-solid:#45663d;\n  --exclude:#f0b0a5; --exclude-bg:#472e2a; --exclude-border:#99665c; --exclude-solid:#8a453a;\n  --or:#b4c8ee; --or-bg:#2c3546; --or-border:#687fab; --or-solid:#425c86;\n  color-scheme:dark;\n}\n\n:host { position:fixed; left:12px; top:72px; width:540px; max-width:calc(100vw - 24px); z-index:2147482000; display:block; color:var(--text); font:13px/1.5 system-ui,-apple-system,\"Segoe UI\",\"Microsoft YaHei\",sans-serif; text-align:left; pointer-events:none; }\n* { box-sizing:border-box; }\n[hidden] { display:none !important; }\nsection { display:flex; flex-direction:column; max-height:calc(100vh - 88px); max-height:calc(100dvh - 88px); background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:0 8px 32px var(--shadow); overflow:hidden; pointer-events:auto; }\nheader { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; background:var(--subtle); border-bottom:1px solid var(--border); flex-shrink:0; }\nh2 { font-size:19px; margin:0; font-weight:650; }\nh3 { font-size:13px; margin:0; } h3 span { color:var(--muted); margin-left:5px; }\n#body { padding:14px 16px; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; min-height:0; }\nbutton, input, select, textarea { font:inherit; }\nbutton, .file-button { color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:7px 9px; cursor:pointer; line-height:1.4; }\nbutton:hover, .file-button:hover { background:var(--hover); border-color:var(--accent-hover); }\nbutton:disabled { opacity:.5; cursor:default; }\nbutton:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, .file-button:focus-within { outline:2px solid var(--accent); outline-offset:2px; }\ninput:not([type=checkbox]):not([type=file]), select, textarea { width:100%; min-width:0; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:7px 9px; min-height:34px; }\ninput[type=checkbox] { accent-color:var(--accent); }\nlabel { display:block; min-width:0; font-size:11px; color:var(--muted); } label input, label select { margin-top:4px; }\n.block-title { margin-bottom:9px; } .native-filters { display:flex; align-items:end; gap:10px; margin-bottom:18px; }\nfieldset { border:0; padding:0; margin:0; min-width:0; flex:1; } legend { padding:0; font-size:11px; color:var(--muted); }\n.native-filters > label { width:84px; flex-shrink:0; } .range { display:flex; align-items:center; gap:5px; } .range label { flex:1; font-size:0; } .range input { font-size:12px; } .range span { color:var(--muted); padding-top:4px; }\n.toolbar { display:flex; gap:8px; align-items:end; } .grow { flex:1; min-width:0; } .toolbar > label:not(.grow) { width:100px; }\n.tabs { display:flex; gap:6px; margin:0 0 10px; } .tabs button { flex:1; font-size:12px; padding:7px; }\n.tabs button[aria-pressed=true] { color:var(--accent); background:var(--hover); border-color:var(--accent-hover); font-weight:600; }\n.exact { display:flex; align-items:center; gap:6px; margin-top:10px; } .exact input { margin:0; }\n.list-meta, .query-head { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--muted); font-size:10px; margin:10px 0 6px; }\n.tag-purpose { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-top:10px; font-size:11px; color:var(--muted); }\n.tag-purpose button { font-size:11px; padding:5px 9px; }\n[data-add-mode=include] { color:var(--include); border-color:var(--include-border); }\n[data-add-mode=exclude] { color:var(--exclude); border-color:var(--exclude-border); }\n[data-add-mode=or] { color:var(--or); border-color:var(--or-border); }\n[data-add-mode=include][aria-pressed=true] { background:var(--include-solid); color:var(--on-accent); border-color:var(--include-solid); }\n[data-add-mode=exclude][aria-pressed=true] { background:var(--exclude-solid); color:var(--on-accent); border-color:var(--exclude-solid); }\n[data-add-mode=or][aria-pressed=true] { background:var(--or); color:var(--on-accent); border-color:var(--or); }\n#results { display:flex; flex-wrap:wrap; align-content:flex-start; gap:6px; max-height:190px; overflow-y:auto; scrollbar-width:thin; padding:2px; }\n.tag-row { border:1px solid var(--border); border-radius:6px; min-width:0; max-width:100%; padding:5px 10px; background:var(--surface); font-size:12px; overflow-wrap:anywhere; }\n.tag-row.include { border-color:var(--include-border); color:var(--include); background:var(--include-bg); }\n.tag-row.exclude { border-color:var(--exclude-border); color:var(--exclude); background:var(--exclude-bg); }\n.tag-row.or { border-color:var(--or-border); color:var(--or); background:var(--or-bg); }\n.more { text-align:center; } .more button { margin-top:6px; padding:3px 10px; font-size:11px; }\n.selection-title { display:flex; align-items:center; justify-content:space-between; margin-top:15px; border-top:1px solid var(--border); padding-top:12px; }\n.selection-title button { padding:3px 7px; font-size:10px; }\n#selected { margin-top:8px; } .selected-group { border-left:3px solid var(--include-border); background:var(--include-bg); border-radius:4px; padding:8px; margin-top:6px; }\n.selected-group > strong { color:var(--include); font-size:12px; } .selected-group .hint { margin:2px 0 5px; font-size:10px; }\n.selected-group.exclude { border-color:var(--exclude-border); background:var(--exclude-bg); } .selected-group.exclude > strong { color:var(--exclude); }\n.selected-group.or { border-color:var(--or-border); background:var(--or-bg); } .selected-group.or > strong { color:var(--or); }\n.chip { display:flex; align-items:center; gap:4px; margin-top:4px; min-width:0; background:var(--surface); border-radius:4px; padding:4px 5px; }\n.selected-name { flex:1; min-width:0; overflow-wrap:anywhere; font-size:12px; }\n.chip button { padding:3px 5px; font-size:10px; border-color:transparent; background:transparent; flex-shrink:0; }\n.chip .to-include { color:var(--include); } .chip .to-exclude { color:var(--exclude); } .chip .to-or { color:var(--or); }\n.keywords { margin-top:12px; }\n#query { font:11px/1.6 ui-monospace,Consolas,monospace; background:var(--subtle); resize:vertical; min-height:54px; }\n.small-actions { display:flex; gap:7px; margin-top:8px; } .small-actions button { font-size:11px; padding:5px 7px; }\nfooter { padding:11px 16px; border-top:1px solid var(--border); background:var(--subtle); flex-shrink:0; }\n.search-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }\n.search-actions button { width:100%; }\nbutton.primary { background:var(--accent); color:var(--on-accent); border-color:var(--accent); font-weight:600; } button.primary:hover { background:var(--accent-hover); }\n.hint { font-size:10px; color:var(--muted); margin:4px 0; }\n.empty { color:var(--muted); font-size:11px; margin:8px 0; }\ndetails { margin-top:12px; border-top:1px solid var(--border); padding-top:8px; }\nsummary { cursor:pointer; color:var(--muted); font-size:11px; padding:3px 0; }\n.manual { display:flex; align-items:end; flex-wrap:wrap; gap:7px; margin-top:9px; } .manual .grow { flex-basis:100%; }\n.preset-row { display:flex; align-items:end; gap:7px; margin-top:9px; } .preset-row button { font-size:11px; }\n.preset { display:inline-flex; margin:7px 5px 0 0; } .preset button { padding:5px 7px; font-size:11px; }\n.dictionary { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; } .dictionary > div { width:100%; }\n.dictionary strong { font-size:11px; } .dictionary button, .file-button { font-size:11px; }\n.file-button { position:relative; overflow:hidden; } .file-button input { position:absolute; opacity:0; inset:0; width:100%; cursor:pointer; }\na { color:var(--include); font-size:10px; }\n#status { margin:5px 0 0; font-size:11px; color:var(--include); overflow-wrap:anywhere; }\n.error, #status.error { color:var(--exclude); }\n#launcher { pointer-events:auto; padding:10px 12px; background:var(--accent); color:var(--on-accent); border-color:var(--accent); box-shadow:0 4px 16px var(--shadow); }\n@media(max-width:600px) { :host { top:12px; } section { max-height:calc(100vh - 24px); max-height:calc(100dvh - 24px); } }\n\n.header-actions { display:flex; gap:6px; flex-shrink:0; }\n.block { margin:0 0 12px; border:1px solid var(--border); border-radius:7px; padding:0; }\n.block > summary { padding:9px 10px; color:var(--text); font-size:12px; font-weight:600; background:var(--subtle); border-radius:6px; }\n.block > summary span { color:var(--muted); font-size:11px; font-weight:400; margin-left:8px; }\n.block-content { padding:10px; }\n.block-content > details:first-child { margin-top:0; }\n.native-filters { margin-bottom:0; }\n.selection-title { margin-top:0; border:0; padding-top:0; }\n.reading-options { display:flex; gap:10px; margin-top:10px; }\n.reading-options label { flex:1; }\n@media(max-width:420px) { header { padding:10px; gap:6px; } header .hint { max-width:140px; } #body { padding:10px; } footer { padding:10px; } }\n";
const READER_STYLE = ":host {\n  --text:#29372f; --muted:#637164; --surface:#fff; --subtle:#f2f6f1; --border:#ced9cc; --hover:#eaf3e6;\n  --accent:#426c49; --accent-hover:#355a3c; --on-accent:#fff; --shadow:#17291b33;\n  --include:#2d6b31; --include-bg:#eaf5e5; --include-border:#84b87c; --include-solid:#3d773f;\n  --exclude:#a04a3e; --exclude-bg:#fceeea; --exclude-border:#d49c91; --exclude-solid:#b45a4e;\n  --or:#4c6693; --or-bg:#f1f5fc; --or-border:#8aa5d1; --or-solid:#4c6693;\n  color-scheme:light;\n}\n:host([data-theme=dark]) {\n  --text:#e2e7df; --muted:#acb7a7; --surface:#292c28; --subtle:#22251f; --border:#505747; --hover:#394331;\n  --accent:#526d3d; --accent-hover:#627e4b; --on-accent:#fff; --shadow:#0007;\n  --include:#b3d9a9; --include-bg:#30412b; --include-border:#66835a; --include-solid:#45663d;\n  --exclude:#f0b0a5; --exclude-bg:#472e2a; --exclude-border:#99665c; --exclude-solid:#8a453a;\n  --or:#b4c8ee; --or-bg:#2c3546; --or-border:#687fab; --or-solid:#425c86;\n  color-scheme:dark;\n}\n\n:host { position:fixed; inset:0; z-index:2147481000; display:flex; flex-direction:column; background:var(--subtle); color:var(--text); font:13px/1.5 system-ui,\"Microsoft YaHei\",sans-serif; text-align:left; }\n:host(.inactive) { inset:auto auto 12px 12px; background:transparent; }\n* { box-sizing:border-box; } [hidden] { display:none !important; }\nheader { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 12px; background:var(--surface); border-bottom:1px solid var(--border); flex-shrink:0; }\n#reader-progress { flex:1; color:var(--muted); white-space:nowrap; }\nbutton, summary, input { font:inherit; }\nbutton, summary { border:1px solid var(--border); border-radius:5px; background:var(--surface); color:var(--text); padding:5px 9px; cursor:pointer; }\nbutton:hover, summary:hover { background:var(--hover); }\nbutton:focus-visible, summary:focus-visible, input:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }\na { color:var(--text); }\ndetails > summary { list-style:none; } details { position:relative; }\n.reader-settings { position:absolute; top:38px; right:0; width:270px; max-height:calc(100dvh - 64px); overflow-y:auto; max-width:calc(100vw - 24px); padding:12px; background:var(--surface); border:1px solid var(--border); border-radius:7px; box-shadow:0 4px 20px var(--shadow); z-index:2; }\n.reader-settings label { display:flex; justify-content:space-between; align-items:center; margin:6px 0; gap:8px; }\n.reader-settings input { width:80px; min-width:0; background:var(--subtle); color:var(--text); border:1px solid var(--border); padding:5px; border-radius:4px; }\n#reader-status { color:var(--muted); margin:5px 0 0; font-size:12px; }\n#reader-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; outline:none; overflow-anchor:none; }\n#reader-pages { display:flex; flex-direction:column; align-items:center; padding:8px 0; min-height:100%; overflow-anchor:none; }\nfigure { position:relative; flex-shrink:0; max-width:100%; margin:0; background:var(--surface); overflow:hidden; overflow-anchor:none; }\nfigure > img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; }\nfigcaption { position:absolute; left:6px; top:6px; padding:2px 6px; border-radius:4px; color:var(--muted); background:var(--surface); font-size:11px; opacity:.8; z-index:1; pointer-events:none; }\n.placeholder { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:20px; color:var(--muted); text-align:center; }\n@media(max-width:480px) { header { padding:6px; gap:5px; } header strong { display:none; } button,summary { padding:5px 7px; font-size:12px; } .reader-settings { position:fixed; top:48px; right:8px; } }\n\n.reader-hint { color:var(--muted); font-size:12px; margin:8px 0; }\n";
const COMMENTS_STYLE = ":host {\n  --text:#29372f; --muted:#637164; --surface:#fff; --subtle:#f2f6f1; --border:#ced9cc; --hover:#eaf3e6;\n  --accent:#426c49; --accent-hover:#355a3c; --on-accent:#fff; --shadow:#17291b33;\n  --include:#2d6b31; --include-bg:#eaf5e5; --include-border:#84b87c; --include-solid:#3d773f;\n  --exclude:#a04a3e; --exclude-bg:#fceeea; --exclude-border:#d49c91; --exclude-solid:#b45a4e;\n  --or:#4c6693; --or-bg:#f1f5fc; --or-border:#8aa5d1; --or-solid:#4c6693;\n  color-scheme:light;\n}\n:host([data-theme=dark]) {\n  --text:#e2e7df; --muted:#acb7a7; --surface:#292c28; --subtle:#22251f; --border:#505747; --hover:#394331;\n  --accent:#526d3d; --accent-hover:#627e4b; --on-accent:#fff; --shadow:#0007;\n  --include:#b3d9a9; --include-bg:#30412b; --include-border:#66835a; --include-solid:#45663d;\n  --exclude:#f0b0a5; --exclude-bg:#472e2a; --exclude-border:#99665c; --exclude-solid:#8a453a;\n  --or:#b4c8ee; --or-bg:#2c3546; --or-border:#687fab; --or-solid:#425c86;\n  color-scheme:dark;\n}\n\n:host { display:block; margin:12px auto; max-width:100%; font:13px/1.5 system-ui,-apple-system,\"Segoe UI\",\"Microsoft YaHei\",sans-serif; text-align:left; }\ndiv { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 14px; background:var(--subtle); color:var(--text); border:1px solid var(--border); border-radius:7px; }\nbutton { font:inherit; color:var(--text); background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer; }\nbutton:hover { background:var(--hover); border-color:var(--accent-hover); }\nbutton:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }\n";
const DICTIONARY = 'eh-search-tool:dictionary:v1';
const DICTIONARY_URL = 'https://raw.githubusercontent.com/EhTagTranslation/DatabaseReleases/master/db.text.json';
const galleryLinks = setupGalleryLinks();
const MODE_LABELS = { include: '必须包含', exclude: '排除此标签', or: '任一包含（OR）' };
const MODE_HINTS = { include: '绿色标签必须全部满足。', exclude: '含有任一红色标签的结果都会排除。', or: '蓝色标签至少满足一个，同时满足必须包含和排除条件。' };
const MODE_SWITCHES = { include: '改为包含', exclude: '改为排除', or: '改为 OR' };

function mount(input) {
  const form = input.form;
  if (!form || document.getElementById('eh-search-tool')) return;
  const host = document.createElement('div');
  host.id = 'eh-search-tool';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style);
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'eh工具');
  const launcher = document.createElement('button');
  launcher.type = 'button'; launcher.id = 'launcher'; launcher.textContent = 'eh工具';
  launcher.setAttribute('aria-label', '展开eh工具'); launcher.setAttribute('aria-expanded', 'false');
  root.append(launcher);
  panel.innerHTML = `
    <header><div><h2>eh工具</h2><p class="hint">组合条件，可填入或直接搜索</p></div>
      <div class="header-actions"><button id="theme" type="button">深色</button><button id="toggle" aria-expanded="true" aria-controls="body">收起</button></div></header>
    <div id="body">
      <details class="block" data-section="filters" open><summary>页数与评分筛选</summary><div class="block-content"><div class="native-filters">
        <fieldset><legend>页数范围</legend><div class="range"><label>最少页数<input id="page-min" type="text" inputmode="numeric" placeholder="不限" autocomplete="off"></label><span>—</span><label>最多页数<input id="page-max" type="text" inputmode="numeric" placeholder="不限" autocomplete="off"></label></div></fieldset>
        <label>最低评分<select id="rating"><option value="0">不限</option><option value="2">2 星</option><option value="3">3 星</option><option value="4">4 星</option><option value="5">5 星</option></select></label>
      </div>
      </div></details><details class="block" data-section="tags" open><summary>标签选择</summary><div class="block-content">
      <div class="tabs" role="group" aria-label="标签列表"><button data-view="recent" aria-pressed="false">历史标签</button><button data-view="all" aria-pressed="true">查找新标签</button></div>
      <div class="toolbar">
        <label class="grow">查找标签<input id="lookup" type="search" placeholder="中文、英文或 namespace:tag" autocomplete="off"></label>
        <label>分类<select id="namespace"><option value="">全部分类</option></select></label>
      </div>
      <div class="tag-purpose" role="group" aria-label="标签用途"><span>点击标签时：</span><button data-add-mode="include" aria-pressed="true">必须包含</button><button data-add-mode="exclude" aria-pressed="false">排除此标签</button><button data-add-mode="or" aria-pressed="false">任一包含（OR）</button></div>
      <p id="mode-hint" class="hint">${MODE_HINTS.include}</p>
      <div class="list-meta"><span id="count"></span><span>点击名称添加 · 再点取消</span></div>
      <div id="results" aria-label="可选标签"></div>
      <div class="more"><button id="more" hidden>显示更多</button></div>
      <details data-section="manual"><summary>手动添加标签</summary><div class="manual"><label class="grow">英文标签<input id="manual" placeholder="例如 artist:example artist"></label><label>用途<select id="manual-mode"><option value="include">必须包含</option><option value="exclude">排除此标签</option><option value="or">任一包含（OR）</option></select></label><button id="add-manual">添加</button></div><p class="hint">填写 namespace:tag；只写标签时，需要先选择分类。</p></details>
      </div></details><details class="block" data-section="selected" open><summary>已选条件 <span id="selection-summary">0 个标签</span></summary><div class="block-content"><div class="selection-title"><h3>已选标签 <span id="selected-count">0</span></h3><button id="clear">清空已选</button></div>
      <div id="selected"></div></div></details>
      <label class="keywords">关键词 / 其他搜索语法<input id="keywords" placeholder="可输入多个词，用空格分隔"></label>
      <div class="query-head"><label for="query">待填入的搜索语句</label><span id="length"></span></div>
      <textarea id="query" readonly rows="2" spellcheck="false"></textarea><p id="limits" class="hint error"></p>
      <div class="small-actions"><button id="read-native">读取原搜索栏</button><button id="restore-last" hidden>恢复上次组合</button></div>
      <details class="block" data-section="presets"><summary>保存常用组合</summary><div class="block-content">
        <div class="preset-row"><label class="grow">组合名称<input id="preset-name" maxlength="40" placeholder="给当前搜索起个名字"></label><button id="save-preset">保存组合</button></div>
        <div id="presets"></div>
      </div></details>
      <details class="block" data-section="settings"><summary>设置</summary><div class="block-content"><details data-section="site"><summary>站点行为</summary><label class="exact"><input id="gallery-new-tab" type="checkbox" checked> 点击画廊时在新标签页打开</label><label class="exact"><input id="gallery-focus" type="checkbox" checked> 打开画廊后切换到新标签页</label><p id="gallery-focus-hint" class="hint"></p></details>
      <details data-section="comments"><summary>评论区设置</summary><label class="exact"><input id="comments-enabled" type="checkbox"> 画廊详情页显示评论区收起按钮</label><label class="exact"><input id="comments-collapsed" type="checkbox"> 打开画廊时默认收起评论区</label><p class="hint">详情页可随时展开或收起；设置在下次打开画廊时生效。</p></details>
      <details data-section="dictionary"><summary>词库与高级设置</summary>
        <label class="exact"><input id="exact" type="checkbox" checked> 新添加的标签使用完整名称匹配</label>
        <div class="dictionary"><div><strong>中英文标签词库</strong><p id="dictionary-info" class="hint"></p></div><button id="update">加载 / 更新完整词库</button><label class="file-button">导入 JSON<input id="import" type="file" accept=".json,application/json"></label></div>
        <p class="hint">完整词库来自 EhTagTranslation，按需下载，仅保存标签名称。不显示描述或图片，可与 EhSyringe 一起使用。</p>
        <a href="https://github.com/EhTagTranslation/Database" target="_blank" rel="noopener noreferrer">词库来源及许可：EhTagTranslation · CC BY-NC-SA 3.0</a>
      </details>
      <details data-section="reading"><summary>连续阅读设置</summary><label class="exact"><input id="reader-enabled" type="checkbox"> 图片页启用连续阅读</label><div class="reading-options"><label>沿方向预加载<input id="reader-ahead" type="number" min="0" max="20"></label><label>反方向保留<input id="reader-behind" type="number" min="0" max="20"></label></div><div class="reading-options"><label>自动重试次数<input id="reader-retries" type="number" min="0" max="20"></label><label>重试间隔（秒）<input id="reader-retry-interval" type="number" min="0" max="300"></label></div><p class="hint">0 次关闭自动重试；修改后在下次打开图片页时生效。</p></details></div></details>
    </div><footer><div class="search-actions"><button id="fill" type="button">填入搜索栏</button><button class="primary" id="fill-search" type="button">填入并搜索</button></div><p class="hint">填入仅替换条件；填入并搜索立即执行。</p><p id="status" role="status" aria-live="polite"></p></footer>`;
  root.append(panel);
  setupSections(root, message => status(message, true));
  setupTheme(root, root.getElementById('theme'), message => status(message, true));
  const $ = id => root.getElementById(id);
  const raw = readStore(STORE, {});
  const prefs = {
    favorites: Array.isArray(raw?.favorites) ? raw.favorites.filter(x => typeof x === 'string').slice(0, 10000) : [],
    history: Array.isArray(raw?.history) ? raw.history.filter(x => normalizeTag(x)).slice(0, 500).map(x => ({ ...normalizeTag(x), mode: ['include', 'exclude', 'or'].includes(x.mode) ? x.mode : 'include', exact: x.exact !== false, lastUsed: Number(x.lastUsed) || 0 })) : [],
    presets: Array.isArray(raw?.presets) ? raw.presets.filter(x => x && typeof x.name === 'string' && typeof x.query === 'string').slice(0, 30) : [],
    collapsed: raw?.collapsed === true,
    custom: Array.isArray(raw?.custom) ? mergeTags(raw.custom).slice(0, 1000) : [],
    lastQuery: typeof raw?.lastQuery === 'string' ? raw.lastQuery.slice(0, 10000) : '',
    lastFilters: raw?.lastFilters && typeof raw.lastFilters === 'object' ? raw.lastFilters : null,
    lastRating: ['0', '2', '3', '4', '5'].includes(raw?.lastRating) ? raw.lastRating : null,
    galleryNewTabs: raw?.galleryNewTabs !== false,
    galleryFocus: raw?.galleryFocus !== false,
  };
  let cached = readStore(DICTIONARY, {});
  let tags = mergeTags(prefs.history, SEED_TAGS, Array.isArray(cached?.tags) ? cached.tags : [], prefs.custom);
  let state = parseQuery('');
  let view = prefs.history.length ? 'recent' : 'all';
  let pageSize = 60;
  let addMode = 'include';
  let busy = false;
  let initialized = false;
  function nativeField(name) { return form.querySelector(`[name="${name}"]`); }
  function openNativeAdvanced() {
    const marker = nativeField('advsearch');
    const pane = form.querySelector('#advdiv');
    const collapsed = pane && (pane.hidden || getComputedStyle(pane).display === 'none');
    if (marker?.value === '1' && !marker.disabled && !collapsed) return;
    // Use the native handler so it can create controls and update its own state.
    const toggle = form.querySelector('#adv_toggle, a#advsearch, button#advsearch, [onclick*="advsearch"], a[href*="advsearch"]')
      || [...form.querySelectorAll('a, button')].find(element => /show advanced options|显示高级|展开高级/i.test(element.textContent));
    toggle?.click();
  }
  function readNativeFilters() {
    const enabled = nativeField('f_sr');
    return { min: nativeField('f_spf')?.value || '', max: nativeField('f_spt')?.value || '', rating: enabled?.type === 'checkbox' && !enabled.checked ? '0' : nativeField('f_srdd')?.value || '0' };
  }
  function currentFilters() { return { min: $('page-min').value.trim(), max: $('page-max').value.trim(), rating: $('rating').value }; }
  function setFilters(filters) {
    $('page-min').value = typeof filters?.min === 'string' ? filters.min : '';
    $('page-max').value = typeof filters?.max === 'string' ? filters.max : '';
    $('rating').value = ['0', '2', '3', '4', '5'].includes(filters?.rating) ? filters.rating : '0';
  }
  function filterError() {
    const { min, max } = currentFilters();
    for (const [value, name] of [[min, '最少页数'], [max, '最多页数']]) {
      if (value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 9999)) return `${name}请填写 1–9999 的整数，留空表示不限。`;
    }
    return min && max && Number(min) > Number(max) ? '最少页数不能大于最多页数。' : '';
  }
  function saveDraft() {
    prefs.lastQuery = buildQuery(state.base, state.selected);
    prefs.lastFilters = currentFilters();
    return persist();
  }

  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  function persist() {
    try { writeStore(STORE, prefs); return true; }
    catch { status('无法保存设置，请检查脚本管理器的存储权限。', true); return false; }
  }
  function button(text, label, action, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.setAttribute('aria-label', label);
    element.className = className;
    element.addEventListener('click', action);
    return element;
  }
  function displayName(tag) { return tags.find(item => tagKey(item) === tagKey(tag))?.name || tag.name || tag.tag; }
  function renderQuery() {
    const query = buildQuery(state.base, state.selected);
    $('query').value = query;
    $('length').textContent = `${query.length} / 200 字符`;
    $('length').classList.toggle('error', query.length > 200);
    $('fill').disabled = query.length > 200 || !!filterError();
    $('fill-search').disabled = $('fill').disabled;
    if (initialized) saveDraft();
    $('restore-last').hidden = !prefs.lastQuery && !prefs.lastFilters;
    const includes = state.selected.filter(tag => tag.mode !== 'exclude').length;
    const excludes = state.selected.length - includes;
    $('limits').textContent = filterError() || (query.length > 200 ? '搜索语句超过 200 字符，请减少条件。' : includes > 5 || excludes > 10 ? '原站最多支持 5 个包含 / 10 个排除条件，请减少标签。' : '');
  }
  function remember(item) {
    const key = tagKey(item);
    const known = tags.find(tag => tagKey(tag) === key);
    prefs.history = [{ ...normalizeTag(known || item), mode: item.mode, exact: item.exact, lastUsed: Date.now() }, ...prefs.history.filter(tag => tagKey(tag) !== key)].slice(0, 500);
  }
  function renderSelected() {
    $('selected').replaceChildren();
    $('selected-count').textContent = state.selected.length;
    $('selection-summary').textContent = state.selected.length + ' 个标签';
    if (!state.selected.length) {
      const empty = document.createElement('p');
      empty.className = 'empty'; empty.textContent = '还没有选择标签。从上方列表开始。';
      $('selected').append(empty);
    }
    const groups = new Map();
    for (const [mode, title, hint] of [['include', '必须包含', MODE_HINTS.include], ['exclude', '排除标签', MODE_HINTS.exclude], ['or', MODE_LABELS.or, MODE_HINTS.or]]) {
      if (mode === 'or' && !state.selected.some(item => item.mode === mode)) continue;
      const group = document.createElement('div'); group.className = `selected-group ${mode}`; group.dataset.mode = mode;
      const heading = document.createElement('strong'); heading.textContent = title;
      const help = document.createElement('p'); help.className = 'hint'; help.textContent = hint;
      group.append(heading, help); $('selected').append(group); groups.set(mode, group);
    }
    for (const item of state.selected) {
      const key = tagKey(item);
      const chip = document.createElement('div');
      chip.className = `chip ${item.mode}`;
      const name = document.createElement('span'); name.className = 'selected-name'; name.textContent = displayName(item);
      chip.append(name);
      for (const mode of Object.keys(MODE_LABELS)) {
        if (mode === item.mode) continue;
        chip.append(button(MODE_SWITCHES[mode], `将 ${key} ${MODE_SWITCHES[mode]}`, () => {
          item.mode = mode;
          remember(item); persist(); renderSelected(); renderResults();
        }, `switch-mode to-${mode}`));
      }
      chip.append(button('×', `移除 ${key}`, () => {
        state.selected = state.selected.filter(tag => tagKey(tag) !== key);
        renderSelected(); renderResults();
      }));
      chip.title = serializeTag(item);
      groups.get(item.mode).append(chip);
    }
    renderQuery();
  }
  function add(tag, mode = 'include') {
    const key = tagKey(tag);
    const previous = state.selected.find(selected => tagKey(selected) === key);
    const item = { ...tag, mode, exact: previous?.exact ?? $('exact').checked };
    const existing = state.selected.findIndex(selected => tagKey(selected) === key);
    if (existing >= 0) state.selected[existing] = item; else state.selected.push(item);
    remember(item);
    const saved = persist();
    renderSelected(); renderResults();
    if (saved) status(`${MODE_LABELS[mode]}：${tag.name || tag.tag}`);
  }
  function renderResults() {
    const results = searchTags(tags, $('lookup').value, $('namespace').value, [], view, prefs.history.map(tagKey));
    $('count').textContent = `${results.length} 个标签`;
    $('results').replaceChildren();
    $('more').hidden = results.length <= pageSize;
    if (!results.length) {
      const empty = document.createElement('p'); empty.className = 'empty';
      empty.textContent = view === 'recent' ? '还没有历史。到“查找新标签”选择，用过的标签会保存在这里。' : '没有匹配项。可加载完整词库，或手动添加英文标签。';
      $('results').append(empty);
    }
    const selected = new Map(state.selected.map(item => [tagKey(item), item.mode]));
    for (const tag of results.slice(0, pageSize)) {
      const key = tagKey(tag);
      const row = button(tag.name, `${MODE_LABELS[addMode]} ${key}`, () => {
        if (selected.get(key) === addMode) { state.selected = state.selected.filter(item => tagKey(item) !== key); renderSelected(); renderResults(); }
        else add(tag, addMode);
      }, `tag-row ${selected.get(key) || ''}`);
      row.title = `${NAMESPACES[tag.namespace]}：${tag.name}`;
      row.setAttribute('aria-pressed', String(selected.has(key)));
      $('results').append(row);
    }
  }
  function renderPresets() {
    $('presets').replaceChildren();
    for (const preset of prefs.presets) {
      const row = document.createElement('div'); row.className = 'preset';
      row.append(button(preset.name, `载入组合 ${preset.name}`, () => {
        state = parseQuery(preset.query); $('keywords').value = state.base;
        if (preset.filters) setFilters(preset.filters);
        renderSelected(); renderResults(); status(`已载入：${preset.name}`);
      }), button('×', `删除组合 ${preset.name}`, () => {
        prefs.presets = prefs.presets.filter(item => item !== preset); persist(); renderPresets();
      }));
      $('presets').append(row);
    }
  }
  function renderDictionary() {
    const date = cached?.updatedAt ? new Date(cached.updatedAt).toLocaleDateString('zh-CN') : '';
    $('dictionary-info').textContent = cached?.tags?.length ? `${tags.length} 个标签 · ${cached.source === 'import' ? '本地导入' : 'EhTagTranslation'} · ${date}` : '内置基础标签。加载完整词库后可搜索更多分类。';
  }
  function installDictionary(data, source) {
    const next = { tags: parseDictionary(data), updatedAt: Date.now(), source };
    writeStore(DICTIONARY, next); // Keep the previous dictionary if validation or storage fails.
    cached = next; tags = mergeTags(prefs.history, SEED_TAGS, next.tags, prefs.custom);
    renderDictionary(); renderSelected(); renderResults();
    status(`词库已更新：${tags.length} 个标签。`);
  }
  function setBusy(value) { busy = value; $('update').disabled = value; $('import').disabled = value; }
  $('update').addEventListener('click', () => {
    if (busy) return;
    if (typeof GM_xmlhttpRequest !== 'function') { status('本地演示不联网。安装到 Tampermonkey 后可加载词库，也可导入 JSON。', true); return; }
    setBusy(true); status('正在下载词库…');
    const fail = message => { setBusy(false); status(`${message} 现有词库仍可使用，也可导入 JSON。`, true); };
    try {
      GM_xmlhttpRequest({
        method: 'GET', url: DICTIONARY_URL, anonymous: true, timeout: 30000,
        onload(response) {
          if (response.status !== 200) { fail(`下载失败（HTTP ${response.status}）。`); return; }
          try { installDictionary(JSON.parse(response.responseText), 'remote'); }
          catch { fail('词库格式不正确或无法保存。'); }
          finally { setBusy(false); }
        },
        onerror: () => fail('网络连接失败。'), ontimeout: () => fail('下载超时。'), onabort: () => fail('下载已取消。'),
      });
    } catch { fail('无法发起下载，请检查脚本权限。'); }
  });
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || busy) return;
    setBusy(true);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('文件过大，最多支持 12 MB。');
      installDictionary(JSON.parse(await file.text()), 'import');
    } catch (error) { status(`导入失败：${error.message}`, true); }
    finally { event.target.value = ''; setBusy(false); }
  });
  $('add-manual').addEventListener('click', () => {
    const value = $('manual').value.trim();
    const colon = value.indexOf(':');
    const tag = normalizeTag({ namespace: colon >= 0 ? value.slice(0, colon).toLowerCase() : $('namespace').value, tag: colon >= 0 ? value.slice(colon + 1) : value });
    if (!tag) { status('请填写有效的 namespace:tag，标签中不能含双引号、$ 或额外的冒号。', true); return; }
    if (prefs.custom.length >= 1000 && !prefs.custom.some(item => tagKey(item) === tagKey(tag))) { status('手动标签最多保存 1000 个。', true); return; }
    const known = tags.find(item => tagKey(item) === tagKey(tag)) || tag;
    prefs.custom = mergeTags(prefs.custom, [known]);
    tags = mergeTags(tags, [known]); add(known, $('manual-mode').value); $('manual').value = '';
  });
  $('manual').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('add-manual').click(); } });
  $('lookup').addEventListener('input', () => { pageSize = 60; renderResults(); });
  $('lookup').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault(); root.querySelector('.tag-row')?.click();
    }
    if (event.key === 'Escape') { $('lookup').value = ''; renderResults(); }
  });
  $('namespace').addEventListener('change', () => { pageSize = 60; renderResults(); });
  $('more').addEventListener('click', () => { pageSize += 60; renderResults(); });
  root.querySelectorAll('[data-add-mode]').forEach(button => button.addEventListener('click', () => {
    addMode = button.dataset.addMode;
    root.querySelectorAll('[data-add-mode]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    $('mode-hint').textContent = MODE_HINTS[addMode];
    renderResults();
  }));
  $('gallery-new-tab').checked = prefs.galleryNewTabs;
  $('gallery-focus').checked = prefs.galleryFocus;
  function renderGalleryFocus() {
    const supported = typeof GM_openInTab === 'function';
    $('gallery-focus').disabled = !prefs.galleryNewTabs || !supported;
    $('gallery-focus-hint').textContent = supported ? '取消勾选后在后台打开画廊，继续浏览当前页面。' : '控制标签页切换需要 Tampermonkey 的 GM_openInTab 权限；本地演示沿用浏览器行为。';
  }
  renderGalleryFocus();
  const commentsPrefs = readUI().comments;
  $('comments-enabled').checked = commentsPrefs.enabled;
  $('comments-collapsed').checked = commentsPrefs.collapsed;
  $('comments-collapsed').disabled = !commentsPrefs.enabled;
  for (const [id, key] of [['comments-enabled', 'enabled'], ['comments-collapsed', 'collapsed']]) {
    $(id).addEventListener('change', () => {
      try {
        updateUI({ comments: { [key]: $(id).checked } });
        $('comments-collapsed').disabled = !$('comments-enabled').checked;
        status('评论区设置已保存，下次打开画廊时生效。');
      } catch {
        $(id).checked = readUI().comments[key];
        status('无法保存评论区设置。', true);
      }
    });
  }
  const readerPrefs = readUI().reader;
  $('reader-enabled').checked = readerPrefs.enabled;
  $('reader-enabled').addEventListener('change', () => {
    try { updateUI({ reader: { enabled: $('reader-enabled').checked } }); }
    catch { status('无法保存阅读设置。', true); }
  });
  for (const [id, key, max] of [['reader-ahead', 'ahead', 20], ['reader-behind', 'behind', 20], ['reader-retries', 'imageRetries', 20], ['reader-retry-interval', 'retryInterval', 300]]) {
    const control = $(id); control.value = readerPrefs[key];
    control.addEventListener('change', () => {
      const value = Number(control.value);
      if (control.value === '' || !Number.isInteger(value) || value < 0 || value > max) { control.value = readUI().reader[key]; status('请填写 0–' + max + ' 的整数。', true); return; }
      try { updateUI({ reader: { [key]: value } }); status('阅读设置已保存。'); }
      catch { status('无法保存阅读设置。', true); }
    });
  }
  $('gallery-new-tab').addEventListener('change', () => {
    prefs.galleryNewTabs = $('gallery-new-tab').checked;
    if (persist()) status(prefs.galleryNewTabs ? '画廊链接将默认在新标签页打开。' : '已恢复画廊链接原来的打开方式。');
    galleryLinks.setEnabled(prefs.galleryNewTabs);
    renderGalleryFocus();
  });
  $('gallery-focus').addEventListener('change', () => {
    prefs.galleryFocus = $('gallery-focus').checked;
    if (persist()) status(prefs.galleryFocus ? '打开画廊后将切换到新标签页。' : '画廊将在后台打开，保留当前页面。');
    galleryLinks.setFocus(prefs.galleryFocus);
  });
  root.querySelectorAll('[data-view]').forEach(tab => tab.addEventListener('click', () => {
    view = tab.dataset.view; pageSize = 60;
    root.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === tab)));
    renderResults();
  }));
  $('clear').addEventListener('click', () => { state.selected = []; renderSelected(); renderResults(); });
  $('restore-last').addEventListener('click', () => {
    state = parseQuery(prefs.lastQuery); $('keywords').value = state.base;
    if (prefs.lastFilters) setFilters(prefs.lastFilters);
    renderSelected(); renderResults(); status('已恢复上次组合，可继续选择标签。');
  });
  $('read-native').addEventListener('click', () => {
    state = parseQuery(input.value); $('keywords').value = state.base;
    setFilters(readNativeFilters());
    for (const tag of state.selected) remember(tag);
    tags = mergeTags(prefs.history, tags);
    renderSelected(); renderResults(); status('已读取当前搜索条件，可在工具内修改。');
  });
  for (const id of ['page-min', 'page-max']) $(id).addEventListener('input', renderQuery);
  $('rating').addEventListener('change', () => {
    prefs.lastRating = $('rating').value;
    renderQuery();
  });
  $('keywords').addEventListener('input', () => { state.base = $('keywords').value; renderQuery(); });
  $('save-preset').addEventListener('click', () => {
    const name = $('preset-name').value.trim();
    if (!name) { status('请先填写组合名称。', true); $('preset-name').focus(); return; }
    if (!prefs.presets.some(item => item.name === name) && prefs.presets.length >= 30) { status('最多保存 30 个组合，请先删除一个。', true); return; }
    if (filterError()) { status(filterError(), true); return; }
    prefs.presets = [...prefs.presets.filter(item => item.name !== name), { name, query: buildQuery(state.base, state.selected), filters: currentFilters() }];
    if (persist()) status(`已保存：${name}`);
    renderPresets();
  });
  form.addEventListener('submit', () => {
      const submitted = parseQuery(input.value);
      for (const tag of submitted.selected) remember(tag);
      tags = mergeTags(prefs.history, tags);
      persist(); renderResults();
  });
  function fillNative(submit = false) {
    const query = buildQuery(state.base, state.selected);
    if (query.length > 200 || filterError()) { status(filterError() || '搜索语句超过 200 字符。', true); return; }
    // Only this explicit action writes to native controls; composing never does.
    const writeField = (name, value) => {
      let field = nativeField(name);
      if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = name; form.append(field); }
      field.disabled = false;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const filters = currentFilters();
    if (filters.min || filters.max || filters.rating !== '0') {
      openNativeAdvanced();
      writeField('advsearch', '1');
    }
    writeField('f_spf', filters.min); writeField('f_spt', filters.max);
    const ratingEnabled = nativeField('f_sr');
    if (ratingEnabled?.type === 'checkbox') {
      ratingEnabled.checked = filters.rating !== '0';
      ratingEnabled.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const rating = nativeField('f_srdd');
    const supportsNone = rating?.tagName !== 'SELECT' || [...rating.options].some(option => option.value === '0');
    if (filters.rating !== '0' || supportsNone) writeField('f_srdd', filters.rating);
    writeField('f_search', query);
    saveDraft();
    if (submit) {
      status('已填入，正在搜索…');
      const submitters = [...form.elements].filter(field => !field.disabled && ['submit', 'image'].includes(field.type));
      const submitter = submitters.find(field => field.name === 'f_apply') || submitters[0];
      if (submitter) form.requestSubmit(submitter);
      else form.requestSubmit();
      return;
    }
    status('已填入。点击原站搜索按钮执行搜索。');
    if (matchMedia('(max-width: 600px)').matches) { prefs.collapsed = true; collapse(); persist(); }
    input.focus({ preventScroll: true });
  }
  $('fill').addEventListener('click', () => fillNative());
  $('fill-search').addEventListener('click', () => fillNative(true));
  function collapse() {
    panel.hidden = prefs.collapsed;
    launcher.hidden = !prefs.collapsed;
    launcher.setAttribute('aria-expanded', String(!prefs.collapsed));
    $('toggle').setAttribute('aria-expanded', String(!prefs.collapsed));
  }
  $('toggle').addEventListener('click', () => { prefs.collapsed = !prefs.collapsed; collapse(); persist(); });
  launcher.addEventListener('click', () => { prefs.collapsed = false; collapse(); persist(); });
  for (const [key, name] of Object.entries(NAMESPACES)) {
    const option = document.createElement('option'); option.value = key; option.textContent = `${name} · ${key}`; $('namespace').append(option);
  }
  $('keywords').value = state.base;
  setFilters(readNativeFilters());
  if (prefs.lastRating !== null) $('rating').value = prefs.lastRating;
  root.querySelectorAll('[data-view]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
  collapse(); renderDictionary(); renderPresets(); renderSelected(); renderResults();
  initialized = true;
}

setupContinuousReader();
setupGalleryComments();

const searchInput = document.querySelector('input[name="f_search"]');
if (searchInput) mount(searchInput);
else {
  // Accommodate another script adding the search form after document-idle.
  const ownerDocument = document;
  const observer = new MutationObserver(() => {
    const input = ownerDocument.querySelector('input[name="f_search"]');
    if (input?.form) { mount(input); observer.disconnect(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  setTimeout(() => observer.disconnect(), 10000);
}

})();
