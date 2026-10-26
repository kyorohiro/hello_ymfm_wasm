// Run, then open Keyboard to play this original DX7 voice.
// Guitar / Bass / Ukulele input shares this binding. No SysEx file is needed.
const synth = await useSoundChip('dx7');
await synth.setPreset({
  name: 'KEYBOARD', algorithm: 0, feedback: 0,
  operators: {
    1: {
      coarse: 1, outputLevel: 85,
      envelope: {rates: [99, 80, 70, 75], levels: [99, 90, 80, 0]},
    },
    2: {
      coarse: 2, outputLevel: 55,
      envelope: {rates: [99, 70, 50, 75], levels: [99, 70, 40, 0]},
    },
  },
});

// DX7 noteOff releases every voice at that pitch. Keep the latest press ID
// for each MIDI note so an older release cannot cut off a newer press.
const held = new Map();
keyboard.bind('DX7 Keyboard', {
  noteOn({id, midi, velocity}) {
    held.set(midi, id);
    synth.noteOn(midi, velocity);
  },
  noteOff({id, midi}) {
    if (held.get(midi) !== id) return;
    held.delete(midi);
    synth.noteOff(midi);
  },
  allNotesOff() {
    held.clear();
    synth.allNotesOff();
  },
});
log('DX7 ready. Open Keyboard to play. Stop releases this binding.');
