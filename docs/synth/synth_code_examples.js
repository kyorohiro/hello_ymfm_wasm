// SPDX-License-Identifier: BSD-3-Clause
// Editable source only. Adding these files never starts an audio engine.
export const FM_CODE_EXAMPLES = Object.freeze({
  '/examples/timed-operators.js': `const fm = await useSoundChip("ym2612");
setBpm(120);

// One audible operator, so changes to OP1 are easy to hear. Other CHs are free.
fm.setAlgo(CH1, 7);
fm.setPan(CH1, true, true);
fm.setOperators(CH1, [
  [OP1, { dt: 0, multi: 1, tl: 32, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 8 }],
  [OP2, { tl: 127 }], [OP3, { tl: 127 }], [OP4, { tl: 127 }],
]);

// Software timing; the hardware operator registers still make the sound.
// Recording does not read or change the chip. MULT shares a register with DT:
// changing MULT alone keeps the DT value present when the operation executes.
function operatorMotion(seconds) {
  return fm.build(b => {
    for (let i = 0; i < 32; i++) {
      const wave = (1 - Math.cos(i / 32 * Math.PI * 2)) / 2;
      b.atSeconds(i / 32 * seconds).setOperator(CH1, OP1, {
        tl: Math.round(24 + 32 * wave), multi: 1 + Math.round(3 * wave),
      });
    }
  });
}
const writes = await fm.compile(operatorMotion(1), { initialState: "client" });
console.log("Predicted register writes (port, register, value):", writes.length);
console.table(writes.slice(0, 8)); // 'writes' contains the full trace.

liveLoop("melody", async () => {
  fm.noteOn(CH1, choose(scale("E2", "minorPentatonic", 2)));
  await beat(0.4);
  fm.noteOff(CH1);
  await beat(0.1);
});

// Independent of the melody. Change these rates and Apply while notes continue.
liveLoop("operator-motion", async () => {
  const seconds = choose([0.25, 0.5, 1]);
  await fm.schedule(operatorMotion(seconds), {
    name: "operator-motion", repeatSeconds: seconds,
  });
  await beat(8);
});

// schedule() means accepted, not finished. Replacing the name restarts its phase.
// Stop / removing this liveLoop cancels its reservations. Removing only its
// schedule() line retains them; use fm.clearSchedule("operator-motion") to cancel.
// BPM changes the melody and rate-step spacing; seconds stays an absolute time.
`,
});

/** Supply missing examples without replacing edits or selecting a new file. */
export function addFmCodeExamples(project) {
  const fold = path => path.normalize('NFC').toLowerCase();
  const files = new Set(project.fs.list().map(file => fold(file.path)));
  const folders = new Set(project.fs.listDirectories().map(fold));
  const entries = Object.entries(FM_CODE_EXAMPLES).filter(([path]) => {
    const value = fold(path);
    if (files.has(value) || folders.has(value)) return false;
    const parts = value.split('/').filter(Boolean);
    return !parts.slice(0, -1).some((_, index) => files.has('/' + parts.slice(0, index + 1).join('/')));
  }).map(([path, data]) => ({path, type: 'text', data}));
  if (entries.length) project.fs.writeFiles(entries);
  return entries.map(entry => entry.path);
}
