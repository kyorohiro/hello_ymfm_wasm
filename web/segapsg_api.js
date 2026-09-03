import { SEGAPSG_CLOCK } from "./segapsg.js";

const NOTE_TO_SEMITONE = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3,
  E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8,
  Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

const NOISE_RATES = {
  low: 0,
  medium: 1,
  high: 2,
  tone3: 3,
};

export function createSegaPsgApi(transport) {
  if (!transport || typeof transport.write !== "function") {
    throw new Error("Sega PSG transport requires write(value)");
  }

  const rawWrite = (value) => transport.write(normalizeByte(value));

  return {
    write: rawWrite,
    reset: () => transport.reset?.(),
    resetAll: () => transport.resetAll?.(),
    tone(channel, options = {}) {
      const normalizedChannel = normalizeToneChannel(channel);
      const period = resolveTonePeriod(options);
      const attenuation = resolveAttenuation(options);
      writeTone(rawWrite, normalizedChannel, period, attenuation);
      return period;
    },
    off(channel) {
      writeAttenuation(rawWrite, normalizeToneChannel(channel), 15);
    },
    noise(options = {}) {
      const type = options.type ?? "white";
      if (type !== "white" && type !== "periodic") {
        throw new Error('psg.noise type must be "white" or "periodic"');
      }
      const rate = options.rate ?? "medium";
      const rateBits = NOISE_RATES[rate];
      if (rateBits === undefined) {
        throw new Error('psg.noise rate must be "low", "medium", "high", or "tone3"');
      }
      const attenuation = resolveAttenuation(options);
      const mode = (type === "white" ? 0x04 : 0) | rateBits;
      rawWrite(0xe0 | mode);
      rawWrite(0xf0 | attenuation);
      return mode;
    },
    noiseOff() {
      rawWrite(0xff);
    },
  };
}

export function psgPeriodFromFrequency(frequency) {
  const value = Number(frequency);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`PSG frequency must be a positive finite number, got ${frequency}`);
  }
  return Math.max(1, Math.min(0x3ff, Math.round(SEGAPSG_CLOCK / (32 * value))));
}

export function psgPeriodFromNote(note) {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(String(note).trim());
  if (!match || NOTE_TO_SEMITONE[match[1]] === undefined) {
    throw new Error(`Unsupported PSG note: ${note}`);
  }
  const midi = (Number(match[2]) + 1) * 12 + NOTE_TO_SEMITONE[match[1]];
  return psgPeriodFromFrequency(440 * 2 ** ((midi - 69) / 12));
}

function resolveTonePeriod(options) {
  if (!options || typeof options !== "object") {
    throw new Error("psg.tone options must be an object");
  }
  if (options.period !== undefined) {
    return normalizePeriod(options.period);
  }
  if (options.frequency !== undefined) {
    return psgPeriodFromFrequency(options.frequency);
  }
  if (options.note !== undefined) {
    return psgPeriodFromNote(options.note);
  }
  throw new Error("psg.tone requires period, frequency, or note");
}

function resolveAttenuation(options) {
  if (options.attenuation !== undefined) {
    return normalizeAttenuation(options.attenuation);
  }
  if (options.volume === undefined) {
    return 0;
  }
  const volume = Number(options.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(`PSG volume must be in range 0..1, got ${options.volume}`);
  }
  return 15 - Math.round(volume * 15);
}

function writeTone(write, channel, period, attenuation) {
  write(0x80 | (channel << 5) | (period & 0x0f));
  write((period >> 4) & 0x3f);
  writeAttenuation(write, channel, attenuation);
}

function writeAttenuation(write, channel, attenuation) {
  write(0x90 | (channel << 5) | attenuation);
}

function normalizeToneChannel(value) {
  const channel = Number(value);
  if (!Number.isInteger(channel) || channel < 0 || channel > 2) {
    throw new Error("PSG tone channel must be 0..2");
  }
  return channel;
}

function normalizePeriod(value) {
  const period = Number(value);
  if (!Number.isInteger(period) || period < 1 || period > 0x3ff) {
    throw new Error("PSG period must be an integer in range 1..1023");
  }
  return period;
}

function normalizeAttenuation(value) {
  const attenuation = Number(value);
  if (!Number.isInteger(attenuation) || attenuation < 0 || attenuation > 15) {
    throw new Error("PSG attenuation must be an integer in range 0..15");
  }
  return attenuation;
}

function normalizeByte(value) {
  const byte = Number(value);
  if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
    throw new Error("PSG write value must be an integer in range 0..255");
  }
  return byte;
}
