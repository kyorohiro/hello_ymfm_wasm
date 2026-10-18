// Type-check fixture for the same module scope used by Monaco.
// @ts-check
const fm = await useSoundChip('ym2612');
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
await play('C4', {channel:CH1, duration:0.3});
// @ts-expect-error RF5C164 methods must not leak into FM completion.
fm.loadMemory(new Uint8Array());
const pcm = await useSoundChip('rf5c164');
await pcm.setChannel(0, {start:0,volume:255});
// @ts-expect-error No YM2612 preset API on RF5C164.
pcm.setPreset(CH1, {});
const gb = await useSoundChip('gameboy');
gb.pulse.setDuty(0, 0.5);
// @ts-expect-error Invalid duty.
gb.pulse.setDuty(0, 0.3);
const opna = await useSoundChip('ym2608');
opna.setPreset(CH1, FM_PRESETS['one-op-basic']);
// @ts-expect-error No Game Boy pulse API on YM2608.
opna.pulse.setDuty(0, 0.5);
const name = 'ym2612';
const same = await useSoundChip(name);
same.setPreset(CH1, FM_PRESETS['one-op-basic']);
// @ts-expect-error No multi-instance support in this version.
await useSoundChip('ym2612', {id:'fm1'});
// @ts-expect-error No SN76489 factory in this version.
await useSoundChip('sn76489');
const viaPg = await pg.useSoundChip('rf5c164');
await viaPg.keyOff(0);
export {};

const opn = await useSoundChip('ym2203');
opn.setPreset(2, FM_PRESETS['one-op-basic']);
// @ts-expect-error YM2203 has only three logical FM channels.
opn.keyOn(3);
// @ts-expect-error YM2203 does not expose YM2612 DAC.
opn.writeDac(128);
const neo = await useSoundChip('ym2610');
neo.setFrequency(3, 4, 1000);
// @ts-expect-error Neo Geo has four logical FM channels.
neo.keyOn(4);
// In YM2612 mode, YM2610 is an additional full chip.
if ('ssg' in neo) neo.ssg.tone(0, {frequency:440});

const extraFm = await createSoundChip('ym2612');
extraFm.setPreset(CH1, FM_PRESETS['one-op-basic']);
extraFm.noteOn(CH1, 4, 600);
extraFm.dispose();
const extraOpn = await createSoundChip('ym2203');
extraOpn.ssg.tone(0, {frequency: 440});
// @ts-expect-error YM2203 has three FM channels
extraOpn.noteOn(3, 4, 600);
const extraNeo = await createSoundChip('ym2610');
extraNeo.noteOn(3, 4, 600);
await extraNeo.adpcmA.loadMemory(new Uint8Array(256));
// @ts-expect-error YM2610 has four logical FM channels
extraNeo.noteOn(4, 4, 600);
// @ts-expect-error no scheduler on additional clients
extraFm.scheduleWrites([]);

extraOpn.setOperators(2, [[OP1, {tl: 20}], [OP2, {ar: 31}]]);
extraNeo.setOperators(3, [[OP1, {tl: 20}]]);
(await useSoundChip('ym2203')).setOperators(2, [[OP1, {tl: 20}]]);
(await useSoundChip('ym2610')).setOperators(3, [[OP1, {tl: 20}]]);
(await createSoundChip('ym2608')).setOperators(5, [[OP1, {tl: 20}]]);
// @ts-expect-error YM2203 has only three FM channels
extraOpn.setOperators(3, [[OP1, {tl: 20}]]);
// @ts-expect-error YM2610 has only four logical FM channels
extraNeo.setOperators(4, [[OP1, {tl: 20}]]);
await extraOpn.setClock(4000000);
await extraOpn.scheduleRegisters([[0, 8, 15], [4410, 8, 0]], 4410);

const sega = await useSoundChip('segapsg');
sega.tone(0, {note: 'C4'});
sega.noiseOff();
sega.dispose();
(await pg.createSoundChip('segapsg')).resetAll();

const opm = await useSoundChip('ym2151');
opm.setNote(7, 'A4');
opm.setOperator(7, 3, {ar: 31, tl: 32});
opm.keyOn(7);
(await pg.createSoundChip('ym2151')).setNoise(true, 12);
// @ts-expect-error OPM only has eight channels
opm.keyOn(8);

const mixedGb = await createSoundChip('gameboy', {id:'gb1'});
await mixer.set(mixedGb.id, {volume:0.28, pan:-0.5});
const gbMix = await pg.mixer.get(mixedGb.id);
gbMix.volume.toFixed(2);
await pg.mixer.reset(mixedGb.id);
// @ts-expect-error Volume is numeric.
await mixer.set('gb1', {volume:'quiet'});

const autoGb = await createSoundChip('gameboy');
await mixer.set(autoGb.id, {volume:0.3});
const cachedGb = await useSoundChip('gameboy');
cachedGb.id.toUpperCase();
// @ts-expect-error IDs are stable metadata.
autoGb.id = 'another';

