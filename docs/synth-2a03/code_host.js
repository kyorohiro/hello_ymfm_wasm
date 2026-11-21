// SPDX-License-Identifier: BSD-3-Clause
// Shared Code runtime/editor over the upper editor's existing physical APU.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?v=draft-reconnect-1';
import {selectNesCodeDeclarations} from './code_declarations.js';
import {createNesCodeAudio} from './code_audio.js';
import {createNesCodeProject,NES_PROJECT_FILE_BYTES} from './code_project.js?v=draft-reconnect-1';
import {setupNesCodeFiles} from './code_files.js?v=draft-reconnect-1';

export const NES_STARTER_CODE=`const nes = await useSoundChip("nes");
setBpm(120);

// Follow the selected sound on the next note, using physical channels.
liveLoop("melody", async () => {
  const source = (await nes.getState()).preset.source;
  const channel = {pulse: CH1, triangle: CH3, noise: CH4, dmc: CH5, fds: CH6}[source];
  await nes.noteOn(channel, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.5);
  await nes.noteOff(channel);
  await beat(0.25);
});
`;
const aborted=()=>new DOMException('2A03 Code stopped','AbortError');
export function setupNesCodeHost({ensureAudio,getAudio,getSettings,applySettings,stopKeyboard,
  stopSong=async()=>{},beforeSoundApply=async()=>{},beforeRun=async()=>{},onBeforeRun=beforeRun,onSelectSong=async()=>{},prepareOutput=async()=>{},onActivity=()=>{},onViewChange=()=>{},onExpandedChange=()=>{},setStatus=()=>{}}={}){
  let disposed=false,epoch=0,modeEpoch=0,runtime=null,controls=null,files=null;
  const project=createNesCodeProject({settings:getSettings(),getStarterCode:()=>NES_STARTER_CODE});
  const audio=createNesCodeAudio({ensureReady:ensureAudio,getAudio,onLog:line=>controls?.appendLog(line)});
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
  files=setupNesCodeFiles({project,getSettings,applySettings,setStatus,onSelectSong,
    async onBeforeSoundApply(){await beforeSoundApply();if(!runtime?.getState().running)await stopKeyboard();},
    async onBeforeWorkspaceReplace(){await stopSong();await stop();await stopKeyboard();}});
  function getRuntime(){
    if(runtime)return runtime;
    runtime=createPlaygroundCodeRuntime({supportedSoundChips:['nes'],
      async ensureReady(){
        const token=epoch;await ensureAudio();valid(token);
        await audio.prepare();valid(token);
        const owner=getAudio();await prepareOutput(owner,()=>!disposed&&token===epoch&&owner===getAudio());valid(token);
        audio.open();onActivity();
      },
      now:()=>getAudio()?.context.currentTime??0,useSoundChip:name=>audio.useSoundChip(name),fx:audio.fx,
      resolveNoteTarget:audio.resolveNoteTarget,
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
    keepRunningOnKeyboard:true,persistentExpanded:true,onViewChange,onExpandedChange,
    allowTextFiles:true,maxTextLength:NES_PROJECT_FILE_BYTES,writeText:(path,source)=>project.writeEditorText(path,source),
    editorChip:'nes',transformDeclarations:selectNesCodeDeclarations,
    journalKey:'tetorica-2a03-synth-pending-code',getStarterCode:()=>NES_STARTER_CODE,
    async onBeforeRun(){modeEpoch++;await stopSong();if(!runtime?.getState().running)await stopKeyboard();await onBeforeRun();},
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
