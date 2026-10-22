function parseGalleryTags(doc) {
  const list = doc.getElementById('taglist');
  if (!list) throw new Error('未找到画廊标签，请检查登录状态或访问权限。');
  const tags = new Map();
  for (const node of list.querySelectorAll('[id^="td_"], [id^="ta_"], .gt, .gtl, .gtw')) {
    const anchor = node.matches('a') ? node : node.querySelector('a');
    let key = (node.id || anchor?.id || '').replace(/^(?:td|ta)_/, '');
    if (!key.includes(':') && anchor?.getAttribute('href')) {
      try { key = decodeURIComponent(new URL(anchor.getAttribute('href'), location.origin).pathname.match(/^\/tag\/(.+)$/)?.[1] || ''); } catch { /* Use the row namespace below. */ }
    }
    const row = node.closest('tr');
    const namespace = row?.querySelector('.tc, td')?.textContent.trim().replace(/:$/, '').toLowerCase();
    if (!key.includes(':')) key = `${namespace}:${node.textContent.trim()}`;
    const split = key.indexOf(':');
    const tag = normalizeTag({ namespace: key.slice(0, split), tag: key.slice(split + 1).replace(/_/g, ' ') });
    if (tag) tags.set(tagKey(tag), tag);
  }
  return { title: (doc.getElementById('gn') || doc.getElementById('gj'))?.textContent.trim() || '画廊标签', tags: [...tags.values()] };
}

