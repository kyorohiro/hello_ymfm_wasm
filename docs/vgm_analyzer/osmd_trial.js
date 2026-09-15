import {analyzeLilyPondSource} from './vgm_lilypond.js';
import {maybeDecodeVgmFile} from '../js/vgm_file.js';
import {createMusicXmlScore} from './vgm_musicxml.js';
const $ = id => document.getElementById(id);
let analysis, fileName = 'Sample notes', display;
function busy(value) {
  for (const id of ['file','demo','bpm','render','download']) $(id).disabled = value || (!analysis && ['render','download'].includes(id));
  for (const input of $('channels').querySelectorAll('input')) input.disabled = value;
}
function prepare(value, name) {
  analysis = value; fileName = name; $('bpm').value = value.tempo?.bpm ?? 120;
  $('tempo').textContent = value.tempo?.estimated ? `Suggested ${value.tempo.bpm} BPM; adjust if needed.` : 'Default 120 BPM; adjust if needed.';
  $('channels').replaceChildren();
  value.channels.forEach((ch,i) => {
    const count = ch.notes.filter(n => Number.isFinite(n.midi) && n.end > n.start).length;
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = i; input.checked = count > 0;
    const label = document.createElement('label'); label.append(input, document.createTextNode(` ${ch.name} (${count} pitch intervals)`)); $('channels').append(label);
  });
  busy(false);
}
function score() {
  const indices = new Set([...$('channels').querySelectorAll('input:checked')].map(i => Number(i.value)));
  return createMusicXmlScore(analysis.channels.filter((_,i) => indices.has(i)), analysis.time, {bpm:Number($('bpm').value), fileName, warnings:analysis.warnings});
}
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; if (!file) return;
  analysis = null; busy(true); display?.clear(); $('warnings').textContent = ''; $('status').textContent = 'Reading notes…';
  try { prepare(analyzeLilyPondSource(await maybeDecodeVgmFile(await file.arrayBuffer())), file.name); $('status').textContent = 'Ready. Select channels and press Preview.'; }
  catch (e) { $('status').textContent = `Could not read file: ${e.message}`; }
  finally { busy(false); }
});
$('demo').addEventListener('click', () => {
  const n = (a,b,midi,key) => ({start:a*5512.5,end:b*5512.5,midi,key});
  prepare({time:32*5512.5,warnings:[],channels:[{name:'Melody',notes:[n(0,4,60,1),n(4,8,64,2),n(8,20,67,3),n(20,24,67,4),n(24,28,66,5)]},{name:'Bass',notes:[n(0,16,36,1),n(16,32,43,2)]}]}, 'Sample notes');
  $('controls').requestSubmit();
});
$('controls').addEventListener('submit', async event => {
  event.preventDefault(); if (!analysis) return;
  busy(true); $('status').textContent = 'Rendering…';
  try {
    const result = score(); $('warnings').textContent = result.warnings.join('\n');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!globalThis.opensheetmusicdisplay) throw new Error('Could not load OpenSheetMusicDisplay. Reload the page.');
    display ??= new globalThis.opensheetmusicdisplay.OpenSheetMusicDisplay($('score'), {autoResize:true, backend:'svg', autoBeam:true, autoBeamOptions:{groups:[[1,4]]}, drawingParameters:'default'});
    const start = performance.now(); await display.load(result.text); display.render();
    $('status').textContent = `${result.noteCount} notes · ${result.skippedNotes} omitted intervals · ${((performance.now()-start)/1000).toFixed(2)} s`;
  } catch(e) { display?.clear(); $('status').textContent = `Preview failed: ${e.message}`; }
  finally { busy(false); }
});
$('download').addEventListener('click', () => {
  if (!analysis || !$('bpm').reportValidity()) return;
  try {
    const result = score(), url = URL.createObjectURL(new Blob([result.text], {type:'application/vnd.recordare.musicxml+xml'}));
    const a = document.createElement('a'); a.href = url; a.download = fileName.replace(/\.[^.]+$/, '') + '.musicxml'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  } catch(e) { $('status').textContent = e.message; }
});
