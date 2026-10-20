// Independent MSFA DX7, ready with the self-authored INIT SINE voice.
// MIDI note numbers 0..127; the DX7 allocates its own 16 voices.
const synth = await useSoundChip('dx7');
setBpm(110);
await mixer.set(synth.id, {volume: 0.5});

// To use your own DX7 SysEx, import a .syx file into FILES first:
// await synth.loadSysex(await file('/presets/my-bank.syx', {type:'arrayBuffer'}));
// console.log(synth.voices);
// synth.selectVoice(0);

liveLoop('dx7-melody', async () => {
  for (const note of [60, 64, 67, 72, 67, 64]) {
    synth.noteOn(note, 100);
    await beat(0.4);
    synth.noteOff(note);
    await beat(0.1);
  }
});
