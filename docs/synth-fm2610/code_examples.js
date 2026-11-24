// SPDX-License-Identifier: BSD-3-Clause
import {encodeAdpcmA} from '../js/adpcm_a_sample.js';
import {encodeAdpcmB} from '../js/adpcm_b_sample.js';

const fmAndSsg = variant => `const { fm, ssg } = await useSoundChip("${variant}");
setBpm(114);

fm.setPreset(CH1, FM_PRESETS["two-op-bell"]);
// All three SSG channels share this noise generator and envelope.
ssg.write(6, 15);
ssg.setEnvelope({ period: 560, shape: 9 });
ssg.setMixer(CH1, { tone: true, noise: false });
ssg.setVolume(CH1, 10, true);
ssg.setMixer(CH2, { tone: false, noise: true });
ssg.setVolume(CH2, 6, false);

liveLoop("fm-and-ssg", async () => {
  for (const [bass, lead] of [["A2", "E5"], ["E3", "G5"], ["G2", "A5"], ["E3", "D5"]]) {
    fm.noteOn(CH1, bass);
    ssg.noteOn(CH1, lead);
    ssg.keyOn(CH2);
    await beat(0.12);
    ssg.keyOff(CH2);
    await beat(0.58);
    fm.noteOff(CH1);
    ssg.noteOff(CH1);
    await beat(0.30);
  }
});
`;

const channel3 = `const { fm } = await useSoundChip("ym2610b");
setBpm(108);
fm.setPreset(CH3, FM_PRESETS["two-op-bell"]);
fm.setChannel3SpecialMode(true);

liveLoop("ch3-special", async () => {
  for (const base of [590, 525, 660, 700]) {
    // In Special mode, every operator has its own Block and F-NUM.
    const tuning = /** @type {const} */ ([[OP1, 1], [OP2, 1.5], [OP3, 2], [OP4, 1]]);
    for (const [operator, ratio] of tuning) {
      fm.setChannel3SpecialFrequency(operator, 4, Math.round(base * ratio));
    }
    fm.keyOn(CH3);
    await beat(0.75);
    fm.keyOff(CH3);
    await beat(0.25);
  }
});
`;

function drumExamples() {
  const rate = 8_000_000 / 432;
  const pitches = [74, 154, 370, 112, 690, 890];
  let random = 0x2610;
  return pitches.map((pitch, voice) => {
    const pcm = Float32Array.from({length: 3072}, (_, frame) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const noise = random / 0x80000000 - 1;
      const time = frame / rate;
      const attack = Math.min(frame / 16, 1);
      const decay = Math.exp(-time * [19, 32, 66, 24, 50, 42][voice]);
      const blend = [0.02, 0.67, 0.86, 0.04, 0.16, 0.74][voice];
      return attack * decay * .65 * ((1 - blend) * Math.sin(2 * Math.PI * pitch * time) + blend * noise);
    });
    return encodeAdpcmA(pcm).bytes;
  });
}

function sampleExample() {
  const rate = 12000;
  const frames = 4096;
  const pcm = Float32Array.from({length: frames}, (_, frame) => {
    const time = frame / rate;
    const phase = 2 * Math.PI * 220 * time;
    const fade = Math.min(1, frame / 20, (frames - 1 - frame) / 80);
    return .66 * fade * Math.exp(-time * 11) * (.8 * Math.sin(phase) + .2 * Math.sin(2 * phase));
  });
  return encodeAdpcmB({channels: [pcm], sampleRate: rate}, rate).bytes;
}

const base64 = bytes => btoa(String.fromCharCode(...bytes));

function adpcmAExample() {
  const samples = drumExamples();
  return `// Choose the chip named below in the Synth before running this example.
const { adpcmA } = await useSoundChip("ym2610");
setBpm(120);

// Six original synthesized percussion sounds, encoded as ADPCM-A.
const encoded = [
${samples.map(bytes => `  "${base64(bytes)}",`).join('\n')}
];
/** @param {string} data */
const decode = data => Uint8Array.from(atob(data), character => character.charCodeAt(0));
let start = 0x100000;
const pads = /** @type {const} */ ([CH1, CH2, CH3, CH4, CH5, CH6]);
for (const voice of pads) {
  const bytes = decode(encoded[voice]);
  const end = start + bytes.length;
  await adpcmA.loadMemory(bytes, start);
  adpcmA.setSample(voice, { start, end });
  adpcmA.setVoice(voice, { volume: voice === CH1 ? 28 : 24, left: true, right: true });
  start = end;
}
adpcmA.setVolume(50);

liveLoop("six-pads", async () => {
  const rhythm = /** @type {const} */ ([[CH1, CH3], [CH5], [CH2, CH3], [CH4, CH6]]);
  for (const hits of rhythm) {
    adpcmA.keyOn(hits);
    await beat(0.46);
    adpcmA.keyOff(hits);
    await beat(0.04);
  }
});
`;
}

