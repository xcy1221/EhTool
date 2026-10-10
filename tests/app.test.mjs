import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
function setup(url = 'https://e-hentai.org/', store = new Map(), query = '', prepare = () => {}) {
  const dom = new JSDOM('<form><input name="f_search"><input type="checkbox" name="f_sft" value="on" checked><input name="f_spf"><input name="f_spt"><select name="f_srdd"><option value="0">不限</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select><button type="submit" name="f_apply" value="Apply Filter">Apply Filter</button></form><div id="translated">EhSyringe 模拟汉化</div>', { url, runScripts: 'outside-only' });
  const { window } = dom;
  window.GM_getValue = (key, fallback) => structuredClone(store.get(key) ?? fallback);
  window.GM_setValue = (key, value) => store.set(key, JSON.parse(JSON.stringify(value)));
  window.matchMedia = () => ({ matches: false });
  window.document.querySelector('input').value = query;
  prepare(window);
  window.eval(script);
  const root = window.document.getElementById('eh-search-tool').shadowRoot;
  const $ = id => root.getElementById(id);
  const input = (id, value) => { $(id).value = value; $(id).dispatchEvent(new window.Event('input', { bubbles: true })); };
  const clickTag = (tag, mode = 'include') => {
    root.querySelector(`[data-add-mode="${mode}"]`).click();
    const label = { include: '必须包含', exclude: '排除此标签', or: '任一包含（OR）' }[mode];
    root.querySelector(`[aria-label="${label} ${tag}"]`).click();
  };
  return { dom, window, root, $, input, clickTag, store };
}

