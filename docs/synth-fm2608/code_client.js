// SPDX-License-Identifier: BSD-3-Clause
// A borrowed OPNA client shares the editor's chip and keeps its lifetime local.
import {YM2608_RHYTHM_VOICES} from '../js/ym2608synth.js';

const sectionClients = new WeakMap();

/** Canonical note ownership for the shared live-loop runtime. */
export function resolveFm2608CodeNoteTarget(target, _method, args) {
  const section = sectionClients.get(target);
  if (section === 'adpcm') return {target, channel:0};
  const channel = section === 'rhythm' && typeof args[0] === 'string'
    ? YM2608_RHYTHM_VOICES[args[0]] : args[0];
  return Number.isInteger(channel) ? {target, channel} : null;
}

export function createFm2608CodeClient(chip, {isCurrent = () => true} = {}) {
  const notes = {fm:new Set(), ssg:new Set(), rhythm:new Set(), adpcm:false};
  const cancelled = () => new DOMException('FM2608 Code client stopped', 'AbortError');

  function assertCurrent() {
    if (!isCurrent()) throw cancelled();
  }

  function release() {
    for (const channel of notes.fm) chip.noteOff(channel);
    for (const channel of notes.ssg) chip.ssg.keyOff(channel);
    if (notes.rhythm.size) chip.rhythm.keyOff([...notes.rhythm]);
    if (notes.adpcm) chip.adpcm.keyOff();
    notes.fm.clear();
    notes.ssg.clear();
    notes.rhythm.clear();
    notes.adpcm = false;
  }

  function allNotesOff() {
    assertCurrent();
    release();
  }

  function dispose() {
    allNotesOff();
  }

  function observe(section, method, args) {
    if (method === 'reset') {
      if (section === 'fm') {
        notes.fm.clear(); notes.ssg.clear(); notes.rhythm.clear(); notes.adpcm = false;
      } else if (section === 'adpcm') notes.adpcm = false;
      else notes[section].clear();
      return;
    }
    if (section === 'adpcm') {
      if (method === 'keyOn') notes.adpcm = true;
      if (method === 'keyOff') notes.adpcm = false;
      return;
    }
    if (section === 'rhythm') {
      if (method !== 'keyOn' && method !== 'keyOff') return;
      for (const voice of Array.isArray(args[0]) ? args[0] : [args[0]]) {
        const channel = typeof voice === 'string' ? YM2608_RHYTHM_VOICES[voice] : voice;
        if (method === 'keyOn') notes.rhythm.add(channel);
        else notes.rhythm.delete(channel);
      }
      return;
    }
    if (method === 'noteOn' || method === 'keyOn' ||
        section === 'ssg' && (method === 'tone' || method === 'noise')) {
      notes[section].add(args[0]);
    }
    if (method === 'noteOff' || method === 'off' ||
        method === 'keyOff' && (section === 'ssg' || args[1] === undefined)) {
      notes[section].delete(args[0]);
    }
  }

  function wrap(target, section) {
    const methods = new Map();
    const client = new Proxy(target, {
      get(object, key) {
        if (key === 'then') return undefined;
        if (section === 'fm') {
          if (key === 'id' || key === 'chip') return 'ym2608';
          if (key === 'ssg' || key === 'rhythm' || key === 'adpcm') return sections[key];
          if (key === 'dispose') return dispose;
          if (key === 'allNotesOff') return allNotesOff;
        }
        const value = Reflect.get(object, key, object);
        if (typeof value !== 'function') return value;
        if (!methods.has(key)) methods.set(key, (...args) => {
          assertCurrent();
          const result = value.apply(object, args);
          observe(section, key, args);
          return result;
        });
        return methods.get(key);
      },
    });
    sectionClients.set(client, section);
    return client;
  }

  const sections = {
    ssg:wrap(chip.ssg, 'ssg'),
    rhythm:wrap(chip.rhythm, 'rhythm'),
    adpcm:wrap(chip.adpcm, 'adpcm'),
  };
  return {client:wrap(chip, 'fm'), release};
}
