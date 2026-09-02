Implement JavaScript export in the VGM Analyzer.

Goal:

Export parsed YM2612 VGM commands as editable JavaScript code that can be pasted into the Tetorica FM2612 Playground.

Use one liveLoop() per YM2612 channel.

Example output:

liveLoop("ch0", async () => {
  // CH0 OP1: DT=3, MULTI=1
  write(0x30, 0x71);
  // CH0 OP1: TL=35
  write(0x40, 0x23);
  // CH0: KEY ON
  write(0x28, 0xf0);
  await sleepSamples(735);
  // CH0: KEY OFF
  write(0x28, 0x00);
});
liveLoop("ch1", async () => {
  await sleepSamples(367);
  // CH1: KEY ON
  write(0x28, 0xf1);
  await sleepSamples(735);
  // CH1: KEY OFF
  write(0x28, 0x01);
});

Requirements:

* Separate YM2612 register writes by target channel when possible.
* Generate one liveLoop("ch0" ... "ch5") block per channel.
* Preserve the original VGM timing.
* Convert VGM wait commands into await sleepSamples(n).
* Timing inside each channel should be relative to that channel’s own timeline.
* If another channel changes while this channel is idle, accumulate that elapsed time and emit it as sleepSamples() before the next event for this channel.
* Do not use JavaScript setTimeout() or wall-clock timing.
* Keep timing in VGM/sample units so the Playground can handle synchronization.
* Preserve the original register address and value. Do not convert the export into high-level play() calls.
* Keep the export intentionally low-level because register-level changes may be important for reproducing FM-specific behavior.

Add deterministic comments for register writes where the meaning can be decoded reliably.

Examples:

// Enable LFO
write(0x22, 0x08);
// CH0 OP1: DT=3, MULTI=1
write(0x30, 0x71);
// CH0 OP1: TL=35
write(0x40, 0x23);
// CH0: KEY ON OP1-4
write(0x28, 0xf0);

Comments should describe what the register write does, not speculate about musical intent.

Good:

// CH0 OP2: TL=42

Avoid:

// Make the sound brighter

Support decoding comments for the common YM2612 register groups where practical:

* LFO
* DT / MULTI
* TL
* RS / AR
* AM / D1R
* D2R
* SL / RR
* SSG-EG
* FNUM / BLOCK
* algorithm / feedback
* stereo / AMS / FMS
* KEY ON / KEY OFF
* CH3 special mode where applicable

Important:

Some YM2612 registers are global or encode the target channel inside the written value, especially register 0x28.

Do not infer the target channel only from the surrounding exported liveLoop().

Preserve the original VGM port, address, and value internally so the export remains faithful.

For commands that cannot safely be assigned to a single channel, keep them in a separate global loop, for example:

liveLoop("global", async () => {
  // Enable LFO
  write(0x22, 0x08);
});

The first implementation does not need to convert the VGM into musical notes, instruments, presets, or BPM-based notation.

The priority is:

1. faithful register writes
2. faithful sample timing
3. channel-separated readable JavaScript
4. useful deterministic comments
5. code that can be copied into the existing Playground and edited manually

Add an Export JavaScript / Copy JavaScript action to the VGM Analyzer UI.

Keep the implementation modular so the register decoder/comment generator can later be reused elsewhere in the Analyzer.