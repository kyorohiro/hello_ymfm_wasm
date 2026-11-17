// SPDX-License-Identifier: BSD-3-Clause
// Serve this example at its installed URL. Audio starts from the button below.
import {createScspAudio} from 'tetorica-fm2612/playground_scsp_audio.js';
import {createScspClient} from 'tetorica-fm2612/playground_scsp.js';
import {assembleScspDsp} from 'tetorica-fm2612/scsp_dsp_assembler.js';

const programs = {
  gain: {
    source: `000: XSEL=1 YSEL=1 IRA=32 ZERO=1 COEF=0
001: EWT=1 EWA=0 ZERO=1
`,
    codes: [2048, 0, 0],
    roles: ['gain', 'unused', 'unused'],
  },
  iir: {
    source: `; y[n] = a*y[n-1] + b*x[n], using signed Q12 coefficients.
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`,
    codes: [0, 3840, 256],
    roles: ['unused', 'history', 'new input'],
  },
};
const program = document.getElementById('program');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const status = document.getElementById('status');
const source = document.getElementById('source');
const snapshot = document.getElementById('snapshot');
const sliders = [0, 1, 2].map(index => document.getElementById(`coef${index}`));
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
  program.disabled = changing;
  const selected = programs[program.value];
  for (const [index, slider] of sliders.entries()) {
    slider.disabled = changing || selected.roles[index] === 'unused';
    document.getElementById(`coef${index}Value`).value = slider.value;
  }
}

function chooseProgram() {
  const selected = programs[program.value];
  source.textContent = selected.source;
  selected.codes.forEach((code, index) => {
    sliders[index].value = String(code);
    document.getElementById(`coef${index}Label`).textContent = `COEF${index} · ${selected.roles[index]}`;
  });
  updateControls();
}

function coefficientPatch() {
  return {0: Number(sliders[0].value), 1: Number(sliders[1].value), 2: Number(sliders[2].value)};
}

async function showSnapshot(target) {
  const state = await target.chip.getDspProgram();
  if (session === target) {
    snapshot.textContent = JSON.stringify({
      profile: state.profile, revision: state.revision,
      coefficients: state.coefficients, return: state.return,
      wordCount: state.words.length,
    }, null, 2);
  }
}

async function applyProgram(target) {
  const selected = programs[program.value];
  const words = assembleScspDsp(selected.source);
  await target.chip.applyDspProgram(words, {coefficients: coefficientPatch()});
  target.chip.setPreset(0, {
    sample: target.samples[program.value], totalLevel: 12,
    directLevel: 0, dspSend: 7, envelope: {attackRate: 31, releaseRate: 24},
  });
  await target.chip.setDspReturn({level: 7, pan: 0});
  target.chip.noteOn(0, 'A3');
  await showSnapshot(target);
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

async function stop() {
  if (changing || !session) return;
  changing = true;
  const previous = session;
  session = null;
  showStatus('stopping', 'Stopping audio…');
  updateControls();
  try {
    await dispose(previous);
    showStatus('idle', 'Stopped. Start audio to play again.');
  } catch (error) {
    showStatus('error', error.message);
  } finally {
    changing = false;
    updateControls();
  }
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
    target = {context, output, endpoint: null, chip: null, samples: {}};
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
    // Both waveforms are prepared once and retained across program changes.
    for (const kind of ['gain', 'iir']) {
      const pcm = Int16Array.from({length: 64}, (_, index) => Math.round(4096 *
        (kind === 'gain' ? Math.sin(2 * Math.PI * index / 64) : 2 * index / 64 - 1)));
      target.samples[kind] = await target.chip.loadPCM(pcm, {
        baseFrequencyHz: 44100 / 64, loopStartSamples: 0,
      });
    }
    if (session !== target) throw new DOMException('Audio session ended', 'AbortError');
    await applyProgram(target);
    showStatus('playing', 'Playing A3. Move a coefficient to edit the held sound.');
  } catch (error) {
    if (session === target) session = null;
    await dispose(target);
    if (!session) showStatus('error', error.message);
  } finally {
    if (!session || session === target) {
      changing = false;
      updateControls();
    }
  }
}

startButton.addEventListener('click', () => void start());
stopButton.addEventListener('click', () => void stop());
program.addEventListener('change', async () => {
  chooseProgram();
  if (!session) return;
  changing = true;
  showStatus('starting', 'Applying DSP program…');
  updateControls();
  const target = session;
  try {
    await edits;
    await applyProgram(target);
    showStatus('playing', 'Program applied. Move a coefficient to edit the held sound.');
  } catch (error) {
    showStatus('error', error.message);
  } finally {
    changing = false;
    updateControls();
  }
});
sliders.forEach(slider => slider.addEventListener('input', () => {
  updateControls();
  const target = session;
  if (!target || changing) return;
  const patch = coefficientPatch();
  edits = edits.then(async () => {
    if (session !== target) return;
    await target.chip.setDspCoefficients(patch);
    await showSnapshot(target);
    if (session === target && !changing) showStatus('playing', 'Coefficient applied. The note is still held.');
  }).catch(error => {
    if (session === target) showStatus('error', error.message);
  });
}));
window.addEventListener('pagehide', () => {
  const previous = session;
  session = null;
  void dispose(previous);
});
chooseProgram();
