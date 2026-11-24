import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../tetorica_src/cli/index.js';
import {getNodePlaybackFactory} from '../tetorica_src/cli/render.js';
import {Ym2610BAudioEngine} from '../docs/js/ym2610baudioengine.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {createPlaybackPlayer,selectPlaybackConfiguration} from '../docs/vgm_analyzer/playback_core.js';
import {installPlaybackMixer} from '../docs/vgm_analyzer/playback_mixer.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
import {prepareFm2610Vgm} from '../docs/synth-fm2610/vgm.js';
import {isFm2610Channel3Special,readFm2610Patch} from '../docs/synth-fm2610/fm_patch.js';
const fixture=(chip,name)=>new URL(`./fixtures/${chip}-${name}.vgz`,import.meta.url);
for(const chip of ['ym2610','ym2610b'])test(`${chip} FM/SSG/ADPCM-A/B and mix match the Browser engine`,async()=>{
  const outputs=[];
  for(const name of ['fm','ssg','adpcm-a','adpcm-b','mix']) {
    const source=await readSource(fixture(chip,name));
    const result=await renderSource(source,{maxSeconds:.05});
    assert.deepEqual(result.warnings,[]);
    assert(result.bytes.subarray(44).some(v=>v!==0),name);
    outputs.push(result.bytes);
    const engine=await Ym2610BAudioEngine.create({moduleFactory:await getNodePlaybackFactory('ym2610b'),clock:8000000,variant:chip==='ym2610b'});
    try {
      // CLI rendering installs the Analyzer's calibrated source mixer. Use the
      // same boundary for the manually assembled Browser reference engine.
      installPlaybackMixer(engine,selectPlaybackConfiguration(new Ym2612VGM(source)));
      const player=createPlaybackPlayer(engine,source);player.play();
      assert.deepEqual(result.bytes,(await renderVgmToWav(player,{maxSeconds:.05})).bytes);
    }finally{engine.dispose();}
  }
  for(const output of outputs.slice(0,-1))assert.notDeepEqual(outputs.at(-1),output);
});
test('YM2610B enables extra FM channels while YM2610 does not',async()=>{
  for(const chip of ['ym2610','ym2610b']) for(const name of ['extra-fm','extra-fm4']) {
    const result=await renderSource(await readSource(fixture(chip,name)),{maxSeconds:.05});
    assert.equal(result.bytes.subarray(44).some(v=>v!==0),chip==='ym2610b');
  }
});
test('YM2610 variants reject dual chips, invalid flags and invalid embedded ROM ranges',async()=>{
  for(const chip of ['ym2610','ym2610b']) {
    const original=await readSource(fixture(chip,'adpcm-a'));
    for(const [offset,value] of [[0x4c,(chip==='ym2610b'?0xc0000000:0x40000000)+8000000],[0x0c,3579545],[0x48,8000000]]) {
      const bad=original.slice();new DataView(bad.buffer).setUint32(offset,value,true);
      if(offset===0x4c) await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
      else assert((await renderSource(bad,{maxSeconds:.01})).bytes.subarray(44).some(Boolean));
    }
    const bad=original.slice();new DataView(bad.buffer).setUint32(267,256,true);
    await assert.rejects(renderSource(bad),/Invalid YM2610 ROM range/);
  }
});

function timedFmVgm(commands, ym2610b = false) {
  const dataOffset = 0x80;
  const source = new Uint8Array(dataOffset + commands.length);
  source.set([0x56,0x67,0x6d,0x20]);
  source.set(commands,dataOffset);
  const header = new DataView(source.buffer);
  header.setUint32(4,source.length - 4,true);
  header.setUint32(8,0x151,true);
  header.setUint32(0x34,dataOffset - 0x34,true);
  header.setUint32(0x4c,8000000 + (ym2610b ? 0x80000000 : 0),true);
  return source;
}

test('VGM FM presets retain the LFO setting when a voice uses modulation',async()=>{
  const attack = [0x58,0x28,0x01,0x58,0x28,0xf1,0x62]; // Retrigger CH2 and advance time.
  const commands = [
    0x58,0xb5,0xc7, // Enable pitch modulation sensitivity.
    0x58,0x22,0x0a,...attack,...attack,
    0x58,0x22,0x02,...attack,
    0x58,0x22,0x0f,0x58,0xb5,0xd0,...attack, // AMS alone has no effect.
    0x58,0x61,0x80,...attack, // Enable AM for OP1.
    0x66,
  ];
  const {presets} = await prepareFm2610Vgm(timedFmVgm(commands));
  assert.deepEqual(presets.map(({preset}) => preset.lfo),[
    {enabled:true,frequency:2},
    {enabled:false,frequency:2},
    undefined,
    {enabled:true,frequency:7},
  ]);
  assert.deepEqual(presets.map(({occurrences}) => occurrences),[2,1,1,1]);
});

test('VGM FM presets preserve CH3 Special pitches and group equivalent transpositions',async()=>{
  const registers = [[0xad,0xa9],[0xae,0xaa],[0xac,0xa8],[0xa6,0xa2]];
  const pitchWrites = (pitches) => pitches.flatMap(({block,fnum}, operator) => {
    const [high,low] = registers[operator];
    return [0x58,high,(block << 3) | (fnum >> 8),0x58,low,fnum & 255];
  });
  const original = [
    {block:1,fnum:640},{block:3,fnum:495},{block:3,fnum:730},{block:4,fnum:563},
  ];
  const transposed = original.map(({block,fnum}) => ({block:block + 1,fnum}));
  const different = original.map((pitch,index) => index === 1 ? {...pitch,fnum:496} : pitch);
  const noBase = [...original.slice(0,3),{block:4,fnum:0}];
  const attack = [0x58,0x28,0x02,0x58,0x28,0xb2,0x62];
  const commands = [
    ...attack,
    0x58,0x27,0x40,...pitchWrites(original),...attack,
    ...pitchWrites(transposed),...attack,
    ...pitchWrites(different),...attack,
    ...pitchWrites(noBase),...attack,
    0x58,0x27,0x00,...pitchWrites(transposed),...attack,
    0x66,
  ];
  for (const ym2610b of [false,true]) {
    const {presets} = await prepareFm2610Vgm(timedFmVgm(commands, ym2610b));
    assert.deepEqual(presets.map(({physicalChannel, firstSample, occurrences}) =>
      [physicalChannel, firstSample, occurrences]), [[2,0,2],[2,735,2],[2,2205,1],[2,2940,1]]);
    const [normal, special, changed, fallback] = presets.map(({preset}) => readFm2610Patch(JSON.parse(JSON.stringify(preset))));
    assert(!('specialFrequencies' in normal));
    assert(isFm2610Channel3Special(special));
    assert.deepEqual(special.specialFrequencies,original);
    assert.deepEqual(changed.specialFrequencies,different);
    assert.deepEqual(fallback.specialFrequencies,noBase);
    assert.equal(fallback.specialMode,false);
    assert.equal(special.keyMask,0xb);
    assert.match(presets[1].name,/CH3 Special/);
  }
});
