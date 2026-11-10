// SPDX-License-Identifier: BSD-3-Clause
// Glue for the shared Code editor/scheduler and this Synth's existing SID.
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js?sid-code=1';
import {setupSynthCodeControls} from '../synth/synth_code_controls.js?sid-code=1';
import {selectSidCodeDeclarations} from './code_declarations.js?sid-code=1';
import {createSidCodeAudio} from './code_audio.js?sid-code=1';
import {createSidCodeProject} from './code_project.js?sid-code=1';
import {setupSidCodeFiles} from './code_files.js?sid-code=1';

export const SID_STARTER_CODE=`const sid = await useSoundChip("sid");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("E3", "minorPentatonic", 2);
  await sid.noteOn(CH1, choose(notes));
  await sleep(0.12);
  await sid.noteOff(CH1);
  await beat(0.5);
});
`;
const aborted=()=>new DOMException('SID Code stopped','AbortError');
export function setupSidCodeHost({ensureAudio,getAudio,getSettings,applySettings,stopKeyboard,stopSong,
  beforeRun=async()=>{},prepareOutput=async()=>{},onActivity=()=>{},setStatus=()=>{}}={}) {
  let disposed=false,epoch=0,modeEpoch=0,runtime=null,controls=null,files=null;
  const project=createSidCodeProject({settings:getSettings(),getStarterCode:()=>SID_STARTER_CODE});
  const audio=createSidCodeAudio({ensureReady:ensureAudio,getAudio,onLog:line=>controls?.appendLog(line)});
  const valid=token=>{if(disposed||token!==epoch)throw aborted();};
  async function stop() {
    const request=++modeEpoch;
    if(controls)await controls.stop();else if(runtime)await runtime.stop();
    // A global/desktop Stop can also retire a previous Code session while
    // Keyboard is already selected. Reopen only that idle keyboard route;
    // a newer Run or mode request owns its own output gate.
    if(!disposed&&request===modeEpoch&&!controls?.isCodeMode()&&!runtime?.getState().running)audio.open();
    onActivity();
  }
  files=setupSidCodeFiles({project,getSettings,applySettings,setStatus,
    async onBeforeWorkspaceReplace(){await stop();await stopSong();await stopKeyboard();}});
  function getRuntime() {
    if(runtime)return runtime;
    runtime=createPlaygroundCodeRuntime({supportedSoundChips:['sid'],
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
        await audio.stop();
        // Retire a gesture-created engine which has not yet been adopted.
        // This runs after the output fade for any existing performance.
        if(!getAudio())await stopKeyboard();
      },
    });
    return runtime;
  }
  controls=setupSynthCodeControls({project,files,getRuntime,
    editorChip:'c64',transformDeclarations:selectSidCodeDeclarations,
    journalKey:'tetorica-sid-synth-pending-code',getStarterCode:()=>SID_STARTER_CODE,
    async onBeforeRun(){
      modeEpoch++;await stopSong();
      if(!runtime?.getState().running)await stopKeyboard();
      await beforeRun();
    },
    async onModeChange(mode){
      const request=++modeEpoch;
      if(mode==='code'){
        await stopSong();
        if(!disposed&&request===modeEpoch&&!runtime?.getState().running)await stopKeyboard();
      }else if(!disposed&&!runtime?.getState().running)audio.open();
      onActivity();
    },setStatus,
  });
  return {project,files,controls,ready:controls.ready,
    isCodeMode:()=>controls.isCodeMode(),isRunning:()=>Boolean(runtime?.getState().running),
    getState:()=>runtime?.getState()??{state:'idle',running:false},
    stop,markSoundDirty:()=>files.markSoundDirty(),
    async dispose(){if(disposed)return;await stop();disposed=true;epoch++;controls.dispose();await files.dispose();await audio.dispose();},
  };
}
