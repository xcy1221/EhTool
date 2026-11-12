import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

await mkdir('test-results', { recursive: true });
const script = await readFile('dist/eh-search-tool.user.js', 'utf8');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
const errors = [];
function source(index, origin) { return origin + '/s/token' + index + '/123-' + index; }
function dimensions(index) { return index === 10 ? [600, 1600] : [800, 1200]; }
function html(index, origin, broken = false, total = 22) {
  const [width, height] = dimensions(index);
  return '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>阅读模拟</title>' +
    '<div id="i2"><div class="sn"><span>' + index + '</span> / <span>' + total + '</span></div></div>' +
    '<a id="first" href="' + source(1, origin) + '">First</a>' +
    (index > 1 ? '<a id="prev" href="' + source(index - 1, origin) + '">Prev</a>' : '') +
    (index < total ? '<a id="next" href="' + source(index + 1, origin) + '">Next</a>' : '') +
    '<a href="/g/123/abcdef/">Gallery</a><img id="img" width="' + width + '" height="' + height + '" src="https://reader-images.invalid/' + (broken ? 'broken' : index) + '.svg">' +
    '<script>document.addEventListener("keydown",e=>{if(["ArrowDown"," ","d"].includes(e.key)) window.nativeKeyEvents=(window.nativeKeyEvents||0)+1;});</script>';
}
async function sampleMotion(scroll) {
  return scroll.evaluate(scroll => new Promise(resolve => {
    const figure = scroll.getRootNode().querySelector('figure'), frames = [];
    function frame(time) {
      frames.push({ time, top: figure.getBoundingClientRect().top });
      if (frames.length < 46) { requestAnimationFrame(frame); return; }
      const steps = frames.slice(1).map((entry, index) => frames[index].top - entry.top);
      resolve({ distance: frames[0].top - frames.at(-1).top, seconds: (frames.at(-1).time - frames[0].time) / 1000, height: scroll.clientHeight, stationary: steps.filter(step => Math.abs(step) < 0.001).length, backwards: steps.filter(step => step < -0.001).length });
    }
    requestAnimationFrame(frame);
  }));
}
try {
  for (const origin of ['https://e-hentai.org', 'https://exhentai.org']) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1100 } });
    await context.addInitScript(()=>localStorage.setItem('eh-search-tool:ui:v1',JSON.stringify({reader:{imageRetries:0}})));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    const metadata = [], failedRequests = [];
    let inflight = 0, maxInflight = 0, fail7 = origin.includes('exhentai'), release13;
    const held13 = new Promise(resolve => { release13 = resolve; });
    page.on('requestfailed', request => failedRequests.push(request.url()));
    await context.route('https://reader-images.invalid/**', async route => {
      const index = Number(route.request().url().match(/\/(\d+)\.svg$/)?.[1]);
      if (!index) { await route.fulfill({ status: 404 }); return; }
      const [width,height] = dimensions(index);
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="' + (index % 2 ? '#dae7d4' : '#d4dfe7') + '"/><text x="50%" y="50%" font-size="90" text-anchor="middle">Page ' + index + '</text></svg>' });
    });
    await context.route(origin + '/s/**', async route => {
      const index = Number(new URL(route.request().url()).pathname.split('-').at(-1));
      const isFetch = route.request().resourceType() === 'fetch';
      if (isFetch) { metadata.push(index); inflight++; maxInflight = Math.max(maxInflight, inflight); }
      try {
        if (isFetch && index === 13) await held13;
        if (isFetch && index === 7 && fail7) { fail7 = false; await route.fulfill({ status: 503 }); }
        else await route.fulfill({ contentType: 'text/html', body: html(index, origin) });
      } finally { if (isFetch) inflight--; }
    });
    await page.goto(source(6, origin));
    await page.addScriptTag({ content: script });
    const host = page.locator('#eh-continuous-reader');
    if (origin.includes('exhentai')) {
      await host.locator('[data-page="7"] button').waitFor();
      await host.locator('[data-page="7"] button').evaluate(button => button.click());
    }
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelectorAll('figure[data-state=loaded]').length === 9);
    assert.equal(await host.getAttribute('data-first'), '3');
    assert.equal(await host.getAttribute('data-last'), '11');
    assert.equal(await host.getAttribute('data-theme'), origin.includes('exhentai') ? 'dark' : 'light');
    assert.ok(metadata.every(index => index >= 3 && index <= 11));
    assert.ok(maxInflight <= 2, 'Metadata requests exceed concurrency limit');
    assert.deepEqual(await host.locator('figure').evaluateAll(figures => figures.map(figure => Number(figure.dataset.page))), [3,4,5,6,7,8,9,10,11]);
    const position = () => host.locator('[data-page="6"]').evaluate(element => element.getBoundingClientRect().top);
    assert.ok(Math.abs(await position() - await host.locator('#reader-scroll').evaluate(el => el.getBoundingClientRect().top) - 8) < 2, 'Prepending moved the opened image');
    await page.screenshot({ path: 'test-results/reader-default-' + (origin.includes('exhentai') ? 'ex' : 'eh') + '.png' });
    const active = page.url();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => window.nativeKeyEvents || 0), 0);
    assert.equal(page.url(), active);
    await host.locator('#reader-scroll').evaluate(scroll => {
      const figure = scroll.getRootNode().querySelector('[data-page="8"]');
      scroll.scrollTop += figure.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    });
    await page.waitForRequest(request => request.resourceType() === 'fetch' && request.url() === source(13, origin));
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').dataset.last === '13');
    assert.equal(await host.locator('[data-page="3"] img').count(), 0);
    const before = await host.locator('[data-page="3"]').evaluate(el => el.getBoundingClientRect().height);
    await host.locator('#reader-scroll').evaluate(scroll => {
      const figure = scroll.getRootNode().querySelector('[data-page="7"]');
      scroll.scrollTop += figure.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    });
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').dataset.direction === 'up' && document.querySelector('#eh-continuous-reader').dataset.last === '10');
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="2"]')?.dataset.state === 'loaded');
    release13();
    await page.waitForTimeout(80);
    assert.ok(failedRequests.includes(source(13,origin)), 'Out-of-window request was not cancelled');
    assert.equal(await host.locator('[data-page="13"] img').count(), 0);
    assert.equal(await host.locator('[data-page="3"]').evaluate(el => el.getBoundingClientRect().height), before);
    const top = await host.locator('[data-page="7"]').evaluate(el => el.getBoundingClientRect().top);
    assert.ok(Math.abs(top - await host.locator('#reader-scroll').evaluate(el => el.getBoundingClientRect().top)) < 2, 'Reversing and prepending moved the visible image');
    await host.locator('#reader-theme').click();
    await host.locator('[data-section="reader-settings"] > summary').click();
    await host.locator('#reader-width').fill('700'); await host.locator('#reader-width').press('Tab');
    await page.waitForTimeout(60);
    assert.equal(Math.round((await host.locator('[data-page="7"]').boundingBox()).width), 700);
    await host.locator('#reader-scroll').evaluate(scroll => { scroll.scrollTop += 350; });
    const fraction = () => host.locator('[data-page="7"]').evaluate(el => (el.getRootNode().getElementById('reader-scroll').getBoundingClientRect().top - el.getBoundingClientRect().top) / el.getBoundingClientRect().height);
    const readingFraction = await fraction();
    for (const [scale, width] of [['50', 350], ['200', 1400], ['100', 700]]) {
      await host.locator('#reader-scale').fill(scale); await host.locator('#reader-scale').press('Tab');
      assert.ok(Math.abs((await host.locator('[data-page="7"]').boundingBox()).width - width) < 2);
      assert.ok(Math.abs(await fraction() - readingFraction) < 0.005, 'Scaling must keep the reading position within the same image');
      if (scale === '200') assert.ok(await host.locator('#reader-scroll').evaluate(el => el.scrollWidth > el.clientWidth && el.scrollLeft > 0), 'Magnified images must allow horizontal panning');
    }
    await host.locator('[data-section="reader-settings"] > summary').click();
    await page.screenshot({ path: 'test-results/reader-' + (origin.includes('exhentai') ? 'ex' : 'eh') + '.png' });
    // A narrow split pane uses the same viewport behavior as mobile.
    const beforeResize = await host.locator('#reader-progress').textContent();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    assert.equal(await host.locator('#reader-progress').textContent(), beforeResize, 'Resizing moved to a different image');
    assert.ok(await host.locator('#reader-scroll').evaluate(el => el.scrollWidth <= el.clientWidth));
    await page.waitForFunction(() => {
      const host=document.querySelector('#eh-continuous-reader'), root=host.shadowRoot;
      const first=Number(host.dataset.first),last=Number(host.dataset.last);
      return [...root.querySelectorAll('figure')].filter(el=>Number(el.dataset.page)>=first&&Number(el.dataset.page)<=last).every(el=>el.dataset.state==='loaded');
    });
    const windowCheck = await host.evaluate(host => {
      const root=host.shadowRoot, viewport=root.getElementById('reader-scroll').getBoundingClientRect();
      const figures=[...root.querySelectorAll('figure')], visible=figures.filter(el=>el.getBoundingClientRect().bottom>viewport.top+1&&el.getBoundingClientRect().top<viewport.bottom-1);
      return { first:Number(visible[0].dataset.page),last:Number(visible.at(-1).dataset.page),boundsFirst:Number(host.dataset.first),boundsLast:Number(host.dataset.last),direction:host.dataset.direction,visibleLoaded:visible.every(el=>el.dataset.state==='loaded') };
    });
    assert.ok(windowCheck.visibleLoaded);
    assert.equal(windowCheck.boundsFirst, Math.max(1, windowCheck.first-(windowCheck.direction==='down'?3:5)));
    assert.equal(windowCheck.boundsLast, Math.min(22, windowCheck.last+(windowCheck.direction==='down'?5:3)));
    await page.screenshot({ path: 'test-results/reader-mobile.png' });
    const auto = host.locator('#reader-auto-toggle');
    const autoSettings = host.locator('[data-section="reader-settings"]');
    assert.equal(await auto.getAttribute('aria-pressed'), 'false');
    await autoSettings.locator('summary').click();
    await host.locator('#reader-auto-interval').fill('1');
    await host.locator('#reader-auto-interval').press('Tab');
    const pageStart = await host.locator('#reader-scroll').evaluate(el => el.scrollTop);
    const nextIndex = await host.evaluate(host => {
      const root = host.shadowRoot, top = root.getElementById('reader-scroll').getBoundingClientRect().top;
      return Number([...root.querySelectorAll('figure')].find(el => el.getBoundingClientRect().bottom > top + 1).dataset.page) + 1;
    });
    await auto.click();
    await page.waitForFunction(start => document.querySelector('#eh-continuous-reader').shadowRoot.getElementById('reader-scroll').scrollTop > start + 10, pageStart);
    await auto.click();
    const alignedTop = await host.locator('[data-page="' + nextIndex + '"]').evaluate(el => el.getBoundingClientRect().top - el.getRootNode().getElementById('reader-scroll').getBoundingClientRect().top);
    assert.ok(Math.abs(alignedTop) < 1, 'Whole-page mode must align the next gallery image to the reading viewport top');
    await host.locator('#reader-auto-mode').selectOption('smooth');
    await host.locator('#reader-auto-speed').fill('120');
    await host.locator('#reader-auto-speed').press('Tab');
    await page.screenshot({ path: 'test-results/reader-auto-settings.png' });
    const autoBox = await autoSettings.locator('.reader-settings').boundingBox();
    assert.ok(autoBox.x >= 0 && autoBox.x + autoBox.width <= 390 && autoBox.y + autoBox.height <= 844);
    await autoSettings.locator('summary').click();
    const smoothStart = await host.locator('#reader-scroll').evaluate(el => el.scrollTop);
    await auto.click();
    await page.waitForFunction(start => document.querySelector('#eh-continuous-reader').shadowRoot.getElementById('reader-scroll').scrollTop > start + 5, smoothStart);
    assert.ok(await host.locator('#reader-scroll').evaluate(el => el.scrollTop) - smoothStart < 100, 'Smooth mode must advance gradually');
    await host.locator('#reader-scroll').dispatchEvent('wheel');
    assert.equal(await auto.getAttribute('aria-pressed'), 'false');
    const pausedTop = await host.locator('#reader-scroll').evaluate(el => el.scrollTop);
    await page.waitForTimeout(150);
    assert.equal(await host.locator('#reader-scroll').evaluate(el => el.scrollTop), pausedTop);
    await autoSettings.locator('summary').click();
    await host.locator('#reader-auto-speed').fill('40'); await host.locator('#reader-auto-speed').press('Tab');
    await autoSettings.locator('summary').click();
    await auto.click();
    const lowSpeed = await sampleMotion(host.locator('#reader-scroll'));
    assert.equal(lowSpeed.stationary, 0, 'Low-speed scrolling must move visually on every frame');
    assert.equal(lowSpeed.backwards, 0, 'Smooth scrolling must not jump backwards');
    assert.ok(Math.abs(lowSpeed.distance - lowSpeed.seconds * 40) < 2, 'Pixel speed must remain accurate');
    await auto.click();
    assert.equal(await host.locator('#reader-pages').evaluate(el => el.style.transform), '', 'Pausing must clear the visual offset');
    await autoSettings.locator('summary').click();
    await host.locator('#reader-auto-speed-unit').selectOption('seconds');
    assert.equal(await host.locator('#reader-auto-speed').isVisible(), false);
    await host.locator('#reader-auto-page-seconds').fill('3'); await host.locator('#reader-auto-page-seconds').press('Tab');
    await page.screenshot({ path: 'test-results/reader-seconds-per-page.png' });
    await autoSettings.locator('summary').click();
    await auto.click();
    const secondsPerPage = await sampleMotion(host.locator('#reader-scroll'));
    assert.ok(Math.abs(secondsPerPage.distance - secondsPerPage.height * secondsPerPage.seconds / 3) < 2, 'Seconds/page must use the reading viewport height');
    await page.setViewportSize({ width: 390, height: 700 }); await page.waitForTimeout(100);
    const resizedPace = await sampleMotion(host.locator('#reader-scroll'));
    assert.ok(Math.abs(resizedPace.distance - resizedPace.height * resizedPace.seconds / 3) < 2, 'Seconds/page must adapt after resizing');
    await host.locator('#reader-scroll').dispatchEvent('wheel');
    await page.setViewportSize({ width: 390, height: 844 });
    await auto.click();
    await host.locator('#reader-scroll').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await auto.getAttribute('aria-pressed'), 'false');
    await host.locator('#reader-scroll').evaluate(scroll => { scroll.scrollTop=0; });
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="1"]')?.dataset.state==='loaded');
    await host.locator('#reader-scroll').focus();
    for(let attempt=0;attempt<5;attempt++) {
      await page.keyboard.press('End');
      await page.waitForTimeout(180);
      if(await host.locator('[data-page="22"][data-state=loaded]').count()) break;
    }
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="22"]')?.dataset.state==='loaded');
    assert.equal(await host.getAttribute('data-last'),'22');
    await auto.click();
    await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.getElementById('reader-auto-toggle').getAttribute('aria-pressed') === 'false');
    assert.ok(metadata.every(index=>index>=1&&index<=22), 'Requested past a gallery boundary');
    await host.locator('#reader-close').click();
    const count = metadata.length;
    await page.waitForTimeout(80);
    assert.equal(metadata.length, count);
    assert.equal(await page.locator('#img').getAttribute('src'), 'https://reader-images.invalid/6.svg');
    await host.locator('#reader-start').click();
    assert.equal(await host.locator('#reader-width').inputValue(), '700');
    assert.equal(await host.locator('#reader-auto-mode').inputValue(), 'smooth');
    assert.equal(await host.locator('#reader-auto-speed').inputValue(), '40');
    assert.equal(await host.locator('#reader-auto-speed-unit').inputValue(), 'seconds');
    assert.equal(await host.locator('#reader-auto-page-seconds').inputValue(), '3');
    assert.equal(await auto.getAttribute('aria-pressed'), 'false');
    await context.close();
  }

  for (const mode of ['page', 'smooth']) {
    const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
    await context.addInitScript(mode => localStorage.setItem('eh-search-tool:ui:v1', JSON.stringify({ reader: { ahead: 2, behind: 1, autoLoop: true, autoMode: mode, autoInterval: 1, autoSpeed: 1000 } })), mode);
    const page = await context.newPage(), origin = 'https://e-hentai.org', metadata = [], images = [];
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await context.route(origin + '/s/**', route => {
      const index = Number(new URL(route.request().url()).pathname.split('-').at(-1)); metadata.push(index);
      return route.fulfill({ contentType: 'text/html', body: html(index, origin, false, 6) });
    });
    await context.route('https://reader-images.invalid/**', route => {
      images.push(Number(route.request().url().match(/\/(\d+)\.svg$/)[1]));
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="100%" height="100%" fill="#dae7d4"/></svg>' });
    });
    try {
      await page.goto(source(6, origin)); await page.addScriptTag({ content: script });
      const host = page.locator('#eh-continuous-reader'), auto = host.locator('#reader-auto-toggle'), scroll = host.locator('#reader-scroll');
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="5"]')?.dataset.state === 'loaded');
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').dataset.first === '5');
      await page.waitForTimeout(150);
      assert.deepEqual([...new Set(metadata)].sort((a, b) => a - b), [1, 2, 5, 6], 'Tail and head must share the configured cache budget');
      assert.deepEqual([...new Set(images)].sort((a, b) => a - b), [1, 2, 5, 6]);
      assert.deepEqual(await host.locator('figure').evaluateAll(elements => elements.map(el => Number(el.dataset.page))), [5, 6], 'Cached head images must not disturb the visible tail');
      await page.evaluate(() => {
        const root = document.querySelector('#eh-continuous-reader').shadowRoot;
        new MutationObserver(() => {
          const status = root.getElementById('reader-status').textContent;
          if (status.includes('等待循环') && !window.loopWaitStarted) window.loopWaitStarted = performance.now();
          if (status === '已循环回首图。' && !window.loopCapture) {
            const first = root.querySelector('[data-page="1"]');
            window.loopCapture = { elapsed: performance.now() - window.loopWaitStarted, offset: first.getBoundingClientRect().top - root.getElementById('reader-scroll').getBoundingClientRect().top, running: root.getElementById('reader-auto-toggle').getAttribute('aria-pressed') };
          }
        }).observe(root.getElementById('reader-status'), { childList: true });
      });
      await auto.click();
      await page.waitForFunction(() => window.loopWaitStarted > 0);
      const waitingTop = await scroll.evaluate(el => el.scrollTop);
      await page.waitForTimeout(350);
      assert.equal(await scroll.evaluate(el => el.scrollTop), waitingTop, 'Both modes must wait at the end before looping');
      if (mode === 'page') {
        await scroll.dispatchEvent('wheel'); await page.waitForTimeout(800);
        assert.equal(await page.evaluate(() => !!window.loopCapture), false, 'Pausing must cancel a pending loop');
        await page.evaluate(() => { window.loopWaitStarted = 0; }); await auto.click();
      }
      await page.waitForFunction(() => !!window.loopCapture);
      const capture = await page.evaluate(() => window.loopCapture);
      assert.ok(capture.elapsed >= 950, 'Looping must honor the configured one-second interval');
      assert.ok(Math.abs(capture.offset) < 1, 'Looping must align the first image at the top');
      assert.equal(capture.running, 'true');
      await scroll.dispatchEvent('wheel');
      await host.locator('[data-section="reader-settings"] > summary').click();
      assert.equal(await host.locator('#reader-auto-loop').isChecked(), true);
      await host.locator('#reader-auto-loop').uncheck();
      await host.locator('#reader-close').click(); await host.locator('#reader-start').click();
      assert.equal(await host.locator('#reader-auto-loop').isChecked(), false);
      assert.equal(await host.locator('#reader-auto-toggle').getAttribute('aria-pressed'), 'false');
      await page.setViewportSize({ width: 390, height: 844 });
      await host.locator('[data-section="reader-settings"] > summary').evaluate(el => { el.parentElement.open = true; });
      await page.screenshot({ path: 'test-results/reader-unified-settings-' + mode + '.png' });
    } finally { await context.close(); }
  }

  // Image paging must wait for its next image and align even a short final image.
  {
    const context = await browser.newContext({ viewport: { width: 800, height: 700 } });
    await context.addInitScript(() => localStorage.setItem('eh-search-tool:ui:v1', JSON.stringify({ reader: { ahead: 0, behind: 0, autoInterval: 1, scale: 50 } })));
    const page = await context.newPage(), origin = 'https://e-hentai.org', heights = [0, 1600, 400, 200];
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await context.route(origin + '/s/**', async route => {
      const index = Number(new URL(route.request().url()).pathname.split('-').at(-1));
      if (index === 2) await held;
      await route.fulfill({ contentType: 'text/html', body: html(index, origin, false, 3).replace('height="1200"', 'height="' + heights[index] + '"') });
    });
    await context.route('https://reader-images.invalid/**', route => {
      const index = Number(route.request().url().match(/\/(\d+)\.svg$/)[1]);
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="' + heights[index] + '"><rect width="100%" height="100%" fill="#dae7d4"/><text x="50%" y="50%" font-size="70">' + index + '</text></svg>' });
    });
    try {
      await page.goto(source(1, origin)); await page.addScriptTag({ content: script });
      const host = page.locator('#eh-continuous-reader'), scroll = host.locator('#reader-scroll');
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="1"]')?.dataset.state === 'loaded');
      const start = await scroll.evaluate(el => el.scrollTop);
      await host.locator('#reader-auto-toggle').click();
      await page.waitForTimeout(1200);
      assert.equal(await scroll.evaluate(el => el.scrollTop), start, 'Image paging must wait rather than jump into the pending next image');
      release();
      for (const index of [2, 3]) {
        await page.waitForFunction(index => {
          const root = document.querySelector('#eh-continuous-reader').shadowRoot, image = root.querySelector('[data-page="' + index + '"]');
          return image?.dataset.state === 'loaded' && Math.abs(image.getBoundingClientRect().top - root.getElementById('reader-scroll').getBoundingClientRect().top) < 1;
        }, index);
      }
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.getElementById('reader-auto-toggle').getAttribute('aria-pressed') === 'false');
      await page.screenshot({ path: 'test-results/reader-image-paging-final.png' });
      await host.locator('[data-section="reader-settings"] > summary').click();
      await host.locator('#reader-scale').fill('200'); await host.locator('#reader-scale').press('Tab');
      const finalTop = await host.locator('[data-page="3"]').evaluate(el => el.getBoundingClientRect().top - el.getRootNode().getElementById('reader-scroll').getBoundingClientRect().top);
      assert.ok(Math.abs(finalTop) < 1, 'Scaling an aligned final image must retain top alignment');
      await page.screenshot({ path: 'test-results/reader-scale-settings.png' });
      await host.locator('#reader-close').click(); await host.locator('#reader-start').click();
      assert.equal(await host.locator('#reader-scale').inputValue(), '200');
    } finally { release(); await context.close(); }
  }

  // No manual preloading: wait at an unloaded/failed image, then continue after retry.
  {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await context.addInitScript(() => localStorage.setItem('eh-search-tool:ui:v1', JSON.stringify({ reader: { ahead: 0, behind: 0, imageRetries: 0, autoMode: 'smooth', autoSpeed: 1000 } })));
    const page = await context.newPage(), origin = 'https://e-hentai.org';
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    let release, secondAttempts = 0;
    const held = new Promise(resolve => { release = resolve; });
    await context.route(origin + '/s/**', route => {
      const index = Number(new URL(route.request().url()).pathname.split('-').at(-1));
      requests.push(index);
      return route.fulfill({ contentType: 'text/html', body: html(index, origin, false, 3) });
    });
    await context.route('https://reader-images.invalid/**', async route => {
      if (route.request().url().endsWith('/2.svg') && secondAttempts++ === 0) {
        await held; await route.fulfill({ status: 503 }); return;
      }
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="100%" height="100%" fill="#dae7d4"/></svg>' });
    });
    try {
      await page.goto(source(1, origin)); await page.addScriptTag({ content: script });
      const host = page.locator('#eh-continuous-reader'), scroll = host.locator('#reader-scroll'), auto = host.locator('#reader-auto-toggle');
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="1"]')?.dataset.state === 'loaded');
      assert.deepEqual(requests, [1]);
      await auto.click();
      await page.waitForFunction(() => {
        const root = document.querySelector('#eh-continuous-reader').shadowRoot;
        return Math.abs(root.querySelector('[data-page="1"]').getBoundingClientRect().bottom - root.getElementById('reader-scroll').getBoundingClientRect().bottom) < 1;
      });
      const waitingTop = await scroll.evaluate(el => el.scrollTop);
      await page.waitForTimeout(150);
      assert.equal(await scroll.evaluate(el => el.scrollTop), waitingTop, 'Must wait for the next image');
      release();
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="2"]')?.dataset.state === 'error');
      await page.waitForTimeout(150);
      assert.equal(await scroll.evaluate(el => el.scrollTop), waitingTop, 'Must not skip a failed image');
      assert.equal(await auto.getAttribute('aria-pressed'), 'true');
      await host.locator('[data-page="2"] button').evaluate(button => button.click());
      await page.waitForFunction(top => document.querySelector('#eh-continuous-reader').shadowRoot.getElementById('reader-scroll').scrollTop > top + 10, waitingTop);
      await page.waitForFunction(() => document.querySelector('#eh-continuous-reader').shadowRoot.getElementById('reader-auto-toggle').getAttribute('aria-pressed') === 'false');
      assert.ok(await host.locator('[data-page="3"][data-state="loaded"]').count());
      assert.ok(requests.every(index => index >= 1 && index <= 3));
    } finally { release(); await context.close(); }
  }

  for(const mode of ['loaded','pending','automatic','manual','configured']) {
    const context=await browser.newContext({viewport:{width:1000,height:900}});
    await context.addInitScript(({mode})=>{
      localStorage.setItem('eh-search-tool:ui:v1',JSON.stringify({reader:{ahead:0,behind:0,imageRetries:mode==='manual'?0:mode==='configured'?2:1,retryInterval:mode==='configured'?1:0}}));
    },{mode});
    const page=await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    const origin='https://e-hentai.org', imageRequests=[], pageRequests=[], aborted=[], retryTimes=[];
    let release;
    const pending=new Promise(resolve=>{release=resolve;});
    page.on('requestfailed',request=>aborted.push(request.url()));
    await context.route(origin+'/s/**',async route=>{
      const url=new URL(route.request().url()); pageRequests.push(url.href);
      if(route.request().resourceType()==='fetch')retryTimes.push(Date.now());
      const replacement=url.searchParams.has('nl');
      assert.ok(!replacement || ['source-1','source-2'].includes(url.searchParams.get('nl')));
      let body=html(1,origin).replace('https://reader-images.invalid/1.svg',replacement?(url.searchParams.get('nl')==='source-2'?'https://reader-images.invalid/backup.svg':'https://reader-images.invalid/healthy.svg'):'https://reader-images.invalid/original.svg');
      body+='<a id="loadfail" onclick="return nl(\''+(replacement?'source-2':'source-1')+'\')">Reload</a>';
      await route.fulfill({contentType:'text/html',body});
    });
    await context.route('https://reader-images.invalid/**',async route=>{
      const url=route.request().url(); imageRequests.push(url);
      if(url.endsWith('/original.svg') && ['automatic','manual','configured'].includes(mode)){await route.abort('connectionclosed');return;}
      if(url.endsWith('/healthy.svg') && mode==='configured'){await route.abort('connectionclosed');return;}
      if(url.endsWith('/original.svg') && mode==='pending')await pending;
      await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#d4dfe7"/></svg>'});
    });
    await page.goto(source(1,origin),{waitUntil:mode==='pending'?'domcontentloaded':'load'});
    await page.evaluate(()=>{window.originalReaderImage=document.getElementById('img');window.originalReaderImage.style.cssText='width:800px;height:1200px;';});
    await page.addScriptTag({content:script});
    const host=page.locator('#eh-continuous-reader');
    let waitingAt;
    if(mode==='configured'){
      await page.waitForFunction(()=>document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="1"]')?.dataset.state==='retry-wait');
      waitingAt=Date.now();assert.equal(pageRequests.length,1);
    }
    if(mode==='pending'){
      await page.waitForFunction(()=>document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="1"]')?.dataset.state==='loading');
      await page.waitForTimeout(80);
      assert.equal(imageRequests.length,1,'Opening the reader restarted a pending first-image request');
      assert.equal(aborted.length,0,'Opening the reader cancelled the native request');
      release();
    }
    if(mode==='manual'){
      await host.locator('[data-page="1"] button').waitFor();
      assert.equal(pageRequests.length,1);
      await host.locator('[data-page="1"] button').click();
    }
    await page.waitForFunction(()=>document.querySelector('#eh-continuous-reader').shadowRoot.querySelector('[data-page="1"]')?.dataset.state==='loaded');
    if(['loaded','pending'].includes(mode)){
      assert.equal(imageRequests.length,1,'The initial image was downloaded twice');
      assert.equal(pageRequests.length,1);
      assert.ok(await host.locator('[data-page="1"] img').evaluate(image=>image===window.originalReaderImage));
    }else if(mode==='configured'){
      assert.equal(pageRequests.length,3);
      assert.ok(retryTimes[0]-waitingAt>=900);assert.ok(retryTimes[1]-retryTimes[0]>=950);
      assert.equal(new URL(pageRequests[2]).searchParams.get('nl'),'source-2');
      assert.deepEqual(imageRequests,['https://reader-images.invalid/original.svg','https://reader-images.invalid/healthy.svg','https://reader-images.invalid/backup.svg']);
      await host.locator('[data-section="reader-settings"] > summary').click();
      assert.equal(await host.locator('#reader-retries').inputValue(),'2');assert.equal(await host.locator('#reader-retry-interval').inputValue(),'1');
      await host.locator('#reader-retries').fill('4');await host.locator('#reader-retries').press('Tab');
      await host.locator('#reader-retry-interval').fill('2');await host.locator('#reader-retry-interval').press('Tab');
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'test-results/retry-settings.png'});
      const box=await host.locator('[data-section="reader-settings"] .reader-settings').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);
    }else{
      assert.equal(pageRequests.length,2);
      assert.equal(new URL(pageRequests[1]).searchParams.get('nl'),'source-1');
      assert.deepEqual(imageRequests,['https://reader-images.invalid/original.svg','https://reader-images.invalid/healthy.svg']);
    }
    await host.locator('#reader-close').click();
    assert.equal(await page.locator('#img').evaluate(img=>img===window.originalReaderImage),true);
    assert.equal(await page.locator('#img').evaluate(img=>img.style.width),'800px');
    if(mode==='configured'){
      await host.locator('#reader-start').click();
      assert.equal(await host.locator('#reader-retries').inputValue(),'4');assert.equal(await host.locator('#reader-retry-interval').inputValue(),'2');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Reader browser passed: unified settings, image and smooth loops with end delay and pause cancellation, shared head/tail cache budget, EH/EX image-top paging, scaling, per-frame smooth motion, speed units, retry and native restoration.');
} finally { await browser.close(); }
