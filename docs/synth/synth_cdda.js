// SPDX-License-Identifier: BSD-3-Clause
// Mega CD audio shares the PC Engine authored-media transport and Code leases.
import {createCddaSource} from '../synth-huc6280/cdda_source.js?v=huc-media-live-1';
import {setupCddaControls} from '../synth-huc6280/cdda_controls.js';
import {createCddaSessionFiles} from '../synth-huc6280/cdda_session_files.js';
import {createCddaInputReader} from '../synth-huc6280/cdda_inputs.js';
import {createPceMediaKeyboard} from '../synth-huc6280/media_keyboard.js?v=huc-media-live-1';
import {setupTestPcmControls} from '../synth-huc6280/test_pcm_controls.js?v=huc-test-default-1';
import {createTestWaveFiles} from '../synth-huc6280/test_pcm.js?v=huc-media-tools-1';
import {createVirtualFileSystem,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {createSynthCodeProject} from './synth_code_project.js?v=working-saved-1';
export {resolveCddaInputPath} from '../synth-huc6280/cdda_inputs.js';

const aborted=()=>new DOMException('CD-DA workspace operation cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
const MAX_PROJECT_BYTES=16*1024*1024;

export function setupSynthCdda({project,ready=Promise.resolve(),readFile,ensureAudio,getContext,getInput,getMix,getMaster=()=>1,
  onStatus=()=>{},onOutput=()=>{},isVisible=()=>true,openOutput=()=>{},addFiles=()=>{},
  root=document.getElementById('cddaControls'),testRoot=document.getElementById('cddaTestPcm'),createAudio}={}) {
  if(!project?.fs||!root||!testRoot||[ensureAudio,getContext,getInput,getMix,getMaster,onStatus,onOutput,isVisible,openOutput,addFiles].some(value=>typeof value!=='function')||
    readFile!==undefined&&typeof readFile!=='function')throw TypeError('CD-DA needs the Synth workspace, controls and audio owner');
  const projectReady=Promise.resolve(ready),session=createCddaSessionFiles(),fileTypes=new Map();
  let disposed=false,lifecycle=0,engine=null,widget=null,unwidget=()=>{},stopping=null,resetting=null,disposing=null;
  const output=()=>{if(!disposed)onOutput();};
  const report=error=>{if(!disposed&&!isAbort(error))onStatus(`CD-DA: ${error?.message??error}`,true);};
  const portable={
    fs:project.fs,get selectedPath(){return project.selectedPath;},select:path=>project.select(path),onDidChange:listener=>project.onDidChange(listener),
    readFile:readFile??createSynthCodeProject(project).readFile,
    listEntries(){
      return project.listEntries().filter(entry=>entry.type==='file'&&!isCheckpointPath(entry.path)&&!entry.path.split('/').includes('.git')&&/\.(?:wav|json)$/i.test(entry.path)).map(entry=>{
        let cached=fileTypes.get(entry.path);
        if(cached?.revision!==entry.revision){cached={revision:entry.revision,type:project.fs.get(entry.path)?.type};fileTypes.set(entry.path,cached);}
        return{...entry,fileType:cached.type};
      });
    },
    importFiles(entries){
      // Generated edits retain the same checkpoint and portable byte limits as
      // Files. Validate the whole candidate before changing the live workspace.
      const candidate=createVirtualFileSystem([],{autoCheckpoint:project.fs.checkpoints.auto});
      candidate.restore(project.fs.snapshot());candidate.writeFiles(entries);
      let bytes=0;
      for(const file of candidate.list())bytes+=typeof file.data==='string'?new TextEncoder().encode(file.data).byteLength:file.data.byteLength;
      if(bytes>MAX_PROJECT_BYTES)throw RangeError('Cassette exceeds the 16 MiB expanded size limit.');
      project.fs.restore(candidate.snapshot());return entries.map(entry=>entry.path);
    },
  };
  const reader=createCddaInputReader({project:portable,session}),testFiles=createTestWaveFiles(portable);
  function dropEngine(){if(engine){try{engine.gain.disconnect();}catch{}engine=null;}}
  function getAudio(){
    if(engine&&(engine.context!==getContext()||engine.input!==getInput()||engine.context.state==='closed'))dropEngine();
    return engine;
  }
  function mixState(){
    const mix=getMix()??{},master=getMaster();
    return{...mix,volume:mix.volume??1,pan:mix.pan??0,muted:Boolean(mix.muted),effectiveMuted:Boolean(mix.effectiveMuted??mix.muted)||master===0};
  }
  function refreshMix(){
    const owner=getAudio();if(!owner||disposed)return false;
    const mix=mixState(),volume=Number(mix.volume),master=Number(getMaster());
    if(!Number.isFinite(volume)||volume<0||!Number.isFinite(master)||master<0)throw RangeError('CD-DA volume and Master must be finite nonnegative numbers');
    const value=mix.effectiveMuted?0:volume*master,parameter=owner.gain.gain;
    if(typeof parameter.setValueAtTime==='function')parameter.setValueAtTime(value,owner.context.currentTime);else parameter.value=value;
    return true;
  }
  async function prepareAudio(){
    if(disposed)throw aborted();
    const token=lifecycle;await ensureAudio();if(disposed||token!==lifecycle)throw aborted();
    const context=getContext(),input=getInput();
    if(!context||context.state==='closed'||!input||input.context!==context)throw Error('CD-DA needs the Synth AudioContext and shared output bus');
    getAudio();
    if(!engine){
      const gain=context.createGain();gain.connect(input);
      engine={context,input,gain,getChipInputNode:kind=>kind==='cdda'?gain:null,getChipMix:()=>mixState()};
    }
    refreshMix();
  }
  const source=createCddaSource({ensureAudio:prepareAudio,getAudio,readFile:reader,
    onState:output,onError:report,...(createAudio?{createAudio}:{}),
  });
  const keyboard=createPceMediaKeyboard({kind:'cdda',source,onUpdate:output});
  const controls=setupCddaControls({root,source,session,project:portable,addFiles,onStatus,onOutput:output,isVisible,
    async beforePlay(){if(disposed||stopping||resetting)throw Error('Wait for the current CD-DA operation.');await keyboard.relinquish();},
    async afterPlay(){if(!disposed)await openOutput();},
  });
  function createWidget(){
    const value=setupTestPcmControls({root:testRoot,id:'cdda',title:'CD-DA',onStatus,
      async saveWave(bytes,{signal}){
        const token=lifecycle;await projectReady;signal?.throwIfAborted();if(disposed||token!==lifecycle)throw aborted();
        const path=testFiles.save('cdda',bytes);project.select(path);return path;
      },
      loadWave:(bytes,options)=>{controls.cancelPlay();return source.load(bytes,options);},
      previewWave:(bytes,options)=>{controls.cancelPlay();return source.preview(bytes,options);},
    });
    let generation=source.read().playbackGeneration;
    const unsubscribe=source.subscribe(state=>{if(state.playbackGeneration!==generation||state.busy){generation=state.playbackGeneration;value.cancel();}});
    widget=value;unwidget=unsubscribe;
  }
  function discardWidget(){unwidget();unwidget=()=>{};widget?.dispose();widget=null;}
  async function initialize(){
    const token=lifecycle;await projectReady;if(disposed||token!==lifecycle||resetting)return false;
    const value=source.read();if(value.asset||value.busy||value.transportPending)return false;
    return widget?.initialize()??false;
  }
  function stop(){
    if(disposed)return disposing??Promise.resolve(false);
    lifecycle++;controls.cancelPlay();widget?.cancel();source.cancelLoad();
    const tasks=[keyboard.cancel(),source.stopCode()];
    const pending=Promise.allSettled(tasks).then(results=>{
      const failed=results.find(result=>result.status==='rejected'&&!isAbort(result.reason));if(failed)throw failed.reason;
      output();return true;
    });
    stopping=pending;void pending.finally(()=>{if(stopping===pending)stopping=null;}).catch(()=>{});return pending;
  }
  async function beforeWorkspaceReplace(){await stop();return !disposed;}
  function resetWorkspace(){
    if(disposed)return Promise.resolve(false);
    const token=++lifecycle;controls.cancelPlay();discardWidget();testFiles.clear();fileTypes.clear();
    const pending=(async()=>{
      await source.clear();if(disposed||token!==lifecycle)return false;
      session.clear();createWidget();controls.refreshSources();
      return true;
    })();
    resetting=pending;
    return pending.then(async current=>{
      if(resetting===pending)resetting=null;
      if(!current||disposed||token!==lifecycle)return false;
      return initialize();
    }).finally(()=>{if(resetting===pending)resetting=null;});
  }
  createWidget();
  const initialized=initialize().catch(error=>{report(error);return false;});
  return{source,keyboard,controls,session,readFile:reader,ready:initialized,initialize,refreshMix,setMix:refreshMix,beforeWorkspaceReplace,resetWorkspace,stop,
    get gainNode(){return getAudio()?.gain??null;},
    dispose(){
      if(disposing)return disposing;disposed=true;lifecycle++;controls.dispose();discardWidget();testFiles.clear();
      const hands=keyboard.dispose();session.dispose();
      disposing=Promise.allSettled([hands,source.dispose()]).then(()=>{dropEngine();return true;});return disposing;
    },
  };
}
