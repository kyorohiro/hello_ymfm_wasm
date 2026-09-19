import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('stream warnings remain visible across status changes, deduplicate and clear for next song',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const panel={hidden:true,textContent:''},status={};
 const context=vm.createContext({document:{getElementById:()=>panel},status,console});
 vm.runInContext(source.slice(source.indexOf('const playbackWarnings ='),source.indexOf('function currentStatusSuffix')),context);
 const warning='Unsupported DAC stream skipped: AY (0x12), instance=0, stream=0. Playback continues without this stream.';
 context.reportPlaybackWarning(warning);context.reportPlaybackWarning(warning);
 context.setStatus('Streaming VGM...');
 assert.equal(panel.textContent,warning);assert.equal(panel.hidden,false);
 context.clearPlaybackWarnings();assert.equal(panel.hidden,true);assert.equal(panel.textContent,'');
 context.reportPlaybackWarning(warning);assert.equal(panel.hidden,false);
});

test('actual Player DAC warning reaches the persistent warning panel',async()=>{
 const {VgmPlayer}=await import('../../web/vgmplayer.js');
 const {vgmBytes}=await import('../../web/test-support/vgm-mock.js');
 const {MockSoundEngine,drainPlayer}=await import('../../web/test-support/vgm-engine-mock.js');
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const panel={hidden:true,textContent:''},status={};
 const context=vm.createContext({document:{getElementById:()=>panel},status,console});
 vm.runInContext(source.slice(source.indexOf('const playbackWarnings ='),source.indexOf('function currentStatusSuffix')),context);
 const player=new VgmPlayer(new MockSoundEngine());
 player.load(vgmBytes([0x90,0,0x12,0,0x2a,0x70,0x66]),{logger:{warn:context.reportPlaybackWarning}});
 player.play();drainPlayer(player);context.setStatus('Playback finished');
 assert.match(panel.textContent,/AY.*instance=0, stream=0/);assert.equal(panel.hidden,false);
 context.clearPlaybackWarnings();player.load(vgmBytes([0x66]));player.play();drainPlayer(player);
 assert.equal(panel.hidden,true);
});

test('ROM preparation failure is visible next to both playback controls until resolved',async()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const panels={playbackError:{},inlinePlaybackError:{}};
 const context=vm.createContext({document:{getElementById:id=>panels[id]},status:{},console,
   playbackPreparePromise:null,isPlaybackReady:()=>false,currentStatusSuffix:()=>'',
   ensurePlaybackReady:async()=>{throw new Error('Import yrw801.rom before playing this track.');}});
 vm.runInContext(source.slice(source.indexOf('const playbackWarnings ='),source.indexOf('function currentStatusSuffix')),context);
 vm.runInContext(source.slice(source.indexOf('function beginPreparePlayback('),source.indexOf('function stopActiveStream(')),context);
 await context.beginPreparePlayback({});
 for(const panel of Object.values(panels)){assert.equal(panel.hidden,false);assert.match(panel.textContent,/yrw801\.rom/);}
 context.setStatus('Ready');assert.equal(panels.inlinePlaybackError.hidden,false);
 context.ensurePlaybackReady=async()=>({});await context.beginPreparePlayback({});
 for(const panel of Object.values(panels)){assert.equal(panel.hidden,true);assert.equal(panel.textContent,'');}
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 for(const id of Object.keys(panels))assert.match(html,new RegExp(`id="${id}" role="alert"`));
});

test('unsupported sample blocks display once per type in both playback views',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const panels={playbackWarnings:{},inlinePlaybackWarnings:{}},logs=[];
 const context=vm.createContext({document:{getElementById:id=>panels[id]},status:{},console:{warn:m=>logs.push(m)}});
 vm.runInContext(source.slice(source.indexOf('const playbackWarnings ='),source.indexOf('function currentStatusSuffix')),context);
 for(const size of [2936,3333,1373,2936])context.reportPlaybackWarning(`Skipping unsupported VGM data block 0x80 (size=${size})`);
 for(const panel of Object.values(panels)){
  assert.equal(panel.hidden,false);assert.match(panel.textContent,/Unsupported VGM data block 0x80/);assert.equal(panel.textContent.split('\n').length,1);
 }
 assert.deepEqual(logs,[]);context.setStatus('Parsed track');assert.equal(panels.inlinePlaybackWarnings.hidden,false);
 context.clearPlaybackWarnings();for(const panel of Object.values(panels)){assert.equal(panel.hidden,true);assert.equal(panel.textContent,'');}
});

test('YM2151 with Sega PCM is allowed and mixed, without a partial-playback warning',()=>{
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const warnings=[],context=vm.createContext({reportPlaybackWarning:m=>warnings.push(m)});
 vm.runInContext(source.slice(source.indexOf('function validateOpmPlayback('),source.indexOf('async function ensurePlaybackReady(')),context);
 assert.doesNotThrow(()=>context.validateOpmPlayback({ym2151Clock:3579545,segaPcmClock:4000000}));
 assert.equal(warnings.length,0);
 assert.throws(()=>context.validateOpmPlayback({ym2151Clock:3579545,ym2612Clock:7670454}),/combination/);
 assert.throws(()=>context.validateOpmPlayback({ym2151Clock:3579545,segaPcmClock:0x40000001}),/combination/);
});
