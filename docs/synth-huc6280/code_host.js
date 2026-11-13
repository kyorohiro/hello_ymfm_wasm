// SPDX-License-Identifier: BSD-3-Clause
// Software scheduling/editor over the instrument's existing physical PSG.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?v=huc-code-source-1';
import {selectHuc6280CodeDeclarations} from './code_declarations.js?v=huc-code-1';
import {createHuc6280CodeAudio} from './code_audio.js?v=huc-code-1';
import {createHuc6280CodeProject,HUC6280_PROJECT_FILE_BYTES} from './code_project.js?v=huc-code-1';
import {setupHuc6280CodeFiles} from './code_files.js?v=huc-code-1';

export const HUC6280_STARTER_CODE=`const pce = await useSoundChip("huc6280");
setBpm(120);

// Use the current sound. Noise belongs to physical CH5 / CH6.
liveLoop("melody", async () => {
  const state = await pce.getState();
  const channel = state.editorSource === "noise" ? CH5 : CH1;
  const note = choose(scale("E3", "minorPentatonic", 2));
  if (state.editorLfoEnabled && state.editorLfoMode === "follow") {
    await pce.setNote(CH2, note); // Hardware LFO source, CH2 -> CH1.
  }
  await pce.noteOn(channel, note);
  await sleep(0.12);
  await pce.noteOff(channel); // Software envelope; keyOff is a raw gate.
  await beat(0.5);
});
`;
const aborted=()=>new DOMException('HuC6280 Code stopped','AbortError');
export function setupHuc6280CodeHost({ensureAudio,getAudio,getSettings,applySettings,
  stopKeyboard,onActivity=()=>{},setStatus=()=>{}}={}) {
  let disposed=false,epoch=0,modeEpoch=0,runtime=null,controls=null;
  const project=createHuc6280CodeProject({settings:getSettings(),getStarterCode:()=>HUC6280_STARTER_CODE});
  const audio=createHuc6280CodeAudio({ensureReady:ensureAudio,getAudio,onLog:line=>controls?.appendLog(line)});
  const valid=token=>{if(disposed||token!==epoch)throw aborted();};
  async function stop() {
    const request=++modeEpoch;
    if(controls)await controls.stop();else if(runtime)await runtime.stop();
    if(!disposed&&request===modeEpoch&&!controls?.isCodeMode()&&!runtime?.getState().running)audio.open();
    onActivity();
  }
  const files=setupHuc6280CodeFiles({project,getSettings,applySettings,setStatus,
    async onBeforeSoundApply(){if(!runtime?.getState().running)await stopKeyboard();},
    async onBeforeWorkspaceReplace(){await stop();await stopKeyboard();}});
  function getRuntime() {
    if(runtime)return runtime;
    runtime=createPlaygroundCodeRuntime({supportedSoundChips:['huc6280'],
      async ensureReady(){const token=epoch;await ensureAudio();valid(token);await audio.prepare();valid(token);audio.open();onActivity();},
      now:()=>getAudio()?.context.currentTime??0,useSoundChip:name=>audio.useSoundChip(name),fx:audio.fx,
      resolveNoteTarget:audio.resolveNoteTarget,
      readFile:(...args)=>project.readFile(...args),prepareSource:(...args)=>project.prepareSource(...args),
      onLog:line=>controls?.appendLog(line),onState:state=>{controls?.setRuntimeState(state);onActivity();},
      beforeStopSoundChips(){epoch++;return audio.beforeStop();},
      async stopSoundChips(){
        const token=epoch,owner=getAudio();await audio.stop();
        if(!getAudio())await stopKeyboard();
        else if(!disposed&&token===epoch&&owner===getAudio()&&!controls?.isCodeMode()&&!runtime?.getState().running)audio.open();
      },
    });return runtime;
  }
  controls=setupSynthCodeControls({project,files,getRuntime,keepRunningOnKeyboard:true,
    allowTextFiles:true,maxTextLength:HUC6280_PROJECT_FILE_BYTES,writeText:(path,source)=>project.writeEditorText(path,source),
    editorChip:'huc6280',transformDeclarations:selectHuc6280CodeDeclarations,
    journalKey:'tetorica-huc6280-synth-pending-code',getStarterCode:()=>HUC6280_STARTER_CODE,
    async onBeforeRun(){modeEpoch++;if(!runtime?.getState().running)await stopKeyboard();},
    async onModeChange(mode){const request=++modeEpoch;
      if(mode==='code'){if(!disposed&&request===modeEpoch&&!runtime?.getState().running)await stopKeyboard();}
      else if(!disposed&&!runtime?.getState().running)audio.open();onActivity();
    },setStatus,
  });
  return {project,files,controls,ready:controls.ready,isCodeMode:()=>controls.isCodeMode(),
    isRunning:()=>Boolean(runtime?.getState().running),getState:()=>runtime?.getState()??{state:'idle',running:false},
    stop,markSoundDirty:()=>files.markSoundDirty(),
    async dispose(){if(disposed)return;await stop();disposed=true;epoch++;controls.dispose();await files.dispose();await audio.dispose();},
  };
}
