// SPDX-License-Identifier: BSD-3-Clause
// Original DMG register sequence. No game, BIOS, sampled PCM or ROM data.
export const DMG_SONG_FUTURE_FRAME=39690; // 0.9 s in the VGM 44,100 Hz clock.
export const DMG_SONG_RELEASE_FRAME=72765;
export const DMG_SONG_END_FRAME=92610;
export const DMG_SONG_INITIAL_WAVE=Array.from({length:32},(_,index)=>index<16?index:31-index);
export const DMG_SONG_FUTURE_WAVE=Array.from({length:32},(_,index)=>index%2?0:15);
const write=(register,value)=>[0xb3,register,value];
const wait=frames=>[0x61,frames&255,frames>>8];
const waveWrites=wave=>Array.from({length:16},(_,index)=>write(32+index,(wave[index*2]<<4)|wave[index*2+1])).flat();

export function createDmgSongFixture({clock=4194304,extraCommand=[]}={}){
  const initial=[
    ...write(22,0x80),...write(20,0x77),...write(21,0xff),
    ...write(0,0),...write(1,0x40),...write(2,0x70),...write(3,0x0b),...write(4,0x86),
    ...write(6,0x80),...write(7,0x50),...write(8,0x72),...write(9,0x86),
    ...write(10,0),...waveWrites(DMG_SONG_INITIAL_WAVE),...write(10,0x80),...write(11,0),...write(12,0x40),...write(13,0xd0),...write(14,0x86),
    ...write(16,0),...write(17,0x30),...write(18,0x43),...write(19,0x80),
  ];
  const future=[...write(1,0xc0),...write(2,0x90),...write(6,0),...write(10,0),...waveWrites(DMG_SONG_FUTURE_WAVE),...write(10,0x80),...write(14,0x86),...write(17,0x60),...write(18,0x1b),...write(19,0x80)];
  const release=[...write(2,0),...write(7,0),...write(10,0),...write(17,0)];
  const commands=Uint8Array.from([...initial,...wait(DMG_SONG_FUTURE_FRAME),...future,
    ...wait(DMG_SONG_RELEASE_FRAME-DMG_SONG_FUTURE_FRAME),...release,...extraCommand,
    ...wait(DMG_SONG_END_FRAME-DMG_SONG_RELEASE_FRAME),0x66]);
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x18,DMG_SONG_END_FRAME,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x80,clock,true);bytes.set(commands,256);
  const events=[{frame:0,writes:initial},{frame:DMG_SONG_FUTURE_FRAME,writes:future},{frame:DMG_SONG_RELEASE_FRAME,writes:release}];
  return {bytes,events};
}
