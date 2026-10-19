// Select Mode: X68000. Built-in YM2151, channels 0..7; operators M1/C1/M2/C2.
setBpm(120);
opm.setAlgo(0, 7);
opm.setPan(0, true, true);
opm.setOperator(0, 3, {mul:1, tl:32, ar:31, d1r:0, d2r:0, d1l:0, rr:15});

liveLoop('x68000-opm-melody', async () => {
  for (const note of ['C4', 'E4', 'G4', 'B4', 'C5', 'G4', 'E4', 'D4']) {
    opm.setNote(0, note);
    opm.keyOn(0, 8); // Only C2, one of algorithm 7's four parallel carriers.
    await beat(0.4);
    opm.keyOff(0);
    await beat(0.1);
  }
});

// The built-in adpcm device is the X68000's mono OKIM6258.
