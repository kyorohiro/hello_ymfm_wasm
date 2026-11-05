// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

const sources = new Set(['pulse','triangle','noise','fds','dmc']);
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const array = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
const byte = (values, index) => array(values) && integer(values[index], 255);
const metric = (id, label, max) => ({id, label, value:null, max, text:'—'});
const channel = (id, label, metrics) => ({id, label, status:'No observation', metrics});

function empty(source) {
  const level = () => metric('volume', 'Volume', 15), length = () => metric('length', 'Length remaining', 254);
  const channels = source === 'pulse' ? [channel('pulse1','Pulse · CH1',[level(),length()]), channel('pulse2','Pulse · CH2',[level(),length()])]
    : source === 'triangle' ? [channel('triangle','Triangle · CH3',[metric('linear','Linear remaining',127),length()])]
      : source === 'noise' ? [channel('noise','Noise · CH4',[level(),length()])]
        : source === 'fds' ? [channel('fds','FDS',[metric('volumeGain','Volume gain · raw',63),metric('depthGain','Depth gain · raw',63)])] : [];
  const note = source === 'triangle' ? 'Linear is a gate counter, not volume. Fast changes may occur between observations.'
    : source === 'fds' ? 'Volume is capped at 32 in the mixer. Depth uses its raw gain; increasing envelopes stop rising at 32. Fast changes may occur between observations.'
      : source === 'dmc' ? 'DMC uses the DAC preview in the sample editor below.'
        : 'Chip counters and volume values, not output loudness. Fast changes may occur between observations.';
  return {source,channels,note};
}

/** Project one observed chip snapshot into passive meters. The edited preset
 * identifies the source only: counters, gains and modes always come from the
 * applied core state. This function never advances or writes the audio engine.
 */
export function hardwareStateModel(state, source) {
  if (!sources.has(source)) return {source,channels:[],note:'Choose a sound source to observe its chip state.'};
  const model = empty(source);
  if (source === 'dmc') return model;
  const core = state?.coreState;
  if (state?.preset?.source !== source || !core || !Array.isArray(state.voices)
      || !state.voices.every(voice => voice && typeof voice.id === 'string' && integer(voice.channel,5))
      || !integer(core.enableMask,31) || !integer(core.muteMask,63)) return model;
  const held = number => state.voices.some(voice => voice.channel === number);
  const set = (item,value,text) => Object.assign(item,{value,text});
  if (source === 'fds') {
    if (!integer(core.fdsGain,63) || !integer(core.fdsSweepGain,63)
        || !['fdsEnabled','fdsIo','fdsActive','fdsModEnabled','fdsWriteEnabled'].every(key => typeof core[key] === 'boolean')
        || ![0x80,0x83,0x84,0x8a].every(index => byte(core.registers,index))) return model;
    const row = model.channels[0], [volume,depth] = row.metrics;
    set(volume,core.fdsGain,`${core.fdsGain} raw · ${Math.min(core.fdsGain,32)} effective`);
    set(depth,core.fdsSweepGain,`${core.fdsSweepGain} raw`);
    let mode;
    if (!held(5)) mode = 'Idle';
    else if (!core.fdsEnabled || !core.fdsIo) mode = 'Held · I/O disabled';
    else if (core.muteMask & 32) mode = 'Held · Muted';
    else if (!core.fdsActive) mode = 'Held · Wave gate closed';
    else if (core.fdsWriteEnabled) mode = 'Held · Wave RAM write mode';
    else {
      const envelope = !(core.registers[0x80] & 128) || !(core.registers[0x84] & 128);
      mode = !envelope ? 'Held · Fixed gains'
        : core.registers[0x83] & 64 || core.registers[0x8a] === 0 ? 'Held · Envelope clock paused' : 'Held · Envelope clock running';
    }
    row.status = `${mode}${core.fdsModEnabled ? '' : ' · Modulation off'}`;
    return model;
  }
  const numbers = source === 'pulse' ? [0,1] : source === 'triangle' ? [2] : [3];
  if (!array(core.volumes) || !array(core.lengths)
      || !numbers.every(number => integer(core.volumes[number],number === 2 ? 127 : 15)
        && integer(core.lengths[number],254) && byte(core.registers,number * 4))) return model;
  for (const [index,number] of numbers.entries()) {
    const row = model.channels[index], [level,length] = row.metrics;
    set(level,core.volumes[number],number === 2 ? `${core.volumes[number]} ticks` : `${core.volumes[number]} / 15`);
    set(length,core.lengths[number],`${core.lengths[number]} ticks`);
    if (!held(number)) row.status = 'Idle';
    else if (!(core.enableMask & (1 << number))) row.status = 'Held · Channel disabled';
    else if (core.muteMask & (1 << number)) row.status = 'Held · Muted';
    else if (core.lengths[number] === 0) row.status = 'Held · Length ended';
    else if (number === 2) row.status = core.volumes[2] === 0 ? 'Held · Linear ended'
      : core.registers[8] & 128 ? 'Held · Counters held' : 'Held · Counters running';
    else {
      const control = core.registers[number * 4], fixed = Boolean(control & 16);
      const levelState = core.volumes[number] === 0 ? fixed ? 'Fixed volume 0' : 'Envelope at 0' : fixed ? 'Fixed volume' : 'Envelope';
      row.status = `Held · ${levelState} · Length ${control & 32 ? 'halted' : 'running'}`;
    }
  }
  return model;
}
