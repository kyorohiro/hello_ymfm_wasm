import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2608Synth} from '../js/ym2608synth.js';
import {createFm2608CodeClient, resolveFm2608CodeNoteTarget} from './code_client.js';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';

function fixture() {
  const writes = [];
  const chip = new YM2608Synth({transport:{write:(port, register, value) => writes.push({port, register, value}),
    loadAdpcmMemory:async () => {}, loadRhythmRom:async () => {}, reset() { writes.push({reset:true}); }}});
  return {chip, writes};
}

test('OPNA Code forwards bound musical pitch and all hardware sections to the same chip', async () => {
  const {chip, writes} = fixture();
  const {client} = createFm2608CodeClient(chip);
  client.noteOn(0, 'A4');
  assert.equal(chip.channels[0].fnum > 0, true);
  const pitch = chip.channels[0].fnum;
  client.setNote(0, 69);
  assert.equal(chip.channels[0].fnum, pitch);
  client.ssg.tone(0, {frequency:440, volume:10});
  client.rhythm.setVoice('bassDrum', {left:true, right:true});
  client.rhythm.keyOn(['bassDrum', 'snare']);
  await client.adpcm.loadMemory(new Uint8Array(32));
  client.adpcm.setSample({start:0, end:32});
  client.adpcm.keyOn({repeat:true});
  assert(writes.some(write => write.port === 1 && write.register === 0 && write.value === 0xb0));
  assert.equal(client.id, 'ym2608');
  assert.equal(client.ssg, client.ssg);
});

test('disposing borrowed OPNA notes preserves chip lifetime and rejects retired-session writes', () => {
  const {chip, writes} = fixture();
  let current = true;
  const {client, release} = createFm2608CodeClient(chip, {isCurrent:() => current});
  client.noteOn(1, 'C4');
  client.ssg.noteOn(2, 'E4');
  client.rhythm.keyOn('snare');
  client.adpcm.keyOn();
  writes.length = 0;
  client.dispose();
  assert(writes.some(write => write.port === 0 && write.register === 0x28 && write.value === 1));
  assert(writes.some(write => write.port === 0 && write.register === 10 && write.value === 0));
  assert(writes.some(write => write.port === 0 && write.register === 0x10 && write.value === 0x82));
  assert(writes.some(write => write.port === 1 && write.register === 0 && write.value === 1));
  assert(!writes.some(write => write.reset));
  client.noteOn(0, 'G4');
  current = false;
  assert.throws(() => client.noteOn(0, 'C5'), {name:'AbortError'});
  assert.throws(() => client.ssg.noteOn(0, 'C5'), {name:'AbortError'});
  release();
});

test('Stop Loop releases the monophonic ADPCM Gate while the rest of Code keeps running', async () => {
  const {chip, writes} = fixture();
  const {client, release} = createFm2608CodeClient(chip);
  const runtime = createPlaygroundCodeRuntime({supportedSoundChips:['ym2608'],
    ensureReady:async () => {}, now:() => 0, useSoundChip:async () => client,
    resolveNoteTarget:resolveFm2608CodeNoteTarget, guardExecution:false, stopSoundChips:release});
  try {
    await runtime.run(`const opna=await useSoundChip('ym2608');
liveLoop('sample',async()=>{opna.adpcm.keyOn({repeat:true});await beat(64);});`);
    assert(writes.some(write => write.port === 1 && write.register === 0 && write.value === 0xb0));
    writes.length = 0;
    await runtime.apply('stopLoop("sample");');
    assert(writes.some(write => write.port === 1 && write.register === 0 && write.value === 1));
    assert.equal(runtime.getState().running, true);
  } finally {
    await runtime.stop();
  }
});