for (const site of ['e-hentai.org', 'exhentai.org']) test(`${site}: independent builder, explicit fill, native editing and submission stay intact`, () => {
  const app = setup(`https://${site}/?f_sft=on`, new Map(), 'uploader:someone');
  try {
    app.clickTag('language:chinese');
    app.clickTag('other:full color', 'exclude');
    const native = app.window.document.querySelector('input[name=f_search]');
    assert.equal(native.value, 'uploader:someone');
    app.input('page-min', '20'); app.input('page-max', '80');
    app.$('rating').value = '4'; app.$('rating').dispatchEvent(new app.window.Event('change'));
    assert.equal(app.window.document.querySelector('[name=f_spf]').value, '');
    assert.equal(app.window.document.querySelector('[name=f_srdd]').value, '0');
    assert.equal(app.$('selected').querySelector('[data-mode=include] .selected-name').textContent, '中文');
    assert.equal(app.$('selected').querySelector('[data-mode=exclude] .selected-name').textContent, '全彩');
    let submission;
    app.window.document.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      submission = new app.window.FormData(event.target, event.submitter);
    });
    app.$('fill').click();
    assert.equal(submission, undefined, 'Fill must not submit');
    assert.equal(native.value, 'language:chinese$ -other:"full color$"');
    app.window.document.querySelector('form').requestSubmit(app.window.document.querySelector('button[type=submit]'));
    assert.equal(submission.get('f_sft'), 'on');
    assert.equal(submission.get('f_apply'), 'Apply Filter');
    assert.equal(submission.get('f_search'), native.value);
    assert.equal(submission.get('f_spf'), '20'); assert.equal(submission.get('f_spt'), '80'); assert.equal(submission.get('f_srdd'), '4');
    assert.equal(submission.get('advsearch'), '1');
    assert.equal(app.window.document.getElementById('translated').textContent, 'EhSyringe 模拟汉化');
    assert.equal(app.window.document.querySelector('style'), null);
    for (const value of ['l:english$', 'l:english$ ', 'l:english$ other:', 'l:english$ other:comic$']) {
      native.value = value; native.setSelectionRange(value.length, value.length);
      native.dispatchEvent(new app.window.Event('input')); native.dispatchEvent(new app.window.Event('change'));
      assert.equal(native.value, value); assert.equal(native.selectionStart, value.length);
    }
    assert.equal(app.$('query').value, 'language:chinese$ -other:"full color$"');
    native.value = 'title:"example" l:english$'; app.$('read-native').click();
    assert.equal(app.$('keywords').value, 'title:"example"');
    assert.equal(app.$('selected-count').textContent, '1');
    assert.ok(app.$('query').value.includes('language:english$'));
    app.window.eval(script);
    assert.equal(app.window.document.querySelectorAll('#eh-search-tool').length, 1);
  } finally { app.dom.window.close(); }
});
test('existing history, manual tags, presets with filters, collapse persist across both sites', () => {
  const app = setup();
  app.$('manual').value = 'artist:example artist'; app.$('add-manual').click();
  app.input('keywords', 'title:sample');
  app.input('page-min', '10'); app.$('rating').value = '3';
  app.$('preset-name').value = '我的组合'; app.$('save-preset').click();
  app.$('toggle').click(); app.dom.window.close();
  const reloaded = setup('https://exhentai.org/', app.store);
  try {
    assert.equal(reloaded.root.querySelector('section').hidden, true);
    reloaded.$('launcher').click();
    assert.ok(reloaded.root.querySelector('[aria-label="必须包含 artist:example artist"]'));
    reloaded.root.querySelector('[data-view="all"]').click();
    reloaded.root.querySelector('[aria-label="载入组合 我的组合"]').click();
    assert.equal(reloaded.$('query').value, 'title:sample artist:"example artist$"');
    assert.equal(reloaded.$('page-min').value, '10'); assert.equal(reloaded.$('rating').value, '3');
    reloaded.root.querySelector('[aria-label="移除 artist:example artist"]').click();
    assert.equal(reloaded.$('query').value, 'title:sample');
  } finally { reloaded.dom.window.close(); }
});
test('remote dictionary is opt-in, uses anonymous request, failures retain cached tags', () => {
  const app = setup();
  try {
    let requests = 0;
    app.window.GM_xmlhttpRequest = options => {
      requests++;
      assert.equal(options.anonymous, true);
      assert.equal(options.timeout, 30000);
      options.onload({ status: 200, responseText: JSON.stringify({ data: [{ namespace: 'artist', data: { 'example artist': { name: '<img src=x onerror=alert(1)>', intro: 'ignored' } } }] }) });
    };
    assert.equal(requests, 0);
    app.$('update').click();
    assert.equal(requests, 1);
    assert.equal(app.root.querySelector('img'), null);
    assert.equal(app.$('update').disabled, false);
    app.input('lookup', 'example');
    assert.equal(app.root.querySelectorAll('.tag-row').length, 1);
    app.window.GM_xmlhttpRequest = options => options.ontimeout();
    app.$('update').click();
    assert.match(app.$('status').textContent, /下载超时/);
    assert.equal(app.root.querySelectorAll('.tag-row').length, 1);
    app.window.GM_xmlhttpRequest = options => options.onload({ status: 200, responseText: '{}' });
    app.$('update').click();
    assert.match(app.$('status').textContent, /格式不正确/);
    assert.equal(app.root.querySelectorAll('.tag-row').length, 1);
  } finally { app.dom.window.close(); }
});
test('invalid builder conditions block fill, but never block native editing or submit', () => {
  const app = setup();
  try {
    app.input('keywords', 'a'.repeat(201));
    assert.equal(app.$('fill').disabled, true);
    app.window.document.querySelector('input[name=f_search]').value = 'b'.repeat(201);
    const event = new app.window.Event('submit', { cancelable: true });
    app.window.document.querySelector('form').dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    app.window.document.querySelector('input[name=f_search]').value = '';
    app.input('keywords', 'sample');
    app.input('page-min', '100'); app.input('page-max', '20');
    assert.equal(app.$('fill').disabled, true);
    app.$('fill').click();
    assert.equal(app.window.document.querySelector('input[name=f_search]').value, '');
    app.input('page-min', '1.5'); assert.match(app.$('limits').textContent, /整数/);
    app.input('page-min', ''); app.input('page-max', '');
    app.window.GM_setValue = () => { throw new Error('quota'); };
    app.$('preset-name').value = 'test'; app.$('save-preset').click();
    assert.match(app.$('status').textContent, /无法保存/);
  } finally { app.dom.window.close(); }
});
test('include/exclude are exclusive, explicitly grouped, toggled off without losing history', () => {
  const app = setup();
  try {
    app.clickTag('language:chinese'); app.clickTag('language:chinese', 'exclude');
    assert.equal(app.$('selected-count').textContent, '1');
    assert.equal(app.$('query').value, '-language:chinese$');
    assert.equal(app.root.querySelector('[aria-label="排除此标签 language:chinese"]').getAttribute('aria-pressed'), 'true');
    assert.ok(app.root.querySelector('[aria-label="排除此标签 language:chinese"]').classList.contains('exclude'));
    assert.equal(app.root.querySelector('[aria-label="排除此标签 language:chinese"]').textContent, '中文');
    assert.equal(app.root.querySelector('[aria-label="排除此标签 language:chinese"]').children.length, 0);
    app.root.querySelector('[aria-label="将 language:chinese 改为包含"]').click();
    assert.equal(app.$('query').value, 'language:chinese$');
    app.clickTag('language:chinese');
    assert.equal(app.$('query').value, '');
    assert.equal(app.store.get('eh-search-tool:v1').history.length, 1);
  } finally { app.dom.window.close(); }
});
test('OR selection, all mode transitions and toggling keep each tag unique', () => {
  const app = setup();
  try {
    app.clickTag('language:chinese', 'or'); app.clickTag('language:english', 'or');
    app.clickTag('other:full color'); app.clickTag('other:comic', 'exclude');
    assert.equal(app.$('query').value, '~language:chinese$ ~language:english$ other:"full color$" -other:comic$');
    assert.equal(app.root.querySelectorAll('[data-mode=or] .chip').length, 2);
    app.root.querySelector('[aria-label="将 language:chinese 改为包含"]').click();
    assert.equal(app.$('selected-count').textContent, '4');
    assert.match(app.$('query').value, /^language:chinese\$/);
    app.root.querySelector('[aria-label="将 language:chinese 改为排除"]').click();
    assert.match(app.$('query').value, /^-language:chinese\$/);
    app.root.querySelector('[aria-label="将 language:chinese 改为 OR"]').click();
    assert.match(app.$('query').value, /^~language:chinese\$/);
    app.clickTag('language:chinese', 'or');
    assert.equal(app.$('selected-count').textContent, '3');
    app.clickTag('language:chinese', 'or');
    assert.match(app.$('status').textContent, /任一包含（OR）/);
    assert.match(app.$('mode-hint').textContent, /至少满足一个/);
    const row = app.root.querySelector('[aria-label="任一包含（OR） language:chinese"]');
    assert.ok(row.classList.contains('or')); assert.equal(row.textContent, '中文');
    assert.equal(app.window.document.querySelector('[name=f_search]').value, '');
  } finally { app.dom.window.close(); }
});

