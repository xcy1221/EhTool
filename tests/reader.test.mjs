import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
const reader = readFileSync('src/reader.js', 'utf8');
const storeKey = 'eh-search-tool:ui:v1';
const urlFor = (index, origin = 'https://e-hentai.org') => origin + '/s/token' + index + '/123-' + index;
function fixture(index, total = 20) {
  return '<div id="i2"><div class="sn"><span>' + index + '</span> / <span>' + total + '</span></div></div>' +
    (index > 1 ? '<a id="prev" href="' + urlFor(index - 1) + '">上一张</a>' : '') +
    (index < total ? '<a id="next" href="' + urlFor(index + 1) + '">下一张</a>' : '') +
    '<a href="/g/123/abcdef/">画廊</a><img id="img" width="400" height="800" src="https://images.example/' + index + '.jpg">';
}
async function until(condition, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Reader condition timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function open(index = 6, settings = {}, failure = null, prepare = () => {}) {
  const dom = new JSDOM(fixture(index), { url: urlFor(index), runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const store = new Map([[storeKey, { ...settings, reader: { retryInterval: 0, ...settings.reader } }]]);
  const requests = [], aborted = [], imageRequests = [];
  const native = window.document.getElementById('img');
  Object.defineProperties(native, { complete:{value:true,configurable:true},naturalWidth:{value:400,configurable:true},naturalHeight:{value:800,configurable:true} });
  window.GM_getValue = (key, fallback) => structuredClone(store.get(key) ?? fallback);
  window.GM_setValue = (key, value) => store.set(key, JSON.parse(JSON.stringify(value)));
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === 'reader-scroll') return { top: 0, bottom: 600, width: 400, height: 600 };
    if (this.tagName === 'FIGURE' && this.isConnected) {
      const root = this.getRootNode(), scroll = root.getElementById('reader-scroll');
      const position = [...this.parentElement.children].indexOf(this) * 808 - scroll.scrollTop;
      return { top: position, bottom: position + 800, width: 400, height: 800 };
    }
    return originalRect.call(this);
  };
  const src = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');
  Object.defineProperty(window.HTMLImageElement.prototype, 'src', { ...src, set(value) {
    imageRequests.push(value); src.set.call(this, value);
    Object.defineProperty(this,'complete',{value:false,configurable:true});
    window.setTimeout(() => {
      if(this.getAttribute('src')!==value) return;
      const failed=window.failedImages?.has(value);
      Object.defineProperties(this,{complete:{value:true,configurable:true},naturalWidth:{value:failed?0:400,configurable:true},naturalHeight:{value:failed?0:800,configurable:true}});
      this.dispatchEvent(new window.Event(failed?'error':'load'));
    },5);
  } });
  const setAttribute=native.setAttribute;
  native.setAttribute=function(name,value){if(name==='src') this.src=value; else setAttribute.call(this,name,value);};
  window.fetch = async (url, options) => {
    const requested = Number(new URL(url).pathname.split('-').at(-1));
    requests.push({ index: requested, at:Date.now(), url, cache: options.cache, credentials: options.credentials });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 5);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); aborted.push(requested); reject(new Error('Aborted')); }, { once: true });
    });
    if (requested === failure?.index && failure.count-- > 0) return { ok: false, status: 503 };
    return { ok: true, url, text: async () => fixture(requested) };
  };
  prepare(window);
  window.eval(script);
  const host = window.document.getElementById('eh-continuous-reader'), root = host.shadowRoot;
  return { dom, window, store, host, root, requests, aborted, imageRequests, native, close() { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); }, scroll: root.getElementById('reader-scroll') };
}

test('parser uses same-gallery adjacent links and rejects broken pages', () => {
  const dom = new JSDOM('', { url: urlFor(3), runScripts: 'outside-only' });
  try {
    dom.window.eval(reader + '\nwindow.parsePage = parseReaderPage; window.bounds = readerBounds;');
    const doc = new dom.window.DOMParser().parseFromString(fixture(3), 'text/html');
    doc.querySelector('#next').href = 'https://exhentai.org/s/token4/123-4';
    doc.body.insertAdjacentHTML('beforeend', '<a href="/s/other/999-4">Wrong gallery</a><a href="/s/token4/123-4">Valid fallback</a>');
    const parsed = dom.window.parsePage(doc, urlFor(3));
    assert.equal(parsed.next, urlFor(4)); assert.equal(parsed.prev, urlFor(2));
    assert.equal(parsed.total, 20); assert.equal(parsed.width, 400); assert.equal(parsed.height, 800);
    assert.throws(() => dom.window.parsePage(new dom.window.DOMParser().parseFromString('<p>Login required</p>', 'text/html'), urlFor(3)));
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.bounds(6, 7, 1, { ahead: 5, behind: 3 }, 20))), { first: 3, last: 12 });
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.bounds(6, 7, -1, { ahead: 5, behind: 3 }, 20))), { first: 1, last: 10 });
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.bounds(1, 2, -1, { ahead: 5, behind: 3 }, 3))), { first: 1, last: 3 });
  } finally { dom.window.close(); }
});

