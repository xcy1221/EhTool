const STORE = 'eh-search-tool:v1';
const SITE_THEME = location.hostname === 'exhentai.org' ? 'dark' : 'light';
const UI_STORE = 'eh-search-tool:ui:v1';
const READER_DEFAULTS = Object.freeze({ enabled: true, ahead: 5, behind: 3, concurrency: 2, imageRetries: 1, retryInterval: 3, timeout: 15000, maxWidth: 1100, gap: 8 });

function readStore(key, fallback) {
  try {
    return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch { return fallback; }
}
function writeStore(key, value) {
  if (typeof GM_setValue === 'function') GM_setValue(key, value);
  else localStorage.setItem(key, JSON.stringify(value));
}
function boundedNumber(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function readUI() {
  const raw = readStore(UI_STORE, {});
  const reader = raw?.reader;
  return {
    theme: ['light', 'dark'].includes(raw?.theme) ? raw.theme : SITE_THEME,
    sections: raw?.sections && typeof raw.sections === 'object' ? raw.sections : {},
    comments: { enabled: raw?.comments?.enabled !== false, collapsed: raw?.comments?.collapsed === true },
    reader: {
      ...READER_DEFAULTS,
      enabled: reader?.enabled !== false,
      ahead: boundedNumber(reader?.ahead, READER_DEFAULTS.ahead, 0, 20),
      behind: boundedNumber(reader?.behind, READER_DEFAULTS.behind, 0, 20),
      concurrency: boundedNumber(reader?.concurrency, READER_DEFAULTS.concurrency, 1, 4),
      imageRetries: boundedNumber(reader?.imageRetries, READER_DEFAULTS.imageRetries, 0, 20),
      retryInterval: boundedNumber(reader?.retryInterval, READER_DEFAULTS.retryInterval, 0, 300),
      maxWidth: boundedNumber(reader?.maxWidth, READER_DEFAULTS.maxWidth, 320, 2400),
      gap: boundedNumber(reader?.gap, READER_DEFAULTS.gap, 0, 40),
    },
  };
}
function updateUI(patch) {
  const previous = readStore(UI_STORE, {});
  writeStore(UI_STORE, { ...previous, ...patch,
    sections: { ...previous?.sections, ...patch.sections },
    reader: { ...previous?.reader, ...patch.reader },
    comments: { ...previous?.comments, ...patch.comments },
  });
}
function setupSections(root, onError) {
  const saved = readUI().sections;
  root.querySelectorAll('details[data-section]').forEach(section => {
    const key = section.dataset.section;
    if (typeof saved[key] === 'boolean') section.open = saved[key];
    section.addEventListener('toggle', () => {
      if (!section.isConnected) return;
      if (readUI().sections[key] === section.open) return;
      try { updateUI({ sections: { [key]: section.open } }); }
      catch { onError?.('无法保存展开状态。'); }
    });
  });
}
function setupTheme(root, button, onError) {
  function apply(theme) {
    root.host.dataset.theme = theme;
    button.textContent = theme === 'dark' ? '浅色' : '深色';
    button.setAttribute('aria-label', theme === 'dark' ? '切换为浅色配色' : '切换为深色配色');
  }
  apply(readUI().theme);
  button.addEventListener('click', () => {
    const theme = root.host.dataset.theme === 'dark' ? 'light' : 'dark';
    try { updateUI({ theme }); apply(theme); }
    catch { onError?.('无法保存配色设置。'); }
  });
}
