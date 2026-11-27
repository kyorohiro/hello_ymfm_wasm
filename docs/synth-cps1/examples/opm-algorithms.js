// OPM algorithms · CH1. Compare four A3 notes with the same two operators.
// In FM → CH1, watch Algorithm. During the last note, drag OP3 TL.
const ch = 0;
const op4 = 0b1000;
const op3And4 = 0b1100;
opm.setPan(ch, true, true);
opm.writeRegister(0x38 + ch, 0); // Disable LFO sensitivity on this channel.

// setOperator uses register order: OP3 (C1) is index 1, OP4 (C2) is index 3.
const envelope = {ar:31, d1r:0, d1l:0, d2r:0, rr:15, ks:0, am:0, dt1:0, dt2:0};
opm.setOperator(ch, 1, {...envelope, mul:2, tl:22});
opm.setOperator(ch, 3, {...envelope, mul:1, tl:20});
opm.setNote(ch, 'A3');

async function play(mask, seconds) {
  opm.keyOn(ch, mask);
  await sleep(seconds);
  opm.keyOff(ch);
  await sleep(0.3);
}

opm.setAlgo(ch, 7, 0); // OP3 + OP4: the second note adds an octave.
await play(op4, 1);
await play(op3And4, 1.5);

opm.setAlgo(ch, 4, 0); // OP3 → OP4: the same octave now modulates OP4.
await play(op4, 1);
await play(op3And4, 8); // Raise OP3 TL toward 127 to hear the modulation fade.
