// Choose 0_default.rom and YM2151 CH4. Play brass over these two loops.
// Change the bass notes or move a snare step, then press Apply.
setBpm(124);
opm.setAlgo(3, 4, 2);
opm.setPan(3, true, true);
for (let op = 0; op < 4; op++) {
  opm.setOperator(3, op, {
    mul:[2, 1, 3, 1][op], tl:[34, 24, 45, 27][op],
    ar:24, d1r:8, d1l:3, d2r:1, rr:9,
  });
}

liveLoop('bass', async () => {
  for (const note of ['C3', 'C3', 'Eb3', 'G2']) {
    opm.noteOn(0, note);
    await beat(0.72);
    opm.keyOff(0);
    await beat(0.28);
  }
});

liveLoop('drums', async () => {
  for (let step = 0; step < 8; step++) {
    if ([0, 4, 7].includes(step)) oki.play(0, 0, 2);
    if ([2, 6].includes(step)) oki.play(1, 1, 3);
    oki.play(2, 2, step % 2 ? 7 : 4);
    await beat(0.5);
  }
});
