import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
function open(store = new Map(), withForm = true, withApi = true) {
  const dom = new JSDOM(`${withForm ? '<form><input name="f_search"></form>' : ''}<a id="gallery" href="/g/123/abcdef/" target="_self" rel="nofollow">Gallery</a><a id="ex" href="https://exhentai.org/g/456/abc123/">Other gallery</a><a id="page" href="/?page=2">Next</a><a id="image" href="/s/abc/123-1">Image</a><a id="outside" href="https://example.com/g/123/abcdef/">Outside</a>`, { url: 'https://e-hentai.org/', runScripts: 'outside-only' });
  dom.window.GM_getValue = (key, fallback) => structuredClone(store.get(key) ?? fallback);
  dom.window.GM_setValue = (key, value) => store.set(key, JSON.parse(JSON.stringify(value)));
  const opened = [];
  if (withApi) dom.window.GM_openInTab = (url, options) => opened.push({ url, ...JSON.parse(JSON.stringify(options)) });
  dom.window.eval(script);
  return { dom, doc: dom.window.document, store, opened };
}
test('new tab default only targets gallery links on both sites, including pages without search', () => {
  const app = open(new Map(), false);
  try {
    for (const id of ['gallery', 'ex']) assert.equal(app.doc.getElementById(id).target, '_blank');
    assert.equal(app.doc.getElementById('gallery').rel, 'nofollow noopener');
    for (const id of ['page', 'image', 'outside']) assert.equal(app.doc.getElementById(id).target, '');
  } finally { app.dom.window.close(); }
});

test('focus toggle controls tab API, persists across reopening and follows new-tab enablement', () => {
  const app = open();
  try {
    const root = app.doc.getElementById('eh-search-tool').shadowRoot;
    const focus = root.getElementById('gallery-focus');
    const gallery = app.doc.getElementById('gallery');
    const child = app.doc.createElement('span'); gallery.append(child);
    const click = () => child.dispatchEvent(new app.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(focus.checked, true); assert.equal(focus.disabled, false);
    assert.equal(click(), false);
    assert.deepEqual(app.opened[0], { url: 'https://e-hentai.org/g/123/abcdef/', active: true, insert: true, setParent: true });
    focus.click(); assert.equal(click(), false);
    assert.equal(app.opened.length, 2); assert.equal(app.opened[1].active, false);
    assert.equal(app.store.get('eh-search-tool:v1').galleryFocus, false);
    root.getElementById('gallery-new-tab').click(); assert.equal(focus.disabled, true);
    // Preserve the user's focus preference while the new-tab feature is disabled.
    root.getElementById('gallery-new-tab').click(); assert.equal(focus.disabled, false); assert.equal(focus.checked, false);
  } finally { app.dom.window.close(); }
  const reopened = open(app.store, false);
  try {
    reopened.doc.getElementById('ex').dispatchEvent(new reopened.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(reopened.opened[0].active, false);
    assert.equal(reopened.opened[0].url, 'https://exhentai.org/g/456/abc123/');
  } finally { reopened.dom.window.close(); }
});

test('modified clicks, other links, downloads, cancelled events and disabled feature keep browser handling', () => {
  const app = open();
  try {
    app.doc.addEventListener('click', event => { if (event.target.closest?.('a[href]')) event.preventDefault(); }); // Avoid jsdom navigation without cancelling checkbox changes.
    const gallery = app.doc.getElementById('gallery');
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      gallery.dispatchEvent(new app.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
    }
    for (const id of ['page', 'image', 'outside']) app.doc.getElementById(id).click();
    const cancelled = new app.dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    cancelled.preventDefault(); gallery.dispatchEvent(cancelled);
    gallery.setAttribute('download', ''); gallery.click(); gallery.removeAttribute('download');
    app.doc.getElementById('eh-search-tool').shadowRoot.getElementById('gallery-new-tab').click();
    gallery.click();
    assert.equal(app.opened.length, 0);
  } finally { app.dom.window.close(); }
});

test('missing or failing tab API falls back to native link behavior', () => {
  for (const withApi of [false, true]) {
    const app = open(new Map(), true, withApi);
    try {
      if (withApi) app.dom.window.GM_openInTab = () => { throw new Error('unavailable'); };
      let prevented;
      app.doc.getElementById('gallery').addEventListener('click', event => { prevented = event.defaultPrevented; event.preventDefault(); });
      app.doc.getElementById('gallery').click();
      assert.equal(prevented, false);
      assert.equal(app.doc.getElementById('gallery').target, '_blank');
      if (!withApi) assert.equal(app.doc.getElementById('eh-search-tool').shadowRoot.getElementById('gallery-focus').disabled, true);
    } finally { app.dom.window.close(); }
  }
});
test('new links and changed hrefs update; disabling restores original attributes and persists', async () => {
  const app = open();
  try {
    const flush = () => new Promise(resolve => app.dom.window.setTimeout(resolve, 0));
    const late = app.doc.createElement('a'); late.href = '/g/789/abcdef/'; app.doc.body.append(late); await flush();
    assert.equal(late.target, '_blank');
    late.href = '/?page=3'; await flush(); assert.equal(late.target, ''); assert.equal(late.rel, '');
    const toggle = app.doc.getElementById('eh-search-tool').shadowRoot.getElementById('gallery-new-tab');
    toggle.click();
    assert.equal(app.doc.getElementById('gallery').target, '_self');
    assert.equal(app.doc.getElementById('gallery').rel, 'nofollow');
    assert.equal(app.doc.getElementById('ex').hasAttribute('target'), false);
    assert.equal(app.store.get('eh-search-tool:v1').galleryNewTabs, false);
    const reopened = open(app.store, false);
    try { assert.equal(reopened.doc.getElementById('gallery').target, '_self'); }
    finally { reopened.dom.window.close(); }
    toggle.click(); assert.equal(app.doc.getElementById('gallery').target, '_blank');
  } finally { app.dom.window.close(); }
});
