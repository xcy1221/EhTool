import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const core = vm.runInNewContext(`${readFileSync('src/core.js', 'utf8')}\n({ normalizeTag, tagKey, parseDictionary, mergeTags, parseQuery, serializeTag, buildQuery, searchTags, SEED_TAGS })`);
const plain = value => JSON.parse(JSON.stringify(value));

test('tag syntax: namespaced, exact, quoted, negative, OR', () => {
  const tag = { namespace: 'other', tag: 'full color' };
  assert.equal(core.serializeTag(tag), 'other:"full color$"');
  assert.equal(core.serializeTag({ ...tag, mode: 'exclude' }), '-other:"full color$"');
  assert.equal(core.serializeTag({ ...tag, mode: 'or', exact: false }), '~other:"full color"');
});
test('existing query preserves qualifiers, operators and non-exact tags', () => {
  const parsed = core.parseQuery('title:"hello world" l:chinese -other:"full color$" ~p:original$ uploader:someone');
  assert.equal(parsed.base, 'title:"hello world" uploader:someone');
  assert.equal(parsed.selected[0].exact, false);
  assert.equal(parsed.selected[1].mode, 'exclude');
  const output = core.buildQuery(parsed.base, parsed.selected);
  assert.equal(output, 'title:"hello world" uploader:someone language:chinese -other:"full color$" ~parody:original$');
  assert.deepEqual(plain(core.parseQuery(output)), plain(parsed));
});
test('both exact-quote spellings and incomplete quotes are handled', () => {
  assert.equal(core.parseQuery('other:"full color"$').selected[0].exact, true);
  assert.equal(core.parseQuery('title:"unfinished').base, 'title:"unfinished');
  const parsed = core.parseQuery('language:english$ -language:english$ weak:l:chinese$');
  assert.equal(parsed.selected.length, 1);
  assert.equal(parsed.base, '-language:english$ weak:l:chinese$');
});
test('dictionary imports accept custom arrays and upstream shape, ignoring descriptions', () => {
  const data = { data: [{ namespace: 'rows', data: {} }, { namespace: 'language', data: { chinese: { name: '中文', intro: '<img src=x>' } } }] };
  assert.deepEqual(plain(core.parseDictionary(data)), [{ namespace: 'language', tag: 'chinese', name: '中文', aliases: [] }]);
  assert.equal(core.parseDictionary([{ namespace: 'a', tag: 'example artist', name: '示例作者' }])[0].namespace, 'artist');
  assert.throws(() => core.parseDictionary({ data: [] }), /没有有效标签/);
  assert.equal(core.normalizeTag({ namespace: 'language', tag: 'english$ -foo' }), null);
  assert.equal(core.normalizeTag({ namespace: '__proto__', tag: 'x' }), null);
});
test('Chinese/English search, category, favorites and recency ordering', () => {
  const tags = core.mergeTags(core.SEED_TAGS, [{ namespace: 'artist', tag: 'example', name: '示例', aliases: ['test alias'] }]);
  assert.equal(core.searchTags(tags, '中文')[0].tag, 'chinese');
  assert.equal(core.searchTags(tags, 'language:english')[0].tag, 'english');
  assert.equal(core.searchTags(tags, 'test alias')[0].namespace, 'artist');
  assert.equal(core.searchTags(tags, '', 'language').every(x => x.namespace === 'language'), true);
  assert.equal(core.searchTags(tags, '', '', ['language:english'], 'favorites').length, 1);
  assert.equal(core.searchTags(tags, '', '', [], 'recent', ['language:english', 'language:chinese'])[0].tag, 'english');
});