test('OR history, draft and preset survive closing and reopening on the other site', () => {
  const app = setup();
  app.clickTag('language:chinese', 'or'); app.clickTag('language:english', 'or');
  app.$('manual').value = 'artist:example artist'; app.$('manual-mode').value = 'or'; app.$('add-manual').click();
  app.clickTag('other:full color'); app.clickTag('other:comic', 'exclude');
  const query = app.$('query').value;
  app.$('preset-name').value = '任一语言'; app.$('save-preset').click();
  app.dom.window.close();
  const reopened = setup('https://exhentai.org/', app.store, 'title:original');
  try {
    assert.equal(reopened.$('selected-count').textContent, '0');
    assert.equal(reopened.store.get('eh-search-tool:v1').history.find(x => x.tag === 'chinese').mode, 'or');
    reopened.$('restore-last').click();
    assert.equal(reopened.$('query').value, query);
    assert.equal(reopened.root.querySelectorAll('[data-mode=or] .chip').length, 3);
    reopened.$('clear').click();
    reopened.clickTag('language:chinese', 'or');
    assert.equal(reopened.$('query').value, '~language:chinese$');
    reopened.root.querySelector('[aria-label="载入组合 任一语言"]').click();
    assert.equal(reopened.$('query').value, query);
    assert.equal(reopened.window.document.querySelector('[name=f_search]').value, 'title:original');
    reopened.$('fill').click();
    assert.equal(reopened.window.document.querySelector('[name=f_search]').value, query);
  } finally { reopened.dom.window.close(); }
});

