fm.reset();

// Port 0, channel 1, operator 4 only

// DT / MULTI
fm.writeAddress(0, 0x3c);
fm.writeData((0 << 4) | 1);

// Total Level
fm.writeAddress(0, 0x4c);
fm.writeData(8);

// Attack Rate
fm.writeAddress(0, 0x5c);
fm.writeData(22);

// First Decay Rate
fm.writeAddress(0, 0x6c);
fm.writeData(6);

// Sustain Rate
fm.writeAddress(0, 0x7c);
fm.writeData(3);

// Sustain Level / Release Rate
fm.writeAddress(0, 0x8c);
fm.writeData((3 << 4) | 8);

// Algorithm / Feedback
fm.writeAddress(0, 0xb0);
fm.writeData((0 << 3) | 7);

// Left / Right output enable
fm.writeAddress(0, 0xb4);
fm.writeData(0xc0);

// BLOCK / F-NUM high and low
fm.writeAddress(0, 0xa4);
fm.writeData((4 << 3) | ((553 >> 8) & 0x07));
fm.writeAddress(0, 0xa0);
fm.writeData(553 & 0xff);

// Key On all operators on channel 1
fm.writeAddress(0, 0x28);
fm.writeData(0xf0 | 0x00);
await sleep(0.4);

// Key Off
fm.writeAddress(0, 0x28);
fm.writeData(0x00);
await sleep(0.3);
