import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const background = readFileSync('extension/background.js', 'utf8');
const content = readFileSync('extension/gallery.js', 'utf8');
const galleryUrl = 'https://e-hentai.org/g/123/abcdef/';
const readerUrl = 'https://e-hentai.org/s/abc/123-1';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function worker({ active = true, groupId = -1, pinned = false, supported = true, fail = false, local = {}, session = {}, tabs } = {}) {
  const events = {};
  const calls = [];
  const data = tabs || new Map([
    [100, { id: 100, index: 0, windowId: 1, pinned: false, groupId: -1, splitViewId: -1, active: false, url: 'https://example.com/' }],
    [1, { id: 1, index: 1, windowId: 1, pinned, groupId, splitViewId: -1, active, url: galleryUrl }],
    [101, { id: 101, index: 2, windowId: 1, pinned: false, groupId: -1, splitViewId: -1, active: !active, url: 'https://example.org/' }],
  ]);
  let nextId = 200;
  const event = name => ({ addListener: fn => { events[name] = fn; } });
  const storage = value => ({
    get: async key => ({ [key]: value[key] }),
    set: async values => Object.assign(value, JSON.parse(JSON.stringify(values))),
    remove: async key => { delete value[key]; },
  });
  const move = (id, index) => {
    const target = data.get(id);
    const list = [...data.values()].filter(t => t.windowId === target.windowId && t.id !== id).sort((a, b) => a.index - b.index);
    list.splice(Math.min(index, list.length), 0, target);
    list.forEach((tab, i) => { tab.index = i; });
  };
  const chrome = {
    runtime: { onMessage: event('message') },
    storage: { local: storage(local), session: storage(session) },
    action: {
      onClicked: event('toggle'),
      setBadgeText: async args => { calls.push(['badge', args]); },
      setTitle: async args => { calls.push(['title', args]); },
    },
    tabs: {
      onRemoved: event('removed'),
      get: async id => {
        if (!data.has(id)) throw new Error('No tab');
        return { ...data.get(id) };
      },
      create: async args => {
        calls.push(['create', { ...args }]);
        const tab = { id: nextId++, pinned: false, groupId: -1, splitViewId: -1, ...args };
        data.set(tab.id, tab);
        move(tab.id, args.index);
        return { ...tab };
      },
      update: async (id, args) => {
        calls.push(['update', id, { ...args }]);
        if (args.active) for (const tab of data.values()) if (tab.windowId === data.get(id).windowId) tab.active = false;
        Object.assign(data.get(id), args);
        return { ...data.get(id) };
      },
      group: async ({ tabIds, groupId }) => { data.get(tabIds).groupId = groupId; },
      ungroup: async id => { data.get(id).groupId = -1; },
      move: async (id, { index }) => { move(id, index); return { ...data.get(id) }; },
      remove: async id => {
        calls.push(['remove', id]);
        data.delete(id);
        for (const tab of data.values()) if (tab.splitViewId >= 0 && ![...data.values()].some(other => other.id !== tab.id && other.splitViewId === tab.splitViewId)) tab.splitViewId = -1;
        events.removed(id);
      },
    },
  };
  if (supported) chrome.tabs.createSplit = async ids => {
    calls.push(['split', [...ids]]);
    if (fail) throw new Error('Split unavailable');
    const [left, right] = ids.map(id => data.get(id));
    assert.equal(right.index, left.index + 1, 'reader must be immediately to the right');
    for (const prop of ['windowId', 'pinned', 'groupId']) assert.equal(right[prop], left[prop]);
    assert.equal(left.splitViewId, -1);
    assert.equal(right.splitViewId, -1);
    left.splitViewId = right.splitViewId = left.id + 500;
    return left.splitViewId;
  };
  vm.runInNewContext(background, { chrome, URL, Map, Number, Promise });
  const send = (type = 'gallery-ready', url = readerUrl, id = 1, extra = {}) => new Promise(resolve => {
    assert.equal(events.message({ type, url }, { tab: { id }, frameId: 0, url: data.get(id).url, ...extra }, resolve), true);
  });
  return { send, calls, data, session, local, events, chrome };
}

