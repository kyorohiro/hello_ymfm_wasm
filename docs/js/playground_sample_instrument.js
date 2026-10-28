/** Browser / Worker / Node: shared sample instruments. Device access is injected through pg. */
import {normalizeSampleEdit, renderSampleEdit, renderGameboyWave} from './playground_sample_edit.js?v=audio-numeric-bindings-1';
import {encodeAdpcmB} from './adpcm_b_sample.js';
import {captureKeyboardCallback} from './playground_keyboard.js?v=audio-numeric-bindings-1';
import {renderPs1Sample} from './playground_sample_ps1.js?v=ps1-sample-editor-1';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function eventNote(event) {
  if (!event || event.id === undefined || !Number.isInteger(event.midi) || event.midi < 0 || event.midi > 127) throw new TypeError('A sample note requires {id, midi: 0..127}');
  const velocity = event.velocity ?? 100;
  if (!Number.isInteger(velocity) || velocity < 0 || velocity > 127) throw new RangeError('Sample velocity must be an integer 0..127');
  return {...event, velocity};
}

/** FIFO per physical voice; retirement invalidates old callbacks before posting silence. */
function instrumentVoices(name, count, controls, silence, capture, shared) {
  const voices = shared?.voices ?? Array.from({length: count}, (_, channel) => ({channel, owner: null, queue: Promise.resolve()}));
  const held = new Map();
  const instrument = {};
  let generation = 0, age = 0;
  const api = {
    name,
    async noteOn(event) {
      event = eventNote(event);
      if (!event.velocity) return api.noteOff(event);
      if (held.has(event.id)) return;
      const voice = voices.find(voice => !voice.owner) ?? voices.reduce((a, b) => a.owner.age < b.owner.age ? a : b);
      voice.owner?.retire();
      const owner = {event, age: shared ? ++shared.age : ++age, generation, instrument, retire: () => held.delete(event.id)};
      voice.owner = voice.lease = owner;
      held.set(event.id, {voice, owner});
      const owns = () => generation === owner.generation && voice.owner === owner && voice.lease === owner;
      const invoke = capture(command => command());
      voice.queue = voice.queue.catch(() => {}).then(capture(async () => {
        if (!owns()) return;
        await invoke(() => silence(voice.channel));
        for (const command of controls(voice.channel, event)) {
          if (!owns()) return;
          await invoke(command);
        }
      }));
      await voice.queue;
    },
    async noteOff(event) {
      const pressed = held.get(event?.id);
      if (!pressed) return;
      held.delete(event.id);
      if (pressed.voice.owner !== pressed.owner) return;
      pressed.voice.owner = null;
      const token = generation;
      const invoke = capture(command => command());
      pressed.voice.queue = pressed.voice.queue.catch(() => {}).then(capture(() => {
        if (token === generation && pressed.voice.lease === pressed.owner) {
          pressed.voice.lease = null;
          return invoke(() => silence(pressed.voice.channel));
        }
      }));
      await pressed.voice.queue;
    },
    allNotesOff() {
      generation++;
      held.clear();
      const retiring = shared ? voices.filter(voice => voice.lease?.instrument === instrument) : voices;
      for (const voice of retiring) {voice.owner = voice.lease = null; voice.queue = Promise.resolve();}
      // Do not await a retired queue: its delayed off could mute a newer Run.
      return Promise.all(retiring.map(voice => silence(voice.channel))).then(() => {});
    },
  };
  return api;
}

// Shared only by sample instruments that borrow the same SPU API. A replacement
// instrument cannot be silenced by an earlier instrument's queued release.
const ps1VoicePools = new WeakMap();
function ps1VoicePool(spu) {
  let pool = ps1VoicePools.get(spu);
  if (!pool) {
    pool = {age: 0, voices: Array.from({length: 24}, (_, channel) => ({channel, owner: null, lease: null, queue: Promise.resolve()}))};
    ps1VoicePools.set(spu, pool);
  }
  return pool;
}

/** Repeated Run/Stop retains SPU RAM. Reuse only a descriptor whose tuning,
 * loop and actual current RAM bytes match; IDs or a former upload alone are
 * insufficient after reset({clearRam:true}) or direct low-level RAM edits.
 * Inspector reads happen once during preparation, never during a note/render.
 */