function setupGalleryHover(toolRoot, displayName) {
  if (/^\/(?:g|s)\//.test(location.pathname) || document.getElementById('eh-gallery-hover')) return;
  let config = readUI().hover;
  let hovered = null, timer = null, request = null, revision = 0, current = null;
  const cache = new Map();
  const host = document.createElement('aside');
  host.id = 'eh-gallery-hover'; host.hidden = true;
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = HOVER_STYLE;
  root.append(style);
  const panel = document.createElement('section'); panel.setAttribute('aria-label', '悬停画廊标签');
  panel.innerHTML = '<header><h2 id="hover-title">画廊标签</h2><button type="button" id="hover-close" aria-label="关闭画廊标签">×</button></header><div id="hover-content" role="status" aria-live="polite"></div>';
  root.append(panel);
  const content = root.getElementById('hover-content');
  function syncTheme() { host.dataset.theme = toolRoot.host.dataset.theme || readUI().theme; }
  syncTheme();
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(toolRoot.host, { attributes: true, attributeFilter: ['data-theme'] });
  function place() {
    const list = document.querySelector('.itg');
    const gap = list ? window.innerWidth - list.getBoundingClientRect().right - 24 : 320;
    host.style.width = `${Math.min(360, Math.max(220, gap < 220 ? 280 : gap))}px`;
  }
  function message(text) { content.textContent = text; }
  function render(info) {
    root.getElementById('hover-title').textContent = info.title;
    content.replaceChildren();
    let count = 0;
    for (const namespace of config.groups) {
      const tags = info.tags.filter(tag => tag.namespace === namespace);
      if (!tags.length) continue;
      const group = document.createElement('div'); group.className = 'tag-group';
      const heading = document.createElement('h3'); heading.textContent = NAMESPACES[namespace];
      const chips = document.createElement('div'); chips.className = 'tags';
      for (const tag of tags) {
        const chip = document.createElement('span'); chip.className = 'tag';
        chip.textContent = displayName(tag); chip.title = tagKey(tag); chips.append(chip); count++;
      }
      group.append(heading, chips); content.append(group);
    }
    if (!count) message(config.groups.length ? '该画廊没有所选组的标签。' : '未选择标签组，请在“设置 → 悬停标签”中勾选。');
  }
  function cancel() {
    clearTimeout(timer); timer = null; revision++;
    if (request) { clearTimeout(request.timeout); request.controller.abort(); request = null; host.hidden = true; }
  }
  function galleryAt(target) {
    if (!target?.closest || host.contains(target) || toolRoot.host.contains(target)) return null;
    const element = target.closest('.itg tr') || target.closest('.gl1t, .gl1e, [data-gallery]') || target.closest('a[href]');
    if (!element) return null;
    const links = element.matches('a[href]') ? [element] : element.querySelectorAll('a[href]');
    for (const link of links) {
      try {
        const url = new URL(link.href);
        if (url.origin === location.origin && url.protocol === 'https:' && ['e-hentai.org', 'exhentai.org'].includes(url.hostname) && /^\/g\/\d+\/[a-z0-9]+\/?$/i.test(url.pathname)) {
          return { element, url: `${url.origin}${url.pathname.replace(/\/?$/, '/')}`, title: element.querySelector('.glink')?.textContent.trim() || link.textContent.trim() || '画廊标签' };
        }
      } catch { /* Ignore unrelated links. */ }
    }
    return null;
  }
  async function show(gallery, ticket) {
    if (ticket !== revision || !gallery.element.isConnected) return;
    place(); host.hidden = false; current = null;
    root.getElementById('hover-title').textContent = gallery.title;
    if (!config.groups.length) { render({ title: gallery.title, tags: [] }); return; }
    if (cache.has(gallery.url)) {
      current = cache.get(gallery.url); cache.delete(gallery.url); cache.set(gallery.url, current); render(current); return;
    }
    message('正在读取画廊标签…');
    const task = { controller: new AbortController(), timeout: null, timedOut: false };
    request = task;
    task.timeout = setTimeout(() => { task.timedOut = true; task.controller.abort(); }, 15000);
    try {
      const response = await fetch(gallery.url, { credentials: 'same-origin', signal: task.controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const finalUrl = new URL(response.url || gallery.url);
      if (finalUrl.origin !== location.origin || finalUrl.pathname.replace(/\/?$/, '/') !== new URL(gallery.url).pathname) throw new Error('画廊发生跳转，请打开详情页检查。');
      const html = await response.text();
      if (ticket !== revision) return;
      const info = parseGalleryTags(new DOMParser().parseFromString(html, 'text/html'));
      cache.set(gallery.url, info);
      if (cache.size > 50) cache.delete(cache.keys().next().value);
      current = info; render(info);
    } catch (error) {
      if (ticket === revision) message(task.timedOut ? '读取超时，移开后重新悬停可重试。' : '标签读取失败：' + error.message + ' 移开后重新悬停可重试。');
    } finally {
      clearTimeout(task.timeout);
      if (request === task) request = null;
    }
  }
  function enter(event) {
    if (!config.enabled) return;
    const next = galleryAt(event.target);
    if (next?.element === hovered?.element && next?.url === hovered?.url) return;
    cancel(); hovered = next;
    if (!next) return;
    host.hidden = true;
    const ticket = revision;
    timer = setTimeout(() => show(next, ticket), config.delay * 1000);
  }
  function leave(event) {
    if (!hovered || !hovered.element.contains(event.target)) return;
    const next = galleryAt(event.relatedTarget);
    if (next?.element === hovered.element && next.url === hovered.url) return;
    cancel(); hovered = null;
  }
  root.getElementById('hover-close').addEventListener('click', () => { cancel(); host.hidden = true; });
  document.addEventListener('mouseover', enter);
  document.addEventListener('mouseout', leave);
  window.addEventListener('resize', place);
  const listObserver = new MutationObserver(() => {
    if (hovered && !hovered.element.isConnected) { cancel(); hovered = null; host.hidden = true; }
  });
  listObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', event => {
    cancel(); hovered = null; host.hidden = true;
    if (event.persisted) return;
    document.removeEventListener('mouseover', enter); document.removeEventListener('mouseout', leave);
    window.removeEventListener('resize', place); themeObserver.disconnect(); listObserver.disconnect();
  });
  return { refresh() {
    config = readUI().hover;
    if (!config.enabled) { cancel(); hovered = null; host.hidden = true; }
    else if (current && !host.hidden) render(current);
    else if (hovered) { const next = hovered; cancel(); timer = setTimeout(() => show(next, revision), config.delay * 1000); }
  } };
}
