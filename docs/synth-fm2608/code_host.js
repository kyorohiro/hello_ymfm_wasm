// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?v=sdsp-code-review-1';
import {selectFm2608CodeDeclarations} from './code_declarations.js';
import {createFm2608CodeAudio} from './code_audio.js';
import {createFm2608CodeProject, FM2608_PROJECT_FILE_BYTES} from './code_project.js';
import {setupFm2608CodeFiles} from './code_files.js';
import {resolveFm2608CodeNoteTarget} from './code_client.js';

export const FM2608_STARTER_CODE = `const opna = await useSoundChip("ym2608");
setBpm(120);

// The controls above and this Code share the same OPNA.
liveLoop("melody", async () => {
  opna.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.5);
  opna.noteOff(CH1);
  await beat(0.25);
});
`;

const aborted = () => new DOMException('FM2608 Code stopped', 'AbortError');

export function setupFm2608CodeHost({ensureAudio, getAudio, getSettings, applySettings,
  stopKeyboard = () => {}, onBeforeRun = async () => {}, onActivity = () => {},
  onSelectSong = async () => {}, onWorkspaceReplace = async () => {}, setStatus = () => {}} = {}) {
  let disposed = false, epoch = 0, modeEpoch = 0, runtime = null, controls = null;
  const project = createFm2608CodeProject({settings:getSettings(), getStarterCode:() => FM2608_STARTER_CODE});
  const audio = createFm2608CodeAudio({ensureReady:ensureAudio, getAudio,
    onLog:line => controls?.appendLog(line)});
  function valid(token) {
    if (disposed || token !== epoch) throw aborted();
  }
  function openOutput() {
    const state = runtime?.getState();
    if (disposed || state?.running || state?.busy || state?.stopping) return false;
    audio.open();
    return true;
  }
  async function stop() {
    const request = ++modeEpoch;
    if (controls) await controls.stop();
    else if (runtime) await runtime.stop();
    if (!disposed && request === modeEpoch && !runtime?.getState().running) audio.open();
    onActivity();
  }

  const files = setupFm2608CodeFiles({project, getSettings, applySettings, onSelectSong, setStatus,
    async onBeforeSoundApply() {
      if (!runtime?.getState().running) await stopKeyboard();
    },
    async onBeforeWorkspaceReplace() {
      await stop();
      await stopKeyboard();
      await onWorkspaceReplace();
    },
  });

  function getRuntime() {
    if (runtime) return runtime;
    runtime = createPlaygroundCodeRuntime({
      supportedSoundChips:['ym2608'],
      async ensureReady() {
        const token = epoch;
        await ensureAudio();
        valid(token);
        await audio.prepare();
        valid(token);
        audio.open();
        onActivity();
      },
      now:() => getAudio()?.context.currentTime ?? 0,
      useSoundChip:name => audio.useSoundChip(name), fx:audio.fx,
      resolveNoteTarget:resolveFm2608CodeNoteTarget,
      readFile:(...args) => project.readFile(...args),
      prepareSource:(...args) => project.prepareSource(...args),
      onLog:line => controls?.appendLog(line),
      onState:state => { controls?.setRuntimeState(state); onActivity(); },
      beforeStopSoundChips() { epoch++; return audio.beforeStop(); },
      async stopSoundChips() {
        const token = epoch, owner = getAudio();
        await audio.stop();
        await stopKeyboard();
        if (!disposed && token === epoch && owner === getAudio() && !runtime?.getState().running) audio.open();
      },
    });
    return runtime;
  }

  controls = setupSynthCodeControls({project, files, getRuntime,
    keepRunningOnKeyboard:true, allowTextFiles:true, maxTextLength:FM2608_PROJECT_FILE_BYTES,
    writeText:(path, source) => project.writeEditorText(path, source),
    editorChip:'ym2608', transformDeclarations:selectFm2608CodeDeclarations,
    journalKey:'tetorica-fm2608-synth-pending-code', getStarterCode:() => FM2608_STARTER_CODE,
    async onBeforeRun() {
      await onBeforeRun();
      modeEpoch++;
      if (!runtime?.getState().running) await stopKeyboard();
    },
    onModeChange() { modeEpoch++; openOutput(); onActivity(); },
    setStatus,
  });

  return {project, files, controls, ready:controls.ready,
    isCodeMode:() => controls.isCodeMode(),
    isRunning:() => Boolean(runtime?.getState().running),
    getState:() => runtime?.getState() ?? {state:'idle', running:false},
    stop, openOutput, markSoundDirty:() => files.markSoundDirty(),
    async dispose() {
      if (disposed) return;
      await stop();
      disposed = true;
      epoch++;
      controls.dispose();
      await files.dispose();
      await audio.dispose();
    },
  };
}
