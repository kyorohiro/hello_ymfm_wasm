// Verify the installed tarball in an isolated project, not repository imports.
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'tetorica-fm2612-check-'));
try {
  if (!process.argv.includes('--skip-build')) execFileSync(process.execPath, [join(root, 'scripts/build_fm2612_package.mjs')], {cwd: root, stdio: 'inherit'});
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: join(root, 'dist/fm2612'), encoding: 'utf8',
  }))[0];
  const packedPaths = new Set(packed.files.map(file => file.path));
  for (const file of ['soundchip_mixer.js', 'soundchip_mixer.d.ts', 'soundchip_mixer_presets.js', 'soundchip_mixer_presets.d.ts']) {
    assert.ok(packedPaths.has(file), `Optional Mixer calibration payload missing ${file}`);
  }
  for (const file of ['licenses/tetorica_sega_psg/LICENSE', 'licenses/tetorica_sega_psg/README.md',
    'sources/third_party/tetorica_sega_psg/segapsg.cpp', 'sources/third_party/tetorica_sega_psg/segapsg.h',
    'sources/third_party/tetorica_sega_psg/LICENSE', 'sources/third_party/tetorica_sega_psg/README.md',
    'sources/src/chip_state.h', 'sources/wasm/segapsg_wasm.cpp', 'sources/scripts/build_segapsg_wasm.sh', 'sources/SegaPSG.md']) {
    assert.ok(packedPaths.has(file), `Original Sega PSG source or notice missing ${file}`);
  }
  for (const file of ['msm5205audioengine.js', 'licenses/libvgm-msm5205/README.md', 'licenses/libvgm-msm5205/LICENSE']) {
    assert.ok(packedPaths.has(file), `MSM5205 reference renderer notice missing ${file}`);
  }
  for(const file of ['nesapu_wasm.js','nesapu_wasm.d.ts','generated/nesapu_wasm.js','generated/nesapu_wasm.wasm',
    'licenses/tetorica-nes/LICENSE-JSNES','licenses/tetorica-nes/LICENSE-FDS','licenses/tetorica-nes/AUTHORS-JSNES.md','licenses/tetorica-nes/UPSTREAM-JSNES.md','licenses/tetorica-nes/UPSTREAM-FDS.md','licenses/tetorica-nes/README.md','licenses/jsnes/AUTHORS.md',
    'sources/third_party/tetorica-nes/nes_core.cpp','sources/third_party/tetorica-nes/nes_core.h','sources/wasm/nesapu_wasm.cpp','sources/scripts/build_nesapu_wasm.sh','sources/NES-FDS.md',
  ])assert(packedPaths.has(file),'NES/FDS WASM package payload missing '+file);
  for(const file of ['pwm32x_wasm.js','pwm32x_wasm.d.ts','generated/pwm32x_wasm.js','generated/pwm32x_wasm.wasm',
    'sources/wasm/pwm32x_core.h','sources/wasm/pwm32x_wasm.cpp','sources/scripts/build_pwm32x_wasm.sh',
    'licenses/mame-32x-pwm/LICENSE','licenses/mame-32x-pwm/README.md'])assert(packedPaths.has(file),'PWM WASM package payload missing '+file);
  for (const file of ['playground_dx7.js', 'playground_dx7_audio.js', 'playground_dx7_worklet.js', 'playground_keyboard_channels.js','playground_opn_inspector.js','playground_dx7_inspector.js', 'playground_snes_inspector.js',
    'msfa_dx7/src/index.js', 'msfa_dx7/src/index.d.ts', 'msfa_dx7/src/preset.js', 'msfa_dx7/src/preset.d.ts', 'msfa_dx7/src/sysex.js', 'msfa_dx7/wasm/msfa.wasm',
    'msfa_dx7/LICENSE', 'msfa_dx7/THIRD_PARTY_NOTICES.md', 'msfa_dx7/README.vendor.md', 'msfa_dx7/vendor/msfa/COPYING']) {
    assert.ok(packedPaths.has(file), `DX7 package payload missing ${file}`);
  }
  for(const file of ['pokey.js','pokey.d.ts','pokeysynth.js','pokeysynth.d.ts','pokeyaudioengine.js','pokeyaudioengine.d.ts',
    'generated/pokey_wasm.js','generated/pokey_wasm.wasm','licenses/libvgm-pokey/LICENSE','licenses/libvgm-pokey/README.md',
    'sources/third_party/libvgm-pokey/pokey.cpp','sources/third_party/libvgm-pokey/pokey.h',
    'sources/third_party/libvgm-pokey/LICENSE','sources/third_party/libvgm-pokey/upstream/pokey.c',
    'sources/third_party/libvgm-pokey/upstream/snapshot-manifest.json',
    'sources/wasm/pokey_wasm.cpp','sources/scripts/build_pokey_wasm.sh','sources/POKEY.md','sources/POKEY-SDK.json']) {
    assert(packedPaths.has(file),'POKEY module/source/notice payload missing '+file);
  }
  const nativeModules = ['native_runtime_synth', 'playground_runtime', 'playground_logic_worker',
    'playground_keyboard', 'playground_sample_edit', 'playground_sample_instrument',
    'playground_chip_inspector', 'playground_chip_inspector_state', 'playground_native_voice_inspector',
    ...['pokey','wonderswan','huc6280','ym2151','okim6258','ym2413','ay8910'].flatMap(chip => ['playground_' + chip, 'playground_' + chip + '_audio', 'playground_' + chip + '_worklet', 'playground_' + chip + '_inspector']),
    'pokey','pokeysynth','pokeyaudioengine','pokey_timeline','pokey_timeline_builder','wonderswan','wonderswansynth','huc6280synth', 'okim6258synth','opl_synth','ym3526synth','ym3812synth','y8950synth','ymf262synth','ym2413synth','ay8910synth',
    'playground_opl','playground_opl_audio','playground_opl_worklet','playground_opl_inspector'];
  for (const name of nativeModules) for (const extension of ['js','d.ts']) {
    assert.ok(packedPaths.has(name + '.' + extension), `Native voice/sample package payload missing ${name}.${extension}`);
  }
  for (const chip of ['pokey','wonderswan','huc6280','ym2151','okim6258','ym2413','ay8910']) for (const extension of ['js','wasm']) {
    assert.ok(packedPaths.has(`generated/${chip}_wasm.${extension}`), `Native voice WASM payload missing ${chip}.${extension}`);
  }
  for (const chip of ['wonderswan','huc6280','okim6258','ay8910']) for (const file of ['LICENSE','README.md']) {
    assert.ok(packedPaths.has(`licenses/mame-${chip}/${file}`), `Native voice license payload missing ${chip}/${file}`);
  }
  const consumer = join(scratch, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, packed.filename)], {
    cwd: consumer, stdio: 'inherit',
  });
  const installed = join(consumer, 'node_modules/tetorica-fm2612');
  execFileSync(process.execPath, ['--experimental-vm-modules', join(root, 'scripts/check_synth_package.mjs'), installed], {cwd: consumer, stdio: 'inherit'});
  execFileSync(process.execPath, [join(root, 'scripts/check_web_runtime.mjs'), installed], {cwd: consumer, stdio: 'inherit'});
  await writeFile(join(consumer, 'check.mjs'), `
import assert from 'node:assert/strict';
import {access, readFile} from 'node:fs/promises';
import {createSoundChip, SoundChipMixer, SOUNDCHIP_MIXER_PRESETS, soundChipMixDefaults} from 'tetorica-fm2612';
import {SOUNDCHIP_MIXER_PRESETS as subpathPresets} from 'tetorica-fm2612/soundchip_mixer_presets.js';
import {SOUNDCHIP_MIXER_PRESETS as extensionlessPresets} from 'tetorica-fm2612/soundchip_mixer_presets';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth';
import {YM2151Synth, YM2151DirectTransport} from 'tetorica-fm2612/ym2151synth';
import {NesApuSynth, NesApuDirectTransport} from 'tetorica-fm2612/nesapusynth';
import {Ym2612} from 'tetorica-fm2612/ym2612.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets';
import {OPLSynth, OPLDirectTransport, OPL_PRESETS} from 'tetorica-fm2612/opl_synth';
import {YM2413Synth,YM2413DirectTransport,YM2413_USER_PRESETS,YM2413_INSTRUMENTS} from 'tetorica-fm2612/ym2413synth';
import {AY8910Synth,AY8910DirectTransport} from 'tetorica-fm2612/ay8910synth';
import {Pokey,POKEY_CLOCK} from 'tetorica-fm2612/pokey.js';
import {PokeySynth,PokeyDirectTransport} from 'tetorica-fm2612/pokeysynth';
import pokeyModuleFactory from 'tetorica-fm2612/generated/pokey_wasm.js';
import {WonderSwan,WONDERSWAN_CLOCK} from 'tetorica-fm2612/wonderswan.js';
import {WonderSwanSynth,WonderSwanDirectTransport} from 'tetorica-fm2612/wonderswansynth';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import ym2612ModuleFactory from 'tetorica-fm2612/generated/ym2612_wasm.js';
import wonderswanModuleFactory from 'tetorica-fm2612/generated/wonderswan_wasm.js';
assert.equal(SOUNDCHIP_MIXER_PRESETS, subpathPresets);
assert.equal(SOUNDCHIP_MIXER_PRESETS, extensionlessPresets);
const calibratedPreset = SOUNDCHIP_MIXER_PRESETS.calibrated;
assert.equal(calibratedPreset.gainUnits,'source');
function assertDeeplyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeeplyFrozen(child);
}
assertDeeplyFrozen(SOUNDCHIP_MIXER_PRESETS);
assert.equal(calibratedPreset.factoryDefaults.kinds.length, 22);
assert.equal(Object.hasOwn(calibratedPreset, 'factoryEntries'), false, 'npm calibration uses measured kinds, not Playground primary IDs');
assert.throws(() => {calibratedPreset.factoryDefaults.kinds[0].volume = 2;}, TypeError);
assert.deepEqual(soundChipMixDefaults('gameboy'), {volume:0.28, pan:0, muted:false});
assert.deepEqual(soundChipMixDefaults('rf5c164'), {volume:1, pan:0, muted:false});
const publicPsgGains = {segapsg:.35, ay8910:.85, nes:1.16, gameboy:.36, huc6280:.44};
for (const [name, volume] of Object.entries(publicPsgGains)) {
  assert.equal(calibratedPreset.factoryDefaults.kinds.find(kind => kind.name === name)?.volume, volume, name + ': public WASM calibration');
  assert.deepEqual(new SoundChipMixer(calibratedPreset).getKindDefault(name), {volume, pan:0});
  const legacyVolume=name==='gameboy'?.28:1;
  assert.deepEqual(new SoundChipMixer().getKindDefault(name), {volume:legacyVolume, pan:0}, name + ': legacy Mixer default remains unchanged');
  assert.deepEqual(soundChipMixDefaults(name), {volume:legacyVolume, pan:0, muted:false}, name + ': generic defaults remain unchanged');
}
const legacyMixer = new SoundChipMixer(), calibratedMixer = new SoundChipMixer(calibratedPreset), applied = {};
legacyMixer.register('rf5c164:33', 'rf5c164', () => {});
calibratedMixer.register('rf5c164:33', 'rf5c164', value => {applied.pcm = value.volume;});
calibratedMixer.register('fm', 'ym2612', value => {applied.fm = value.volume;}, undefined, {engine:'ymfm'});
calibratedMixer.register('accurate', 'ym2612', value => {applied.nuked = value.volume;}, undefined, {engine:'nuked'});
assert.equal(legacyMixer.get('rf5c164:33').volume, 1, 'Generic factory defaults are not calibrated implicitly');
assert.deepEqual(applied, {pcm:0.280286, fm:0.775938, nuked:0.493869});
calibratedMixer.setKindDefault('rf5c164', {volume:0.7});
calibratedMixer.set('rf5c164:33', {volume:0.9});
const savedMixer = calibratedMixer.exportState(), savedDefaults = calibratedMixer.exportDefaults();
for (let index = 0; index < 3; index++) calibratedMixer.restoreState(savedMixer, savedDefaults);
assert.equal(applied.pcm, 0.9, 'Authored volume replaces calibration without applying another RF5C164 trim');
assert.deepEqual(calibratedMixer.getKindDefault('segapcm'), {volume:1, pan:0}, 'Unmeasured chips retain generic defaults');
assert.equal(new SoundChipMixer(calibratedPreset).getKindDefault('rf5c164').volume, 0.280286, 'Consumer changes do not mutate the shared preset');
const chip = await createSoundChip('ym2612');
let rawChip;
try {
  assert.ok(chip instanceof Ym2612);
  assert.equal(chip.mixer, undefined, 'Legacy direct chips still return raw PCM without an output Mixer');
  rawChip = await Ym2612.create({moduleFactory:ym2612ModuleFactory, moduleOptions:{
    wasmBinary:await readFile(runtimeAssetUrl('generated/ym2612_wasm.wasm')),
  }});
  const transport = new YM2612DirectTransport(chip);
  const synth = new YM2612Synth({transport});
  synth.setPreset(0, FM_PRESETS.sine);
  synth.noteOn(0, 4, 553);
  const rawSynth = new YM2612Synth({transport:new YM2612DirectTransport(rawChip)});
  rawSynth.setPreset(0, FM_PRESETS.sine);
  rawSynth.noteOn(0, 4, 553);
  const {left, right} = transport.generateStereo(4096);
  assert.equal(left.length, 4096);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(left.some(x => Math.abs(x) > 0.001), 'Synth must produce audible PCM');
  assert.deepEqual({left, right}, rawChip.generateStereo(4096), 'Importing calibration preserves exact low-level direct PCM');
} finally { chip.dispose(); rawChip?.dispose(); }
const opmChip = await createSoundChip('ym2151');
try {
  const transport = new YM2151DirectTransport(opmChip);
  const synth = new YM2151Synth({transport});
  synth.setPreset(7, FM_PRESETS.sine);
  synth.noteOn(7, 'A4');
  const pcm = transport.generateStereo(4096);
  assert.ok(pcm.left.every(Number.isFinite) && pcm.left.some(x => Math.abs(x) > .001));
  synth.noteOff(7);
} finally {opmChip.dispose();}
const nesChip = await createSoundChip('nes', {fds: true});
try {
  assert.equal(nesChip.backend,'wasm','Installed NES creation must use the actual WASM renderer');
  const synth = new NesApuSynth({transport: new NesApuDirectTransport(nesChip)});
  synth.fds.noteOn('A4');
  const pcm = nesChip.generateStereo(4096);
  assert.ok(pcm.left.every(Number.isFinite) && pcm.left.some(v => Math.abs(v) > .001));
} finally {nesChip.dispose();}
const pwmChip=await createSoundChip('pwm');
try {
  assert.equal(pwmChip.backend,'wasm','Installed PWM creation must use the actual shared WASM renderer');
  pwmChip.write(1,522);pwmChip.write(0,5);pwmChip.write(4,200);
  const before=pwmChip.saveState();
  const pcm=pwmChip.generateStereo(1024);
  assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
  assert(pcm.left.some(value=>Math.abs(value)>.001),'Installed PWM is inaudible');
  pwmChip.loadState(before);
  assert.deepEqual(pwmChip.generateStereo(1024),pcm,'Installed PWM snapshot must preserve exact phase/FIFO');
}finally{pwmChip.dispose();}
for(const name of ['ym3526','ym3812','y8950','ymf262']) {
  const chip = await createSoundChip(name);
  try {
    const synth = new OPLSynth({chip:name,transport:new OPLDirectTransport(chip,{chip:name})});
    synth.initialize();synth.setPreset(0,OPL_PRESETS.sine);synth.noteOn(0,'A4');
    const pcm=chip.generateStereo(4096);
    assert.ok(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
    assert.ok(pcm.left.some(value=>Math.abs(value)>.001),name+' must produce audible installed-package PCM');
    synth.allNotesOff();
  } finally {chip.dispose();}
}
const opllChip=await createSoundChip('ym2413');
try {
  assert.equal(YM2413_INSTRUMENTS.length,16);
  const synth=new YM2413Synth({transport:new YM2413DirectTransport(opllChip)});
  synth.initialize();synth.setPreset(8,{userPatch:YM2413_USER_PRESETS.sine,attenuation:3});synth.noteOn(8,'A4');
  const pcm=opllChip.generateStereo(8192);
  assert(pcm.left.every(Number.isFinite)&&pcm.left.some(value=>Math.abs(value)>.001),'installed OPLL custom voice is inaudible');
  assert.deepEqual(pcm.left,pcm.right,'OPLL is mono, copied to both output channels');
  synth.allNotesOff();
} finally {opllChip.dispose();}
const ayChip=await createSoundChip('ay8910');
try {
  const synth=new AY8910Synth({transport:new AY8910DirectTransport(ayChip)});
  synth.initialize();synth.tone(2,{note:'A4',volume:9});
  const pcm=ayChip.generateStereo(8192);
  assert(pcm.left.every(Number.isFinite)&&Math.max(...pcm.left)-Math.min(...pcm.left)>.001,'installed AY tone must have audible AC, not just its native DAC offset');
  assert.deepEqual(pcm.left,pcm.right,'AY mono is copied to both output channels');
  synth.allNotesOff();
} finally {ayChip.dispose();}
// Exercise the public generic entry with the actual installed WASM. Two
// additional chips deliberately share one Emscripten module, not one handle.
const wsChip=await createSoundChip('wonderswan');
let wsCustom,wsSibling;
try {
  assert(wsChip instanceof WonderSwan,'Generic WonderSwan creation must return the raw core wrapper');
  assert.equal(wsChip.clock,WONDERSWAN_CLOCK);assert.equal(wsChip.sampleRate(),44100);
  assert.equal(wsChip.mixer,undefined,'Direct WonderSwan PCM is not implicitly calibrated');
  assert.equal(typeof wsChip.id,'string');
  assert.equal(Object.getOwnPropertyDescriptor(wsChip,'id').writable,false);
  assert.throws(()=>{wsChip.id='replacement';},TypeError);
  const module=await wonderswanModuleFactory({wasmBinary:await readFile(runtimeAssetUrl('generated/wonderswan_wasm.wasm'))});
  const moduleOptions={tetoricaPackageFixture:true};
  let injectedCalls=0;
  const injectedFactory=options=>{
    assert.notEqual(options,moduleOptions,'The wrapper must not pass the caller-owned options object');
    assert.equal(options.tetoricaPackageFixture,true);injectedCalls++;return module;
  };
  wsCustom=await createSoundChip('wonderswan',{execution:'direct',moduleFactory:injectedFactory,moduleOptions,clock:3200011,sampleRate:48000,id:'installed-ws-custom'});
  wsSibling=await createSoundChip('wonderswan',{moduleFactory:injectedFactory,moduleOptions});
  assert.equal(injectedCalls,2,'The supplied factory is used for each creation');
  assert.equal(wsCustom.clock,3200011);assert.equal(wsCustom.sampleRate(),48000);
  assert.equal(wsCustom.id,'installed-ws-custom');
  assert.equal(new Set([wsChip.id,wsCustom.id,wsSibling.id]).size,3,'Created chips have distinct IDs');
  wsCustom.loadMemory(new Uint8Array([0x10,0x32,0x54,0x76]),0x3ffc);
  wsCustom.writeMemory(0x3fff,0xab);wsCustom.writeRegister(0x8f,0x3f);
  assert.equal(wsCustom.readMemory(0x3fff),0xab);assert.equal(wsCustom.readRegister(0x8f),0x3f);
  assert.equal(wsSibling.readMemory(0x3fff),0,'Shared-module handles own independent RAM');
  assert.equal(wsSibling.readRegister(0x8f),0,'Shared-module handles own independent registers');
  const wave=Array.from({length:32},(_,index)=>index<16?index:31-index);
  const synths=[wsChip,wsCustom,wsSibling].map(core=>new WonderSwanSynth({transport:new WonderSwanDirectTransport(core),clock:core.clock}));
  for(let index=0;index<synths.length;index++){
    const core=[wsChip,wsCustom,wsSibling][index],synth=synths[index];
    synth.initialize();synth.setWaveform(0,wave);synth.noteOn(0,'A4');
    assert.equal(core.readMemory(0),0x10,'Synth uploads packed low-nibble-first wave RAM');
    const pcm=core.generateStereo(4096);
    assert(pcm.left.every(Number.isFinite)&&pcm.right.every(Number.isFinite));
    assert(Math.max(...pcm.left)-Math.min(...pcm.left)>.001,'Installed WonderSwan must render audible AC PCM');
    assert.deepEqual(pcm.left,pcm.right,'Equal headphone volumes render centered PCM');
  }
  wsCustom.writeMemory(0,0x76);assert.equal(wsSibling.readMemory(0),0x10);
  wsChip.setChannelMuted(0,true);
  assert(wsChip.generateStereo(256).left.every(value=>value===0),'Channel monitoring mute suppresses the only active voice');
  wsChip.setChannelMuted(0,false);
  const view=wsChip.generateStereoView(128);
  assert.equal(view.left.length,128);assert.equal(view.right.length,128);
  wsChip.generateStereoInto(new Float32Array(128),new Float32Array(128),128);
  synths[0].dispose();
  assert.equal(wsChip.sampleRate(),44100,'Disposing a DirectTransport synth does not destroy its borrowed core');
  wsCustom.dispose();wsCustom.dispose();
  assert.throws(()=>wsCustom.readMemory(0),/disposed/);
  assert.throws(()=>wsCustom.generateStereo(128),/disposed/);
  const survivingPcm=wsSibling.generateStereo(512);
  assert(Math.max(...survivingPcm.left)-Math.min(...survivingPcm.left)>.001,'Disposing a shared-module peer leaves this chip playing');
  synths[1].dispose();synths[2].dispose();
} finally {wsChip.dispose();wsCustom?.dispose();wsSibling?.dispose();}
// Two POKEY handles can share one module heap without sharing chip state.
const pokeyModule=await pokeyModuleFactory({wasmBinary:await readFile(runtimeAssetUrl('generated/pokey_wasm.wasm'))});
const pokeyA=await createSoundChip('pokey',{id:'installed-pokey-a',moduleFactory:()=>pokeyModule,sampleRate:48000});
const pokeyB=await createSoundChip('pokey',{id:'installed-pokey-b',moduleFactory:()=>pokeyModule,sampleRate:48000});
const pokeyReference=await createSoundChip('pokey',{moduleFactory:()=>pokeyModule,sampleRate:48000});
try {
  assert(pokeyA instanceof Pokey);assert.equal(pokeyA.clock,POKEY_CLOCK);assert.equal(pokeyA.sampleRate(),48000);
  assert.equal(pokeyA.mixer,undefined,'Direct PCM has no implicit Mixer calibration');
  assert.equal(new Set([pokeyA.id,pokeyB.id,pokeyReference.id]).size,3);
  assert.equal(Object.getOwnPropertyDescriptor(pokeyA,'id').writable,false);
  const synths=[pokeyA,pokeyB,pokeyReference].map(core=>new PokeySynth({transport:new PokeyDirectTransport(core)}));
  for(const synth of synths){synth.initialize();synth.setVolume(0,6);synth.noteOn(0,'A4');}
  for(const core of [pokeyA,pokeyB,pokeyReference]) {
    const pcm=core.generateStereo(4096);assert.deepEqual(pcm.left,pcm.right,'One POKEY is mono');
    assert(pcm.left.every(Number.isFinite)&&Math.max(...pcm.left)-Math.min(...pcm.left)>.001,'Installed POKEY produces varying PCM');
    assert.equal(typeof core.readRegister(10),'number');
  }
  pokeyA.setChannelMuted(0,true);assert(pokeyA.generateStereo(256).left.every(value=>value===0));
  pokeyA.reset();pokeyA.dispose();
  assert.deepEqual(pokeyB.generateStereo(512),pokeyReference.generateStereo(512),'Peer mute/reset/disposal preserve POKEY continuation');
  for(const synth of synths)synth.dispose();
}finally{pokeyA.dispose();pokeyB.dispose();pokeyReference.dispose();}
assert.equal(typeof globalThis.AudioContext, 'undefined');
const {MegaSynthNode} = await import('tetorica-fm2612/node');
const nodeSynth = new MegaSynthNode();
assert.equal(nodeSynth.state, 'idle');
await nodeSynth.start();
assert.equal(nodeSynth.state, 'ready');
assert.equal((await nodeSynth.getState()).output, null);
await nodeSynth.fm.setPreset(0, FM_PRESETS.sine);
await nodeSynth.fm.noteOn(0, 4, 553);
const offlineNodePCM = await nodeSynth.render(512);
assert.ok(offlineNodePCM.left.some(value => Math.abs(value) > .001));
await nodeSynth.close();
assert.equal(nodeSynth.state, 'closed');
const {MegaSynth} = await import('tetorica-fm2612/megasynth');
const mega = new MegaSynth();
assert.equal(mega.audioContext, null);
await access(new URL(mega.workletUrl));
await access(new URL(mega.ym2612WasmUrl));
const cd = new MegaSynth({megaCD: true});
assert.equal(cd.pcm, null);
assert.equal(cd.audioContext, null);
await access(new URL(cd.rf5c164WorkletUrl));
await access(new URL(cd.rf5c164WasmUrl));
await access(new URL(cd.segaPsgWasmUrl));
const {createTetoricaSynth} = await import('tetorica-fm2612/tetorica_synth');
assert.equal(createTetoricaSynth({megaCD: true}).capabilities.pcmChannels, 8);
for (const name of ['ym2203synth', 'ym2608synth', 'ym2610bsynth', 'playground_runtime', 'tetorica_audio_runtime', 'vgm_runtime']) {
  await import('tetorica-fm2612/' + name);
}
for (const path of ['ym2612-worklet.js', 'playground_logic_worker.js', 'generated/segapsg_wasm.wasm', 'generated/nesapu_wasm.js', 'generated/nesapu_wasm.wasm', 'generated/pwm32x_wasm.js', 'generated/pwm32x_wasm.wasm', 'native_audio_effect.wasm', 'tetorica_ym2608_adpcm_rom.bin']) {
  await access(runtimeAssetUrl(path));
}
await import('tetorica-fm2612/generated/ym2612_wasm.js');
assert.equal(runtimeAssetUrl('ym2612-worklet.js', 'https://example.test/vendor/').href, 'https://example.test/vendor/ym2612-worklet.js');
assert.throws(() => runtimeAssetUrl('../outside.js'), TypeError);
console.log('Installed package verified: module exports, audible Synth PCM, browser entry imports and asset URLs.');
`);
  execFileSync(process.execPath, [join(consumer, 'check.mjs')], {cwd: consumer, stdio: 'inherit'});
  await writeFile(join(consumer, 'native-check.mjs'), String.raw`
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSoundChip} from 'tetorica-fm2612';
import {runtimeAssetUrl} from 'tetorica-fm2612/assets';
import {createHuc6280Client,createPrimaryHuc6280Api} from 'tetorica-fm2612/playground_huc6280';
import {Huc6280VoiceInspector} from 'tetorica-fm2612/playground_huc6280_inspector';
import {Ym2151VoiceInspector} from 'tetorica-fm2612/playground_ym2151_inspector';
import {Oki6258VoiceInspector} from 'tetorica-fm2612/playground_okim6258_inspector';
import {Oki6258AudioEngine} from 'tetorica-fm2612/okim6258audioengine';
import {Oki6258Stream,encodeOki6258,summarizeOki6258} from 'tetorica-fm2612/okim6258synth';
import okiFactory from 'tetorica-fm2612/generated/okim6258_wasm.js';
import {GameboySynth,GameboyDirectTransport} from 'tetorica-fm2612/gameboysynth';
import {createSampleEdit,renderSampleEdit,renderGameboyWave,encodeSampleWav,decodeSampleWav} from 'tetorica-fm2612/playground_sample_edit';
import {createSampleInstrument} from 'tetorica-fm2612/playground_sample_instrument';
import {createMusicalKeyboard,keyboardBinding,registerKeyboardScope} from 'tetorica-fm2612/playground_keyboard';
const peak=values=>values.reduce((best,value)=>Math.max(best,Math.abs(value)),0);
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);
const pitch=(values,rate)=>{
  const mean=values.reduce((sum,value)=>sum+value,0)/values.length,crossings=[];
  for(let index=1;index<values.length;index++)if(values[index-1]<mean&&values[index]>=mean)crossings.push(index-1+(mean-values[index-1])/(values[index]-values[index-1]));
  return crossings.length>2?(crossings.length-1)*rate/(crossings.at(-1)-crossings[0]):0;
};
// A minimal host loads the installed, unmodified processor module. Its real
// Client, performance queue, Inspector, generated loader and WASM all execute.
const previousGlobals=Object.fromEntries(['sampleRate','currentFrame','AudioWorkletProcessor','registerProcessor'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let processor,client,resolveReady,rejectReady,Processor;
const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
Object.assign(globalThis,{sampleRate:48000,currentFrame:0,
  AudioWorkletProcessor:class {constructor(){this.port={postMessage(data){if(data.ready)resolveReady();if(data.error)rejectReady(new Error(data.error));}};}},
  registerProcessor(name,Type){assert.equal(name,'tetorica-huc6280');Processor=Type;},
});
try {
  await import('tetorica-fm2612/playground_huc6280_worklet');
  processor=new Processor({processorOptions:{clock:3579545,wasmBinary:await readFile(runtimeAssetUrl('generated/huc6280_wasm.wasm'))}});
  await ready;
  const port={postMessage(data){processor.receive(data,{postMessage(reply){port.onmessage?.({data:reply});}});},close(){}};
  client=createHuc6280Client(port);
  const primary=createPrimaryHuc6280Api(client);
  const render=frames=>{const channels=[new Float32Array(frames),new Float32Array(frames)];processor.process([],[channels]);globalThis.currentFrame+=frames;return channels;};
  let sequence=0;
  const admin=(action,method,args=[])=>{
    let reply;const id='npm-inspector:'+ ++sequence;
    processor.receive({type:'chip-inspector',id,action,method,args},{postMessage(value){if(value.id===id)reply=value;}});
    assert(reply,'Inspector admin request was not answered');if(reply.error)throw new Error(reply.error);return reply.value;
  };
  primary.initialize();
  const wave=Array.from({length:32},(_,index)=>Math.round(15.5+15.5*Math.sin(index*Math.PI/16)));
  primary.setWaveform(0,wave);primary.setVolume(0,26);primary.setPan(0,15,15);primary.noteOn(0,'A4');
  const pcm=render(48000);assert(pcm[0].every(Number.isFinite)&&rms(pcm[0])>.01,'installed PCE core is inaudible');assert.deepEqual(pcm[0],pcm[1]);assert(Math.abs(pitch(pcm[0],48000)-440)<3,'installed PCE musical pitch');
  const state=admin('read');assert.equal(state.channels.length,6);assert.deepEqual(state.channels[0].waveform,wave);assert(state.channels[0].active&&state.channels[0].waveformKnown);
  const latch=processor.selectedChannel,queued=processor.performance.getStats();admin('read');admin('read');assert.equal(processor.selectedChannel,latch,'Inspector read changes no channel latch');assert.deepEqual(processor.performance.getStats(),queued,'Inspector read changes no scheduled audio');
  admin('invoke','setVoice',[0,{pan:{right:0}}]);assert.equal(admin('read').channels[0].pan.left,15,'partial pan keeps left');assert.equal(peak(render(1024)[1]),0,'installed Inspector reaches native stereo routing');
  admin('invoke','auditionOn',[0,81,'first']);primary.noteOn(0,'C4');primary.keyOff(0);let held=admin('read').channels[0];assert(held.active&&Math.abs(held.frequency-880)<5,'script cannot steal the Inspector audition');assert(Math.abs(pitch(render(24000)[0],48000)-880)<5);
  admin('invoke','auditionOn',[0,69,'replacement']);admin('invoke','auditionOff',[0,'first']);held=admin('read').channels[0];assert(held.active&&Math.abs(held.frequency-440)<3,'old audition release cannot stop its replacement');
  admin('invoke','auditionOff',[0,'replacement']);assert.equal(peak(render(512)[0]),0,'installed Inspector keyOff leaves no PCM');assert.deepEqual(admin('read').channels[0].waveform,wave,'keyOff retains Wave RAM');
  assert(processor.inspector instanceof Huc6280VoiceInspector);
} finally {
  client?.dispose();processor?.dispose();
  for(const [key,descriptor] of Object.entries(previousGlobals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
}
// Constructor hooks are part of the published typed surface, not ambient UI globals.
let opm;
opm=new Ym2151VoiceInspector({clock:()=>4000000,sampleRate:48000,dispatch(command){if(command.method==='writeRegister')opm.observeWrite(...command.args);}});
opm.invoke('setOperator',[0,1,{mul:3,dt1:5}]);assert.equal(opm.read().registers[0x50]&15,3);assert.equal(opm.read().channels[0].operators[1].dt1,5);
const okiBinary=await readFile(runtimeAssetUrl('generated/okim6258_wasm.wasm'));
const okiEngine=await Oki6258AudioEngine.create({moduleFactory:()=>okiFactory({wasmBinary:okiBinary}),clock:8000000,flags:12,outputSampleRate:48000});
try {
  const stream=new Oki6258Stream(okiEngine,{clock:8000000});
  const oki=new Oki6258VoiceInspector(stream,{sampleRate:48000,dispatch(command){
    if(command.method==='writeRegister')stream.writeRegister(...command.args);
    else if(command.method==='play')stream.play(...command.args);
    else if(command.method==='stop')stream.stop();
    else if(command.method==='setRepeat')stream.repeat=command.args[0];
    else throw new Error('Unexpected OKI consumer command: '+command.method);
  }});
  const source={channels:[Float32Array.from({length:4000},(_,index)=>.3*Math.sin(2*Math.PI*440*index/16000))],sampleRate:16000};
  const encoded=encodeOki6258(source,15625),metadata={...summarizeOki6258(encoded.bytes),name:'npm-recording',sampleRate:15625,source:'sample'};
  oki.loadMemory(encoded.bytes,metadata);oki.invoke('setVoice',[{repeat:true,pan:{right:false}}]);oki.invoke('auditionOn',[0,69,'oki-first']);
  let left=new Float32Array(4096),right=new Float32Array(4096);stream.process(left,right);assert(rms(left)>.01&&peak(right)===0,'installed OKI sample decoder/pan is inaudible');assert(Math.abs(pitch(left,48000)-440)<15,'installed OKI sample pitch');
  oki.invoke('auditionOn',[0,81,'oki-replacement']);oki.invoke('auditionOff',[0,'oki-first']);assert(oki.read().playing&&oki.read().playbackRate===15625,'OKI Guitar pads retain the sample rate and reject old releases');
  const loaded=oki.read().sample;assert(loaded.waveform.length>8&&loaded.waveform.length<=512);oki.invoke('auditionOff',[0,'oki-replacement']);stream.process(left,right);assert.equal(peak(left),0,'OKI stop retains DC or a release tail');assert.deepEqual(oki.read().sample,loaded,'OKI stop discards recording metadata');
} finally {okiEngine.dispose();}
const input={channels:[Float32Array.from({length:128},(_,index)=>.6*Math.sin(2*Math.PI*index/128))],sampleRate:32000};
const original=input.channels[0].slice(),edit=createSampleEdit(input,{settings:{startFrame:16,endFrame:112,gainDb:-6,rootMidi:69}}),edited=renderSampleEdit(input,edit,{maxFrames:96});
assert.equal(edited.channels[0].length,96);assert(peak(edited.channels[0])<.31);assert.deepEqual(input.channels[0],original,'sample editing mutates no original PCM');
const restored=await decodeSampleWav(encodeSampleWav(input));assert.deepEqual(restored.channels,input.channels,'Float WAV preserves the original exactly');assert.equal(restored.sampleRate,input.sampleRate);
const gb=await createSoundChip('gameboy');
try {
  const gameboy=new GameboySynth({transport:new GameboyDirectTransport(gb)});gameboy.initialize();
  const pg={gameboy};let context=null;
  const getContext=()=>context,setContext=value=>{context=value;};registerKeyboardScope(pg,getContext,setContext);
  const audio={...input,rootMidi:69,waveform:renderGameboyWave(input,{})};
  const instrument=await createSampleInstrument({pg,audio,chip:'gameboy',volume:255});assert.equal(peak(gb.generateStereo(512).left),0,'sample preparation never auto-plays');
  const keyboard=createMusicalKeyboard({getContext,setContext});await keyboard.commit(keyboardBinding('npm-guitar',instrument));
  const old=keyboard.target;await old.noteOn({id:'fret-a',midi:69,velocity:127});assert(rms(gb.generateStereo(2048).left)>.01,'installed Guitar/sample instrument is inaudible');
  await old.noteOn({id:'fret-b',midi:81,velocity:100});await old.noteOff({id:'fret-a',midi:69});assert(rms(gb.generateStereo(2048).left)>.01,'older Guitar key releases the replacement voice');
  await keyboard.clear();gb.generateStereo(8192);assert(peak(gb.generateStereo(512).left)<.001,'retiring a keyboard leaves no sample voice');
  await keyboard.commit(keyboardBinding('npm-guitar-next',instrument));await keyboard.target.noteOn({id:'fresh',midi:69});await old.allNotesOff();await old.noteOn({id:'stale',midi:81});assert(rms(gb.generateStereo(2048).left)>.01,'retired Guitar target changes the new Run');await keyboard.clear();
}finally{gb.dispose();}
assert.equal(typeof globalThis.AudioContext,'undefined');
console.log('Installed native/sample package verified: real HuC6280 Client/Worklet/WASM/Inspector PCM, OPM operator mapping, OKI recorded-sample PCM, musical pitch, channel leases, source-preserving sample edits, Float WAV, Game Boy sampler and Guitar retirement.');
`);
  execFileSync(process.execPath, [join(consumer, 'native-check.mjs')], {cwd: consumer, stdio: 'inherit'});
  await writeFile(join(consumer, 'native-types.mts'), `
import {createSoundChip,SoundChipMixer,SOUNDCHIP_MIXER_PRESETS} from 'tetorica-fm2612';
import {Huc6280VoiceInspector} from 'tetorica-fm2612/playground_huc6280_inspector';
import {Ym2151VoiceInspector} from 'tetorica-fm2612/playground_ym2151_inspector';
import {Oki6258VoiceInspector} from 'tetorica-fm2612/playground_okim6258_inspector';
import {GameboyVoiceInspector,NesVoiceInspector} from 'tetorica-fm2612/playground_native_voice_inspector';
import type {Oki6258Stream} from 'tetorica-fm2612/okim6258synth';
import {createSampleEdit,renderSampleEdit} from 'tetorica-fm2612/playground_sample_edit';
import {createSampleInstrument} from 'tetorica-fm2612/playground_sample_instrument';
declare const stream: Oki6258Stream;
const sourceMixer=new SoundChipMixer(SOUNDCHIP_MIXER_PRESETS.calibrated);
const sourceUnits:'source'|'legacy'=sourceMixer.gainUnits;
void sourceUnits;
// @ts-expect-error A connected Mixer cannot change the meaning of its gains.
sourceMixer.gainUnits='legacy';
// @ts-expect-error Only supported gain units are accepted.
new SoundChipMixer({gainUnits:'invented'});
new Huc6280VoiceInspector({clock:()=>3579545,sampleRate:48000,dispatch(command,owner,metadata){const method:string=command.method;const id:string|undefined=owner;const preserve:boolean|undefined=metadata?.preserveOwner;void [method,id,preserve];}});
new Ym2151VoiceInspector({clock:4000000,dispatch(command){const method:string=command.method;void method;},beginAudition(channel,owner){const voice:number=channel;const id:string=owner;void [voice,id];}});
new Oki6258VoiceInspector(stream,{sampleRate:48000,dispatch(command){const method:string=command.method;void method;}});
new GameboyVoiceInspector(await createSoundChip('gameboy'),{clock:4194304,dispatch(command){const method:string=command.method;void method;}});
new NesVoiceInspector(await createSoundChip('nes',{fds:true}),{clock:()=>1789773,dispatch(command){const method:string=command.method;void method;}});
const audio={channels:[new Float32Array(128)],sampleRate:32000};
const edit=createSampleEdit(audio,{settings:{rootMidi:69}});
renderSampleEdit(audio,edit,{sampleRate:16000,mono:true,maxFrames:65504});
await createSampleInstrument({pg:{},audio,chip:'gameboy',target:'gameboy-wave',volume:255});
// @ts-expect-error Clocks are integer Hz, not formatted strings.
new Huc6280VoiceInspector({clock:'3.58 MHz'});
// @ts-expect-error Native dispatch is a callback.
new Ym2151VoiceInspector({dispatch:true});
// @ts-expect-error Frame bounds are numeric.
renderSampleEdit(audio,edit,{maxFrames:'1000'});
// @ts-expect-error Only implemented instrument targets are accepted.
await createSampleInstrument({pg:{},audio,target:'invented-sampler'});
// @ts-expect-error Sample volume is numeric.
await createSampleInstrument({pg:{},audio,volume:'255'});
`);
  for (const resolution of ['NodeNext','Bundler']) {
    await writeFile(join(consumer, 'native-tsconfig.json'), JSON.stringify({compilerOptions:{
      strict:true,noEmit:true,skipLibCheck:false,target:'ES2022',module:resolution==='NodeNext'?'NodeNext':'ESNext',moduleResolution:resolution,
      types:['node'],typeRoots:[join(root,'node_modules/@types')],
    },files:['native-types.mts']}));
    execFileSync(process.execPath, [join(root,'node_modules/typescript/bin/tsc'),'-p',join(consumer,'native-tsconfig.json')], {cwd:consumer,stdio:'inherit'});
  }
  execFileSync(process.execPath, [join(root, 'scripts/check_fm2612_types.mjs'), installed], {cwd: consumer, stdio: 'inherit'});
  if(process.argv.includes('--browser')){
    execFileSync(process.execPath,[join(root,'scripts/check_fm2612_dx7_browser.cjs'),installed],{cwd:consumer,stdio:'inherit'});
    execFileSync(process.execPath,[join(root,'scripts/check_playground_huc6280_voice_browser.cjs'),'--package',installed],{cwd:consumer,stdio:'inherit'});
  }
  console.log(`Tarball: ${packed.size} bytes compressed, ${packed.unpackedSize} bytes unpacked, ${packed.files.length} files.`);
} finally {
  if (process.env.FM2612_KEEP_PACKAGE_CHECK === '1') {
    console.log(`Package-check artifacts retained at ${scratch}`);
  } else {
    await rm(scratch, {recursive: true, force: true});
  }
}
