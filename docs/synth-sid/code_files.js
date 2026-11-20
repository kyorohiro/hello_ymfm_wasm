// Compact SID Files adapter for the shared Synth Code editor.
import {createSpuFileHistory} from '../synth-spu/file_history.js';
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {installSpuFileContextMenu as installSidFileContextMenu} from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {createSidCodeProject,createSidProjectStore,readSidProjectSound,isSidCodePath,isSidTextPath,SID_PROJECT_MANIFEST,SID_PROJECT_CODE_LENGTH,SID_PROJECT_FILE_BYTES} from './code_project.js?v=sid-working-saved-1';
import {readChannelSettings,selectedChannelPreset} from './channel_settings.js';
import {serializeSidSoundDocument} from './code_sound_document.js';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`sid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
const hasPath=(fs,path)=>typeof path==='string'&&(fs.has(path)||fs.listDirectories().includes(path));
export const SID_SOUND_JOURNAL_KEY='tetorica-sid-synth-pending-sound-v2';
const SOUND_JOURNAL_LIMIT=384*1024;
function soundFileStem(value,extension=/\.sid(?:-channels|-voice)?\.json$/i){
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
  let index=1,path='/presets/'+stem+'.sid-channels.json';
  while(occupied.has(fold(path)))path=`/presets/${stem} (${++index}).sid-channels.json`;
  return path;
}
const foldedPath=path=>path.normalize('NFC').toLowerCase();
const occupied=(project,path)=>[...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].some(item=>foldedPath(item)===foldedPath(path));
function copyPath(project,path){
  const name=basename(path),directory=dirname(path),folder=project.fs.stat(path).type==='directory';
  const extension=folder?'':name.match(/\.sid(?:-channels|-voice)?\.json$/i)?.[0]??name.match(/\.[^./]+$/)?.[0]??'';
  const stem=extension?name.slice(0,-extension.length):name;
  let index=1,result;
  do{result=`${directory==='/'?'':directory}/${stem}-copy${index===1?'':`-${index}`}${extension}`;index++;}while(occupied(project,result));
  return result;
}
export function setupSidCodeFiles({project=createSidCodeProject(),getSettings=()=>project.settings,getSaveSoundSettings=getSettings,applySettings=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},onBeforeSoundApply=async()=>{},getExportNotice=()=>'',setStatus=()=>{},store=createSidProjectStore(),storage=globalThis.localStorage,document:doc=globalThis.document,downloadFile}={}){
  const panel=doc.getElementById('sidFilesPanel'),toggle=doc.getElementById('sidFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const presetSelect=doc.getElementById('sidPresetSelect'),presetCache=new Map();let presetSignature='',appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('SID Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.sid-main'),listeners=[],expanded=new Map([['/presets',true],['/vgm',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,disposing=false,restoring=false,persistenceReady=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false,pendingNewCassette=null;
  let soundEditOperation=0,pendingSoundEdit=Promise.resolve(),soundApplicationPending=false,soundGeneration=0,pendingSoundJournal=null,recoveryWarning=null;
  const history=createSpuFileHistory();let historyWarning='';
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='sid-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='sid-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const saving=make('div');saving.className='sid-files-save-controls';saving.setAttribute('role','group');saving.setAttribute('aria-label','File saving');
  const autoLabel=make('label'),autoToggle=make('input','sidAutoApplyToggle');autoToggle.type='checkbox';autoToggle.checked=true;
  autoLabel.append(autoToggle,make('span',null,'Auto apply'));autoLabel.title='Save edits automatically and apply valid instrument changes. JavaScript still uses Run / Apply.';saving.append(autoLabel);
  for(const[id,label]of [['sidFileSaveButton','Save'],['sidFileSaveAllButton','Save all'],['sidFileDiscardButton','Discard'],['sidFileDiscardAllButton','Discard all']]){
    const button=make('button',id,label);button.type='button';saving.append(button);
    listen(button,'pointerdown',event=>event.preventDefault());
  }
  const actions=make('div');actions.className='sid-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const button of saving.querySelectorAll('button'))buttons.set(button.id,button);
  for(const[id,label]of [['sidProjectNewButton','New Cassette…'],['sidFileNewButton','＋ JS'],['sidFileSaveSoundButton','＋ Instrument'],['sidFileRenameButton','Rename…'],['sidFileDeleteButton','Delete…'],['sidFileImportButton','Add files…'],['sidFileExportButton','Export file'],['sidProjectExportButton','Export project'],['sidProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (['sidFileNewButton','sidFileSaveSoundButton'].includes(id)?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='sidFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    if(id==='sidFileSaveSoundButton')button.title='Create a new instrument file from the current edited sound. Choose its name; existing files are kept.';
    const destination={sidProjectNewButton:['sidMenuProjectNew','Cassette…'],sidProjectImportButton:['sidMenuProjectImport','Cassette · ZIP…'],sidProjectExportButton:['sidMenuProjectExport','Cassette · ZIP'],sidFileImportButton:['sidMenuFilesImport','Project files…'],sidFileExportButton:['sidMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='sidFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','sidFilesSelected','');selected.className='sid-files-path sid-sr-only';selected.setAttribute('role','status');
  const tree=make('div','sidFilesTree');tree.setAttribute('aria-label','SID project files');
  const info=make('p','sidFilesStatus','Auto apply saves edits automatically. Turn it off to prepare changes, then Save. Importing a project never runs it.');info.className='sid-files-status';info.setAttribute('role','status');
  const fileInput=make('input','sidFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','sidProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','sidFileNameDialog'),form=make('form'),label=make('label','sidFileNameLabel','File path'),nameInput=make('input','sidFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','sidFileNameConfirm','Create'),cancel=make('button','sidFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,saving,tree,actions,selected,info,fileInput,projectInput,dialog);
	const newCassetteDialog = make('dialog', 'sidNewCassetteDialog'),
		newCassetteTitle = make('h2', 'sidNewCassetteTitle', 'Create a new Cassette?'),
		newCassetteDescription = make('p', 'sidNewCassetteDescription',
			'This replaces the current browser project and stops its performance. The new Cassette contains the default sound, starter Code. Code will not run automatically.'),
		newCassetteActions = make('div'),
		newCassetteCancel = make('button', 'sidNewCassetteCancel', 'Cancel'),
		newCassetteExport = make('button', 'sidNewCassetteExport', 'Export current & create'),
		newCassetteCreate = make('button', 'sidNewCassetteCreate', 'Create without export');
	newCassetteDialog.setAttribute('aria-labelledby', newCassetteTitle.id);
	newCassetteActions.className = 'sid-new-cassette-actions';
	for (const button of [newCassetteCancel, newCassetteExport, newCassetteCreate]) button.type = 'button';
	newCassetteActions.append(newCassetteCancel, newCassetteExport, newCassetteCreate);
	newCassetteDialog.append(newCassetteTitle, newCassetteDescription, newCassetteActions);
	doc.body.append(newCassetteDialog);
  const importCassetteDialog=make('dialog','sidImportCassetteDialog'),importCassetteTitle=make('h2','sidImportCassetteTitle','Replace this Cassette?'),
    importCassetteDescription=make('p','sidImportCassetteDescription'),importCassetteActions=make('div'),
    importCassetteCancel=make('button','sidImportCassetteCancel','Cancel'),importCassetteExport=make('button','sidImportCassetteExport','Export current & import'),
    importCassetteReplace=make('button','sidImportCassetteReplace','Import without export');
  importCassetteDialog.setAttribute('aria-labelledby',importCassetteTitle.id);importCassetteActions.className='sid-new-cassette-actions';
  for(const button of [importCassetteCancel,importCassetteExport,importCassetteReplace])button.type='button';
  importCassetteActions.append(importCassetteCancel,importCassetteExport,importCassetteReplace);importCassetteDialog.append(importCassetteTitle,importCassetteDescription,importCassetteActions);doc.body.append(importCassetteDialog);
  let pendingImport=null;
  async function askImportProject(bytes){
    await api.ready;if(disposed||busy)return false;
    await project.prepareImport(bytes);if(disposed||busy)return false;
    pendingImport=bytes;const dirty=project.getDirtyPaths().length;
    importCassetteDescription.textContent='This replaces the current browser project and stops its performance. Code will not run automatically.'+(dirty?` ${dirty} unsaved path(s); Export keeps saved and working versions.`:'');
    importCassetteDialog.showModal();importCassetteCancel.focus();return true;
  }
  async function confirmImportProject(exportCurrent){
    const bytes=pendingImport;if(!bytes)return false;
    const result=await importProject(bytes,{exportCurrent});
    if(result){pendingImport=null;importCassetteDialog.close();}return result;
  }

  let dialogAction=null,dialogPath=null;
  const say=message=>{if(!disposed){const text=message+(historyWarning?' '+historyWarning:'');info.textContent=text;setStatus(text);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===SID_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  const soundPath=()=>project.activeSoundPath??null;
  const pendingMoves=()=>project.getPendingMoves?.()??[];
  function savedPath(path){
    if(!path)return path;
    const move=pendingMoves().find(([,destination])=>inside(path,destination));
    const original=move?move[0]+path.slice(move[1].length):null;
    return original&&hasPath(project.savedFs,original)?original:path;
  }
  function soundFromFile(path,fs=project.fs,baseline=fs===project.savedFs?{...project.savedSettings,target:project.settings.target,keyboardMode:project.settings.keyboardMode}:project.settings){
    const file=path&&fs.get(path);return file?.type==='text'?readSidProjectSound(file.data,baseline):null;
  }
  function displaySound(){try{return soundFromFile(soundPath())??project.settings;}catch{return project.settings;}}
  function capture(){return{project:{...project.snapshot(),codeState:code?.captureState?.()??project.getCodeState()},appliedPreset:appliedPreset?structuredClone(appliedPreset):null,filesVisible:!panel.hidden};}
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
      storage.setItem(SID_SOUND_JOURNAL_KEY,raw);pendingSoundJournal=raw;recoveryWarning=null;
    }catch(error){const warning=path+':'+error.message;if(recoveryWarning!==warning){recoveryWarning=warning;say(`Immediate sound recovery unavailable: ${error.message} Keep this page open until its local draft is saved, or Export Cassette.`);}}
  }
  function canEditSound(){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before editing the instrument.');
    const path=soundPath();if(!path)return true;
    try{if(!soundFromFile(path))throw Error('Expected a SID sound JSON.');}
    catch(error){throw Error(`Finish or Discard the JSON edits in ${path} before changing its controls. ${error.message}`);}
    return true;
  }
  function adoptExternalSound(value){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before loading an instrument.');
    const sound=readSidProjectSound(value,project.settings);if(!sound)throw Error('Expected a SID instrument.');
    soundEditOperation++;soundApplicationPending=false;soundGeneration++;editRevision++;
    project.setActiveSoundPath(null);project.setSettings(sound);project.setSavedSettings(sound);appliedPreset=null;
    render();schedule();return sound;
  }
  function prepareSoundEdit(value=getSettings(),{allowExternal=false}={}){
    canEditSound();const sound=readSidProjectSound(value,project.settings);if(!sound)throw Error('Expected a SID instrument.');
    const active=soundPath(),path=active??newSoundPath(project,selectedChannelPreset(sound).name),source=serializeSidSoundDocument(sound,active?project.fs.get(active)?.data:null);
    const bytes=encoder.encode(source).byteLength+project.listEntries().reduce((total,file)=>total+(file.path===path?0:file.size),0);
    const external=bytes>SID_PROJECT_FILE_BYTES;
    if(external){
      if(!project.autoApply)throw Error('This instrument exceeds the 16 MiB Project file limit. Its controls were not changed. Use a smaller Project preset, or enable Auto apply for live editing and Export preset to keep the sound.');
      if(active&&!allowExternal)throw Error('This instrument exceeds the 16 MiB Project file limit. Its linked JSON was kept. Export preset to keep a larger standalone instrument.');
    }
    return {sound,active,path,source,external};
  }
  // Host controls call this before changing native audio. It shares precisely
  // the same schema, path and capacity check as the eventual record operation.
  function validateSoundEdit(value=getSettings(),options={}){prepareSoundEdit(value,options);return true;}
  function recordSoundEdit(value=getSettings(),options={}){
    const {sound,active,path,source,external}=prepareSoundEdit(value,options);
    if(external){
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
    let sound;try{sound=soundFromFile(path);if(!sound)throw Error('Expected a SID sound JSON.');}
    catch(error){protectSound();say(`JSON not applied; current sound kept. ${error.message}`);return;}
    const token=++soundEditOperation,workspace=identity,automatic=project.autoApply,
      accepted=project.savedSettings,source=project.fs.get(path).data,
      previousApplied=appliedPreset?structuredClone(appliedPreset):null,
      baseline=previousApplied?.path===path?previousApplied.data:project.savedFs.get(savedPath(path))?.data;
    const current=()=>!disposed&&token===soundEditOperation&&workspace===identity&&soundPath()===path;
    soundApplicationPending=false;
    // Working controls can preview immediately. The accepted sound stays at
    // its previous value until the native apply acknowledges this command.
    project.setSettings(sound);
    editRevision++;protectSound();
    soundApplicationPending=true;
    function rejectAutomatic(error){
      if(!automatic||!current())return false;
      // Auto-save Files normally keeps both layers equal. If the hardware
      // rejects a valid edit, retain that source as an explicit manual draft,
      // restore only this file's accepted baseline, and pause Auto apply.
      // Other files/newer commands must not be rolled back by this failure.
      const snapshot=project.snapshot(),layers=structuredClone(snapshot.workspace),files=new Map(layers.saved.files.map(file=>[file.path,file]));
      const target=savedPath(path);
      if(typeof baseline==='string')files.set(target,{path:target,type:'text',data:baseline});else files.delete(target);
      layers.saved.files=[...files.values()];layers.autoSave=false;
      project.restore({...snapshot,filesystem:layers.working,workspace:layers,settings:project.settings,savedSettings:accepted});
      appliedPreset=previousApplied;protectSound();render();schedule();
      say(`JSON not applied; current sound kept. Auto apply paused; your draft is kept. Save to retry or Discard.${error?` ${error.message??error}`:''}`);
      return true;
    }
    pendingSoundEdit=Promise.resolve().then(async()=>{
      const result=await applySettings(sound,{record:false,source:'json',load:false,applyAudio:automatic,displayPreset:sound,isCurrent:current});
      if(result===false){rejectAutomatic();return false;}
      if(current()){
        if(automatic)project.setSavedSettings(sound);
        appliedPreset={kind:'json',path,data:source};protectSound();render();schedule();
      }
      // An incomplete later edit is source text, not a newer playable command.
      // Keep this last valid command, then restore its warning after the ack.
      if(current())try{if(!soundFromFile(path))throw Error('Expected a SID sound JSON.');}catch(error){say(`JSON not applied; current sound kept. ${error.message}`);}
      return result;
    }).catch(error=>{if(!rejectAutomatic(error)&&current())report(error);return false;}).finally(()=>{if(token===soundEditOperation)soundApplicationPending=false;});
    render();schedule();return pendingSoundEdit;
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
  async function saveCurrent(all=false){
    await api.ready;if(disposed||busy)return false;
    if(await code?.flush?.({persist:false})===false)return false;await pendingSoundEdit;if(disposed||busy)return false;
    const path=project.selectedPath??code?.activePath??soundPath();if(!all&&!path)return false;
    const requested=all?project.getDirtyPaths():[path],targets=all?requested:expandedSavePaths(requested),
      before=capture(),changed=requested.some(path=>project.isFileModified(path)),candidate=createSidCodeProject({snapshot:before.project});
    // Prepare acceptance separately. Native failure or cancellation must leave
    // the old baseline and its last accepted sound available for another Save.
    if(all)candidate.saveAll();else if(targets.length)candidate.saveFiles(targets);
    candidate.setPendingMoves(candidate.getPendingMoves().filter(([source,destination])=>!targets.some(path=>inside(source,path)||inside(destination,path))));
    let active=candidate.activeSoundPath;
    if(active&&!candidate.fs.has(active)&&!candidate.savedFs.has(active)){candidate.setActiveSoundPath(null);active=null;}
    const changesSound=Boolean(active&&(all||targets.some(target=>inside(active,target)))),token=++operation,workspace=identity,
      current=()=>!disposed&&token===operation&&identity===workspace;
    let invalid=null,accepted=candidate.savedSettings;
    if(changesSound&&candidate.savedFs.has(active)){
      try{accepted=soundFromFile(active,candidate.savedFs,candidate.savedSettings);if(!accepted)throw Error('Expected a SID sound JSON.');candidate.setSettings(accepted);candidate.setSavedSettings(accepted);}
      catch(error){invalid=error;accepted=null;}
    }
    setBusy(true,{lockMain:false});
    try{
      if(changesSound&&accepted){
        const applied=await applySettings(accepted,{record:false,source:'save',load:false,applyAudio:true,displayPreset:displaySound(),isCurrent:current});
        if(applied===false||!current())return false;
      }
      if(!current())return false;
      project.restore(candidate.snapshot());if(changed)pushHistory(before);
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
      project.discardFiles(targets);clearMoves(targets);if(before)pushHistory(before);
      if(all&&codePath&&codePath!==codeOriginal)code?.pathChanged?.(codePath,codeOriginal,{preserveExecution:!project.autoApply});
      else if(!all&&path!==original)code?.pathChanged?.(path,original,{preserveExecution:!project.autoApply});
      if(active&&(all||inside(active,path))){
        const target=all?activeOriginal:original+active.slice(path.length);project.setActiveSoundPath(project.fs.has(target)?target:null);
        let restored=null;try{if(project.activeSoundPath)restored=soundFromFile(target);}catch{}
        project.setSettings(restored??project.savedSettings);
        await applySettings(project.savedSettings,{record:false,source:'discard',load:false,applyAudio:false,displayPreset:displaySound()});
      }
      project.select(hasPath(project.fs,original)?original:null);await code?.reloadFile?.();protectSound();render();await persistCode();say(all?'Discarded all unsaved file changes.':`Discarded changes to ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function setAutoApply(enabled){
    await api.ready;if(disposed||busy)return false;
    if(await code?.flush?.({persist:false})===false)return false;await pendingSoundEdit;
    if(disposed||busy)return false;if(project.autoApply===enabled)return true;
    const before=capture(),candidate=createSidCodeProject({snapshot:before.project}),token=++operation,workspace=identity,
      current=()=>!disposed&&token===operation&&identity===workspace;
    candidate.setAutoApply(enabled);let invalid=null,accepted=candidate.savedSettings;
    const active=candidate.activeSoundPath;
    if(enabled&&active&&candidate.savedFs.has(active)){
      try{accepted=soundFromFile(active,candidate.savedFs,candidate.settings);if(!accepted)throw Error('Expected a SID sound JSON.');candidate.setSettings(accepted);candidate.setSavedSettings(accepted);}
      catch(error){invalid=error;accepted=null;}
    }
    setBusy(true,{lockMain:false});
    try{
      if(accepted){
        const applied=await applySettings(accepted,{record:false,source:'auto',load:false,applyAudio:enabled,displayPreset:displaySound(),isCurrent:current});
        if(applied===false||!current())return false;
      }
      if(!current())return false;
      project.restore(candidate.snapshot());pushHistory(before);
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
    const entry=history.peek(),candidate=createSidCodeProject({snapshot:entry.project}),before=capture(),oldIdentity=identity,oldPersistence=persistenceReady;
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
      try{storage?.removeItem(SID_SOUND_JOURNAL_KEY);}catch{}
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
  function renderPresets(files){
    if(!presetSelect){const paths=new Set(files.map(file=>file.path));for(const path of presetCache.keys())if(!paths.has(path))presetCache.delete(path);return;}
    const present=new Set(),entries=[];
    for(const file of files) {
      if(!file.path.startsWith('/presets/'))continue;
      if(file.type!=='text'||!/\.json$/i.test(file.path))continue;
      present.add(file.path);let saved=presetCache.get(file.path);
      if(saved?.kind!=='json'||saved.data!==file.data) {
        let name=null;try{const sound=readSidProjectSound(file.data,project.settings);name=sound?selectedChannelPreset(sound).name:null;}catch{}
        saved={kind:'json',data:file.data,name};presetCache.set(file.path,saved);
      }
      if(saved.name!==null)entries.push({kind:'json',path:file.path,value:file.path,label:`${saved.name} · ${file.path}`});
    }
    for(const path of presetCache.keys())if(!present.has(path))presetCache.delete(path);
    entries.sort((a,b)=>a.path.localeCompare(b.path));presetOptions=new Map(entries.map(entry=>[entry.value,entry]));
    const signature=JSON.stringify(entries);
    if(signature!==presetSignature) {
      presetSignature=signature;const placeholder=make('option',null,entries.length?'Load preset…':'No playable presets');placeholder.value='';placeholder.disabled=true;
      const options=entries.map(entry=>{const option=make('option',null,entry.label);option.value=entry.value;option.title=entry.path;return option;});
      presetSelect.replaceChildren(placeholder,...options);
    }
    const applied=appliedPreset&&entries.find(entry=>entry.path===appliedPreset.path&&presetCache.get(entry.path)?.data===appliedPreset.data);
    if(applied)appliedPreset.data=presetCache.get(applied.path).data;
    // A pending/unfinished source change clears the dropdown selection, not
    // the last accepted source bytes needed for native-acceptance rollback.
    else if(appliedPreset&&!project.fs.has(appliedPreset.path)&&!project.savedFs.has(savedPath(appliedPreset.path)))appliedPreset=null;
    presetSelect.value=applied?.value??'';
    presetSelect.disabled=busy||!entries.length;
  }
  function render(){
    if(disposed)return;const selectedPath=project.selectedPath??'';if(selected.textContent!==selectedPath)selected.textContent=selectedPath;
    panel.setAttribute('aria-busy',String(busy));title.textContent=project.getDirtyPaths().length?'FILES ●':'FILES';
    const files=project.fs.list().filter(file=>!isCheckpointPath(file.path));renderPresets(files);
    renderFileTree(tree,[...files,...project.fs.listDirectories().filter(path=>path!=='/'&&!isCheckpointPath(path)).map(path=>({path,type:'directory'}))],{
      selectedPath:project.selectedPath,expanded,onOpen:path=>void selectFile(path).catch(report),
      onImport:files=>void importFiles(files).catch(report),onTransfer:(source,destination,copy)=>void move(source,destination,copy).catch(report)});
    for(const entry of tree.querySelectorAll('[data-file-path]')){
      const path=entry.getAttribute('data-file-path'),dirty=project.isFileModified(path);entry.dataset.unsaved=String(dirty);
      if(dirty){const dot=make('span',null,' ●');dot.className='sid-file-unsaved';dot.setAttribute('aria-label','Unsaved changes');entry.append(dot);}
    }
    for(const[id,button]of buttons)button.disabled=busy||(['sidFileExportButton','sidFileRenameButton','sidFileDeleteButton'].includes(id)&&!project.selectedPath);
    buttons.get('sidFileSaveButton').disabled=busy||!(project.selectedPath??code?.activePath??soundPath());
    buttons.get('sidFileSaveAllButton').disabled=busy||!project.getDirtyPaths().length;
    buttons.get('sidFileDiscardButton').disabled=busy||!project.selectedPath||!project.isFileModified(project.selectedPath);
    buttons.get('sidFileDiscardAllButton').disabled=busy||!project.getDirtyPaths().length;
    autoToggle.checked=project.autoApply;autoToggle.disabled=busy;
    code?.setBusy?.(busy);
    newCassetteExport.disabled=newCassetteCreate.disabled=importCassetteExport.disabled=importCassetteReplace.disabled=busy;
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value,{lockMain=true}={}){busy=value;if(main)main.inert=Boolean(value&&lockMain);render();}
  async function persistCode(){
    if(disposed||!persistenceReady)return false;
    const journal=pendingSoundJournal,generation=soundGeneration,workspace=identity;
    try{
      const result=await store.write({...project.snapshot(),workspaceId:workspace,soundGeneration:generation,filesVisible:!panel.hidden});
      if(result!==false&&identity===workspace&&soundGeneration===generation&&pendingSoundJournal===journal&&journal){
        try{if(storage?.getItem(SID_SOUND_JOURNAL_KEY)===journal)storage.removeItem(SID_SOUND_JOURNAL_KEY);}catch{}
        pendingSoundJournal=null;
      }
      return result;
    }
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  const executionPath=()=>code?.executionPath??(isSidCodePath(code?.activePath)?code.activePath:null);
  const openInCurrentMode=path=>code?.openFile?.(path,{show:Boolean(code?.isCodeMode?.())});
  function reveal(path){for(let directory=dirname(path);directory!=='/';directory=dirname(directory))expanded.set(directory,true);}
  async function selectFile(path){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();await pendingSoundEdit;if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isSidCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null,accepted=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readSidProjectSound(file.data,project.settings);}catch(error){soundError=error;}}
    try{accepted=soundFromFile(savedPath(path),project.savedFs);}catch{}
    const instrument=Boolean(sound||accepted||path===soundPath()||/\.sid(?:-channels|-voice)?\.json$/i.test(path));
    if(instrument){
      accepted=project.autoApply?sound:accepted;
      const audible=accepted??project.savedSettings,display=sound??accepted??project.settings;
      setBusy(true);
      try{
        if(accepted)await onBeforeSoundApply();if(disposed||token!==operation)return false;
        const applied=await applySettings(audible,{record:false,source:'selection',load:true,applyAudio:Boolean(accepted),displayPreset:display,isCurrent:()=>!disposed&&token===operation});
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
    say(sound?(project.autoApply?'SID sound loaded. Controls and valid JSON edits update this file automatically.':'Sound draft selected. Saved sound plays; Save applies your edits.'):soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:file.type==='text'?'Text edits save to Files from Code; valid edits to the active sound follow Auto apply.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files,{isCurrent=()=>true}={}){
    if(disposed||!isCurrent())return[];
    await api.ready;if(disposed||busy||!isCurrent())return[];const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    const entries=[];for(const file of files){if(!current())return[];if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());if(!current())return[];
      entries.push({path:'/'+basename(file.name),type:isSidTextPath(file.name)?'text':'binary',data:isSidTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(!current())return[];await code?.flush?.();if(!current())return[];
    const candidate=createSidCodeProject({snapshot:project.snapshot()}),paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    const previous=capture();setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||!current())return[];}
      if(!current())return[];
      project.restore(candidate.snapshot());pushHistory(previous);
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
      render();await persistCode();say(`Added ${paths.length} file(s). Code was not run.`);return paths;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importProject(bytes,{exportCurrent=false}={}){
    if(typeof exportCurrent!=='boolean')throw TypeError('exportCurrent must be a boolean.');
    await api.ready;if(disposed||disposing||busy)return false;
    const token=++operation,current=()=>!disposed&&!disposing&&token===operation;
    // Reject invalid archives before asking the author to retire any owner.
    const candidate=createSidCodeProject({snapshot:await project.prepareImport(bytes)});
    if(!current()||await code?.flush?.({persist:false})===false||!current())return false;
    await pendingSoundEdit;if(!current())return false;
    const previous=capture(),oldIdentity=identity,oldPersistence=persistenceReady;
    let retired=false,applied=false,committed=false;setBusy(true);restoring=true;
    try{
      if(exportCurrent){
        const oldProject=createSidCodeProject({snapshot:previous.project});
        if(await (downloadFile??download)(oldProject.exportProject(),oldProject.cassetteName+'.cassette.zip','application/zip')===false||!current())return false;
      }
      persistenceReady=false;retired=true;
      if(await code?.workspaceReplaced?.()===false||!current())return false;
      if(await onBeforeWorkspaceReplace({reason:'import',isCurrent:current})===false||!current())return false;
      applied=true;
      if(await applySettings(candidate.savedSettings,{record:false,source:'restore',load:true,applyAudio:true,displayPreset:candidate.settings,isCurrent:current})===false||!current())return false;
      project.restore(candidate.snapshot());identity=workspaceId();soundEditOperation++;soundApplicationPending=false;
      appliedPreset=null;presetCache.clear();
      if(await code?.restoreState?.(project.getCodeState())===false||!current())return false;
      committed=true;pushHistory(previous);soundGeneration=0;pendingSoundJournal=null;recoveryWarning=null;
      try{storage?.removeItem(SID_SOUND_JOURNAL_KEY);}catch{}
      persistenceReady=true;restoring=false;protectSound();await persistCode();
      say('SID project imported. Code was not run.');return true;
    }finally{
      if(!committed){
        persistenceReady=oldPersistence;
        if(retired){
          project.restore(previous.project);identity=oldIdentity;appliedPreset=previous.appliedPreset;presetCache.clear();
          if(!disposed&&!disposing){
            if(applied)try{await applySettings(project.savedSettings,{record:false,source:'restore',load:false,applyAudio:true,displayPreset:project.settings,isCurrent:()=>!disposed&&!disposing});}catch(error){report(Error('Previous sound could not be restored: '+error.message));}
            try{await code?.restoreState?.(project.getCodeState());}catch(error){report(Error('Previous Code display could not be restored: '+error.message));}
          }
        }
      }
      restoring=false;if(!disposed&&!disposing){setBusy(false);if(!committed&&persistenceReady)schedule();}
    }
  }
  async function exportProject(){await api.ready;await code?.flush?.();await pendingSoundEdit;const bytes=project.exportProject();const notice=getExportNotice();if(notice)say(`Project exported. ${notice}`);return bytes;}
	function cancelNewCassette() {
		if (pendingNewCassette !== null) operation++;
		newCassetteDialog.close();
	}
	function askNewCassette() {
		if (disposed || disposing || busy) return;
		const notice=getExportNotice(),dirty=project.getDirtyPaths().length;
    newCassetteDescription.dataset.unsaved=String(dirty);
		newCassetteDescription.textContent='This replaces the current browser project and stops its performance. The new Cassette contains the default sound, starter Code. Code will not run automatically.'+(dirty?` ${dirty} unsaved path(s); Export keeps saved and working versions.`:'')+(notice?' '+notice:'');
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
		let previous = null, retired = false, applyAttempted = false, committed = false, failure = null, locked=false;
		pendingNewCassette = token;
		clearTimeout(saveTimer);
		try {
			// Build/validate defaults before retiring Code or the song owner.
			const fresh = createSidCodeProject({ snapshot: project.prepareNew() });
			if ((await code?.flush?.()) === false || !current()) return false;
            // Cache + pending edit flush captures both author versions without
            // starting audio or sampling temporary Code/song performance data.
            let pending;
            do{pending=pendingSoundEdit;await pending;}while(current()&&pending!==pendingSoundEdit);
            if(!current())return false;setBusy(true);locked=true;restoring=true;
            previous=createSidCodeProject({snapshot:capture().project}).snapshot();
			if (exportCurrent) {
				const oldProject = createSidCodeProject({ snapshot: previous });
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

            soundGeneration=0;pendingSoundJournal=null;recoveryWarning=null;
            try{storage?.removeItem(SID_SOUND_JOURNAL_KEY);}catch{}
			soundEditOperation++;
			persistenceReady = true;
			restoring = false;
			appliedPreset = null;
			presetCache.clear();
			newCassetteDialog.close();
			const persisted = await persistCode();
			say('New SID Cassette created. Code was not run.' +
				(persisted === false ? ' Local save unavailable; export the project to keep it.' : ' Saved locally.')+(backupNotice?' '+backupNotice:''));
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
      for(const file of project.fs.list())if(inside(file.path,source)&&isSidCodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>SID_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createSidCodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&project.autoApply&&movedCodePath&&!isSidCodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
      if(disposed||token!==operation)return false;
      const previous=capture(),previousApplied=appliedPreset,active=soundPath();
      let moves=null;
      if(!copy&&!project.autoApply){
        const prior=pendingMoves(),covered=prior.some(([,to])=>inside(source,to));
        if(prior.some(([,to])=>source!==to&&inside(source,to)))throw Error('Save or Discard the parent folder rename before moving files inside it.');
        moves=prior.map(([from,to])=>[from,inside(to,source)?destination+to.slice(source.length):to]);
        if(hasPath(project.savedFs,source)&&!covered&&!moves.some(([from])=>from===source))moves.push([source,destination]);
        // Metadata rejection must happen before mutating the live filesystem.
        createSidCodeProject().setPendingMoves(moves);
      }
      if(!copy&&appliedPreset&&inside(appliedPreset.path,source))appliedPreset={...appliedPreset,path:destination+appliedPreset.path.slice(source.length)};
      try{if(copy)project.fs.restore(copied);else transferVirtualFiles(project.fs,source,destination);}
      catch(error){appliedPreset=previousApplied;throw error;}
      if(!copy){
        if(moves)project.setPendingMoves(moves);
        if(active&&inside(active,source)){const path=destination+active.slice(source.length);project.setActiveSoundPath(isSidTextPath(path)?path:null);}
        if(inside(project.selectedPath,source))project.select(destination+project.selectedPath.slice(source.length));code?.pathChanged?.(source,destination,{preserveExecution:!project.autoApply});
      }
      pushHistory(previous);protectSound();render();await persistCode();return true;
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
    try{const previous=capture();if(project.autoApply&&inside(executionPath(),path))await code.stop();if(disposed||token!==operation)return false;
      if(inside(project.selectedPath,path))project.select(null);
      project.fs.remove(path,{recursive:true});code?.pathChanged?.(path,null,{preserveExecution:!project.autoApply});
      if(project.autoApply&&inside(soundPath(),path))project.setActiveSoundPath(null);
      pushHistory(previous);protectSound();render();await persistCode();return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function createFile(path){
    await api.ready;if(disposed||busy)return false;const token=++operation,directory=String(path).endsWith('/');path=allowed(path);
    await code?.flush?.();if(disposed||token!==operation)return false;
    if(occupied(project,path))throw Error('That path already exists.');setBusy(true,{lockMain:false});
    try{
      const previous=capture(),candidate=createSidCodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
      candidate.restore(candidate.snapshot());project.fs.restore(candidate.fs.snapshot());project.select(path);reveal(path);if(directory)expanded.set(path,true);render();
      pushHistory(previous);
      if(!directory)await openInCurrentMode(path);if(disposed||token!==operation)return false;
      await persistCode();say(`Created ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSound({path:requestedPath,sound:providedSound,select=true}={}){
    if(disposed||busy)return false;const token=++operation,workspace=identity,current=()=>!disposed&&token===operation&&identity===workspace;setBusy(true,{lockMain:false});
    try{
      if(typeof select!=='boolean')throw TypeError('Preset file selection must be boolean.');
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.sid(?:-channels|-voice)?\.json$/i.test(requestedPath))throw Error('Use a .sid-channels.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      const sound=readSidProjectSound(providedSound===undefined?getSaveSoundSettings():providedSound,project.settings);if(!sound)throw Error('Expected a SID instrument.');
      if(!current())return false;
      const path=requestedPath??newSoundPath(project,selectedChannelPreset(sound).name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){const name=basename(path).replace(/\.sid(?:-channels|-voice)?\.json$/i,'');for(const preset of sound.channels)preset.name=name;readChannelSettings(sound);}
      // Prepare the new document and its explicit saved version separately.
      // Failed native acceptance keeps the prior linked document and layers.
      const previous=capture(),candidate=createSidCodeProject({snapshot:previous.project});
      const documentRole=/\.sid-voice\.json$/i.test(path)?selectedChannelPreset(sound):null;
      candidate.importFiles([{path,type:'text',data:serializeSidSoundDocument(sound,documentRole)}]);candidate.saveFiles([path]);
      if(select){
        candidate.select(path);candidate.setActiveSoundPath(path);candidate.setSettings(sound);candidate.setSavedSettings(sound);
        const applied=await applySettings(sound,{record:false,source:'save',load:false,applyAudio:true,displayPreset:sound,isCurrent:current});
        if(applied===false||!current())return false;
      }
      if(!current())return false;
      project.restore(candidate.snapshot());if(select)appliedPreset={kind:'json',path,data:project.fs.get(path).data};
      pushHistory(previous);reveal(path);setVisible(true);render();
      if(select)await code?.openFile?.(path,{show:false});if(!current())return false;
      const persisted=await persistCode();
      say('Saved to '+path+(persisted===false?' in Files. Local save unavailable; export the project to keep it.':''));return path;
    }finally{if(!disposed)setBusy(false);}
  }
  async function download(bytes,filename,type='application/octet-stream'){if(typeof win.tetoricaSynthSave==='function')return await win.tetoricaSynthSave(bytes,filename,type);const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action,path=project.selectedPath){
    if(disposed||busy)return;dialogAction=action;dialogPath=path;
    const directory=path&&project.fs.stat(path).type==='directory'?path:path?dirname(path):'/';
    label.textContent={delete:'Delete this project path?',rename:'New file path',instrument:'New instrument · .sid-channels.json path',folder:'New folder path',new:'New JavaScript file path'}[action];
    nameInput.value=action==='new'?`${directory==='/'?'':directory}/untitled.js`:action==='folder'?`${directory==='/'?'':directory}/New folder/`:action==='instrument'?`${directory==='/'?'/presets':directory}/Untitled.sid-channels.json`:(path??'');
    nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();
  }
  const contextMenu=installSidFileContextMenu({root:tree,document:doc,isBusy:()=>disposed||busy,onError:report,
    onTarget:path=>{if(project.fs.stat(path))project.select(path);},
    getActions:path=>[['undo','Undo file operation'],['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete'],['instrument','New instrument…'],['new','New JavaScript file…'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:id==='undo'?!history.peek():path==='/'&&['duplicate','rename','delete'].includes(id)})),
    onAction:(action,path)=>action==='undo'?undo():action==='duplicate'?duplicate(path):ask(action,path),
  });
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);render();schedule();});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value,path=dialogPath;dialog.close();void Promise.resolve().then(()=>{
    if(action==='new'){if(!isSidCodePath(value))throw Error('Use a .js or .mjs file name.');return createFile(value);}
    if(action==='folder')return createFile(value.replace(/\/$/,'')+'/');
    if(action==='instrument')return saveSound({path:value});
    return action==='rename'?move(path,value):remove(path);
  }).catch(report);});
  listen(cancel,'click',()=>dialog.close());
  listen(newCassetteCancel,'click',cancelNewCassette);
  listen(newCassetteDialog,'cancel',event=>{event.preventDefault();cancelNewCassette();});
  listen(newCassetteExport,'click',()=>void newProject({exportCurrent:true}).catch(report));
  listen(newCassetteCreate,'click',()=>void newProject().catch(report));
  listen(importCassetteCancel,'click',()=>{pendingImport=null;operation++;importCassetteDialog.close();});
  listen(importCassetteDialog,'cancel',()=>{pendingImport=null;operation++;});
  listen(importCassetteExport,'click',()=>void confirmImportProject(true).catch(report));
  listen(importCassetteReplace,'click',()=>void confirmImportProject(false).catch(report));
  listen(presetSelect,'change',()=>{const choice=presetOptions.get(presetSelect.value);presetSelect.blur();if(choice)void(selectFile(choice.path)).catch(report);});
  listen(autoToggle,'change',()=>{void setAutoApply(autoToggle.checked).catch(report);autoToggle.blur();});
  for(const[id,action]of [['sidFileSaveButton',()=>saveCurrent()],['sidFileSaveAllButton',()=>saveCurrent(true)],['sidFileDiscardButton',()=>discardCurrent()],['sidFileDiscardAllButton',()=>discardCurrent(true)]])listen(buttons.get(id),'click',()=>void action().catch(report));
  for(const[id,fn]of [['sidProjectNewButton',askNewCassette],['sidFileNewButton',()=>ask('new')],['sidFileRenameButton',()=>ask('rename')],['sidFileDeleteButton',()=>ask('delete')],['sidFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['sidProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['sidFileSaveSoundButton',()=>ask('instrument',null)],['sidProjectExportButton',()=>void exportProject().then(bytes=>(downloadFile??download)(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['sidFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)(downloadFile??download)(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(askImportProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&!event.isComposing&&event.key?.toLowerCase()==='s'&&!doc.querySelector?.('dialog[open]')){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();if(!event.repeat)void saveCurrent().catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importProject,newProject,exportProject,createFile,move,duplicate,remove,saveSound,
    recordSoundEdit,validateSoundEdit,adoptExternalSound,canEditSound,codeEdited,recoverCodeState,isAutoApply:()=>project.autoApply,getSavedEditorPreset:()=>project.savedSettings,
    getWorkingSound:()=>project.settings,getAcceptedSound:()=>project.savedSettings,flushSoundEdits:()=>pendingSoundEdit,
    saveCurrent,saveAll:()=>saveCurrent(true),discardCurrent,discardAll:()=>discardCurrent(true),setAutoApply,undo,getUndoState:()=>history.read(),
    markSoundDirty(value=getSettings()){
      if(disposed)return false;
      // Startup may finish after an early control edit. Preserve that sound
      // without binding it to an unread project's instrument file.
      if(busy||restoring){const sound=readSidProjectSound(value,project.settings);if(!sound)throw Error('Expected a SID instrument.');editRevision++;project.setSettings(sound);if(project.autoApply)project.setSavedSettings(sound);return false;}
      return recordSoundEdit(value);
    },
    async dispose(){if(disposed||disposing)return;disposing=true;operation++;newCassetteDialog.close();newCassetteDialog.remove();importCassetteDialog.close();importCassetteDialog.remove();pendingImport=null;history.clear();contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  function recoverSound(saved){
    const raw=storage?.getItem(SID_SOUND_JOURNAL_KEY);if(!raw)return false;
    if(encoder.encode(raw).byteLength>SOUND_JOURNAL_LIMIT)throw Error('Sound recovery exceeds its byte limit.');
    const value=JSON.parse(raw);
    if(value?.version!==1||typeof value.workspaceId!=='string'||!Number.isSafeInteger(value.generation)||value.generation<1||typeof value.autoSave!=='boolean'||
      !(value.workingText===null||typeof value.workingText==='string')||!(value.savedText===null||typeof value.savedText==='string'))throw Error('Invalid sound recovery journal.');
    if(saved&&value.workspaceId!==identity||value.generation<=soundGeneration)return false;
    const path=allowed(value.path),acceptedPath=allowed(value.savedPath??path);if(!/\.json$/i.test(path)||!/\.json$/i.test(acceptedPath))throw Error('Invalid sound recovery path.');
    const settings=readSidProjectSound(value.settings),accepted=readSidProjectSound(value.savedSettings);if(!settings||!accepted)throw Error('Invalid sound recovery settings.');
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
  const initialEditRevision=editRevision;
  api.ready=Promise.resolve().then(async()=>{
    const before=initialEditRevision;
    try{const saved=await store.read();if(disposed)return;
      restoring=true;try{
        if(saved){const candidate=createSidCodeProject({snapshot:saved});if(before!==editRevision){candidate.setSettings(getSettings());if(candidate.autoApply)candidate.setSavedSettings(candidate.settings);}
          await onBeforeWorkspaceReplace();if(disposed)return;if(before!==editRevision){candidate.setSettings(getSettings());if(candidate.autoApply)candidate.setSavedSettings(candidate.settings);}
          project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;soundGeneration=Number.isSafeInteger(saved.soundGeneration)?saved.soundGeneration:0;
          if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));
        }
        let recovered=false;try{recovered=recoverSound(saved);}catch(error){say(`Could not restore the last sound edit: ${error.message} The local project is still available.`);}
        if(saved||recovered)await applySettings(project.savedSettings,{record:false,source:'restore',load:true,applyAudio:true,displayPreset:project.settings,isCurrent:()=>!disposed});
        presetCache.clear();appliedPreset=soundPath()&&project.fs.get(soundPath())?.type==='text'?{kind:'json',path:soundPath(),data:project.fs.get(soundPath()).data}:null;
      }finally{restoring=false;}
      // Never save defaults over an unread or invalid stored project. Only
      // the initial successful restore enables persistence; reconnect is I/O.
      persistenceReady=true;}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed){setBusy(false);if(persistenceReady&&before!==editRevision)schedule();}}
  });if(main)main.inert=true;render();return api;
}