test('continuous reader preloads five ahead, retains three behind, reverses and preserves placeholders', async () => {
  const app = open();
  try {
    await until(() => app.root.querySelectorAll('figure[data-state=loaded]').length === 9);
    assert.deepEqual([...app.root.querySelectorAll('figure')].map(el => Number(el.dataset.page)), [3,4,5,6,7,8,9,10,11]);
    assert.equal(app.host.dataset.first, '3'); assert.equal(app.host.dataset.last, '11');
    assert.ok(app.requests.every(request => request.credentials === 'same-origin'));
    assert.ok(app.requests.every(request => request.index >= 3 && request.index <= 11));
    assert.equal(app.scroll.scrollTop, 3 * 808, 'Prepending must keep the opened image at the same viewport position');
    app.scroll.scrollTop += 2 * 808; app.scroll.dispatchEvent(new app.window.Event('scroll'));
    await until(() => app.host.dataset.first === '5' && app.host.dataset.last === '13' && app.root.querySelector('[data-page="13"]')?.dataset.state === 'loaded');
    const released = app.root.querySelector('[data-page="3"]');
    assert.equal(released.querySelector('img'), null); assert.equal(released.style.aspectRatio, '400 / 800');
    app.scroll.scrollTop -= 808; app.scroll.dispatchEvent(new app.window.Event('scroll'));
    await until(() => app.host.dataset.direction === 'up' && app.host.dataset.first === '2' && app.host.dataset.last === '10' && app.root.querySelector('[data-page="2"]')?.dataset.state === 'loaded');
    assert.equal(app.root.querySelector('[data-page="13"] img'), null);
    assert.ok(app.root.querySelector('[data-page="7"] img'), 'Visible image must remain mounted');
  } finally { app.close(); }
});

test('a failed page retries individually and exit restores native image without continuing requests', async () => {
  const app = open(6, {reader:{imageRetries:0}}, { index: 7, count: 1 });
  try {
    await until(() => app.root.querySelector('[data-page="7"]')?.dataset.state === 'error');
    assert.ok(app.root.querySelector('[data-page="6"] img'));
    app.root.querySelector('[data-page="7"] button').click();
    await until(() => app.root.querySelector('[data-page="11"]')?.dataset.state === 'loaded');
    assert.equal(app.requests.filter(request => request.index === 7).length, 2);
    app.root.getElementById('reader-close').click();
    const count = app.requests.length;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(app.requests.length, count);
    assert.equal(app.window.document.getElementById('img').getAttribute('src'), 'https://images.example/6.jpg');
    assert.ok(app.root.getElementById('reader-start'));
  } finally { app.close(); }
});

test('disabled reader offers an entry, settings persist separately from search history', async () => {
  const app = open(1, { theme: 'dark', reader: { enabled: false, ahead: 2, behind: 1 } });
  try {
    assert.equal(app.scroll, null); assert.equal(app.window.document.getElementById('img').getAttribute('src'), 'https://images.example/1.jpg');
    app.root.getElementById('reader-start').click();
    await until(() => app.root.querySelector('[data-page="3"]')?.dataset.state === 'loaded');
    assert.equal(app.host.dataset.theme, 'dark'); assert.equal(app.host.dataset.last, '3');
    app.root.getElementById('reader-theme').click();
    assert.equal(app.store.get(storeKey).theme, 'light');
    const control = app.root.getElementById('reader-ahead'); control.value = '4'; control.dispatchEvent(new app.window.Event('change'));
    await until(() => app.root.querySelector('[data-page="5"]')?.dataset.state === 'loaded');
    assert.equal(app.store.get(storeKey).reader.ahead, 4);
    control.value = '-1'; control.dispatchEvent(new app.window.Event('change'));
    assert.equal(control.value, '4'); assert.equal(app.store.has('eh-search-tool:v1'), false);
  } finally { app.close(); }
});

