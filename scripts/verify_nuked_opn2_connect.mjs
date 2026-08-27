import { createYm2612, YM2612_CLOCK } from "../web/ym2612.js";
import { YM2612Synth, YM2612DirectTransport } from "../web/ym2612synth.js";
import nukedOpn2ModuleFactory from "../docs/generated/nuked_opn2_wasm.js";

function expectTrue(actual, message) {
  if (!actual) {
    throw new Error(message);
  }
}

async function verifyRawYm2612Wrapper() {
  const ym2612 = await createYm2612(nukedOpn2ModuleFactory);

  expectTrue(
    ym2612.sampleRate(YM2612_CLOCK) === Math.floor(YM2612_CLOCK / 144),
    `sampleRate(): expected clock/144, got ${ym2612.sampleRate(YM2612_CLOCK)}`
  );

  ym2612.reset();

  // OP1/OP2/OP3 muted, OP4 the audible carrier (algorithm 7).
  ym2612.writeRegister(0x40, 127, 0);
  ym2612.writeRegister(0x44, 127, 0);
  ym2612.writeRegister(0x48, 127, 0);
  ym2612.writeRegister(0x4c, 8, 0);
  ym2612.writeRegister(0x5c, 22, 0);
  ym2612.writeRegister(0xb0, 0x07, 0);
  ym2612.writeRegister(0xb4, 0xc0, 0);
  ym2612.writeRegister(0xa4, (4 << 3) | ((553 >> 8) & 0x07), 0);
  ym2612.writeRegister(0xa0, 553 & 0xff, 0);
  ym2612.writeRegister(0x28, 0xf0, 0);

  const { left } = ym2612.generateStereo(53267);
  const min = Math.min(...left);
  const max = Math.max(...left);

  expectTrue(
    max - min > 0.01,
    `raw Ym2612 wrapper: expected an oscillating waveform, got min=${min} max=${max}`
  );
}

async function verifySynthOverNukedBackend() {
  const ym2612 = await createYm2612(nukedOpn2ModuleFactory);
  const transport = new YM2612DirectTransport(ym2612);
  const synth = new YM2612Synth({ transport });

  synth.setOperator(0, 0, { tl: 0x7f });
  synth.setOperator(0, 1, { tl: 0x7f });
  synth.setOperator(0, 2, { tl: 0x7f });
  synth.setOperator(0, 3, {
    dt: 0,
    multi: 1,
    tl: 8,
    ar: 22,
    d1r: 6,
    d2r: 3,
    sl: 3,
    rr: 8,
  });
  synth.setAlgo(0, 7, 0);
  synth.setPan(0, true, true);
  synth.noteOn(0, 4, 553);

  const { left } = ym2612.generateStereo(53267);
  const min = Math.min(...left);
  const max = Math.max(...left);

  expectTrue(
    max - min > 0.01,
    `YM2612Synth over Nuked-OPN2: expected an oscillating waveform, got min=${min} max=${max}`
  );
}

await verifyRawYm2612Wrapper();
await verifySynthOverNukedBackend();

console.log(
  "Nuked-OPN2 WASM backend OK: web/ym2612.js and web/ym2612synth.js work unmodified against it"
);
