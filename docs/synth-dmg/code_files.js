// Compact Game Boy Files adapter for the shared Synth Code editor.
import {createSpuFileHistory} from '../synth-spu/file_history.js';
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {installSpuFileContextMenu as installGameboyFileContextMenu} from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {createGameboyCodeProject,createGameboyProjectStore,readGameboyProjectSound,isGameboyCodePath,isGameboyTextPath,isGameboySongFilename,isGameboySongPath,GAMEBOY_PROJECT_MANIFEST,GAMEBOY_PROJECT_CODE_LENGTH,GAMEBOY_PROJECT_FILE_BYTES} from './code_project.js?v=dmg-timed-1';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`dmg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
const hasPath=(fs,path)=>typeof path==='string'&&(fs.has(path)||fs.listDirectories().includes(path));
export const GAMEBOY_SOUND_JOURNAL_KEY='tetorica-dmg-synth-pending-sound-v2';
const SOUND_JOURNAL_LIMIT=384*1024;
function soundFileStem(value,extension=/\.dmg\.json$/i){
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
  let index=1,path='/presets/'+stem+'.dmg.json';
  while(occupied.has(fold(path)))path=`/presets/${stem} (${++index}).dmg.json`;
  return path;
}
const foldedPath=path=>path.normalize('NFC').toLowerCase();
const occupied=(project,path)=>[...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].some(item=>foldedPath(item)===foldedPath(path));
function copyPath(project,path){
  const name=basename(path),directory=dirname(path),folder=project.fs.stat(path).type==='directory';
  const extension=folder?'':name.match(/\.dmg\.json$/i)?.[0]??name.match(/\.[^./]+$/)?.[0]??'';
  const stem=extension?name.slice(0,-extension.length):name;
  let index=1,result;
  do{result=`${directory==='/'?'':directory}/${stem}-copy${index===1?'':`-${index}`}${extension}`;index++;}while(occupied(project,result));
  return result;
}
export function setupGameboyCodeFiles({project=createGameboyCodeProject(),getSettings=()=>project.settings,getSaveSoundSettings=getSettings,applySettings=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},onBeforeSoundApply=async()=>{},getExportNotice=()=>'',setStatus=()=>{},store=createGameboyProjectStore(),storage=globalThis.localStorage,document:doc=globalThis.document,downloadFile}={}){
  const panel=doc.getElementById('dmgFilesPanel'),toggle=doc.getElementById('dmgFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const presetSelect=doc.getElementById('dmgPresetSelect'),presetCache=new Map();let presetSignature='',appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('Game Boy Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.dmg-main'),listeners=[],expanded=new Map([['/presets',true],['/vgm',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,disposing=false,restoring=false,persistenceReady=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false,pendingNewCassette=null;
  let soundEditOperation=0,pendingSoundEdit=Promise.resolve(),soundApplicationPending=false,soundGeneration=0,pendingSoundJournal=null,recoveryWarning=null;
  const history=createSpuFileHistory();let historyWarning='';
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='dmg-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='dmg-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const saving=make('div');saving.className='dmg-files-save-controls';saving.setAttribute('role','group');saving.setAttribute('aria-label','File saving');
  const autoLabel=make('label'),autoToggle=make('input','dmgAutoApplyToggle');autoToggle.type='checkbox';autoToggle.checked=true;
  autoLabel.append(autoToggle,make('span',null,'Auto apply'));autoLabel.title='Save edits automatically and apply valid instrument changes. JavaScript still uses Run / Apply.';saving.append(autoLabel);
  for(const[id,label]of [['dmgFileSaveButton','Save'],['dmgFileSaveAllButton','Save all'],['dmgFileDiscardButton','Discard'],['dmgFileDiscardAllButton','Discard all']]){
    const button=make('button',id,label);button.type='button';saving.append(button);
    listen(button,'pointerdown',event=>event.preventDefault());
  }
  const actions=make('div');actions.className='dmg-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const button of saving.querySelectorAll('button'))buttons.set(button.id,button);
  for(const[id,label]of [['dmgProjectNewButton','New Cassette…'],['dmgFileNewButton','＋ JS'],['dmgFileSaveSoundButton','＋ Instrument'],['dmgFileRenameButton','Rename…'],['dmgFileDeleteButton','Delete…'],['dmgFileImportButton','Add files…'],['dmgFileExportButton','Export file'],['dmgProjectExportButton','Export project'],['dmgProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (['dmgFileNewButton','dmgFileSaveSoundButton'].includes(id)?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='dmgFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    if(id==='dmgFileSaveSoundButton')button.title='Create a new instrument file from the current edited sound. Choose its name; existing files are kept.';
    const destination={dmgProjectNewButton:['dmgMenuProjectNew','Cassette…'],dmgProjectImportButton:['dmgMenuProjectImport','Cassette · ZIP…'],dmgProjectExportButton:['dmgMenuProjectExport','Cassette · ZIP'],dmgFileImportButton:['dmgMenuFilesImport','Project files…'],dmgFileExportButton:['dmgMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='dmgFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','dmgFilesSelected','');selected.className='dmg-files-path dmg-sr-only';selected.setAttribute('role','status');
  const tree=make('div','dmgFilesTree');tree.setAttribute('aria-label','Game Boy project files');
  const info=make('p','dmgFilesStatus','Auto apply saves edits automatically. Turn it off to prepare changes, then Save. Importing a project never runs it.');info.className='dmg-files-status';info.setAttribute('role','status');
  const fileInput=make('input','dmgFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','dmgProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','dmgFileNameDialog'),form=make('form'),label=make('label','dmgFileNameLabel','File path'),nameInput=make('input','dmgFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','dmgFileNameConfirm','Create'),cancel=make('button','dmgFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,saving,tree,actions,selected,info,fileInput,projectInput,dialog);
	const newCassetteDialog = make('dialog', 'dmgNewCassetteDialog'),
		newCassetteTitle = make('h2', 'dmgNewCassetteTitle', 'Create a new Cassette?'),
		newCassetteDescription = make('p', 'dmgNewCassetteDescription',
			'This replaces the current browser project and stops its performance. The new Cassette contains the default sound, starter Code. Code will not run automatically.'),
		newCassetteActions = make('div'),
		newCassetteCancel = make('button', 'dmgNewCassetteCancel', 'Cancel'),
		newCassetteExport = make('button', 'dmgNewCassetteExport', 'Export current & create'),
		newCassetteCreate = make('button', 'dmgNewCassetteCreate', 'Create without export');
	newCassetteDialog.setAttribute('aria-labelledby', newCassetteTitle.id);
	newCassetteActions.className = 'dmg-new-cassette-actions';
	for (const button of [newCassetteCancel, newCassetteExport, newCassetteCreate]) button.type = 'button';
	newCassetteActions.append(newCassetteCancel, newCassetteExport, newCassetteCreate);
	newCassetteDialog.append(newCassetteTitle, newCassetteDescription, newCassetteActions);
	doc.body.append(newCassetteDialog);
  const importCassetteDialog=make('dialog','dmgImportCassetteDialog'),importCassetteTitle=make('h2','dmgImportCassetteTitle','Replace this Cassette?'),
    importCassetteDescription=make('p','dmgImportCassetteDescription'),importCassetteActions=make('div'),
    importCassetteCancel=make('button','dmgImportCassetteCancel','Cancel'),importCassetteExport=make('button','dmgImportCassetteExport','Export current & import'),
    importCassetteReplace=make('button','dmgImportCassetteReplace','Import without export');
  importCassetteDialog.setAttribute('aria-labelledby',importCassetteTitle.id);importCassetteActions.className='dmg-new-cassette-actions';
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
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===GAMEBOY_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  const soundPath=()=>project.activeSoundPath??null;
  const pendingMoves=()=>project.getPendingMoves?.()??[];
  function savedPath(path){
    if(!path)return path;
    const move=pendingMoves().find(([,destination])=>inside(path,destination));
    const original=move?move[0]+path.slice(move[1].length):null;
    return original&&hasPath(project.savedFs,original)?original:path;
  }
  function soundFromFile(path,fs=project.fs){
    const file=path&&fs.get(path);return file?.type==='text'?readGameboyProjectSound(file.data):null;
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
      storage.setItem(GAMEBOY_SOUND_JOURNAL_KEY,raw);pendingSoundJournal=raw;recoveryWarning=null;
    }catch(error){const warning=path+':'+error.message;if(recoveryWarning!==warning){recoveryWarning=warning;say(`Immediate sound recovery unavailable: ${error.message} Keep this page open until its local draft is saved, or Export Cassette.`);}}
  }
  function canEditSound(){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before editing the instrument.');
    const path=soundPath();if(!path)return true;
    try{if(!soundFromFile(path))throw Error('Expected a Game Boy sound JSON.');}
    catch(error){throw Error(`Finish or Discard the JSON edits in ${path} before changing its controls. ${error.message}`);}
    return true;
  }
  function adoptExternalSound(value){
    if(disposed||busy||restoring)throw Error('Wait for the current Files operation before loading an instrument.');
    const sound=readGameboyProjectSound(value);if(!sound)throw Error('Expected a Game Boy instrument.');
    soundEditOperation++;soundApplicationPending=false;soundGeneration++;editRevision++;
    project.setActiveSoundPath(null);project.setSettings(sound);project.setSavedSettings(sound);appliedPreset=null;
    render();schedule();return sound;
  }
  function prepareSoundEdit(value=getSettings(),{allowExternal=false}={}){
    canEditSound();const sound=readGameboyProjectSound(value);if(!sound)throw Error('Expected a Game Boy instrument.');
    const active=soundPath(),path=active??newSoundPath(project,sound.name),source=JSON.stringify(sound,null,2)+'\n';
    const bytes=encoder.encode(source).byteLength+project.listEntries().reduce((total,file)=>total+(file.path===path?0:file.size),0);
    const external=bytes>GAMEBOY_PROJECT_FILE_BYTES;
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
    let sound;try{sound=soundFromFile(path);if(!sound)throw Error('Expected a Game Boy sound JSON.');}
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
      if(current())try{if(!soundFromFile(path))throw Error('Expected a Game Boy sound JSON.');}catch(error){say(`JSON not applied; current sound kept. ${error.message}`);}
      return result;
    }).catch(report).finally(()=>{if(token===soundEditOperation)soundApplicationPending=false;});
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
      before=capture(),changed=requested.some(path=>project.isFileModified(path)),candidate=createGameboyCodeProject({snapshot:before.project});
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
      try{accepted=soundFromFile(active,candidate.savedFs);if(!accepted)throw Error('Expected a Game Boy sound JSON.');candidate.setSettings(accepted);candidate.setSavedSettings(accepted);}
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
    const before=capture(),candidate=createGameboyCodeProject({snapshot:before.project}),token=++operation,workspace=identity,
      current=()=>!disposed&&token===operation&&identity===workspace;
    candidate.setAutoApply(enabled);let invalid=null,accepted=candidate.savedSettings;
    const active=candidate.activeSoundPath;
    if(enabled&&active&&candidate.savedFs.has(active)){
      try{accepted=soundFromFile(active,candidate.savedFs);if(!accepted)throw Error('Expected a Game Boy sound JSON.');candidate.setSettings(accepted);candidate.setSavedSettings(accepted);}
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
    const entry=history.peek(),candidate=createGameboyCodeProject({snapshot:entry.project}),before=capture(),oldIdentity=identity,oldPersistence=persistenceReady;
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
      try{storage?.removeItem(GAMEBOY_SOUND_JOURNAL_KEY);}catch{}
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
        let name=null;try{name=readGameboyProjectSound(file.data)?.name??null;}catch{}
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
    if(applied)appliedPreset.data=presetCache.get(applied.path).data;else appliedPreset=null;
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
      if(dirty){const dot=make('span',null,' ●');dot.className='dmg-file-unsaved';dot.setAttribute('aria-label','Unsaved changes');entry.append(dot);}
    }
    for(const[id,button]of buttons)button.disabled=busy||(['dmgFileExportButton','dmgFileRenameButton','dmgFileDeleteButton'].includes(id)&&!project.selectedPath);
    buttons.get('dmgFileSaveButton').disabled=busy||!(project.selectedPath??code?.activePath??soundPath());
    buttons.get('dmgFileSaveAllButton').disabled=busy||!project.getDirtyPaths().length;
    buttons.get('dmgFileDiscardButton').disabled=busy||!project.selectedPath||!project.isFileModified(project.selectedPath);
    buttons.get('dmgFileDiscardAllButton').disabled=busy||!project.getDirtyPaths().length;
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
        try{if(storage?.getItem(GAMEBOY_SOUND_JOURNAL_KEY)===journal)storage.removeItem(GAMEBOY_SOUND_JOURNAL_KEY);}catch{}
        pendingSoundJournal=null;
      }
      return result;
    }
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  const executionPath=()=>code?.executionPath??(isGameboyCodePath(code?.activePath)?code.activePath:null);
  const openInCurrentMode=path=>code?.openFile?.(path,{show:Boolean(code?.isCodeMode?.())});
  function reveal(path){for(let directory=dirname(path);directory!=='/';directory=dirname(directory))expanded.set(directory,true);}
  async function selectFile(path){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();await pendingSoundEdit;if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isGameboyCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null,accepted=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readGameboyProjectSound(file.data);}catch(error){soundError=error;}}
    try{accepted=soundFromFile(savedPath(path),project.savedFs);}catch{}
    const instrument=Boolean(sound||accepted||path===soundPath()||/\.dmg\.json$/i.test(path));
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
    say(sound?(project.autoApply?'Game Boy sound loaded. Controls and valid JSON edits update this file automatically.':'Sound draft selected. Saved sound plays; Save applies your edits.'):soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:isGameboySongPath(path)?'VGM reference song selected. Press Play in the song player; current instrument and Code are kept.':file.type==='text'?'Text edits save to Files from Code; valid edits to the active sound follow Auto apply.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files,{isCurrent=()=>true}={}){
    if(disposed||!isCurrent())return[];
    await api.ready;if(disposed||busy||!isCurrent())return[];const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    const entries=[],songs=[];for(const file of files){if(!current())return[];if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());if(!current())return[];
      if(isGameboySongFilename(file.name))songs.push({name:file.name,bytes});else entries.push({path:'/'+basename(file.name),type:isGameboyTextPath(file.name)?'text':'binary',data:isGameboyTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(!current())return[];await code?.flush?.();if(!current())return[];
    const candidate=createGameboyCodeProject({snapshot:project.snapshot()}),songPaths=candidate.importSongSources(songs),paths=[...candidate.importFiles(entries),...songPaths],replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    if(songPaths.length)candidate.select(songPaths.at(-1));
    const previous=capture();setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||!current())return[];}
      if(!current())return[];
      project.restore(candidate.snapshot());pushHistory(previous);
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
      render();await persistCode();say(`Added ${paths.length} file(s). Code was not run.`);return paths;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSongSource(source,{isCurrent=()=>true}={}){
    await api.ready;if(disposed||busy||!isCurrent())return false;const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    if(await code?.flush?.()===false||!current())return false;
    const candidate=createGameboyCodeProject({snapshot:project.snapshot()}),paths=candidate.importSongSources([source]);if(!current())return false;
    const previous=capture();setBusy(true,{lockMain:false});
    try{
      candidate.select(paths[0]);project.restore(candidate.snapshot());pushHistory(previous);reveal(paths[0]);setVisible(true);render();await persistCode();
      if(!current())return false;say(`Original VGM source saved to ${paths[0]}. Press Play to hear it; current instrument kept.`);return paths[0];
    }finally{if(!disposed)setBusy(false);}
  }
  /** Static VGM extraction saves a passive batch, separate from its raw log.
   * No voice is selected, applied, opened in Code or played by this operation. */
  async function saveVgmSounds({name,voices},{isCurrent=()=>true}={}){
    if(disposed||!isCurrent())return false;
    if(typeof name!=='string'||!Array.isArray(voices))throw TypeError('VGM sounds need a source name and voice array.');
    if(!voices.length)return {paths:[],directory:null};
    await api.ready;if(disposed||busy||!isCurrent())return false;
    const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    if(!current()||await code?.flush?.()===false||!current())return false;
    const metadata=project.listEntries(),used=new Set([...metadata.map(file=>file.path),...project.fs.listDirectories()].map(foldedPath));
    const stem=soundFileStem(basename(name.replace(/\\/g,'/')),/\.(?:vgm|vgz)$/i);
    let index=1,directory='/presets/'+stem;
    while(used.has(foldedPath(directory)))directory=`/presets/${stem} (${++index})`;
    let total=metadata.reduce((bytes,file)=>bytes+file.size,0);
    const entries=voices.map(voice=>{
      const sound=readGameboyProjectSound(voice?.preset);if(!sound)throw Error('Every extracted VGM voice must contain a complete Game Boy preset.');
      const stem=soundFileStem(sound.name);let index=1,path=`${directory}/${stem}.dmg.json`;
      while(used.has(foldedPath(path)))path=`${directory}/${stem} (${++index}).dmg.json`;
      used.add(foldedPath(path));const data=JSON.stringify(sound,null,2)+'\n';total+=encoder.encode(data).byteLength;
      if(total>GAMEBOY_PROJECT_FILE_BYTES)throw Error('VGM sounds exceed the 16 MiB cassette limit. The original VGM and current instrument are kept.');
      return {path,type:'text',data};
    });
    const candidate=createGameboyCodeProject({snapshot:project.snapshot()});candidate.importFiles(entries);
    if(!current())return false;
    const previous=capture();setBusy(true,{lockMain:false});
    try{
      project.restore(candidate.snapshot());pushHistory(previous);reveal(directory);expanded.set(directory,true);setVisible(true);render();
      // Once committed, a late cancellation cannot turn this saved batch into
      // an apparent failure. The importer still fences its own later UI work.
      const result={paths:entries.map(entry=>entry.path),directory};
      const persisted=await persistCode();
      say(`Saved ${entries.length} VGM sound(s) to ${directory}. Choose a preset in Files to load it.`+(persisted===false?' Local save unavailable; export the project to keep the sounds.':''));
      return result;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importProject(bytes,{exportCurrent=false}={}){
    if(typeof exportCurrent!=='boolean')throw TypeError('exportCurrent must be a boolean.');
    await api.ready;if(disposed||disposing||busy)return false;
    const token=++operation,current=()=>!disposed&&!disposing&&token===operation;
    // Reject invalid archives before asking the author to retire any owner.
    const candidate=createGameboyCodeProject({snapshot:await project.prepareImport(bytes)});
    if(!current()||await code?.flush?.({persist:false})===false||!current())return false;
    await pendingSoundEdit;if(!current())return false;
    const previous=capture(),oldIdentity=identity,oldPersistence=persistenceReady;
    let retired=false,applied=false,committed=false;setBusy(true);restoring=true;
    try{
      if(exportCurrent){
        const oldProject=createGameboyCodeProject({snapshot:previous.project});
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
      try{storage?.removeItem(GAMEBOY_SOUND_JOURNAL_KEY);}catch{}
      persistenceReady=true;restoring=false;protectSound();await persistCode();
      say('Game Boy project imported. Code was not run.');return true;
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
			const fresh = createGameboyCodeProject({ snapshot: project.prepareNew() });
			if ((await code?.flush?.()) === false || !current()) return false;
            // Cache + pending edit flush captures both author versions without
            // starting audio or sampling temporary Code/VGM performance data.
            let pending;
            do{pending=pendingSoundEdit;await pending;}while(current()&&pending!==pendingSoundEdit);
            if(!current())return false;setBusy(true);locked=true;restoring=true;
            previous=createGameboyCodeProject({snapshot:capture().project}).snapshot();
			if (exportCurrent) {
				const oldProject = createGameboyCodeProject({ snapshot: previous });
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
            try{storage?.removeItem(GAMEBOY_SOUND_JOURNAL_KEY);}catch{}
			soundEditOperation++;
			persistenceReady = true;
			restoring = false;
			appliedPreset = null;
			presetCache.clear();
			newCassetteDialog.close();
			const persisted = await persistCode();
			say('New Game Boy Cassette created. Code was not run.' +
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
      for(const file of project.fs.list())if(inside(file.path,source)&&isGameboyCodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>GAMEBOY_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createGameboyCodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&project.autoApply&&movedCodePath&&!isGameboyCodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
      if(disposed||token!==operation)return false;
      const previous=capture(),previousApplied=appliedPreset,active=soundPath();
      let moves=null;
      if(!copy&&!project.autoApply){
        const prior=pendingMoves(),covered=prior.some(([,to])=>inside(source,to));
        if(prior.some(([,to])=>source!==to&&inside(source,to)))throw Error('Save or Discard the parent folder rename before moving files inside it.');
        moves=prior.map(([from,to])=>[from,inside(to,source)?destination+to.slice(source.length):to]);
        if(hasPath(project.savedFs,source)&&!covered&&!moves.some(([from])=>from===source))moves.push([source,destination]);
        // Metadata rejection must happen before mutating the live filesystem.
        createGameboyCodeProject().setPendingMoves(moves);
      }
      if(!copy&&appliedPreset&&inside(appliedPreset.path,source))appliedPreset={...appliedPreset,path:destination+appliedPreset.path.slice(source.length)};
      try{if(copy)project.fs.restore(copied);else transferVirtualFiles(project.fs,source,destination);}
      catch(error){appliedPreset=previousApplied;throw error;}
      if(!copy){
        if(moves)project.setPendingMoves(moves);
        if(active&&inside(active,source)){const path=destination+active.slice(source.length);project.setActiveSoundPath(isGameboyTextPath(path)?path:null);}
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
      const previous=capture(),candidate=createGameboyCodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
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
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.dmg\.json$/i.test(requestedPath))throw Error('Use a .dmg.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      const sound=readGameboyProjectSound(providedSound===undefined?getSaveSoundSettings():providedSound);if(!sound)throw Error('Expected a Game Boy instrument.');
      if(!current())return false;
      const path=requestedPath??newSoundPath(project,sound.name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){sound.name=basename(path).replace(/\.dmg\.json$/i,'');readGameboyProjectSound(sound);}
      // Prepare the new document and its explicit saved version separately.
      // Failed native acceptance keeps the prior linked document and layers.
      const previous=capture(),candidate=createGameboyCodeProject({snapshot:previous.project});
      candidate.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);candidate.saveFiles([path]);
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
  /** Capture is a two-preset transaction. Audio ownership stays with the host;
   * validation and capacity failures happen before its apply callback. */
  async function saveCapturedSound(value,{isCurrent=()=>true,apply=async()=>{}}={}){
    await api.ready;if(disposed||busy||!isCurrent())return false;
    const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    setBusy(true,{lockMain:false});
    try{
      if(await code?.flush?.()===false||!current())return false;
      const original=readGameboyProjectSound(getSettings()),captured=readGameboyProjectSound(value);
      if(!original||!captured)throw Error('Capture requires complete Game Boy instrument presets.');
      const previous=capture(),candidate=createGameboyCodeProject({snapshot:project.snapshot()});
      const originalPath=newSoundPath(candidate,original.name);
      candidate.importFiles([{path:originalPath,type:'text',data:JSON.stringify(original,null,2)+'\n'}]);
      const capturedPath=newSoundPath(candidate,captured.name);
      candidate.importFiles([{path:capturedPath,type:'text',data:JSON.stringify(captured,null,2)+'\n'}]);
      candidate.saveFiles([originalPath,capturedPath]);candidate.setSettings(captured);candidate.setSavedSettings(captured);candidate.setActiveSoundPath(capturedPath);candidate.select(capturedPath);
      if(!current())return false;
      if(await apply(readGameboyProjectSound(captured),{isCurrent:current})===false||!current())return false;
      // Host UI is locked until this returns; do not overwrite a stale source.
      project.restore(candidate.snapshot());pushHistory(previous);appliedPreset={kind:'json',path:capturedPath,data:project.fs.get(capturedPath).data};
      reveal(capturedPath);setVisible(true);render();
      // This is the commit point. A later Stop/Resume must not ask the host to
      // roll its instrument back while the committed Files contain Capture.
      const result={path:capturedPath,originalPath,preset:readGameboyProjectSound(captured),committed:true};
      let editorError='';
      try{await code?.openFile?.(capturedPath,{show:false});}
      catch(error){editorError=` Code display failed: ${error?.message??String(error)}`;}
      const persisted=await persistCode();
      say(`Captured to ${capturedPath}. Previous sound kept in ${originalPath}.`+editorError+(persisted===false?' Local save unavailable; export the project to keep both sounds.':''));
      return result;
    }finally{if(!disposed)setBusy(false);}
  }
  async function download(bytes,filename,type='application/octet-stream'){if(typeof win.tetoricaSynthSave==='function')return await win.tetoricaSynthSave(bytes,filename,type);const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action,path=project.selectedPath){
    if(disposed||busy)return;dialogAction=action;dialogPath=path;
    const directory=path&&project.fs.stat(path).type==='directory'?path:path?dirname(path):'/';
    label.textContent={delete:'Delete this project path?',rename:'New file path',instrument:'New instrument · .dmg.json path',folder:'New folder path',new:'New JavaScript file path'}[action];
    nameInput.value=action==='new'?`${directory==='/'?'':directory}/untitled.js`:action==='folder'?`${directory==='/'?'':directory}/New folder/`:action==='instrument'?`${directory==='/'?'/presets':directory}/Untitled.dmg.json`:(path??'');
    nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();
  }
  const contextMenu=installGameboyFileContextMenu({root:tree,document:doc,isBusy:()=>disposed||busy,onError:report,
    onTarget:path=>{if(project.fs.stat(path))project.select(path);},
    getActions:path=>[['undo','Undo file operation'],['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete'],['instrument','New instrument…'],['new','New JavaScript file…'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:id==='undo'?!history.peek():path==='/'&&['duplicate','rename','delete'].includes(id)})),
    onAction:(action,path)=>action==='undo'?undo():action==='duplicate'?duplicate(path):ask(action,path),
  });
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);render();schedule();});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value,path=dialogPath;dialog.close();void Promise.resolve().then(()=>{
    if(action==='new'){if(!isGameboyCodePath(value))throw Error('Use a .js or .mjs file name.');return createFile(value);}
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
  for(const[id,action]of [['dmgFileSaveButton',()=>saveCurrent()],['dmgFileSaveAllButton',()=>saveCurrent(true)],['dmgFileDiscardButton',()=>discardCurrent()],['dmgFileDiscardAllButton',()=>discardCurrent(true)]])listen(buttons.get(id),'click',()=>void action().catch(report));
  for(const[id,fn]of [['dmgProjectNewButton',askNewCassette],['dmgFileNewButton',()=>ask('new')],['dmgFileRenameButton',()=>ask('rename')],['dmgFileDeleteButton',()=>ask('delete')],['dmgFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['dmgProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['dmgFileSaveSoundButton',()=>ask('instrument',null)],['dmgProjectExportButton',()=>void exportProject().then(bytes=>(downloadFile??download)(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['dmgFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)(downloadFile??download)(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(askImportProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&!event.isComposing&&event.key?.toLowerCase()==='s'&&!doc.querySelector?.('dialog[open]')){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();if(!event.repeat)void saveCurrent().catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importProject,newProject,exportProject,createFile,move,duplicate,remove,saveSound,saveSongSource,saveVgmSounds,saveCapturedSound,
    recordSoundEdit,validateSoundEdit,adoptExternalSound,canEditSound,codeEdited,recoverCodeState,isAutoApply:()=>project.autoApply,getSavedEditorPreset:()=>project.savedSettings,
    getWorkingSound:()=>project.settings,getAcceptedSound:()=>project.savedSettings,flushSoundEdits:()=>pendingSoundEdit,
    saveCurrent,saveAll:()=>saveCurrent(true),discardCurrent,discardAll:()=>discardCurrent(true),setAutoApply,undo,getUndoState:()=>history.read(),
    markSoundDirty(value=getSettings()){
      if(disposed)return false;
      // Startup may finish after an early control edit. Preserve that sound
      // without binding it to an unread project's instrument file.
      if(busy||restoring){const sound=readGameboyProjectSound(value);if(!sound)throw Error('Expected a Game Boy instrument.');editRevision++;project.setSettings(sound);if(project.autoApply)project.setSavedSettings(sound);return false;}
      return recordSoundEdit(value);
    },
    async dispose(){if(disposed||disposing)return;disposing=true;operation++;newCassetteDialog.close();newCassetteDialog.remove();importCassetteDialog.close();importCassetteDialog.remove();pendingImport=null;history.clear();contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  function recoverSound(saved){
    const raw=storage?.getItem(GAMEBOY_SOUND_JOURNAL_KEY);if(!raw)return false;
    if(encoder.encode(raw).byteLength>SOUND_JOURNAL_LIMIT)throw Error('Sound recovery exceeds its byte limit.');
    const value=JSON.parse(raw);
    if(value?.version!==1||typeof value.workspaceId!=='string'||!Number.isSafeInteger(value.generation)||value.generation<1||typeof value.autoSave!=='boolean'||
      !(value.workingText===null||typeof value.workingText==='string')||!(value.savedText===null||typeof value.savedText==='string'))throw Error('Invalid sound recovery journal.');
    if(saved&&value.workspaceId!==identity||value.generation<=soundGeneration)return false;
    const path=allowed(value.path),acceptedPath=allowed(value.savedPath??path);if(!/\.json$/i.test(path)||!/\.json$/i.test(acceptedPath))throw Error('Invalid sound recovery path.');
    const settings=readGameboyProjectSound(value.settings),accepted=readGameboyProjectSound(value.savedSettings);if(!settings||!accepted)throw Error('Invalid sound recovery settings.');
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
        if(saved){const candidate=createGameboyCodeProject({snapshot:saved});if(before!==editRevision){candidate.setSettings(getSettings());if(candidate.autoApply)candidate.setSavedSettings(candidate.settings);}
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
