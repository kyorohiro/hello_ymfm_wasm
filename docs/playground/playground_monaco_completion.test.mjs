import test from 'node:test';
import assert from 'node:assert/strict';
import { registerMonacoCompletions } from './playground_monaco_completion.js';

let provider;
let files = [];
registerMonacoCompletions({ languages: {
  CompletionItemKind: {}, CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
  registerCompletionItemProvider(language, value) { if (language === 'javascript') provider = value; },
} }, { listVirtualFiles: () => files });

function complete(line) {
  const column = line.length + 1;
  const word = line.match(/\w*$/)[0];
  const model = {
    getValue: () => line, getLineContent: () => line, getValueInRange: () => line,
    getWordUntilPosition: () => ({ startColumn: column - word.length, endColumn: column, word }),
  };
  return provider.provideCompletionItems(model, { lineNumber: 1, column })?.suggestions.find(item => item.label === 'await import');
}

test('dynamic import completes partial keywords and replaces an existing await once', () => {
  for (const text of ['a', 'aw', 'await', 'await ', 'await im', 'import', 'const module = await im']) {
    const item = complete(text);
    assert.ok(item, text);
    const result = text.slice(0, item.range.startColumn - 1) + item.insertText;
    assert.equal(result, (text.startsWith('const') ? 'const module = ' : '') + 'await import("${1:./module.js}")');
  }
});

test('dynamic import snippet does not appear for members, comments or string input', () => {
  for (const text of ['fm.im', '// await im', '"await im', 'const text = "await im']) {
    assert.equal(complete(text), undefined, text);
  }
});

test('dynamic import preserves destructuring declarations when completing the expression', () => {
  for (const declaration of [
    'const {} = ',
    'const { foo } = ',
    'const { foo: bar, baz, ...rest } = ',
    'let { default: module } = ',
    '  const [first, second] = ',
  ]) {
    const text = declaration + 'await im';
    const item = complete(text);
    assert.ok(item, text);
    assert.equal(
      text.slice(0, item.range.startColumn - 1) + item.insertText,
      declaration + 'await import("${1:./module.js}")',
    );
  }
});

test('import paths use current project files and replace quoted contents without duplication', () => {
  files = [
    { path: '/lib/new-file.js', type: 'text' },
    { path: '/index.js', type: 'text' },
    { path: '/tone.tfi', type: 'binary' },
    { path: '/metadata.json', type: 'text' },
  ];
  function paths(line, currentPath, column = line.length + 1) {
    return provider.provideCompletionItems({
      uri: { path: `/project${currentPath}` }, getValue: () => line,
      getLineContent: () => line, getValueInRange: () => line.slice(0, column - 1),
      getWordUntilPosition: () => ({ startColumn: column, endColumn: column, word: '' }),
    }, { lineNumber: 1, column }).suggestions;
  }
  const line = 'const { hello } = await import("./lib/new-file.js");';
  const column = line.indexOf('./lib') + 3;
  const [item] = paths(line, '/index.js', column);
  assert.equal(item.label, './lib/new-file.js');
  assert.equal(line.slice(0, item.range.startColumn - 1) + item.insertText + line.slice(item.range.endColumn - 1), line);
  assert.deepEqual(paths("await import('", '/lib/new-file.js').map(item => item.label), ['../index.js']);
  assert.deepEqual(paths('await import("/', '/index.js').map(item => item.label), ['/lib/new-file.js']);
  files = files.filter(file => file.path !== '/lib/new-file.js');
  assert.deepEqual(paths('await import("', '/index.js'), []);
});

function chipSuggestions(source, chip) {
  let selectedProvider;
  registerMonacoCompletions({languages: {
    CompletionItemKind: {}, CompletionItemInsertTextRule: {InsertAsSnippet: 4},
    registerCompletionItemProvider(language, value) {if(language === 'javascript') selectedProvider = value;},
  }}, {chip});
  const lines = source.split('\n'), line = lines.at(-1), column = line.length + 1;
  return selectedProvider.provideCompletionItems({
    getValue: () => source, getLineContent: () => line, getValueInRange: () => source,
    getWordUntilPosition: () => ({startColumn: column, endColumn: column, word: ''}),
  }, {lineNumber: lines.length, column})?.suggestions ?? [];
}

test('pg and global fm members defer to selected declarations without Genesis helper overrides', () => {
  for(const chip of ['ym2203', 'ym2610', 'ym2608', 'ym2612']) {
    assert.deepEqual(chipSuggestions('pg.', chip), [], chip);
    assert.deepEqual(chipSuggestions('fm.', chip), [], chip);
    assert.deepEqual(chipSuggestions('pg.fm.', chip), [], chip);
  }
});

