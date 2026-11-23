// SPDX-License-Identifier: BSD-3-Clause
import { captureVsuVoice } from './capture.js';
import { CH5 } from './ch5.js';
import { createDefaultVsuPatch } from './patch.js';
import { VGM_SAMPLE_RATE } from './vgm.js';
import { VSU_CHANNEL_COUNT, VSU_WAVE_LENGTH, vsuChannelRegister, VSU_REGISTERS } from './vsu.js';

export const MAX_VSU_VGM_PRESETS = 512;
export const VSU_VGM_PRESET_SCAN_TICKS = 15 * 60 * VGM_SAMPLE_RATE;

const RENDER_FRAMES = 2048;
const FIRST_CHANNEL = vsuChannelRegister(0, VSU_REGISTERS.INT);
const CHANNEL_STRIDE = vsuChannelRegister(1, VSU_REGISTERS.INT) - FIRST_CHANNEL;
const SNAPSHOT_WORDS = 8;
const NOISE_CHANNEL = VSU_CHANNEL_COUNT - 1;

function checkPlan(plan, limit) {
  if (!(plan?.writes instanceof Uint32Array) || plan.writes.length % 3 ||
      !Number.isInteger(plan.durationTicks) || plan.durationTicks < 0)
    throw new TypeError('Choose a parsed VSU timeline.');
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_VSU_VGM_PRESETS)
    throw new RangeError('Choose a VSU preset limit from 0 to ' + MAX_VSU_VGM_PRESETS + '.');
}

function captureState(core) {
  const address = core.__heap_base.value;
  const align4 = size => Math.ceil(size / 4) * 4;
  const snapshot = address + align4(core.vsu_size());
  const left = snapshot + align4(core.vsu_snapshot_size());
  const right = left + 4 * RENDER_FRAMES;
  const end = right + 4 * RENDER_FRAMES;
  const { memory } = core;
  if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
  const words = new Uint32Array(memory.buffer, snapshot, SNAPSHOT_WORDS);
  const wave = new Uint8Array(memory.buffer, snapshot + words.byteLength, VSU_WAVE_LENGTH);
  const modulation = new Int8Array(memory.buffer, snapshot + words.byteLength + wave.byteLength, 32);

  core.vsu_reset(address);
  return {
    write(offset, value) { core.vsu_write(address, offset, value); },
    advance(frames) {
      while (frames > 0) {
        const count = Math.min(frames, RENDER_FRAMES);
        core.vsu_render(address, left, right, count, VGM_SAMPLE_RATE);
        frames -= count;
      }
    },
    voice(channel) {
      if (!core.vsu_snapshot_voice(address, channel, snapshot)) return null;
      const [frequency, active, waveBank, left, right, ev0, ev1, swp] = words;
      const canGrow = (ev1 & 1) && (ev0 & 8);
      if (!active || (!left && !right) || (!(ev0 >> 4) && !canGrow)) return null;
      return {
        channel, frequency, active: true, left, right, ev0, ev1, swp,
        waveBank: channel === NOISE_CHANNEL ? null : waveBank,
        wave: channel === NOISE_CHANNEL ? null : wave,
        modulation: channel === CH5 ? modulation : null,
      };
    },
  };
}

function toneKey(voice) {
  const { channel, wave, left, right, ev0, ev1, swp, modulation } = voice;
  const envelope = ev1 & 1 ? [ev0, ev1 & 3] : [ev0 >> 4];
  let effect = null;
  if (channel === NOISE_CHANNEL) effect = (ev1 >> 4) & 7;
  else if (channel === CH5 && (ev1 & 0x40) && ((swp >> 4) & 7)) {
    effect = ev1 & 0x10 ? [ev1 & 0x30, swp >> 4, Array.from(modulation)] : [swp];
  }
  return JSON.stringify([channel, wave && Array.from(wave), left, right, envelope, effect]);
}

/** Scan one pass of a parsed log, preserving wave RAM locks and the programmed envelope. */
export function scanVsuVgmPresets(core, plan, { limit = MAX_VSU_VGM_PRESETS } = {}) {
  checkPlan(plan, limit);
  if (!limit) return [];
  const chip = captureState(core);
  const keys = new Set(), presets = [];
  const { writes } = plan;
  const end = Math.min(plan.durationTicks, VSU_VGM_PRESET_SCAN_TICKS);
  const base = createDefaultVsuPatch();
  let tick = 0, cursor = 0;
  while (cursor < writes.length && writes[cursor] < end) {
    const nextTick = writes[cursor];
    chip.advance(nextTick - tick);
    tick = nextTick;
    let triggers = 0;
    // Writes at the same VGM tick are all applied before the first audible
    // frame. Use the final registers for that frame, as the player does.
    do {
      const offset = writes[cursor + 1], value = writes[cursor + 2];
      chip.write(offset, value);
      const relative = offset - FIRST_CHANNEL;
      if ((value & 0x80) && relative >= 0 && relative < CHANNEL_STRIDE * VSU_CHANNEL_COUNT &&
          relative % CHANNEL_STRIDE === 0) triggers |= 1 << (relative / CHANNEL_STRIDE);
      cursor += 3;
    } while (cursor < writes.length && writes[cursor] === tick);

    for (let channel = 0; triggers && channel < VSU_CHANNEL_COUNT; channel += 1) {
      if (!(triggers & (1 << channel))) continue;
      const voice = chip.voice(channel);
      if (!voice) continue;
      const key = toneKey(voice);
      if (keys.has(key)) continue;
      keys.add(key);
      const { patch } = captureVsuVoice(base, voice);
      presets.push({ channel, patch: { ...patch, preferredChannel: channel } });
      if (presets.length === limit) return presets;
    }
  }
  return presets;
}

/** Extract distinct presets in a worker so imports keep the instrument responsive. */
export async function extractVsuVgmPresets(plan, { signal, limit = MAX_VSU_VGM_PRESETS } = {}) {
  checkPlan(plan, limit);
  signal?.throwIfAborted();
  if (!limit) return [];
  const worker = new Worker(new URL('./vgm-presets-worker.js', import.meta.url), { type: 'module' });
  const writes = plan.writes.slice();
  return new Promise((resolve, reject) => {
    const finish = callback => value => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback(value);
    };
    const succeed = finish(resolve), fail = finish(reject);
    const abort = () => fail(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => data.error ? fail(new Error(data.error)) : succeed(data.presets);
    worker.onerror = event => {
      event.preventDefault();
      fail(new Error(event.message || 'Could not start VGM preset extraction.'));
    };
    worker.onmessageerror = () => fail(new Error('Could not read extracted VGM presets.'));
    try { worker.postMessage({ writes, durationTicks: plan.durationTicks, limit }, [writes.buffer]); }
    catch (error) { fail(error); }
  });
}
