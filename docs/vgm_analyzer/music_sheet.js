import {createMusicXmlScore} from './vgm_musicxml.js';
let rendererLoading;
function loadRenderer() {
  if (globalThis.opensheetmusicdisplay) return Promise.resolve(globalThis.opensheetmusicdisplay);
  if (!rendererLoading) rendererLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/osmd/opensheetmusicdisplay.min.js', import.meta.url).href;
    script.onload = () => {
      if (globalThis.opensheetmusicdisplay) resolve(globalThis.opensheetmusicdisplay);
      else { rendererLoading = null; script.remove(); reject(new Error('Music sheet renderer did not initialize')); }
    };
    script.onerror = () => { rendererLoading = null; script.remove(); reject(new Error('Could not load music sheet renderer. Please retry.')); };
    document.head.append(script);
  });
  return rendererLoading;
}
export function mountMusicSheet({getTrack, tempoSettings, setStatus}) {
  const $ = id => document.getElementById(id);
  const settings = $('musicSheetExportDialog'), preview = $('musicSheetPreviewDialog');
  const bpm = $('musicSheetBpmInput'), list = $('musicSheetChannels');
  const status = preview.querySelector('[data-status]'), pages = preview.querySelector('[data-pages]');
  let source, analysis, fileName, renderer, generation = 0;
  preview.addEventListener('close', () => { generation++; });
  $('exportMusicSheetButton').addEventListener('click', () => {
    const track = getTrack(); if (!track.buffer || !track.available) return;
    try {
      if (source !== track.buffer) {
        analysis = tempoSettings.getAnalysis(track.buffer);
        tempoSettings.prepare(track.buffer, bpm, $('musicSheetTempoHelp'));
        source = track.buffer; fileName = track.fileName;
        list.replaceChildren();
        analysis.channels.forEach((ch, i) => {
          const count = ch.notes.filter(n => Number.isFinite(n.midi) && n.end > n.start).length;
          const input = document.createElement('input'); input.type = 'checkbox'; input.value = i; input.checked = count > 0;
          const label = document.createElement('label'); label.style.display = 'block';
          label.append(input, document.createTextNode(` ${ch.name} (${count} pitch intervals)`)); list.append(label);
        });
      }
      settings.showModal();
    } catch(e) { setStatus(`Music sheet analysis failed: ${e.message}`); }
  });
  settings.querySelector('form').addEventListener('submit', async event => {
    const action = event.submitter?.value;
    if (!['preview','export'].includes(action)) return;
    event.preventDefault();
    if (!bpm.reportValidity()) return;
    try {
      if (!analysis || source !== getTrack().buffer) throw new Error('Reopen Export Music Sheet for the current track');
      const selected = new Set([...list.querySelectorAll('input:checked')].map(i => Number(i.value)));
      const result = createMusicXmlScore(analysis.channels.filter((_,i) => selected.has(i)), analysis.time,
        {bpm:Number(bpm.value), fileName, warnings:analysis.warnings});
      if (action === 'export') {
        const url = URL.createObjectURL(new Blob([result.text], {type:'application/vnd.recordare.musicxml+xml'}));
        const a = document.createElement('a'); a.href = url; a.download = (fileName.replace(/\.[^.]+$/, '') || 'analysis') + '.musicxml'; a.click();
        setTimeout(() => URL.revokeObjectURL(url),1000); settings.close();
        setStatus(`Exported MusicXML: ${result.noteCount} notes, ${result.skippedNotes} omitted intervals.`); return;
      }
      settings.close(); const job = ++generation;
      renderer?.clear(); pages.replaceChildren(); renderer = null;
      status.textContent = 'Loading music sheet…'; preview.showModal();
      preview.querySelector('[data-notices]').textContent = result.warnings.join('\n');
      try {
        const library = await loadRenderer(); if (job !== generation || !preview.open) return;
        renderer = new library.OpenSheetMusicDisplay(pages, {autoResize:false, backend:'svg', autoBeam:true, autoBeamOptions:{groups:[[1,4]]}});
        await renderer.load(result.text); if (job !== generation || !preview.open) return;
        renderer.render(); status.textContent = `${result.noteCount} notes · ${result.skippedNotes} omitted intervals`;
      } catch(e) { if (job === generation && preview.open) status.textContent = `Preview failed: ${e.message}. MusicXML export is still available.`; }
    } catch(e) { setStatus(`Music sheet export failed: ${e.message}`); }
  });
}
