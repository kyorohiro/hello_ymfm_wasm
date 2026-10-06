fm.reset();

// YM2612 CH3 Special Mode
fm.setChannel3SpecialMode(true);

// ALG 7:
// OP1, OP2, OP3, OP4 are all carriers.
fm.setAlgo(CH3, 7, 0);
fm.setPan(CH3, true, true);

const op = {
  multi: 1,
  tl: 24,
  ar: 31,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
};

fm.setOperator(CH3, OP1, op);
fm.setOperator(CH3, OP2, op);
fm.setOperator(CH3, OP3, op);
fm.setOperator(CH3, OP4, op);

// CH3 Special Mode frequency registers:
//
// OP3 -> 0xA8 / 0xAC
// OP1 -> 0xA9 / 0xAD
// OP2 -> 0xAA / 0xAE
// OP4 -> normal CH3 frequency (0xA2 / 0xA6)
//
// Rough C-E-G-C chord.
//
// Same BLOCK, different FNUM values.
// These do not need to be exact equal-tempered pitches;
// the point is to make the four independent frequencies obvious.

fm.setChannel3SpecialFrequency(OP1, 4, 512); // C-ish
fm.setChannel3SpecialFrequency(OP2, 4, 645); // E-ish
fm.setChannel3SpecialFrequency(OP3, 4, 768); // G-ish

// OP4 frequency is written through the normal CH3 frequency registers.
// noteOn also performs KEY ON for all operators.
fm.noteOn(CH3, 5, 512); // upper C-ish

await sleep(1.5);

fm.noteOff(CH3);

await sleep(0.3);

fm.setChannel3SpecialMode(false);