function adpcmBExample() {
  return `// An original synthesized pluck. The same voice works on YM2610B and YM2610.
const { adpcmB } = await useSoundChip("ym2610b");
setBpm(120);

const bytes = Uint8Array.from(atob("${base64(sampleExample())}"), c => c.charCodeAt(0));
const start = 0x120000;
await adpcmB.loadMemory(bytes, start);
adpcmB.setSample({ start, end: start + bytes.length });
adpcmB.setVolume(180);
adpcmB.setPan(true, true);

liveLoop("sample-pitch", async () => {
  for (const semitones of [0, 3, 7, 12, 7, 3]) {
    const rate = 12000 * 2 ** (semitones / 12);
    adpcmB.setPlaybackRate(rate);
    adpcmB.keyOn();
    await beat(0.7);
    adpcmB.keyOff();
    await beat(0.3);
  }
});
`;
}

const timedFm = `const { fm } = await useSoundChip("ym2610b");
fm.setPreset(CH1, FM_PRESETS["two-op-bell"]);

const phrase = fm.build(b => {
  b.atSeconds(0).noteOn(CH1, "E4");
  b.atSeconds(0.09).setOperator(CH1, OP4, { tl: 23 });
  b.atSeconds(0.19).noteOff(CH1);
  b.atSeconds(0.25).noteOn(CH1, "G4");
  b.atSeconds(0.42).noteOff(CH1);
});
const state = await fm.captureState();
console.table(await fm.compile(phrase, { initialState: state }));
await fm.schedule(phrase, { name: "opnb-fm", repeatSeconds: 0.5 });
// Use await fm.clearSchedule("opnb-fm") to end the reservation from Code.
`;

let examples;
function stockExamples() {
  if (examples) return examples;
  const drumCode = adpcmAExample();
  // These previous versions identify unmodified files from the first example set.
  const previousChannel3 = channel3.replace(
    `    const tuning = /** @type {const} */ ([[OP1, 1], [OP2, 1.5], [OP3, 2], [OP4, 1]]);
    for (const [operator, ratio] of tuning) {
      fm.setChannel3SpecialFrequency(operator, 4, Math.round(base * ratio));
    }`,
    `    [1, 1.5, 2, 1].forEach((ratio, operator) => {
      fm.setChannel3SpecialFrequency(operator, 4, Math.round(base * ratio));
    });`,
  );
  const previousDrumCode = drumCode
    .replace('/** @param {string} data */\n', '')
    .replace(
      `const pads = /** @type {const} */ ([CH1, CH2, CH3, CH4, CH5, CH6]);
for (const voice of pads) {
  const bytes = decode(encoded[voice]);`,
      'for (const [voice, sample] of encoded.entries()) {\n  const bytes = decode(sample);',
    )
    .replace(
      `  const rhythm = /** @type {const} */ ([[CH1, CH3], [CH5], [CH2, CH3], [CH4, CH6]]);
  for (const hits of rhythm) {`,
      '  for (const hits of [[CH1, CH3], [CH5], [CH2, CH3], [CH4, CH6]]) {',
    );
  examples = [
    ['/examples/fm-ssg-ym2610.js', fmAndSsg('ym2610')],
    ['/examples/fm-ssg-ym2610b.js', fmAndSsg('ym2610b')],
    ['/examples/ch3-special.js', channel3, previousChannel3],
    ['/examples/adpcm-a-pads.js', drumCode, previousDrumCode],
    ['/examples/adpcm-b-pitch.js', adpcmBExample()],
    ['/examples/timed-fm.js', timedFm],
  ];
  return examples;
}

export function getFm2610CodeExamples() {
  return stockExamples().map(([path, data]) => ({path, data}));
}

/** Upgrade only exact copies of the originally shipped examples. */
export function getFm2610CodeExampleUpdates({working, saved}) {
  return stockExamples()
    .filter(([path, , old]) => old !== undefined && working.get(path)?.data === old && saved.get(path)?.data === old)
    .map(([path, data]) => ({path, data}));
}
