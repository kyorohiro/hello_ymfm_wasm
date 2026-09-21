import {groupSelectedScoreChannels} from './score_groups.js';
import {getScoreGroups} from './score_group_ui.js';
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
  const panel = $('sheetMusicPanel');
  let target = preview, panelSource;
  const renderers = new Map();
  let source, analysis, fileName, generation = 0;
  preview.addEventListener('close', () => { if (target === preview) generation++; });
  function openSettings(destination) {
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
      target = destination; settings.showModal();
    } catch(e) { setStatus(`Music sheet analysis failed: ${e.message}`); }
  }
  $('exportMusicSheetButton').addEventListener('click', () => openSettings(preview));
  $('showSheetMusicButton').addEventListener('click', () => openSettings(panel));
  settings.querySelector('form').addEventListener('submit', async event => {
    const action = event.submitter?.value;
    if (!['preview','export'].includes(action)) return;
    event.preventDefault();
    if (!bpm.reportValidity()) return;
    try {
      if (!analysis || source !== getTrack().buffer) throw new Error('Reopen Export Music Sheet for the current track');
      const selected = new Set([...list.querySelectorAll('input:checked')].map(i => Number(i.value)));
      const result = createMusicXmlScore(groupSelectedScoreChannels(analysis.channels, analysis.channels.filter((_,i) => selected.has(i)), getScoreGroups(source)), analysis.time,
        {bpm:Number(bpm.value), fileName, warnings:analysis.warnings});
      if (action === 'export') {
        const url = URL.createObjectURL(new Blob([result.text], {type:'application/vnd.recordare.musicxml+xml'}));
        const a = document.createElement('a'); a.href = url; a.download = (fileName.replace(/\.[^.]+$/, '') || 'analysis') + '.musicxml'; a.click();
        setTimeout(() => URL.revokeObjectURL(url),1000); settings.close();
        setStatus(`Exported MusicXML: ${result.noteCount} notes, ${result.skippedNotes} omitted intervals.`); return;
      }
      settings.close(); const job = ++generation;
      const container = target, trackSource = source;
      const status = container.querySelector('[data-status]'), pages = container.querySelector('[data-pages]');
      renderers.get(container)?.clear(); renderers.delete(container); pages.replaceChildren();
      if (container === panel) panelSource = source;
      const active = () => job === generation && trackSource === getTrack().buffer && (container !== preview || preview.open);
      status.textContent = 'Loading music sheet…'; if (container === preview) preview.showModal();
      container.querySelector('[data-notices]').textContent = result.warnings.join('\n');
      try {
        const library = await loadRenderer(); if (!active()) return;
        const renderer = new library.OpenSheetMusicDisplay(pages, {autoResize:false, backend:'svg', autoBeam:true, autoBeamOptions:{groups:[[1,4]]}});
        await renderer.load(result.text); if (!active()) return;
        renderers.set(container, renderer);
        if (container !== panel || !panel.hidden) renderer.render(); status.textContent = `${result.noteCount} notes · ${result.skippedNotes} omitted intervals`;
      } catch(e) { if (active()) status.textContent = `Preview failed: ${e.message}. MusicXML export is still available.`; }
    } catch(e) { setStatus(`Music sheet export failed: ${e.message}`); }
  });
  return {setVisible(visible) {
    if (visible) renderers.get(panel)?.render();
  }, updateTrack() {
    if (source && source !== getTrack().buffer) {
      generation++;
      if (preview.open) preview.close();
      if (settings.open) settings.close();
      source = undefined;
    }
    if (panelSource && panelSource !== getTrack().buffer) {
      renderers.get(panel)?.clear(); renderers.delete(panel);
      panel.querySelector('[data-pages]').replaceChildren();
      panel.querySelector('[data-notices]').textContent = '';
      panel.querySelector('[data-status]').textContent = 'Press Show Sheet Music to generate the current track.';
      panelSource = undefined;
    }
  }};
}
