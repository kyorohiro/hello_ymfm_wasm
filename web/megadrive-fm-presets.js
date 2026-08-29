export const FM_PRESETS = {
  "one-op-basic": {
    label: "1OP Basic",
    algorithm: 7,
    feedback: 0,
    operators: {
      1: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      2: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 8, ar: 22, d1r: 6, d2r: 3, sl: 3, rr: 8 },
    },
  },
  "one-op-flute": {
    label: "1OP Flute-ish",
    algorithm: 7,
    feedback: 0,
    operators: {
      1: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      2: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 18, ar: 18, d1r: 5, d2r: 2, sl: 2, rr: 6 },
    },
  },
  "two-op-bell": {
    label: "2OP Bell",
    algorithm: 4,
    feedback: 1,
    operators: {
      1: { dt: 0, multi: 6, tl: 10, ar: 31, d1r: 20, d2r: 8, sl: 7, rr: 7 },
      2: { dt: 0, multi: 1, tl: 16, ar: 28, d1r: 12, d2r: 4, sl: 5, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },
  "two-op-organ": {
    label: "2OP Organ-ish",
    algorithm: 4,
    feedback: 0,
    operators: {
      1: { dt: 0, multi: 2, tl: 20, ar: 31, d1r: 4, d2r: 2, sl: 2, rr: 6 },
      2: { dt: 0, multi: 1, tl: 4, ar: 31, d1r: 4, d2r: 2, sl: 2, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },
  "four-op-brass": {
    label: "4OP Brass-ish",
    algorithm: 3,
    feedback: 2,
    operators: {
      1: { dt: 0, multi: 2, tl: 18, ar: 28, d1r: 9, d2r: 4, sl: 4, rr: 7 },
      2: { dt: 0, multi: 1, tl: 12, ar: 26, d1r: 8, d2r: 3, sl: 4, rr: 7 },
      3: { dt: 0, multi: 3, tl: 22, ar: 24, d1r: 10, d2r: 5, sl: 5, rr: 7 },
      4: { dt: 0, multi: 1, tl: 6, ar: 30, d1r: 7, d2r: 3, sl: 3, rr: 6 },
    },
  },
  "four-op-pad": {
    label: "4OP Soft Pad",
    algorithm: 5,
    feedback: 1,
    operators: {
      1: { dt: 0, multi: 1, tl: 28, ar: 18, d1r: 5, d2r: 2, sl: 4, rr: 5 },
      2: { dt: 0, multi: 1, tl: 18, ar: 20, d1r: 6, d2r: 2, sl: 4, rr: 5 },
      3: { dt: 1, multi: 2, tl: 24, ar: 18, d1r: 6, d2r: 3, sl: 5, rr: 5 },
      4: { dt: 0, multi: 1, tl: 10, ar: 22, d1r: 6, d2r: 3, sl: 4, rr: 5 },
    },
  },
  coin: {
    label: "SFX Coin",
    algorithm: 4,
    feedback: 1,
    operators: {
      1: { dt: 0, multi: 4, tl: 14, ar: 31, d1r: 24, d2r: 14, sl: 9, rr: 8 },
      2: { dt: 0, multi: 1, tl: 2, ar: 31, d1r: 20, d2r: 8, sl: 6, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },
  laser: {
    label: "SFX Laser",
    algorithm: 4,
    feedback: 4,
    operators: {
      1: { dt: 1, multi: 2, tl: 5, ar: 31, d1r: 20, d2r: 10, sl: 6, rr: 7 },
      2: { dt: 0, multi: 1, tl: 2, ar: 28, d1r: 16, d2r: 7, sl: 4, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },
  hit: {
    label: "SFX Hit",
    algorithm: 4,
    feedback: 2,
    operators: {
      1: { dt: 0, multi: 5, tl: 10, ar: 31, d1r: 27, d2r: 18, sl: 11, rr: 7 },
      2: { dt: 0, multi: 1, tl: 4, ar: 29, d1r: 22, d2r: 9, sl: 7, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },
  burst: {
    label: "SFX Rough Burst",
    algorithm: 4,
    feedback: 6,
    operators: {
      1: { dt: 2, multi: 1, tl: 2, ar: 31, d1r: 31, d2r: 24, sl: 13, rr: 10 },
      2: { dt: 1, multi: 1, tl: 5, ar: 26, d1r: 24, d2r: 14, sl: 10, rr: 9 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },
  "ui-confirm": {
    label: "UI Confirm",
    algorithm: 4,
    feedback: 1,
    operators: {
      1: { dt: 0, multi: 3, tl: 20, ar: 31, d1r: 26, d2r: 18, sl: 10, rr: 10 },
      2: { dt: 0, multi: 1, tl: 4, ar: 31, d1r: 24, d2r: 14, sl: 9, rr: 9 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "ui-select": {
    label: "UI Select",
    algorithm: 7,
    feedback: 0,
    operators: {
      1: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      2: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 2, tl: 8, ar: 31, d1r: 28, d2r: 20, sl: 12, rr: 12 },
    },
  },

  "ui-cancel": {
    label: "UI Cancel",
    algorithm: 4,
    feedback: 2,
    operators: {
      1: { dt: 1, multi: 2, tl: 18, ar: 31, d1r: 27, d2r: 18, sl: 11, rr: 10 },
      2: { dt: 0, multi: 1, tl: 8, ar: 31, d1r: 25, d2r: 16, sl: 10, rr: 10 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "ui-error": {
    label: "UI Error",
    algorithm: 4,
    feedback: 5,
    operators: {
      1: { dt: 2, multi: 5, tl: 6, ar: 31, d1r: 24, d2r: 15, sl: 9, rr: 10 },
      2: { dt: 0, multi: 1, tl: 5, ar: 31, d1r: 22, d2r: 12, sl: 8, rr: 9 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "ui-cursor": {
    label: "UI Cursor",
    algorithm: 7,
    feedback: 0,
    operators: {
      1: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      2: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 4, tl: 14, ar: 31, d1r: 31, d2r: 24, sl: 13, rr: 13 },
    },
  },

  "item-get": {
    label: "SFX Item Get",
    algorithm: 4,
    feedback: 1,
    operators: {
      1: { dt: 0, multi: 5, tl: 14, ar: 31, d1r: 22, d2r: 10, sl: 7, rr: 7 },
      2: { dt: 0, multi: 1, tl: 3, ar: 31, d1r: 18, d2r: 7, sl: 5, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "power-up": {
    label: "SFX Power Up",
    algorithm: 5,
    feedback: 3,
    operators: {
      1: { dt: 1, multi: 2, tl: 15, ar: 31, d1r: 15, d2r: 5, sl: 5, rr: 6 },
      2: { dt: 0, multi: 3, tl: 22, ar: 30, d1r: 14, d2r: 5, sl: 5, rr: 6 },
      3: { dt: 1, multi: 5, tl: 26, ar: 28, d1r: 16, d2r: 6, sl: 6, rr: 7 },
      4: { dt: 0, multi: 1, tl: 4, ar: 31, d1r: 12, d2r: 4, sl: 4, rr: 6 },
    },
  },

  "damage": {
    label: "SFX Damage",
    algorithm: 4,
    feedback: 6,
    operators: {
      1: { dt: 2, multi: 7, tl: 3, ar: 31, d1r: 31, d2r: 25, sl: 13, rr: 11 },
      2: { dt: 1, multi: 1, tl: 4, ar: 31, d1r: 27, d2r: 18, sl: 11, rr: 10 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "heavy-hit": {
    label: "SFX Heavy Hit",
    algorithm: 4,
    feedback: 7,
    operators: {
      1: { dt: 3, multi: 2, tl: 0, ar: 31, d1r: 31, d2r: 28, sl: 14, rr: 12 },
      2: { dt: 0, multi: 1, tl: 2, ar: 31, d1r: 28, d2r: 20, sl: 12, rr: 11 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "warning": {
    label: "SFX Warning",
    algorithm: 7,
    feedback: 0,
    operators: {
      1: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      2: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 2, ar: 31, d1r: 2, d2r: 1, sl: 1, rr: 8 },
    },
  },

  "teleport": {
    label: "SFX Teleport",
    algorithm: 5,
    feedback: 5,
    operators: {
      1: { dt: 3, multi: 7, tl: 12, ar: 31, d1r: 18, d2r: 10, sl: 8, rr: 8 },
      2: { dt: 1, multi: 4, tl: 18, ar: 31, d1r: 16, d2r: 8, sl: 7, rr: 8 },
      3: { dt: 2, multi: 9, tl: 22, ar: 31, d1r: 20, d2r: 11, sl: 9, rr: 9 },
      4: { dt: 0, multi: 1, tl: 5, ar: 30, d1r: 14, d2r: 6, sl: 6, rr: 7 },
    },
  },

  "scanner": {
    label: "SFX Scanner",
    algorithm: 4,
    feedback: 3,
    operators: {
      1: { dt: 1, multi: 8, tl: 24, ar: 31, d1r: 14, d2r: 5, sl: 5, rr: 7 },
      2: { dt: 0, multi: 1, tl: 8, ar: 31, d1r: 10, d2r: 4, sl: 4, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "machine-hum": {
    label: "SFX Machine Hum",
    algorithm: 5,
    feedback: 5,
    operators: {
      1: { dt: 1, multi: 1, tl: 20, ar: 20, d1r: 2, d2r: 1, sl: 2, rr: 5 },
      2: { dt: 2, multi: 2, tl: 28, ar: 18, d1r: 3, d2r: 1, sl: 3, rr: 5 },
      3: { dt: 1, multi: 3, tl: 34, ar: 18, d1r: 2, d2r: 1, sl: 3, rr: 5 },
      4: { dt: 0, multi: 1, tl: 10, ar: 22, d1r: 2, d2r: 1, sl: 2, rr: 5 },
    },
  },

  "engine-low": {
    label: "SFX Low Engine",
    algorithm: 4,
    feedback: 7,
    operators: {
      1: { dt: 2, multi: 1, tl: 5, ar: 24, d1r: 3, d2r: 1, sl: 2, rr: 6 },
      2: { dt: 0, multi: 1, tl: 5, ar: 22, d1r: 3, d2r: 1, sl: 2, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "metallic-ping": {
    label: "SFX Metallic Ping",
    algorithm: 4,
    feedback: 2,
    operators: {
      1: { dt: 1, multi: 11, tl: 8, ar: 31, d1r: 24, d2r: 14, sl: 10, rr: 9 },
      2: { dt: 0, multi: 1, tl: 8, ar: 31, d1r: 18, d2r: 9, sl: 7, rr: 8 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "ritual-bell": {
    label: "SFX Ritual Bell",
    algorithm: 3,
    feedback: 2,
    operators: {
      1: { dt: 1, multi: 7, tl: 12, ar: 31, d1r: 15, d2r: 5, sl: 7, rr: 5 },
      2: { dt: 0, multi: 2, tl: 18, ar: 31, d1r: 12, d2r: 4, sl: 6, rr: 5 },
      3: { dt: 2, multi: 11, tl: 25, ar: 31, d1r: 18, d2r: 7, sl: 8, rr: 6 },
      4: { dt: 0, multi: 1, tl: 5, ar: 31, d1r: 10, d2r: 3, sl: 5, rr: 5 },
    },
  },

  "horror-drone": {
    label: "SFX Horror Drone",
    algorithm: 5,
    feedback: 6,
    operators: {
      1: { dt: 3, multi: 1, tl: 18, ar: 12, d1r: 2, d2r: 1, sl: 3, rr: 4 },
      2: { dt: 2, multi: 2, tl: 25, ar: 10, d1r: 2, d2r: 1, sl: 4, rr: 4 },
      3: { dt: 3, multi: 3, tl: 30, ar: 9, d1r: 3, d2r: 1, sl: 5, rr: 4 },
      4: { dt: 0, multi: 1, tl: 8, ar: 14, d1r: 2, d2r: 1, sl: 3, rr: 4 },
    },
  },

  "dark-ambient": {
    label: "SFX Dark Ambient",
    algorithm: 6,
    feedback: 5,
    operators: {
      1: { dt: 2, multi: 1, tl: 30, ar: 10, d1r: 3, d2r: 1, sl: 4, rr: 4 },
      2: { dt: 3, multi: 2, tl: 34, ar: 8, d1r: 3, d2r: 1, sl: 5, rr: 4 },
      3: { dt: 1, multi: 4, tl: 38, ar: 9, d1r: 4, d2r: 2, sl: 6, rr: 5 },
      4: { dt: 0, multi: 1, tl: 12, ar: 12, d1r: 2, d2r: 1, sl: 4, rr: 4 },
    },
  },

  "fm-bass": {
    label: "FM Bass",
    algorithm: 4,
    feedback: 3,
    operators: {
      1: { dt: 0, multi: 2, tl: 14, ar: 31, d1r: 12, d2r: 5, sl: 5, rr: 7 },
      2: { dt: 0, multi: 1, tl: 2, ar: 31, d1r: 9, d2r: 3, sl: 4, rr: 6 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "fm-pluck": {
    label: "FM Pluck",
    algorithm: 4,
    feedback: 2,
    operators: {
      1: { dt: 0, multi: 4, tl: 18, ar: 31, d1r: 24, d2r: 16, sl: 11, rr: 10 },
      2: { dt: 0, multi: 1, tl: 5, ar: 31, d1r: 20, d2r: 12, sl: 9, rr: 9 },
      3: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
      4: { dt: 0, multi: 1, tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 },
    },
  },

  "fm-lead": {
    label: "FM Lead",
    algorithm: 3,
    feedback: 4,
    operators: {
      1: { dt: 1, multi: 2, tl: 18, ar: 30, d1r: 8, d2r: 3, sl: 4, rr: 7 },
      2: { dt: 0, multi: 1, tl: 10, ar: 31, d1r: 7, d2r: 2, sl: 3, rr: 6 },
      3: { dt: 1, multi: 3, tl: 26, ar: 28, d1r: 9, d2r: 4, sl: 5, rr: 7 },
      4: { dt: 0, multi: 1, tl: 4, ar: 31, d1r: 6, d2r: 2, sl: 3, rr: 6 },
    },
  },

  "fm-electric-piano": {
    label: "FM Electric Piano",
    algorithm: 4,
    feedback: 1,
    operators: {
      1: { dt: 0, multi: 7, tl: 28, ar: 31, d1r: 18, d2r: 7, sl: 7, rr: 6 },
      2: { dt: 0, multi: 1, tl: 8, ar: 30, d1r: 9, d2r: 3, sl: 4, rr: 6 },
      3: { dt: 0, multi: 3, tl: 34, ar: 31, d1r: 20, d2r: 8, sl: 8, rr: 7 },
      4: { dt: 0, multi: 1, tl: 14, ar: 29, d1r: 10, d2r: 3, sl: 5, rr: 6 },
    },
  },

  "fm-strings": {
    label: "FM Strings",
    algorithm: 6,
    feedback: 1,
    operators: {
      1: { dt: 1, multi: 1, tl: 25, ar: 14, d1r: 5, d2r: 2, sl: 4, rr: 5 },
      2: { dt: 2, multi: 1, tl: 28, ar: 15, d1r: 5, d2r: 2, sl: 4, rr: 5 },
      3: { dt: 1, multi: 2, tl: 32, ar: 13, d1r: 6, d2r: 2, sl: 5, rr: 5 },
      4: { dt: 0, multi: 1, tl: 12, ar: 16, d1r: 5, d2r: 2, sl: 4, rr: 5 },
    },
  },
};

export const FM_PRESET_ORDER = [
  // Learning
  "one-op-basic",
  "one-op-flute",
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

  // UI
  "ui-cursor",
  "ui-select",
  "ui-confirm",
  "ui-cancel",
  "ui-error",

  // Game SFX
  "coin",
  "item-get",
  "laser",
  "hit",
  "heavy-hit",
  "damage",
  "burst",
  "power-up",
  "warning",
  "teleport",

  // Machine / Sci-Fi
  "scanner",
  "machine-hum",
  "engine-low",
  "metallic-ping",

  // Horror / Fantasy
  "ritual-bell",
  "horror-drone",
  "dark-ambient",
];
