// Round Start · 8 bars, 120 BPM. Use the original MSM6295 kit.
// Play along on CH4. During bars 3 and 7, drag CH1 → OP1 TL.
const eighth = 0.25;

// Algorithm 4 pairs two modulators with two carriers.
// The OPM API numbers operators in register order: M1, C1, M2, C2.
function pairVoice(ch, levels, multiples, feedback) {
  opm.setAlgo(ch, 4, feedback);
  opm.setPan(ch, true, true);
  opm.writeRegister(0x38 + ch, 0); // No pitch or amplitude modulation.
  for (let op = 0; op < 4; op++) {
    opm.setOperator(ch, op, {
      mul: multiples[op], tl: levels[op], dt1: 0, dt2: 0,
      ar: ch === 0 ? 31 : 24, ks: 0, am: 0,
      d1r: 8, d1l: 3, d2r: 0, rr: ch === 0 ? 11 : 8,
    });
  }
}
pairVoice(0, [29, 22, 42, 32], [1, 1, 2, 1], 3);
pairVoice(1, [35, 30, 48, 36], [2, 1, 3, 1], 2);
pairVoice(2, [40, 31, 44, 38], [1, 1, 2, 1], 1);

const bass = ['C3','Ab2','F2','G2','C3','Eb3','Ab2','G2'];
const calls = ['G4','Eb5','Ab4','G4','C5','Bb4','Eb5','D5'];
const replies = ['Eb4','C4','F4','D4','G4','G4','C5','B4'];
function attack(ch, note) {
  opm.setNote(ch, note);
  opm.keyOn(ch, 15);
}

for (let bar = 0; bar < 8; bar++) {
  const sustain = bar === 2 || bar === 6;
  for (let step = 0; step < 8; step++) {
    if (step === 0 || (!sustain && step === 4)) attack(0, bass[bar]);
    if (step === 1 || step === 3) attack(1, calls[bar]);
    if (step === 5 || step === 7) attack(2, replies[bar]);
    if (step === 0 || step === 4) oki.play(0, 0, 2); // Kick
    if (step === 2 || step === 6) oki.play(1, 1, 3); // Snare
    oki.play(2, 2, step % 2 ? 6 : 4);                // Closed hat
    await sleep(eighth * 0.78);
    if ((!sustain && (step === 2 || step === 6)) || step === 7) opm.keyOff(0);
    if (step % 2) opm.keyOff(step < 4 ? 1 : 2);
    await sleep(eighth * 0.22);
  }
}
