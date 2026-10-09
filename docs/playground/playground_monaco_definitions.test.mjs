import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {definitionSource, sourcePosition, sourceChip, globalDefinition} from './playground_monaco_definitions.js';

test('actual Playground declarations navigate to the factory and YM2612 implementation', async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
  for (const [symbol, file] of [['useSoundChip', 'playground_runtime.js'], ['setBpm', 'playground_runtime.js'], ['setFrequency', 'ym2612synth.js']]) {
    const lines = declarations.split('\n');
    const line = lines.findIndex(text => new RegExp(`\\b${symbol}[<(]`).test(text));
    assert.ok(line >= 0);
    const target = definitionSource(declarations, {startLineNumber:line + 1, startColumn:lines[line].indexOf(symbol) + 1});
    assert.deepEqual(target, {file, symbol});
    const source = await readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    const position = sourcePosition(source, symbol);
    assert.match(source.split('\n')[position.lineNumber - 1], new RegExp(`\\b${symbol}\\s*[( :]`));
  }
});

test('global fallback finds setBpm and pg.setBpm without matching unrelated members', () => {
  const declarations='/** Tempo */\ndeclare function setBpm(bpm: number): void;';
  const library={uri:'file:///globals.d.ts',getValue:()=>declarations,getPositionAt:offset=>({lineNumber:2,column:offset-declarations.indexOf('\n')})};
  for(const code of ['setBpm(120)', 'pg.setBpm(120)', 'other.setBpm(120)']){
    const startColumn=code.indexOf('setBpm')+1;
    const model={getWordAtPosition:()=>({word:'setBpm',startColumn}),getLineContent:()=>code};
    const result=globalDefinition(model,{lineNumber:1,column:startColumn+2},new Map([['library',library]]));
    if(code.startsWith('other.'))assert.equal(result,null);
    else assert.deepEqual(result,{uri:library.uri,range:{startLineNumber:2,startColumn:18,endLineNumber:2,endColumn:24}});
  }
});

test('implementation lookup skips call sites and unsupported declarations', () => {
  const source = '// setFrequency()\nthis.setFrequency(0);\n  setFrequency(channel) {}';
  assert.deepEqual(sourcePosition(source, 'setFrequency'), {lineNumber:3, column:3});
  assert.equal(definitionSource('interface Unknown {\n  method(): void;\n}', {lineNumber:2, column:3}), null);
});

test('explicit instance chip overrides the selected Playground chip', () => {
  const code = 'const fm = await useSoundChip("ym2612");\nfm.setFrequency(0, 4, 553);';
  const editor = {
    getModel: () => ({getValue: () => code, getLineContent: line => code.split('\n')[line - 1]}),
    getPosition: () => ({lineNumber:2, column:10}),
  };
  assert.equal(sourceChip(editor, 'ym2608'), 'ym2612');
  assert.deepEqual(definitionSource('interface FMApi {\n  setFrequency(): void;\n}', {lineNumber:2, column:3}, 'ym2608'), {file:'opn_fm_synth.js', symbol:'setFrequency'});
});
