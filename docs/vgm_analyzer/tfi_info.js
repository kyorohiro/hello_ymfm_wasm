import { createTfiFileEditor } from '../playground/playground_tfi_editor.js';
import { createVgmPresetFiles } from '../playground/playground_vgm_presets.js';
import { parseTfi } from '../js/tfi.js';
import { MegaSynth } from '../js/megasynth.js';

export function mountTfiInfo({ root, onStatus, onAudition }) {
  root.innerHTML = `
    <div class="tfi-info-toolbar">
      <label>TFI file <input type="file" accept=".tfi" multiple></label>
      <select aria-label="TFI instrument"><option value="">Choose a TFI file</option></select>
      <button type="button" disabled>Download TFI</button>
      <label>Audition volume <input class="tfi-volume" type="range" min="0" max="380" value="100" step="1"><output>100%</output></label>
    </div>
    <p>Choose an extracted instrument or open a TFI file. Edits stay in this tab until you download them.</p>
    <section class="tfi-info-editor" hidden><p class="tfi-title"></p><div class="tfi-operators"></div></section>
    <div class="tfi-info-keyboard" hidden></div>`;
  const select = root.querySelector('select');
  const input = root.querySelector('input[type="file"]');
  const download = root.querySelector('button');
  const files = new Map();
  let selected = null;
  let visible = false;
  let serial = 0;
  const editor = createTfiFileEditor({
    root: root.querySelector('.tfi-info-editor'),
    operatorRoot: root.querySelector('.tfi-operators'),
    keyboardRoot: root.querySelector('.tfi-info-keyboard'),
    title: root.querySelector('.tfi-title'), onStatus,
    createAudio() {
      onAudition?.();
      return new MegaSynth({
        workletUrl: '../js/ym2612-worklet.js',
        ym2612WasmUrl: '../generated/ym2612_wasm.wasm', segaPsgWasmUrl: null,
      });
    },
    onSave(id, data) { files.get(id).data = data; },
    savedLabel: id => `${files.get(id).name} · Edited (download to save)`,
  });
  const volume = root.querySelector('.tfi-volume');
  volume.addEventListener('input', () => {
    editor.setMasterVolume(Number(volume.value) / 100);
    root.querySelector('output').textContent = `${volume.value}%`;
  });
  function add(name, data) {
    const id = String(++serial);
    files.set(id, { name, data });
    const option = document.createElement('option');
    option.value = id; option.textContent = name;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    selected = select.value || null;
    if (selected) {
      const file = files.get(selected);
      editor.open(selected, file.data);
      root.querySelector('.tfi-title').textContent = file.name;
    }
    editor.setVisible(visible && Boolean(selected));
    download.disabled = !selected;
    select.blur();
  });
  input.addEventListener('change', async () => {
    for (const file of input.files ?? []) {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        parseTfi(data);
        add(file.name, data);
      } catch (error) { onStatus(`Could not open ${file.name}: ${error.message}`); }
    }
    input.value = '';
    input.blur();
  });
  download.addEventListener('click', () => {
    const file = files.get(selected);
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.data], { type: 'application/octet-stream' }));
    const link = document.createElement('a'); link.href = url;
    link.download = file.name.split('/').pop(); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    download.blur();
  });
  return {
    loadVgm(buffer, name) {
      const extracted = createVgmPresetFiles(buffer, name);
      editor.setVisible(false);
      selected = null; files.clear();
      select.replaceChildren();
      const empty = document.createElement('option'); empty.value = '';
      empty.textContent = extracted.length ? 'Choose an extracted TFI' : 'No FM instruments — open a TFI file';
      select.appendChild(empty);
      for (const file of extracted) add(file.path.replace(/^\/presets\//, ''), file.data);
      download.disabled = true;
    },
    setVisible(value) {
      visible = value; root.hidden = !value;
      editor.setVisible(value && Boolean(selected));
    },
    dispose: () => editor.dispose(),
  };
}
