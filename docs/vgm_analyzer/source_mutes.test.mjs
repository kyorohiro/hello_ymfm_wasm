import test from "node:test";
import assert from "node:assert/strict";
import { sourcesForChip, applySourceMutes, allSourcesMuted } from "./source_mutes.js";
import { GenesisAudioEngine } from "../js/genesisaudioengine.js";

test("source buttons and all-muted detection include every chip's audible sources", () => {
  const muted = {psg:true,ssg:true,rhythm:true,adpcmB:true};
  assert.deepEqual(sourcesForChip("ym2203").map(s=>s.label),["SSG"]);
  assert.deepEqual(sourcesForChip("ym2608").map(s=>s.label),["SSG","Rhythm","ADPCM-B"]);
  assert.deepEqual(sourcesForChip("ym2610").map(s=>s.label),["SSG","ADPCM-A","ADPCM-B"]);
  assert.deepEqual(sourcesForChip("ym2612").map(s=>s.label),["PSG"]);
  for(const chip of ["ym2203","ym2608","ym2612","ym2610"]) {
    assert.equal(allSourcesMuted(chip,[{muted:true}],muted),true);
    assert.equal(allSourcesMuted(chip,[{muted:false}],muted),false);
    for(const source of sourcesForChip(chip)) assert.equal(allSourcesMuted(chip,[{muted:true}],{...muted,[source.key]:false}),false);
    const calls=[];
    const engine=Object.fromEntries(sourcesForChip(chip).map(s=>[s.method,(v)=>calls.push([s.key,v])]));
    applySourceMutes(engine,chip,muted);
    assert.deepEqual(calls,sourcesForChip(chip).map(s=>[s.key,true]));
  }
});

test("OKIM6258 exposes a single chip-level toggle, standalone and mixed", () => {
  assert.deepEqual(sourcesForChip("okim6258").map(s=>s.label),["OKI"]);
  assert.deepEqual(sourcesForChip("okim6258", true).map(s=>s.label),["OKI"]);
  assert.deepEqual(sourcesForChip("msx", true).map(s=>s.label),[]);
  // Regression: Game Boy DMG has no PSG to mix and no other exposed source;
  // it must not fall through to the generic ["psg"] default (that engine
  // has no setPsgMuted, so applySourceMutes would throw).
  assert.deepEqual(sourcesForChip("gameboy").map(s=>s.label),[]);
  assert.deepEqual(sourcesForChip("gameboy", true).map(s=>s.label),[]);
  assert.doesNotThrow(()=>applySourceMutes({},"gameboy",{},true));
  // Sega PCM's optional built-in Sega PSG mix legitimately reuses the
  // generic ["psg"] default; SegaPcmAudioEngine exposes setPsgMuted for it.
  assert.deepEqual(sourcesForChip("segapcm").map(s=>s.label),["PSG"]);
  assert.deepEqual(sourcesForChip("ym2612").map(s=>s.label),["PSG"]);
  assert.deepEqual(sourcesForChip("ym2612", true).map(s=>s.label),["PSG","OKI"]);
  assert.deepEqual(sourcesForChip("ym2151", true).map(s=>s.label),["PSG","Sega PCM","OKI"]);

  const calls=[];
  const engine={setPsgMuted:(v)=>calls.push(["psg",v]),setOkiMuted:(v)=>calls.push(["oki",v])};
  applySourceMutes(engine, "ym2612", {psg:true,oki:true}, true);
  assert.deepEqual(calls,[["psg",true],["oki",true]]);

  assert.equal(allSourcesMuted("ym2612",[{muted:true}],{psg:true,oki:false},true),false);
  assert.equal(allSourcesMuted("ym2612",[{muted:true}],{psg:true,oki:true},true),true);
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
