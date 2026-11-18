import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2608Synth} from '../js/ym2608synth.js';
import {createFm2608Audio,installMonitorMutes} from './audio.js';
import {createDefaultPreset,readFmPreset,FM_PRESETS,decodeBase64} from './preset.js';
import {noteToHz} from '../js/soundchip_pitch.js';
import {createPerformanceQueue} from '../js/playground_performance_queue.js';

function fixture({failUpload = false,waitForUpload} = {}) {
  const writes = [], uploads = [];
  const transport = {
    reset() {},write(port,register,value) { writes.push({port,register,value}); },
    async loadAdpcmMemory(bytes,address) {
      await waitForUpload?.();
      if (typeof failUpload === 'function' ? failUpload() : failUpload) throw new Error('simulated transfer failure');
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
async function audioFixture(options) {
  const result = fixture(options), context = fakeContext();
  const audio = await createFm2608Audio({createContext:() => context,
    createRuntime:() => ({fm:result.chip,node:options?.node,async start() {},async close() {}})});
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

test('keyboard SSG notes retrigger the current shared envelope without replacing its period', async () => {
  const {audio,chip,writes} = await audioFixture();
  const next = audio.getPreset();
  next.ssg.channels[0] = {tone:false,noise:true,volume:7,envelope:true};
  await audio.applyPreset(next);
  chip.ssg.setMixer(1,{tone:true,noise:true});
  chip.ssg.setVolume(1,9,true);
  chip.ssg.setEnvelope({period:0x2345,shape:9});
  const otherChannelGates = chip.ssg.registers[7] & 0x12;
  writes.length = 0;

  await audio.noteOn('ssg',0,'C4');
  assert.equal(chip.ssg.registers[8],16);
  assert.equal(chip.ssg.registers[7] & 9,1);
  audio.noteOff('ssg',0);
  assert.equal(chip.ssg.registers[8],0);
  await audio.noteOn('ssg',0,'D4');

  assert.deepEqual(writes.filter(item => item.port === 0 && item.register === 13).map(item => item.value),[9,9]);
  assert(!writes.some(item => item.port === 0 && (item.register === 11 || item.register === 12)));
  assert.equal(chip.ssg.registers[11] | chip.ssg.registers[12] << 8,0x2345);
  assert.equal(chip.ssg.registers[9],16);
  assert.equal(chip.ssg.registers[7] & 0x12,otherChannelGates);
  await audio.dispose();
});

test('fixed-volume keyboard SSG notes leave the shared envelope running', async () => {
  const {audio,chip,writes} = await audioFixture();
  chip.ssg.setMixer(1,{tone:false,noise:true});
  chip.ssg.setVolume(1,12,true);
  chip.ssg.setEnvelope({period:0x4567,shape:11});
  const otherChannelGates = chip.ssg.registers[7] & 0x12;
  writes.length = 0;

  await audio.noteOn('ssg',0,'C4');
  audio.noteOff('ssg',0);
  await audio.noteOn('ssg',0,'D4');

  assert(!writes.some(item => item.port === 0 && item.register >= 11 && item.register <= 13));
  assert.equal(chip.ssg.registers[11] | chip.ssg.registers[12] << 8,0x4567);
  assert.equal(chip.ssg.registers[13],11);
  assert.equal(chip.ssg.registers[9],16);
  assert.equal(chip.ssg.registers[7] & 0x12,otherChannelGates);
  assert.equal(chip.ssg.registers[8],audio.getPreset().ssg.channels[0].volume);
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

test('operator masks change held notes, retain silent Gates and survive preset capture', async () => {
  const {audio,chip,writes} = await audioFixture();
  let next = audio.getPreset(); next.fm[0].keyMask = 5;
  await audio.applyPreset(next);
  assert(!writes.some(write => write.register === 0x28));
  await audio.noteOn('fm',0,'C4');
  assert.equal(writes.at(-1).value,0x50);
  next = audio.getPreset(); next.fm[0].keyMask = 0; await audio.applyPreset(next);
  assert.equal(audio.getFmState().channels[0].keyMask,0);
  assert.equal(audio.capturePreset().fm[0].keyMask,0);
  next.fm[0].keyMask = 10; await audio.applyPreset(next);
  assert.equal(audio.getFmState().channels[0].keyMask,10);
  audio.noteOff('fm',0); writes.length = 0;
  next.fm[0].keyMask = 3; await audio.applyPreset(next);
  assert(!writes.some(write => write.register === 0x28));
  chip.keyOn(1,[1,3]); chip.keyOff(1);
  assert.equal(audio.capturePreset().fm[1].keyMask,10);
  await audio.dispose();
});

test('special CH3 keyboard pitch preserves four operator ratios and zero-frequency operators', async () => {
  const {audio} = await audioFixture();
  const next = audio.getPreset(); next.channel3.mode = 'special';
  next.channel3.frequencies = [0,256,512,1024].map(fnum => ({block:4,fnum}));
  await audio.applyPreset(next);
  await audio.noteOn('fm',2,'A3');
  let frequencies = audio.getFmState().channels[2].specialFrequencies.map(value => value.frequencyHz);
  assert.equal(frequencies[0],0);
  assert(Math.abs(frequencies[3] - 220) < .5);
  assert(Math.abs(frequencies[1] / frequencies[3] - .25) < .002);
  assert(Math.abs(frequencies[2] / frequencies[3] - .5) < .002);
  audio.setPitch(2);
  frequencies = audio.getFmState().channels[2].specialFrequencies.map(value => value.frequencyHz);
  assert(Math.abs(frequencies[3] - noteToHz('B3')) < .5);
  const captured = audio.capturePreset();
  assert.equal(captured.channel3.mode,'special');
  assert.equal(captured.channel3.frequencies[0].fnum,0);
  audio.noteOff('fm',2);
  await audio.applyPreset(captured);
  await audio.noteOn('fm',2,'C4');
  frequencies = audio.getFmState().channels[2].specialFrequencies.map(value => value.frequencyHz);
  assert(Math.abs(frequencies[1] / frequencies[3] - .25) < .003);
  await audio.dispose();
});

test('CSM uses Timer A mode 10, stops on release and reopens Stop-muted operator levels', async () => {
  const {audio,chip,writes} = await audioFixture();
  await audio.noteOn('fm',2,'E3');
  const next = audio.getPreset(); next.channel3.mode = 'csm'; next.channel3.timerA = 999;
  await audio.applyPreset(next);
  assert.equal(audio.getFmState().channels[2].keyMask,0);
  assert.equal(audio.getChannel3State().running,true);
  audio.noteOff('fm',2);
  assert.equal(audio.getChannel3State().running,false);
  assert.equal(audio.getRegisterState()[0][0x24],999 >> 2);
  assert.equal(audio.getRegisterState()[0][0x25],999 & 3);
  await audio.noteOn('fm',2,'E3');
  assert.equal(audio.getRegisterState()[0][0x27] & 0xc1,0x81);
  audio.noteOff('fm',2);
  assert.equal(audio.getRegisterState()[0][0x27] & 0xc1,0x80);
  chip.setCsm(true,{timerA:900});
  assert.equal(audio.getChannel3State().running,true);
  await audio.stopAll();
  assert.equal(audio.getChannel3State().mode,'csm');
  assert.equal(audio.getChannel3State().running,false);
  chip.setOperator(2,3,{tl:31}); writes.length = 0;
  chip.keyOn(2);
  assert(writes.some(write => write.register === 0x4e && write.value === 31));
  assert.equal(audio.getChannel3State().running,true);
  chip.keyOff(2); assert.equal(audio.getChannel3State().running,false);
  chip.write(0,0x27,0xc0);
  assert.equal(audio.getChannel3State().mode,'special');
  chip.setChannel3SpecialMode(false);
  assert.equal(audio.getRegisterState()[0][0x27] & 0xc0,0);
  await audio.dispose();
});

test('Code ADPCM memory, selected offset range and playback rate survive capture and reload', async () => {
  const {audio,chip,uploads,writes} = await audioFixture();
  const bytes = Uint8Array.from({length:64},(_,index) => index);
  const loading = chip.adpcm.loadMemory(bytes,256);
  bytes.fill(255);
  assert.throws(() => audio.capturePreset(),/still loading/);
  await loading;
  chip.adpcm.setSample({start:288,end:320});
  const actual = chip.adpcm.setPlaybackRate(16000);
  chip.adpcm.setPan(true,false); chip.adpcm.keyOn({repeat:true});
  writes.length = 0;
  const captured = audio.capturePreset();
  assert.equal(captured.adpcm.address,0);
  assert.equal(captured.adpcm.start,288);
  assert.equal(captured.adpcm.end,320);
  assert.equal(captured.adpcm.sampleRate,actual);
  assert.equal(captured.adpcm.repeat,true);
  assert.equal(captured.adpcm.right,false);
  assert.deepEqual(decodeBase64(captured.adpcm.data).slice(256),Uint8Array.from({length:64},(_,index) => index));
  assert.deepEqual(writes,[]);
  await audio.applyPreset(captured);
  assert.equal(uploads.length,3);
  assert.equal(chip.adpcm.registers[2],9);
  assert.equal(chip.adpcm.registers[4],9);
  await audio.noteOn('adpcm',0,72); audio.setPitch(1);
  assert.equal(audio.capturePreset(captured).adpcm.sampleRate,actual);
  audio.noteOff('adpcm',0); audio.setPitch(0);
  await audio.dispose();
});

test('ADPCM capture preserves the exact authored base rate during keyboard transposition', async () => {
  const {audio,chip} = await audioFixture();
  const preset = audio.getPreset();
  await audio.noteOn('adpcm',0,67); audio.setPitch(1.25);
  assert.equal(audio.capturePreset(preset).adpcm.sampleRate,preset.adpcm.sampleRate);
  audio.noteOff('adpcm',0);
  assert.equal(audio.capturePreset(preset).adpcm.sampleRate,preset.adpcm.sampleRate);
  await audio.stopAll();
  assert.equal(audio.capturePreset(preset).adpcm.sampleRate,preset.adpcm.sampleRate);
  await audio.noteOn('adpcm',0,67);
  chip.adpcm.setPlaybackRate(16000);
  const captured = audio.capturePreset(preset);
  const factor = 2 ** ((67 - preset.adpcm.rootNote + 1.25) / 12);
  const actual = (chip.adpcm.registers[9] | chip.adpcm.registers[10] << 8) * chip.clock / (144 * 65536);
  assert(Math.abs(captured.adpcm.sampleRate * factor - actual) < .000001);
  await audio.dispose();
});

test('failed Code memory transfers leave the last accepted sample available', async () => {
  let fail = false;
  const {audio,chip} = await audioFixture({failUpload:() => fail});
  const before = audio.capturePreset();
  fail = true;
  await assert.rejects(chip.adpcm.loadMemory(new Uint8Array(64).fill(255),0),/simulated/);
  assert.deepEqual(audio.capturePreset(),before);
  fail = false;
  await chip.adpcm.loadMemory(new Uint8Array(64).fill(1),0);
  assert(decodeBase64(audio.capturePreset().adpcm.data).every(byte => byte === 1));
  await audio.dispose();
});

test('capture observes raw FM and shared section controls behind monitor mute', async () => {
  const {audio,chip,writes} = await audioFixture();
  audio.setMute('fm',1,true); audio.setMute('ssg',0,true); audio.setMute('rhythm',2,true); audio.setMute('adpcm',0,true);
  chip.write(0,0xb1,6 | 5 << 3); chip.write(0,0x4d,39); chip.write(0,0xb5,0x80 | 3 << 4 | 5);
  chip.write(0,8,7); chip.write(0,6,29); chip.write(0,11,0x12); chip.write(0,12,0x34); chip.write(0,13,10);
  chip.write(0,0x11,52); chip.write(0,0x1a,0x80 | 21);
  chip.write(1,11,87); chip.setLfo(true,4);
  writes.length = 0;
  const captured = audio.capturePreset();
  assert.equal(captured.fm[1].algorithm,6); assert.equal(captured.fm[1].feedback,5);
  assert.equal(captured.fm[1].operators[3].tl,39); assert.equal(captured.fm[1].pms,5);
  assert.deepEqual(captured.fm[1].pan,{left:true,right:false});
  assert.equal(captured.ssg.channels[0].volume,7); assert.equal(captured.ssg.noisePeriod,29);
  assert.equal(captured.ssg.envelopePeriod,0x3412); assert.equal(captured.ssg.envelopeShape,10);
  assert.equal(captured.rhythm.volume,52); assert.deepEqual(captured.rhythm.voices[2],{volume:21,left:true,right:false});
  assert.equal(captured.adpcm.volume,87); assert.deepEqual(captured.lfo,{enabled:true,frequency:4});
  assert.deepEqual(writes,[]);
  await audio.dispose();
});

test('ignored data-register writes during external playback preserve capture', async () => {
  const {audio,chip} = await audioFixture();
  const before = audio.capturePreset().adpcm.data;
  for (const mode of [0xa0,0xb0,0x20,0x40]) {
    chip.write(1,0,mode); chip.write(1,8,123);
    assert.equal(audio.capturePreset().adpcm.data,before);
  }
  await audio.dispose();
});

test('a successful memory upload recovers CPU-written sample capture and rejects unknown gaps', async () => {
  let fail = false;
  const {audio,chip} = await audioFixture({failUpload:() => fail});
  chip.write(1,0,0x60); chip.write(1,8,123);
  assert.throws(() => audio.capturePreset(),/CPU data-register/);
  fail = true;
  await assert.rejects(chip.adpcm.loadMemory(new Uint8Array(32),256),/simulated/);
  assert.throws(() => audio.capturePreset(),/CPU data-register/);
  fail = false;
  await chip.adpcm.loadMemory(new Uint8Array(32).fill(11),256);
  chip.adpcm.setSample({start:256,end:288});
  let captured = audio.capturePreset();
  assert.equal(captured.adpcm.address,256);
  assert.deepEqual(decodeBase64(captured.adpcm.data),new Uint8Array(32).fill(11));
  await chip.adpcm.loadMemory(new Uint8Array(32).fill(22),384);
  assert.throws(() => audio.capturePreset(),/unknown bytes between uploads/);
  await chip.adpcm.loadMemory(new Uint8Array(96).fill(33),288);
  captured = audio.capturePreset();
  const bytes = decodeBase64(captured.adpcm.data);
  assert.equal(bytes.length,160);
  assert(bytes.subarray(0,32).every(byte => byte === 11));
  assert(bytes.subarray(32,128).every(byte => byte === 33));
  assert(bytes.subarray(128).every(byte => byte === 22));
  // Reloading the saved preset also recovers a later CPU write.
  chip.write(1,0,0x60); chip.write(1,8,123);
  await audio.applyPreset(captured);
  assert.equal(audio.capturePreset(captured).adpcm.data,captured.adpcm.data);
  // A second reload must upload too, even with identical authored data/address.
  chip.write(1,0,0x60); chip.write(1,8,45);
  await audio.applyPreset(captured);
  assert.equal(audio.capturePreset(captured).adpcm.data,captured.adpcm.data);
  await audio.dispose();
});

test('an upload begun before a CPU write cannot clear its dirty memory state', async () => {
  let wait = null;
  const {audio,chip} = await audioFixture({waitForUpload:() => wait});
  let complete;
  wait = new Promise(resolve => { complete = resolve; });
  const old = chip.adpcm.loadMemory(new Uint8Array(64),0);
  chip.write(1,0,0x60); chip.write(1,8,123);
  complete(); await old;
  assert.throws(() => audio.capturePreset(),/CPU data-register/);
  wait = null;
  await chip.adpcm.loadMemory(new Uint8Array(64).fill(44),0);
  assert(decodeBase64(audio.capturePreset().adpcm.data).every(byte => byte === 44));
  await audio.dispose();
});


test('keyboard release preserves canonical ADPCM volume and requested Gate Off while its owner queue fades',async() => {
  let frame = 0, f;
  const queue = createPerformanceQueue({sampleRate:44100,nowFrame:() => frame,apply:command => f.writes.push({port:command.port,register:command.register,value:command.value,frame})});
  f = await audioFixture({node:{port:{postMessage:message => queue.receive(message)}}});
  await f.audio.noteOn('adpcm',0,60); f.writes.length = 0;
  f.audio.noteOff('adpcm',0);
  assert.equal(f.chip.adpcm.registers[0],1); assert.equal(f.chip.adpcm.registers[11],192);
  assert.equal(f.audio.capturePreset().adpcm.volume,192); assert(!f.writes.some(write => write.register === 0));
  frame = 250; f.context.currentTime = frame/44100; queue.advance(frame);
  assert(f.writes.some(write => write.register === 11 && write.value < 192));
  assert.equal(f.audio.capturePreset().adpcm.volume,192); assert.equal(f.chip.adpcm.registers[11],192);
  f.chip.adpcm.setVolume(99); assert.equal(f.audio.capturePreset().adpcm.volume,99);
  frame = 1000; f.context.currentTime = frame/44100; queue.advance(frame);
  assert.deepEqual(f.writes.at(-1),{port:1,register:11,value:99,frame});
  await f.audio.dispose();
});

test('raw ADPCM keyOff stays immediate and an old release cannot overwrite a new preset or retrigger',async() => {
  let frame = 0, f;
  const queue = createPerformanceQueue({sampleRate:44100,nowFrame:() => frame,apply:command => f.writes.push({port:command.port,register:command.register,value:command.value})});
  f = await audioFixture({node:{port:{postMessage:message => queue.receive(message)}}});
  await f.audio.noteOn('adpcm',0,60); f.audio.noteOff('adpcm',0);
  frame=200;f.context.currentTime=frame/44100;queue.advance(frame);f.writes.length=0;
  f.chip.adpcm.keyOff();assert.deepEqual(f.writes[0],{port:1,register:0,value:1});
  assert.equal(f.writes.at(-1).value,192);const count=f.writes.length;
  frame=1000;f.context.currentTime=frame/44100;queue.advance(frame);assert.equal(f.writes.length,count);
  await f.audio.noteOn('adpcm',0,60);f.audio.noteOff('adpcm',0);
  const next=f.audio.getPreset();next.adpcm.volume=87;await f.audio.applyPreset(next);await f.audio.noteOn('adpcm',0,67);
  f.writes.length=0;frame=3000;f.context.currentTime=frame/44100;queue.advance(frame);assert.deepEqual(f.writes,[]);
  assert.equal(f.audio.capturePreset().adpcm.volume,87);assert(f.chip.adpcm.registers[0]&128);
  await f.audio.dispose();
});
