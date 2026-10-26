import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {AY8910Synth} from '../../web/ay8910synth.js';
import {MODE_STARTERS,selectModeExamples} from './playground_mode_examples.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
test('Atari ST starter and examples use only the primary YM2149 and release all voices',async()=>{
  for (const path of ['/defaults/atari-st/index.js',...MODE_STARTERS['atari-st'].examples]) {
    const writes=[],loops=[];
    const ay=new AY8910Synth({clock:2000000,transport:{writeRegister:(...args)=>writes.push(args),reset(){}}});
    ay.initialize();writes.length=0;
    const api={ay,setBpm:bpm=>assert.equal(bpm,120),liveLoop:(_name,run)=>loops.push(run),beat:async beats=>assert(beats>0)};
    const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/mixer\./,'examples retain the selected Mixer preset');
    await new AsyncFunction(...Object.keys(api),source)(...Object.values(api));
    assert.equal(loops.length,1,path);await loops[0]();
    const registers=ay.getRegisterSnapshot();
    assert(writes.length>0,path);
    for(let ch=0;ch<3;ch++)assert.equal(registers[8+ch]&31,0,`${path} silences CH${ch+1}`);
    if(path.includes('three-voices')||path.includes('/defaults/')) {
      for(let ch=0;ch<3;ch++)assert(writes.some(([reg,value])=>reg===8+ch&&value>0),`${path} plays CH${ch+1}`);
    }
    if(path.includes('tone-noise')) {
      assert.deepEqual(writes.filter(([reg])=>reg===6).map(([,value])=>value),[8,16,24,16]);
      assert.equal(registers[7]&63,10,'noise-only and mixed source routing survive note gates');
    }
    if(path.includes('shared-envelope'))assert.deepEqual(writes.filter(([reg])=>reg===13).map(([,value])=>value),[8,10,12,14],'shape is retriggered once per chord');
  }
});

test('Atari ST examples stay in their own catalog and Helper describes YM2149',async()=>{
  const files=MODE_STARTERS['atari-st'].examples.map(path=>({path}));
  assert.equal(files.length,3);
  assert.deepEqual(selectModeExamples(files,'atari-st'),files);
  assert.deepEqual(selectModeExamples(files,'genesis'),[]);
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  const helper=[...html.matchAll(/<p data-native-helper="ay8910"[^>]*>(.*?)<\/p>/g)].map(match=>match[1]).join('\n');
  assert.match(helper,/YM2149/);assert.match(helper,/2 MHz/);assert.match(helper,/useSoundChip\("ay8910"\)/);
  assert.match(helper,/STE DMA audio/);assert.match(helper,/<code>ay<\/code>/);
});
