// SPDX-License-Identifier: BSD-3-Clause
// Shared Code runtime/editor over the upper editor's existing physical APU.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?v=draft-reconnect-1';
import {selectGameboyCodeDeclarations} from './code_declarations.js';
import {createGameboyCodeAudio} from './code_audio.js';
import {createGameboyCodeProject,GAMEBOY_PROJECT_FILE_BYTES} from './code_project.js?v=draft-reconnect-1';
import {setupGameboyCodeFiles} from './code_files.js?v=draft-reconnect-1';

export const GAMEBOY_STARTER_CODE=`const gb = await useSoundChip("gameboy");
setBpm(120);

// Follow the selected sound on the next note, using physical channels.
liveLoop("melody", async () => {
  const source = (await gb.getState()).editorSource;
  const note = choose(scale("E3", "minorPentatonic", 2));
  if (source === "noise") await gb.noise.keyOn();       // CH4
  else if (source === "wave") await gb.wave.noteOn(note); // CH3
  else await gb.pulse.noteOn(CH1, note);               // CH1

  await beat(0.24);
  if (source === "noise") await gb.noise.keyOff();
  else if (source === "wave") await gb.wave.keyOff();
  else await gb.pulse.keyOff(CH1);
  await beat(0.5);
});
`;
const aborted=()=>new DOMException('DMG Code stopped','AbortError');
export function setupGameboyCodeHost({ensureAudio,getAudio,getSettings,applySettings,stopKeyboard,
  stopSong=async()=>{},beforeSoundApply=stopSong,beforeRun=async()=>{},prepareOutput=async()=>{},onActivity=()=>{},setStatus=()=>{}}={}){
  let disposed=false,epoch=0,modeEpoch=0,runtime=null,controls=null,files=null;
  const project=createGameboyCodeProject({settings:getSettings(),getStarterCode:()=>GAMEBOY_STARTER_CODE});
  const audio=createGameboyCodeAudio({ensureReady:ensureAudio,getAudio,onLog:line=>controls?.appendLog(line)});
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
  files=setupGameboyCodeFiles({project,getSettings,applySettings,setStatus,
    async onBeforeSoundApply(){await beforeSoundApply();if(!runtime?.getState().running)await stopKeyboard();},
    async onBeforeWorkspaceReplace(){await stopSong();await stop();await stopKeyboard();}});
  function getRuntime(){
    if(runtime)return runtime;
    runtime=createPlaygroundCodeRuntime({supportedSoundChips:['gameboy'],
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
    keepRunningOnKeyboard:true,
    allowTextFiles:true,maxTextLength:GAMEBOY_PROJECT_FILE_BYTES,writeText:(path,source)=>project.writeEditorText(path,source),
    editorChip:'gameboy',transformDeclarations:selectGameboyCodeDeclarations,
    journalKey:'tetorica-dmg-synth-pending-code',getStarterCode:()=>GAMEBOY_STARTER_CODE,
    async onBeforeRun(){modeEpoch++;await stopSong();if(!runtime?.getState().running)await stopKeyboard();await beforeRun();},
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