async function ps1Sample(spu, selected) {
  const matches = sample => sample && sample.editorChannel === undefined && Number.isSafeInteger(sample.id) && sample.id >= 0 &&
    Number.isSafeInteger(sample.startAddress) && sample.startAddress >= 0x1000 && sample.startAddress % 16 === 0 &&
    sample.byteLength === selected.adpcm.length && sample.decodedFrames === selected.frames &&
    sample.basePitch === 4096 && sample.rootFrequencyHz === selected.baseFrequencyHz &&
    sample.loop === selected.loopEnabled && sample.loopStartSamples === (selected.loopEnabled ? selected.loopStartFrame : null) &&
    sample.repeatAddress === sample.startAddress + (selected.loopEnabled ? selected.loopStartFrame / 28 * 16 : 0);
  if (typeof spu.getState === 'function' && typeof spu.snapshot === 'function') {
    const state = await spu.getState();
    if (Array.isArray(state?.samples) && state.samples.some(matches)) {
      const snapshot = await spu.snapshot();
      const ram = snapshot?.ram instanceof Uint8Array ? snapshot.ram :
        snapshot?.ram instanceof ArrayBuffer ? new Uint8Array(snapshot.ram) : null;
      if (ram && Array.isArray(snapshot.samples)) {
        for (const [index, sample] of snapshot.samples.entries()) {
          if (!matches(sample) || sample.id !== index || sample.startAddress + sample.byteLength > ram.length) continue;
          if (selected.adpcm.every((byte, offset) => ram[sample.startAddress + offset] === byte)) return {...sample};
        }
      }
    }
  }
  return spu.loadADPCM(selected.adpcm, {baseFrequencyHz: selected.baseFrequencyHz,
    ...(selected.loopEnabled ? {loopStartSamples: selected.loopStartFrame} : {})});
}

function metadata(audio) {
  const rootMidi = audio.rootMidi ?? 60, tuneCents = audio.tuneCents ?? 0;
  if (!Number.isInteger(rootMidi) || rootMidi < 0 || rootMidi > 127 || !Number.isFinite(tuneCents)) throw new RangeError('Invalid sample root note or tuning');
  return {rootMidi, tuneCents};
}

/**
 * audio is already edited PCM. Device-specific conversion is explicit: PS1 uses
 * native 44.1 kHz mono and 28-frame loop packets; Game Boy uses one 32-point cycle.
 * @param {{pg?: any, audio?: any, chip?: string, target?: 'auto' | 'rf5c164' | 'gameboy-wave' | 'adpcm-b' | 'ps1', volume?: number}} [options]
 */
