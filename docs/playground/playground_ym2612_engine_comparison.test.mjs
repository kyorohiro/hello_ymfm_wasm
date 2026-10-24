import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YM2612Synth} from '../../web/ym2612synth.js';
import {FM_PRESETS} from '../../web/megasynth-fm-presets.js';
import {MODE_STARTERS,selectModeExamples} from './playground_mode_examples.js';

const path='/examples/genesis/ym2612-engine-comparison.js';
const source=await readFile(new URL('.'+path,import.meta.url),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;

function harness({workerLookaheadSeconds=.5,cancelAt,failSetup=false}={}) {
  const events=[],created=[],active=new Set(),retiring=new Set(),logs=[],sleeps=[];
  const stopped=new Error('Run stopped');let pending=0,timingReads=0,clears=0;
  const gap=Math.max(.35,workerLookaheadSeconds+.1),presetsBefore=JSON.stringify(FM_PRESETS);
  const run=()=>new AsyncFunction('createSoundChip','FM_PRESETS','sleep','getTiming','fx','log','mixer','setMasterVolume','context',source)(
    async(kind,options)=>{
      assert.equal(kind,'ym2612');assert.deepEqual(Object.keys(options),['engine']);
      assert.equal(active.size,0,'only one logical core at a time');assert.equal(retiring.size,0,'the previous Worker core must have passed its disposal horizon');
      const engine=options.engine,commands=[],calls=[];created.push({engine,commands,calls});active.add(engine);events.push(['create',engine]);
      const synth=new YM2612Synth({transport:{reset:()=>commands.push(['reset']),write:(port,register,value)=>commands.push([port,register,value])}});
      return new Proxy(synth,{get(target,key){
        if(key==='then')return undefined;
        if(key==='engine')return engine;
        return async(...args)=>{
          assert.equal(pending,0,'every command and disposal must be awaited');assert(active.has(engine),'no commands after disposal');pending++;
          try{
            await new Promise(resolve=>setImmediate(resolve));calls.push([key,...args]);events.push([key,engine]);
            if(key==='dispose'){active.delete(engine);if(workerLookaheadSeconds>0)retiring.add(engine);return;}
            if(failSetup&&key==='setPreset')throw new Error('setup failed');
            return target[key](...args);
          }finally{pending--;}
        };
      }});
    },
    FM_PRESETS,
    async seconds=>{
      assert.equal(pending,0);sleeps.push(seconds);events.push(['sleep',seconds]);
      if(seconds===cancelAt)throw stopped;
      if(active.size===0){assert.equal(seconds,gap);assert(seconds>workerLookaheadSeconds);retiring.clear();}
      else assert(seconds===.3||seconds===.08);
    },
    async()=>{timingReads++;return Object.freeze({workerLookaheadSeconds});},
    {async setChain(chain){assert.deepEqual(chain,[]);clears++;}},
    message=>logs.push(message),
    new Proxy({},{get(){assert.fail('Example must preserve Mixer strips');}}),
    ()=>assert.fail('Example must preserve master volume'),
    new Proxy({},{get(){assert.fail('Example must not write shared runtime state');}}),
  );
  return {run,events,created,active,retiring,logs,sleeps,stopped,gap,presetsBefore,get timingReads(){return timingReads;},get clears(){return clears;}};
}

test('the standalone YM2612 engine comparison is selectable in every Genesis-family catalog',()=>{
  const file={path};
  const paths=new Set(Object.values(MODE_STARTERS).flatMap(mode=>mode.examples??[]));
  const files=[...paths].map(path=>({path}));files[files.findIndex(entry=>entry.path===path)]=file;
  for(const mode of ['genesis','genesis-nuked','mega-cd','genesis-full','genesis-full-nuked'])assert(selectModeExamples(files,mode).includes(file),mode);
  for(const mode of ['pc98','neogeo-b','gameboy','snes'])assert(!selectModeExamples(files,mode).includes(file),mode);
  assert.doesNotMatch(source,/\bliveLoop\s*\(|\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\bmixer\s*\.|\bsetMasterVolume\s*\(/);
});

test('ymfm and Nuked play exactly the same patch and melody across all six logical channels without overlapping lifetimes',async()=>{
  const h=harness();await h.run();assert.deepEqual(h.created.map(chip=>chip.engine),['ymfm','nuked']);
  const [ymfm,nuked]=h.created;assert.deepEqual(ymfm.commands,nuked.commands,'all real Synth register commands are identical between engines');
  assert.deepEqual(ymfm.calls,nuked.calls);assert.equal(JSON.stringify(FM_PRESETS),h.presetsBefore,'the bundled reference preset stays unchanged');
  for(const chip of h.created){
    const patches=chip.calls.filter(([method])=>method==='setPreset');assert.deepEqual(patches.map(([,channel])=>channel),[0,1,2,3,4,5]);
    assert(patches.every(([, ,preset])=>preset===FM_PRESETS['one-op-basic']));
    assert.deepEqual(chip.calls.filter(([method])=>method==='noteOn').map(([,channel,note])=>[channel,note]),[[0,'C4'],[1,'E4'],[2,'G4'],[3,'B4'],[4,'C5'],[5,'G4']]);
    assert.deepEqual(chip.commands.filter(command=>command[0]===0&&command[1]===0x28&&(command[2]&240)).map(command=>command[2]&7),[0,1,2,4,5,6],'logical CH4–6 map to the actual YM2612 key codes');
    assert.equal(chip.calls.filter(([method])=>method==='dispose').length,1);
  }
  assert.equal(h.timingReads,1);assert.equal(h.clears,1);assert.equal(h.sleeps.filter(seconds=>seconds===.3).length,12);assert.equal(h.sleeps.filter(seconds=>seconds===.08).length,12);
  assert.equal(h.logs[0],'YM2612 engine comparison 1/2: ymfm · FM1–6');assert.equal(h.logs[1],'YM2612 engine comparison 2/2: nuked · FM1–6');assert.equal(h.logs.at(-1),'YM2612 engine comparison complete: 2/2');
  assert.equal(h.active.size,0);assert.equal(h.retiring.size,0);assert.equal(h.sleeps.at(-1),h.gap);
});

test('zero, ordinary and maximum Worker lookahead gaps retire each core including the last',async()=>{
  for(const workerLookaheadSeconds of [0,.5,2]){
    const h=harness({workerLookaheadSeconds});await h.run();assert.equal(h.sleeps.filter(seconds=>seconds===h.gap).length,2);assert.equal(h.sleeps.at(-1),h.gap);assert.equal(h.retiring.size,0);
  }
});

test('Stop during a held note only disposes the current core and never writes another release or starts Nuked',async()=>{
  const h=harness({cancelAt:.3});await assert.rejects(h.run(),error=>error===h.stopped);
  const wait=h.events.findIndex(([method])=>method==='sleep');assert.deepEqual(h.events.slice(wait+1),[['dispose','ymfm']]);
  assert.equal(h.active.size,0);assert.equal(h.created.length,1);assert(!h.logs.some(message=>message.includes('complete')));
});

test('Stop during release or disposal gap cannot create the next core',async()=>{
  for(const cancelAt of [.08,.6]){
    const h=harness({cancelAt});await assert.rejects(h.run(),error=>error===h.stopped);assert.equal(h.created.length,1);assert.equal(h.active.size,0);assert.equal(h.created[0].calls.filter(([method])=>method==='dispose').length,1);
  }
});

test('a failing setup still disposes the incomplete core exactly once',async()=>{
  const h=harness({failSetup:true});await assert.rejects(h.run(),/setup failed/);
  assert.deepEqual(h.events,[['create','ymfm'],['reset','ymfm'],['setPreset','ymfm'],['dispose','ymfm']]);assert.equal(h.active.size,0);assert.equal(h.sleeps.length,0);
});
