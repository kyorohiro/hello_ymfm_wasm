// Shift raw OPN pitch without changing the keyboard's reference tuning.
export function bendPitch(pitch, semitones) {
  if (semitones === 0) return {...pitch};
  let block = pitch.block;
  let fnum = pitch.fnum * 2 ** (semitones / 12);
  while (fnum > 2047 && block < 7) { fnum /= 2; block++; }
  while (fnum < 1024 && block > 0) { fnum *= 2; block--; }
  return {block, fnum: Math.max(0, Math.min(2047, Math.round(fnum)))};
}

export function applyPitchBend(synth, voices, semitones) {
  for (const voice of voices) {
    if (!voice.basePitch) continue;
    const pitch = bendPitch(voice.basePitch, semitones);
    synth.setFrequency(voice.channel, pitch.block, pitch.fnum);
  }
}
