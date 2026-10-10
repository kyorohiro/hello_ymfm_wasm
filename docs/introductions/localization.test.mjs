import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, access} from 'node:fs/promises';
import {lessonText} from './introduction-locale.js';
import {lessonCode, ENVELOPE_DEFAULTS, WAVE_DEFAULTS, wavePreset} from './gameboy-lessons.js';
import {pulseCode, DEFAULT_PULSE} from './gameboy-pulse.js';

const pages = (await readdir(new URL('./',import.meta.url))).filter(name => name.endsWith('_ja.html'));
const sources = html => new Map([...html.matchAll(/<script type="text\/plain" id="([^"]+)">([\s\S]*?)<\/script>/g)].map(match => [match[1],match[2]]));
function tokens(source) {
  // These examples translate comments only. Retain all executable lines and literal values.
  return source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[ \t])\/\/[^\n]*/gm,'$1')
    .split('\n').map(line => line.trim()).filter(Boolean);
}

test('localized articles link to both languages and preserve every executable example', async () => {
  assert.equal(pages.length,23);
  for (const name of pages) {
    const englishName = name.replace('_ja.html','.html');
    const [en,ja] = await Promise.all([readFile(new URL(englishName,import.meta.url),'utf8'),readFile(new URL(name,import.meta.url),'utf8')]);
    assert.match(en,/<html lang="en">/);assert.match(ja,/<html lang="ja">/);
    for (const html of [en,ja]) {
      assert.ok(html.includes(`hreflang="en" href="./${englishName}"`));
      assert.ok(html.includes(`hreflang="ja" href="./${name}"`));
    }
    const enSources = sources(en), jaSources = sources(ja);
    assert.deepEqual([...enSources.keys()],[...jaSources.keys()],name);
    for (const [id,source] of enSources) assert.deepEqual(tokens(source),tokens(jaSources.get(id)),`${name}: ${id}`);
    const prose = en.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<nav class="language-nav"[\s\S]*?<\/nav>/g,'');
    assert.ok(!/[ぁ-んァ-ン一-龯]/.test(prose),`${englishName} still has Japanese prose`);
  }
});

test('local navigation and assets resolve, and Japanese chapter links remain Japanese', async () => {
  for (const relative of [...pages.flatMap(name => [name,name.replace('_ja.html','.html')]),'../index-ja.html','index-ja.html','../for-ai.html','../for-ai_ja.html']) {
    const url = new URL(relative,import.meta.url), html = await readFile(url,'utf8');
    for (const match of html.matchAll(/(?<![-\w])(?:href|src)="([^"]+)"/g)) {
      const path = match[1].split(/[?#]/)[0];
      if (!path || /^(?:https?:|data:|mailto:|\/\/)/.test(path)) continue;
      await access(new URL(path,url));
    }
    if (!relative.includes('_ja') && relative !== 'index-ja.html' && relative !== '../index-ja.html') continue;
    const withoutLanguage = html.replace(/<nav class="language-nav"[\s\S]*?<\/nav>|<link rel="alternate"[^>]*>/g,'');
    for (const match of withoutLanguage.matchAll(/href="\.\/(tetorica[^"?#]+\.html)"/g)) assert.ok(match[1].endsWith('_ja.html'),`${relative} links to ${match[1]}`);
  }
});

test('Game Boy messages and generated comments follow the document language without changing code', () => {
  const old = globalThis.document;
  try {
    const code = () => [pulseCode(DEFAULT_PULSE),lessonCode('envelope',ENVELOPE_DEFAULTS),lessonCode('wave',{...WAVE_DEFAULTS,samples:wavePreset('triangle')})];
    globalThis.document = {documentElement:{lang:'ja'}};
    assert.equal(lessonText('日本語','English'),'日本語');
    const ja = code();
    globalThis.document.documentElement.lang = 'en';
    assert.equal(lessonText('日本語','English'),'English');
    const en = code();
    en.forEach((source,i) => {
      assert.ok(!/[ぁ-んァ-ン一-龯]/.test(source));
      assert.deepEqual(tokens(source),tokens(ja[i]));
    });
  } finally {if (old === undefined) delete globalThis.document;else globalThis.document = old;}
});
