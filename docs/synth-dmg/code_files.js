// Compact Game Boy Files adapter for the shared Synth Code editor.
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {installSpuFileContextMenu as installGameboyFileContextMenu} from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {createGameboyCodeProject,createGameboyProjectStore,readGameboyProjectSound,isGameboyCodePath,isGameboyTextPath,isGameboySongFilename,isGameboySongPath,GAMEBOY_PROJECT_MANIFEST,GAMEBOY_PROJECT_CODE_LENGTH} from './code_project.js?dmg-json-code=1';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`dmg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
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
export function setupGameboyCodeFiles({project=createGameboyCodeProject(),getSettings=()=>project.settings,applySettings=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},setStatus=()=>{},store=createGameboyProjectStore(),document:doc=globalThis.document}={}){
  const panel=doc.getElementById('dmgFilesPanel'),toggle=doc.getElementById('dmgFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const presetSelect=doc.getElementById('dmgPresetSelect'),presetCache=new Map();let presetSignature='',appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('Game Boy Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.dmg-main'),listeners=[],expanded=new Map([['/presets',true],['/lib',true],['/data',true],['/vgm',true]]);
  let code=null,busy=true,disposed=false,restoring=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='dmg-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='dmg-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const actions=make('div');actions.className='dmg-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const[id,label]of [['dmgFileNewButton','New JS'],['dmgFileSaveSoundButton','Save sound'],['dmgFileRenameButton','Rename…'],['dmgFileDeleteButton','Delete…'],['dmgFileImportButton','Add files…'],['dmgFileExportButton','Export file'],['dmgProjectExportButton','Export project'],['dmgProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (id==='dmgFileNewButton'||id==='dmgFileSaveSoundButton'?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='dmgFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    const destination={dmgProjectImportButton:['dmgMenuProjectImport','Project · ZIP…'],dmgProjectExportButton:['dmgMenuProjectExport','Project · ZIP'],dmgFileImportButton:['dmgMenuFilesImport','Project files…'],dmgFileExportButton:['dmgMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='dmgFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','dmgFilesSelected','');selected.className='dmg-files-path dmg-sr-only';selected.setAttribute('role','status');
  const tree=make('div','dmgFilesTree');tree.setAttribute('aria-label','Game Boy project files');
  const info=make('p','dmgFilesStatus','Code and text edits save locally. Importing a project never runs it.');info.className='dmg-files-status';info.setAttribute('role','status');
  const fileInput=make('input','dmgFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','dmgProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','dmgFileNameDialog'),form=make('form'),label=make('label','dmgFileNameLabel','File path'),nameInput=make('input','dmgFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','dmgFileNameConfirm','Create'),cancel=make('button','dmgFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,tree,actions,selected,info,fileInput,projectInput,dialog);
  let dialogAction=null,dialogPath=null;
  const say=message=>{if(!disposed){info.textContent=message;setStatus(message);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===GAMEBOY_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
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
    panel.setAttribute('aria-busy',String(busy));
    const files=project.fs.list().filter(file=>!isCheckpointPath(file.path));renderPresets(files);
    renderFileTree(tree,[...files,...project.fs.listDirectories().filter(path=>path!=='/'&&!isCheckpointPath(path)).map(path=>({path,type:'directory'}))],{
      selectedPath:project.selectedPath,expanded,onOpen:path=>void selectFile(path).catch(report),
      onImport:files=>void importFiles(files).catch(report),onTransfer:(source,destination,copy)=>void move(source,destination,copy).catch(report)});
    for(const[id,button]of buttons)button.disabled=busy||(['dmgFileExportButton','dmgFileRenameButton','dmgFileDeleteButton'].includes(id)&&!project.selectedPath);
    code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value,{lockMain=true}={}){busy=value;if(main)main.inert=Boolean(value&&lockMain);render();}
  async function persistCode(){
    if(disposed)return false;
    if(!busy&&!restoring)project.setSettings(getSettings());
    try{return await store.write({...project.snapshot(),workspaceId:identity,filesVisible:!panel.hidden});}
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
    await code?.flush?.();if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isGameboyCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readGameboyProjectSound(file.data);}catch(error){soundError=error;}}
    if(sound){setBusy(true);try{await onBeforeWorkspaceReplace();if(disposed||token!==operation)return false;await applySettings(sound,{isCurrent:()=>!disposed&&token===operation});if(disposed||token!==operation)return false;}finally{if(!disposed)setBusy(false);}}
    if(sound){project.setSettings(sound);appliedPreset={kind:'json',path,data:file.data};}
    project.select(path);render();schedule();
    if(file.type==='text')await openInCurrentMode(path);
    if(disposed||token!==operation)return false;
    say(sound?'Game Boy sound loaded. Edit its JSON in Code; select it again to apply changes.':soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:file.type==='text'?'Text edits save to Files from Code; select a Game Boy sound JSON again to apply it.':isGameboySongPath(path)?'VGM source selected. Press Play in the song list; your instrument is kept.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files){
    await api.ready;if(disposed||busy)return[];const token=++operation;
    const entries=[],songs=[];for(const file of files){if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());
      if(isGameboySongFilename(file.name))songs.push({name:file.name,bytes});else entries.push({path:'/'+basename(file.name),type:isGameboyTextPath(file.name)?'text':'binary',data:isGameboyTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(disposed||token!==operation)return[];await code?.flush?.();if(disposed||token!==operation)return[];
    const candidate=createGameboyCodeProject({snapshot:project.snapshot()}),songPaths=candidate.importSongSources(songs),paths=[...candidate.importFiles(entries),...songPaths],replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    if(songPaths.length)candidate.select(songPaths.at(-1));
    setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||disposed||token!==operation)return[];}
      if(disposed||token!==operation)return[];
      project.restore(candidate.snapshot());
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
      render();await persistCode();say(`Added ${paths.length} file(s). Code was not run.`);return paths;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSongSource(source,{isCurrent=()=>true}={}){
    await api.ready;if(disposed||busy||!isCurrent())return false;const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    if(await code?.flush?.()===false||!current())return false;
    const candidate=createGameboyCodeProject({snapshot:project.snapshot()}),paths=candidate.importSongSources([source]);if(!current())return false;
    setBusy(true,{lockMain:false});
    try{
      candidate.select(paths[0]);project.restore(candidate.snapshot());reveal(paths[0]);setVisible(true);render();await persistCode();
      if(!current())return false;say(`Original VGM source saved to ${paths[0]}. Press Play to hear it; current instrument kept.`);return paths[0];
    }finally{if(!disposed)setBusy(false);}
  }
  async function importProject(bytes){
    await api.ready;if(disposed||busy)return false;const token=++operation;
    const candidate=await project.prepareImport(bytes);if(disposed||token!==operation)return false;
    await code?.flush?.();if(disposed||token!==operation)return false;setBusy(true);
    try{
      if(await code?.workspaceReplaced?.()===false||disposed||token!==operation)return false;
      await onBeforeWorkspaceReplace();if(disposed||token!==operation)return false;
      await applySettings(candidate.settings,{isCurrent:()=>!disposed&&token===operation});if(disposed||token!==operation)return false;
      restoring=true;try{appliedPreset=null;presetCache.clear();project.restore(candidate);identity=workspaceId();}finally{restoring=false;}
      await code?.restoreState?.(project.getCodeState());await persistCode();say('Game Boy project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();project.setSettings(getSettings());return project.exportProject();}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true,{lockMain:!copy});
    try{
      if(occupied(project,destination)&&(copy||foldedPath(source)!==foldedPath(destination)))throw Error('That path already exists.');
      for(const file of project.fs.list())if(inside(file.path,source)&&isGameboyCodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>GAMEBOY_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createGameboyCodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&movedCodePath&&!isGameboyCodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
      if(disposed||token!==operation)return false;
      const previousApplied=appliedPreset;
      if(!copy&&appliedPreset&&inside(appliedPreset.path,source))appliedPreset={...appliedPreset,path:destination+appliedPreset.path.slice(source.length)};
      try{if(copy)project.fs.restore(copied);else transferVirtualFiles(project.fs,source,destination);}
      catch(error){appliedPreset=previousApplied;throw error;}
      if(!copy){if(inside(project.selectedPath,source))project.select(destination+project.selectedPath.slice(source.length));code?.pathChanged?.(source,destination);}
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
    try{if(inside(executionPath(),path))await code.stop();if(disposed||token!==operation)return false;
      if(inside(project.selectedPath,path))project.select(null);
      project.fs.remove(path,{recursive:true});code?.pathChanged?.(path,null);render();await persistCode();return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function createFile(path){
    await api.ready;if(disposed||busy)return false;const token=++operation,directory=String(path).endsWith('/');path=allowed(path);
    await code?.flush?.();if(disposed||token!==operation)return false;
    if(occupied(project,path))throw Error('That path already exists.');setBusy(true,{lockMain:false});
    try{
      const candidate=createGameboyCodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
      candidate.restore(candidate.snapshot());project.fs.restore(candidate.fs.snapshot());project.select(path);reveal(path);if(directory)expanded.set(path,true);render();
      if(!directory)await openInCurrentMode(path);if(disposed||token!==operation)return false;
      await persistCode();say(`Created ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSound({path:requestedPath}={}){
    if(disposed||busy)return false;const token=++operation;setBusy(true,{lockMain:false});
    try{
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.dmg\.json$/i.test(requestedPath))throw Error('Use a .dmg.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      const sound=readGameboyProjectSound(getSettings());if(!sound)throw Error('Expected a Game Boy instrument.');
      if(disposed||token!==operation)return false;
      const path=requestedPath??newSoundPath(project,sound.name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){sound.name=basename(path).replace(/\.dmg\.json$/i,'');readGameboyProjectSound(sound);}
      // importFiles validates its candidate before touching this workspace.
      // Name / size failures must keep both existing files and selection.
      project.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);
      project.select(path);reveal(path);setVisible(true);render();
      await code?.openFile?.(path,{show:false});if(disposed||token!==operation)return false;
      const persisted=await persistCode();
      say('Current DMG instrument saved to '+path+(persisted===false?' in Files. Local save unavailable; export the project to keep it.':''));return path;
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
      const candidate=createGameboyCodeProject({snapshot:project.snapshot()});
      const originalPath=newSoundPath(candidate,original.name);
      candidate.importFiles([{path:originalPath,type:'text',data:JSON.stringify(original,null,2)+'\n'}]);
      const capturedPath=newSoundPath(candidate,captured.name);
      candidate.importFiles([{path:capturedPath,type:'text',data:JSON.stringify(captured,null,2)+'\n'}]);
      candidate.setSettings(captured);candidate.select(capturedPath);
      if(!current())return false;
      if(await apply(readGameboyProjectSound(captured),{isCurrent:current})===false||!current())return false;
      // Host UI is locked until this returns; do not overwrite a stale source.
      project.restore(candidate.snapshot());appliedPreset=null;
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
  function download(bytes,filename,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action,path=project.selectedPath){
    if(disposed||busy)return;dialogAction=action;dialogPath=path;
    const directory=path&&project.fs.stat(path).type==='directory'?path:path?dirname(path):'/';
    label.textContent={delete:'Delete this project path?',rename:'New file path',instrument:'New instrument · .dmg.json path',folder:'New folder path',new:'New JavaScript file path'}[action];
    nameInput.value=action==='new'?`${directory==='/'?'':directory}/untitled.js`:action==='folder'?`${directory==='/'?'':directory}/New folder/`:action==='instrument'?`${directory==='/'?'/presets':directory}/Untitled.dmg.json`:(path??'');
    nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();
  }
  const contextMenu=installGameboyFileContextMenu({root:tree,document:doc,isBusy:()=>disposed||busy,onError:report,
    onTarget:path=>{if(project.fs.stat(path))project.select(path);},
    getActions:path=>[['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete'],['instrument','New instrument…'],['new','New JavaScript file…'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:path==='/'&&['duplicate','rename','delete'].includes(id)})),
    onAction:(action,path)=>action==='duplicate'?duplicate(path):ask(action,path),
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
  listen(presetSelect,'change',()=>{const choice=presetOptions.get(presetSelect.value);presetSelect.blur();if(choice)void(selectFile(choice.path)).catch(report);});
  for(const[id,fn]of [['dmgFileNewButton',()=>ask('new')],['dmgFileRenameButton',()=>ask('rename')],['dmgFileDeleteButton',()=>ask('delete')],['dmgFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['dmgProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['dmgFileSaveSoundButton',()=>void saveSound().catch(report)],['dmgProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['dmgFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();void(code?.flush?.()??persistCode()).catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importProject,exportProject,createFile,move,duplicate,remove,saveSound,saveSongSource,saveCapturedSound,
    markSoundDirty(){editRevision++;appliedPreset=null;if(presetSelect)presetSelect.value='';if(disposed||busy||restoring)return;project.setSettings(getSettings());schedule();},
    async dispose(){if(disposed)return;operation++;contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  const initialEditRevision=editRevision;
  api.ready=Promise.resolve().then(async()=>{
    const before=initialEditRevision;
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createGameboyCodeProject({snapshot:saved});if(before!==editRevision)candidate.setSettings(getSettings());
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;if(before!==editRevision)candidate.setSettings(getSettings());await applySettings(candidate.settings,{isCurrent:()=>!disposed});if(disposed)return;presetCache.clear();appliedPreset=null;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed)setBusy(false);}
  });if(main)main.inert=true;render();return api;
}
