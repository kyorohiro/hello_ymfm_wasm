fm.reset();

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);

const { block, fnum } = noteToBlockFnum("C4");
fm.setFrequency(CH1, block, fnum);
fm.keyOn(CH1);
await sleep(0.4);
fm.keyOff(CH1);
await sleep(0.3);
