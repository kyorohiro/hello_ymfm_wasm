// Hz and note names are separate APIs: noteOn(channel, note) sets a musical note.
// setFrequency(channel, hz) + keyOn(channel) uses the configured frequency.
const nes = await useSoundChip('nes');
try {
  nes.pulse.setVoice(0, {duty: 0.5, volume: 8});
  nes.pulse.setFrequency(0, 440);
  nes.pulse.keyOn(0);
  await sleep(0.3);
  // Change Hz while sounding, without choosing a new note name.
  nes.pulse.setFrequency(0, 660);
  await sleep(0.3);
  nes.pulse.keyOff(0);
  await sleep(0.15);
  // Restart the same 660 Hz pitch.
  nes.pulse.keyOn(0);
  await sleep(0.3);
  nes.pulse.keyOff(0);
} finally {
  nes.dispose();
}
