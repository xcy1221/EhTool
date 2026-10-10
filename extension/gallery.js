(() => {
  const gid = location.pathname.match(/^\/g\/(\d+)\/[a-z0-9]+\/?$/i)?.[1];
  if (!gid) return;
  let armed = false;
  let sent = false;
  let generation = 0;
  let observer;
  let timeout;
  function readingLink(link) {
    try {
      const url = new URL(link.href);
      return url.origin === location.origin && new RegExp('^/s/[a-z0-9]+/' + gid + '-[1-9]\\d*/?$', 'i').test(url.pathname);
    } catch { return false; }
  }
  async function ready() {
    const link = [...document.querySelectorAll('#gdt a[href]')].find(readingLink);
    if (!link || sent) return;
    sent = true;
    const request = ++generation;
    observer?.disconnect();
    clearTimeout(timeout);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'gallery-ready', url: link.href });
      if (request === generation) armed = response?.armed === true;
    } catch {}
  }
  observer = new MutationObserver(ready);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  timeout = setTimeout(() => observer.disconnect(), 10000);
  ready();
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timeout); }, { once: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) {
      generation += 1;
      armed = false;
      if (changes.enabled.newValue !== false) { sent = false; ready(); }
    }
  });
  document.addEventListener('click', async event => {
    if (!armed || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('#gdt a[href]');
    if (!link || link.hasAttribute('download') || !readingLink(link)) return;
    const url = link.href;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'open-reader', url });
      if (response?.ok && response.armed) return;
    } catch {}
    armed = false;
    location.assign(url);
  }, true);
})();
