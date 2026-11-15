import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2608Synth} from '../js/ym2608synth.js';
import {createFm2608Audio,installMonitorMutes} from './audio.js';
import {createDefaultPreset,readFmPreset,FM_PRESETS} from './preset.js';

function fixture({failUpload = false} = {}) {
  const writes = [], uploads = [];
  const transport = {
    reset() {},write(port,register,value) { writes.push({port,register,value}); },
    async loadAdpcmMemory(bytes,address) {
      if (failUpload) throw new Error('simulated transfer failure');
      uploads.push({bytes:bytes.slice(),address});
    },
  };
  const chip = new YM2608Synth({transport});
  return {chip,writes,uploads};
}
function fakeContext() {
  return {state:'suspended',currentTime:0,sampleRate:44100,destination:{},
    createGain() { return {gain:{value:1,cancelScheduledValues() {},setValueAtTime(value) { this.value=value; },linearRampToValueAtTime(value) { this.value=value; }},connect() {},disconnect() {}}; },
    async close() { this.state='closed'; },
  };
}
async function audioFixture() {
  const result = fixture(), context = fakeContext();
  const audio = await createFm2608Audio({createContext:() => context,
    createRuntime:() => ({fm:result.chip,async start() {},async close() {}})});
  result.writes.length = 0;
  return {...result,audio,context};
}

test('monitor mute retains later Code writes and restores every source correctly', () => {
  const {chip,writes} = fixture(), monitor = installMonitorMutes(chip);
  chip.setPreset(0,readFmPreset(FM_PRESETS['two-op-bell']));
  monitor.setMute('fm',0,true); writes.length = 0;
  chip.setOperator(0,1,{tl:35});
  assert.equal(writes.at(-1).value,127);
  assert.equal(chip.channels[0].operators[1].tl,35);
  monitor.setMute('fm',0,false);
  assert(writes.some(item => item.register === 0x48 && item.value === 35));
  monitor.setMute('ssg',1,true); chip.ssg.setVolume(1,9);
  assert.equal(writes.at(-1).value,0);
  monitor.setMute('ssg',1,false); assert.equal(writes.at(-1).value,9);
  monitor.setMute('rhythm',2,true); chip.rhythm.setVoice(2,{volume:17,left:true,right:true});
  assert.equal(writes.at(-1).value,17);
  monitor.setMute('rhythm',2,false); assert.equal(writes.at(-1).value,0xc0 | 17);
  monitor.setMute('adpcm',0,true); chip.adpcm.setVolume(156);
  assert.equal(writes.at(-1).value,0);
  monitor.setMute('adpcm',0,false); assert.equal(writes.at(-1).value,156);
});

test('Stop silences FM tails until a fresh Key On and retains live levels', () => {
  const {chip,writes} = fixture(), monitor = installMonitorMutes(chip);
  chip.setPreset(0,readFmPreset(FM_PRESETS.sine)); chip.noteOn(0,'C4');
  monitor.stopFm(); writes.length = 0;
  chip.setOperator(0,3,{tl:29});
  assert.equal(writes.at(-1).value,127);
  chip.keyOn(0);
  assert(writes.some(item => item.register === 0x4c && item.value === 29));
  assert.equal(writes.at(-1).register,0x28);
  assert.equal(chip.channels[0].operators[3].tl,29);
});

test('applying one FM edit preserves Code edits in other channels and silent SSG gates', async () => {
  const {audio,chip,writes,uploads} = await audioFixture();
  chip.setAlgo(1,3,2); writes.length = 0;
  const next = audio.getPreset(); next.fm[0].feedback = 4;
  await audio.applyPreset(next);
  assert.equal(chip.channels[1].algorithm,3);
  assert.equal(chip.channels[1].feedback,2);
  assert.equal(uploads.length,1);
  assert(writes.every(item => item.register > 0x2f));
  assert.deepEqual(Array.from(chip.ssg.registers.slice(8,11)),[0,0,0]);
  writes.length = 0; await audio.applyPreset(next);
  assert.deepEqual(writes,[]);
  await audio.dispose();
});