test('pagehide cancels reading and a cached page restore can resume cleanly', async () => {
  const app = open(6);
  try {
    await until(() => app.root.querySelector('[data-page="11"]')?.dataset.state === 'loaded');
    app.window.dispatchEvent(new app.window.Event('pagehide'));
    assert.equal(app.root.querySelectorAll('figure').length, 0);
    assert.ok(app.root.getElementById('reader-start'));
    app.window.dispatchEvent(new app.window.PageTransitionEvent('pageshow', { persisted: true }));
    await until(() => app.root.querySelector('[data-page="11"]')?.dataset.state === 'loaded');
    assert.equal(app.root.querySelectorAll('[data-page="6"]').length, 1);
    assert.equal(app.host.dataset.first, '3');
  } finally { app.close(); }
});

test('the initial loaded or pending image is reused without cancelling or restarting its request', async () => {
  for (const pending of [false,true]) {
    const app=open(1,{reader:{ahead:0,behind:0}},null,window=>{
      const img=window.document.getElementById('img');
      img.style.cssText='width: 400px; height: 800px;';
      if(pending) Object.defineProperties(img,{complete:{value:false,configurable:true},naturalWidth:{value:0,configurable:true},naturalHeight:{value:0,configurable:true}});
    });
    try {
      await until(()=>app.root.querySelector('[data-page="1"] img')===app.native);
      if(pending) {
        assert.equal(app.native.getAttribute('src'),'https://images.example/1.jpg');
        Object.defineProperties(app.native,{naturalWidth:{value:400,configurable:true},naturalHeight:{value:800,configurable:true}});
        app.native.dispatchEvent(new app.window.Event('load'));
      }
      await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='loaded');
      assert.equal(app.requests.length,0);
      assert.equal(app.imageRequests.length,0);
      app.root.getElementById('reader-close').click();
      assert.equal(app.window.document.getElementById('img'),app.native);
      assert.equal(app.native.style.width,'400px');
      assert.equal(app.native.getAttribute('src'),'https://images.example/1.jpg');
    } finally {app.close();}
  }
});

for(const automatic of [false,true]) test((automatic?'automatic':'manual')+' image recovery uses the reload token, bypasses page cache and obtains a new source',async()=>{
  const app=open(1,{reader:{ahead:0,behind:0,imageRetries:automatic?1:0}},null,window=>{
    Object.defineProperty(window.document.getElementById('img'),'naturalWidth',{value:0,configurable:true});
    window.document.body.insertAdjacentHTML('beforeend',"<a id=\"loadfail\" onclick=\"return nl('old-token')\">Reload</a>");
    const fetch=window.fetch;
    window.fetch=async(url,options)=>{
      const response=await fetch(url,options);
      if(new URL(url).searchParams.get('nl')!=='old-token') return response;
      return {...response,text:async()=>fixture(1).replace('https://images.example/1.jpg','https://healthy.example/1.jpg')};
    };
  });
  try{
    if(!automatic) {
      await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='error');
      assert.equal(app.requests.length,0);
      app.root.querySelector('[data-page="1"] button').click();
    }
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='loaded');
    assert.equal(app.requests.length,1);
    assert.equal(new URL(app.requests[0].url).searchParams.get('nl'),'old-token');
    assert.equal(app.requests[0].cache,'reload');
    assert.equal(app.root.querySelector('[data-page="1"] img').src,'https://healthy.example/1.jpg');
    app.root.getElementById('reader-close').click();
    assert.equal(app.window.document.getElementById('img').src,'https://healthy.example/1.jpg');
    app.root.getElementById('reader-start').click();
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='loaded');
    assert.equal(app.requests.length,1,'Reopening must keep the successful replacement source');
  }finally{app.close();}
});

test('persistent image errors stop after one automatic source recovery',async()=>{
  const app=open(1,{reader:{ahead:0,behind:0}},null,window=>{
    Object.defineProperty(window.document.getElementById('img'),'naturalWidth',{value:0,configurable:true});
    window.failedImages=new Set(['https://images.example/1.jpg']);
    window.document.body.insertAdjacentHTML('beforeend',"<a id=\"loadfail\" onclick=\"return nl('old-token')\">Reload</a>");
    const fetch=window.fetch;
    window.fetch=async(url,options)=>({...await fetch(url,options),text:async()=>fixture(1)+"<a id=\"loadfail\" onclick=\"return nl('new-token')\">Reload</a>"});
  });
  try{
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='error');
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(app.requests.length,1);
    assert.equal(app.imageRequests.length,1);
    app.window.failedImages.clear();
    app.root.querySelector('[data-page="1"] button').click();
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='loaded');
    assert.equal(new URL(app.requests[1].url).searchParams.get('nl'),'new-token');
  }finally{app.close();}
});

