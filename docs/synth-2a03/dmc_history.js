// SPDX-License-Identifier: BSD-3-Clause
import {MAX_DPCM_BYTES} from './preset.js';

function copyBytes(value) {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) throw new TypeError('DPCM: expected an array of bytes');
  if (value.length > MAX_DPCM_BYTES || Reflect.ownKeys(value).length !== value.length + (Array.isArray(value) ? 1 : 0)) throw new RangeError(`DPCM: expected 0–${MAX_DPCM_BYTES} dense bytes`);
  const data = [];
  for (let index = 0; index < value.length; index++) {
    const byte = value[index];
    if (!Object.hasOwn(value,index) || !Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError('DPCM: expected dense bytes from 0 to 255');
    data.push(byte);
  }
  return data;
}

/** Bounded, detached snapshots of DPCM bytes. Parameters and generated padding
 * stay outside this history. A new edit removes the redo branch; an identical
 * edit keeps it. The byte limit counts every retained snapshot, including the
 * current one, so it must allow at least one maximum-length DPCM sample.
 * @param {{maxSteps?:number,maxBytes?:number}} [options]
 */
export function createDmcHistory({maxSteps = 64, maxBytes = 256 * 1024} = {}) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) throw new RangeError('DMC history maxSteps must be a nonnegative safe integer');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MAX_DPCM_BYTES) throw new RangeError(`DMC history maxBytes must be a safe integer of at least ${MAX_DPCM_BYTES}`);
  let snapshots = [[]], cursor = 0, bytes = 0;
  return {
    /** Replace the baseline and forget both directions, even for equal data. */
    reset(value) {
      const data = copyBytes(value);
      snapshots = [data]; cursor = 0; bytes = data.length;
    },
    /** Commit a changed edit. Unchanged or rejected edits preserve history. */
    push(value) {
      const data = copyBytes(value), current = snapshots[cursor];
      if (data.length === current.length && data.every((byte,index) => byte === current[index])) return false;
      for (let index = cursor + 1; index < snapshots.length; index++) bytes -= snapshots[index].length;
      snapshots.length = cursor + 1;
      snapshots.push(data); cursor++; bytes += data.length;
      while (cursor > maxSteps || bytes > maxBytes) {
        bytes -= snapshots.shift().length; cursor--;
      }
      return true;
    },
    undo() {
      if (cursor === 0) return null;
      return snapshots[--cursor].slice();
    },
    redo() {
      if (cursor === snapshots.length - 1) return null;
      return snapshots[++cursor].slice();
    },
    read() {
      return {canUndo:cursor > 0, canRedo:cursor < snapshots.length - 1, undoCount:cursor, redoCount:snapshots.length - cursor - 1, bytes};
    },
  };
}
