import {Ym2612VGM} from '../js/ym2612vgm.js';
const DEFAULT_OPERATOR_PRESET = Object.freeze({
  multi: 1,
  dt: 0,
  tl: 127,
  rs: 0,
  ar: 0,
  d1r: 0,
  d2r: 0,
  rr: 15,
  sl: 0,
  ssg: 0,
});

const OPERATOR_SLOT_OFFSETS = {
  1: 0x00,
  2: 0x08,
  3: 0x04,
  4: 0x0c,
};

export function createDefaultTfiPreset() {
  return {
    algorithm: 7,
    feedback: 0,
    b4: 0,
    operators: {
      1: { ...DEFAULT_OPERATOR_PRESET },
      2: { ...DEFAULT_OPERATOR_PRESET },
      3: { ...DEFAULT_OPERATOR_PRESET },
      4: { ...DEFAULT_OPERATOR_PRESET },
    },
  };
}

export function findOperatorFromSlotOffset(slotOffset) {
  for (const [operator, expectedOffset] of Object.entries(OPERATOR_SLOT_OFFSETS)) {
    if (expectedOffset === slotOffset) {
      return Number(operator);
    }
  }
  return null;
}

export function cloneTfiPreset(preset) {
  return {
    algorithm: preset.algorithm,
    feedback: preset.feedback,
    b4: preset.b4,
    operators: {
      1: { ...preset.operators[1] },
      2: { ...preset.operators[2] },
      3: { ...preset.operators[3] },
      4: { ...preset.operators[4] },
    },
  };
}

export function presetSignature(preset) {
  return JSON.stringify([
    preset.algorithm,
    preset.feedback,
    preset.b4,
    preset.operators[1].multi,
    preset.operators[1].dt,
    preset.operators[1].tl,
    preset.operators[1].rs,
    preset.operators[1].ar,
    preset.operators[1].d1r,
    preset.operators[1].d2r,
    preset.operators[1].rr,
    preset.operators[1].sl,
    preset.operators[1].ssg,
    preset.operators[2].multi,
    preset.operators[2].dt,
    preset.operators[2].tl,
    preset.operators[2].rs,
    preset.operators[2].ar,
    preset.operators[2].d1r,
    preset.operators[2].d2r,
    preset.operators[2].rr,
    preset.operators[2].sl,
    preset.operators[2].ssg,
    preset.operators[3].multi,
    preset.operators[3].dt,
    preset.operators[3].tl,
    preset.operators[3].rs,
    preset.operators[3].ar,
    preset.operators[3].d1r,
    preset.operators[3].d2r,
    preset.operators[3].rr,
    preset.operators[3].sl,
    preset.operators[3].ssg,
    preset.operators[4].multi,
    preset.operators[4].dt,
    preset.operators[4].tl,
    preset.operators[4].rs,
    preset.operators[4].ar,
    preset.operators[4].d1r,
    preset.operators[4].d2r,
    preset.operators[4].rr,
    preset.operators[4].sl,
    preset.operators[4].ssg,
  ]);
}

export function decodeKeyOnChannel(value) {
  const channelCode = value & 0x07;
  if (channelCode === 0x00) {
    return 0;
  }
  if (channelCode === 0x01) {
    return 1;
  }
  if (channelCode === 0x02) {
    return 2;
  }
  if (channelCode === 0x04) {
    return 3;
  }
  if (channelCode === 0x05) {
    return 4;
  }
  if (channelCode === 0x06) {
    return 5;
  }
  return null;
}

export function extractTfiPatchesFromVgm(buffer) {
  return scanTfiState(buffer).patches;
}

export function snapshotTfiPresets(buffer, atSample) {
  return scanTfiState(buffer, atSample).presets;
}

function scanTfiState(buffer, atSample) {
  let sample = 0;
  const parser = new Ym2612VGM(buffer, { logger: null });
  const presets = Array.from({ length: 6 }, () => createDefaultTfiPreset());
  const patchCounts = Array(6).fill(0);
  const seenSignatures = Array.from({ length: 6 }, () => new Set());
  const patches = [];

  while (true) {
    const event = parser.step();
    if (event.type === "end") {
      break;
    }
    if (event.type === 'wait') {
      sample += event.samples;
      if (atSample !== undefined && sample > atSample) break;
      continue;
    }
    if (
      event.type !== "ym2612-write" &&
      event.type !== "ym2608-write" &&
      event.type !== "ym2610-write" &&
      event.type !== "ym2203-write"
    ) {
      continue;
    }

    const port = event.port ?? 0; // YM2203 has a single register port.
    const channelBase = port === 0 ? 0 : 3;

    if (event.register >= 0xb0 && event.register <= 0xb2) {
      const channel = channelBase + (event.register - 0xb0);
      presets[channel].feedback = (event.value >> 3) & 0x07;
      presets[channel].algorithm = event.value & 0x07;
      continue;
    }

    if (event.register >= 0xb4 && event.register <= 0xb6) {
      const channel = channelBase + (event.register - 0xb4);
      presets[channel].b4 = event.value & 0xff;
      continue;
    }

    if (port === 0 && event.register === 0x28) {
      const operatorMask = (event.value >> 4) & 0x0f;
      const channel = decodeKeyOnChannel(event.value);
      if (atSample === undefined && operatorMask !== 0 && channel !== null) {
        const snapshot = cloneTfiPreset(presets[channel]);
        const signature = presetSignature(snapshot);
        if (!seenSignatures[channel].has(signature)) {
          seenSignatures[channel].add(signature);
          patchCounts[channel] += 1;
          patches.push({
            id: `channel${channel + 1}-${patchCounts[channel]}`,
            label: `channel${channel + 1}-${patchCounts[channel]}`,
            channel,
            sequence: patchCounts[channel],
            preset: snapshot,
          });
        }
      }
      continue;
    }

    const lowNibble = event.register & 0x0f;
    const channelOffset = lowNibble & 0x03;
    if (channelOffset > 2) {
      continue;
    }

    const slotOffset = lowNibble - channelOffset;
    const operator = findOperatorFromSlotOffset(slotOffset);
    if (!operator) {
      continue;
    }

    const channel = channelBase + channelOffset;
    const operatorPreset = presets[channel].operators[operator];
    const registerBase = event.register & 0xf0;

    if (registerBase === 0x30) {
      operatorPreset.dt = (event.value >> 4) & 0x07;
      operatorPreset.multi = event.value & 0x0f;
    } else if (registerBase === 0x40) {
      operatorPreset.tl = event.value & 0x7f;
    } else if (registerBase === 0x50) {
      operatorPreset.rs = (event.value >> 6) & 0x03;
      operatorPreset.ar = event.value & 0x1f;
    } else if (registerBase === 0x60) {
      operatorPreset.d1r = event.value & 0x1f;
    } else if (registerBase === 0x70) {
      operatorPreset.d2r = event.value & 0x1f;
    } else if (registerBase === 0x80) {
      operatorPreset.sl = (event.value >> 4) & 0x0f;
      operatorPreset.rr = event.value & 0x0f;
    } else if (registerBase === 0x90) {
      operatorPreset.ssg = event.value & 0x0f;
    }
  }

  if (atSample !== undefined && sample < atSample) throw new RangeError('Snapshot time exceeds track end');
  return {patches, presets};
}

