// Compare this same scene in Web Audio / Native, Main / Worker. One cycle = 40 seconds.
// 同じコードで混合音源を聴き比べ。Run → Keyboard は独立した YM2612 CH2–6。
// Original generated tones only; adjust scene-fm / scene-pcm / scene-dx7 in Mixer.
// 自動検査・録音だけでは実際の出力機器でのノイズの有無は断定できません。
// Live edits reuse these IDs; Stop disposes them before a fresh Run.
const {lead, bass, pad} = await livePrepare('mixed-chip-scene-chips', async () => ({
  lead: await createSoundChip('ym2612', {id: 'scene-fm'}),
  bass: await createSoundChip('rf5c164', {id: 'scene-pcm'}),
  pad: await createSoundChip('dx7', {id: 'scene-dx7'}),
}));

for (let channel = 0; channel < 6; channel++) {
  lead.setPreset(channel, FM_PRESETS['one-op-basic']);
  lead.setOperator(channel, 3, {tl: channel === 0 ? 20 : 28, ar: 18, rr: 10});
}
await pad.setPreset({
  name: 'SCENE PAD', algorithm: 31, feedback: 0,
  operators: {
    1: {
      coarse: 1, outputLevel: 78,
      envelope: {rates: [65, 70, 60, 65], levels: [99, 86, 80, 0]},
    },
  },
});

// A finite bass sample fades to zero before its gate closes, even at the lowest note.
const sampleRate = 12000, rootNote = 29; // F1; all bass notes below are >= F1.
const samples = new Float32Array(Math.round(sampleRate * 0.28));
const rootHz = 440 * 2 ** ((rootNote - 69) / 12);
for (let frame = 0; frame < samples.length; frame++) {
  const time = frame / sampleRate;
  const ramp = Math.min(1, time / 0.008, (samples.length - 1 - frame) / (sampleRate * 0.045));
  const envelope = (1 - Math.cos(Math.PI * ramp)) / 2;
  const phase = 2 * Math.PI * rootHz * time;
  samples[frame] = 0.6 * (Math.sin(phase) + 0.22 * Math.sin(2 * phase)) / 1.22 * envelope;
}
const wave = await bass.loadSample({sampleRate, channels: [samples]}, {endGuardBytes: 32});
await bass.setChannel(0, {...wave, volume: 145, pan: {left: 15, right: 15}});
const stepFor = midi => Math.round(wave.step * 2 ** ((midi - rootNote) / 12));

// These are scene-specific starting levels, not new chip defaults or loudness normalization.
await mixer.set(lead.id, {volume: 0.45, pan: -0.15});
await mixer.set(bass.id, {volume: 0.55, pan: 0.10});
await mixer.set(pad.id, {volume: 0.30, pan: 0.15});
setBpm(96);

// The sequence reserves CH1; Keyboard gets CH2–6 and its own press identities.
const held = new Map();
keyboard.bind('Mixed scene · YM2612 CH2–6', {
  noteOn({id, midi}) {
    if (held.has(id)) return;
    const channel = [1, 2, 3, 4, 5].find(value => ![...held.values()].includes(value));
    if (channel === undefined) return;
    held.set(id, channel);
    lead.noteOn(channel, midi);
  },
  noteOff({id}) {
    const channel = held.get(id);
    if (channel === undefined) return;
    held.delete(id);
    lead.keyOff(channel);
  },
  allNotesOff() {
    held.clear();
    for (let channel = 1; channel < 6; channel++) lead.keyOff(channel);
  },
});

const progression = [
  {root: 36, chord: [60, 64, 67], melody: [72, 76, 79, 76, 74, 72, 67, 71]},
  {root: 33, chord: [57, 60, 64], melody: [72, 76, 69, 72, 71, 69, 67, 64]},
  {root: 29, chord: [53, 57, 60], melody: [69, 72, 77, 76, 72, 69, 67, 65]},
  {root: 31, chord: [55, 59, 62], melody: [67, 71, 74, 79, 77, 74, 71, 67]},
];
liveCleanup(['mixed-chip-scene'], async () => {
  lead.keyOff(0);
  await bass.keyOff(0);
  pad.allNotesOff();
});
liveLoop('mixed-chip-scene', async () => {
  for (const section of progression) {
    for (const midi of section.chord) pad.noteOn(midi, 68);
    for (let bar = 0; bar < 4; bar++) {
      for (let step = 0; step < 8; step++) {
        if (step % 2 === 0) {
          const midi = section.root + [0, 7, 12, 7][step / 2];
          await bass.setPitch(0, stepFor(midi));
          await bass.keyOn(0);
        }
        lead.noteOn(0, section.melody[(step + bar * 2) % 8]);
        await beat(0.32);
        lead.keyOff(0);
        await beat(0.18);
        if (step % 2 === 1) await bass.keyOff(0);
      }
    }
    for (const midi of section.chord) pad.noteOff(midi);
  }
});
log('Mixed chip scene ready · YM2612 + RF5C164 + DX7 · Keyboard: YM2612 CH2–6');
