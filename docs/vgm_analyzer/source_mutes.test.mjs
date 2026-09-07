import test from "node:test";
import assert from "node:assert/strict";
import { sourcesForChip, applySourceMutes, allSourcesMuted } from "./source_mutes.js";
import { GenesisAudioEngine } from "../js/genesisaudioengine.js";

test("source buttons and all-muted detection include every chip's audible sources", () => {
  const muted = {psg:true,ssg:true,rhythm:true,adpcmB:true};
  assert.deepEqual(sourcesForChip("ym2203").map(s=>s.label),["SSG"]);
  assert.deepEqual(sourcesForChip("ym2608").map(s=>s.label),["SSG","Rhythm","ADPCM-B"]);
  assert.deepEqual(sourcesForChip("ym2612").map(s=>s.label),["PSG"]);
  for(const chip of ["ym2203","ym2608","ym2612"]) {
    assert.equal(allSourcesMuted(chip,[{muted:true}],muted),true);
    assert.equal(allSourcesMuted(chip,[{muted:false}],muted),false);
    for(const source of sourcesForChip(chip)) assert.equal(allSourcesMuted(chip,[{muted:true}],{...muted,[source.key]:false}),false);
    const calls=[];
    const engine=Object.fromEntries(sourcesForChip(chip).map(s=>[s.method,(v)=>calls.push([s.key,v])]));
    applySourceMutes(engine,chip,muted);
    assert.deepEqual(calls,sourcesForChip(chip).map(s=>[s.key,true]));
  }
});

test("Genesis PSG mute removes PSG mix, keeps FM and continues PSG clock/writes", () => {
  let ticks=0, writes=0;
  const samples=(n,v)=>({left:new Float32Array(n).fill(v),right:new Float32Array(n).fill(v)});
  const fm={generateStereo:n=>samples(n,0.25),reset(){}};
  const psg={generateStereo(n){ticks+=n;return samples(n,1);},write(){writes++;},reset(){}};
  const engine=new GenesisAudioEngine(fm,psg,44100);
  const on=engine.processFrames(4).left[0];
  engine.setPsgMuted(true); engine.writePsg(0x90);
  assert.ok(Math.abs(engine.processFrames(4).left[0]-0.225)<1e-6);
  assert.equal(ticks,8); assert.equal(writes,1);
  engine.reset(); assert.ok(Math.abs(engine.processFrames(4).left[0]-0.225)<1e-6);
  engine.setPsgMuted(false); assert.equal(engine.processFrames(4).left[0],on);
});
