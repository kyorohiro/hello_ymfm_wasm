fm.reset();

// YM2612 DAC lives on channel 6.
// This is not FM synthesis.
// We feed one 8-bit value at a time into register 0x2A.
fm.setDacEnabled(true);

const waveform = [
  0x80, 0xa0, 0xc0, 0xe0,
  0xff, 0xe0, 0xc0, 0xa0,
  0x80, 0x60, 0x40, 0x20,
  0x00, 0x20, 0x40, 0x60,
];

await new Promise((resolve) => {
  let index = 0;
  let written = 0;
  const timer = setInterval(() => {
    fm.writeDac(waveform[index]);
    index = (index + 1) % waveform.length;
    written += 1;

    if (written >= 320) {
      clearInterval(timer);
      resolve();
    }
  }, 1);
});

fm.writeDac(0x80);
fm.setDacEnabled(false);
