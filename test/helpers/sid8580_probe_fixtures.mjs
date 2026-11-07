// SPDX-License-Identifier: BSD-3-Clause
// Original bus sequences, with no music, firmware or copied measurement tables.
export const PROBE_CLOCK = 985248;
export function sid8580ProbeFixtures() {
  const fixtures = [];
  function scene(name, build) {
    const commands = [], expectedReads = [];
    const w = (r, v) => commands.push(['w', r, v]);
    const r = (reg, expected = null) => {commands.push(['r', reg]); expectedReads.push(expected);};
    const c = n => commands.push(['c', n]);
    const voice = (v, freq, ctrl = 0x21, adsr = [0, 0xf0]) => {
      const b = v * 7;
      w(b, freq & 255); w(b + 1, freq >> 8); w(b + 2, 0x34); w(b + 3, 8);
      w(b + 5, adsr[0]); w(b + 6, adsr[1]); w(b + 4, ctrl);
    };
    const cutoff = n => {w(21, n & 7); w(22, n >> 3);};
    build({w, r, c, voice, cutoff});
    fixtures.push({name, commands, expectedReads, cycles: commands.filter(a => a[0] === 'c').reduce((n, a) => n + a[1], 0)});
  }
  scene('phase-envelope', ({w, r, c, voice}) => {
    w(24, 15); voice(2, 0x2345);
    let elapsed = 0;
    for (const n of [1, 8, 1, 31, 333, 96]) {
      c(n); elapsed += n;
      r(27, Math.floor((elapsed * 0x2345) % 0x1000000 / 65536));
      r(28, Math.floor(elapsed / 9));
    }
    c(120000); r(28, 255);
  });
  scene('test-and-release', ({w, r, c, voice}) => {
    w(24, 15); voice(2, 7493, 0x29);
    c(4096); r(27, 0); r(28, 255);
    w(18, 0x21); c(1000); r(27); w(18, 0x20);
    c(120000); r(28, 0);
  });
  for (const [name, wave] of [['triangle', 0x11], ['saw', 0x21], ['pulse', 0x41], ['noise', 0x81], ['combined', 0x71]]) {
    scene(name, ({w, r, c, voice}) => {
      w(24, 15); voice(2, 7493, wave); c(180000); r(27); r(28, 255);
    });
  }
  for (const [name, ctrl] of [['sync-off', 0x21], ['sync-on', 0x23], ['ring-off', 0x11], ['ring-on', 0x15]]) {
    scene(name, ({w, r, c, voice}) => {
      w(24, 0x8f); voice(2, 3013, 0x21); voice(0, 7493, ctrl);
      c(180000); r(27); r(28, 255);
    });
  }
  scene('filter-sweep', ({w, r, c, voice, cutoff}) => {
    voice(0, 2230); voice(1, 3013); voice(2, 7493); w(23, 0xf7);
    for (const mode of [0x10, 0x20, 0x40, 0x70]) for (const fc of [0, 256, 1024, 2047]) {
      cutoff(fc); w(24, mode | 15); c(12000);
    }
    // VOICE3-OFF leaves a filtered third voice audible; routing is observed.
    w(24, 0x9f); c(12000); r(27); r(28, 255);
  });
  scene('volume-dc', ({w, c, voice}) => {
    // No waveform: this deliberately reveals the candidate model's offsets.
    voice(0, 0, 0x09);
    for (let n = 0; n < 32; n++) {w(24, n & 1 ? 15 : 0); c(4096);}
  });
  scene('write-only-bus', ({w, r, c}) => {
    w(0, 0xa5); r(0); c(1); r(1); c(8192); r(31);
    // Values are diagnostic: the upstream candidate has no bus-latch model.
  });
  return fixtures;
}
export function probeProtocol(fixture, rate = 48000, model = 8580, chunk = null) {
  const commands = fixture.commands.flatMap(a => a[0] !== 'c' || !chunk ? [a] : Array.from(
    {length: Math.ceil(a[1] / chunk)}, (_, i) => ['c', Math.min(chunk, a[1] - i * chunk)]));
  return `SID8PROBE 1 ${rate} ${model}\n${commands.map(a => a.join(' ')).join('\n')}\n`;
}
