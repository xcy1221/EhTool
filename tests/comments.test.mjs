import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
const key = 'eh-search-tool:ui:v1';
function open(site = 'e-hentai.org', settings = {}, html = '<div id="cdiv" style="display:flex!important"><p>评论</p><textarea>未提交的评论</textarea><button id="reply">回复</button></div>', path = '/g/123/abcdef/') {
  const dom = new JSDOM(html, { url: 'https://' + site + path, runScripts: 'outside-only' });
  const store = new Map([[key, settings]]);
  dom.window.GM_getValue = (name, fallback) => structuredClone(store.get(name) ?? fallback);
  dom.window.GM_setValue = (name, value) => store.set(name, JSON.parse(JSON.stringify(value)));
  dom.window.eval(script);
  const toggle = () => dom.window.document.getElementById('eh-gallery-comments')?.shadowRoot.getElementById('comments-toggle');
  return { dom, doc: dom.window.document, store, toggle };
}

for (const site of ['e-hentai.org', 'exhentai.org']) test(site + ': comments toggle preserves nodes, reply handlers, input and original display', async () => {
  const app = open(site);
  try {
    const comments = app.doc.getElementById('cdiv'), reply = app.doc.getElementById('reply'), input = comments.querySelector('textarea');
    let replies = 0;
    reply.addEventListener('click', () => replies++);
    input.value = '继续编辑的评论';
    assert.equal(app.toggle().textContent, '收起评论区');
    assert.equal(app.toggle().getAttribute('aria-expanded'), 'true');
    app.toggle().click();
    assert.equal(comments.hidden, true);
    assert.equal(app.dom.window.getComputedStyle(comments).display, 'none');
    assert.equal(app.toggle().getAttribute('aria-expanded'), 'false');
    app.toggle().click();
    assert.equal(comments.hidden, false);
    assert.equal(comments.style.getPropertyValue('display'), 'flex');
    assert.equal(comments.style.getPropertyPriority('display'), 'important');
    assert.equal(input.value, '继续编辑的评论');
    assert.equal(app.doc.getElementById('reply'), reply);
    reply.click(); assert.equal(replies, 1);
    app.dom.window.eval(script);
    assert.equal(app.doc.querySelectorAll('#eh-gallery-comments').length, 1);
    await new Promise(resolve => app.dom.window.setTimeout(resolve, 0));
  } finally { app.dom.window.close(); }
});

test('default collapse follows saved settings and page toggle leaves defaults intact', () => {
  const settings = { theme: 'dark', reader: { ahead: 8 }, comments: { collapsed: true } };
  const app = open('exhentai.org', settings);
  try {
    assert.equal(app.doc.getElementById('cdiv').hidden, true);
    assert.equal(app.doc.getElementById('eh-gallery-comments').dataset.theme, 'dark');
    app.toggle().click();
    assert.equal(app.doc.getElementById('cdiv').hidden, false);
    assert.deepEqual(app.store.get(key), settings);
  } finally { app.dom.window.close(); }
});

test('disabled feature and non-gallery pages leave comments untouched', () => {
  for (const [settings, path] of [[{ comments: { enabled: false, collapsed: true } }, '/g/123/abcdef/'], [{}, '/'], [{}, '/s/abc/123-1']]) {
    const app = open('e-hentai.org', settings, '<div id="cdiv">评论</div>', path);
    try {
      assert.equal(app.toggle(), undefined);
      assert.equal(app.doc.getElementById('cdiv').hidden, false);
      assert.equal(app.doc.getElementById('cdiv').hasAttribute('style'), false);
    } finally { app.dom.window.close(); }
  }
});

test('late comment section mounts once and restored comments remove only the added display rule', async () => {
  const app = open('e-hentai.org', { comments: { collapsed: true } }, '<main>画廊</main>');
  try {
    const comments = app.doc.createElement('div'); comments.id = 'cdiv'; comments.style.color = 'red';
    app.doc.body.append(comments);
    await new Promise(resolve => app.dom.window.setTimeout(resolve, 0));
    assert.equal(comments.hidden, true);
    app.toggle().click();
    assert.equal(comments.style.getPropertyValue('display'), '');
    assert.equal(comments.style.color, 'red');
    comments.append(app.doc.createElement('p'));
    await new Promise(resolve => app.dom.window.setTimeout(resolve, 0));
    assert.equal(app.doc.querySelectorAll('#eh-gallery-comments').length, 1);
  } finally { app.dom.window.close(); }
});