const dx7 = await useSoundChip('dx7');
dx7.noteOn(60, 100);
dx7.noteOff(60);
dx7.allNotesOff();
dx7.panic();
const dx7Voices = await dx7.loadSysex(await file('/presets/my-bank.syx', {type:'arrayBuffer'}));
dx7Voices[0].name.toUpperCase();
dx7.selectVoice(0);
dx7.voices[0].index.toFixed();
dx7.internalSampleRate.toFixed();
(await dx7.getState()).sampleRate.toFixed();
const extraDx7 = await pg.createSoundChip('dx7', {id:'dx7-pad'});
await mixer.set(extraDx7.id, {volume:0.4});
await extraDx7.loadSysex(new DataView(new ArrayBuffer(163)));
extraDx7.dispose();
// @ts-expect-error DX7 uses MIDI note numbers, not channel + note-name arguments.
dx7.noteOn(0, 'C4');
// @ts-expect-error MSFA has a fixed internal rate; it has no chip clock.
dx7.setClock(4000000);
// @ts-expect-error The Playground client renders internally through AudioWorklet.
dx7.render(128);
// @ts-expect-error SysEx must be binary, not the default text file result.
await dx7.loadSysex(await file('/presets/my-bank.syx'));

const snes = await useSoundChip('snes');
const brr = new Uint8Array([3,0,0,0,0,0,0,0,0]);
const snesSample = await snes.loadBRR(brr, {baseFrequencyHz:2000, loopStartSamples:0});
snes.setPreset(0, {sample:snesSample, adsr1:0x8f, volumeLeft:90});
snes.noteOn(0, 'C4');
snes.noteOn(7);
snes.setFrequency(0, 440);
snes.setNote(0, 69);
snes.setPitch(0, 4096);
snes.noteOff(0);
(await snes.getPreset(0)).pitch.toFixed();
(await snes.getState()).nextAddress.toFixed();
(await snes.snapshot()).ram.byteLength.toFixed();
await mixer.set(snes.id, {volume:0.5});
(await pg.createSoundChip('snes', {id:'snes-bass'})).allNotesOff();
await snes.loadBRR(brr, {rootNote:'C4', basePitch:4096, loopStartSamples:0});
// @ts-expect-error Explicit tuning is required.
await snes.loadBRR(brr, {loopStartSamples:0});
// @ts-expect-error Choose exactly one tuning basis.
await snes.loadBRR(brr, {rootNote:'C4', baseFrequencyHz:440});
// @ts-expect-error Eight physical voices, numbered 0..7.
snes.noteOn(8, 'C4');
// @ts-expect-error S-DSP has no variable chip clock in this API.
snes.setClock(1024000);
// @ts-expect-error Velocity is not a third noteOn argument on this chip.
snes.noteOn(0, 'C4', 100);

/** @type {PlaygroundSnesTimeline} */
const snesTimeline = {version:1, clockRate:1024000, durationClocks:32000,
  initialState:{ram:new Uint8Array(65536), dsp:new Uint8Array(128), outputDelayFrames:4},
  events:new Uint32Array([0, 0, 0x4c, 1])};
(await snes.prepareTimeline(snesTimeline)).totalFrames.toFixed();
(await snes.playTimeline()).ended.valueOf();
(await snes.stopTimeline()).positionFrames.toFixed();
(await snes.getTimelineState()).playing.valueOf();
// @ts-expect-error Timeline clocks are not VGM's 44100-Hz sample units.
await snes.prepareTimeline({...snesTimeline, clockRate:44100});
// @ts-expect-error Preserve the source SPC's four-frame output FIFO.
await snes.prepareTimeline({...snesTimeline, initialState:{...snesTimeline.initialState, outputDelayFrames:0}});

const spc = await useSoundChip('spc');
await spc.loadSPC(await file('/spc/song/original.spc', {type:'arrayBuffer'}));
await spc.play();
await spc.pause();
await spc.seek(5);
await spc.setMuteMask(0xfe);
(await spc.getState()).positionSeconds.toFixed();
(await spc.snapshot()).ram.byteLength.toFixed();
const stopObservingSpc = spc.onEvent(event => {
  (event.clock / 1024000).toFixed(3);
  if (event.type === 'noteOn') {
    event.preset.adsr1.toFixed();
    event.pitch.toFixed();
    event.channel.toFixed();
    event.keyOffHeld.valueOf();
    // @ts-expect-error Raw PITCH has no inferred note name.
    event.note.toUpperCase();
  } else if (event.type === 'instrument') {
    event.sourceNumber.toFixed();
    event.preset.volumeLeft.toFixed();
  } else if (event.type === 'pitch') {
    event.pitch.toFixed();
    // @ts-expect-error A PITCH change does not carry a complete instrument preset.
    event.preset.gain.toFixed();
  } else if (event.type === 'volume') {
    event.volumeRight.toFixed();
  } else if (event.type === 'noteOff') {
    event.reason.toUpperCase();
  } else if (event.type === 'dsp') {
    event.register.toFixed();
    event.value.toFixed();
  } else {
    event.droppedWrites.toFixed();
    event.message.toUpperCase();
  }
}, {voices:[0,7], types:['noteOn','pitch','dsp'], intervalMs:32});
stopObservingSpc();
// @ts-expect-error SPC physical voices are 0..7.
spc.onEvent(() => {}, {voices:[8]});
// @ts-expect-error Only the documented musical/raw event types can be selected.
spc.onEvent(() => {}, {types:['note']});
// @ts-expect-error onEvent needs a callback, not an event name.
spc.onEvent('noteOn');
await mixer.set(spc.id, {volume:0.5});
(await createSoundChip('spc', {id:'spc:other'})).dispose();
// @ts-expect-error SPC is a file player, not a musical instrument.
spc.keyOn(0);
// @ts-expect-error SPC has a fixed native clock.
spc.setClock(1024000);
// @ts-expect-error Supply binary file data.
await spc.loadSPC(await file('/spc/song/original.spc'));
