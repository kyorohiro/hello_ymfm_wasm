import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYGROUND_MODES, getPlaygroundMode, resolvePlaygroundMode,
  createModeSynthOptions, createPlaygroundModeUrl, isSimplePlaygroundLayout} from './playground_mode.js';

test('OPN modes select native chips, clocks and Full expansions', () => {
  const expected = [
    ['genesis','ym2612',7670454,false], ['genesis-full','ym2612',7670454,true],
    ['genesis-full-nuked','ym2612',7670454,true], ['pc98-26','ym2203',4000000,false],
    ['pc98','ym2608',8000000,false], ['neogeo','ym2610',8000000,false],
    ['neogeo-b','ym2610b',8000000,false],
  ];
  assert.deepEqual(PLAYGROUND_MODES.map(mode => [mode.id,mode.chip,mode.clock,mode.full]), expected);
  for (const mode of PLAYGROUND_MODES) {
    const options = createModeSynthOptions(mode, new URL('https://example.com/app/js/'));
    assert.equal(options.chip, mode.chip);
    assert.equal(options.megaCD, mode.full);
    assert.equal(options.mega32X, mode.full);
    assert.equal(Boolean(options.segaPsgWasmUrl), mode.chip === 'ym2612');
    const wasm = mode.engine === 'nuked' ? 'nuked_opn2' : mode.chip === 'ym2610' ? 'ym2610b' : mode.chip;
    assert.equal(options.wasmUrl ?? options.ym2612WasmUrl, `https://example.com/app/generated/${wasm}_wasm.wasm`);
  }
  const full = createModeSynthOptions(getPlaygroundMode('genesis-full-nuked'));
  assert.match(full.workletUrl, /ym2612-worklet-nuked\.js\?/);
  assert.equal(full.megaCD && full.mega32X, true);
});

test('legacy chip and engine links retain their original environments; explicit mode wins', () => {
  assert.equal(resolvePlaygroundMode().id, 'genesis');
  assert.equal(resolvePlaygroundMode('?chip=ym2203').id, 'pc98-26');
  assert.equal(resolvePlaygroundMode('?chip=ym2608').id, 'pc98');
  assert.equal(resolvePlaygroundMode('?chip=ym2610').id, 'neogeo');
  assert.equal(resolvePlaygroundMode('?chip=ym2610b').chip, 'ym2610b');
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
