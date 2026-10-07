import {createSoundChip, encodeWav, SoundChipMixer} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth';
import {MegaSynth} from 'tetorica-fm2612/megasynth';
import {Playground} from 'tetorica-fm2612/playground_runtime';
import {createDeadlineScheduler} from 'tetorica-fm2612/playground_clock';
const chip = await createSoundChip('ym2612', {execution: 'worklet'});
const fm = new YM2612Synth({transport: new YM2612WorkletTransport(chip)});
fm.noteOn(0, 4, 553);
const synth = new MegaSynth({mega32X: true});
await synth.pwm?.read(0);
const pg = Playground({execution: 'worker'});
await pg.playSource('fm.noteOn(0, 4, 553);');
createDeadlineScheduler({now: () => performance.now()});
const bytes: Uint8Array = encodeWav({sampleRate: 48000, left: new Float32Array(128)});
void bytes;

const mixer = new SoundChipMixer();
mixer.set('gb1', {volume:0.28, pan:0, muted:false});
mixer.reset();
const mixedChip = await createSoundChip('gameboy', {execution:'worklet', mixer, id:'gb1'});
mixedChip.mixer.get(mixedChip.id).volume.toFixed(2);
const mixedSynth = new MegaSynth({mixer});
mixedSynth.mixer.set('ym2612', {volume:0.5});
// @ts-expect-error Mixer volume is a number.
mixer.set('gb1', {volume:'quiet'});
await mixedChip.dispose();
