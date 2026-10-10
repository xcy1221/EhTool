import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('published update metadata matches the userscript, package version and stable install identity', () => {
  const script = readFileSync('dist/eh-search-tool.user.js', 'utf8');
  const metadata = readFileSync('dist/eh-search-tool.meta.js', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const header = script.match(/^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==\r?\n/m)?.[0];
  assert.equal(metadata, header);
  const field = name => metadata.split(/\r?\n/).find(line => line.startsWith('// @' + name + ' '))?.replace(/^\/\/ @\S+\s+/, '');
  assert.equal(field('name'), 'eh工具');
  assert.equal(field('namespace'), 'https://github.com/xcy1221/EhTool');
  assert.equal(field('version'), pkg.version);
  assert.equal(lock.version, pkg.version); assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(field('updateURL'), 'https://raw.githubusercontent.com/xcy1221/EhTool/main/dist/eh-search-tool.meta.js');
  assert.equal(field('downloadURL'), 'https://raw.githubusercontent.com/xcy1221/EhTool/main/dist/eh-search-tool.user.js');
});
