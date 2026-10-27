import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import createModule from '../generated/pokey_wasm.js';
import {Pokey} from '../../web/pokey.js';
import {PokeySynth, PokeyDirectTransport} from '../../web/pokeysynth.js';
import {MODE_STARTERS, selectModeExamples} from './playground_mode_examples.js';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const module=await createModule({wasmBinary:await readFile(new URL('../generated/pokey_wasm.wasm',import.meta.url))});
for(const mode of ['pokey','pokey-dual']) test(`${mode} starter/examples render through the real POKEY core and release their voices`,async()=>{
  const files=[`/defaults/${mode}/index.js`,...MODE_STARTERS[mode].examples];
  for(const path of files) {
    const chips=[],synths=[],loops=[];
    let varying=false;
    try {
      for(let i=0;i<(mode==='pokey-dual'?2:1);i++) {
        const chip=await Pokey.create({moduleFactory:()=>module,clock:mode==='pokey-dual'?1789773:1789790,sampleRate:48000});
        chips.push(chip);
        const synth=new PokeySynth({transport:new PokeyDirectTransport(chip)});synth.initialize();synths.push(synth);
      }
      const api={pokey:synths[0],...(synths[1]?{pokey2:synths[1]}:{}),setBpm:bpm=>assert(bpm>0),
        liveLoop:(_name,run)=>loops.push(run),beat:async beats=>{
          assert(beats>0);
          for(const chip of chips) {
            const {left,right}=chip.generateStereo(512);
            assert.deepEqual(left,right,'each physical chip is mono');
            if(left.some(value=>value!==left[0]))varying=true;
            assert(left.every(value=>Number.isFinite(value)&&value>=0&&value<1));
          }
        }};
      const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
      assert.doesNotMatch(source,/\bmixer\./,'examples keep the selected Mixer preset');
      await new AsyncFunction(...Object.keys(api),source)(...Object.values(api));
      assert.equal(loops.length,1,path);await loops[0]();assert(varying,path+' produces varying PCM');
      for(const synth of synths) for(let channel=0;channel<4;channel++) {
        assert.equal(synth.getRegisterSnapshot()[channel*2+1]&15,0,path+' releases all voices');
      }
      for(const chip of chips) assert(chip.generateStereo(512).left.every(value=>value===0),'released raw core is silent');
    } finally {for(const synth of synths)synth.dispose();for(const chip of chips)chip.dispose();}
  }
});

test('POKEY example catalogs keep the two-chip globals out of single-chip and Genesis projects',()=>{
  const all=Object.values(MODE_STARTERS).flatMap(mode=>mode.examples??[]).map(path=>({path}));
  for(const mode of ['pokey','pokey-dual']) {
    assert.equal(MODE_STARTERS[mode].examples.length,2);
    assert.deepEqual(selectModeExamples(all,mode).map(file=>file.path),MODE_STARTERS[mode].examples);
  }
  assert(selectModeExamples(all,'genesis').every(file=>!file.path.includes('/pokey/')));
});
