// A frozen reference channel played on the separate keyboard chip. The source
// song engine, its timers/envelopes and the editable instrument are untouched.
export function describeSynthSongVoice(snapshot, channel) {
  if (!Number.isInteger(channel) || channel < 0 || channel > 5 || !snapshot?.channels?.[channel]) {
    return {playable:false, reason:'No YM2612 channel snapshot.', channel, keyMask:0};
  }
  const voice = snapshot.channels[channel];
  const keyMask = voice.keyMask || voice.lastKeyMask || 15;
  let reason = '';
  if (channel === 5 && snapshot.dacEnabled) reason = 'DAC / PCM cannot be auditioned as an FM voice.';
  else if (channel === 2 && snapshot.csmEnabled) reason = 'CSM timer-triggered sound cannot be auditioned from the keyboard.';
  else if (voice.specialMode && !voice.specialFrequencies[3]?.fnum) reason = 'CH3 has no OP4 base pitch for keyboard transposition.';
  return {playable:!reason, reason, channel, keyMask};
}

// Keep the original ratio between special-mode operators. The keyboard supplies
// the new OP4 pitch; each other operator follows its recorded ratio to OP4.
function ratioPitch(pitch, ratio) {
  let block = pitch.block, fnum = pitch.fnum * ratio;
  while (fnum > 2047 && block < 7) {fnum /= 2; block++;}
  while (fnum > 0 && fnum < 1024 && block > 0) {fnum *= 2; block--;}
  return {block, fnum:Math.max(0, Math.min(2047, Math.round(fnum)))};
}

/** Transpose CH3's four recorded pitches around OP4, or set an ordinary pitch. */
export function setSynthSongVoiceFrequency(synth,channel,block,fnum,specialFrequencies=null) {
  if(!specialFrequencies)return synth.setFrequency(channel,block,fnum);
  const base=specialFrequencies[3];
  specialFrequencies.forEach((source,operator)=>{
    const ratio=source.fnum*2**source.block/(base.fnum*2**base.block);
    const pitch=ratioPitch({block,fnum},ratio);
    synth.setChannel3SpecialFrequency(operator,pitch.block,pitch.fnum);
  });
}

/**
 * Configure one frozen voice on an existing keyboard YM2612Synth and return a
 * note interface compatible with synth_input.js. Configure once per target or
 * snapshot change; callers own stopping input and restoring the editable patch.
 * The selected hardware channel is monophonic. No source-song chip is passed.
 */
export function createSynthSongVoice(synth, snapshot, channel) {
  const description = describeSynthSongVoice(snapshot, channel);
  if (!description.playable) throw new Error(description.reason);
  const voice = snapshot.channels[channel];
  const operators = [0,1,2,3].filter(operator => description.keyMask & (1 << operator));

  // Reset removes earlier notes/release tails and CSM timers from the keyboard
  // chip. The observed song keeps running/paused on its own engine.
  synth.reset();
  // YM2612Synth.setPreset expects a logical operator array; the observation
  // snapshot uses a keyed object so it cannot be passed through unchanged.
  synth.setPreset(channel, {...voice.preset,
    operators:[1,2,3,4].map(operator => voice.preset.operators[operator])});
  synth.setLfo(snapshot.lfo.enabled, snapshot.lfo.frequency);
  synth.setDacEnabled(false);
  synth.setChannel3SpecialMode(voice.specialMode);

  const adapter = {
    ...description,
    setFrequency(_channel, block, fnum) {
      setSynthSongVoiceFrequency(synth,channel,block,fnum,voice.specialMode?voice.specialFrequencies:null);
    },
    noteOn(_channel, block, fnum) {
      synth.noteOff(channel);
      adapter.setFrequency(channel, block, fnum);
      synth.keyOn(channel, operators);
    },
    noteOff(_channel) {synth.noteOff(channel);},
  };
  return adapter;
}
