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
