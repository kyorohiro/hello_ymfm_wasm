// SPDX-License-Identifier: BSD-3-Clause
import {readPreset} from './preset.js';

// A file describes the author sound, while physical channels may have their
// own session edits. Accept only the fields changed in that document; do not
// copy its unchanged values over those channel settings or Code's live state.
export function applyGameboyDocumentChanges(current, previous, next) {
  const result = readPreset(current), before = readPreset(previous), after = readPreset(next);
  function merge(target, old, value) {
    for (const key of Object.keys(value)) {
      if (Array.isArray(value[key])) {
        if (JSON.stringify(old[key]) !== JSON.stringify(value[key])) target[key] = value[key].slice();
      } else if (value[key] && typeof value[key] === 'object') merge(target[key], old[key], value[key]);
      else if (old[key] !== value[key]) target[key] = value[key];
    }
  }
  merge(result, before, after);
  return readPreset(result);
}
