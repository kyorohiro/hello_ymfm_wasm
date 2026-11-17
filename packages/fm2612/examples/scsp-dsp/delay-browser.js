// SPDX-License-Identifier: BSD-3-Clause
// Installed-package example (0.2.44+). A button explicitly starts audio.
import {createScspAudio} from 'tetorica-fm2612/playground_scsp_audio.js';
import {createScspClient} from 'tetorica-fm2612/playground_scsp.js';
import {disassembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const noteOnButton = document.getElementById('noteOn');
const noteOffButton = document.getElementById('noteOff');
const enabled = document.getElementById('enabled');
const time = document.getElementById('time');
const feedback = document.getElementById('feedback');
const status = document.getElementById('status');
const source = document.getElementById('source');
const snapshot = document.getElementById('snapshot');
let session = null;
let changing = false;
let edits = Promise.resolve();

function showStatus(state, text) {
  status.dataset.state = state;
  status.textContent = text;
}
function updateControls() {
  startButton.disabled = changing || !!session;
  stopButton.disabled = changing || !session;
  noteOnButton.disabled = changing || !session;
  noteOffButton.disabled = changing || !session;
  for (const control of [enabled, time, feedback]) control.disabled = changing;
  document.getElementById('timeValue').value = `${time.value} ms`;
  document.getElementById('feedbackValue').value = `${feedback.value} / 4096`;
}
function settings() {
  return {enabled: enabled.checked, timeMs: Number(time.value), feedback: Number(feedback.value) / 4096};
}
async function showSnapshot(target) {
  const setup = await target.chip.getDspProgram();
  if (session !== target) return;
  source.textContent = disassembleScspDsp(setup.words);
  snapshot.textContent = JSON.stringify({profile: setup.profile, revision: setup.revision,
    delay: setup.delay, ram: setup.ram, coefficients: setup.coefficients,
    return: setup.return, wordCount: setup.words.length}, null, 2);
}
async function dispose(target) {
  if (!target) return;
  target.disposePromise ??= (async () => {
    target.output.gain.value = 0;
    target.chip?.dispose();
    target.endpoint?.dispose();
    if (target.context.state !== 'closed') await target.context.close();
  })();
  return target.disposePromise;
}
async function start() {
  if (changing || session) return;
  changing = true;
  showStatus('starting', 'Loading the SCSP audio owner…');
  updateControls();
  let target;
  try {
    const context = new AudioContext();
    const output = context.createGain();
    output.gain.value = 0.2;
    output.connect(context.destination);
    target = {context, output, chip: null, endpoint: null};
    session = target;
    await context.resume();
    target.endpoint = await createScspAudio(context, output, {onError: error => {
      if (session !== target) return;
      session = null;
      void dispose(target).then(() => {
        if (session) return;
        changing = false;
        showStatus('error', error.message);
        updateControls();
      });
    }});
    target.chip = createScspClient(target.endpoint.port, target.endpoint);
    const pcm = Int16Array.from({length: 64}, (_, i) => Math.round(4096 * Math.sin(2 * Math.PI * i / 64)));
    const sample = await target.chip.loadPCM(pcm, {baseFrequencyHz: 44100 / 64, loopStartSamples: 0});
    target.chip.setPreset(0, {sample, totalLevel: 12, directLevel: 5, dspSend: 7,
      envelope: {attackRate: 31, releaseRate: 31}});
    await target.chip.setDspDelay(settings());
    await target.chip.setDspReturn({level: 7, pan: 0});
    if (session !== target) throw new DOMException('Audio session ended', 'AbortError');
    await showSnapshot(target);
    showStatus('ready', 'Ready. Play A3, then release it to leave the echoes.');
  } catch (error) {
    if (session === target) session = null;
    await dispose(target);
    if (!session) showStatus('error', error.message);
  } finally {
    if (!session || session === target) {changing = false; updateControls();}
  }
}
async function stop() {
  if (changing || !session) return;
  changing = true;
  const previous = session;
  session = null;
  showStatus('stopping', 'Stopping audio…');
  updateControls();
  try {
    await dispose(previous);
    showStatus('idle', 'Stopped. Start audio to create a fresh session.');
  } catch (error) {
    showStatus('error', error.message);
  } finally {changing = false; updateControls();}
}
function edit(patch) {
  updateControls();
  const target = session;
  if (!target || changing) return;
  edits = edits.then(async () => {
    if (session !== target) return;
    await target.chip.setDspDelay(patch);
    await showSnapshot(target);
    if (session === target) showStatus('ready', 'Delay settings applied. Feedback keeps the tail; Time / Enable clears it.');
  }).catch(error => {
    if (session === target) showStatus('error', error.message);
  });
}
function play() {
  const target = session;
  if (!target || changing) return;
  edits = edits.then(async () => {
    if (session !== target) return;
    target.chip.noteOn(0, 'A3');
    showStatus('playing', 'Playing A3. Release note leaves the shared DSP tail.');
  }).catch(error => {if (session === target) showStatus('error', error.message);});
}
function release() {
  const target = session;
  if (!target || changing) return;
  edits = edits.then(async () => {
    if (session !== target) return;
    target.chip.noteOff(0);
    showStatus('released', 'Note released. Its echoes continue until they decay.');
  }).catch(error => {if (session === target) showStatus('error', error.message);});
}
startButton.addEventListener('click', () => void start());
stopButton.addEventListener('click', () => void stop());
noteOnButton.addEventListener('click', play);
noteOffButton.addEventListener('click', release);
enabled.addEventListener('change', () => edit({enabled: enabled.checked}));
time.addEventListener('input', () => edit({timeMs: Number(time.value)}));
feedback.addEventListener('input', () => edit({feedback: Number(feedback.value) / 4096}));
window.addEventListener('pagehide', () => {const previous = session; session = null; void dispose(previous);});
updateControls();
