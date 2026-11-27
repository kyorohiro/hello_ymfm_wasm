// SPDX-License-Identifier: BSD-3-Clause
export function bankedSong(fm = false) {
  const commands = [];
  const le = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24];
  function block(offset, data) {
    commands.push(0x67, 0x66, 0x8b, ...le(data.length+8), ...le(0x80000), ...le(offset), ...data);
  }
  for (const bank of [0,1]) {
    block(bank << 18, [0,4,0, 0,7,255]);
    block((bank << 18)+1024, Array(1024).fill(bank ? 0xbb : 0x33));
  }
  const write = (r,v) => commands.push(0xb8,r,v);
  const wait = n => commands.push(0x61,n&255,n>>>8);
  write(0,128); write(0,0x10); wait(4410);
  write(15,1); write(0,128); write(0,0x32); wait(44100);
  block(0x40400, [0xff]);
  wait(44100); commands.push(0x66);
  const bytes = Buffer.alloc(256 + commands.length);
  bytes.write('Vgm ');bytes.writeUInt32LE(bytes.length-4,4);bytes.writeUInt32LE(0x171,8);
  bytes.writeUInt32LE(92610,0x18);bytes.writeUInt32LE(204,0x34);
  if (fm) bytes.writeUInt32LE(3579545,0x30);
  bytes.writeUInt32LE(1000000,0x98);bytes.set(commands,256);
  return bytes;
}
