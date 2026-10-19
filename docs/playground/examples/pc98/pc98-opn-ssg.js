// Select Mode: PC-98 (YM2203 / OPN). Works in Main and Worker.
// fm and the three SSG channels share the default YM2203.
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
await play('C4', {channel: CH1, beats: 1});

// Tone: Hz uses the YM2203 SSG clock (master / 2).
ssg.tone(0, {frequency: 440, volume: 10});
await beat(1);
ssg.keyOff(0);

// Noise: period is shared across the noise-enabled SSG channels.
ssg.noise(1, {period: 16, volume: 8});
await beat(1);
ssg.keyOff(1);

// Envelope: its generator is shared across envelope-enabled channels.
ssg.setEnvelope({period: 2000, shape: 9});
ssg.tone(2, {frequency: 880, envelope: true});
await beat(1);
ssg.keyOff(2);
