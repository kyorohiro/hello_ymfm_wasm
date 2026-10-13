// Common tone API: Hz or note/MIDI -> configure pitch -> keyOn/keyOff.
// FM presets are required to select an audible voice.
const chip = await createSoundChip('ym2612');
try {
  chip.setPreset(0, FM_PRESETS['one-op-basic']);
  chip.setFrequency(0, 440); // Hz, without triggering.
  chip.keyOn(0);
  await sleep(0.25);
  chip.keyOff(0);
  chip.setNote(0, 'E4');
  chip.keyOn(0);
  await sleep(0.25);
  chip.keyOff(0);
  chip.noteOn(0, 'C4'); // setNote + keyOn.
  await sleep(0.25);
  chip.keyOff(0);
  chip.noteOn(0, 69); // MIDI 69 = A4 = 440 Hz. This number is NOT Hz.
  await sleep(0.25);
  chip.keyOff(0);
  // For raw hardware pitch, use setBlockFnum(channel, block, fnum).
  chip.noteOnRaw(0, 4, 600);
  await sleep(0.25);
  chip.keyOff(0);
} finally { chip.dispose(); }
