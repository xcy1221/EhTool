const queues = new Map();
const keyFor = id => 'gallery:' + id;
const split = tab => Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0;

function page(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['e-hentai.org', 'exhentai.org'].includes(url.hostname) || url.port || url.username || url.password) return null;
    const gallery = url.pathname.match(/^\/g\/(\d+)\/([a-z0-9]+)\/?$/i);
    const reader = url.pathname.match(/^\/s\/[a-z0-9]+\/(\d+)-(\d+)\/?$/i);
    if (gallery) return { origin: url.origin, gid: gallery[1], identity: url.origin + '/g/' + gallery[1] + '/' + gallery[2] + '/', type: 'gallery' };
    if (reader && Number(reader[2]) > 0) return { origin: url.origin, gid: reader[1], type: 'reader' };
  } catch {}
  return null;
}

async function indicator(tabId, text, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setTitle({ tabId, title });
  } catch {}
}

async function openReader(message, sender) {
  if (sender.frameId !== 0 || !sender.tab?.id) return { ok: false };
  const gallery = await chrome.tabs.get(sender.tab.id);
  const source = page(sender.url);
  const current = page(gallery.pendingUrl || gallery.url);
  if (source?.type !== 'gallery' || current?.identity !== source.identity) return { ok: false };
  if ((await chrome.storage.local.get('enabled')).enabled === false) return { ok: false };
  if (typeof chrome.tabs.createSplit !== 'function') {
    await indicator(gallery.id, '!', '原生分屏 API 不可用：需要 Chrome 155+ 且开放分屏接口');
    return { ok: false };
  }
  const key = keyFor(gallery.id);
  const stored = (await chrome.storage.session.get(key))[key];
  const state = stored?.identity === source.identity ? stored : null;
  let reader;
  if (state?.readerId) {
    try { reader = await chrome.tabs.get(state.readerId); } catch {}
    const info = page(reader?.pendingUrl || reader?.url);
    if (reader?.windowId !== gallery.windowId || info?.type !== 'reader' || info.gid !== source.gid || info.origin !== source.origin) reader = null;
  }
  const paired = reader && split(gallery) && reader.splitViewId === gallery.splitViewId;
  // Respect manually arranged split views and manual unsplitting.
  if (split(gallery) && !paired) return { ok: true, armed: false };
  if (message.type === 'gallery-ready' && state) return { ok: true, armed: !!paired || !split(gallery) };
  const target = page(message.url);
  if (target?.type !== 'reader' || target.origin !== source.origin || target.gid !== source.gid) return { ok: false };
  if (paired) {
    await chrome.tabs.update(reader.id, { url: message.url, active: gallery.active });
    return { ok: true, armed: true };
  }
  if (reader && split(reader)) return { ok: true, armed: false };
  // Claim before creation to prevent duplicate tabs after reload or worker restart.
  await chrome.storage.session.set({ [key]: { identity: source.identity, readerId: reader?.id ?? null } });
  let created = false;
  try {
    if (!reader) {
      reader = await chrome.tabs.create({ url: message.url, windowId: gallery.windowId, index: gallery.index + 1, pinned: gallery.pinned, openerTabId: gallery.id, active: false });
      created = true;
    } else await chrome.tabs.update(reader.id, { url: message.url });
    await chrome.storage.session.set({ [key]: { identity: source.identity, readerId: reader.id } });
    if (reader.pinned !== gallery.pinned) await chrome.tabs.update(reader.id, { pinned: gallery.pinned });
    if (reader.groupId !== gallery.groupId) {
      if (gallery.groupId >= 0) await chrome.tabs.group({ tabIds: reader.id, groupId: gallery.groupId });
      else await chrome.tabs.ungroup(reader.id);
    }
    const freshGallery = await chrome.tabs.get(gallery.id);
    if (page(freshGallery.pendingUrl || freshGallery.url)?.identity !== source.identity || split(freshGallery)) throw new Error('画廊已切换或已加入其他分屏，请点击缩略图重试');
    const freshReader = await chrome.tabs.get(reader.id);
    await chrome.tabs.move(reader.id, { index: freshGallery.index + (freshReader.index < freshGallery.index ? 0 : 1) });
    await chrome.tabs.createSplit([gallery.id, reader.id]);
    await indicator(gallery.id, '', 'eh 画廊分屏：左侧详情，右侧阅读；点击暂停');
    return { ok: true, armed: true };
  } catch (error) {
    if (created) {
      // Remove only the tab created by this failed attempt.
      try { await chrome.tabs.remove(reader.id); } catch {}
      await chrome.storage.session.set({ [key]: { identity: source.identity, readerId: null } });
    }
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['gallery-ready', 'open-reader'].includes(message?.type) || !sender.tab?.id) return false;
  const id = sender.tab.id;
  const task = (queues.get(id) || Promise.resolve()).then(() => openReader(message, sender));
  const settled = task.catch(async error => {
    await indicator(id, '!', '画廊分屏失败：' + error.message);
    return { ok: false };
  });
  queues.set(id, settled);
  settled.then(respond).finally(() => { if (queues.get(id) === settled) queues.delete(id); });
  return true;
});

chrome.tabs.onRemoved.addListener(id => { chrome.storage.session.remove(keyFor(id)).catch(() => {}); });
chrome.action.onClicked.addListener(async tab => {
  const enabled = (await chrome.storage.local.get('enabled')).enabled === false;
  await chrome.storage.local.set({ enabled });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  await chrome.action.setTitle({ title: enabled ? 'eh 画廊分屏：已启用；点击暂停' : 'eh 画廊分屏：已暂停；点击启用' });
  if (tab?.id) await indicator(tab.id, enabled ? '' : 'OFF', enabled ? 'eh 画廊分屏：已启用；点击暂停' : 'eh 画廊分屏：已暂停；点击启用');
});
chrome.storage.local.get('enabled').then(({ enabled }) => {
  if (enabled === false) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setTitle({ title: 'eh 画廊分屏：已暂停；点击启用' });
  }
});