test('fill opens lazy native advanced controls once and preserves rating on subsequent searches', () => {
  let toggles = 0;
  const app = setup('https://exhentai.org/', new Map(), '', window => {
    const form = window.document.querySelector('form');
    for (const name of ['f_spf', 'f_spt', 'f_srdd']) form.querySelector(`[name=${name}]`).remove();
    const toggle = window.document.createElement('a'); toggle.id = 'adv_toggle'; toggle.href = '#'; toggle.textContent = '显示高级选项';
    const pane = window.document.createElement('div'); pane.id = 'advdiv'; pane.style.display = 'none';
    form.append(toggle, pane);
    toggle.addEventListener('click', event => {
      event.preventDefault(); toggles++;
      if (pane.style.display === 'none') {
        pane.style.display = '';
        pane.innerHTML = '<input type="hidden" name="advsearch" value="1"><input name="f_spf"><input name="f_spt"><select name="f_srdd"><option value="0">不限</option><option value="4">4</option></select>';
      } else { pane.style.display = 'none'; pane.replaceChildren(); }
    });
  });
  try {
    app.clickTag('language:chinese');
    app.$('rating').value = '4'; app.$('rating').dispatchEvent(new app.window.Event('change'));
    assert.equal(toggles, 0, 'Composing should not open native controls');
    app.$('fill').click();
    assert.equal(toggles, 1); assert.equal(app.window.document.getElementById('advdiv').style.display, '');
    const form = app.window.document.querySelector('form');
    assert.equal(form.querySelectorAll('[name=f_srdd]').length, 1);
    const searches = [];
    form.addEventListener('submit', event => { event.preventDefault(); searches.push(new app.window.FormData(form)); });
    form.requestSubmit();
    form.querySelector('[name=f_search]').value = 'language:english$';
    form.requestSubmit();
    for (const request of searches) {
      assert.equal(request.get('advsearch'), '1'); assert.equal(request.get('f_srdd'), '4');
    }
    app.$('fill').click(); assert.equal(toggles, 1, 'Already-open options must not collapse');
    assert.equal(form.querySelectorAll('[name=advsearch]').length, 1);
    app.$('rating').value = '0'; app.$('rating').dispatchEvent(new app.window.Event('change')); app.$('fill').click();
    assert.equal(new app.window.FormData(form).get('f_srdd'), '0');
  } finally { app.dom.window.close(); }
});

test('only tool rating changes update remembered stars, including unlimited, across sites', () => {
  const app = setup('https://e-hentai.org/', new Map(), '', window => { window.document.querySelector('[name=f_srdd]').value = '3'; });
  try {
    assert.equal(app.$('rating').value, '3');
    app.$('read-native').click(); app.$('fill').click();
    assert.equal(app.store.get('eh-search-tool:v1').lastRating, null);
    app.$('rating').value = '4'; app.$('rating').dispatchEvent(new app.window.Event('change'));
    app.window.document.querySelector('[name=f_srdd]').value = '2'; app.$('read-native').click();
    app.window.document.querySelector('form').dispatchEvent(new app.window.Event('submit', { cancelable: true }));
    app.$('preset-name').value = '两星'; app.$('save-preset').click();
    app.root.querySelector('[aria-label="载入组合 两星"]').click();
    assert.equal(app.store.get('eh-search-tool:v1').lastRating, '4');
  } finally { app.dom.window.close(); }
  const reopened = setup('https://exhentai.org/', app.store, '', window => { window.document.querySelector('[name=f_srdd]').value = '5'; });
  try {
    assert.equal(reopened.$('rating').value, '4');
    assert.equal(reopened.window.document.querySelector('[name=f_srdd]').value, '5', 'Restoring tool memory must not change native filters');
    reopened.$('rating').value = '0'; reopened.$('rating').dispatchEvent(new reopened.window.Event('change'));
  } finally { reopened.dom.window.close(); }
  const unlimited = setup('https://e-hentai.org/', app.store, '', window => { window.document.querySelector('[name=f_srdd]').value = '3'; });
  try { assert.equal(unlimited.$('rating').value, '0'); }
  finally { unlimited.dom.window.close(); }
});

