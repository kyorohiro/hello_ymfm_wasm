// NES + FDS Files adapter for the shared Synth Code editor.
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {installSpuFileContextMenu as installNesFileContextMenu} from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {createNesCodeProject,createNesProjectStore,readNesProjectSound,isNesCodePath,isNesTextPath,NES_PROJECT_MANIFEST,NES_PROJECT_CODE_LENGTH} from './code_project.js?v=draft-reconnect-1';
import {extractVgmInstruments} from './vgm_import.js';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`nes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
function soundFileStem(value,extension=/\.nes\.json$/i){
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
  let index=1,path='/presets/'+stem+'.nes.json';
  while(occupied.has(fold(path)))path=`/presets/${stem} (${++index}).nes.json`;
  return path;
}
const foldedPath=path=>path.normalize('NFC').toLowerCase();
const occupied=(project,path)=>[...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].some(item=>foldedPath(item)===foldedPath(path));
function uniqueImportPath(directory,stem,extension,used) {
  let index=1,path=`${directory}/${stem}${extension}`;
  while(used.has(foldedPath(path)))path=`${directory}/${stem} (${++index})${extension}`;
  used.add(foldedPath(path));
  return path;
}
function copyPath(project,path){
  const name=basename(path),directory=dirname(path),folder=project.fs.stat(path).type==='directory';
  const extension=folder?'':name.match(/\.nes\.json$/i)?.[0]??name.match(/\.[^./]+$/)?.[0]??'';
  const stem=extension?name.slice(0,-extension.length):name;
  let index=1,result;
  do{result=`${directory==='/'?'':directory}/${stem}-copy${index===1?'':`-${index}`}${extension}`;index++;}while(occupied(project,result));
  return result;
}
export function setupNesCodeFiles({project=createNesCodeProject(),getSettings=()=>project.settings,applySettings=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},onBeforeSoundApply=async()=>{},onSelectSong=async()=>{},setStatus=()=>{},store=createNesProjectStore(),document:doc=globalThis.document}={}){
  const panel=doc.getElementById('nesFilesPanel'),toggle=doc.getElementById('nesFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const saveSoundAs=doc.getElementById('nesSaveSoundAs'),presetSelect=doc.getElementById('nesPresetSelect'),presetCache=new Map();let presetSignature='',appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('NES + FDS Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.nes-main'),listeners=[],expanded=new Map([['/presets',true],['/vgm',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,restoring=false,persistenceReady=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='nes-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='nes-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const actions=make('div');actions.className='nes-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const[id,label]of [['nesFileNewButton','New JS'],['nesFileSaveSoundButton','Save sound'],['nesFileRenameButton','Rename…'],['nesFileDeleteButton','Delete…'],['nesFileImportButton','Add files…'],['nesFileExportButton','Export file'],['nesProjectExportButton','Export project'],['nesProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (id==='nesFileNewButton'||id==='nesFileSaveSoundButton'?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='nesFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    const destination={nesProjectImportButton:['nesMenuProjectImport','Cassette…'],nesProjectExportButton:['nesMenuProjectExport','Cassette · ZIP'],nesFileImportButton:['nesMenuFilesImport','Files…'],nesFileExportButton:['nesMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='nesFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','nesFilesSelected','');selected.className='nes-files-path nes-sr-only';selected.setAttribute('role','status');
  const tree=make('div','nesFilesTree');tree.setAttribute('aria-label','NES + FDS project files');
  const info=make('p','nesFilesStatus','Code and text edits save locally. Importing a project never runs it.');info.className='nes-files-status';info.setAttribute('role','status');
  const importDetails=make('details','nesImportDetails');importDetails.className='nes-files-import-details';importDetails.hidden=true;
  const importSummary=make('summary',null,'Import details'),importNotes=make('ul','nesImportNotes');
  importDetails.append(importSummary,importNotes);
  const fileInput=make('input','nesFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','nesProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','nesFileNameDialog'),form=make('form'),label=make('label','nesFileNameLabel','File path'),nameInput=make('input','nesFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','nesFileNameConfirm','Create'),cancel=make('button','nesFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,tree,actions,selected,info,importDetails,fileInput,projectInput,dialog);
  let dialogAction=null,dialogPath=null,dialogSound=null;
  const say=message=>{if(!disposed){info.textContent=message;setStatus(message);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===NES_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  function renderPresets(files){
    if(!presetSelect){const paths=new Set(files.map(file=>file.path));for(const path of presetCache.keys())if(!paths.has(path))presetCache.delete(path);return;}
    const present=new Set(),entries=[];
    for(const file of files) {
      if(!file.path.startsWith('/presets/'))continue;
      if(file.type!=='text'||!/\.json$/i.test(file.path))continue;
      present.add(file.path);let saved=presetCache.get(file.path);
      if(saved?.kind!=='json'||saved.data!==file.data) {
        let name=null;try{name=readNesProjectSound(file.data)?.name??null;}catch{}
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
    panel.setAttribute('aria-busy',String(busy));if(saveSoundAs)saveSoundAs.disabled=busy;
    const files=project.fs.list().filter(file=>!isCheckpointPath(file.path));renderPresets(files);
    renderFileTree(tree,[...files,...project.fs.listDirectories().filter(path=>path!=='/'&&!isCheckpointPath(path)).map(path=>({path,type:'directory'}))],{
      selectedPath:project.selectedPath,expanded,onOpen:path=>void selectFile(path).catch(report),
      onImport:files=>void importFiles(files).catch(report),onTransfer:(source,destination,copy)=>void move(source,destination,copy).catch(report)});
    for(const[id,button]of buttons)button.disabled=busy||(['nesFileExportButton','nesFileRenameButton','nesFileDeleteButton'].includes(id)&&!project.selectedPath);
    code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value,{lockMain=true}={}){busy=value;if(main)main.inert=Boolean(value&&lockMain);render();}
  async function persistCode(){
    if(disposed||!persistenceReady)return false;
    try{
      if(!busy&&!restoring)project.setSettings(getSettings());
      return await store.write({...project.snapshot(),workspaceId:identity,filesVisible:!panel.hidden});
    }
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  const executionPath=()=>code?.executionPath??(isNesCodePath(code?.activePath)?code.activePath:null);
  const openInCurrentMode=path=>code?.openFile?.(path,{show:Boolean(code?.isCodeMode?.())});
  function reveal(path){for(let directory=dirname(path);directory!=='/';directory=dirname(directory))expanded.set(directory,true);}
  async function selectFile(path){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(file.type==='binary'&&/\.(?:vgm|vgz)$/i.test(path)){
      await onSelectSong({path,data:file.data.slice()});if(disposed||token!==operation)return false;
      project.select(path);render();schedule();return true;
    }
    if(isNesCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null;
    if(file.type==='text'&&/\.json$/i.test(path)){
      try{
        const value=JSON.parse(file.data),candidate=readNesProjectSound(value);
        if(candidate)sound=candidate;
      }catch(error){soundError=error;}
    }
    if(sound){
      setBusy(true);
      try{
        await onBeforeSoundApply();if(disposed||token!==operation)return false;
        const applied=await applySettings(sound,{isCurrent:()=>!disposed&&token===operation});
        if(applied===false||disposed||token!==operation)return false;
      }finally{
        if(!disposed){
          // A Stop can arrive after the chip committed but before its reply.
          // Persist the host's reconciled sound without marking a failed file
          // selection as the applied preset.
          if(token===operation)project.setSettings(getSettings());
          setBusy(false);if(token===operation)schedule();
        }
      }
    }
    if(sound){project.setSettings(getSettings());appliedPreset={kind:'json',path,data:file.data};}
    project.select(path);render();schedule();
    if(file.type==='text')await openInCurrentMode(path);
    if(disposed||token!==operation)return false;
    say(sound?'NES + FDS sound loaded. Edit its JSON in Code; select it again to apply changes.':soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:file.type==='text'?'Text edits save to Files from Code; select an NES + FDS sound JSON again to apply it.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files,{isCurrent=()=>true,vgmResults=new Map()}={}){
    if(disposed||!isCurrent())return[];
    await api.ready;if(disposed||busy||!isCurrent())return[];const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    const imports=[];
    for(const file of files){
      if(!current())return[];
      if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(!current())return[];
      let extracted=null;
      if(/\.(?:vgm|vgz)$/i.test(file.name)){
        try{
          const result=vgmResults.get(file)??await extractVgmInstruments(bytes);
          extracted={presets:result.voices,warnings:result.warnings};
        }catch(error){if(!current())return[];throw error;}
        if(!current())return[];
      }
      imports.push({file,bytes,extracted});
    }
    if(!current())return[];await code?.flush?.();if(!current())return[];
    const candidate=createNesCodeProject({snapshot:project.snapshot()});
    const used=new Set([...candidate.fs.list().map(file=>file.path),...candidate.fs.listDirectories()].map(foldedPath));
    // Reserve ordinary imports before deriving song and preset paths. Their
    // existing replace-on-import behavior remains available to Code files.
    for(const {file,extracted}of imports)if(!extracted)used.add(foldedPath('/'+basename(file.name)));
    const entries=[],presetPaths=[],sourcePaths=[],warnings=new Set();
    for(const {file,bytes,extracted}of imports){
      if(!extracted){
        const text=isNesTextPath(file.name);
        entries.push({path:'/'+basename(file.name),type:text?'text':'binary',data:text?decoder.decode(bytes):bytes});
        continue;
      }
      const extension=file.name.match(/\.(?:vgm|vgz)$/i)[0].toLowerCase();
      const stem=soundFileStem(basename(file.name),/\.(?:vgm|vgz)$/i);
      const songPath=uniqueImportPath('/vgm',stem,extension,used);
      entries.push({path:songPath,type:'binary',data:bytes});sourcePaths.push(songPath);
      const directory=extracted.presets.length?uniqueImportPath('/presets',stem,'',used):null;
      for(const voice of extracted.presets){
        const sound=readNesProjectSound(voice.preset);
        if(!sound)throw Error('Expected an extracted NES + FDS instrument.');
        const path=uniqueImportPath(directory,soundFileStem(sound.name),'.nes.json',used);
        entries.push({path,type:'text',data:JSON.stringify(sound,null,2)+'\n'});
        presetPaths.push(path);
      }
      for(const warning of extracted.warnings??[])warnings.add(warning);
    }
    const paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||!current())return[];}
      if(!current())return[];
      project.fs.restore(candidate.fs.snapshot());
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
      if(presetPaths.length){for(const path of presetPaths)reveal(path);setVisible(true);}
      if(sourcePaths.length){
        importDetails.hidden=warnings.size===0;importDetails.open=false;
        importSummary.textContent=`Import details · ${warnings.size} ${warnings.size===1?'note':'notes'}`;
        importNotes.replaceChildren(...[...warnings].map(warning=>make('li',null,warning)));
      }
      render();
      const persisted=await persistCode();
      if(!current())return[];
      say(sourcePaths.length?`Added ${sourcePaths.length} song(s) and ${presetPaths.length} preset(s) in /presets/.${warnings.size?' '+warnings.size+' import note(s).':''}${persisted===false?' Local save unavailable; export the project to keep these files.':''}`:`Added ${paths.length} file(s). Code was not run.`);
      return [...sourcePaths,...paths.filter(path=>!sourcePaths.includes(path))];
    }finally{if(!disposed)setBusy(false);}
  }
  async function importVgm({name,bytes,result,isCurrent=()=>true}={}){
    if(typeof name!=='string'||! /\.(?:vgm|vgz)$/i.test(name))throw Error('Use a .vgm or .vgz song file name.');
    if(!(bytes instanceof Uint8Array))throw TypeError('A VGM source needs Uint8Array bytes.');
    const source=bytes.slice();
    const file={name,size:source.byteLength,arrayBuffer:async()=>source.slice().buffer};
    return importFiles([file],{isCurrent,vgmResults:result?new Map([[file,result]]):undefined});
  }
  async function importProject(bytes){
    await api.ready;if(disposed||busy)return false;const token=++operation;
    const candidate=await project.prepareImport(bytes);if(disposed||token!==operation)return false;
    await code?.flush?.();if(disposed||token!==operation)return false;setBusy(true);
    try{
      if(await code?.workspaceReplaced?.()===false||disposed||token!==operation)return false;
      await onBeforeWorkspaceReplace();if(disposed||token!==operation)return false;
      await applySettings(candidate.settings,{isCurrent:()=>!disposed&&token===operation});if(disposed||token!==operation)return false;
      restoring=true;try{appliedPreset=null;presetCache.clear();project.restore(candidate);identity=workspaceId();importDetails.hidden=true;importDetails.open=false;importNotes.replaceChildren();}finally{restoring=false;}
      await code?.restoreState?.(project.getCodeState());await persistCode();say('NES + FDS project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();project.setSettings(getSettings());return project.exportProject();}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true,{lockMain:!copy});
    try{
      if(occupied(project,destination)&&(copy||foldedPath(source)!==foldedPath(destination)))throw Error('That path already exists.');
      for(const file of project.fs.list())if(inside(file.path,source)&&isNesCodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>NES_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createNesCodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&movedCodePath&&!isNesCodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
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
      const candidate=createNesCodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
      candidate.restore(candidate.snapshot());project.fs.restore(candidate.fs.snapshot());project.select(path);reveal(path);if(directory)expanded.set(path,true);render();
      if(!directory)await openInCurrentMode(path);if(disposed||token!==operation)return false;
      await persistCode();say(`Created ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSound({path:requestedPath,name:requestedName,sound:requestedSound}={}){
    if(disposed||busy)return false;const token=++operation,saveEditRevision=editRevision;setBusy(true,{lockMain:false});
    try{
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.nes\.json$/i.test(requestedPath))throw Error('Use a .nes.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      let sound=readNesProjectSound(requestedSound??getSettings());if(!sound)throw Error('Expected an NES + FDS instrument.');
      if(requestedName!==undefined){
        if(requestedPath!==undefined)throw Error('Choose a sound name or a file path, not both.');
        if(typeof requestedName!=='string'||!requestedName.trim())throw Error('Enter a sound name.');
        sound=readNesProjectSound({...sound,name:requestedName});
      }
      if(disposed||token!==operation)return false;
      const path=requestedPath??newSoundPath(project,sound.name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){sound.name=basename(path).replace(/\.nes\.json$/i,'');readNesProjectSound(sound);}
      // importFiles validates its candidate before touching this workspace.
      // Name / size failures must keep both existing files and selection.
      project.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);
      project.select(path);reveal(path);setVisible(true);render();
      await code?.openFile?.(path,{show:false});if(disposed||token!==operation)return false;
      const persisted=await persistCode();
      say('Current NES + FDS instrument saved to '+path+(persisted===false?' in Files. Local save unavailable; export the project to keep it.':''));return path;
    }finally{if(!disposed){setBusy(false);if(token===operation&&saveEditRevision!==editRevision){project.setSettings(getSettings());schedule();}}}
  }
  function download(bytes,filename,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action,path=project.selectedPath){
    if(disposed||busy)return;dialogAction=action;dialogPath=path;
    dialogSound=action==='save-sound'?readNesProjectSound(getSettings()):null;
    const directory=path&&project.fs.stat(path).type==='directory'?path:path?dirname(path):'/';
    label.textContent={'save-sound':'Sound name',delete:'Delete this project path?',rename:'New file path',instrument:'New instrument · .nes.json path',folder:'New folder path',new:'New JavaScript file path'}[action];
    nameInput.value=action==='save-sound'?(dialogSound.name||'Untitled'):action==='new'?`${directory==='/'?'':directory}/untitled.js`:action==='folder'?`${directory==='/'?'':directory}/New folder/`:action==='instrument'?`${directory==='/'?'/presets':directory}/Untitled.nes.json`:(path??'');
    nameInput.required=action==='save-sound';nameInput.maxLength=action==='save-sound'?80:524288;
    nameInput.readOnly=action==='delete';confirm.textContent=action==='save-sound'?'Save':action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();
  }
  function askSaveSound(){if(disposed||busy)return false;setVisible(true);ask('save-sound');return true;}
  const contextMenu=installNesFileContextMenu({root:tree,document:doc,isBusy:()=>disposed||busy,onError:report,
    onTarget:path=>{if(project.fs.stat(path))project.select(path);},
    getActions:path=>[['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete'],['instrument','New instrument…'],['new','New JavaScript file…'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:path==='/'&&['duplicate','rename','delete'].includes(id)})),
    onAction:(action,path)=>action==='duplicate'?duplicate(path):ask(action,path),
  });
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);render();schedule();});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value,path=dialogPath,sound=dialogSound;dialog.close();void Promise.resolve().then(()=>{
    if(action==='save-sound')return saveSound({name:value,sound});
    if(action==='new'){if(!isNesCodePath(value))throw Error('Use a .js or .mjs file name.');return createFile(value);}
    if(action==='folder')return createFile(value.replace(/\/$/,'')+'/');
    if(action==='instrument')return saveSound({path:value});
    return action==='rename'?move(path,value):remove(path);
  }).catch(report);});
  listen(cancel,'click',()=>dialog.close());listen(dialog,'close',()=>{dialogSound=null;});
  listen(saveSoundAs,'click',()=>{saveSoundAs.blur();try{askSaveSound();}catch(error){report(error);}});
  listen(presetSelect,'change',()=>{const choice=presetOptions.get(presetSelect.value);presetSelect.blur();if(choice)void(selectFile(choice.path)).catch(report);});
  for(const[id,fn]of [['nesFileNewButton',()=>ask('new')],['nesFileRenameButton',()=>ask('rename')],['nesFileDeleteButton',()=>ask('delete')],['nesFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['nesProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['nesFileSaveSoundButton',()=>void saveSound().catch(report)],['nesProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['nesFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();void(code?.flush?.()??persistCode()).catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importVgm,importProject,exportProject,createFile,move,duplicate,remove,saveSound,askSaveSound,
    markSoundDirty(){editRevision++;appliedPreset=null;if(presetSelect)presetSelect.value='';if(disposed||busy||restoring)return;project.setSettings(getSettings());schedule();},
    async dispose(){if(disposed)return;operation++;contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  const initialEditRevision=editRevision;
  api.ready=Promise.resolve().then(async()=>{
    const before=initialEditRevision;
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createNesCodeProject({snapshot:saved});if(before!==editRevision)candidate.setSettings(getSettings());
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;if(before!==editRevision)candidate.setSettings(getSettings());await applySettings(candidate.settings,{isCurrent:()=>!disposed});if(disposed)return;presetCache.clear();appliedPreset=null;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}
      // Never save defaults over an unread or invalid stored project. Only
      // the initial successful restore enables persistence; reconnect is I/O.
      persistenceReady=true;}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed){setBusy(false);if(persistenceReady&&before!==editRevision)schedule();}}
  });if(main)main.inert=true;render();return api;
}
