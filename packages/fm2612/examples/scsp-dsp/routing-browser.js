// SPDX-License-Identifier: BSD-3-Clause
// Unpublished source-build example. Audio starts only from the button below.
import {createScspAudio} from 'tetorica-fm2612/playground_scsp_audio.js';
import {createScspClient} from 'tetorica-fm2612/playground_scsp.js';
import {assembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

const dspSource = `; MIXS0 -> Gain -> EFREG0; MIXS1 -> IIR -> EFREG1.
000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
002: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
003: XSEL=1 YSEL=1 IRA=33 BSEL=1 COEF=2
004: TWT=1 TWA=0 EWT=1 EWA=1 ZERO=1
`;
const startButton = document.getElementById('start'), stopButton = document.getElementById('stop');
const gain = document.getElementById('gain'), history = document.getElementById('history');
const leftEnabled = document.getElementById('leftEnabled'), rightEnabled = document.getElementById('rightEnabled');
const status = document.getElementById('status'), snapshot = document.getElementById('snapshot');
document.getElementById('source').textContent = dspSource;
let session = null, changing = false, edits = Promise.resolve();

function showStatus(state, text) {status.dataset.state = state; status.textContent = text;}
function updateControls() {
  startButton.disabled = changing || !!session; stopButton.disabled = changing || !session;
  for (const control of [gain, history, leftEnabled, rightEnabled]) control.disabled = changing;
  document.getElementById('gainValue').value = gain.value;
  document.getElementById('historyValue').value = history.value;
}
function coefficients() {const a = Number(history.value); return {0: Number(gain.value), 1: a, 2: 4096 - a};}
async function showSnapshot(target) {
  const [program, state] = await Promise.all([target.chip.getDspProgram(), target.chip.getState()]);
  if (session !== target) return;
  snapshot.textContent = JSON.stringify({profile: program.profile, revision: program.revision,
    coefficients: program.coefficients, returns: program.returns, legacyReturn: program.return,
    slots: state.slots.slice(0, 2).map((slot, index) => ({slot: index,
      dspInput: slot.dspInput ?? 0, dspSend: slot.dspSend, gate: slot.gate,
      sampleId: slot.sample?.id})), ramUsedBytes: state.ramUsedBytes}, null, 2);
}
async function dispose(target) {
  if (!target) return;
  target.disposePromise ??= (async () => {
    target.output.gain.value = 0; target.chip?.dispose(); target.endpoint?.dispose();
    if (target.context.state !== 'closed') await target.context.close();
  })();
  return target.disposePromise;
}
async function start() {
  if (changing || session) return;
  changing = true; showStatus('starting', 'Loading the SCSP audio owner…'); updateControls();
  let target;
  try {
    const context = new AudioContext(), output = context.createGain();
    output.gain.value = 0.2; output.connect(context.destination);
    target = {context, output, endpoint: null, chip: null}; session = target;
    await context.resume();
    target.endpoint = await createScspAudio(context, output, {onError: error => {
      if (session !== target) return;
      session = null;
      void dispose(target).then(() => {if (!session) {changing = false; showStatus('error', error.message); updateControls();}});
    }});
    target.chip = createScspClient(target.endpoint.port, target.endpoint);
    await target.chip.applyDspProgram(assembleScspDsp(dspSource), {coefficients: coefficients()});
    const pcm = Int16Array.from({length: 64}, (_, i) => Math.round(4096 * (2 * i / 64 - 1)));
    const sample = await target.chip.loadPCM(pcm, {baseFrequencyHz: 44100 / 64, loopStartSamples: 0});
    for (const channel of [0, 1]) target.chip.setPreset(channel, {sample,
      totalLevel: 12, directLevel: 0, dspSend: 7, dspInput: channel,
      envelope: {attackRate: 31, releaseRate: 24}});
    await target.chip.setDspReturn(0, {level: leftEnabled.checked ? 7 : 0, pan: 31});
    await target.chip.setDspReturn(1, {level: rightEnabled.checked ? 7 : 0, pan: 15});
    if (session !== target) throw new DOMException('Audio session ended', 'AbortError');
    target.chip.noteOn(0, 'A3'); target.chip.noteOn(1, 'A3');
    await showSnapshot(target); showStatus('playing', 'Gain left · IIR right. Both notes remain held.');
  } catch (error) {
    if (session === target) session = null;
    await dispose(target); if (!session) showStatus('error', error.message);
  } finally {if (!session || session === target) {changing = false; updateControls();}}
}
async function stop() {
  if (changing || !session) return;
  changing = true; const previous = session; session = null;
  showStatus('stopping', 'Stopping audio…'); updateControls();
  try {await dispose(previous); showStatus('idle', 'Stopped. Start audio to compare again.');}
  catch (error) {showStatus('error', error.message);}
  finally {changing = false; updateControls();}
}
function enqueue(change) {
  const target = session; if (!target || changing) return;
  edits = edits.then(async () => {
    if (session !== target) return;
    await change(target.chip); await showSnapshot(target);
    if (session === target) showStatus('playing', 'Routing applied. Both notes remain held.');
  }).catch(error => {if (session === target) showStatus('error', error.message);});
}
for (const control of [gain, history]) control.addEventListener('input', () => {
  updateControls(); const patch = coefficients(); enqueue(chip => chip.setDspCoefficients(patch));
});
for (const [control, output] of [[leftEnabled, 0], [rightEnabled, 1]]) control.addEventListener('change', () => {
  const level = control.checked ? 7 : 0; enqueue(chip => chip.setDspReturn(output, {level}));
});
startButton.addEventListener('click', () => void start()); stopButton.addEventListener('click', () => void stop());
window.addEventListener('pagehide', () => {const previous = session; session = null; void dispose(previous);});
updateControls();
