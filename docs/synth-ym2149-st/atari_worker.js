// SPDX-License-Identifier: BSD-3-Clause
// All native parsing and 68000 execution occur in this disposable module Worker.
const wasmUrl = new URL('../generated/atari-audio-player/atari-audio-player.wasm', import.meta.url);
const maximumFileBytes = 8 * 1024 * 1024;
let nativePromise;
let native;
let active = false;
const decoder = new TextDecoder('windows-1252');

async function loadNative() {
  if (!nativePromise) {
    nativePromise = (async () => {
      const response = await fetch(wasmUrl);
      if (!response.ok) throw new Error(`AtariAudio WASM could not be loaded (${response.status})`);
      const result = await WebAssembly.instantiate(await response.arrayBuffer(), {
        env: {
          emscripten_notify_memory_growth() {},
          abort() { throw new Error('AtariAudio native abort'); },
        },
        wasi_snapshot_preview1: {
          proc_exit(code) { throw new Error(`AtariAudio native exit ${code}`); },
          fd_write() { return 0; },
          fd_close() { return 0; },
          fd_seek() { return 0; },
        },
      });
      native = result.instance.exports;
      native._initialize?.();
      return native;
    })();
  }
  return nativePromise;
}

function textAt(pointer) {
  const bytes = new Uint8Array(native.memory.buffer);
  let end = pointer;
  while (end < bytes.length && end - pointer < 4096 && bytes[end]) ++end;
  return decoder.decode(bytes.subarray(pointer, end));
}

function check(result) {
  if (!result) throw new Error(textAt(native.atari_error()) || 'AtariAudio operation failed');
}

function information() {
  const format = native.atari_format() === 2 ? 'sndh' : 'ym';
  const subsongCount = native.atari_subsong_count();
  const subsongDurationFrames = Array.from({ length: subsongCount }, (_, index) => native.atari_subsong_duration(index + 1) || null);
  return {
    format,
    clock: native.atari_clock(),
    subsongCount,
    defaultSubsong: native.atari_default_subsong(),
    durationFrames: native.atari_duration() || null,
    metadata: {
      title: textAt(native.atari_text(0)),
      author: textAt(native.atari_text(1)),
      year: textAt(native.atari_text(2)),
      ripper: textAt(native.atari_text(3)),
      converter: textAt(native.atari_text(4)),
      fileFormat: textAt(native.atari_text(5)),
      replayEngine: 'AtariAudio 1.31',
      upstreamRevision: '1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb',
      outputChannels: 1,
      extraOutputs: format === 'sndh' ? ['ste-dac'] : [],
      extraOutputsDescription: format === 'sndh' ? 'Replay may mix STE DAC audio with the three observed YM voices.' : '',
      subsongDurationFrames,
    },
  };
}

function snapshot() {
  if (!active) throw new Error('Atari player is not initialized');
  return {
    frame: native.atari_frame(),
    clock: native.atari_clock(),
    registers: Array.from({ length: 16 }, (_, reg) => native.atari_register(reg)),
    registerKnown: Array.from({ length: 16 }, (_, reg) => reg < 14 ? 1 : 0),
  };
}

async function handle(operation, payload) {
  await loadNative();
  if (operation === 'inspect' || operation === 'open') {
    const bytes = payload.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 18 || bytes.length > maximumFileBytes) throw new Error('Atari file must be between 18 bytes and 8 MiB');
    const pointer = native.atari_alloc(bytes.length);
    if (!pointer) throw new Error('AtariAudio input allocation failed');
    active = false;
    try {
      new Uint8Array(native.memory.buffer, pointer, bytes.length).set(bytes);
      check(native.atari_open(pointer, bytes.length, operation === 'inspect' ? 0 : payload.subsong));
    } finally {
      native.atari_free(pointer);
    }
    active = operation === 'open';
    return { ...information(), ...(active ? { snapshot: snapshot() } : {}) };
  }
  if (operation === 'snapshot') return snapshot();
  if (operation === 'render') {
    if (!active) throw new Error('Atari player is not initialized');
    if (!Number.isInteger(payload.frames) || payload.frames < 1 || payload.frames > 4096) throw new Error('Render request must contain 1..4096 frames');
    const count = native.atari_render(payload.frames);
    if (count < 0) throw new Error(textAt(native.atari_error()));
    const pcm = new Int16Array(native.memory.buffer, native.atari_output(), count);
    const left = Float32Array.from(pcm, value => value / 32768);
    const right = left.slice();
    const state = snapshot();
    const duration = native.atari_duration();
    return { left, right, frame: state.frame, ended: !!duration && state.frame >= duration, snapshot: state };
  }
  throw new Error('Unknown Atari player operation');
}

// Serial dispatch preserves native state when callers issue adjacent requests.
let pending = Promise.resolve();
self.onmessage = event => {
  const { id, operation, payload } = event.data || {};
  pending = pending.then(async () => {
    try {
      const result = await handle(operation, payload || {});
      const transfer = result.left ? [result.left.buffer, result.right.buffer] : [];
      self.postMessage({ id, result }, transfer);
    } catch (error) {
      active = false;
      self.postMessage({ id, error: error?.message || String(error) });
    }
  });
};
