// SPDX-License-Identifier: BSD-3-Clause
import {createAy8910Audio} from '../js/playground_ay8910_audio.js';
import {createAy8910Client} from '../js/playground_ay8910.js';
import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {createInstrument, YM2149_ST_CLOCK} from './instrument.js';
import {createDefaultPreset, readPreset} from './preset.js';

export const YM2149_ST_SYNTH_BALANCE = SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.find(item => item.name === 'ay8910').volume;
const gain = (value, label) => {
  if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError(`${label} must be 0..3.8`);
  return value;
};

/** Called from an Enable/Play gesture. One centered YM2149 and one speaker route. */
export async function createAudio({volume = 0.6, preset = createDefaultPreset(), onError = () => {}, onChange = () => {}} = {}) {
  gain(volume, 'Master'); preset = readPreset(preset);
  if (typeof onError !== 'function' || typeof onChange !== 'function') throw new TypeError('Audio callbacks must be functions');
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('Web Audio is unavailable');
  const context = new Context({latencyHint: 'interactive'}), controller = new AbortController();
  let endpoint, client, instrument, chipBalance, fade, master, closed = false, closing, fatal, rejectStartup, timer;
  const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });
  void startupFailure.catch(() => {});
  function check() {
    if (fatal) throw fatal;
    if (closed || context.state === 'closed') throw new Error('Enable YM2149 ST audio again');
  }
  function dispose() {
    if (closing) return closing;
    closed = true; controller.abort(); clearTimeout(timer);
    context.removeEventListener?.('statechange', contextClosed);
    try { instrument?.dispose(); } catch {}
    try { client?.dispose(); } catch {}
    try { endpoint?.dispose(); } catch {}
    for (const node of [chipBalance, fade, master]) try { node?.disconnect(); } catch {}
    closing = Promise.resolve().then(() => context.state === 'closed' ? undefined : context.close());
    return closing;
  }
  function fail(error) {
    if (closed || fatal) return;
    fatal = error instanceof Error ? error : new Error(String(error));
    rejectStartup(fatal);
    try { onError(fatal); } catch {}
    void dispose().catch(() => {});
  }
  function contextClosed() { if (context.state === 'closed' && !closed) fail(new Error('YM2149 ST AudioContext closed')); }
  context.addEventListener?.('statechange', contextClosed);
  try {
    if (!context.audioWorklet) throw new Error('YM2149 ST requires AudioWorklet over HTTPS or localhost');
    timer = setTimeout(() => fail(new Error('YM2149 ST audio initialization timed out')), 15000);
    chipBalance = context.createGain(); chipBalance.gain.value = YM2149_ST_SYNTH_BALANCE;
    fade = context.createGain(); fade.gain.value = 1;
    master = context.createGain(); master.gain.value = volume;
    chipBalance.connect(fade); fade.connect(master); master.connect(context.destination);
    const resumed = context.resume();
    const created = createAy8910Audio(context, chipBalance, {
      clock: YM2149_ST_CLOCK, type: 0x10, flags: 1, signal: controller.signal,
      wasmUrl: new URL('../generated/ay8910_wasm.wasm', import.meta.url),
      workletUrl: new URL('../js/playground_ay8910_worklet.js', import.meta.url),
      onError: fail,
    }).then(value => {
      if (closed) { value.dispose(); throw fatal ?? new Error('YM2149 ST audio closed'); }
      return (endpoint = value);
    });
    await Promise.race([Promise.all([created, resumed]), startupFailure]);
    check(); clearTimeout(timer);
    client = createAy8910Client(endpoint.port, {clock: YM2149_ST_CLOCK});
    client.initialize();
    instrument = createInstrument({client, preset, onChange});
    return {
      context, client, instrument, outputNode: master,
      codeInputNode: chipBalance, codeOutputNode: fade, codeFadeNode: fade,
      setVolume(value) { check(); master.gain.value = gain(value, 'Master'); },
      setChipVolume(value) { check(); chipBalance.gain.value = YM2149_ST_SYNTH_BALANCE * gain(value, 'Mixer'); },
      async resume() { check(); await context.resume(); check(); },
      stop() { check(); instrument.stop(); }, dispose,
    };
  } catch (error) {
    fail(error);
    await dispose().catch(() => {});
    throw fatal ?? error;
  }
}
