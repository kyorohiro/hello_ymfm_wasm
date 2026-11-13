// SPDX-License-Identifier: BSD-3-Clause
// Keyboard adapter for one physical channel of a written-register observer.
// It never loads the author's patch or sample RAM over a Code-owned channel.
export function createSynthLocalChannelVoice(interaction,{prefix='local',pitchClock=7670454}={}) {
  const held=new Map();let sequence=0;
  return {
    noteOn(channel,block,fnum) {
      const id=`${prefix}:${++sequence}`;
      const result=interaction.noteOn(id,{block,fnum},{channel,pitchClock});
      held.set(channel,id);return {...result,block,fnum};
    },
    noteOff(channel) {
      const id=held.get(channel);if(!id)return false;
      held.delete(channel);return interaction.noteOff(id);
    },
    setFrequency(channel,block,fnum) {
      const id=held.get(channel);return id?interaction.retuneKeyboard(id,{block,fnum},{pitchClock}):false;
    },
    forgetNote(channel) {
      const id=held.get(channel);held.delete(channel);return id?interaction.forgetKeyboard(id):false;
    },
    releaseKeyboard() {held.clear();return interaction.releaseKeyboard();},
    releaseNotes() {held.clear();return interaction.releaseKeyboard();},
    describe:channel=>interaction.describe(channel),
    read:()=>interaction.read(),
  };
}
