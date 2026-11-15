import test from 'node:test';
import assert from 'node:assert/strict';
import {createNesSongEngine} from './song_engine.js';
import {createDefaultPreset} from './preset.js';

test('editing a channel absent from the song installs its complete authored voice',async()=>{
  const engine=await createNesSongEngine({nesApuClock:1789773});try{
    engine.reset();const preset=createDefaultPreset();preset.source='fds';
    engine.applyPreset(5,preset);assert.deepEqual(engine.getCoreState().wave,preset.fds.wave);
    engine.noteOn('new-FDS',60,5);const pcm=engine.processFrames(2048);assert.ok(pcm.left.some(value=>Math.abs(value)>.001));
  }finally{engine.dispose();}
});
test('native paused FDS click guard joins both edges continuously and preserves original chip registers',async()=>{
  const engine=await createNesSongEngine({nesApuClock:1789773});try{
    engine.reset();const preset=createDefaultPreset();preset.source='fds';preset.fds.modulation.enabled=false;
    engine.applyPreset(5,preset);engine.setAuditionClickGuard(true);engine.processFrames(256);
    engine.noteOn('guarded',60,5);const start=engine.processFrames(1024);
    assert.equal(start.left[0],0);assert.equal(start.right[0],0);assert.ok(start.left.some(value=>Math.abs(value)>.001));
    const before=[start.left.at(-1),start.right.at(-1)];engine.noteOff('guarded');const registers=engine.getCoreState().registers;
    const release=engine.processFrames(1024);assert.equal(release.left[0],before[0]);assert.equal(release.right[0],before[1]);
    assert.ok(release.left.subarray(221).every(value=>value===0));assert.ok(release.right.subarray(221).every(value=>value===0));
    assert.deepEqual(engine.getCoreState().registers,registers);assert.equal(engine.getAuditionClickGuard().phase,'muted');
    engine.noteOn('again',64,5);assert.equal(engine.getAuditionClickGuard().phase,'attack');const again=engine.processFrames(1024);
    assert.equal(again.left[0],0);assert.ok(again.left.some(value=>Math.abs(value)>.001));
  }finally{engine.dispose();}
});
test('a held Pulse survives guarded-channel releases and stale ownership releases',async()=>{
  const engine=await createNesSongEngine({nesApuClock:1789773});try{
    engine.reset();const preset=createDefaultPreset();engine.applyPreset(0,preset);engine.applyPreset(5,preset);engine.setAuditionClickGuard(true);
    engine.noteOn('pulse',60,0);engine.noteOn('fds-old',60,5);engine.noteOn('fds-new',64,5);
    assert.equal(engine.noteOff('fds-old'),false);assert.equal(engine.getAuditionClickGuard().phase,'bypass');
    engine.noteOff('fds-new');assert.equal(engine.getAuditionClickGuard().phase,'bypass');
    const pcm=engine.processFrames(2048);assert.ok(pcm.left.some(value=>Math.abs(value)>.001));assert.equal(engine.getCoreState().enableMask&1,1);
    engine.setAuditionClickGuard(false);assert.equal(engine.getAuditionClickGuard().phase,'bypass');
    engine.noteOn('unguarded',60,5);engine.noteOff('unguarded');assert.equal(engine.getAuditionClickGuard().phase,'bypass');
  }finally{engine.dispose();}
});
test('native song rendering starts without any software output guard',async()=>{
  const engine=await createNesSongEngine({nesApuClock:1789773});try{
    assert.equal(engine.getAuditionClickGuard(),null);engine.processFrames(256);assert.equal(engine.getAuditionClickGuard(),null);
  }finally{engine.dispose();}
});