test('legacy rating checkbox and missing filter controls are supported', () => {
  const app = setup();
  try {
    const form = app.window.document.querySelector('form');
    const enabled = app.window.document.createElement('input'); enabled.name = 'f_sr'; enabled.type = 'checkbox'; form.append(enabled);
    const rating = form.querySelector('[name=f_srdd]'); rating.querySelector('[value="0"]').remove();
    app.$('rating').value = '4'; app.$('fill').click();
    assert.equal(enabled.checked, true); assert.equal(rating.value, '4');
    app.$('rating').value = '0'; app.$('fill').click(); assert.equal(enabled.checked, false);
    form.querySelector('[name=f_spf]').remove(); form.querySelector('[name=f_spt]').remove();
    app.input('page-min', '12'); app.$('fill').click(); app.$('fill').click();
    assert.equal(form.querySelectorAll('[name=f_spf]').length, 1); assert.equal(form.querySelector('[name=f_spf]').value, '12');
  } finally { app.dom.window.close(); }
});
test('pages without a native search form stay untouched', () => {
  const dom = new JSDOM('<p>Fixture without search</p>', { url: 'https://e-hentai.org/g/1/token/', runScripts: 'outside-only' });
  try { dom.window.eval(script); assert.equal(dom.window.document.querySelector('#eh-search-tool'), null); }
  finally { dom.window.close(); }
});

test('theme and independent sections persist across sites without replacing search data', async () => {
  const app = setup();
  try {
    assert.equal(app.root.host.dataset.theme, 'light');
    app.clickTag('language:chinese');
    app.$('theme').click();
    const tags = app.root.querySelector('[data-section=tags]'); tags.open = false;
    await new Promise(resolve => app.window.setTimeout(resolve, 10));
    assert.equal(app.store.get('eh-search-tool:ui:v1').sections.tags, false);
    assert.equal(app.store.get('eh-search-tool:ui:v1').theme, 'dark');
    assert.equal(app.$('selection-summary').textContent, '1 个标签');
    app.$('reader-ahead').value = '8'; app.$('reader-ahead').dispatchEvent(new app.window.Event('change'));
    app.$('toggle').click(); app.$('launcher').click();
    assert.equal(tags.open, false);
    assert.equal(app.store.get('eh-search-tool:v1').history.length, 1);
  } finally { app.dom.window.close(); }
  const reopened = setup('https://exhentai.org/', app.store);
  try {
    assert.equal(reopened.root.host.dataset.theme, 'dark');
    assert.equal(reopened.root.querySelector('[data-section=tags]').open, false);
    assert.equal(reopened.$('reader-ahead').value, '8');
    reopened.$('clear').click();
    assert.equal(reopened.store.get('eh-search-tool:ui:v1').reader.ahead, 8);
  } finally { reopened.dom.window.close(); }
  const exDefault = setup('https://exhentai.org/');
  try { assert.equal(exDefault.root.host.dataset.theme, 'dark'); }
  finally { exDefault.dom.window.close(); }
});

test('retry settings have defaults, validate inputs and persist alongside legacy search data',()=>{
  const app=setup();
  try{
    assert.equal(app.$('reader-retries').value,'1');assert.equal(app.$('reader-retry-interval').value,'3');
    app.clickTag('language:chinese');
    for(const [id,value]of[['reader-retries','12'],['reader-retry-interval','15']]){
      app.$(id).value=value;app.$(id).dispatchEvent(new app.window.Event('change'));
    }
    app.$('reader-retry-interval').value='301';app.$('reader-retry-interval').dispatchEvent(new app.window.Event('change'));
    assert.equal(app.$('reader-retry-interval').value,'15');
    app.$('fill').click();
    assert.equal(app.store.get('eh-search-tool:ui:v1').reader.imageRetries,12);
    assert.equal(app.store.get('eh-search-tool:v1').history.length,1);
  }finally{app.dom.window.close();}
  const reopened=setup('https://exhentai.org/',app.store);
  try{
    assert.equal(reopened.$('reader-retries').value,'12');assert.equal(reopened.$('reader-retry-interval').value,'15');
  }finally{reopened.dom.window.close();}
});

