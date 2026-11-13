// Compact HuC6280 Files adapter for the shared Synth Code editor.
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {installSpuFileContextMenu as installHuc6280FileContextMenu} from '../synth-spu/file_context_menu.js?v=spu-files-menu-1';
import {createHuc6280CodeProject,createHuc6280ProjectStore,readHuc6280ProjectSound,isHuc6280CodePath,isHuc6280TextPath,isHuc6280SongPath,HUC6280_PROJECT_MANIFEST,HUC6280_PROJECT_CODE_LENGTH,HUC6280_PROJECT_FILE_BYTES} from './code_project.js?v=huc-song-1';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`huc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
function soundFileStem(value,extension=/\.huc6280\.json$/i){
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
  let index=1,path='/presets/'+stem+'.huc6280.json';
  while(occupied.has(fold(path)))path=`/presets/${stem} (${++index}).huc6280.json`;
  return path;
}
function importedSoundPath(filename,used){
  const stem=soundFileStem(filename,/\.json$/i),extension=filename.match(/\.json$/i)?.[0]??'.json';
  let index=1,path=`/presets/${stem}${extension}`;
  while(used.has(foldedPath(path)))path=`/presets/${stem} (${++index})${extension}`;
  used.add(foldedPath(path));return path;
}
function importedSongPath(filename,used){
  const stem=soundFileStem(filename,/\.vg[mz]$/i),extension=filename.match(/\.vg[mz]$/i)?.[0];
  if(!extension)throw Error('Choose a .vgm or .vgz reference song.');
  let index=1,path=`/vgm/${stem}${extension}`;
  while(used.has(foldedPath(path)))path=`/vgm/${stem} (${++index})${extension}`;
  used.add(foldedPath(path));return path;
}
const foldedPath=path=>path.normalize('NFC').toLowerCase();
const occupied=(project,path)=>[...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].some(item=>foldedPath(item)===foldedPath(path));
function copyPath(project,path){
  const name=basename(path),directory=dirname(path),folder=project.fs.stat(path).type==='directory';
  const extension=folder?'':name.match(/\.huc6280\.json$/i)?.[0]??name.match(/\.[^./]+$/)?.[0]??'';
  const stem=extension?name.slice(0,-extension.length):name;
  let index=1,result;
  do{result=`${directory==='/'?'':directory}/${stem}-copy${index===1?'':`-${index}`}${extension}`;index++;}while(occupied(project,result));
  return result;
}
export function setupHuc6280CodeFiles({project=createHuc6280CodeProject(),getSettings=()=>project.settings,applySettings=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},onBeforeSoundApply=async()=>{},setStatus=()=>{},store=createHuc6280ProjectStore(),document:doc=globalThis.document}={}){
  const panel=doc.getElementById('hucFilesPanel'),toggle=doc.getElementById('hucFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const presetSelect=doc.getElementById('hucPresetSelect'),presetCache=new Map();let presetSignature='',appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('HuC6280 Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.huc-main'),listeners=[],expanded=new Map([['/presets',true],['/vgm',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,restoring=false,persistenceReady=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='huc-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='huc-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const actions=make('div');actions.className='huc-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const[id,label]of [['hucFileNewButton','New JS'],['hucFileSaveSoundButton','Save sound'],['hucFileRenameButton','Rename…'],['hucFileDeleteButton','Delete…'],['hucFileImportButton','Add files…'],['hucFileExportButton','Export file'],['hucProjectExportButton','Export project'],['hucProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (id==='hucFileNewButton'||id==='hucFileSaveSoundButton'?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='hucFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    const destination={hucProjectImportButton:['hucMenuProjectImport','Project · ZIP…'],hucProjectExportButton:['hucMenuProjectExport','Project · ZIP'],hucFileImportButton:['hucMenuFilesImport','Project files…'],hucFileExportButton:['hucMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='hucFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','hucFilesSelected','');selected.className='huc-files-path huc-sr-only';selected.setAttribute('role','status');
  const tree=make('div','hucFilesTree');tree.setAttribute('aria-label','HuC6280 project files');
  const info=make('p','hucFilesStatus','Code and text edits save locally. Importing a project never runs it.');info.className='huc-files-status';info.setAttribute('role','status');
  const fileInput=make('input','hucFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','hucProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','hucFileNameDialog'),form=make('form'),label=make('label','hucFileNameLabel','File path'),nameInput=make('input','hucFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','hucFileNameConfirm','Create'),cancel=make('button','hucFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,tree,actions,selected,info,fileInput,projectInput,dialog);
  let dialogAction=null,dialogPath=null;
  const say=message=>{if(!disposed){info.textContent=message;setStatus(message);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===HUC6280_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  function renderPresets(files){
    if(!presetSelect){const paths=new Set(files.map(file=>file.path));for(const path of presetCache.keys())if(!paths.has(path))presetCache.delete(path);return;}
    const present=new Set(),entries=[];
    for(const file of files) {
      if(!file.path.startsWith('/presets/'))continue;
      if(file.type!=='text'||!/\.json$/i.test(file.path))continue;
      present.add(file.path);let saved=presetCache.get(file.path);
      if(saved?.kind!=='json'||saved.data!==file.data) {
        let name=null;try{name=readHuc6280ProjectSound(file.data)?.name??null;}catch{}
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
    for(const[id,button]of buttons)button.disabled=busy||(['hucFileExportButton','hucFileRenameButton','hucFileDeleteButton'].includes(id)&&!project.selectedPath);
    code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value,{lockMain=true}={}){busy=value;if(main)main.inert=Boolean(value&&lockMain);render();}
  async function persistCode(){
    if(disposed||!persistenceReady)return false;
    if(!busy&&!restoring)project.setSettings(getSettings());
    try{return await store.write({...project.snapshot(),workspaceId:identity,filesVisible:!panel.hidden});}
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  const executionPath=()=>code?.executionPath??(isHuc6280CodePath(code?.activePath)?code.activePath:null);
  const openInCurrentMode=path=>code?.openFile?.(path,{show:Boolean(code?.isCodeMode?.())});
  function reveal(path){for(let directory=dirname(path);directory!=='/';directory=dirname(directory))expanded.set(directory,true);}
  async function selectFile(path){
    if(!disposed&&!busy)code?.cancelPendingExecution?.();
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isHuc6280CodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readHuc6280ProjectSound(file.data);}catch(error){soundError=error;}}
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
    if(sound){project.setSettings(sound);appliedPreset={kind:'json',path,data:file.data};}
    project.select(path);render();schedule();
    if(file.type==='text')await openInCurrentMode(path);
    if(disposed||token!==operation)return false;
    say(sound?'HuC6280 sound loaded. Edit its JSON in Code; select it again to apply changes.':soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:isHuc6280SongPath(path)?'VGM reference song selected. Press Play in the song player; current instrument and Code are kept.':file.type==='text'?'Text edits save to Files from Code; select a HuC6280 sound JSON again to apply it.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files,{isCurrent=()=>true,announce=true}={}){
    if(disposed||!isCurrent())return[];
    if(typeof announce!=='boolean')throw TypeError('Import announcement must be boolean.');
    await api.ready;if(disposed||busy||!isCurrent())return[];const token=++operation,current=()=>!disposed&&token===operation&&isCurrent();
    const imported=[];for(const file of files){if(!current())return[];if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB. Use Load preset for a larger audio instrument.');const bytes=new Uint8Array(await file.arrayBuffer());if(!current())return[];
      const filename=basename(file.name),type=isHuc6280TextPath(filename)?'text':'binary',data=type==='text'?decoder.decode(bytes):bytes;
      let sound=false;if(type==='text'&&/\.json$/i.test(filename)){try{sound=Boolean(readHuc6280ProjectSound(data));}catch{}}
      imported.push({filename,type,data,sound});}
    if(!current())return[];await code?.flush?.();if(!current())return[];
    const candidate=createHuc6280CodeProject({snapshot:project.snapshot()}),used=new Set([...candidate.listEntries().map(file=>file.path),...candidate.fs.listDirectories()].map(foldedPath));
    const entries=imported.map(({filename,type,data,sound})=>({path:sound?importedSoundPath(filename,used):/\.vg[mz]$/i.test(filename)?importedSongPath(filename,used):'/'+filename,type,data}));
    const paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||!current())return[];}
      if(!current())return[];
      project.restore(candidate.snapshot());
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
      for(const path of paths)reveal(path);render();await persistCode();if(announce)say(`Added ${paths.length} file(s). Code was not run.`);return paths;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importSong(data,name,{isCurrent=()=>true,announce=true}={}){
    if(typeof announce!=='boolean')throw TypeError('Import announcement must be boolean.');
    if(disposed||!isCurrent())return null;
    if(typeof name!=='string'||!/\.vg[mz]$/i.test(name))throw Error('Choose a .vgm or .vgz reference song.');
    if(!(data instanceof ArrayBuffer)&&!ArrayBuffer.isView(data))throw TypeError('Reference song data must be binary bytes.');
    const source=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    if(source.byteLength>16*1024*1024)throw Error('Reference song exceeds the 16 MiB project file limit. It can still be extracted directly with Import VGM.');
    const bytes=source.slice();
    const paths=await importFiles([{name,size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer}],{isCurrent,announce:false});
    const path=paths[0]??null;
    if(path&&announce)say(`Reference song saved to ${path}. Press Play in the song player; current instrument and Code are kept.`);
    return path;
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
      await code?.restoreState?.(project.getCodeState());await persistCode();say('HuC6280 project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();project.setSettings(getSettings());return project.exportProject();}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true,{lockMain:!copy});
    try{
      if(occupied(project,destination)&&(copy||foldedPath(source)!==foldedPath(destination)))throw Error('That path already exists.');
      for(const file of project.fs.list())if(inside(file.path,source)&&isHuc6280CodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>HUC6280_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createHuc6280CodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&movedCodePath&&!isHuc6280CodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
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
      const candidate=createHuc6280CodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
      candidate.restore(candidate.snapshot());project.fs.restore(candidate.fs.snapshot());project.select(path);reveal(path);if(directory)expanded.set(path,true);render();
      if(!directory)await openInCurrentMode(path);if(disposed||token!==operation)return false;
      await persistCode();say(`Created ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSound({path:requestedPath}={}){
    if(disposed||busy)return false;const token=++operation;setBusy(true,{lockMain:false});
    try{
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.huc6280\.json$/i.test(requestedPath))throw Error('Use a .huc6280.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      const sound=readHuc6280ProjectSound(getSettings());if(!sound)throw Error('Expected a HuC6280 instrument.');
      if(disposed||token!==operation)return false;
      const path=requestedPath??newSoundPath(project,sound.name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){sound.name=basename(path).replace(/\.huc6280\.json$/i,'');readHuc6280ProjectSound(sound);}
      // importFiles validates its candidate before touching this workspace.
      // Name / size failures must keep both existing files and selection.
      project.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);
      project.select(path);reveal(path);setVisible(true);render();
      await code?.openFile?.(path,{show:false});if(disposed||token!==operation)return false;
      const persisted=await persistCode();
      say('Current HuC6280 instrument saved to '+path+(persisted===false?' in Files. Local save unavailable; export the project to keep it.':''));return path;
    }finally{if(!disposed)setBusy(false);}
  }
  function download(bytes,filename,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action,path=project.selectedPath){
    if(disposed||busy)return;dialogAction=action;dialogPath=path;
    const directory=path&&project.fs.stat(path).type==='directory'?path:path?dirname(path):'/';
    label.textContent={delete:'Delete this project path?',rename:'New file path',instrument:'New instrument · .huc6280.json path',folder:'New folder path',new:'New JavaScript file path'}[action];
    nameInput.value=action==='new'?`${directory==='/'?'':directory}/untitled.js`:action==='folder'?`${directory==='/'?'':directory}/New folder/`:action==='instrument'?`${directory==='/'?'/presets':directory}/Untitled.huc6280.json`:(path??'');
    nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();
  }
  const contextMenu=installHuc6280FileContextMenu({root:tree,document:doc,isBusy:()=>disposed||busy,onError:report,
    onTarget:path=>{if(project.fs.stat(path))project.select(path);},
    getActions:path=>[['duplicate','Duplicate'],['rename','Rename…'],['delete','Delete'],['instrument','New instrument…'],['new','New JavaScript file…'],['folder','New folder…']].map(([id,label])=>({id,label,disabled:path==='/'&&['duplicate','rename','delete'].includes(id)})),
    onAction:(action,path)=>action==='duplicate'?duplicate(path):ask(action,path),
  });
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);render();schedule();});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value,path=dialogPath;dialog.close();void Promise.resolve().then(()=>{
    if(action==='new'){if(!isHuc6280CodePath(value))throw Error('Use a .js or .mjs file name.');return createFile(value);}
    if(action==='folder')return createFile(value.replace(/\/$/,'')+'/');
    if(action==='instrument')return saveSound({path:value});
    return action==='rename'?move(path,value):remove(path);
  }).catch(report);});
  listen(cancel,'click',()=>dialog.close());
  listen(presetSelect,'change',()=>{const choice=presetOptions.get(presetSelect.value);presetSelect.blur();if(choice)void(selectFile(choice.path)).catch(report);});
  for(const[id,fn]of [['hucFileNewButton',()=>ask('new')],['hucFileRenameButton',()=>ask('rename')],['hucFileDeleteButton',()=>ask('delete')],['hucFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['hucProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['hucFileSaveSoundButton',()=>void saveSound().catch(report)],['hucProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['hucFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();void(code?.flush?.()??persistCode()).catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importSong,importProject,exportProject,createFile,move,duplicate,remove,saveSound,
    markSoundDirty(){editRevision++;appliedPreset=null;if(presetSelect)presetSelect.value='';if(disposed||busy||restoring)return;project.setSettings(getSettings());schedule();},
    async dispose(){if(disposed)return;operation++;contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  const initialEditRevision=editRevision;
  api.ready=Promise.resolve().then(async()=>{
    const before=initialEditRevision;
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createHuc6280CodeProject({snapshot:saved});if(before!==editRevision)candidate.setSettings(getSettings());
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;if(before!==editRevision)candidate.setSettings(getSettings());await applySettings(candidate.settings,{isCurrent:()=>!disposed});if(disposed)return;presetCache.clear();appliedPreset=null;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}
      // Never save defaults over an unread or invalid stored project. Only
      // the initial successful restore enables persistence; reconnect is I/O.
      persistenceReady=true;}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed){setBusy(false);if(persistenceReady&&before!==editRevision)schedule();}}
  });if(main)main.inert=true;render();return api;
}