test('parallel notifications, reload and worker restart create one pair', async () => {
  const app = worker({ active: false });
  const results = await Promise.all([app.send(), app.send(), app.send()]);
  assert.ok(results.every(r => r.ok && r.armed));
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 1);
  assert.deepEqual(app.calls.find(c => c[0] === 'split')[1], [1, 200]);
  assert.equal(app.data.get(101).active, true, 'background gallery must not steal focus');
  assert.equal(app.data.get(200).active, false);
  const restarted = worker({ session: app.session, tabs: app.data });
  await restarted.send();
  assert.equal(restarted.calls.filter(c => c[0] === 'create').length, 0);
});

test('thumbnail selection reuses the reader and reload never resets the reading position', async () => {
  const app = worker();
  await app.send();
  const next = 'https://e-hentai.org/s/def/123-20';
  await app.send('open-reader', next);
  assert.equal(app.data.get(200).url, next);
  assert.equal(app.data.get(200).active, true);
  await app.send();
  assert.equal(app.data.get(200).url, next);
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 1);
});

test('grouped and pinned galleries satisfy the native API requirements', async () => {
  for (const options of [{ groupId: 7 }, { pinned: true }]) {
    const app = worker(options);
    assert.equal((await app.send()).ok, true);
    assert.equal(app.data.get(200).groupId, options.groupId ?? -1);
    assert.equal(app.data.get(200).pinned, options.pinned ?? false);
  }
});

test('missing API and disabled preference leave tabs untouched', async () => {
  for (const options of [{ supported: false }, { local: { enabled: false } }]) {
    const app = worker(options);
    assert.equal((await app.send()).ok, false);
    assert.equal(app.calls.filter(c => ['create', 'split', 'update'].includes(c[0])).length, 0);
    assert.equal(Object.keys(app.session).length, 0);
  }
});

test('reject cross-gallery, cross-site, external, MPV and iframe requests', async () => {
  for (const url of ['https://e-hentai.org/s/abc/999-1', 'https://exhentai.org/s/abc/123-1', 'https://example.com/s/abc/123-1', 'https://e-hentai.org/mpv/123/abcdef/', 'https://e-hentai.org/s/abc/123-0']) {
    const app = worker();
    await app.send('gallery-ready', url);
    assert.equal(app.calls.filter(c => c[0] === 'create').length, 0);
  }
  const app = worker();
  await app.send('gallery-ready', readerUrl, 1, { frameId: 2 });
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 0);
});

test('manual split is preserved', async () => {
  const app = worker();
  app.data.get(1).splitViewId = 42;
  assert.equal((await app.send()).armed, false);
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 0);
});

test('closed reader stays closed on reload and can be reopened by selecting a thumbnail', async () => {
  const app = worker();
  await app.send();
  await app.chrome.tabs.remove(200);
  await app.send();
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal((await app.send('open-reader')).ok, true);
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 2);
});

test('manual unsplitting stays unchanged on reload and selection repairs tab order', async () => {
  const app = worker();
  await app.send();
  app.data.get(1).splitViewId = app.data.get(200).splitViewId = -1;
  await app.chrome.tabs.move(200, { index: 0 });
  await app.send();
  assert.equal(app.calls.filter(c => c[0] === 'split').length, 1);
  assert.equal((await app.send('open-reader')).ok, true);
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(app.calls.filter(c => c[0] === 'split').length, 2);
});

test('failure cleans up only the newly created tab and does not loop on reload', async () => {
  const app = worker({ fail: true });
  assert.equal((await app.send()).ok, false);
  assert.deepEqual(app.calls.filter(c => c[0] === 'remove').map(c => c[1]), [200]);
  assert.ok(app.data.has(1) && app.data.has(100) && app.data.has(101));
  await app.send();
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 1);
  assert.ok(app.calls.some(c => c[0] === 'badge' && c[1].text === '!'));
});

