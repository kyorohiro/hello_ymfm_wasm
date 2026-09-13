import { createPlaygroundOperatorTab } from './playground_operator_tab.js';
import { createPlaygroundOperatorKeyboard } from './playground_operator_keyboard.js';
import { createTfiFromPreset, parseTfi } from '../js/tfi.js';

export function tfiToEditorPreset(bytes) {
  const preset = parseTfi(bytes);
  return { ...preset, operators: [1, 2, 3, 4].map(op => preset.operators[op]) };
}

export function createTfiFileEditor({ root, operatorRoot, keyboardRoot, title, createAudio, onSave, onStatus }) {
  const presets = {};
  let path = null;
  let loading = false;
  let audio = null;
  let readyPromise = null;
  let disposed = false;
  let volume = 1;
  const operator = createPlaygroundOperatorTab({
    root: operatorRoot, presets, presetOrder: [], channelCount: 1,
    idPrefix: 'file-', onStatus,
    onEdit() {
      if (loading || !path) return;
      onSave(path, createTfiFromPreset(operator.getChannelPreset(0)));
      title.textContent = `${path} · Saved`;
    },
  });
  const keyboard = createPlaygroundOperatorKeyboard({
    root: keyboardRoot, channelCount: 1, getSelectedChannel: () => 0,
    idPrefix: 'file-', onStatus,
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
      const preset = tfiToEditorPreset(bytes);
      keyboard.setView('code');
      loading = true;
      try {
        presets.file = preset;
        operator.selectPreset(0, 'file');
        path = nextPath;
        title.textContent = nextPath;
        root.hidden = false;
        keyboard.setView('operator');
      } finally { loading = false; }
    },
    setVisible(visible) {
      root.hidden = !visible;
      keyboard.setView(visible ? 'operator' : 'code');
    },
    setMasterVolume(nextVolume) {
      volume = nextVolume;
      audio?.setMasterVolume(volume);
    },
    dispose() {
      disposed = true;
      keyboard.dispose();
      return audio?.close();
    },
  };
}
