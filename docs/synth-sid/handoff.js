// SPDX-License-Identifier: BSD-3-Clause
// A one-time, same-origin bridge for an explicitly selected Player preset.
// Only authoring parameters enter storage; no tune, firmware or audio is sent.
import {readPreset} from './preset.js';

export const SID_PRESET_HANDOFF_PARAMETER = 'sid-voice';
export const SID_PRESET_HANDOFF_TTL_MS = 5 * 60 * 1000;
export const SID_PRESET_HANDOFF_MAX_BYTES = 64 * 1024;
const prefix = 'tetorica.sid.voice-handoff.v1:';
const tokenPattern = /^[A-Za-z0-9_-]{16,96}$/;
const storageMessage = 'SID preset transfer needs same-origin browser storage. Save the preset and use Load preset in SID Synth instead.';
const timeValue = now => {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid SID preset transfer time');
  return value;
};
function randomToken() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('Secure random tokens are unavailable. Save the preset instead.');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}
function checkSize(value) {
  if (typeof value !== 'string' || value.length > SID_PRESET_HANDOFF_MAX_BYTES
      || new TextEncoder().encode(value).length > SID_PRESET_HANDOFF_MAX_BYTES) {
    throw new RangeError('SID preset transfer exceeds 64 KiB');
  }
}
function requestedToken(fragment) {
  if (typeof fragment !== 'string') throw new TypeError('SID preset transfer fragment must be a string');
  const parameters = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const tokens = parameters.getAll(SID_PRESET_HANDOFF_PARAMETER);
  if (!tokens.length) return null;
  if (tokens.length !== 1 || !tokenPattern.test(tokens[0])) throw new TypeError('Invalid or duplicate SID preset transfer token');
  return tokens[0];
}

/** Prepare only after the Player has checked that its Synth destination has
 * the same origin. A new tab shares localStorage; sessionStorage is not relied
 * upon because a noopener tab does not inherit its opener's session storage.
 * Dispose removes only this still-unmodified entry if navigation is cancelled.
 */
export function prepareSidPresetHandoff(preset, {storage, now = Date.now, token} = {}) {
  const normalized = readPreset(preset), createdAt = timeValue(now);
  const value = JSON.stringify({format: 'tetorica-sid-preset-handoff', version: 1, createdAt, preset: normalized});
  checkSize(value);
  token ??= randomToken();
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw new TypeError('Invalid SID preset transfer token');
  const key = prefix + token;
  try {
    storage ??= globalThis.localStorage;
    if (!storage || storage.getItem(key) !== null) throw new Error('SID preset transfer token already exists');
    storage.setItem(key, value);
  } catch (error) {
    if (error?.message === 'SID preset transfer token already exists') throw error;
    throw new Error(storageMessage);
  }
  let disposed = false;
  return {fragment: '#' + SID_PRESET_HANDOFF_PARAMETER + '=' + encodeURIComponent(token), dispose() {
    if (disposed) return;
    disposed = true;
    try {if (storage.getItem(key) === value) storage.removeItem(key);} catch {}
  }};
}

/** Consume only an explicit URL token. Missing/invalid/expired data rejects
 * before the Synth changes a preset. An addressed entry is single-use, even
 * when its envelope is invalid; all unrelated localStorage keys stay intact.
 * No token is an ordinary Synth visit and requires no storage access.
 */
export function consumeSidPresetHandoff(fragment, {storage, now = Date.now} = {}) {
  const token = requestedToken(fragment);
  if (token === null) return null;
  const key = prefix + token;
  let value;
  try {
    storage ??= globalThis.localStorage;
    if (!storage) throw new Error('No storage');
    value = storage.getItem(key);
    // Delete before parsing so malformed and oversized requested data cannot
    // repeatedly poison a normal page reload. No other key is inspected.
    storage.removeItem(key);
  } catch {throw new Error(storageMessage);}
  if (value === null) throw new Error('SID preset transfer was already used or is unavailable. Save and load the preset instead.');
  checkSize(value);
  let envelope;
  try {envelope = JSON.parse(value);} catch {throw new TypeError('Invalid SID preset transfer JSON');}
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || Object.keys(envelope).sort().join(',') !== 'createdAt,format,preset,version'
      || envelope.format !== 'tetorica-sid-preset-handoff' || envelope.version !== 1) {
    throw new TypeError('Invalid SID preset transfer envelope');
  }
  const current = timeValue(now), createdAt = envelope.createdAt;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || createdAt > current
      || current - createdAt > SID_PRESET_HANDOFF_TTL_MS) {
    throw new RangeError('SID preset transfer expired or has an invalid timestamp. Capture the voice again.');
  }
  return readPreset(envelope.preset);
}

/** Preserve unrelated hash components, including their original encoding. */
export function stripSidPresetHandoffFragment(fragment) {
  if (typeof fragment !== 'string') throw new TypeError('SID preset transfer fragment must be a string');
  const body = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  const remaining = body.split('&').filter(part => !new URLSearchParams(part).has(SID_PRESET_HANDOFF_PARAMETER)).join('&');
  return remaining ? '#' + remaining : '';
}