test('separate galleries on both sites get their own readers', async () => {
  const app = worker();
  app.data.set(2, { ...app.data.get(1), id: 2, index: 3, url: 'https://exhentai.org/g/456/abcdef/' });
  await Promise.all([app.send(), app.send('gallery-ready', 'https://exhentai.org/s/def/456-1', 2)]);
  assert.notEqual(app.data.get(1).splitViewId, app.data.get(2).splitViewId);
  assert.equal(app.calls.filter(c => c[0] === 'create').length, 2);
});

test('action toggle persists and blocks future opens', async () => {
  const app = worker();
  await app.events.toggle({ id: 1 });
  assert.equal(app.local.enabled, false);
  assert.equal((await app.send()).ok, false);
  await app.events.toggle({ id: 1 });
  assert.equal(app.local.enabled, true);
  assert.equal((await app.send()).ok, true);
});

function gallery(html = '', armed = true) {
  const dom = new JSDOM('<div id="gdt">' + html + '</div>', { url: galleryUrl, runScripts: 'outside-only' });
  const messages = [];
  let changed;
  dom.window.chrome = {
    runtime: { sendMessage: async message => { messages.push({ ...message }); return typeof armed === 'function' ? armed(message) : { ok: armed, armed }; } },
    storage: { onChanged: { addListener: listener => { changed = listener; } } },
  };
  dom.window.eval(content);
  return { dom, messages, changed };
}

test('delayed thumbnails send once; ordinary clicks route right; modified clicks remain native', async () => {
  const app = gallery();
  try {
    const document = app.dom.window.document;
    document.getElementById('gdt').innerHTML = '<a href="https://example.org/s/abc/123-1">External</a><a id="first" href="/s/abc/123-1"><span>Read</span></a>';
    await tick();
    assert.equal(app.messages.length, 1);
    assert.equal(app.messages[0].url, readerUrl);
    const link = document.getElementById('first');
    link.append(document.createElement('span'));
    await tick();
    assert.equal(app.messages.length, 1);
    let prevented;
    document.addEventListener('click', e => { prevented = e.defaultPrevented; e.preventDefault(); });
    link.querySelector('span').dispatchEvent(new app.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await tick();
    assert.equal(app.messages.at(-1).type, 'open-reader');
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      link.dispatchEvent(new app.dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
      assert.equal(prevented, false);
    }
    assert.equal(app.messages.length, 2);
    app.changed({ enabled: { newValue: false } }, 'local');
    link.dispatchEvent(new app.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(prevented, false);
    assert.equal(app.messages.length, 2);
  } finally { app.dom.window.close(); }
});

test('unsupported API does not intercept thumbnail clicks', async () => {
  const app = gallery('<a id="first" href="/s/abc/123-1">Read</a>', false);
  try {
    await tick();
    let prevented;
    app.dom.window.document.addEventListener('click', e => { prevented = e.defaultPrevented; e.preventDefault(); });
    app.dom.window.document.getElementById('first').click();
    assert.equal(prevented, false);
    assert.equal(app.messages.length, 1);
  } finally { app.dom.window.close(); }
});

test('manifest references existing scripts and limits host permissions', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://e-hentai.org/*', 'https://exhentai.org/*']);
  readFileSync('extension/' + manifest.background.service_worker);
  for (const script of manifest.content_scripts[0].js) readFileSync('extension/' + script);
});

test('pausing while the initial response is pending keeps thumbnail clicks native', async () => {
  let complete;
  const app = gallery('<a id="first" href="/s/abc/123-1">Read</a>', () => new Promise(resolve => { complete = resolve; }));
  try {
    app.changed({ enabled: { newValue: false } }, 'local');
    complete({ ok: true, armed: true });
    await tick();
    let prevented;
    app.dom.window.document.addEventListener('click', e => { prevented = e.defaultPrevented; e.preventDefault(); });
    app.dom.window.document.getElementById('first').click();
    assert.equal(prevented, false);
    assert.equal(app.messages.length, 1);
  } finally { app.dom.window.close(); }
});
