import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYGROUND_MODES, getPlaygroundMode, resolvePlaygroundMode,
  createModeSynthOptions, createPlaygroundModeUrl, isSimplePlaygroundLayout} from './playground_mode.js';
import {MODE_STARTERS} from './playground_mode_examples.js';
import {createPlaygroundSoundChipMixer} from './playground_mixer_defaults.js';

test('every selectable mode can create its Mixer policy before audio preparation',()=>{
  for(const mode of PLAYGROUND_MODES)assert.doesNotThrow(()=>createPlaygroundSoundChipMixer(mode.id),mode.id);
});

function assertWorkletUrl(actual, name) {
  const url = new URL(actual);
  assert.equal(url.origin, 'https://example.com');
  assert.equal(url.pathname, `/app/js/playground_${name}_worklet.js`);
  // Deployment revisions follow the generated dependency graph, not the mode.
  assert.match(url.searchParams.get('v') ?? '', /^[\w.-]+$/);
  assert.equal(url.hash, '');
}

test('modes select native chips, clocks and console expansions', () => {
  const expected = [
    ['genesis','ym2612',7670454,false], ['mega-cd','ym2612',7670454,false],
    ['genesis-full','ym2612',7670454,true], ['genesis-full-nuked','ym2612',7670454,true],
    ['pc98-26','ym2203',4000000,false],
    ['pc98','ym2608',8000000,false], ['neogeo','ym2610',8000000,false],
    ['neogeo-b','ym2610b',8000000,false],
    ['wonderswan','wonderswan',3072000,false],
    ['gameboy','gameboy',4194304,false],
    ['nes','nes',1789773,false],['scsp','scsp',undefined,false],['ps1','ps1',undefined,false],['snes','snes',1024000,false],
    ['x68000','x68000',4000000,false],['pc-engine','huc6280',3579545,false],['pc-engine-cd','huc6280',3579545,false],
    ['game-gear','segapsg',3579545,false],['master-system','segapsg',3579545,false],['atari-st','ay8910',2000000,false],['pokey','pokey',1789790,false],['pokey-dual','pokey',1789773,false],['msx','msx',1789773,false],['msx-audio','msx-audio',1789773,false],
    ['dx7','dx7',undefined,false],
    ['ym3526','ym3526',3579545,false],['ym3812','ym3812',3579545,false],
    ['ymf262','ymf262',14318180,false],
  ];
  assert.deepEqual(PLAYGROUND_MODES.map(mode => [mode.id,mode.chip,mode.clock,mode.full]), expected);
  for (const mode of PLAYGROUND_MODES) {
    const options = createModeSynthOptions(mode, new URL('https://example.com/app/js/'));
    assert.equal(options.chip, mode.chip);
    assert.equal(options.megaCD, mode.megaCD ?? mode.full);
    assert.equal(options.mega32X, mode.mega32X ?? mode.full);
    assert.equal(Boolean(options.segaPsgWasmUrl), mode.chip === 'ym2612');
    if (mode.chip === 'scsp') {
      assert.equal(mode.fmChannels,0);assert.deepEqual(mode.chipTabs,['scsp']);
      assertWorkletUrl(options.workletUrl,'scsp');
      assert.equal(options.wasmUrl,'https://example.com/app/generated/scsp_wasm.wasm');continue;
    }
    if (mode.chip === 'ps1') {
      assert.equal(mode.fmChannels,0); assert.deepEqual(mode.chipTabs,['ps1']);
      assertWorkletUrl(options.workletUrl,'ps1');
      assert.equal(options.wasmUrl,'https://example.com/app/generated/ps1_spu_wasm.wasm');
      assert.equal(options.clock,undefined); continue;
    }
    if (mode.chip === 'pokey') {
      assert.equal(mode.fmChannels,0);
      assert.deepEqual(mode.chipTabs,['pokey'],'POKEY modes expose the applied voice editor');
      assert.equal(mode.declarationChip,mode.id);
      assert.equal(mode.legacyDraftKey,mode.id,'single and dual drafts remain separate');
      assert.equal(options.dualPokey,mode.id === 'pokey-dual');
      assert.equal(options.clock,mode.clock);
      assertWorkletUrl(options.workletUrl,'pokey');
      assert.equal(options.wasmUrl,'https://example.com/app/generated/pokey_wasm.wasm');
      assert.equal(options.ym2612WasmUrl,undefined);
      continue;
    }
    if (mode.engine === 'msx') {
      assert.equal(mode.declarationChip,mode.chip); assert.equal(mode.fmChannels,0);
      assert.equal(mode.label,mode.chip === 'msx' ? 'MSX' : 'MSX Audio');
      assert.deepEqual(mode.chipTabs,mode.chip === 'msx' ? ['ym2413','ay8910'] : ['y8950','ym2413','ay8910']);
      const endpoints = [['ayOptions','ay8910','ay8910'],['opllOptions','ym2413','ym2413']];
      if (mode.chip === 'msx-audio') endpoints.push(['oplOptions','y8950','opl']);
      else assert.equal(options.oplOptions,undefined,'MSX does not load a Y8950 processor');
      for (const [key,chip,worklet] of endpoints) {
        assert.equal(options[key].wasmUrl,`https://example.com/app/generated/${chip}_wasm.wasm`);
        assertWorkletUrl(options[key].workletUrl, worklet);
      }
      assert.equal(options.ym2612WasmUrl,undefined); continue;
    }
    if (mode.engine === 'opl') {
      assert.equal(mode.fmChannels,0,'OPL uses its native instrument instead of the OPN play shortcut');
      assert.deepEqual(mode.chipTabs,[mode.chip]);
      assert.equal(options.clock,mode.clock);
      assertWorkletUrl(options.workletUrl, 'opl');
      assert.equal(options.wasmUrl,`https://example.com/app/generated/${mode.chip}_wasm.wasm`);
      assert.equal(options.ym2612WasmUrl,undefined);
      continue;
    }
    if (mode.chip === 'dx7') {
      assert.equal(mode.fmChannels,0);
      assert.deepEqual(mode.chipTabs,['dx7']);
      assert.equal(mode.declarationChip,'dx7');
      assert.equal(mode.legacyDraftKey,'dx7');
      assert.equal(options.clock,undefined,'DX7 uses a fixed internal sample rate rather than a chip clock');
      assert.equal(options.workletUrl,undefined,'DX7 resolves its Worklet and WASM beside its module');
      assert.equal(options.ym2612WasmUrl,undefined);
      continue;
    }
    if (mode.id === 'atari-st') {
      assert.equal(mode.fmChannels,0);
      assert.equal(mode.declarationChip,'atari-st');
      assert.equal(mode.legacyDraftKey,'atari-st','Atari ST does not reuse a generic AY draft');
      assert.deepEqual(mode.chipTabs,['ay8910']);
      assert.equal(options.clock,2000000,'the machine clock overrides generic AY defaults');
      assert.equal(options.type,0x10,'the AY-compatible core uses YM2149 behavior');
      assert.equal(options.flags,1,'YM2149 pin 26 is high: no additional clock divider');
      assertWorkletUrl(options.workletUrl,'ay8910');
      assert.equal(options.wasmUrl,'https://example.com/app/generated/ay8910_wasm.wasm');
      assert.equal(options.ym2612WasmUrl,undefined);
      assert.equal(options.opllOptions,undefined,'Atari ST only loads its primary PSG');
      continue;
    }
    if (mode.chip === 'segapsg') {
      assert.equal(mode.fmChannels,0);
      assert.equal(mode.declarationChip,mode.id);
      assert.equal(options.stereoEnabled,mode.id === 'game-gear');
      assert.deepEqual(mode.chipTabs,mode.id === 'master-system' ? ['segapsg','ym2413'] : ['segapsg']);
      assert.equal(options.ym2413,mode.id === 'master-system','OPLL is an explicit Master System expansion');
      if (mode.id === 'master-system') {
        assert.equal(options.opllOptions.wasmUrl,'https://example.com/app/generated/ym2413_wasm.wasm');
        assert.match(options.opllOptions.workletUrl,/\/app\/js\/playground_ym2413_worklet\.js\?/);
      } else assert.equal(options.opllOptions,undefined,'Game Gear remains PSG-only');
      assert.equal(options.wasmUrl,'https://example.com/app/generated/segapsg_wasm.wasm?v=audio-numeric-bindings-1');
      assert.match(options.workletUrl,/playground_segapsg_worklet\.js\?/);
      continue;
    }
    if (['nes','snes','x68000','huc6280','wonderswan'].includes(mode.chip)) {
      assert.deepEqual(mode.chipTabs, mode.chip === 'nes' ? ['nes'] : mode.chip === 'x68000' ? ['ym2151','okim6258'] : mode.chip === 'huc6280' ? mode.pcEngineCd ? ['huc6280','msm5205','cdda'] : ['huc6280'] : mode.chip === 'wonderswan' ? ['wonderswan'] : ['snes']);
      assert.equal(mode.fmChannels,0);
      assert.equal(options.fds,mode.chip==='nes');
      const wasm = {wonderswan:'wonderswan',snes:'spc',x68000:'ym2151',huc6280:'huc6280'}[mode.chip];
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
  assert.deepEqual(megaCD.chipTabs, ['operator', 'segapsg', 'rf5c164', 'cdda']);
  assert.equal(megaCD.declarationChip, 'mega-cd');
  assert.equal(megaCD.legacyDraftKey, 'mega-cd', 'a fresh Mega-CD mode does not inherit an old Genesis draft');
  assert.equal(createModeSynthOptions(megaCD).megaCD, true);
  assert.equal(createModeSynthOptions(megaCD).mega32X, false);
  const gameboy = getPlaygroundMode('gameboy');
  assert.deepEqual(gameboy.chipTabs, ['gameboy']);
  assert.equal(gameboy.fmChannels, 0);
  assert.match(createModeSynthOptions(gameboy).workletUrl, /playground_gameboy_worklet\.js\?/);
});

test('Mega-CD adds the shared CD-DA inspector without changing Genesis or 32X hardware', () => {
  const megaCD = getPlaygroundMode('mega-cd');
  assert.match(megaCD.details, /CD-DA/);
  assert.deepEqual(megaCD.chipTabs, ['operator', 'segapsg', 'rf5c164', 'cdda']);
  const options = createModeSynthOptions(megaCD);
  assert.equal(options.chip, 'ym2612'); assert.equal(options.megaCD, true); assert.equal(options.mega32X, false);
  assert.equal(megaCD.pcEngineCd, undefined); assert.equal(options.pcEngineCd, undefined);
  assert(!megaCD.chipTabs.includes('msm5205')); assert(!megaCD.chipTabs.includes('huc6280'));
  assert.deepEqual(getPlaygroundMode('genesis').chipTabs, ['operator', 'segapsg']);
  for (const id of ['genesis-full', 'genesis-full-nuked']) {
    assert.deepEqual(getPlaygroundMode(id).chipTabs, ['operator', 'segapsg', 'rf5c164', 'pwm']);
    const full = createModeSynthOptions(getPlaygroundMode(id));
    assert.equal(full.megaCD, true); assert.equal(full.mega32X, true);
  }
  assert.deepEqual(getPlaygroundMode('pc-engine-cd').chipTabs, ['huc6280', 'msm5205', 'cdda']);
});

test('every visible mode and the legacy Nuked mode have their own starter catalog', () => {
  assert.deepEqual(Object.keys(MODE_STARTERS), [...PLAYGROUND_MODES.map(mode => mode.id), 'genesis-nuked']);
  for (const [id, definition] of Object.entries(MODE_STARTERS)) {
    assert.equal(getPlaygroundMode(id).id, id);
    assert.equal(definition.index, `${id}/index.js`);
  }
});

test('mode voice editors load the new processors after a cached website upgrade', () => {
  for (const [id, filename] of [['gameboy','playground_gameboy_worklet.js'], ['nes','playground_nes_worklet.js'], ['x68000','playground_ym2151_worklet.js'], ['pc-engine','playground_huc6280_worklet.js'], ['neogeo-b','ym2610b-worklet.js'], ['wonderswan','playground_wonderswan_worklet.js'], ['pokey','playground_pokey_worklet.js'], ['pokey-dual','playground_pokey_worklet.js']]) {
    const url = new URL(createModeSynthOptions(getPlaygroundMode(id), new URL('https://example.com/custom-audio/')).workletUrl);
    assert.equal(url.pathname, `/custom-audio/${filename}`);
    assert.match(url.searchParams.get('v')??'', /^[\w.-]+$/, `${id} cannot reuse its cached shared control transport`);
  }
});

test('legacy chip and engine links retain their original environments; explicit mode wins', () => {
  assert.equal(resolvePlaygroundMode().id, 'genesis');
  assert.equal(resolvePlaygroundMode('?chip=ym2203').id, 'pc98-26');
  assert.equal(resolvePlaygroundMode('?chip=ym2608').id, 'pc98');
  assert.equal(resolvePlaygroundMode('?chip=ym2610').id, 'neogeo');
  assert.equal(resolvePlaygroundMode('?chip=ym2610b').chip, 'ym2610b');
  assert.equal(resolvePlaygroundMode('?mode=gameboy').chip, 'gameboy');
  assert.equal(resolvePlaygroundMode('?mode=dx7').chip, 'dx7');
  assert.equal(resolvePlaygroundMode('?chip=dx7').id, 'dx7');
  assert.equal(resolvePlaygroundMode('?mode=msx').chip,'msx'); assert.equal(resolvePlaygroundMode('?chip=msx').id,'msx');
  assert.equal(resolvePlaygroundMode('?mode=atari-st').chip,'ay8910');
  for (const search of ['?mode=msx-audio','?chip=msx-audio','?mode=y8950','?chip=y8950']) assert.equal(resolvePlaygroundMode(search).id,'msx-audio',search);
  assert.equal(getPlaygroundMode('Y8950'),getPlaygroundMode('msx-audio'),'old saved mode IDs resolve to the expanded environment');
  for (const chip of ['ym3812','ym3526','ymf262']) {
    assert.equal(resolvePlaygroundMode(`?mode=${chip}`).chip,chip);
    assert.equal(resolvePlaygroundMode(`?chip=${chip}`).id,chip);
  }
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
