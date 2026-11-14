// SPDX-License-Identifier: BSD-3-Clause
// Shared software scheduler/editor over the upper instrument's existing SPU.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js?v=ps1-vab-api-1';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?v=draft-reconnect-1';
import {selectSpuCodeDeclarations} from './code_declarations.js?spu-click-guard=1';
import {createSpuCodeAudio} from './code_audio.js?spu-code=1';
import {createSpuCodeProject,SPU_PROJECT_FILE_BYTES} from './code_project.js?v=draft-reconnect-1';
import {setupSpuCodeFiles} from './code_files.js?v=draft-reconnect-1';

export const SPU_STARTER_CODE=`const ps1 = await useSoundChip("ps1");
setBpm(120);

// Use the current sample, ADSR and shared reverb from the controls above.
liveLoop("melody", async () => {
  // Follow sound selections without replacing this loop or its context.
  // PMON pairs CH1 -> CH2, so choose its carrier when pairing is enabled.
  const state = await ps1.getState();
  const channel = state.pmon.enabled ? CH2 : CH1;
  const notes = scale("E3", "minorPentatonic", 2);
  await ps1.noteOn(channel, choose(notes));
  await beat(0.24);
  await ps1.noteOff(channel);
  await beat(0.5);
});
`;
const aborted=()=>new DOMException('SPU Code stopped','AbortError');
export function setupSpuCodeHost({ensureAudio,getAudio,getInstrument,applyInstrument,applyVabTone,stopKeyboard,
  beforeRun=async()=>{},prepareOutput=async()=>{},onActivity=()=>{},setStatus=()=>{}}={}){
  let disposed=false,epoch=0,modeEpoch=0,runtime=null,controls=null,files=null;
  const project=createSpuCodeProject({getStarterCode:()=>SPU_STARTER_CODE});
  const audio=createSpuCodeAudio({ensureReady:ensureAudio,getAudio,onLog:line=>controls?.appendLog(line)});
  const valid=token=>{if(disposed||token!==epoch)throw aborted();};
  function openOutput(){
    const state=runtime?.getState();
    if(disposed||state?.running||state?.busy||state?.stopping)return false;
    audio.open();return true;
  }
  async function stop(){
    const request=++modeEpoch;
    if(controls)await controls.stop();else if(runtime)await runtime.stop();
    if(!disposed&&request===modeEpoch&&!runtime?.getState().running)audio.open();
    onActivity();
  }
  files=setupSpuCodeFiles({project,getInstrument,applyInstrument,applyVabTone,setStatus,
    async onBeforeWorkspaceReplace(){await stop();await stopKeyboard();}});
  function getRuntime(){
    if(runtime)return runtime;
    runtime=createPlaygroundCodeRuntime({supportedSoundChips:['ps1'],
      async ensureReady(){
        const token=epoch;await ensureAudio();valid(token);
        await audio.prepare();valid(token);
        const owner=getAudio();
        await prepareOutput(owner,()=>!disposed&&token===epoch&&owner===getAudio());valid(token);
        audio.open();onActivity();
      },
      now:()=>getAudio()?.context.currentTime??0,
      useSoundChip:name=>audio.useSoundChip(name),fx:audio.fx,
      readFile:(...args)=>project.readFile(...args),prepareSource:(...args)=>project.prepareSource(...args),
      onLog:line=>controls?.appendLog(line),onState:state=>{controls?.setRuntimeState(state);onActivity();},
      beforeStopSoundChips(){epoch++;return audio.beforeStop();},
      async stopSoundChips(){
        const token=epoch,request=modeEpoch,owner=getAudio();await audio.stop();
        if(!getAudio())await stopKeyboard();
        else if(!disposed&&token===epoch&&request===modeEpoch&&owner===getAudio()&&!runtime?.getState().running)audio.open();
      },
    });
    return runtime;
  }
  controls=setupSynthCodeControls({project,files,getRuntime,
    keepRunningOnKeyboard:true,
    allowTextFiles:true,maxTextLength:SPU_PROJECT_FILE_BYTES,writeText:(path,source)=>project.writeEditorText(path,source),
    editorChip:'ps1',transformDeclarations:selectSpuCodeDeclarations,
    journalKey:'tetorica-spu-synth-pending-code',getStarterCode:()=>SPU_STARTER_CODE,
    async onBeforeRun(){
      modeEpoch++;if(!runtime?.getState().running)await stopKeyboard();await beforeRun();
    },
    async onModeChange(){
      modeEpoch++;openOutput();
      onActivity();
    },setStatus,
  });
  return{project,files,controls,ready:controls.ready,
    isCodeMode:()=>controls.isCodeMode(),isRunning:()=>Boolean(runtime?.getState().running),
    getState:()=>runtime?.getState()??{state:'idle',running:false},
    stop,openOutput,markSoundDirty:()=>files.markSoundDirty(),
    async dispose(){if(disposed)return;await stop();disposed=true;epoch++;controls.dispose();await files.dispose();await audio.dispose();},
  };
}