for (const site of ['e-hentai.org', 'exhentai.org']) test(site + ': fill-and-search submits once with native submitter and all filters', () => {
  const app = setup('https://' + site + '/');
  try {
    const form = app.window.document.querySelector('form');
    let submissions = 0, data;
    form.addEventListener('submit', event => {
      event.preventDefault(); submissions++;
      data = new app.window.FormData(form, event.submitter);
      assert.equal(event.submitter.name, 'f_apply');
    });
    app.clickTag('language:chinese'); app.input('page-min', '20'); app.input('page-max', '80');
    app.$('rating').value = '4';
    app.$('fill').click(); assert.equal(submissions, 0);
    app.$('fill-search').click(); assert.equal(submissions, 1);
    assert.equal(data.get('f_search'), 'language:chinese$');
    assert.equal(data.get('f_apply'), 'Apply Filter');
    assert.equal(data.get('f_sft'), 'on');
    assert.equal(data.get('f_spf'), '20'); assert.equal(data.get('f_spt'), '80');
    assert.equal(data.get('f_srdd'), '4'); assert.equal(data.get('advsearch'), '1');
    app.input('keywords', 'x'.repeat(201));
    assert.equal(app.$('fill').disabled, true); assert.equal(app.$('fill-search').disabled, true);
    app.$('fill-search').click(); assert.equal(submissions, 1);
    app.input('keywords', ''); app.input('page-min', '90');
    assert.equal(app.$('fill-search').disabled, true);
    app.input('page-min', '20'); assert.equal(app.$('fill-search').disabled, false);
  } finally { app.dom.window.close(); }
});

test('direct search respects native validation and supports forms without submit buttons', () => {
  const app = setup();
  try {
    const form = app.window.document.querySelector('form');
    form.querySelector('button').remove(); form.querySelector('[name=f_search]').required = true;
    let submissions = 0;
    form.addEventListener('submit', event => { event.preventDefault(); submissions++; });
    app.$('fill-search').click(); assert.equal(submissions, 0);
    app.input('keywords', 'example'); app.$('fill-search').click(); assert.equal(submissions, 1);
  } finally { app.dom.window.close(); }
});

test('comment defaults persist across both sites without replacing reading or search data', () => {
  const app = setup();
  try {
    assert.equal(app.$('comments-enabled').checked, true); assert.equal(app.$('comments-collapsed').checked, false);
    app.clickTag('language:chinese');
    app.$('reader-ahead').value = '8'; app.$('reader-ahead').dispatchEvent(new app.window.Event('change'));
    app.$('comments-collapsed').click(); app.$('comments-enabled').click();
    assert.equal(app.$('comments-collapsed').disabled, true);
    assert.equal(app.store.get('eh-search-tool:ui:v1').reader.ahead, 8);
    assert.equal(app.store.get('eh-search-tool:v1').history.length, 1);
  } finally { app.dom.window.close(); }
  const reopened = setup('https://exhentai.org/', app.store);
  try {
    assert.equal(reopened.$('comments-enabled').checked, false); assert.equal(reopened.$('comments-collapsed').checked, true);
    assert.equal(reopened.$('comments-collapsed').disabled, true);
    reopened.$('comments-enabled').click(); assert.equal(reopened.$('comments-collapsed').disabled, false);
    reopened.window.GM_setValue = () => { throw new Error('Storage failure'); };
    reopened.$('comments-enabled').click(); assert.equal(reopened.$('comments-enabled').checked, true);
    assert.match(reopened.$('status').textContent, /无法保存评论区/);
  } finally { reopened.dom.window.close(); }
});