export async function createSampleInstrument({pg, audio, chip = 'ym2612', target = audio?.target ?? 'auto', volume} = {}) {
  if (!pg || !audio) throw new TypeError('createSampleInstrument requires pg and decoded audio');
  const {rootMidi, tuneCents} = metadata(audio);
  if (volume !== undefined && (!Number.isInteger(volume) || volume < 0 || volume > 255)) throw new RangeError('Sample volume must be an integer 0..255');
  if (target === 'auto') target = chip === 'ps1' ? 'ps1' : chip === 'gameboy' ? 'gameboy-wave' : ['ym2608', 'ym2610', 'ym2610b'].includes(chip) ? 'adpcm-b' : 'rf5c164';
  const ratio = midi => 2 ** (((midi - rootMidi) * 100 - tuneCents) / 1200);
  const capture = callback => captureKeyboardCallback(pg, callback);
  if (target === 'ps1') {
    // Re-encode the edited PCM instead of trusting an optional stale/foreign
    // `audio.adpcm` field. Gain, fades and crop have already been applied upstream.
    const selected = renderPs1Sample(audio, {rootMidi, tuneCents,
      loopEnabled: audio.loopEnabled, loopStartFrame: audio.loopStartFrame, loopEndFrame: audio.loopEndFrame});
    const spu = chip === 'ps1' && pg.spu ? pg.spu : await pg.useSoundChip('ps1');
    const sample = await ps1Sample(spu, selected);
    const level = volume === undefined ? .75 : volume / 255;
    return instrumentVoices('PS1 SPU sampler (24 voices)', 24, (channel, event) => {
      const gain = level * event.velocity / 127;
      return [
        () => spu.setPreset(channel, {sample: sample.id, volumeLeft: gain, volumeRight: gain, adsr1: 0x000f, adsr2: 8}),
        () => spu.setFrequency(channel, 440 * 2 ** ((event.midi - 69) / 12)),
        () => spu.keyOn(channel),
      ];
    }, channel => spu.keyOff(channel), capture, ps1VoicePool(spu));
  }
  if (target === 'rf5c164') {
    const frames = normalizeSampleEdit(audio).endFrame;
    const end = audio.loopEnabled ? audio.loopEndFrame ?? frames : frames;
    const loopStart = audio.loopStartFrame ?? 0;
    if (!Number.isInteger(end) || end < 1 || end > frames || !Number.isInteger(loopStart) || loopStart < 0 || loopStart >= end) throw new RangeError('Invalid RF5C164 loop range');
    const selected = renderSampleEdit(audio, {endFrame: end}, {mono: true, maxFrames: 65504});
    const pcm = await pg.useSoundChip('rf5c164');
    for (let channel = 0; channel < 8; channel++) await pcm.keyOff(channel);
    // RF reads only the byte reached by its step. A full 16-bit step can cross
    // 32 bytes. Load the guards with the waveform so Inspector metadata stays valid.
    const sample = await pcm.loadSample(selected, {address: 0, endGuardBytes: 32, ...(audio.loopEnabled ? {loopStart} : {})});
    const level = volume ?? 72;
    return instrumentVoices('RF5C164 sampler (8 voices)', 8, (channel, event) => [
      () => pcm.setChannel(channel, {...sample, step: clamp(Math.round(sample.step * ratio(event.midi)), 1, 65535),
        volume: Math.round(level * event.velocity / 127),
        pan: channel % 2 ? {left: 11, right: 15} : {left: 15, right: 11}}),
      () => pcm.keyOn(channel),
    ], channel => pcm.keyOff(channel), capture);
  }
  if (target === 'gameboy-wave') {
    const waveform = audio.waveform ?? renderGameboyWave(audio, {});
    if (!waveform || waveform.length !== 32 || Array.from(waveform).some(value => !Number.isInteger(value) || value < 0 || value > 15)) throw new RangeError('Game Boy wave RAM requires 32 four-bit samples');
    const gameboy = pg.gameboy ?? await pg.useSoundChip('gameboy');
    if (!pg.gameboy) await gameboy.initialize();
    await gameboy.wave.keyOff();
    await gameboy.wave.stopAndSetWaveform(Uint8Array.from(waveform));
    await gameboy.setPan(2, true, true);
    const level = volume ?? 255;
    return instrumentVoices('Game Boy wave RAM sampler (1 voice)', 1, (_channel, event) => {
      const gain = level * event.velocity / (255 * 127);
      return [() => gameboy.wave.setNote(event.midi), () => gameboy.wave.setLevel(gain > .75 ? 1 : gain > .375 ? .5 : gain > 0 ? .25 : 0), () => gameboy.wave.keyOn()];
    }, () => gameboy.wave.keyOff(), capture);
  }
  if (target === 'adpcm-b') {
    const neogeo = chip === 'ym2610' || chip === 'ym2610b';
    const adpcm = neogeo ? pg.adpcmB ?? pg.adpcm : pg.adpcm;
    if (!adpcm) throw new Error('ADPCM-B sampling requires PC98 or Neo Geo mode');
    const edited = renderSampleEdit(audio, {}, {mono: true});
    const frames = edited.channels[0].length;
    if (audio.loopEnabled && ((audio.loopStartFrame ?? 0) !== 0 || (audio.loopEndFrame ?? frames) !== frames)) throw new RangeError('ADPCM-B repeats its whole sample. Select the full loop range or disable looping.');
    const alignment = neogeo ? 512 : 64;
    const padded = new Float32Array(Math.ceil(frames / alignment) * alignment);
    padded.set(edited.channels[0]);
    // Encode the padded PCM in one pass. Zero encoded bytes are not silence:
    // ADPCM decoder history must continue through the padding.
    const encoded = encodeAdpcmB({channels: [padded], sampleRate: edited.sampleRate}, edited.sampleRate, neogeo ? 0x1000000 : 0x200000);
    await adpcm.keyOff();
    await adpcm.loadMemory(encoded.bytes, 0);
    await adpcm.setSample({start: 0, end: encoded.bytes.length});
    await adpcm.setPan(true, true);
    const level = volume ?? 180;
    return instrumentVoices('ADPCM-B sampler (1 voice)', 1, (_channel, event) => [
      () => adpcm.setPlaybackRate(edited.sampleRate * ratio(event.midi)),
      () => adpcm.setVolume(Math.round(level * event.velocity / 127)),
      () => adpcm.keyOn({repeat: !!audio.loopEnabled}),
    ], () => adpcm.keyOff(), capture);
  }
  throw new Error(`Unsupported sample instrument target: ${target}`);
}
