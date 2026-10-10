import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
function open(store, url = 'https://e-hentai.org/') {
  const dom = new JSDOM('<form><input name="f_search"><button type="submit">Search</button></form>', { url, runScripts: 'outside-only' });
  dom.window.GM_getValue = (key, fallback) => structuredClone(store.get(key) ?? fallback);
  dom.window.GM_setValue = (key, value) => store.set(key, JSON.parse(JSON.stringify(value)));
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.eval(script);
  const root = dom.window.document.getElementById('eh-search-tool').shadowRoot;
  return { dom, root, $: id => root.getElementById(id) };
}
test('closing browser preserves independent history and last query; history selectively appends', () => {
  const store = new Map();
  const first = open(store);
  first.root.querySelector('[aria-label="必须包含 language:chinese"]').click();
  first.root.querySelector('[data-add-mode=exclude]').click();
  first.root.querySelector('[aria-label="排除此标签 other:full color"]').click();
  first.$('manual').value = 'artist:example artist'; first.$('add-manual').click();
  first.dom.window.document.querySelector('form').addEventListener('submit', event => event.preventDefault());
  first.$('fill').click();
  first.dom.window.close();
  const second = open(store, 'https://exhentai.org/');
  try {
    assert.equal(second.root.querySelector('[data-view=recent]').getAttribute('aria-pressed'), 'true');
    assert.equal(second.root.querySelectorAll('.tag-row').length, 3);
    assert.equal(second.$('selected-count').textContent, '0');
    assert.equal(second.$('restore-last').hidden, false);
    second.$('restore-last').click();
    assert.equal(second.$('selected-count').textContent, '3');
    assert.match(second.$('query').value, /-other:"full color\$"/);
    second.$('clear').click();
    second.root.querySelector('[aria-label="必须包含 language:chinese"]').click();
    second.root.querySelector('[aria-label="必须包含 artist:example artist"]').click();
    assert.equal(second.$('query').value, 'language:chinese$ artist:"example artist$"');
    second.root.querySelector('[aria-label="必须包含 language:chinese"]').click();
    assert.equal(second.$('query').value, 'artist:"example artist$"');
    assert.equal(second.root.querySelectorAll('.tag-row').length, 3);
    const stored = store.get('eh-search-tool:v1');
    assert.equal(stored.history.length, 3);
    assert.ok(stored.history.every(tag => typeof tag.lastUsed === 'number'));
    assert.equal(stored.history.find(tag => tag.tag === 'chinese').name, '中文');
  } finally { second.dom.window.close(); }
});
test('upgrade keeps v0.1 history and old presets without changing native text', () => {
  const store = new Map([['eh-search-tool:v1', {
    history: [{ namespace: 'language', tag: 'chinese', name: '中文', mode: 'include', exact: true, lastUsed: 1 }],
    lastQuery: 'l:chinese$ -other:"full color$"',
    presets: [{ name: '旧组合', query: 'l:chinese$' }], favorites: ['language:chinese'],
  }]]);
  const app = open(store);
  try {
    assert.equal(app.root.querySelectorAll('.tag-row').length, 1);
    app.$('restore-last').click();
    assert.equal(app.$('query').value, 'language:chinese$ -other:"full color$"');
    assert.equal(app.dom.window.document.querySelector('[name=f_search]').value, '');
    app.root.querySelector('[aria-label="载入组合 旧组合"]').click();
    assert.equal(app.$('query').value, 'language:chinese$');
    assert.equal(store.get('eh-search-tool:v1').history[0].name, '中文');
    assert.deepEqual(store.get('eh-search-tool:v1').favorites, ['language:chinese']);
  } finally { app.dom.window.close(); }
});
