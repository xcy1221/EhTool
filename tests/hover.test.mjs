import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
const uiKey = 'eh-search-tool:ui:v1';
const details = '<h1 id="gn">Example gallery</h1><div id="taglist"><table><tr><td class="tc">language:</td><td><div class="gt" id="td_language:chinese"><a id="ta_language:chinese">中文汉化</a></div></td></tr><tr><td class="tc">artist:</td><td><div class="gt" id="td_artist:example_artist">example artist</div></td></tr><tr><td class="tc">parody:</td><td><div class="gt" id="td_parody:original">original</div></td></tr><tr><td class="tc">other:</td><td><div class="gt"><a href="/tag/other:full%20color">汉化全彩</a></div><div class="gt">comic</div></td></tr></table></div><script>throw new Error("must stay inert")</script>';
const flush = () => new Promise(resolve => setImmediate(resolve));
function open(site = 'e-hentai.org', settings = {}, path = '/', html = '<table class="itg"><tr id="first"><td id="thumb">Cover</td><td><a href="/g/123/abcdef/"><span class="glink">First</span></a><span id="inside">Rating</span></td></tr></table><div class="gl1t" id="second"><a href="/g/456/123abc/">Second</a></div>') {
  const dom = new JSDOM('<form><input name="f_search"></form>' + html, { url: 'https://' + site + path, runScripts: 'outside-only' });
  const w = dom.window, store = new Map([[uiKey, settings]]), timers = new Map(), calls = [];
  let now = 0, nextId = 0;
  w.GM_getValue = (key, fallback) => structuredClone(store.get(key) ?? fallback);
  w.GM_setValue = (key, value) => store.set(key, JSON.parse(JSON.stringify(value)));
  w.setTimeout = (callback, delay) => { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.fetch = async (url, options) => { calls.push({ url, ...options }); return { ok: true, url, text: async () => details }; };
  w.eval(script);
  const doc = w.document, tool = doc.getElementById('eh-search-tool').shadowRoot;
  const host = doc.getElementById('eh-gallery-hover'), root = host?.shadowRoot;
  const over = (id, related = null) => doc.getElementById(id).dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true, relatedTarget: related }));
  const out = (id, related = null) => doc.getElementById(id).dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true, relatedTarget: related }));
  const tick = async ms => { now += ms; for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.callback(); } await flush(); };
  return { dom, w, doc, tool, store, host, root, over, out, tick, calls };
}

for (const site of ['e-hentai.org', 'exhentai.org']) test(site + ': waits one second over the whole row, groups complete tags and reuses cache', async () => {
  const a = open(site);
  try {
    a.over('thumb'); await a.tick(999); assert.equal(a.calls.length, 0); assert.equal(a.host.hidden, true);
    a.out('thumb', a.doc.getElementById('inside')); a.over('inside'); await a.tick(1);
    assert.equal(a.calls.length, 1); assert.equal(a.calls[0].credentials, 'same-origin'); assert.equal(a.host.hidden, false);
    assert.equal(a.root.getElementById('hover-title').textContent, 'Example gallery');
    assert.deepEqual([...a.root.querySelectorAll('.tag')].map(tag => tag.title), ['language:chinese', 'artist:example artist', 'parody:original', 'other:full color', 'other:comic']);
    assert.match(a.root.textContent, /中文/); assert.match(a.root.textContent, /全彩/);
    a.out('inside'); assert.equal(a.host.hidden, false, 'Keep the loaded preview readable');
    a.over('thumb'); await a.tick(1000); assert.equal(a.calls.length, 1);
    a.root.getElementById('hover-close').click(); assert.equal(a.host.hidden, true);
    a.out('thumb'); a.w.dispatchEvent(new a.w.PageTransitionEvent('pagehide', { persisted: true }));
    a.over('thumb'); await a.tick(1000); assert.equal(a.host.hidden, false, 'Hover survives cached back navigation');
  } finally { a.dom.window.close(); }
});

