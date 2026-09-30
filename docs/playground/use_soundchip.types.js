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
neo.ssg.tone(0, {frequency:440});

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