test('global FM register hints follow selected DAC, pan and LFO capabilities', () => {
  const values = (source, chip) => chipSuggestions(source, chip).map(item => item.insertText);
  for(const receiver of ['fm', 'pg.fm']) {
    const opn = values(`${receiver}.write(0, `, 'ym2203');
    for(const register of ['0x22', '0x2a', '0x2b', '0xb4'])assert(!opn.includes(register), register);
    for(const register of ['0x27', '0x28', '0x30', '0xa0'])assert(opn.includes(register), register);
    for(const chip of ['ym2610', 'ym2608']) {
      const registers = values(`${receiver}.writeAddress(0, `, chip);
      for(const register of ['0x2a', '0x2b'])assert(!registers.includes(register), chip);
      for(const register of ['0x22', '0xb4'])assert(registers.includes(register), chip);
    }
    const genesis = values(`${receiver}.write(0, `);
    for(const register of ['0x22', '0x2a', '0x2b', '0xb4'])assert(genesis.includes(register), register);
    assert.deepEqual(values(`${receiver}.write(0, 0x22, `, 'ym2203'), []);
    assert.deepEqual(values(`${receiver}.write(0, 0x2b, `, 'ym2610'), []);
  }
});

test('global FM key-on hints include only the selected chip hardware channels', () => {
  const values = chip => chipSuggestions('fm.write(0, 0x28, ', chip).map(item => item.insertText);
  assert.deepEqual(values('ym2203'), ['0x00', '0x01', '0x02', '0xf0', '0xf1', '0xf2']);
  assert.deepEqual(values('ym2610'), ['0x01', '0x02', '0x05', '0x06', '0xf1', '0xf2', '0xf5', '0xf6']);
  assert.equal(values('ym2608').length, 12);
  assert.deepEqual(values('ym2610b'),['0x00','0x01','0x02','0x04','0x05','0x06','0xf0','0xf1','0xf2','0xf4','0xf5','0xf6']);
});

test('selected-mode register filtering does not restrict an explicitly declared independent fm', () => {
  for(const source of [
    'const fm = await createSoundChip("ym2612");\nfm.write(0, ',
    'const fm = await useSoundChip("ym2612");\nfm.write(0, ',
    'async function notes(fm) {\nfm.write(0, ',
    'const pg = customPlayground;\npg.fm.write(0, ',
  ]) {
    const values = chipSuggestions(source, 'ym2203').map(item => item.insertText);
    for(const register of ['0x22', '0x2a', '0x2b', '0xb4'])assert(values.includes(register), source);
  }
});

test('play option guidance describes the selected logical FM channel range', () => {
  for(const [chip, lastChannel] of [['ym2203', 2], ['ym2610', 3], ['ym2610b', 5], ['ym2608', 5]]) {
    const channel = chipSuggestions('play("C4", { ', chip).find(item => item.label === 'channel');
    assert.equal(channel.documentation, `${chip.toUpperCase()} FM channel number 0..${lastChannel}.`);
  }
});

test('Game Boy does not suggest primary OPN play, presets, operators, or register writes', () => {
  for (const source of [
    'play(', 'pg.play(', 'play("C4", { ', 'pg.play("C4", { ', 'play("', 'pg.play("',
    'fm.write(0, ', 'pg.fm.write(0, ', 'fm.write(0, 0x28, ', 'fm.setOperator(0, 0, { ',
    'FM_PRESETS["', 'pg.presets["',
  ]) assert.deepEqual(chipSuggestions(source, 'gameboy'), [], source);
  assert(chipSuggestions('scale("', 'gameboy').length > 0);
  const registers = chipSuggestions('const fm = await useSoundChip("ym2612");\nfm.write(0, ', 'gameboy');
  assert(registers.some(item => item.insertText === '0x2a'));
  const operators = chipSuggestions('const fm = await useSoundChip("ym2612");\nfm.setOperator(0, 0, { ', 'gameboy');
  assert(operators.some(item => item.label === 'multi'));
});

for (const chip of ['wonderswan', 'game-gear', 'master-system', 'dx7', 'ym3526', 'ym3812', 'y8950', 'ymf262', 'ym2413', 'msx', 'msx-audio', 'ay8910', 'atari-st']) {
  test(`${chip} completion omits primary OPN hints and retains independent FM hints`, () => {
    for (const source of [
      'play(', 'pg.play(', 'play("C4", { ', 'pg.play("C4", { ',
      'fm.write(0, ', 'pg.fm.write(0, ', 'fm.setOperator(0, 0, { ',
      'pg.fm.setOperator(0, 0, { ', 'play("', 'fm.write(0, 0x28, ',
      'FM_PRESETS["', 'pg.presets["',
    ]) assert.deepEqual(chipSuggestions(source, chip), [], source);
    assert(chipSuggestions('scale("', chip).length > 0);
    const registers = chipSuggestions('const fm = await useSoundChip("ym2612");\nfm.write(0, ', chip);
    assert(registers.some(item => item.insertText === '0x2a'));
    if (['ym3526','ym3812','y8950','ymf262'].includes(chip)) {
      for (const source of ['opl.','pg.opl.','opl.setOperator(0, 0, { ']) {
        assert.deepEqual(chipSuggestions(source,chip),[],'the native OPL type supplies members and parameter fields');
      }
    }
  });
}
