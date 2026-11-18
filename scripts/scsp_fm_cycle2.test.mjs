// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cycle2TapAge,cycle2RegisterPlan,probeScspCycle2,probeScspCycle2HistoryPolicy,SCSP_CYCLE2_VARIANTS,SCSP_CYCLE2_PLACEMENTS} from './probe_scsp_fm_cycle2.mjs';

test('an independently simulated64-cell writer identifies both banks for every physical source/consumer ordering',()=>{
  for(let source=0;source<32;source++)for(let target=0;target<32;target++){
    const same=(source-target+64)%64,other=(same+32)%64;
    assert.deepEqual(cycle2TapAge(source,target,same),{source,age:source<target?0:2});
    assert.deepEqual(cycle2TapAge(source,target,other),{source,age:1});
  }
  assert.deepEqual(cycle2TapAge(0,31,33),{source:0,age:0});
  assert.deepEqual(cycle2TapAge(31,0,31),{source:31,age:2});
  assert.deepEqual(cycle2TapAge(31,0,63),{source:31,age:1});
});

test('cycle plans expose actualphysical order, fixed A/B identities, exact selector words and causal ages',()=>{
  const current=cycle2RegisterPlan({aSlot:6,bSlot:7,depth:9});
  assert.equal(current.first.role,'A');assert.equal(current.second.role,'B');assert.equal(current.first.word,0x9861);assert.equal(current.second.word,0x9fff);
  const averaged=cycle2RegisterPlan({aSlot:6,bSlot:7,depth:9,variant:'current-forward-average12'});
  assert.deepEqual([averaged.first.xOffset,averaged.first.yOffset],[33,1]);assert.equal(averaged.first.word,0x9841);assert.deepEqual(averaged.first.ages,[1,2]);assert.deepEqual(averaged.second.ages,[0,0]);
  const reversed=cycle2RegisterPlan({aSlot:7,bSlot:6,depth:9});assert.equal(reversed.first.role,'B');assert.equal(reversed.second.role,'A');assert.equal(reversed.first.slot,6);assert.equal(reversed.second.slot,7);
  const expected=[[[1,1],[0,0]],[[2,2],[0,0]],[[1,2],[0,0]],[[1,1],[1,1]],[[1,2],[0,1]]];
  for(const [i,variant]of SCSP_CYCLE2_VARIANTS.entries())for(const [aSlot,bSlot]of SCSP_CYCLE2_PLACEMENTS){const plan=cycle2RegisterPlan({aSlot,bSlot,variant});assert.deepEqual([plan.first.ages,plan.second.ages],expected[i]);}
});

test('invalid plans and wrong source selectors reject before constructing a native instance',()=>{
  for(const patch of [{aSlot:-1},{bSlot:32},{aSlot:6,bSlot:6},{depth:13},{depth:NaN},{depth:1.5},{variant:'instantaneous-cycle'},{adapterOff:1}])assert.throws(()=>cycle2RegisterPlan(patch));
  assert.throws(()=>cycle2TapAge(6,7,0),/requested source/);assert.throws(()=>cycle2TapAge(6,7,64));
});

test('actual twoOP PCM and fullring match cut-edge and separate-OP native references for all timingprofiles and reversed/wrapped placements',async()=>{
  for(const [aSlot,bSlot]of [[6,7],[7,6],[0,31],[31,0]])for(const variant of SCSP_CYCLE2_VARIANTS)for(const sampleRate of [44100,48000]){
    const report=await probeScspCycle2({aSlot,bSlot,variant,sampleRate,frames:256,depth:12});
    assert(report.cutEdgeExactPcm&&report.isolatedExactRawStack&&report.isolatedExactPcm&&report.finite);assert(report.peak<.98);assert.equal(report.registerPlan.first.role,aSlot<bSlot?'A':'B');
  }
});

test('nativeMDL0 offsets still modulate while adapterdepth0 explicitly disconnects the same cycle',async()=>{
  for(const variant of SCSP_CYCLE2_VARIANTS){
    const raw=await probeScspCycle2({variant,depth:0}),off=await probeScspCycle2({variant,depth:0,adapterOff:true});
    assert(raw.registerPlan.first.word!==0&&raw.registerPlan.second.word!==0);assert.equal(off.registerPlan.first.word,0);assert.equal(off.registerPlan.second.word,0);
    assert.notEqual(raw.rawStackSha256,off.rawStackSha256);assert(raw.cutEdgeExactPcm&&off.cutEdgeExactPcm);
  }
});

