import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
const script = await readFile('dist/eh-search-tool.user.js', 'utf8');
const search = '<style>body{font:16px system-ui;background:#eceee6}.itg{width:760px;margin:100px auto;background:#fff;border-collapse:collapse}.itg td{padding:22px;border-bottom:1px solid #ccc}@media(max-width:900px){.itg{width:90%}}</style><form><input name="f_search"></form><table class="itg"><tr id="gallery"><td id="cover">模拟画廊封面</td><td><a href="/g/123/abcdef/"><span class="glink">示例画廊：标签预览</span></a></td></tr><tr><td colspan="2">搜索结果区域</td></tr></table>';
const detail = '<h1 id="gn">示例画廊：标签预览</h1><div id="taglist"><div id="td_language:chinese">chinese</div><div id="td_artist:sample_artist">sample artist</div><div id="td_parody:original">original</div><div id="td_other:full_color">full color</div><div id="td_other:comic">comic</div></div>';
const errors = [];
try {
  await mkdir('test-results', { recursive: true });
  for (const site of ['e-hentai.org', 'exhentai.org']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    let requests = 0;
    await context.route('https://' + site + '/**', route => {
      if (new URL(route.request().url()).pathname.startsWith('/g/')) { requests++; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: detail }); }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: search });
    });
    const load = async () => { await page.goto('https://' + site + '/'); await page.addScriptTag({ content: script }); };
    await load();
    const tool = page.locator('#eh-search-tool'), preview = page.locator('#eh-gallery-hover');
    await page.locator('#cover').hover(); await page.waitForTimeout(300); await page.mouse.move(900, 400); await page.waitForTimeout(800);
    assert.equal(requests, 0, 'Brief hover must not request gallery details');
    await page.locator('#cover').hover();
    await preview.locator('[title="language:chinese"]').waitFor();
    assert.equal(requests, 1); assert.equal(await preview.locator('[title="language:chinese"]').textContent(), '中文');
    const list = await page.locator('.itg').boundingBox(), box = await preview.boundingBox();
    assert.ok(box.x >= list.x + list.width, 'Desktop preview should occupy right blank space');
    await page.mouse.move(box.x + 20, box.y + 80); assert.equal(await preview.isVisible(), true);
    await tool.locator('[data-section=settings] > summary').click(); await tool.locator('[data-section=hover] > summary').click();
    await tool.locator('[data-hover-group=artist]').uncheck(); await tool.locator('[data-hover-group=parody]').uncheck();
    assert.equal(await preview.locator('[title="artist:sample artist"]').count(), 0);
    await tool.locator('#hover-delay').fill('0.2'); await tool.locator('#hover-delay').press('Tab');
    await tool.locator('#toggle').click(); await page.locator('#cover').hover();
    await preview.locator('[title="other:full color"]').waitFor(); assert.equal(requests, 1, 'Same gallery should be cached');
    await page.screenshot({ path: `test-results/hover-${site}.png` });
    await load(); assert.equal(await tool.locator('#hover-delay').inputValue(), '0.2');
    assert.equal(await tool.locator('[data-hover-group=artist]').isChecked(), false);
    await page.locator('#cover').hover(); await preview.locator('.tag').first().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await preview.boundingBox();
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390 && mobile.y >= 0 && mobile.y + mobile.height <= 844);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `test-results/hover-mobile-${site}.png` });
    await preview.locator('#hover-close').click(); assert.equal(await preview.isVisible(), false);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Hover browser passed: EH/EX delay, cancellation, right blank space, filtering, cache, persistence and mobile layout.');
} finally { await browser.close(); }