test('keyboard SSG, pitch, sample replacement and Stop share one chip', async () => {
  const {audio,chip,uploads} = await audioFixture();
  await audio.noteOn('ssg',1,60);
  const firstPeriod = chip.ssg.registers[2] | chip.ssg.registers[3] << 8;
  audio.setPitch(2);
  const bentPeriod = chip.ssg.registers[2] | chip.ssg.registers[3] << 8;
  assert(bentPeriod < firstPeriod);
  audio.noteOff('ssg',1); assert.equal(chip.ssg.registers[9],0);
  chip.setAlgo(0,6,5);
  const changed = await audio.setWave(Array.from({length:128},(_,index) => Math.sin(index / 128 * Math.PI * 2) * .3));
  assert.equal(changed.adpcm.rootNote,60);
  assert.equal(uploads.length,2);
  await audio.stopAll();
  assert.equal(chip.channels[0].algorithm,6);
  assert.equal(chip.channels[0].feedback,5);
  await audio.dispose();
});

test('invalid presets cannot partially apply', async () => {
  const {audio,writes,uploads} = await audioFixture(), before = audio.getPreset();
  const invalid = createDefaultPreset(); invalid.fm[5].operators[3].rr = 16;
  assert.throws(() => audio.applyPreset(invalid));
  assert.deepEqual(writes,[]);
  assert.equal(uploads.length,1);
  assert.deepEqual(audio.getPreset(),before);
  await audio.dispose();
});

test('a released or stopped pending keyboard start never sounds afterwards', async () => {
  const {audio,chip,writes} = await audioFixture();
  const first = audio.noteOn('fm',0,60);
  audio.noteOff('fm',0);
  assert.equal(await first,false);
  assert(!writes.some(item => item.register === 0x28 && item.value & 0xf0));
  writes.length = 0;
  const second = audio.noteOn('fm',1,62);
  await audio.stopAll();
  assert.equal(await second,false);
  assert(!writes.some(item => item.register === 0x28 && item.value & 0xf0));
  await audio.dispose();
});

test('register snapshots retain Code values behind monitor mutes and are read-only copies', async () => {
  const {audio,chip,writes} = await audioFixture();
  audio.setMute('adpcm',0,true);
  chip.adpcm.setVolume(157); chip.adpcm.setDeltaN(12345); chip.rhythm.setVolume(33);
  writes.length = 0;
  const registers = audio.getRegisterState();
  assert.equal(registers.length,2);
  assert.equal(registers[0].length,256);
  assert.equal(registers[0][0x11],33);
  assert.equal(registers[1][11],157);
  assert.equal(registers[1][9] | registers[1][10] << 8,12345);
  registers[1][11] = 0;
  assert.equal(audio.getRegisterState()[1][11],157);
  assert.deepEqual(writes,[]);
  await audio.dispose();
});

test('FM snapshots observe raw Code registers, original levels behind mute, pitch and resets', async () => {
  const {audio,chip,writes} = await audioFixture();
  audio.setMute('fm',0,true);
  chip.write(0,0xb0,5 | 3 << 3);
  chip.write(0,0x22,8 | 6);
  chip.write(0,0x4c,34);
  chip.write(0,0xb4,0x80 | 2 << 4 | 5);
  chip.setFrequency(3,440);
  chip.write(0,0x28,0xf0);
  writes.length = 0;
  const snapshot = audio.getFmState(), voice = snapshot.channels[0].preset;
  assert.equal(voice.algorithm,5);
  assert.equal(voice.feedback,3);
  assert.equal(voice.operators[4].tl,34);
  assert.deepEqual(voice.pan,{left:true,right:false});
  assert.equal(voice.ams,2);
  assert.equal(voice.pms,5);
  assert.deepEqual(snapshot.lfo,{enabled:true,frequency:6});
  assert.equal(snapshot.channels[0].gate,true);
  assert(Math.abs(snapshot.channels[3].frequencyHz - 440) < 1);
  assert.deepEqual(writes,[]);
  chip.write(0,0x4c,35);
  assert.equal(voice.operators[4].tl,34);
  assert.equal(audio.getFmState().channels[0].preset.operators[4].tl,35);
  chip.reset();
  assert.equal(audio.getFmState().channels[0].gate,false);
  assert.equal(audio.getFmState().channels[0].preset.algorithm,0);
  assert.deepEqual(audio.getFmState().lfo,{enabled:false,frequency:0});
  await audio.dispose();
});