test('one/two-frame and averaged returns are distinguishable; wronghistory injection fails against actual native PCM',async()=>{
  const hashes=[];
  for(const variant of SCSP_CYCLE2_VARIANTS.slice(0,3)){const value=await probeScspCycle2({variant,depth:8});hashes.push(value.rawStackSha256);}
  assert.equal(new Set(hashes).size,3);
  for(const wrongReturnAges of [[2,2],[1,2]])assert.equal((await probeScspCycle2({depth:8,wrongReturnAges})).cutEdgeExactPcm,false);
});

test('staleinitial history is audible and raw lifecycle changes retain it until explicit globalStop',async()=>{
  const stale=await probeScspCycle2({variant:'current-forward-average12',stale:true}),fresh=await probeScspCycle2({variant:'current-forward-average12',stale:false});assert.notEqual(stale.rawStackSha256,fresh.rawStackSha256);
  for(const sampleRate of [44100,48000]){
    const report=await probeScspCycle2({aSlot:31,bSlot:0,variant:'two-bank-average',frames:1024,lifecycle:true,sampleRate});
    assert.deepEqual(report.events.map(event=>event.action),['adapter-depth-Off','depth-On8','live-pitch','keyOff-release','raw-retrigger','global-Stop-and-retrigger']);
    assert(report.events.slice(0,5).every(event=>event.historyRetained&&!event.globalReset));assert.equal(report.events[5].nativeEpochFrame,0);assert(report.events[5].globalReset);assert.equal(report.nativeEpochFrames,report.nativeFramesCompared-320);
    assert(report.cutEdgeExactPcm&&report.isolatedExactRawStack&&report.isolatedExactPcm);
  }
});

test('centered outputs retain exact twoOP cut-edge PCM and perOP rawrecurrence without assuming independentPCMsum rounding',async()=>{
  for(const variant of SCSP_CYCLE2_VARIANTS){const value=await probeScspCycle2({variant,mix:'center'});assert(value.cutEdgeExactPcm&&value.isolatedExactRawStack);assert.equal(typeof value.isolatedExactPcm,'boolean');assert(value.isolatedMaxNativeDifference<=1/32768);}
});

test('mutingA direct output and usingB directLevel5 changes only externalPCM, retaining all feedback histories',async()=>{
  const separate=await probeScspCycle2({variant:'current-forward-average12'}),carrier=await probeScspCycle2({variant:'current-forward-average12',mix:'carrier'});
  assert.equal(carrier.rawStackSha256,separate.rawStackSha256);assert.notEqual(carrier.pcmLeftSha256,separate.pcmLeftSha256);assert(carrier.cutEdgeExactPcm&&carrier.cutEdgeExactRestoredRawStack&&carrier.isolatedExactPcm);
  for(const stats of Object.values(carrier.nativeCommandStats)){assert.equal(stats.renderCalls,carrier.nativeFramesCompared);assert.equal(stats.renderedFrames,carrier.nativeFramesCompared);assert.equal(stats.ramLoads,2);assert.equal(stats.resets,1);}
});

test('CLI help and invalidarguments finish without starting a native research run',()=>{
  const script=fileURLToPath(new URL('./probe_scsp_fm_cycle2.mjs',import.meta.url));
  const help=spawnSync(process.execPath,[script,'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/offline native SCSP; no physical audio device/);assert(!help.stdout.includes('/600 cases'));
  for(const args of [['--unknown'],['one.json','two.json'],['not-a-json-file']]){const invalid=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/Usage:/);assert(!invalid.stdout.includes('/600 cases'));}
});

test('native inactive/reused slots retain explicit stale markers and mutedOff priming refreshes both banks without a clear API',async()=>{
  const result=await probeScspCycle2HistoryPolicy();assert(result.freshDedicatedResetStartsZero&&result.inactiveMarkersRetained&&result.physicalSlotSampleReuseRetainsMarkers&&result.globalStopClearsAll64&&result.globalStopRetainsPcmRam);
  assert.equal(result.mutedOffPrimeFrames,2);assert(result.mutedOffPrimePcmExactlySilent&&result.mutedOffPrimeOverwritesBothBanks&&result.liveEnablePreservesPrimedHistory);assert.match(result.primingLimit,/no sample-accurate start guarantee/);
});