test('brief hovers, removed rows and pagehide cancel pending work; late replies cannot replace the next gallery', async () => {
  const a = open();
  try {
    a.over('first'); await a.tick(900); a.out('first'); await a.tick(100); assert.equal(a.calls.length, 0);
    let finish;
    a.w.fetch = (url, options) => { a.calls.push({ url, ...options }); return new Promise(resolve => { finish = resolve; }); };
    a.over('first'); await a.tick(1000); a.out('first'); assert.equal(a.calls[0].signal.aborted, true);
    a.w.fetch = async url => ({ ok: true, url, text: async () => details.replace('Example gallery', 'Second result') });
    a.over('second'); await a.tick(1000); finish({ ok: true, text: async () => details }); await flush();
    assert.equal(a.root.getElementById('hover-title').textContent, 'Second result');
    a.over('first'); a.doc.getElementById('first').remove(); await flush(); await a.tick(1000); assert.equal(a.calls.length, 1); assert.equal(a.host.hidden, true);
    a.over('second'); a.w.dispatchEvent(new a.w.Event('pagehide')); await a.tick(1000); assert.equal(a.host.hidden, true);
  } finally { a.dom.window.close(); }
});

test('settings apply immediately, persist independently, support no groups, and validate delay', async () => {
  const a = open('e-hentai.org', { reader: { ahead: 8 }, comments: { collapsed: true } });
  try {
    for (const ns of ['artist', 'parody']) a.tool.querySelector(`[data-hover-group="${ns}"]`).click();
    const delay = a.tool.getElementById('hover-delay'); delay.value = '0.2'; delay.dispatchEvent(new a.w.Event('change'));
    a.over('first'); await a.tick(200);
    assert.equal(a.root.querySelector('[title="artist:example artist"]'), null); assert.equal(a.root.querySelector('[title="parody:original"]'), null);
    for (const box of a.tool.querySelectorAll('[data-hover-group]:checked')) box.click();
    assert.match(a.root.getElementById('hover-content').textContent, /未选择标签组/);
    a.out('first'); a.over('second'); await a.tick(200); assert.equal(a.calls.length, 1);
    const saved = a.store.get(uiKey); assert.equal(saved.reader.ahead, 8); assert.equal(saved.comments.collapsed, true); assert.deepEqual(saved.hover.groups, []);
    delay.value = '-1'; delay.dispatchEvent(new a.w.Event('change')); assert.equal(delay.value, '0.2');
    const reopened = open('exhentai.org', saved);
    try { assert.equal(reopened.tool.getElementById('hover-delay').value, '0.2'); assert.equal(reopened.tool.querySelectorAll('[data-hover-group]:checked').length, 0); }
    finally { reopened.dom.window.close(); }
    a.tool.getElementById('hover-enabled').click(); assert.equal(a.host.hidden, true); assert.equal(delay.disabled, true);
  } finally { a.dom.window.close(); }
});

test('failures and timeouts are retryable and are not cached', async () => {
  const a = open('e-hentai.org', { hover: { delay: 0 } });
  try {
    a.w.fetch = async url => ({ ok: true, url, text: async () => '<p>Login required</p>' });
    a.over('first'); await a.tick(0); assert.match(a.root.textContent, /登录状态/);
    a.out('first'); a.w.fetch = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    a.over('first'); await a.tick(0); await a.tick(15000); assert.match(a.root.textContent, /读取超时/);
    a.out('first'); a.w.fetch = async url => ({ ok: true, url, text: async () => details });
    a.over('first'); await a.tick(0); assert.ok(a.root.querySelector('.tag'));
  } finally { a.dom.window.close(); }
});

test('only search pages and same-site gallery links trigger previews, including dynamically added cards', async () => {
  const a = open('e-hentai.org', { hover: { delay: 0 } }, '/', '<a id="outside" href="https://example.com/g/123/abcdef/">Outside</a><a id="cross" href="https://exhentai.org/g/123/abcdef/">Other site</a><a id="page" href="/?page=2">Next page</a>');
  try {
    for (const id of ['outside', 'cross', 'page']) { a.over(id); await a.tick(0); }
    assert.equal(a.calls.length, 0);
    a.doc.body.insertAdjacentHTML('beforeend', '<div class="gl1t" id="late"><a href="/g/999/abcdef/?p=2">New gallery</a><span id="cover">Cover</span></div>');
    a.over('cover'); await a.tick(0); assert.equal(a.calls[0].url, 'https://e-hentai.org/g/999/abcdef/');
    a.tool.getElementById('theme').click(); await flush(); assert.equal(a.host.dataset.theme, 'dark');
  } finally { a.dom.window.close(); }
  for (const path of ['/g/123/abcdef/', '/s/abc/123-1']) {
    const detail = open('e-hentai.org', {}, path);
    try { assert.equal(detail.host, null); } finally { detail.w.dispatchEvent(new detail.w.Event('pagehide')); detail.dom.window.close(); }
  }
});
