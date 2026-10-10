import { readFile, writeFile, mkdir } from 'node:fs/promises';
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const header = `// ==UserScript==
// @name         eh工具
// @namespace    https://github.com/xcy1221/EhTool
// @version      ${version}
// @description  左侧浮动eh工具：标签组合与搜索、评论区收起、明暗配色、画廊连续阅读
// @match        https://e-hentai.org/*
// @match        https://exhentai.org/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @homepageURL  https://github.com/xcy1221/EhTool
// @supportURL   https://github.com/xcy1221/EhTool/issues
// @updateURL    https://raw.githubusercontent.com/xcy1221/EhTool/main/dist/eh-search-tool.meta.js
// @downloadURL  https://raw.githubusercontent.com/xcy1221/EhTool/main/dist/eh-search-tool.user.js
// ==/UserScript==
`;
const [core, config, links, reader, comments, app, theme, css, readerCss, commentsCss] = await Promise.all(['src/core.js', 'src/config.js', 'src/gallery-links.js', 'src/reader.js', 'src/comments.js', 'src/app.js', 'src/theme.css', 'src/style.css', 'src/reader.css', 'src/comments.css'].map(path => readFile(path, 'utf8')));
await mkdir('dist', { recursive: true });
await writeFile('dist/eh-search-tool.user.js', `${header}\n(() => {\n'use strict';\n${core}\n${config}\n${links}\n${reader}\n${comments}\nconst STYLE = ${JSON.stringify(theme + '\n' + css)};\nconst READER_STYLE = ${JSON.stringify(theme + '\n' + readerCss)};\nconst COMMENTS_STYLE = ${JSON.stringify(theme + '\n' + commentsCss)};\n${app}\n})();\n`);
await writeFile('dist/eh-search-tool.meta.js', header);
console.log('Built userscript and update metadata (' + version + ')');
