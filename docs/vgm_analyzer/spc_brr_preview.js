import {SnesDspCore, SPC_SAMPLE_RATE} from '../js/spc.js';

const HOLD_FRAMES = SPC_SAMPLE_RATE;
const TOTAL_FRAMES = SPC_SAMPLE_RATE * 2;
const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function bytes(value, length, name) {
  const data = value instanceof ArrayBuffer ? new Uint8Array(value)
    : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
  if (!data || data.length !== length) throw new TypeError(`${name} must contain ${length} bytes`);
  return data;
}
function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Voice preview cancelled', 'AbortError');
}

/** Audition a captured BRR sample through a fresh, isolated S-DSP voice.
 * The selected captured voice supplies raw PITCH, ADSR/GAIN and stereo volumes;
 * the full captured RAM keeps original directory aliases, loops and RAM wrap.
 * No root note is inferred or required. This is a new key-on held for one second
 * then key-off with one second of release, not a resumed internal voice state.
 * SPC700 driver updates, master-volume settings, echo, noise and pitch modulation
 * are omitted. Master L/R volume is fixed at 127; Gaussian interpolation and the
 * hardware envelope are performed by the accurate DSP core.
 */
export async function renderSpcBrrVoicePreview(entry, voice, {
  snapshot,
  signal,
  moduleFactory,
  moduleOptions,
} = {}) {
  checkAbort(signal);
  const ram = bytes(snapshot?.ram, 65536, 'Captured RAM');
  const dsp = bytes(snapshot?.dsp, 128, 'Captured DSP');
  const sourceNumber = integer(voice?.sourceNumber, 0, 255, 'Voice SRCN');
  const voiceIndex = integer(voice?.index, 0, 7, 'Voice index');
  const directory = integer(entry?.directory, 0, 255, 'Sample directory');
  const aliases = entry.sourceNumbers ?? [entry.sourceNumber];
  if (!aliases.includes(sourceNumber)) throw new Error('Selected voice does not reference this BRR candidate');
  if (directory !== dsp[0x5d]) throw new Error('Sample directory differs from the captured DSP');
  const address = ((directory << 8) + sourceNumber * 4) & 65535;
  const word = offset => ram[offset & 65535] | ram[(offset + 1) & 65535] << 8;
  if (word(address) !== entry.startAddress || word(address + 2) !== entry.loopAddress) {
    throw new Error('BRR directory mapping differs from the captured RAM');
  }
  const pitch = integer(voice.pitch, 0, 0x3fff, 'Voice PITCH');
  const volumeLeft = integer(voice.volumeLeft, -128, 127, 'Left volume');
  const volumeRight = integer(voice.volumeRight, -128, 127, 'Right volume');
  const adsr1 = integer(voice.adsr1, 0, 255, 'ADSR1');
  const adsr2 = integer(voice.adsr2, 0, 255, 'ADSR2');
  const gain = integer(voice.gain, 0, 255, 'GAIN');
  if (moduleFactory !== undefined && typeof moduleFactory !== 'function') throw new TypeError('moduleFactory must be a function');
  await yieldToBrowser();
  checkAbort(signal);
  const factory = moduleFactory ?? (await import('../generated/spc_wasm.js')).default;
  checkAbort(signal);
  let core;
  try {
    core = await SnesDspCore.create({moduleFactory: factory, moduleOptions});
    checkAbort(signal);
    core.reset();
    core.loadRam(ram);
    for (let register = 0; register < 128; register++) core.writeDsp(register, 0);
    core.writeDsp(0x6c, 0x20); // Echo RAM writes disabled; reset and mute cleared.
    core.writeDsp(0x0c, 127); core.writeDsp(0x1c, 127);
    core.writeDsp(0x5d, directory);
    core.writeDsp(0x00, volumeLeft & 255); core.writeDsp(0x01, volumeRight & 255);
    core.writeDsp(0x02, pitch & 255); core.writeDsp(0x03, pitch >> 8);
    core.writeDsp(0x04, sourceNumber);
    core.writeDsp(0x05, adsr1); core.writeDsp(0x06, adsr2); core.writeDsp(0x07, gain);
    core.writeDsp(0x5c, 0xfe); core.writeDsp(0x4c, 1);
    const left = new Float32Array(TOTAL_FRAMES), right = new Float32Array(TOTAL_FRAMES);
    let offset = 0, chunks = 0;
    while (offset < TOTAL_FRAMES) {
      checkAbort(signal);
      if (offset === HOLD_FRAMES) core.writeDsp(0x5c, 0xff);
      const boundary = offset < HOLD_FRAMES ? HOLD_FRAMES : TOTAL_FRAMES;
      const count = Math.min(1024, boundary - offset);
      core.renderInto(left, right, count, offset);
      offset += count;
      if (++chunks % 8 === 0 && offset < TOTAL_FRAMES) {
        await yieldToBrowser();
        checkAbort(signal);
      }
    }
    checkAbort(signal);
    return {sampleRate: SPC_SAMPLE_RATE, channels: [left, right], holdSeconds: 1,
      durationSeconds: 2, voiceIndex, sourceNumber,
      rendering: 'Fresh S-DSP key-on with captured PITCH, ADSR/GAIN and stereo volumes; 1 s hold + 1 s release. No driver updates, echo, noise or pitch modulation. Master volume 127.'};
  } finally {core?.dispose();}
}
