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
