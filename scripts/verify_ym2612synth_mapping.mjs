import { YM2612Synth } from "../web/ym2612synth.js";

function collectWrites() {
  const writes = [];
  const transport = {
    write(port, register, value) {
      writes.push({ port, register, value });
    },
    reset() {},
  };

  const synth = new YM2612Synth({ transport });
  return { synth, writes };
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function verifyOperatorRegisterOrder() {
  const { synth, writes } = collectWrites();

  synth.setOperator(0, 1, { dt: 0, multi: 1 });
  synth.setOperator(0, 2, { dt: 0, multi: 1 });
  synth.setOperator(0, 3, { dt: 0, multi: 1 });
  synth.setOperator(0, 4, { dt: 0, multi: 1 });

  const registers = writes.map((entry) => entry.register);
  const expected = [0x30, 0x38, 0x34, 0x3c];

  expectEqual(registers.length, expected.length, "register count");

  for (let index = 0; index < expected.length; index += 1) {
    expectEqual(
      registers[index],
      expected[index],
      `operator ${index + 1} register`
    );
  }
}

function verifyChannel4RegisterOrder() {
  const { synth, writes } = collectWrites();

  synth.setOperator(3, 1, { tl: 10 });
  synth.setOperator(3, 2, { tl: 20 });
  synth.setOperator(3, 3, { tl: 30 });
  synth.setOperator(3, 4, { tl: 40 });

  const targets = writes.map((entry) => ({
    port: entry.port,
    register: entry.register,
  }));
  const expected = [
    { port: 1, register: 0x40 },
    { port: 1, register: 0x48 },
    { port: 1, register: 0x44 },
    { port: 1, register: 0x4c },
  ];

  expectEqual(targets.length, expected.length, "channel 4 register count");

  for (let index = 0; index < expected.length; index += 1) {
    expectEqual(targets[index].port, expected[index].port, `channel 4 operator ${index + 1} port`);
    expectEqual(targets[index].register, expected[index].register, `channel 4 operator ${index + 1} register`);
  }
}

function verifyAmPacking() {
  const { synth, writes } = collectWrites();

  synth.setOperator(0, 4, {
    am: true,
    d1r: 6,
  });

  expectEqual(writes.length, 1, "am write count");
  expectEqual(writes[0].port, 0, "am port");
  expectEqual(writes[0].register, 0x6c, "am register");
  expectEqual(
    writes[0].value,
    0x80 | 6,
    "am packed value"
  );
}

function verifyLfoRegister() {
  const { synth, writes } = collectWrites();

  synth.setLfo(true, 5);

  expectEqual(writes.length, 1, "lfo write count");
  expectEqual(writes[0].port, 0, "lfo port");
  expectEqual(writes[0].register, 0x22, "lfo register");
  expectEqual(
    writes[0].value,
    0x08 | 5,
    "lfo packed value"
  );
}

function verifyAmsPacking() {
  const { synth, writes } = collectWrites();

  synth.setPan(0, true, true, 3);

  expectEqual(writes.length, 1, "ams write count");
  expectEqual(writes[0].port, 0, "ams port");
  expectEqual(writes[0].register, 0xb4, "ams register");
  expectEqual(
    writes[0].value,
    0x80 | 0x40 | (3 << 4),
    "ams packed value"
  );
}

verifyOperatorRegisterOrder();
verifyChannel4RegisterOrder();
verifyAmPacking();
verifyLfoRegister();
verifyAmsPacking();

console.log("YM2612Synth mapping and control packing OK");