function brokenFirst(reader, token = true, failure = null) {
  return open(1,{reader:{ahead:0,behind:0,...reader}},failure,window=>{
    Object.defineProperty(window.document.getElementById('img'),'naturalWidth',{value:0,configurable:true});
    window.failedImages=new Set(['https://images.example/1.jpg']);
    if(token)window.document.body.insertAdjacentHTML('beforeend',"<a id=\"loadfail\" onclick=\"return nl('old-token')\">Reload</a>");
    const fetch=window.fetch;
    window.fetch=async(url,options)=>{
      const response=await fetch(url,options);
      return {...response,text:async()=>fixture(Number(new URL(url).pathname.split('-').at(-1)))+(token?"<a id=\"loadfail\" onclick=\"return nl('new-token')\">Reload</a>":"")};
    };
  });
}
test('configured retry count and one-second interval apply to every failed attempt',async()=>{
  const app=brokenFirst({imageRetries:2,retryInterval:1});
  try{
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='retry-wait');
    const waitingAt=Date.now();
    assert.equal(app.requests.length,0);
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='error',4500);
    assert.equal(app.requests.length,2); assert.equal(app.imageRequests.length,2);
    assert.ok(app.requests[0].at-waitingAt>=900,'First retry started too early');
    assert.ok(app.requests[1].at-app.requests[0].at>=950,'Configured interval was skipped');
    assert.equal(new URL(app.requests[1].url).searchParams.get('nl'),'new-token');
  }finally{app.close();}
});
test('retrying without a reload token works and failed reload-page requests count toward the limit',async()=>{
  for(const token of [false,true]){
    const app=brokenFirst({imageRetries:3,retryInterval:0},token,{index:1,count:1});
    try{
      await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='error');
      assert.equal(app.requests.length,3); assert.equal(app.imageRequests.length,2);
      assert.ok(app.requests.every(request=>request.cache==='reload'));
      if(!token)assert.ok(app.requests.every(request=>!new URL(request.url).searchParams.has('nl')));
    }finally{app.close();}
  }
});
test('manual retry cancels the pending automatic timer and starts immediately',async()=>{
  const app=brokenFirst({imageRetries:3,retryInterval:1});
  try{
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='retry-wait');
    app.window.failedImages.clear();
    app.root.querySelector('[data-page="1"] button').click();
    await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='loaded');
    assert.equal(app.requests.length,1);
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal(app.requests.length,1,'The old automatic timer fired after a manual retry');
  }finally{app.close();}
});
test('changing retry settings reschedules or disables pending retries and validates input',async()=>{
  for(const disable of [false,true]){
    const app=brokenFirst({imageRetries:3,retryInterval:1});
    try{
      await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='retry-wait');
      app.window.failedImages.clear();
      const field=app.root.getElementById(disable?'reader-retries':'reader-retry-interval');
      field.value='0';field.dispatchEvent(new app.window.Event('change'));
      if(disable)await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='error');
      else await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='loaded');
      await new Promise(resolve=>setTimeout(resolve,1100));
      assert.equal(app.requests.length,disable?0:1);
      field.value='-1';field.dispatchEvent(new app.window.Event('change'));assert.equal(field.value,'0');
      field.value='1.5';field.dispatchEvent(new app.window.Event('change'));assert.equal(field.value,'0');
      assert.equal(app.store.get(storeKey).reader[disable?'imageRetries':'retryInterval'],0);
    }finally{app.close();}
  }
});
test('leaving the load window or closing the reader cancels pending retry timers',async()=>{
  for(const close of [false,true]){
    const app=brokenFirst({imageRetries:3,retryInterval:1,ahead:1});
    try{
      await until(()=>app.root.querySelector('[data-page="1"]').dataset.state==='retry-wait');
      if(close)app.root.getElementById('reader-close').click();
      else {app.scroll.scrollTop=808;app.scroll.dispatchEvent(new app.window.Event('scroll'));}
      await new Promise(resolve=>setTimeout(resolve,1100));
      assert.equal(app.requests.filter(request=>request.index===1).length,0);
    }finally{app.close();}
  }
});
