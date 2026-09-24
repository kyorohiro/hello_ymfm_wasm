const state =
  /** @type {{ isInit?: boolean, hitCount?: number }} */ (pg.context);

if (!state.isInit) {
  fm.reset();
  fm.setPreset(CH1, FM_PRESETS["two-op-bell"]);
  fm.setPan(CH1, true, true);
  state.isInit = true;
  state.hitCount = 0;
  log("Initialized pg.context.");
}

state.hitCount += 1;
log("Run count:", state.hitCount);

await play("C4", { channel: CH1, duration: 0.18 });
await sleep(0.05);
await play("E4", { channel: CH1, duration: 0.18 });
await sleep(0.05);
await play("G4", { channel: CH1, duration: 0.28 });
