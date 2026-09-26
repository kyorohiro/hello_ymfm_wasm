/**
 * @file megadrive-fm-presets.js
 * 実行環境: Browser / Node.js
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
export const FM_PRESETS = {
  "sine": {
    label: "Sine",
    algorithm: 7,
    feedback: 0,
    operators: [
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 2, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },
  "one-op-basic": {
    label: "1OP Basic",
    algorithm: 7,
    feedback: 0,
    operators: [
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 2, ar: 22, d1r: 6, d2r: 3, sl: 3, rr: 13 },
    ],
  },
  "two-op-bell": {
    label: "2OP Bell",
    algorithm: 4,
    feedback: 1,
    operators: [
      { dt: 0, multi: 6, tl: 10, ar: 31, d1r: 20, d2r: 8, sl: 7, rr: 7 },
      { dt: 0, multi: 1, tl: 7, ar: 28, d1r: 12, d2r: 4, sl: 5, rr: 6 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },
  "fm-bell": {
    label: "FM Bell",
    algorithm: 7,
    feedback: 0,
    operators: [
      { dt: 2, multi: 5, tl: 28, ar: 31, d1r: 14, d2r: 8, sl: 6, rr: 8 },
      { dt: 1, multi: 7, tl: 44, ar: 31, d1r: 16, d2r: 9, sl: 7, rr: 9 },
      { dt: 0, multi: 2, tl: 56, ar: 31, d1r: 12, d2r: 6, sl: 6, rr: 8 },
      { dt: 0, multi: 1, tl: 8, ar: 31, d1r: 9, d2r: 4, sl: 5, rr: 10 },
    ],
  },
  "two-op-organ": {
    label: "2OP Organ-ish",
    algorithm: 4,
    feedback: 0,
    operators: [
      { dt: 0, multi: 2, tl: 20, ar: 31, d1r: 4, d2r: 2, sl: 2, rr: 6 },
      { dt: 0, multi: 1, tl: 9, ar: 31, d1r: 4, d2r: 2, sl: 2, rr: 6 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },
  "four-op-brass": {
    label: "4OP Brass-ish",
    algorithm: 3,
    feedback: 2,
    operators: [
      { dt: 0, multi: 2, tl: 18, ar: 28, d1r: 9, d2r: 4, sl: 4, rr: 7 },
      { dt: 0, multi: 1, tl: 12, ar: 26, d1r: 8, d2r: 3, sl: 4, rr: 7 },
      { dt: 0, multi: 3, tl: 22, ar: 24, d1r: 10, d2r: 5, sl: 5, rr: 7 },
      { dt: 0, multi: 1, tl: 6, ar: 30, d1r: 7, d2r: 3, sl: 3, rr: 6 },
    ],
  },
  "four-op-pad": {
    label: "4OP Soft Pad",
    algorithm: 5,
    feedback: 1,
    operators: [
      { dt: 0, multi: 1, tl: 28, ar: 18, d1r: 5, d2r: 2, sl: 4, rr: 5 },
      { dt: 0, multi: 1, tl: 18, ar: 20, d1r: 6, d2r: 2, sl: 4, rr: 5 },
      { dt: 1, multi: 2, tl: 24, ar: 18, d1r: 6, d2r: 3, sl: 5, rr: 5 },
      { dt: 0, multi: 1, tl: 10, ar: 22, d1r: 6, d2r: 3, sl: 4, rr: 5 },
    ],
  },
  coin: {
    label: "SFX Coin",
    algorithm: 4,
    feedback: 1,
    operators: [
      { dt: 0, multi: 4, tl: 14, ar: 31, d1r: 24, d2r: 14, sl: 9, rr: 8 },
      { dt: 0, multi: 1, tl: 0, ar: 31, d1r: 20, d2r: 8, sl: 6, rr: 6 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },
  laser: {
    label: "SFX Laser",
    algorithm: 4,
    feedback: 4,
    operators: [
      { dt: 1, multi: 2, tl: 5, ar: 31, d1r: 20, d2r: 10, sl: 6, rr: 7 },
      { dt: 0, multi: 1, tl: 2, ar: 28, d1r: 16, d2r: 7, sl: 4, rr: 6 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },
  hit: {
    label: "SFX Hit",
    algorithm: 4,
    feedback: 2,
    operators: [
      { dt: 0, multi: 5, tl: 10, ar: 31, d1r: 27, d2r: 18, sl: 11, rr: 7 },
      { dt: 0, multi: 1, tl: 0, ar: 29, d1r: 22, d2r: 9, sl: 7, rr: 6 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },

  "ritual-bell": {
    label: "SFX Ritual Bell",
    algorithm: 5,
    feedback: 2,
    operators: [
      { dt: 3, multi: 7, tl: 18, ar: 31, d1r: 23, d2r: 12, sl: 9, rr: 8 },
      { dt: 1, multi: 11, tl: 32, ar: 31, d1r: 27, d2r: 16, sl: 10, rr: 9 },
      { dt: 2, multi: 3, tl: 38, ar: 31, d1r: 18, d2r: 9, sl: 8, rr: 8 },
      { dt: 0, multi: 1, tl: 8, ar: 31, d1r: 7, d2r: 2, sl: 4, rr: 6 },
    ],
  },

  "fm-bass": {
    label: "FM Bass",
    algorithm: 4,
    feedback: 3,
    operators: [
      { dt: 0, multi: 2, tl: 14, ar: 31, d1r: 12, d2r: 5, sl: 5, rr: 7 },
      { dt: 0, multi: 1, tl: 7, ar: 31, d1r: 9, d2r: 3, sl: 4, rr: 6 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },

  "fm-pluck": {
    label: "FM Pluck",
    algorithm: 4,
    feedback: 2,
    operators: [
      { dt: 0, multi: 4, tl: 18, ar: 31, d1r: 24, d2r: 16, sl: 11, rr: 10 },
      { dt: 0, multi: 1, tl: 0, ar: 31, d1r: 20, d2r: 12, sl: 9, rr: 9 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    ],
  },

  "fm-lead": {
    label: "FM Lead",
    algorithm: 3,
    feedback: 4,
    operators: [
      { dt: 1, multi: 2, tl: 18, ar: 30, d1r: 8, d2r: 3, sl: 4, rr: 7 },
      { dt: 0, multi: 1, tl: 10, ar: 31, d1r: 7, d2r: 2, sl: 3, rr: 6 },
      { dt: 1, multi: 3, tl: 26, ar: 28, d1r: 9, d2r: 4, sl: 5, rr: 7 },
      { dt: 0, multi: 1, tl: 8, ar: 31, d1r: 6, d2r: 2, sl: 3, rr: 6 },
    ],
  },

  "fm-electric-piano": {
    label: "FM Electric Piano",
    algorithm: 4,
    feedback: 1,
    operators: [
      { dt: 0, multi: 7, tl: 28, ar: 31, d1r: 18, d2r: 7, sl: 7, rr: 6 },
      { dt: 0, multi: 1, tl: 12, ar: 30, d1r: 9, d2r: 3, sl: 4, rr: 6 },
      { dt: 0, multi: 3, tl: 34, ar: 31, d1r: 20, d2r: 8, sl: 8, rr: 7 },
      { dt: 0, multi: 1, tl: 18, ar: 29, d1r: 10, d2r: 3, sl: 5, rr: 6 },
    ],
  },

  "fm-strings": {
    label: "FM Strings",
    algorithm: 6,
    feedback: 1,
    operators: [
      { dt: 1, multi: 1, tl: 25, ar: 14, d1r: 5, d2r: 2, sl: 4, rr: 5 },
      { dt: 2, multi: 1, tl: 24, ar: 15, d1r: 5, d2r: 2, sl: 4, rr: 5 },
      { dt: 1, multi: 2, tl: 28, ar: 13, d1r: 6, d2r: 2, sl: 5, rr: 5 },
      { dt: 0, multi: 1, tl: 8, ar: 16, d1r: 5, d2r: 2, sl: 4, rr: 5 },
    ],
  },
};

export const FM_PRESET_ORDER = [
  // Learning
  "sine",
  "one-op-basic",
  "two-op-bell",
  "two-op-organ",
  "four-op-brass",
  "four-op-pad",

  // Instruments
  "fm-bass",
  "fm-pluck",
  "fm-lead",
  "fm-electric-piano",
  "fm-strings",
  "fm-bell",

  // Game SFX
  "coin",
  "laser",
  "hit",

  // Horror / Fantasy
  "ritual-bell",
];
