// Compact SPU Files adapter for the shared Synth Code editor.
import {createSpuFileHistory} from './file_history.js';
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {installSpuFileContextMenu} from './file_context_menu.js?v=spu-files-menu-1';
import {readVab,prepareVabTone} from './spu_synth_vab.js?v=ps1-vab-api-1';
import {createSpuCodeProject,createSpuProjectStore,readSpuProjectSound,isSpuCodePath,isSpuTextPath,SPU_PROJECT_MANIFEST,SPU_PROJECT_CODE_LENGTH,SPU_PROJECT_FILE_BYTES} from './code_project.js?v=draft-reconnect-1';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`spu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
const hasPath=(fs,path)=>typeof path==='string'&&(fs.has(path)||fs.listDirectories().includes(path));
export const SPU_SOUND_JOURNAL_KEY='tetorica-spu-synth-pending-sound-v2';
const SOUND_JOURNAL_LIMIT=384*1024;
function soundFileStem(value,extension=/\.spu\.json$/i){
  const cleaned=value.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*\ud800-\udfff]/gu,'_')
    .trim().replace(extension,'').replace(/^\.+|[. ]+$/g,'');
  // Leave room for the extension and collision suffix on exported filesystems.
  let stem='',bytes=0;
  for(const character of cleaned){const length=encoder.encode(character).length;if(bytes+length>160)break;stem+=character;bytes+=length;}
  stem=stem.replace(/[. ]+$/g,'')||'Untitled';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0].trimEnd())?'_'+stem:stem;
}
function newSoundPath(project,name,occupiedPaths){
  const stem=soundFileStem(name),fold=path=>path.normalize('NFC').toLowerCase();
  const occupied=occupiedPaths??new Set([...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].map(fold));
  let index=1,path='/presets/'+stem+'.spu.json';
  while(occupied.has(fold(path)))path=`/presets/${stem} (${++index}).spu.json`;
  return path;
}
function newVabPath(name,used){
  const stem=soundFileStem(name,/\.vab$/i);let index=1,path=`/presets/${stem}.vab`;
  while(used.has(foldedPath(path)))path=`/presets/${stem} (${++index}).vab`;return path;
}
const sameFileData=(a,b)=>a===b||a instanceof Uint8Array&&b instanceof Uint8Array&&a.length===b.length&&a.every((value,index)=>value===b[index]);
const foldedPath=path=>path.normalize('NFC').toLowerCase();
const occupied=(project,path)=>[...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].some(item=>foldedPath(item)===foldedPath(path));
function copyPath(project,path){
  const name=basename(path),directory=dirname(path),folder=project.fs.stat(path).type==='directory';
  const extension=folder?'':name.match(/\.spu\.json$/i)?.[0]??name.match(/\.[^./]+$/)?.[0]??'';
  const stem=extension?name.slice(0,-extension.length):name;
  let index=1,result;
  do{result=`${directory==='/'?'':directory}/${stem}-copy${index===1?'':`-${index}`}${extension}`;index++;}while(occupied(project,result));
  return result;
}
export function setupSpuCodeFiles({project=createSpuCodeProject(),getCachedInstrument=()=>null,getInstrument=async()=>{throw Error("Enable audio before saving a sound.");},applyInstrument=async()=>{},
  applyVabTone=async()=>{throw Error('VAB preset loading is unavailable.');},
  onBeforeWorkspaceReplace=async()=>{},onWorkspaceRestored=async()=>{},onNewProjectCommitted=async()=>{},getExportNotice=()=>'',downloadFile,setStatus=()=>{},store=createSpuProjectStore(),storage=globalThis.localStorage,document:doc=globalThis.document}={}){
  const panel=doc.getElementById('spuFilesPanel'),toggle=doc.getElementById('spuFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const presetSelect=doc.getElementById('spuPresetSelect'),presetCache=new Map();let presetSignature='',deferPersistence=0,appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('SPU Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.spu-main'),listeners=[],expanded=new Map([['/presets',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,restoring=false,persistenceReady=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false,pendingNewCassette=null,disposing=false;
  let soundEditOperation=0,pendingSoundEdit=Promise.resolve(),soundApplicationPending=false,soundGeneration=0,pendingSoundJournal=null,recoveryWarning=null;
  const history=createSpuFileHistory();let historyWarning='';
  const getSettings=()=>project.settings;
  const onBeforeSoundApply=async()=>{};
  const applySettings=(sound,options={})=>sound||options.displayPreset?applyInstrument(sound??options.displayPreset,{...options,applyAudio:options.applyAudio!==false&&Boolean(sound)}):true;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='spu-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='spu-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const saving=make('div');saving.className='spu-files-save-controls';saving.setAttribute('role','group');saving.setAttribute('aria-label','File saving');
  const autoLabel=make('label'),autoToggle=make('input','spuAutoApplyToggle');autoToggle.type='checkbox';autoToggle.checked=true;
  autoLabel.append(autoToggle,make('span',null,'Auto apply'));autoLabel.title='Save edits automatically and apply valid instrument changes. JavaScript still uses Run / Apply.';saving.append(autoLabel);
  for(const[id,label]of [['spuFileSaveButton','Save'],['spuFileSaveAllButton','Save all'],['spuFileDiscardButton','Discard'],['spuFileDiscardAllButton','Discard all']]){
    const button=make('button',id,label);button.type='button';saving.append(button);
    listen(button,'pointerdown',event=>event.preventDefault());
  }
  const actions=make('div');actions.className='spu-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const button of saving.querySelectorAll('button'))buttons.set(button.id,button);
  for(const[id,label]of [['spuFileUndoButton','Undo files'],['spuProjectNewButton','Cassette…'],['spuFileNewButton','＋ JS'],['spuFileSaveSoundButton','＋ Instrument'],['spuFileRenameButton','Rename…'],['spuFileDeleteButton','Delete…'],['spuFileImportButton','Add files…'],['spuFileExportButton','Export file'],['spuProjectExportButton','Export project'],['spuProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (id==='spuFileNewButton'||id==='spuFileSaveSoundButton'?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='spuFileUndoButton')button.title='Restore Files to before the last file operation, including both versions. Stops performance; does not run Code or play notes.';
    if(id==='spuFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    const destination={spuProjectNewButton:['spuMenuProjectNew','Cassette…'],spuProjectImportButton:['spuMenuProjectImport','Cassette · ZIP…'],spuProjectExportButton:['spuMenuProjectExport','Cassette · ZIP'],spuFileImportButton:['spuMenuFilesImport','Project files…'],spuFileExportButton:['spuMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='spuFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','spuFilesSelected','');selected.className='spu-files-path spu-sr-only';selected.setAttribute('role','status');
  const tree=make('div','spuFilesTree');tree.setAttribute('aria-label','SPU project files');
  const info=make('p','spuFilesStatus','Auto apply saves edits automatically. Turn it off to prepare changes, then Save. Importing a project never runs it.');info.className='spu-files-status';info.setAttribute('role','status');
  const fileInput=make('input','spuFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','spuProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','spuFileNameDialog'),form=make('form'),label=make('label','spuFileNameLabel','File path'),nameInput=make('input','spuFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','spuFileNameConfirm','Create'),cancel=make('button','spuFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,saving,tree,actions,selected,info,fileInput,projectInput,dialog);
  const newCassetteDialog=make('dialog','spuNewCassetteDialog'),newCassetteTitle=make('h2','spuNewCassetteTitle','Create a new Cassette?'),
    newCassetteDescription=make('p','spuNewCassetteDescription'),newCassetteActions=make('div'),
    newCassetteCancel=make('button','spuNewCassetteCancel','Cancel'),newCassetteExport=make('button','spuNewCassetteExport','Export current & create'),
    newCassetteCreate=make('button','spuNewCassetteCreate','Create without export');
  newCassetteDialog.setAttribute('aria-labelledby',newCassetteTitle.id);newCassetteActions.className='spu-new-cassette-actions';
  for(const button of [newCassetteCancel,newCassetteExport,newCassetteCreate])button.type='button';
  newCassetteActions.append(newCassetteCancel,newCassetteExport,newCassetteCreate);newCassetteDialog.append(newCassetteTitle,newCassetteDescription,newCassetteActions);doc.body.append(newCassetteDialog);
  let dialogAction=null,dialogPath=null;
  const say=message=>{if(!disposed){const text=message+(historyWarning?' '+historyWarning:'');info.textContent=text;setStatus(text);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===SPU_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  const soundPath=()=>project.activeSoundPath??null;
  const pendingMoves=()=>project.getPendingMoves?.()??[];
  function savedPath(path){
    if(!path)return path;
    const move=pendingMoves().find(([,destination])=>inside(path,destination));
    const original=move?move[0]+path.slice(move[1].length):null;
    return original&&hasPath(project.savedFs,original)?original:path;
  }
  function soundFromFile(path,fs=project.fs){
    const file=path&&fs.get(path);return file?.type==='text'?readSpuProjectSound(file.data):null;
  }
  function displaySound(){try{return soundFromFile(soundPath())??project.settings;}catch{return project.settings;}}
  function capture(){
    const snapshot={...project.snapshot(),codeState:code?.captureState?.()??project.getCodeState()};
    // Native VAB Tone selection deliberately has no editable JSON yet. Retain
    // its already-validated authored cache without requesting or opening audio.
    if(!snapshot.settings){const cached=getCachedInstrument();if(cached){const sound=readSpuProjectSound(cached);if(!sound)throw Error('Invalid cached SPU instrument');snapshot.settings=sound;snapshot.savedSettings=structuredClone(sound);}}
    return{project:snapshot,appliedPreset:appliedPreset?structuredClone(appliedPreset):null,filesVisible:!panel.hidden};
  }
  function pushHistory(value){
    historyWarning=history.push(value)?'':'Undo unavailable for this operation: its snapshot exceeds the 32 MiB history limit.';
    if(historyWarning)say('File operation completed.');
  }
  function expandedSavePaths(paths){
    const result=new Set(paths);
    for(const path of paths)for(const[source,destination]of pendingMoves()){
      if(inside(path,destination))result.add(source+path.slice(destination.length));
      if(inside(path,source))result.add(destination+path.slice(source.length));
      if(inside(source,path)||inside(destination,path)){result.add(source);result.add(destination);}
    }
    return [...result].filter(path=>hasPath(project.fs,path)||hasPath(project.savedFs,path));
  }
  function clearMoves(paths){project.setPendingMoves?.(pendingMoves().filter(([source,destination])=>!paths.some(path=>inside(source,path)||inside(destination,path))));}
  function protectSound(){
    const path=soundPath();if(!path||!storage)return;
    try{
      const current=project.fs.get(path),saved=project.savedFs.get(savedPath(path));
      if((current?.data?.length??0)+(saved?.data?.length??0)>SOUND_JOURNAL_LIMIT)throw Error('The edited instrument exceeds the immediate recovery limit.');
      const raw=JSON.stringify({version:1,workspaceId:identity,generation:++soundGeneration,path,
        workingText:current?.type==='text'?current.data:null,savedText:saved?.type==='text'?saved.data:null,
        savedPath:savedPath(path),autoSave:project.autoApply,settings:project.settings,savedSettings:project.savedSettings,pendingMoves:pendingMoves()});
      if(encoder.encode(raw).byteLength>SOUND_JOURNAL_LIMIT)throw Error('The edited instrument exceeds the immediate recovery limit.');
      storage.setItem(SPU_SOUND_JOURNAL_KEY,raw);pendingSoundJournal=raw;recoveryWarning=null;
    }catch(error){const warning=path+':'+error.message;if(recoveryWarning!==warning){recoveryWarning=warning;say(`Immediate sound recovery unavailable: ${error.message} Keep this page open until its local draft is saved, or Export Cassette.`);}}
  }
  function canEditSound(){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before editing the instrument.');
    const path=soundPath();if(!path)return true;
    try{if(!soundFromFile(path))throw Error('Expected a SPU sound JSON.');}
    catch(error){throw Error(`Finish or Discard the JSON edits in ${path} before changing its controls. ${error.message}`);}
    return true;
  }
  function adoptExternalSound(value){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before loading an instrument.');
    const sound=readSpuProjectSound(value);if(!sound)throw Error('Expected a SPU instrument.');
    soundEditOperation++;soundApplicationPending=false;soundGeneration++;editRevision++;
    project.setActiveSoundPath(null);project.setSettings(sound);project.setSavedSettings(sound);appliedPreset=null;
    render();schedule();return sound;
  }
  function recordSoundEdit(value=getSettings(),{allowExternal=false}={}){
    canEditSound();const sound=readSpuProjectSound(value);if(!sound)throw Error('Expected a SPU instrument.');
    const active=soundPath(),path=active??newSoundPath(project,sound.name),source=JSON.stringify(sound,null,2)+'\n';
    const bytes=encoder.encode(source).byteLength+project.listEntries().reduce((total,file)=>total+(file.path===path?0:file.size),0);
    if(bytes>SPU_PROJECT_FILE_BYTES){
      if(!project.autoApply)throw Error('This instrument exceeds the 16 MiB Project file limit. Its controls were not changed. Use a smaller Project preset, or enable Auto apply for live editing and Export preset to keep the sound.');
      if(active&&!allowExternal)throw Error('This instrument exceeds the 16 MiB Project file limit. Its linked JSON was kept. Export preset to keep a larger standalone instrument.');
      adoptExternalSound(sound);say('This standalone instrument is outside the 16 MiB Project file limit. The previous files were kept. Use Export preset to keep this sound.');return null;
    }
    if(!active){project.importFiles([{path,type:'text',data:source}]);project.setActiveSoundPath(path);}
    else project.writeEditorText(path,source);
    soundEditOperation++;soundApplicationPending=false;
    editRevision++;project.setSettings(sound);if(project.autoApply)project.setSavedSettings(sound);
    project.select(path);appliedPreset={kind:'json',path,data:project.fs.get(path).data};reveal(path);
    if(code?.activePath===path)code.reloadFile?.(path);
    protectSound();render();schedule();return path;
  }
  function codeEdited(path){
    if(disposed)return;project.select(path);if(path!==soundPath())return;
    let sound;try{sound=soundFromFile(path);if(!sound)throw Error('Expected a SPU sound JSON.');}
    catch(error){protectSound();say(`JSON not applied; current sound kept. ${error.message}`);return;}
    const token=++soundEditOperation,workspace=identity;soundApplicationPending=false;
    project.setSettings(sound);if(project.autoApply)project.setSavedSettings(sound);
    editRevision++;appliedPreset={kind:'json',path,data:project.fs.get(path).data};protectSound();
    soundApplicationPending=true;
    pendingSoundEdit=Promise.resolve().then(async()=>{
      const current=()=>!disposed&&token===soundEditOperation&&workspace===identity&&soundPath()===path;
      const result=await applySettings(sound,{record:false,source:'json',load:false,applyAudio:project.autoApply,displayPreset:sound,isCurrent:current});
      // An incomplete later edit is source text, not a newer playable command.
      // Keep this last valid command, then restore its warning after the ack.
      if(current())try{if(!soundFromFile(path))throw Error('Expected a SPU sound JSON.');}catch(error){say(`JSON not applied; current sound kept. ${error.message}`);}
      return result;
    }).catch(report).finally(()=>{if(token===soundEditOperation)soundApplicationPending=false;});
    render();schedule();
  }
  async function recoverCodeState(path){
    if(disposed||path!==soundPath())return false;
    let working=null,accepted=null;
    try{working=soundFromFile(path);}catch{}
    try{accepted=soundFromFile(savedPath(path),project.savedFs);}catch{}
    if(accepted)project.setSavedSettings(accepted);
    project.setSettings(working??accepted??project.settings);
    const token=++soundEditOperation,workspace=identity;soundApplicationPending=false;
    await applySettings(project.savedSettings,{record:false,source:'restore',load:false,applyAudio:true,displayPreset:project.settings,
      isCurrent:()=>!disposed&&token===soundEditOperation&&workspace===identity});
    appliedPreset={kind:'json',path,data:project.fs.get(path)?.data};protectSound();render();schedule();return true;
  }
  async function applyAccepted({source='save',load=false,isCurrent=()=>!disposed}={}){
    const path=soundPath(),acceptedPath=savedPath(path);let accepted=project.savedSettings,error=null;
    if(path&&project.savedFs.has(acceptedPath)){
      try{accepted=soundFromFile(acceptedPath,project.savedFs);if(!accepted)throw Error('Expected a SPU sound JSON.');project.setSavedSettings(accepted);}
      catch(reason){error=reason;accepted=null;}
    }
    if(accepted)await applySettings(accepted,{record:false,source,load,applyAudio:true,displayPreset:displaySound(),isCurrent});
    return error;
  }
  async function saveCurrent(all=false){
    await api.ready;if(disposed||busy)return false;
    if(await code?.flush?.({persist:false})===false)return false;await pendingSoundEdit;if(disposed||busy)return false;
    const path=project.selectedPath??code?.activePath??soundPath();if(!all&&!path)return false;
    const requested=all?project.getDirtyPaths():[path],targets=all?requested:expandedSavePaths(requested),before=requested.some(path=>project.isFileModified(path))?capture():null;setBusy(true,{lockMain:false});
    try{
      if(all)project.saveAll();else if(targets.length)project.saveFiles(targets);clearMoves(targets);if(before)pushHistory(before);
      if(soundPath()&&!project.fs.has(soundPath())&&!project.savedFs.has(soundPath()))project.setActiveSoundPath(null);
      const active=soundPath(),changesSound=Boolean(active&&(all||targets.some(target=>inside(active,target))));
      const invalid=changesSound?await applyAccepted():null;
      await code?.flush?.({persist:false});protectSound();const durable=await persistCode();render();
      say(`Saved ${all?'all files':path}.${invalid?` JSON not applied; current sound kept. ${invalid.message}`:''}${durable===false?' Local draft unavailable; Export Cassette to keep both versions.':''}`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function discardCurrent(all=false){
    await api.ready;if(disposed||busy)return false;
    if(await code?.flush?.({persist:false})===false)return false;await pendingSoundEdit;
    const path=project.selectedPath??code?.activePath??soundPath();if(all?!project.getDirtyPaths().length:!path||!project.isFileModified(path))return false;
    const original=path?savedPath(path):null,active=soundPath(),activeOriginal=active?savedPath(active):null;
    const codePath=code?.activePath,codeOriginal=codePath?savedPath(codePath):null;
    const targets=all?project.getDirtyPaths():expandedSavePaths([path]),before=capture();setBusy(true,{lockMain:false});
    try{
      project.discardFiles(targets);clearMoves(targets);pushHistory(before);
      if(all&&codePath&&codePath!==codeOriginal)code?.pathChanged?.(codePath,codeOriginal,{preserveExecution:!project.autoApply});
      else if(!all&&path!==original)code?.pathChanged?.(path,original,{preserveExecution:!project.autoApply});
      if(active&&(all||inside(active,path))){
        const target=all?activeOriginal:original+active.slice(path.length);project.setActiveSoundPath(project.fs.has(target)?target:null);
        if(project.activeSoundPath){const sound=soundFromFile(target);if(sound)project.setSettings(sound);}
        else project.setSettings(project.savedSettings);
        await applySettings(project.savedSettings,{record:false,source:'discard',load:false,applyAudio:false,displayPreset:displaySound()});
      }
      project.select(hasPath(project.fs,original)?original:null);await code?.reloadFile?.();protectSound();render();await persistCode();say(all?'Discarded all unsaved file changes.':`Discarded changes to ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function setAutoApply(enabled){
    await api.ready;if(disposed||busy)return false;
    if(await code?.flush?.({persist:false})===false)return false;await pendingSoundEdit;
    if(project.autoApply===enabled)return true;
    const before=capture();setBusy(true,{lockMain:false});
    try{
      project.setAutoApply(enabled);pushHistory(before);let invalid=null;
      if(enabled)invalid=await applyAccepted({source:'auto'});
      else await applySettings(project.savedSettings,{record:false,source:'auto',applyAudio:false,displayPreset:displaySound()});
      await code?.flush?.({persist:false});protectSound();render();const durable=await persistCode();
      say(`${enabled?'Auto apply on. Edits save automatically.':'Auto apply off. Edit files, then Save to apply changes.'}${invalid?` JSON not applied; current sound kept. ${invalid.message}`:''}${durable===false?' Local draft unavailable; Export Cassette to keep both versions.':''}`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function undo(){
    await api.ready;if(disposed||disposing||busy||pendingNewCassette!==null||!history.peek())return false;
    const token=++operation,current=()=>!disposed&&!disposing&&token===operation;
    if(await code?.flush?.({persist:false})===false||!current())return false;
    let pending;do{pending=pendingSoundEdit;await pending;}while(current()&&pending!==pendingSoundEdit);
    if(!current())return false;
    // A corrupt/incompatible entry must reject before stopping any owner.
    const entry=history.peek(),candidate=createSpuCodeProject({snapshot:entry.project}),before=capture(),oldIdentity=identity,oldPersistence=persistenceReady;
    let retired=false,applied=false,committed=false;
    setBusy(true);persistenceReady=false;restoring=true;
    try{
      retired=true;
      if(await code?.workspaceReplaced?.()===false||!current())return false;
      if(await onBeforeWorkspaceReplace({reason:'undo',isCurrent:current})===false||!current())return false;
      soundEditOperation++;soundApplicationPending=false;
      project.restore(candidate.snapshot());identity=workspaceId();appliedPreset=entry.appliedPreset;presetCache.clear();
      applied=true;
      if(await applySettings(project.savedSettings,{record:false,source:'undo',load:false,applyAudio:true,displayPreset:project.settings,isCurrent:current})===false||!current())return false;
      if(await code?.restoreState?.(project.getCodeState())===false||!current())return false;
      history.pop();historyWarning='';committed=true;
      soundGeneration=0;pendingSoundJournal=null;recoveryWarning=null;
      try{storage?.removeItem(SPU_SOUND_JOURNAL_KEY);}catch{}
      setVisible(entry.filesVisible);protectSound();restoring=false;persistenceReady=oldPersistence;
      render();const durable=await persistCode();
      say('Undid file operation. Performance stopped; Code was not run.'+(durable===false?' Local save unavailable; Export Cassette to keep the restored files.':''));return true;
    }finally{
      if(!committed&&retired){
        project.restore(before.project);identity=oldIdentity;appliedPreset=before.appliedPreset;presetCache.clear();
        if(!disposed&&!disposing){
          if(applied)try{
            if(await applySettings(project.savedSettings,{record:false,source:'undo-rollback',load:false,applyAudio:true,displayPreset:project.settings,isCurrent:()=>!disposed&&!disposing&&token===operation})===false)throw Error('Sound restoration cancelled');
          }catch(error){report(Error('Current sound could not be restored: '+error.message));}
          try{await code?.restoreState?.(project.getCodeState());}catch(error){report(Error('Current editor could not be restored: '+error.message));}
          setVisible(before.filesVisible);
        }
      }
      restoring=false;persistenceReady=oldPersistence;
      if(!disposed&&!disposing){setBusy(false);if(!committed)schedule();}
    }
  }
  function vabPreset(file){
    let saved=presetCache.get(file.path);
    if(saved?.kind==='vab'&&(Number.isSafeInteger(file.revision)?saved.revision===file.revision:sameFileData(saved.data,file.data)))return saved;
    saved={kind:'vab',data:file.data,revision:file.revision,bank:null,tones:[]};
    try {
      saved.bank=readVab(file.data);const available=new Map();
      saved.bank.tones.forEach((tone,toneNumber)=>{
        if(!available.has(tone.sample)){try{prepareVabTone(saved.bank,toneNumber);available.set(tone.sample,true);}catch{available.set(tone.sample,false);}}
        if(available.get(tone.sample))saved.tones.push({toneNumber,program:tone.program,index:tone.index});
      });
    }catch{}
    presetCache.set(file.path,saved);return saved;
  }
  function renderPresets(files){
    if(!presetSelect){const paths=new Set(files.map(file=>file.path));for(const path of presetCache.keys())if(!paths.has(path))presetCache.delete(path);return;}
    const present=new Set(),entries=[];
    for(const file of files) {
      if(!file.path.startsWith('/presets/'))continue;
      if(file.type==='binary'&&/\.vab$/i.test(file.path)) {
        present.add(file.path);const saved=vabPreset(file);
        for(const tone of saved.tones)entries.push({kind:'vab',path:file.path,toneNumber:tone.toneNumber,value:`vab:${encodeURIComponent(file.path)}#${tone.toneNumber}`,
          label:`Program ${tone.program} · Tone ${tone.index} · ${file.path}`});
        continue;
      }
      if(file.type!=='text'||!/\.json$/i.test(file.path))continue;
      present.add(file.path);let saved=presetCache.get(file.path);
      if(saved?.kind!=='json'||saved.data!==file.data) {
        let name=null;try{name=readSpuProjectSound(file.data)?.name??null;}catch{}
        saved={kind:'json',data:file.data,name};presetCache.set(file.path,saved);
      }
      if(saved.name!==null)entries.push({kind:'json',path:file.path,value:file.path,label:`${saved.name} · ${file.path}`});
    }
    for(const path of presetCache.keys())if(!present.has(path))presetCache.delete(path);
    entries.sort((a,b)=>Number(a.kind!=='vab')-Number(b.kind!=='vab')||a.path.localeCompare(b.path)||(a.toneNumber??0)-(b.toneNumber??0));presetOptions=new Map(entries.map(entry=>[entry.value,entry]));
    const signature=JSON.stringify(entries);
    if(signature!==presetSignature) {
      presetSignature=signature;const placeholder=make('option',null,entries.length?'Load preset…':'No playable presets');placeholder.value='';placeholder.disabled=true;
      const groups=['vab','json'].map(kind=>{const group=make('optgroup');group.label=kind==='vab'?'VAB · Program / Tone':'SPU JSON';
        for(const entry of entries.filter(entry=>entry.kind===kind)){const option=make('option',null,entry.label);option.value=entry.value;option.title=entry.path;group.append(option);}return group;}).filter(group=>group.children.length);
      presetSelect.replaceChildren(placeholder,...groups);
    }
    const applied=appliedPreset&&entries.find(entry=>entry.kind===appliedPreset.kind&&entry.path===appliedPreset.path&&entry.toneNumber===appliedPreset.toneNumber&&sameFileData(presetCache.get(entry.path)?.data,appliedPreset.data));
    if(applied)appliedPreset.data=presetCache.get(applied.path).data;else appliedPreset=null;
    presetSelect.value=applied?.value??'';
    presetSelect.disabled=busy||!entries.length;
  }
  function render(){
    if(disposed)return;const selectedPath=project.selectedPath??'';if(selected.textContent!==selectedPath)selected.textContent=selectedPath;
    panel.setAttribute('aria-busy',String(busy));
    const files=project.fs.list().filter(file=>!isCheckpointPath(file.path));renderPresets(files);
    renderFileTree(tree,[...files,...project.fs.listDirectories().filter(path=>path!=='/'&&!isCheckpointPath(path)).map(path=>({path,type:'directory'}))],{
      selectedPath:project.selectedPath,expanded,onOpen:path=>void selectFile(path).catch(report),
      onImport:files=>void importFiles(files).catch(report),onTransfer:(source,destination,copy)=>void move(source,destination,copy).catch(report)});
    for(const entry of tree.querySelectorAll('[data-file-path]')){
      const path=entry.getAttribute('data-file-path'),dirty=project.isFileModified(path);entry.dataset.unsaved=String(dirty);
      if(dirty){const dot=make('span',null,' ●');dot.className='spu-file-unsaved';dot.setAttribute('aria-label','Unsaved changes');entry.append(dot);}
    }
    for(const[id,button]of buttons)button.disabled=busy||(['spuFileExportButton','spuFileRenameButton','spuFileDeleteButton'].includes(id)&&!project.selectedPath);
    buttons.get('spuFileSaveButton').disabled=busy||!(project.selectedPath??code?.activePath??soundPath());
    buttons.get('spuFileSaveAllButton').disabled=busy||!project.getDirtyPaths().length;
    buttons.get('spuFileDiscardButton').disabled=busy||!project.selectedPath||!project.isFileModified(project.selectedPath);
    buttons.get('spuFileDiscardAllButton').disabled=busy||!project.getDirtyPaths().length;
    buttons.get('spuFileUndoButton').disabled=busy||!history.read().entries;
    autoToggle.checked=project.autoApply;autoToggle.disabled=busy;
    newCassetteExport.disabled=newCassetteCreate.disabled=busy;

    code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value,{lockMain=true}={}){busy=value;if(main)main.inert=Boolean(value&&lockMain);render();}
  async function persistCode({force=false}={}){
    if(disposed||!persistenceReady||restoring||deferPersistence&&!force)return false;
    const journal=pendingSoundJournal,generation=soundGeneration,workspace=identity;
    try{const result=await store.write({...project.snapshot(),workspaceId:workspace,soundGeneration:generation,filesVisible:!panel.hidden});
      if(result!==false&&identity===workspace&&soundGeneration===generation&&pendingSoundJournal===journal&&journal){try{if(storage?.getItem(SPU_SOUND_JOURNAL_KEY)===journal)storage.removeItem(SPU_SOUND_JOURNAL_KEY);}catch{}pendingSoundJournal=null;}return result;}
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring||deferPersistence)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  const executionPath=()=>code?.executionPath??(isSpuCodePath(code?.activePath)?code.activePath:null);
  const openInCurrentMode=path=>code?.openFile?.(path,{show:Boolean(code?.isCodeMode?.())});
  function reveal(path){for(let directory=dirname(path);directory!=='/';directory=dirname(directory))expanded.set(directory,true);}
  async function selectFile(path){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();await pendingSoundEdit;if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isSpuCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null,accepted=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readSpuProjectSound(file.data);}catch(error){soundError=error;}}
    try{accepted=soundFromFile(savedPath(path),project.savedFs);}catch{}
    const instrument=Boolean(sound||accepted||path===soundPath()||/\.spu\.json$/i.test(path));
    if(instrument){
      accepted=project.autoApply?sound:accepted;
      const audible=accepted??project.savedSettings,display=sound??accepted??project.settings;
      setBusy(true);
      try{
        if(accepted)await onBeforeSoundApply();if(disposed||token!==operation)return false;
        const applied=(sound||accepted)?await applySettings(audible,{record:false,source:'selection',load:true,applyAudio:Boolean(accepted),displayPreset:display,isCurrent:()=>!disposed&&token===operation}):true;
        if(applied===false||disposed||token!==operation)return false;
      }finally{
        if(!disposed){
          // A Stop can arrive after the chip committed but before its reply.
          // Persist the host's reconciled sound without marking a failed file
          // selection as the applied preset.
          if(token===operation){project.setSettings(getSettings());if(project.autoApply)project.setSavedSettings(project.settings);}
          setBusy(false);if(token===operation)schedule();
        }
      }
    }
    if(instrument){project.setActiveSoundPath(path);if(sound)project.setSettings(sound);if(accepted)project.setSavedSettings(accepted);appliedPreset={kind:'json',path,data:file.data};}
    project.select(path);render();schedule();
    if(file.type==='text')await openInCurrentMode(path);
    if(disposed||token!==operation)return false;
    say(sound?(project.autoApply?'SPU sound loaded. Controls and valid JSON edits update this file automatically.':'Sound draft selected. Saved sound plays; Save applies your edits.'):soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:/\.vab$/i.test(path)?'VAB bank selected. Choose a Program / Tone from Preset to load it; banks outside /presets can be moved there.':file.type==='text'?'Text edits save to Files from Code; valid edits to the active sound follow Auto apply.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function selectVabTone(path,toneNumber){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation,current=()=>!disposed&&token===operation;
    await code?.flush?.();if(!current())return false;
    path=allowed(path);const file=project.fs.get(path);
    if(file?.type!=='binary'||!/\.vab$/i.test(path))throw Error('Choose a saved VAB bank.');
    const saved=vabPreset(file);if(!saved.bank)throw Error('This VAB bank is unavailable.');
    prepareVabTone(saved.bank,toneNumber);const tone=saved.bank.tones[toneNumber];setBusy(true);
    try {
      if(!current())return false;
      if(await applyVabTone({bank:saved.bank,toneNumber,path,name:basename(path)},{isCurrent:current})===false)return false;if(!current())return false;
      soundEditOperation++;project.setActiveSoundPath(null);project.setSettings(null);project.setSavedSettings(null);
      appliedPreset={kind:'vab',path,data:saved.data,toneNumber};project.select(path);render();schedule();
      say(`Loaded ${basename(path)} · Program ${tone.program} · Tone ${tone.index}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importFiles(files){
    await api.ready;if(disposed||busy)return[];const token=++operation;
    const entries=[];for(const file of files){if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());entries.push({path:'/'+basename(file.name),type:isSpuTextPath(file.name)?'text':'binary',data:isSpuTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(disposed||token!==operation)return[];await code?.flush?.();if(disposed||token!==operation)return[];
    const candidate=createSpuCodeProject({snapshot:project.snapshot()}),paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    const before=capture();setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||disposed||token!==operation)return[];}
      if(disposed||token!==operation)return[];
      for(const path of paths)if(/\.vab$/i.test(path))presetCache.delete(path);
      project.restore(candidate.snapshot());pushHistory(before);
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
      render();await persistCode();say(`Added ${paths.length} file(s). Code was not run.`);return paths;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importProject(bytes){
    await api.ready;if(disposed||busy)return false;const token=++operation;
    const candidate=await project.prepareImport(bytes);if(disposed||token!==operation)return false;
    await code?.flush?.();if(disposed||token!==operation)return false;const before=capture();setBusy(true);
    try{
      if(await code?.workspaceReplaced?.()===false||disposed||token!==operation)return false;
      await onBeforeWorkspaceReplace();if(disposed||token!==operation)return false;
      restoring=true;try{soundEditOperation++;appliedPreset=null;presetCache.clear();project.restore(candidate);identity=workspaceId();pushHistory(before);}finally{restoring=false;}
      await onWorkspaceRestored({settings:project.settings,savedSettings:project.savedSettings});
      await code?.restoreState?.(project.getCodeState());await persistCode();say('SPU project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();await pendingSoundEdit;return project.exportProject();}
	function cancelNewCassette() {
		if (pendingNewCassette !== null) operation++;
		newCassetteDialog.close();
	}
	function askNewCassette() {
		if (disposed || disposing || busy) return;
		const notice=getExportNotice(),dirty=project.getDirtyPaths().length;
        newCassetteDescription.dataset.unsaved=String(dirty);
		newCassetteDescription.textContent='This replaces the current browser project and stops its performance. The new Cassette contains the default Sine sound, starter Code. Code will not run automatically.'+(dirty?` ${dirty} unsaved path(s); Export keeps saved and working versions.`:'')+(notice?' '+notice:'');
		newCassetteDialog.showModal();
		newCassetteCancel.focus();
	}
	async function newProject({ exportCurrent = false } = {}) {
		if (typeof exportCurrent !== 'boolean') throw TypeError('exportCurrent must be a boolean.');
		await api.ready;
		if (disposed || disposing || busy || pendingNewCassette !== null) return false;
		const token = ++operation,
			current = () => !disposed && !disposing && token === operation;
		const previousIdentity = identity, previousPersistence = persistenceReady,previousApplied=appliedPreset?structuredClone(appliedPreset):null,previousVisible=!panel.hidden;
		const backupNotice=exportCurrent?getExportNotice():'';
		let previous = null, retired = false, applyAttempted = false, committed = false, failure = null, locked=false, cleanupError=null;
		pendingNewCassette = token;
		clearTimeout(saveTimer);
		try {
			// Build/validate defaults before retiring Code or the song owner.
			const fresh = createSpuCodeProject({ snapshot: project.prepareNew() });
			if ((await code?.flush?.()) === false || !current()) return false;
            // Cache + pending edit flush captures both author versions without
            // starting audio or sampling temporary Code/PSF performance data.
            let pending;
            do{pending=pendingSoundEdit;await pending;}while(current()&&pending!==pendingSoundEdit);
            if(!current())return false;setBusy(true);locked=true;restoring=true;
            previous=createSpuCodeProject({snapshot:capture().project}).snapshot();
			if (exportCurrent) {
				const oldProject = createSpuCodeProject({ snapshot: previous });
				const exported = await (downloadFile ?? download)(oldProject.exportProject(),
					oldProject.cassetteName + '.cassette.zip', 'application/zip');
				if (exported === false || !current()) return false;
			}
			if (!current()) return false;
			// Defer saves until both replacement and editor restoration commit.
			persistenceReady = false;
			retired = true;
			if ((await code?.workspaceReplaced?.()) === false || !current()) return false;
			if ((await onBeforeWorkspaceReplace({ reason:'new',isCurrent:current })) === false || !current()) return false;
			applyAttempted = true;
			if ((await applySettings(fresh.savedSettings, { record:false,source:'restore',load:false,applyAudio:true,displayPreset:fresh.settings,isCurrent:current })) === false || !current()) return false;
			project.restore(fresh.snapshot());
			identity = workspaceId();
			if ((await code?.restoreState?.(project.getCodeState())) === false || !current()) return false;
			committed = true;
            pushHistory({project:previous,appliedPreset:previousApplied,filesVisible:previousVisible});
            try{await onNewProjectCommitted({isCurrent:current});}catch(error){cleanupError=error;report(error);}
            soundGeneration=0;pendingSoundJournal=null;recoveryWarning=null;
            try{storage?.removeItem(SPU_SOUND_JOURNAL_KEY);}catch{}
			soundEditOperation++;
			persistenceReady = true;
			restoring = false;
			appliedPreset = null;
			presetCache.clear();
			newCassetteDialog.close();
			const persisted = await persistCode();
			say('New SPU Cassette created. Code was not run.' +
				(persisted === false ? ' Local save unavailable; export the project to keep it.' : ' Saved locally.')+(cleanupError?' Source cleanup failed: '+cleanupError.message:'')+(backupNotice?' '+backupNotice:''));
			return true;
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			if (!committed) {
				persistenceReady = previousPersistence;
				if (previous && retired) {
					project.restore(previous);
					identity = previousIdentity;
					if (!disposed && !disposing) {
						if (applyAttempted) {
							try {
							if ((await applySettings(previous.savedSettings??previous.settings, {
								record:false,source:'restore',load:false,applyAudio:true,displayPreset:previous.settings,
									isCurrent: () => !disposed && !disposing && pendingNewCassette === token,
								})) === false) throw Error('Sound restoration was cancelled.');
							} catch (error) { report(Error('Previous sound could not be restored: ' + error.message)); }
						}
						try { await code?.restoreState?.(previous.codeState); }
						catch (error) { report(Error('Previous Code display could not be restored: ' + error.message)); }
					}
				}
			}
			restoring = false;
			if (!committed && !failure && current()) say('New Cassette was not created; previous project kept.'+(retired?' Performance remains stopped.':''));
			if (pendingNewCassette === token) {
				pendingNewCassette = null;
				if (!disposed && !disposing) {
					if(locked)setBusy(false);
					if (!committed && persistenceReady) schedule();
				}
			}
		}
	}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true,{lockMain:!copy});
    try{
      if(occupied(project,destination)&&(copy||foldedPath(source)!==foldedPath(destination)))throw Error('That path already exists.');
      for(const file of project.fs.list())if(inside(file.path,source)&&isSpuCodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>SPU_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createSpuCodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&project.autoApply&&movedCodePath&&!isSpuCodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
      if(disposed||token!==operation)return false;
      const before=capture(),previousApplied=appliedPreset,active=soundPath();
      let moves=null;
      if(!copy&&!project.autoApply){
        const prior=pendingMoves(),covered=prior.some(([,to])=>inside(source,to));
        if(prior.some(([,to])=>source!==to&&inside(source,to)))throw Error('Save or Discard the parent folder rename before moving files inside it.');
        moves=prior.map(([from,to])=>[from,inside(to,source)?destination+to.slice(source.length):to]);
        if(hasPath(project.savedFs,source)&&!covered&&!moves.some(([from])=>from===source))moves.push([source,destination]);
        createSpuCodeProject().setPendingMoves(moves);
      }
      if(!copy&&appliedPreset&&inside(appliedPreset.path,source))appliedPreset={...appliedPreset,path:destination+appliedPreset.path.slice(source.length)};
      try{if(copy)project.fs.restore(copied);else transferVirtualFiles(project.fs,source,destination);}
      catch(error){appliedPreset=previousApplied;throw error;}
      if(!copy){
        if(moves)project.setPendingMoves(moves);
        if(active&&inside(active,source)){const path=destination+active.slice(source.length);project.setActiveSoundPath(isSpuTextPath(path)?path:null);}
        if(inside(project.selectedPath,source))project.select(destination+project.selectedPath.slice(source.length));
        if(project.autoApply)code?.pathChanged?.(source,destination);else code?.pathChanged?.(source,destination,{preserveExecution:true});
      }
      pushHistory(before);protectSound();
      render();await persistCode();return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function duplicate(path){
    await api.ready;if(disposed||busy)return false;path=allowed(path);const destination=copyPath(project,path);
    if(!await move(path,destination,true)||disposed)return false;
    const token=operation;project.select(destination);reveal(destination);render();
    if(project.fs.get(destination)?.type==='text')await openInCurrentMode(destination);
    if(disposed||token!==operation)return false;await persistCode();say(`Duplicated ${path} to ${destination}.`);return destination;
  }
  async function remove(path){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;path=allowed(path);setBusy(true);
    try{const before=capture();if(project.autoApply&&inside(executionPath(),path))await code.stop();if(disposed||token!==operation)return false;
      if(inside(project.selectedPath,path))project.select(null);
      project.fs.remove(path,{recursive:true});
      if(project.autoApply)code?.pathChanged?.(path,null);else code?.pathChanged?.(path,null,{preserveExecution:true});
      if(project.autoApply&&inside(soundPath(),path))project.setActiveSoundPath(null);
      pushHistory(before);protectSound();render();await persistCode();return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function createFile(path){
    await api.ready;if(disposed||busy)return false;const token=++operation,directory=String(path).endsWith('/');path=allowed(path);
    await code?.flush?.();if(disposed||token!==operation)return false;
    if(occupied(project,path))throw Error('That path already exists.');setBusy(true,{lockMain:false});
    try{
      const before=capture(),candidate=createSpuCodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
      candidate.restore(candidate.snapshot());project.fs.restore(candidate.fs.snapshot());pushHistory(before);project.select(path);reveal(path);if(directory)expanded.set(path,true);render();
      if(!directory)await openInCurrentMode(path);if(disposed||token!==operation)return false;
      await persistCode();say(`Created ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSound({path:requestedPath}={}){
    if(disposed||busy)return false;const token=++operation;setBusy(true,{lockMain:false});
    try{
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.spu\.json$/i.test(requestedPath))throw Error('Use a .spu.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      const sound=readSpuProjectSound((project.autoApply?await getInstrument():project.settings??await getInstrument()));if(!sound)throw Error('Expected an SPU instrument.');
      if(disposed||token!==operation)return false;
      const path=requestedPath??newSoundPath(project,sound.name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){sound.name=basename(path).replace(/\.spu\.json$/i,'');readSpuProjectSound(sound);}
      // importFiles validates its candidate before touching this workspace.
      // Name / size failures must keep both existing files and selection.
      const before=capture();project.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);pushHistory(before);
      project.saveFiles([path]);project.setActiveSoundPath(path);project.setSettings(sound);project.setSavedSettings(sound);
      if(!project.autoApply)await applySettings(sound,{record:false,source:'save',load:false,applyAudio:true,displayPreset:sound});
      project.select(path);reveal(path);setVisible(true);render();
      await code?.openFile?.(path,{show:false});if(disposed||token!==operation)return false;
      const persisted=await persistCode();
      say('Current SPU instrument and sample saved to '+path+(persisted===false?' in Files. Local save unavailable; export the project to keep it.':''));return path;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveInstruments(sounds,{assets=[],isCurrent=()=>true}={}){
    if(!Array.isArray(sounds)||!Array.isArray(assets)||typeof isCurrent!=='function')throw TypeError('Preset batch needs instrument documents, VAB assets and a current-operation callback.');
    await api.ready;if(disposed||busy||!isCurrent())return false;if(!sounds.length&&!assets.length)return [];
    const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    setBusy(true,{lockMain:false});deferPersistence++;clearTimeout(saveTimer);saveTimer=null;
    let flushed=false,completed=false;
    try {
      const prepared=[];let batchBytes=0;
      for(const value of sounds) {
        const sound=readSpuProjectSound(value);if(!sound)throw Error('Expected an SPU instrument in the preset batch.');
        const data=JSON.stringify(sound,null,2)+'\n';batchBytes+=encoder.encode(data).byteLength;
        if(batchBytes>SPU_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit.');
        prepared.push({name:sound.name,data});
      }
      const binaries=assets.map(asset=>{
        if(!asset||typeof asset.name!=='string'||!asset.name.trim()||!(asset.data instanceof Uint8Array))throw TypeError('A VAB preset asset needs a name and Uint8Array bytes.');
        const data=asset.data.slice();readVab(data);batchBytes+=data.byteLength;
        if(batchBytes>SPU_PROJECT_FILE_BYTES)throw Error('Code project files exceed the 16 MiB cassette limit.');
        return {name:asset.name,data};
      });
      if(await code?.flush?.()===false)return false;flushed=true;if(!current())return false;
      // Build against the latest Files after flushing, so neither capacity
      // validation nor an atomic bank import can discard unsaved Code edits.
      const used=new Set([...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].map(foldedPath));
      const entries=prepared.map(sound=>{const path=newSoundPath(project,sound.name,used);used.add(foldedPath(path));return {path,type:'text',data:sound.data,name:sound.name};});
      const binaryEntries=binaries.map(asset=>{const path=newVabPath(asset.name,used);used.add(foldedPath(path));return {path,type:'binary',data:asset.data};});
      if(!current())return false;
      if(presetSelect)for(const entry of entries)presetCache.set(entry.path,{kind:'json',data:entry.data,name:entry.name});
      const before=capture();project.importFiles([...entries.map(({name,...entry})=>entry),...binaryEntries]);pushHistory(before);
      const paths=entries.map(entry=>entry.path),selectedPath=paths[0]??binaryEntries[0].path;project.select(selectedPath);reveal(selectedPath);setVisible(true);render();
      if(paths.length)await code?.openFile?.(paths[0],{show:false});if(!current())return false;
      const persisted=await persistCode({force:true});completed=true;if(!current())return false;
      say(`Saved ${binaryEntries.length?`${binaryEntries.length} VAB bank${binaryEntries.length===1?'':'s'} and `:''}${paths.length} JSON preset${paths.length===1?'':'s'} to /presets.`+(persisted===false?' Local save unavailable; export the project to keep them.':''));return paths;
    }finally {
      deferPersistence--;if(!disposed){setBusy(false);if(flushed&&!completed)schedule();}
    }
  }
  function download(bytes,filename,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action,path=project.selectedPath){
    if(disposed||busy)return;dialogAction=action;dialogPath=path;
    const directory=path&&project.fs.stat(path).type==='directory'?path:path?dirname(path):'/';
    label.textContent={delete:'Delete this project path?',rename:'New file path',instrument:'New instrument · .spu.json path',folder:'New folder path',new:'New JavaScript file path'}[action];
    nameInput.value=action==='new'?`${directory==='/'?'':directory}/untitled.js`:action==='folder'?`${directory==='/'?'':directory}/New folder/`:action==='instrument'?`${directory==='/'?'/presets':directory}/Untitled.spu.json`:(path??'');
    nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();
  }
  const contextMenu=installSpuFileContextMenu({root:tree,document:doc,isBusy:()=>disposed||busy,onError:report,
    onTarget:path=>{if(project.fs.stat(path))project.select(path);},
    getActions:path=>[['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete'],['instrument','New instrument…'],['new','New JavaScript file…'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:path==='/'&&['duplicate','rename','delete'].includes(id)})),
    onAction:(action,path)=>action==='duplicate'?duplicate(path):ask(action,path),
  });
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);render();schedule();});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value,path=dialogPath;dialog.close();void Promise.resolve().then(()=>{
    if(action==='new'){if(!isSpuCodePath(value))throw Error('Use a .js or .mjs file name.');return createFile(value);}
    if(action==='folder')return createFile(value.replace(/\/$/,'')+'/');
    if(action==='instrument')return saveSound({path:value});
    return action==='rename'?move(path,value):remove(path);
  }).catch(report);});
  listen(cancel,'click',()=>dialog.close());
  listen(newCassetteCancel,'click',cancelNewCassette);
  listen(newCassetteDialog,'cancel',event=>{event.preventDefault();cancelNewCassette();});
  listen(newCassetteExport,'click',()=>void newProject({exportCurrent:true}).catch(report));
  listen(newCassetteCreate,'click',()=>void newProject().catch(report));
  listen(presetSelect,'change',()=>{const choice=presetOptions.get(presetSelect.value);presetSelect.blur();if(choice)void(choice.kind==='vab'?selectVabTone(choice.path,choice.toneNumber):selectFile(choice.path)).catch(report);});
  for(const[id,fn]of [['spuFileUndoButton',()=>void undo().catch(report)],['spuProjectNewButton',askNewCassette],['spuFileNewButton',()=>ask('new')],['spuFileRenameButton',()=>ask('rename')],['spuFileDeleteButton',()=>ask('delete')],['spuFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['spuProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['spuFileSaveSoundButton',()=>void saveSound().catch(report)],['spuProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['spuFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(autoToggle,'change',()=>{void setAutoApply(autoToggle.checked).catch(report);autoToggle.blur();});
  for(const[id,action]of [['spuFileSaveButton',()=>saveCurrent()],['spuFileSaveAllButton',()=>saveCurrent(true)],['spuFileDiscardButton',()=>discardCurrent()],['spuFileDiscardAllButton',()=>discardCurrent(true)]])listen(buttons.get(id),'click',()=>void action().catch(report));
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&!event.isComposing&&event.key?.toLowerCase()==='s'&&!doc.querySelector?.('dialog[open]')){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();if(!event.repeat)void saveCurrent().catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,selectVabTone,importFiles,importProject,exportProject,createFile,move,duplicate,remove,saveSound,saveInstruments,newProject,undo,getUndoState:()=>history.read(),
    recordSoundEdit,adoptExternalSound,canEditSound,codeEdited,recoverCodeState,isAutoApply:()=>project.autoApply,getSavedEditorPreset:()=>project.savedSettings,
    saveCurrent,saveAll:()=>saveCurrent(true),discardCurrent,discardAll:()=>discardCurrent(true),setAutoApply,
    getWorkingInstrument:()=>project.settings,
    markSoundDirty(){
      if(disposed||busy||restoring)return false;
      const token=++soundEditOperation,workspace=identity;
      pendingSoundEdit=Promise.resolve().then(()=>getInstrument()).then(value=>{
        if(disposed||token!==soundEditOperation||workspace!==identity||busy||restoring)return false;
        return recordSoundEdit(value);
      }).catch(report);return pendingSoundEdit;
    },
    async dispose(){if(disposed)return;disposing=true;operation++;newCassetteDialog.close();newCassetteDialog.remove();history.clear();contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  function recoverSound(saved){
    const raw=storage?.getItem(SPU_SOUND_JOURNAL_KEY);if(!raw)return false;
    if(encoder.encode(raw).byteLength>SOUND_JOURNAL_LIMIT)throw Error('Sound recovery exceeds its byte limit.');
    const value=JSON.parse(raw);
    if(value?.version!==1||typeof value.workspaceId!=='string'||!Number.isSafeInteger(value.generation)||value.generation<1||typeof value.autoSave!=='boolean'||
      !(value.workingText===null||typeof value.workingText==='string')||!(value.savedText===null||typeof value.savedText==='string'))throw Error('Invalid sound recovery journal.');
    if(saved&&value.workspaceId!==identity||value.generation<=soundGeneration)return false;
    const path=allowed(value.path),acceptedPath=allowed(value.savedPath??path);if(!/\.json$/i.test(path)||!/\.json$/i.test(acceptedPath))throw Error('Invalid sound recovery path.');
    const settings=readSpuProjectSound(value.settings),accepted=readSpuProjectSound(value.savedSettings);if(!settings||!accepted)throw Error('Invalid sound recovery settings.');
    const snapshot=project.snapshot(),state=structuredClone(snapshot.workspace);
    function patch(layer,target,data){const files=new Map(layer.files.map(file=>[file.path,file]));if(data===null)files.delete(target);else files.set(target,{path:target,type:'text',data});layer.files=[...files.values()];}
    if(value.autoSave)state.saved=structuredClone(state.working);
    if(path!==acceptedPath)patch(state.working,acceptedPath,null);
    patch(state.working,path,value.workingText);patch(state.saved,acceptedPath,value.savedText);state.autoSave=value.autoSave;
    if(value.autoSave){state.saved=structuredClone(state.working);}
    project.restore({...snapshot,filesystem:state.working,workspace:state,settings,savedSettings:accepted,activeSoundPath:path,
      selectedPath:value.workingText===null?null:path,pendingMoves:value.pendingMoves??[]});
    identity=value.workspaceId;soundGeneration=value.generation;pendingSoundJournal=raw;return true;
  }
  api.ready=Promise.resolve().then(async()=>{
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createSpuCodeProject({snapshot:saved});
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;presetCache.clear();appliedPreset=null;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;soundGeneration=Number.isSafeInteger(saved.soundGeneration)?saved.soundGeneration:0;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}
      let recovered=false;try{recovered=recoverSound(saved);}catch(error){say(`Could not restore the last sound edit: ${error.message} The local project is still available.`);}
      persistenceReady=true;}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed)setBusy(false);}
  });if(main)main.inert=true;render();return api;
}
