// Raw Game Boy DMG registers: offsets relative to 0xFF10. No game ROM needed.
const gb = await createSoundChip('gameboy');
const gbWrite = (register, value) => gb.writeRegister(register, value);
try {
  gb.reset();
  gbWrite(0x16, 0x80); // NR52: APU power.
  gbWrite(0x14, 0x33); // NR50: master volume.
  // Pulse 1, with sweep; left speaker.
  gbWrite(0x15, 0x10); gbWrite(0x00, 0x16); gbWrite(0x01, 0x80);
  gbWrite(0x02, 0xa0); gbWrite(0x03, 0xd6); gbWrite(0x04, 0x86);
  await sleep(0.5); gbWrite(0x02, 0);
  // Pulse 2; right speaker.
  gbWrite(0x15, 0x02); gbWrite(0x06, 0x40); gbWrite(0x07, 0xa0);
  gbWrite(0x08, 0x39); gbWrite(0x09, 0x87);
  await sleep(0.5); gbWrite(0x07, 0);
  // Wave channel: 32 four-bit samples, packed into 16 bytes.
  gbWrite(0x15, 0x44); gbWrite(0x0a, 0);
  const triangle = i => i < 16 ? i : 31 - i;
  for (let i = 0; i < 16; i++) gbWrite(0x20 + i, (triangle(i * 2) << 4) | triangle(i * 2 + 1));
  gbWrite(0x0a, 0x80); gbWrite(0x0c, 0x40); gbWrite(0x0d, 0xd6); gbWrite(0x0e, 0x86);
  await sleep(0.5); gbWrite(0x0a, 0);
  // Noise: compare the long and short LFSR modes.
  gbWrite(0x15, 0x88);
  for (const mode of [0x43, 0x4b]) {
    gbWrite(0x11, 0xa2); gbWrite(0x12, mode); gbWrite(0x13, 0x80);
    await sleep(0.4); gbWrite(0x11, 0);
  }
} finally { gb.dispose(); }
