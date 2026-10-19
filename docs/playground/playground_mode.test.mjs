import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYGROUND_MODES, getPlaygroundMode, resolvePlaygroundMode,
  createModeSynthOptions, createPlaygroundModeUrl, isSimplePlaygroundLayout} from './playground_mode.js';
import {MODE_STARTERS} from './playground_mode_examples.js';

test('modes select native chips, clocks and Full expansions', () => {
  const expected = [
    ['genesis','ym2612',7670454,false], ['genesis-full','ym2612',7670454,true],
    ['genesis-full-nuked','ym2612',7670454,true], ['mega-cd','ym2612',7670454,false],
    ['pc98-26','ym2203',4000000,false],
    ['pc98','ym2608',8000000,false], ['neogeo','ym2610',8000000,false],
    ['neogeo-b','ym2610b',8000000,false],
    ['gameboy','gameboy',4194304,false],
    ['nes','nes',1789773,false],['snes','snes',1024000,false],
    ['x68000','x68000',4000000,false],['pc-engine','huc6280',3579545,false],
    ['game-gear','segapsg',3579545,false],['master-system','segapsg',3579545,false],
  ];
  assert.deepEqual(PLAYGROUND_MODES.map(mode => [mode.id,mode.chip,mode.clock,mode.full]), expected);
  for (const mode of PLAYGROUND_MODES) {
    const options = createModeSynthOptions(mode, new URL('https://example.com/app/js/'));
    assert.equal(options.chip, mode.chip);
    assert.equal(options.megaCD, mode.megaCD ?? mode.full);
    assert.equal(options.mega32X, mode.mega32X ?? mode.full);
    assert.equal(Boolean(options.segaPsgWasmUrl), mode.chip === 'ym2612');
    if (mode.chip === 'segapsg') {
      assert.equal(mode.fmChannels,0);
      assert.equal(mode.declarationChip,mode.id);
      assert.equal(options.stereoEnabled,mode.id === 'game-gear');
      assert.deepEqual(mode.chipTabs,['segapsg']);
      assert.equal(options.wasmUrl,'https://example.com/app/generated/segapsg_wasm.wasm?v=sega-modes-1');
      assert.match(options.workletUrl,/playground_segapsg_worklet\.js\?/);
      continue;
    }
    if (['nes','snes','x68000','huc6280'].includes(mode.chip)) {
      assert.deepEqual(mode.chipTabs, []);
      assert.equal(mode.fmChannels,0);
      assert.equal(options.fds,mode.chip==='nes');
      const wasm = {snes:'spc',x68000:'ym2151',huc6280:'huc6280'}[mode.chip];
      assert.equal(options.wasmUrl,wasm?`https://example.com/app/generated/${wasm}_wasm.wasm`:undefined);
      assert.match(options.workletUrl,/playground_\w+_worklet\.js\?/);
      if (mode.chip==='x68000') assert.equal(options.extraOki.wasmUrl,'https://example.com/app/generated/okim6258_wasm.wasm');
      continue;
    }
    const wasm = mode.engine === 'nuked' ? 'nuked_opn2' : mode.chip === 'ym2610' ? 'ym2610b' : mode.chip === 'gameboy' ? 'gameboy_apu' : mode.chip;
    assert.equal(options.wasmUrl ?? options.ym2612WasmUrl, `https://example.com/app/generated/${wasm}_wasm.wasm`);
  }
  const full = createModeSynthOptions(getPlaygroundMode('genesis-full-nuked'));
  assert.match(full.workletUrl, /ym2612-worklet-nuked\.js\?/);
  assert.equal(full.megaCD && full.mega32X, true);
  for (const id of ['genesis-full', 'genesis-full-nuked']) {
    assert.equal(getPlaygroundMode(id).declarationChip, 'mega-cd', `${id} shares primary PCM ownership types`);
  }
  const megaCD = getPlaygroundMode('mega-cd');
  assert.deepEqual(megaCD.chipTabs, ['operator', 'segapsg', 'rf5c164']);
  assert.equal(megaCD.declarationChip, 'mega-cd');
  assert.equal(megaCD.legacyDraftKey, 'mega-cd', 'a fresh Mega-CD mode does not inherit an old Genesis draft');
  assert.equal(createModeSynthOptions(megaCD).megaCD, true);
  assert.equal(createModeSynthOptions(megaCD).mega32X, false);
  const gameboy = getPlaygroundMode('gameboy');
  assert.deepEqual(gameboy.chipTabs, []);
  assert.equal(gameboy.fmChannels, 0);
  assert.match(createModeSynthOptions(gameboy).workletUrl, /playground_gameboy_worklet\.js\?/);
});

test('every visible mode and the legacy Nuked mode have their own starter catalog', () => {
  assert.deepEqual(Object.keys(MODE_STARTERS), [...PLAYGROUND_MODES.map(mode => mode.id), 'genesis-nuked']);
  for (const [id, definition] of Object.entries(MODE_STARTERS)) {
    assert.equal(getPlaygroundMode(id).id, id);
    assert.equal(definition.index, `${id}/index.js`);
  }
});

test('legacy chip and engine links retain their original environments; explicit mode wins', () => {
  assert.equal(resolvePlaygroundMode().id, 'genesis');
  assert.equal(resolvePlaygroundMode('?chip=ym2203').id, 'pc98-26');
  assert.equal(resolvePlaygroundMode('?chip=ym2608').id, 'pc98');
  assert.equal(resolvePlaygroundMode('?chip=ym2610').id, 'neogeo');
  assert.equal(resolvePlaygroundMode('?chip=ym2610b').chip, 'ym2610b');
  assert.equal(resolvePlaygroundMode('?mode=gameboy').chip, 'gameboy');
  assert.equal(resolvePlaygroundMode('?mode=mega-cd').chip, 'ym2612');
  assert.equal(resolvePlaygroundMode('?engine=nuked').id, 'genesis-nuked');
  assert.equal(resolvePlaygroundMode('?mode=pc98&chip=ym2612&engine=nuked').chip, 'ym2608');
  assert.equal(resolvePlaygroundMode('?mode=simple&chip=ym2203').id, 'pc98-26');
  assert.equal(resolvePlaygroundMode('?mode=full').id, 'genesis');
  assert.throws(() => resolvePlaygroundMode('?mode=missing'), /Unsupported Playground mode/);
  assert.throws(() => resolvePlaygroundMode('?chip=missing'), /Unsupported Playground chip/);
});

test('new mode links remove chip/engine without losing code or compact lesson layout', () => {
  const url = createPlaygroundModeUrl('https://example.com/playground/?mode=simple&chip=ym2203&engine=nuked&src=YWJj&monitor=1#code', 'pc98');
  assert.equal(url.searchParams.get('mode'), 'pc98');
  assert.equal(url.searchParams.get('layout'), 'simple');
  assert.equal(url.searchParams.has('chip') || url.searchParams.has('engine'), false);
  assert.equal(url.searchParams.get('src'), 'YWJj');
  assert.equal(url.hash, '#code');
  assert.equal(isSimplePlaygroundLayout(url.search), true);
  assert.equal(isSimplePlaygroundLayout('?mode=simple'), true);
  assert.equal(isSimplePlaygroundLayout('?mode=genesis-full'), false);
});
