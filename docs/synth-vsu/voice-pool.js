// SPDX-License-Identifier: BSD-3-Clause
import { VSU_CHANNEL_COUNT } from './vsu.js';

export function createVsuVoicePool() {
  const byOwner = new Map();
  const byChannel = new Map();
  const cursors = new Map();

  function isCurrent(voice) {
    return Boolean(voice && byOwner.get(voice.owner) === voice);
  }

  function releaseVoice(voice) {
    if (!isCurrent(voice)) return null;
    byOwner.delete(voice.owner);
    byChannel.delete(voice.channel);
    return voice;
  }

  function acquire(eligibleChannels, fields) {
    if (fields?.owner === undefined) throw new TypeError('A VSU voice needs an owner.');
    if (byOwner.has(fields.owner)) return null;
    if (!Array.isArray(eligibleChannels) || !eligibleChannels.length) throw new RangeError('Choose a VSU channel.');
    const eligible = new Set(eligibleChannels);
    if (eligible.size !== eligibleChannels.length ||
        Array.from(eligible).some(channel => !Number.isInteger(channel) || channel < 0 || channel >= VSU_CHANNEL_COUNT)) {
      throw new RangeError('Choose distinct VSU channels from 0 to 5.');
    }

    const key = eligibleChannels.join(',');
    const cursor = cursors.get(key) ?? 0;
    let index = -1;
    for (let offset = 0; offset < eligibleChannels.length; offset += 1) {
      const candidate = (cursor + offset) % eligibleChannels.length;
      if (!byChannel.has(eligibleChannels[candidate])) {
        index = candidate;
        break;
      }
    }

    let displaced = null;
    if (index < 0) {
      // Insertion order records the acquisition order even while audio starts asynchronously.
      displaced = Array.from(byChannel.values()).find(voice => eligible.has(voice.channel));
      index = eligibleChannels.indexOf(displaced.channel);
      releaseVoice(displaced);
    }

    const voice = { ...fields, channel: eligibleChannels[index], started: false };
    byOwner.set(voice.owner, voice);
    byChannel.set(voice.channel, voice);
    cursors.set(key, (index + 1) % eligibleChannels.length);
    return { voice, displaced };
  }

  return {
    acquire,
    isCurrent,
    releaseVoice,
    release(owner) { return releaseVoice(byOwner.get(owner)); },
    voiceOn(channel) { return byChannel.get(channel) ?? null; },
    voices() { return Array.from(byChannel.values()); },
    clear() {
      const released = Array.from(byChannel.values());
      byOwner.clear();
      byChannel.clear();
      cursors.clear();
      return released;
    },
  };
}
