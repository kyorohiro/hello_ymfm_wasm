import {extractSbiPatches, snapshotSbiPatches, exportSbiZip, SBI_NOTICE} from './sbi_export.js';

export function mountSbiExports({getTrack, setStatus}) {
  const dialog = document.createElement('dialog');
  dialog.ariaLabel = 'SBI voices';
  dialog.innerHTML = `<form method="dialog">
    <h3>SBI voices</h3>
    <p class="sbi-notice"></p>
    <p><label>Voice <select aria-label="SBI voice"></select></label></p>
    <button type="button" class="sbi-download">Download SBI</button>
    <button value="close">Close</button>
  </form>`;
  dialog.style.maxWidth = 'min(40rem, 90vw)';
  dialog.querySelector('.sbi-notice').textContent = SBI_NOTICE;
  document.body.append(dialog);
  let patches = [];
  const select = dialog.querySelector('select');
  select.style.maxWidth = '100%';
  function download(data, name, type = 'application/octet-stream') {
    const url = URL.createObjectURL(new Blob([data], {type}));
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function open(snapshot) {
    const track = getTrack();
    if (!track.buffer) return;
    try {
      patches = snapshot ? snapshotSbiPatches(track.buffer, track.atSample) : extractSbiPatches(track.buffer);
      if (!patches.length) { setStatus('No melodic OPL voices available for SBI export.'); return; }
      dialog.querySelector('h3').textContent = snapshot ? 'Snapshot SBI' : 'Extracted SBI voices';
      select.replaceChildren(...patches.map((p, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${p.name} · ${p.fourOp ? '4op' : '2op'} · ${(p.sample/44100).toFixed(3)} s`;
        return option;
      }));
      dialog.showModal();
    } catch (error) { setStatus(`SBI export failed: ${error.message}`); }
  }
  dialog.querySelector('.sbi-download').addEventListener('click', () => {
    const patch = patches[Number(select.value)];
    if (!patch) return;
    download(patch.data, patch.name);
    setStatus(`Exported ${patch.name}. ${SBI_NOTICE}`);
  });
  document.getElementById('exportSbiButton').addEventListener('click', () => open(false));
  document.getElementById('exportSnapshotSbiButton').addEventListener('click', () => open(true));
  document.getElementById('exportAllSbiButton').addEventListener('click', () => {
    const track = getTrack();
    if (!track.buffer) return;
    try {
      const result = exportSbiZip(track.buffer);
      download(result.bytes, 'all_sbi_patches.zip', 'application/zip');
      setStatus(`Exported ${result.count} SBI voices. ${SBI_NOTICE}`);
    } catch (error) { setStatus(`SBI export failed: ${error.message}`); }
  });
}
