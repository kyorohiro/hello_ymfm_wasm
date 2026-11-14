// SPDX-License-Identifier: BSD-3-Clause
// Shared Code runtime/editor over the upper editor's existing S-DSP.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?v=draft-reconnect-1';
import {selectSnesCodeDeclarations} from './code_declarations.js';
import {createSnesCodeAudio} from './code_audio.js';
import {createSnesCodeProject,SNES_PROJECT_FILE_BYTES} from './code_project.js?v=draft-reconnect-1';
import {setupSnesCodeFiles} from './code_files.js?v=draft-reconnect-1';

export const SNES_STARTER_CODE=`const snes = await useSoundChip("snes");
setBpm(120);

// The selected Wave / BRR / Noise, including PMON and Echo.
liveLoop("melody", async () => {
  await snes.noteOn(CH1, choose(scale("C4", "minorPentatonic", 1)));
  await beat(0.5);
  await snes.noteOff(CH1);
  await beat(0.25);
});
`;
const aborted=()=>new DOMException('S-DSP Code stopped','AbortError');
export function setupSnesCodeHost({ensureAudio,getAudio,getSettings,applySettings,stopKeyboard,
  onActivity=()=>{},setStatus=()=>{}}={}){
  let disposed=false,epoch=0,modeEpoch=0,runtime=null,controls=null,files=null;
  const project=createSnesCodeProject({settings:getSettings(),getStarterCode:()=>SNES_STARTER_CODE});
  const audio=createSnesCodeAudio({ensureReady:ensureAudio,getAudio,onLog:line=>controls?.appendLog(line)});
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
  files=setupSnesCodeFiles({project,getSettings,applySettings,setStatus,
    async onBeforeSoundApply(){if(!runtime?.getState().running)await stopKeyboard();},
    async onBeforeWorkspaceReplace(){await stop();await stopKeyboard();}});
  function getRuntime(){
    if(runtime)return runtime;
    runtime=createPlaygroundCodeRuntime({supportedSoundChips:['snes'],
      async ensureReady(){
        const token=epoch;await ensureAudio();valid(token);
        await audio.prepare();valid(token);
        audio.open();onActivity();
      },
      now:()=>getAudio()?.context.currentTime??0,useSoundChip:name=>audio.useSoundChip(name),fx:audio.fx,
      readFile:(...args)=>project.readFile(...args),prepareSource:(...args)=>project.prepareSource(...args),
      onLog:line=>controls?.appendLog(line),onState:state=>{controls?.setRuntimeState(state);onActivity();},
      beforeStopSoundChips(){epoch++;return audio.beforeStop();},
      async stopSoundChips(){
        const token=epoch,owner=getAudio();await audio.stop();
        if(!getAudio())await stopKeyboard();
        else if(!disposed&&token===epoch&&owner===getAudio()&&!runtime?.getState().running)audio.open();
      },
    });
    return runtime;
  }
  controls=setupSynthCodeControls({project,files,getRuntime,
    keepRunningOnKeyboard:true,
    allowTextFiles:true,maxTextLength:SNES_PROJECT_FILE_BYTES,writeText:(path,source)=>project.writeEditorText(path,source),
    editorChip:'snes',transformDeclarations:selectSnesCodeDeclarations,
    journalKey:'tetorica-snes-synth-pending-code',getStarterCode:()=>SNES_STARTER_CODE,
    async onBeforeRun(){modeEpoch++;if(!runtime?.getState().running)await stopKeyboard();},
    async onModeChange(){
      modeEpoch++;openOutput();
      onActivity();
    },setStatus,
  });
  return{project,files,controls,ready:controls.ready,
    isCodeMode:()=>controls.isCodeMode(),isRunning:()=>Boolean(runtime?.getState().running),
    getState:()=>runtime?.getState()??{state:'idle',running:false},stop,openOutput,markSoundDirty:()=>files.markSoundDirty(),
    async dispose(){if(disposed)return;await stop();disposed=true;epoch++;controls.dispose();await files.dispose();await audio.dispose();},
  };
}
