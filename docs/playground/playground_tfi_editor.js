import { createPlaygroundOperatorTab } from './playground_operator_tab.js?v=chip-tabs-2';
import { createPlaygroundOperatorKeyboard } from './playground_operator_keyboard.js?v=keyboard-controls-minimize-1';
import { createTfiFromPreset, parseTfi } from '../js/tfi.js';
import { createVgiFromPreset, parseVgi } from '../js/vgi.js';

export function tfiToEditorPreset(bytes) {
  const preset = parseTfi(bytes);
  return { ...preset, operators: [1, 2, 3, 4].map(op => preset.operators[op]) };
}

/** Load either file format into the operator editor's zero-based preset array. */
export function instrumentToEditorPreset(path, bytes) {
  // Existing Synth imports can contain renamed files. The exact binary size
  // determines their real format; a name change must not discard VGI data.
  const preset = (bytes.byteLength ?? bytes.length) === 43 ? parseVgi(bytes) : parseTfi(bytes);
  return { ...preset, operators: [1, 2, 3, 4].map(op => preset.operators[op]) };
}

/** Save the editor's one-based operator state without changing the file format. */
export function createInstrumentFromEditorPreset(path, preset, originalB4 = preset?.b4 ?? 0, format = /\.vgi$/i.test(path) ? 'vgi' : 'tfi') {
  if (format !== 'vgi') return createTfiFromPreset(preset);
  const { b4, ...editable } = preset;
  const bytes = createVgiFromPreset(editable);
  // Bit 3 has no editor control, but a loaded VGI may contain it. Rebuild the
  // editable pan/AMS/PMS bits and preserve only this otherwise unused bit.
  bytes[2] |= originalB4 & 0x08;
  return bytes;
}

export function createTfiFileEditor({ root, operatorRoot, keyboardRoot, title, createAudio, onSave, onStatus, savedLabel, clock = 7670454, clockDivider = 144, minimizableKeyboard = false }) {
  const presets = {};
  let path = null;
  let loading = false;
  let audio = null;
  let readyPromise = null;
  let disposed = false;
  let volume = 1;
  let originalB4 = 0;
  let format = 'tfi';
  const operator = createPlaygroundOperatorTab({
    root: operatorRoot, presets, presetOrder: [], channelCount: 1,
    idPrefix: 'file-', onStatus,
    onEdit() {
      if (loading || !path) return;
      onSave(path, createInstrumentFromEditorPreset(path, operator.getChannelPreset(0), originalB4, format));
      title.textContent = savedLabel?.(path) ?? `${path} · Saved`;
    },
  });
  const keyboard = createPlaygroundOperatorKeyboard({
    root: keyboardRoot, channelCount: 1, getSelectedChannel: () => 0,
    getClock: () => (audio?.fm?.fm ?? audio?.fm)?.clock ?? clock,
    clockDivider,
    idPrefix: 'file-', onStatus,
    minimizeHost: minimizableKeyboard ? keyboardRoot : null,
    onControlsMinimizedChange: minimized => root.classList.toggle('keyboard-controls-minimized', minimized),
    async ensureAudioReady() {
      if (!readyPromise) {
        audio ??= createAudio();
        readyPromise = (async () => {
          await audio.start();
          if (disposed) return;
          audio.setMasterVolume(volume);
          operator.attachSynth(audio.fm);
          keyboard.attachSynth(audio.fm);
        })().catch(error => { readyPromise = null; throw error; });
      }
      await readyPromise;
      if (!disposed) await audio.resume();
    },
  });
  return {
    open(nextPath, bytes) {
      const preset = instrumentToEditorPreset(nextPath, bytes);
      keyboard.setView('code');
      loading = true;
      try {
        presets.file = preset;
        operator.selectPreset(0, 'file');
        path = nextPath;
        originalB4 = preset.b4 ?? 0;
        format = (bytes.byteLength ?? bytes.length) === 43 ? 'vgi' : 'tfi';
        title.textContent = nextPath;
        root.hidden = false;
        operator.setVisible?.(true);
        keyboard.setView('operator');
      } finally { loading = false; }
    },
    setVisible(visible) {
      root.hidden = !visible;
      operator.setVisible?.(visible);
      keyboard.setView(visible ? 'operator' : 'code');
    },
    setMasterVolume(nextVolume) {
      volume = nextVolume;
      audio?.setMasterVolume(volume);
    },
    // Observe the existing preview without starting audio or changing its routing.
    getAudioRuntime() {
      return disposed ? null : audio?.audio ?? null;
    },
    dispose() {
      disposed = true;
      operator.dispose?.();
      keyboard.dispose();
      return audio?.close();
    },
  };
}
