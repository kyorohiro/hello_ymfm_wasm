// Independent OPM; numeric channels 0..7. Operator order: M1, C1, M2, C2.
const opm = await useSoundChip('ym2151');
try {
  opm.reset();
  opm.setAlgo(0, 7); // Four parallel carriers; enable only C2 below.
  opm.setPan(0, true, true);
  opm.setOperator(0, 3, {mul: 1, tl: 32, ar: 31, d1r: 0, d2r: 0, d1l: 0, rr: 15});
  for (const note of ['C4', 'E4', 'G4', 'A4']) {
    opm.setNote(0, note);
    opm.keyOn(0, 8); // Only C2.
    await sleep(0.2);
    opm.keyOff(0);
    await sleep(0.05);
  }
} finally { opm.dispose(); }
