import {
  createTfiFromPreset,
  parseTfi,
  tfiDetuneToYm2612Detune,
  ym2612DetuneToTfiDetune,
} from "../tetorica_src/runtime/tfi.js";

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function verifyOperatorOrder() {
  const bytes = new Uint8Array(42);
  bytes[0] = 4;
  bytes[1] = 2;

  // TFI operator blocks are S1, S3, S2, S4.
  // Use distinct MULTI values so the mapping is easy to see.
  bytes[2] = 11; // S1 -> logical O1
  bytes[12] = 13; // S3 -> logical O3
  bytes[22] = 12; // S2 -> logical O2
  bytes[32] = 14; // S4 -> logical O4

  const preset = parseTfi(bytes);

  expectEqual(preset.algorithm, 4, "algorithm");
  expectEqual(preset.feedback, 2, "feedback");
  expectEqual(preset.operators[1].multi, 11, "O1 multi");
  expectEqual(preset.operators[2].multi, 12, "O2 multi");
  expectEqual(preset.operators[3].multi, 13, "O3 multi");
  expectEqual(preset.operators[4].multi, 14, "O4 multi");
}

function verifyDetuneConversion() {
  const expected = [7, 6, 5, 0, 1, 2, 3];
  for (let index = 0; index < expected.length; index += 1) {
    expectEqual(tfiDetuneToYm2612Detune(index), expected[index], `detune ${index}`);
  }

  const reverseExpected = [3, 4, 5, 6, 3, 2, 1, 0];
  for (let index = 0; index < reverseExpected.length; index += 1) {
    expectEqual(ym2612DetuneToTfiDetune(index), reverseExpected[index], `reverse detune ${index}`);
  }
}

function verifyRoundTrip() {
  const sourcePreset = {
    algorithm: 4,
    feedback: 2,
    operators: {
      1: { multi: 11, dt: 7, tl: 12, rs: 2, ar: 31, d1r: 14, d2r: 9, rr: 5, sl: 8, ssg: 0 },
      2: { multi: 12, dt: 1, tl: 22, rs: 1, ar: 26, d1r: 12, d2r: 7, rr: 6, sl: 7, ssg: 0 },
      3: { multi: 13, dt: 6, tl: 32, rs: 0, ar: 24, d1r: 10, d2r: 5, rr: 7, sl: 6, ssg: 0 },
      4: { multi: 14, dt: 3, tl: 42, rs: 3, ar: 22, d1r: 8, d2r: 4, rr: 8, sl: 5, ssg: 0 },
    },
  };

  const bytes = createTfiFromPreset(sourcePreset);
  expectEqual(bytes.length, 42, "export size");

  const parsed = parseTfi(bytes);
  expectEqual(parsed.algorithm, sourcePreset.algorithm, "round-trip algorithm");
  expectEqual(parsed.feedback, sourcePreset.feedback, "round-trip feedback");
  expectEqual(parsed.operators[1].multi, sourcePreset.operators[1].multi, "round-trip O1 multi");
  expectEqual(parsed.operators[2].multi, sourcePreset.operators[2].multi, "round-trip O2 multi");
  expectEqual(parsed.operators[3].multi, sourcePreset.operators[3].multi, "round-trip O3 multi");
  expectEqual(parsed.operators[4].multi, sourcePreset.operators[4].multi, "round-trip O4 multi");
  expectEqual(parsed.operators[1].dt, sourcePreset.operators[1].dt, "round-trip O1 dt");
  expectEqual(parsed.operators[3].dt, sourcePreset.operators[3].dt, "round-trip O3 dt");
}

verifyOperatorOrder();
verifyDetuneConversion();
verifyRoundTrip();

console.log("TFI import/export mapping OK");
