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
