fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
await play("C4", { channel: CH1, duration: 0.35 });
await sleep(0.12);
await play("E4", { channel: CH1, duration: 0.35 });
await sleep(0.12);
await play("G4", { channel: CH1, duration: 0.5 });
