const DICTIONARY = 'eh-search-tool:dictionary:v1';
const DICTIONARY_URL = 'https://raw.githubusercontent.com/EhTagTranslation/DatabaseReleases/master/db.text.json';
const galleryLinks = setupGalleryLinks();
const MODE_LABELS = { include: '必须包含', exclude: '排除此标签', or: '任一包含（OR）' };
const MODE_HINTS = { include: '绿色标签必须全部满足。', exclude: '含有任一红色标签的结果都会排除。', or: '蓝色标签至少满足一个，同时满足必须包含和排除条件。' };
const MODE_SWITCHES = { include: '改为包含', exclude: '改为排除', or: '改为 OR' };

function mount(input) {
  const form = input.form;
  if (!form || document.getElementById('eh-search-tool')) return;
  const host = document.createElement('div');
  host.id = 'eh-search-tool';
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.append(style);
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'eh工具');
  const launcher = document.createElement('button');
  launcher.type = 'button'; launcher.id = 'launcher'; launcher.textContent = 'eh工具';
  launcher.setAttribute('aria-label', '展开eh工具'); launcher.setAttribute('aria-expanded', 'false');
  root.append(launcher);
  panel.innerHTML = `
    <header><div><h2>eh工具</h2><p class="hint">组合条件，可填入或直接搜索</p></div>
      <div class="header-actions"><button id="theme" type="button">深色</button><button id="toggle" aria-expanded="true" aria-controls="body">收起</button></div></header>
    <div id="body">
      <details class="block" data-section="filters" open><summary>页数与评分筛选</summary><div class="block-content"><div class="native-filters">
        <fieldset><legend>页数范围</legend><div class="range"><label>最少页数<input id="page-min" type="text" inputmode="numeric" placeholder="不限" autocomplete="off"></label><span>—</span><label>最多页数<input id="page-max" type="text" inputmode="numeric" placeholder="不限" autocomplete="off"></label></div></fieldset>
        <label>最低评分<select id="rating"><option value="0">不限</option><option value="2">2 星</option><option value="3">3 星</option><option value="4">4 星</option><option value="5">5 星</option></select></label>
      </div>
      </div></details><details class="block" data-section="tags" open><summary>标签选择</summary><div class="block-content">
      <div class="tabs" role="group" aria-label="标签列表"><button data-view="recent" aria-pressed="false">历史标签</button><button data-view="all" aria-pressed="true">查找新标签</button></div>
      <div class="toolbar">
        <label class="grow">查找标签<input id="lookup" type="search" placeholder="中文、英文或 namespace:tag" autocomplete="off"></label>
        <label>分类<select id="namespace"><option value="">全部分类</option></select></label>
      </div>
      <div class="tag-purpose" role="group" aria-label="标签用途"><span>点击标签时：</span><button data-add-mode="include" aria-pressed="true">必须包含</button><button data-add-mode="exclude" aria-pressed="false">排除此标签</button><button data-add-mode="or" aria-pressed="false">任一包含（OR）</button></div>
      <p id="mode-hint" class="hint">${MODE_HINTS.include}</p>
      <div class="list-meta"><span id="count"></span><span>点击名称添加 · 再点取消</span></div>
      <div id="results" aria-label="可选标签"></div>
      <div class="more"><button id="more" hidden>显示更多</button></div>
      <details data-section="manual"><summary>手动添加标签</summary><div class="manual"><label class="grow">英文标签<input id="manual" placeholder="例如 artist:example artist"></label><label>用途<select id="manual-mode"><option value="include">必须包含</option><option value="exclude">排除此标签</option><option value="or">任一包含（OR）</option></select></label><button id="add-manual">添加</button></div><p class="hint">填写 namespace:tag；只写标签时，需要先选择分类。</p></details>
      </div></details><details class="block" data-section="selected" open><summary>已选条件 <span id="selection-summary">0 个标签</span></summary><div class="block-content"><div class="selection-title"><h3>已选标签 <span id="selected-count">0</span></h3><button id="clear">清空已选</button></div>
      <div id="selected"></div></div></details>
      <label class="keywords">关键词 / 其他搜索语法<input id="keywords" placeholder="可输入多个词，用空格分隔"></label>
      <div class="query-head"><label for="query">待填入的搜索语句</label><span id="length"></span></div>
      <textarea id="query" readonly rows="2" spellcheck="false"></textarea><p id="limits" class="hint error"></p>
      <div class="small-actions"><button id="read-native">读取原搜索栏</button><button id="restore-last" hidden>恢复上次组合</button></div>
      <details class="block" data-section="presets"><summary>保存常用组合</summary><div class="block-content">
        <div class="preset-row"><label class="grow">组合名称<input id="preset-name" maxlength="40" placeholder="给当前搜索起个名字"></label><button id="save-preset">保存组合</button></div>
        <div id="presets"></div>
      </div></details>
      <details class="block" data-section="settings"><summary>设置</summary><div class="block-content"><details data-section="site"><summary>站点行为</summary><label class="exact"><input id="gallery-new-tab" type="checkbox" checked> 点击画廊时在新标签页打开</label><label class="exact"><input id="gallery-focus" type="checkbox" checked> 打开画廊后切换到新标签页</label><p id="gallery-focus-hint" class="hint"></p></details>
      <details data-section="comments"><summary>评论区设置</summary><label class="exact"><input id="comments-enabled" type="checkbox"> 画廊详情页显示评论区收起按钮</label><label class="exact"><input id="comments-collapsed" type="checkbox"> 打开画廊时默认收起评论区</label><p class="hint">详情页可随时展开或收起；设置在下次打开画廊时生效。</p></details>
      <details data-section="dictionary"><summary>词库与高级设置</summary>
        <label class="exact"><input id="exact" type="checkbox" checked> 新添加的标签使用完整名称匹配</label>
        <div class="dictionary"><div><strong>中英文标签词库</strong><p id="dictionary-info" class="hint"></p></div><button id="update">加载 / 更新完整词库</button><label class="file-button">导入 JSON<input id="import" type="file" accept=".json,application/json"></label></div>
        <p class="hint">完整词库来自 EhTagTranslation，按需下载，仅保存标签名称。不显示描述或图片，可与 EhSyringe 一起使用。</p>
        <a href="https://github.com/EhTagTranslation/Database" target="_blank" rel="noopener noreferrer">词库来源及许可：EhTagTranslation · CC BY-NC-SA 3.0</a>
      </details>
      <details data-section="reading"><summary>连续阅读设置</summary><label class="exact"><input id="reader-enabled" type="checkbox"> 图片页启用连续阅读</label><div class="reading-options"><label>沿方向预加载<input id="reader-ahead" type="number" min="0" max="20"></label><label>反方向保留<input id="reader-behind" type="number" min="0" max="20"></label></div><div class="reading-options"><label>自动重试次数<input id="reader-retries" type="number" min="0" max="20"></label><label>重试间隔（秒）<input id="reader-retry-interval" type="number" min="0" max="300"></label></div><p class="hint">0 次关闭自动重试；修改后在下次打开图片页时生效。</p></details></div></details>
    </div><footer><div class="search-actions"><button id="fill" type="button">填入搜索栏</button><button class="primary" id="fill-search" type="button">填入并搜索</button></div><p class="hint">填入仅替换条件；填入并搜索立即执行。</p><p id="status" role="status" aria-live="polite"></p></footer>`;
  root.append(panel);
  setupSections(root, message => status(message, true));
  setupTheme(root, root.getElementById('theme'), message => status(message, true));
  const $ = id => root.getElementById(id);
  const raw = readStore(STORE, {});
  const prefs = {
    favorites: Array.isArray(raw?.favorites) ? raw.favorites.filter(x => typeof x === 'string').slice(0, 10000) : [],
    history: Array.isArray(raw?.history) ? raw.history.filter(x => normalizeTag(x)).slice(0, 500).map(x => ({ ...normalizeTag(x), mode: ['include', 'exclude', 'or'].includes(x.mode) ? x.mode : 'include', exact: x.exact !== false, lastUsed: Number(x.lastUsed) || 0 })) : [],
    presets: Array.isArray(raw?.presets) ? raw.presets.filter(x => x && typeof x.name === 'string' && typeof x.query === 'string').slice(0, 30) : [],
    collapsed: raw?.collapsed === true,
    custom: Array.isArray(raw?.custom) ? mergeTags(raw.custom).slice(0, 1000) : [],
    lastQuery: typeof raw?.lastQuery === 'string' ? raw.lastQuery.slice(0, 10000) : '',
    lastFilters: raw?.lastFilters && typeof raw.lastFilters === 'object' ? raw.lastFilters : null,
    lastRating: ['0', '2', '3', '4', '5'].includes(raw?.lastRating) ? raw.lastRating : null,
    galleryNewTabs: raw?.galleryNewTabs !== false,
    galleryFocus: raw?.galleryFocus !== false,
  };
  let cached = readStore(DICTIONARY, {});
  let tags = mergeTags(prefs.history, SEED_TAGS, Array.isArray(cached?.tags) ? cached.tags : [], prefs.custom);
  let state = parseQuery('');
  let view = prefs.history.length ? 'recent' : 'all';
  let pageSize = 60;
  let addMode = 'include';
  let busy = false;
  let initialized = false;
  function nativeField(name) { return form.querySelector(`[name="${name}"]`); }
  function openNativeAdvanced() {
    const marker = nativeField('advsearch');
    const pane = form.querySelector('#advdiv');
    const collapsed = pane && (pane.hidden || getComputedStyle(pane).display === 'none');
    if (marker?.value === '1' && !marker.disabled && !collapsed) return;
    // Use the native handler so it can create controls and update its own state.
    const toggle = form.querySelector('#adv_toggle, a#advsearch, button#advsearch, [onclick*="advsearch"], a[href*="advsearch"]')
      || [...form.querySelectorAll('a, button')].find(element => /show advanced options|显示高级|展开高级/i.test(element.textContent));
    toggle?.click();
  }
  function readNativeFilters() {
    const enabled = nativeField('f_sr');
    return { min: nativeField('f_spf')?.value || '', max: nativeField('f_spt')?.value || '', rating: enabled?.type === 'checkbox' && !enabled.checked ? '0' : nativeField('f_srdd')?.value || '0' };
  }
  function currentFilters() { return { min: $('page-min').value.trim(), max: $('page-max').value.trim(), rating: $('rating').value }; }
  function setFilters(filters) {
    $('page-min').value = typeof filters?.min === 'string' ? filters.min : '';
    $('page-max').value = typeof filters?.max === 'string' ? filters.max : '';
    $('rating').value = ['0', '2', '3', '4', '5'].includes(filters?.rating) ? filters.rating : '0';
  }
  function filterError() {
    const { min, max } = currentFilters();
    for (const [value, name] of [[min, '最少页数'], [max, '最多页数']]) {
      if (value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 9999)) return `${name}请填写 1–9999 的整数，留空表示不限。`;
    }
    return min && max && Number(min) > Number(max) ? '最少页数不能大于最多页数。' : '';
  }
  function saveDraft() {
    prefs.lastQuery = buildQuery(state.base, state.selected);
    prefs.lastFilters = currentFilters();
    return persist();
  }

  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  function persist() {
    try { writeStore(STORE, prefs); return true; }
    catch { status('无法保存设置，请检查脚本管理器的存储权限。', true); return false; }
  }
  function button(text, label, action, className = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.setAttribute('aria-label', label);
    element.className = className;
    element.addEventListener('click', action);
    return element;
  }
  function displayName(tag) { return tags.find(item => tagKey(item) === tagKey(tag))?.name || tag.name || tag.tag; }
  function renderQuery() {
    const query = buildQuery(state.base, state.selected);
    $('query').value = query;
    $('length').textContent = `${query.length} / 200 字符`;
    $('length').classList.toggle('error', query.length > 200);
    $('fill').disabled = query.length > 200 || !!filterError();
    $('fill-search').disabled = $('fill').disabled;
    if (initialized) saveDraft();
    $('restore-last').hidden = !prefs.lastQuery && !prefs.lastFilters;
    const includes = state.selected.filter(tag => tag.mode !== 'exclude').length;
    const excludes = state.selected.length - includes;
    $('limits').textContent = filterError() || (query.length > 200 ? '搜索语句超过 200 字符，请减少条件。' : includes > 5 || excludes > 10 ? '原站最多支持 5 个包含 / 10 个排除条件，请减少标签。' : '');
  }
  function remember(item) {
    const key = tagKey(item);
    const known = tags.find(tag => tagKey(tag) === key);
    prefs.history = [{ ...normalizeTag(known || item), mode: item.mode, exact: item.exact, lastUsed: Date.now() }, ...prefs.history.filter(tag => tagKey(tag) !== key)].slice(0, 500);
  }
  function renderSelected() {
    $('selected').replaceChildren();
    $('selected-count').textContent = state.selected.length;
    $('selection-summary').textContent = state.selected.length + ' 个标签';
    if (!state.selected.length) {
      const empty = document.createElement('p');
      empty.className = 'empty'; empty.textContent = '还没有选择标签。从上方列表开始。';
      $('selected').append(empty);
    }
    const groups = new Map();
    for (const [mode, title, hint] of [['include', '必须包含', MODE_HINTS.include], ['exclude', '排除标签', MODE_HINTS.exclude], ['or', MODE_LABELS.or, MODE_HINTS.or]]) {
      if (mode === 'or' && !state.selected.some(item => item.mode === mode)) continue;
      const group = document.createElement('div'); group.className = `selected-group ${mode}`; group.dataset.mode = mode;
      const heading = document.createElement('strong'); heading.textContent = title;
      const help = document.createElement('p'); help.className = 'hint'; help.textContent = hint;
      group.append(heading, help); $('selected').append(group); groups.set(mode, group);
    }
    for (const item of state.selected) {
      const key = tagKey(item);
      const chip = document.createElement('div');
      chip.className = `chip ${item.mode}`;
      const name = document.createElement('span'); name.className = 'selected-name'; name.textContent = displayName(item);
      chip.append(name);
      for (const mode of Object.keys(MODE_LABELS)) {
        if (mode === item.mode) continue;
        chip.append(button(MODE_SWITCHES[mode], `将 ${key} ${MODE_SWITCHES[mode]}`, () => {
          item.mode = mode;
          remember(item); persist(); renderSelected(); renderResults();
        }, `switch-mode to-${mode}`));
      }
      chip.append(button('×', `移除 ${key}`, () => {
        state.selected = state.selected.filter(tag => tagKey(tag) !== key);
        renderSelected(); renderResults();
      }));
      chip.title = serializeTag(item);
      groups.get(item.mode).append(chip);
    }
    renderQuery();
  }
  function add(tag, mode = 'include') {
    const key = tagKey(tag);
    const previous = state.selected.find(selected => tagKey(selected) === key);
    const item = { ...tag, mode, exact: previous?.exact ?? $('exact').checked };
    const existing = state.selected.findIndex(selected => tagKey(selected) === key);
    if (existing >= 0) state.selected[existing] = item; else state.selected.push(item);
    remember(item);
    const saved = persist();
    renderSelected(); renderResults();
    if (saved) status(`${MODE_LABELS[mode]}：${tag.name || tag.tag}`);
  }
  function renderResults() {
    const results = searchTags(tags, $('lookup').value, $('namespace').value, [], view, prefs.history.map(tagKey));
    $('count').textContent = `${results.length} 个标签`;
    $('results').replaceChildren();
    $('more').hidden = results.length <= pageSize;
    if (!results.length) {
      const empty = document.createElement('p'); empty.className = 'empty';
      empty.textContent = view === 'recent' ? '还没有历史。到“查找新标签”选择，用过的标签会保存在这里。' : '没有匹配项。可加载完整词库，或手动添加英文标签。';
      $('results').append(empty);
    }
    const selected = new Map(state.selected.map(item => [tagKey(item), item.mode]));
    for (const tag of results.slice(0, pageSize)) {
      const key = tagKey(tag);
      const row = button(tag.name, `${MODE_LABELS[addMode]} ${key}`, () => {
        if (selected.get(key) === addMode) { state.selected = state.selected.filter(item => tagKey(item) !== key); renderSelected(); renderResults(); }
        else add(tag, addMode);
      }, `tag-row ${selected.get(key) || ''}`);
      row.title = `${NAMESPACES[tag.namespace]}：${tag.name}`;
      row.setAttribute('aria-pressed', String(selected.has(key)));
      $('results').append(row);
    }
  }
  function renderPresets() {
    $('presets').replaceChildren();
    for (const preset of prefs.presets) {
      const row = document.createElement('div'); row.className = 'preset';
      row.append(button(preset.name, `载入组合 ${preset.name}`, () => {
        state = parseQuery(preset.query); $('keywords').value = state.base;
        if (preset.filters) setFilters(preset.filters);
        renderSelected(); renderResults(); status(`已载入：${preset.name}`);
      }), button('×', `删除组合 ${preset.name}`, () => {
        prefs.presets = prefs.presets.filter(item => item !== preset); persist(); renderPresets();
      }));
      $('presets').append(row);
    }
  }
  function renderDictionary() {
    const date = cached?.updatedAt ? new Date(cached.updatedAt).toLocaleDateString('zh-CN') : '';
    $('dictionary-info').textContent = cached?.tags?.length ? `${tags.length} 个标签 · ${cached.source === 'import' ? '本地导入' : 'EhTagTranslation'} · ${date}` : '内置基础标签。加载完整词库后可搜索更多分类。';
  }
  function installDictionary(data, source) {
    const next = { tags: parseDictionary(data), updatedAt: Date.now(), source };
    writeStore(DICTIONARY, next); // Keep the previous dictionary if validation or storage fails.
    cached = next; tags = mergeTags(prefs.history, SEED_TAGS, next.tags, prefs.custom);
    renderDictionary(); renderSelected(); renderResults();
    status(`词库已更新：${tags.length} 个标签。`);
  }
  function setBusy(value) { busy = value; $('update').disabled = value; $('import').disabled = value; }
  $('update').addEventListener('click', () => {
    if (busy) return;
    if (typeof GM_xmlhttpRequest !== 'function') { status('本地演示不联网。安装到 Tampermonkey 后可加载词库，也可导入 JSON。', true); return; }
    setBusy(true); status('正在下载词库…');
    const fail = message => { setBusy(false); status(`${message} 现有词库仍可使用，也可导入 JSON。`, true); };
    try {
      GM_xmlhttpRequest({
        method: 'GET', url: DICTIONARY_URL, anonymous: true, timeout: 30000,
        onload(response) {
          if (response.status !== 200) { fail(`下载失败（HTTP ${response.status}）。`); return; }
          try { installDictionary(JSON.parse(response.responseText), 'remote'); }
          catch { fail('词库格式不正确或无法保存。'); }
          finally { setBusy(false); }
        },
        onerror: () => fail('网络连接失败。'), ontimeout: () => fail('下载超时。'), onabort: () => fail('下载已取消。'),
      });
    } catch { fail('无法发起下载，请检查脚本权限。'); }
  });
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || busy) return;
    setBusy(true);
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('文件过大，最多支持 12 MB。');
      installDictionary(JSON.parse(await file.text()), 'import');
    } catch (error) { status(`导入失败：${error.message}`, true); }
    finally { event.target.value = ''; setBusy(false); }
  });
  $('add-manual').addEventListener('click', () => {
    const value = $('manual').value.trim();
    const colon = value.indexOf(':');
    const tag = normalizeTag({ namespace: colon >= 0 ? value.slice(0, colon).toLowerCase() : $('namespace').value, tag: colon >= 0 ? value.slice(colon + 1) : value });
    if (!tag) { status('请填写有效的 namespace:tag，标签中不能含双引号、$ 或额外的冒号。', true); return; }
    if (prefs.custom.length >= 1000 && !prefs.custom.some(item => tagKey(item) === tagKey(tag))) { status('手动标签最多保存 1000 个。', true); return; }
    const known = tags.find(item => tagKey(item) === tagKey(tag)) || tag;
    prefs.custom = mergeTags(prefs.custom, [known]);
    tags = mergeTags(tags, [known]); add(known, $('manual-mode').value); $('manual').value = '';
  });
  $('manual').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('add-manual').click(); } });
  $('lookup').addEventListener('input', () => { pageSize = 60; renderResults(); });
  $('lookup').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault(); root.querySelector('.tag-row')?.click();
    }
    if (event.key === 'Escape') { $('lookup').value = ''; renderResults(); }
  });
  $('namespace').addEventListener('change', () => { pageSize = 60; renderResults(); });
  $('more').addEventListener('click', () => { pageSize += 60; renderResults(); });
  root.querySelectorAll('[data-add-mode]').forEach(button => button.addEventListener('click', () => {
    addMode = button.dataset.addMode;
    root.querySelectorAll('[data-add-mode]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    $('mode-hint').textContent = MODE_HINTS[addMode];
    renderResults();
  }));
  $('gallery-new-tab').checked = prefs.galleryNewTabs;
  $('gallery-focus').checked = prefs.galleryFocus;
  function renderGalleryFocus() {
    const supported = typeof GM_openInTab === 'function';
    $('gallery-focus').disabled = !prefs.galleryNewTabs || !supported;
    $('gallery-focus-hint').textContent = supported ? '取消勾选后在后台打开画廊，继续浏览当前页面。' : '控制标签页切换需要 Tampermonkey 的 GM_openInTab 权限；本地演示沿用浏览器行为。';
  }
  renderGalleryFocus();
  const commentsPrefs = readUI().comments;
  $('comments-enabled').checked = commentsPrefs.enabled;
  $('comments-collapsed').checked = commentsPrefs.collapsed;
  $('comments-collapsed').disabled = !commentsPrefs.enabled;
  for (const [id, key] of [['comments-enabled', 'enabled'], ['comments-collapsed', 'collapsed']]) {
    $(id).addEventListener('change', () => {
      try {
        updateUI({ comments: { [key]: $(id).checked } });
        $('comments-collapsed').disabled = !$('comments-enabled').checked;
        status('评论区设置已保存，下次打开画廊时生效。');
      } catch {
        $(id).checked = readUI().comments[key];
        status('无法保存评论区设置。', true);
      }
    });
  }
  const readerPrefs = readUI().reader;
  $('reader-enabled').checked = readerPrefs.enabled;
  $('reader-enabled').addEventListener('change', () => {
    try { updateUI({ reader: { enabled: $('reader-enabled').checked } }); }
    catch { status('无法保存阅读设置。', true); }
  });
  for (const [id, key, max] of [['reader-ahead', 'ahead', 20], ['reader-behind', 'behind', 20], ['reader-retries', 'imageRetries', 20], ['reader-retry-interval', 'retryInterval', 300]]) {
    const control = $(id); control.value = readerPrefs[key];
    control.addEventListener('change', () => {
      const value = Number(control.value);
      if (control.value === '' || !Number.isInteger(value) || value < 0 || value > max) { control.value = readUI().reader[key]; status('请填写 0–' + max + ' 的整数。', true); return; }
      try { updateUI({ reader: { [key]: value } }); status('阅读设置已保存。'); }
      catch { status('无法保存阅读设置。', true); }
    });
  }
  $('gallery-new-tab').addEventListener('change', () => {
    prefs.galleryNewTabs = $('gallery-new-tab').checked;
    if (persist()) status(prefs.galleryNewTabs ? '画廊链接将默认在新标签页打开。' : '已恢复画廊链接原来的打开方式。');
    galleryLinks.setEnabled(prefs.galleryNewTabs);
    renderGalleryFocus();
  });
  $('gallery-focus').addEventListener('change', () => {
    prefs.galleryFocus = $('gallery-focus').checked;
    if (persist()) status(prefs.galleryFocus ? '打开画廊后将切换到新标签页。' : '画廊将在后台打开，保留当前页面。');
    galleryLinks.setFocus(prefs.galleryFocus);
  });
  root.querySelectorAll('[data-view]').forEach(tab => tab.addEventListener('click', () => {
    view = tab.dataset.view; pageSize = 60;
    root.querySelectorAll('[data-view]').forEach(other => other.setAttribute('aria-pressed', String(other === tab)));
    renderResults();
  }));
  $('clear').addEventListener('click', () => { state.selected = []; renderSelected(); renderResults(); });
  $('restore-last').addEventListener('click', () => {
    state = parseQuery(prefs.lastQuery); $('keywords').value = state.base;
    if (prefs.lastFilters) setFilters(prefs.lastFilters);
    renderSelected(); renderResults(); status('已恢复上次组合，可继续选择标签。');
  });
  $('read-native').addEventListener('click', () => {
    state = parseQuery(input.value); $('keywords').value = state.base;
    setFilters(readNativeFilters());
    for (const tag of state.selected) remember(tag);
    tags = mergeTags(prefs.history, tags);
    renderSelected(); renderResults(); status('已读取当前搜索条件，可在工具内修改。');
  });
  for (const id of ['page-min', 'page-max']) $(id).addEventListener('input', renderQuery);
  $('rating').addEventListener('change', () => {
    prefs.lastRating = $('rating').value;
    renderQuery();
  });
  $('keywords').addEventListener('input', () => { state.base = $('keywords').value; renderQuery(); });
  $('save-preset').addEventListener('click', () => {
    const name = $('preset-name').value.trim();
    if (!name) { status('请先填写组合名称。', true); $('preset-name').focus(); return; }
    if (!prefs.presets.some(item => item.name === name) && prefs.presets.length >= 30) { status('最多保存 30 个组合，请先删除一个。', true); return; }
    if (filterError()) { status(filterError(), true); return; }
    prefs.presets = [...prefs.presets.filter(item => item.name !== name), { name, query: buildQuery(state.base, state.selected), filters: currentFilters() }];
    if (persist()) status(`已保存：${name}`);
    renderPresets();
  });
  form.addEventListener('submit', () => {
      const submitted = parseQuery(input.value);
      for (const tag of submitted.selected) remember(tag);
      tags = mergeTags(prefs.history, tags);
      persist(); renderResults();
  });
  function fillNative(submit = false) {
    const query = buildQuery(state.base, state.selected);
    if (query.length > 200 || filterError()) { status(filterError() || '搜索语句超过 200 字符。', true); return; }
    // Only this explicit action writes to native controls; composing never does.
    const writeField = (name, value) => {
      let field = nativeField(name);
      if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = name; form.append(field); }
      field.disabled = false;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const filters = currentFilters();
    if (filters.min || filters.max || filters.rating !== '0') {
      openNativeAdvanced();
      writeField('advsearch', '1');
    }
    writeField('f_spf', filters.min); writeField('f_spt', filters.max);
    const ratingEnabled = nativeField('f_sr');
    if (ratingEnabled?.type === 'checkbox') {
      ratingEnabled.checked = filters.rating !== '0';
      ratingEnabled.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const rating = nativeField('f_srdd');
    const supportsNone = rating?.tagName !== 'SELECT' || [...rating.options].some(option => option.value === '0');
    if (filters.rating !== '0' || supportsNone) writeField('f_srdd', filters.rating);
    writeField('f_search', query);
    saveDraft();
    if (submit) {
      status('已填入，正在搜索…');
      const submitters = [...form.elements].filter(field => !field.disabled && ['submit', 'image'].includes(field.type));
      const submitter = submitters.find(field => field.name === 'f_apply') || submitters[0];
      if (submitter) form.requestSubmit(submitter);
      else form.requestSubmit();
      return;
    }
    status('已填入。点击原站搜索按钮执行搜索。');
    if (matchMedia('(max-width: 600px)').matches) { prefs.collapsed = true; collapse(); persist(); }
    input.focus({ preventScroll: true });
  }
  $('fill').addEventListener('click', () => fillNative());
  $('fill-search').addEventListener('click', () => fillNative(true));
  function collapse() {
    panel.hidden = prefs.collapsed;
    launcher.hidden = !prefs.collapsed;
    launcher.setAttribute('aria-expanded', String(!prefs.collapsed));
    $('toggle').setAttribute('aria-expanded', String(!prefs.collapsed));
  }
  $('toggle').addEventListener('click', () => { prefs.collapsed = !prefs.collapsed; collapse(); persist(); });
  launcher.addEventListener('click', () => { prefs.collapsed = false; collapse(); persist(); });
  for (const [key, name] of Object.entries(NAMESPACES)) {
    const option = document.createElement('option'); option.value = key; option.textContent = `${name} · ${key}`; $('namespace').append(option);
  }
  $('keywords').value = state.base;
  setFilters(readNativeFilters());
  if (prefs.lastRating !== null) $('rating').value = prefs.lastRating;
  root.querySelectorAll('[data-view]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.view === view)));
  collapse(); renderDictionary(); renderPresets(); renderSelected(); renderResults();
  initialized = true;
}

setupContinuousReader();
setupGalleryComments();

const searchInput = document.querySelector('input[name="f_search"]');
if (searchInput) mount(searchInput);
else {
  // Accommodate another script adding the search form after document-idle.
  const ownerDocument = document;
  const observer = new MutationObserver(() => {
    const input = ownerDocument.querySelector('input[name="f_search"]');
    if (input?.form) { mount(input); observer.disconnect(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  setTimeout(() => observer.disconnect(), 10000);
}
