// Compact SPU Files adapter for the shared Synth Code editor.
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createSpuCodeProject,createSpuProjectStore,readSpuProjectSound,isSpuCodePath,isSpuTextPath,SPU_PROJECT_MANIFEST} from './code_project.js?spu-split-vab=1';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`spu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();
function soundFileStem(value){
  const cleaned=value.normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*\ud800-\udfff]/gu,'_')
    .trim().replace(/\.spu\.json$/i,'').replace(/^\.+|[. ]+$/g,'');
  // Leave room for the extension and collision suffix on exported filesystems.
  let stem='',bytes=0;
  for(const character of cleaned){const length=encoder.encode(character).length;if(bytes+length>160)break;stem+=character;bytes+=length;}
  stem=stem.replace(/[. ]+$/g,'')||'Untitled';
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem.split('.')[0].trimEnd())?'_'+stem:stem;
}
function newSoundPath(project,name){
  const stem=soundFileStem(name),fold=path=>path.normalize('NFC').toLowerCase();
  const occupied=new Set([...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].map(fold));
  let index=1,path='/presets/'+stem+'.spu.json';
  while(occupied.has(fold(path)))path=`/presets/${stem} (${++index}).spu.json`;
  return path;
}
export function setupSpuCodeFiles({project=createSpuCodeProject(),getInstrument=async()=>{throw Error("Enable audio before saving a sound.");},applyInstrument=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},setStatus=()=>{},store=createSpuProjectStore(),document:doc=globalThis.document}={}){
  const panel=doc.getElementById('spuFilesPanel'),toggle=doc.getElementById('spuFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  if(!panel||!toggle||!workspace)throw Error('SPU Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.spu-main'),listeners=[],expanded=new Map([['/presets',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,restoring=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),textPath=null,visibilityTouched=false;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const toolbar=make('div');toolbar.className='spu-files-toolbar';
  const buttons=new Map();
  for(const[id,label]of [['spuFileNewButton','New…'],['spuFileImportButton','Add files…'],['spuFileExportButton','Export file'],['spuFileRenameButton','Rename…'],['spuFileDeleteButton','Delete…'],['spuFileSaveSoundButton','Save sound'],['spuProjectExportButton','Export project'],['spuProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';toolbar.append(button);buttons.set(id,button);
    const destination={spuProjectImportButton:['spuMenuProjectImport','Project · ZIP…'],spuProjectExportButton:['spuMenuProjectExport','Project · ZIP'],spuFileImportButton:['spuMenuFilesImport','Project files…'],spuFileExportButton:['spuMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();doc.activeElement?.blur?.();}});
  }
  const selected=make('p','spuFilesSelected','Project /');selected.className='spu-files-path';
  const tree=make('div','spuFilesTree');tree.setAttribute('aria-label','SPU project files');
  const editor=make('textarea','spuFileTextEditor');editor.hidden=true;editor.spellcheck=false;editor.setAttribute('aria-label','Selected text file; edits save automatically');
  const info=make('p','spuFilesStatus','Code and text edits save locally. Importing a project never runs it.');info.className='spu-files-status';info.setAttribute('role','status');
  const fileInput=make('input','spuFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','spuProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','spuFileNameDialog'),form=make('form'),label=make('label','spuFileNameLabel','File path'),nameInput=make('input','spuFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','spuFileNameConfirm','Create'),cancel=make('button','spuFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(toolbar,selected,tree,editor,info,fileInput,projectInput,dialog);
  let dialogAction=null;
  const say=message=>{if(!disposed){info.textContent=message;setStatus(message);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===SPU_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  function render(){
    if(disposed)return;selected.textContent=project.selectedPath??'Project /';
    renderFileTree(tree,[...project.fs.list().filter(file=>!isCheckpointPath(file.path)),...project.fs.listDirectories().filter(path=>path!=='/'&&!isCheckpointPath(path)).map(path=>({path,type:'directory'}))],{
      selectedPath:project.selectedPath,expanded,onOpen:path=>void selectFile(path).catch(report),
      onImport:files=>void importFiles(files).catch(report),onTransfer:(source,destination,copy)=>void move(source,destination,copy).catch(report)});
    for(const[id,button]of buttons)button.disabled=busy||(['spuFileExportButton','spuFileRenameButton','spuFileDeleteButton'].includes(id)&&!project.selectedPath);
    editor.readOnly=busy;code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value){busy=value;if(main)main.inert=Boolean(value);render();}
  async function persistCode(){
    if(disposed)return false;
    try{return await store.write({...project.snapshot(),workspaceId:identity,filesVisible:!panel.hidden});}
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  function showText(path){const file=path?project.fs.get(path):null;textPath=file?.type==='text'&&!isSpuCodePath(path)?path:null;editor.hidden=!textPath;if(textPath)editor.value=file.data;}
  async function selectFile(path){
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isSpuCodePath(path)){project.select(path);showText(path);render();return await code?.openFile?.(path);}
    let sound=null,soundError=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readSpuProjectSound(file.data);}catch(error){soundError=error;}}
    if(sound){setBusy(true);try{await onBeforeWorkspaceReplace();if(disposed||token!==operation)return false;await applyInstrument(sound,{isCurrent:()=>!disposed&&token===operation});if(disposed||token!==operation)return false;}finally{if(!disposed)setBusy(false);}}
    project.select(path);showText(path);render();schedule();
    say(sound?'SPU sound loaded. Its JSON stays editable in Files.':soundError?`JSON was not applied; current sound kept. Edit this text to finish it: ${soundError.message}`:file.type==='text'?'Text edits save to Files; select a SPU sound JSON again to apply it.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files){
    await api.ready;if(disposed||busy)return[];const token=++operation;
    const entries=[];for(const file of files){if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());entries.push({path:'/'+basename(file.name),type:isSpuTextPath(file.name)?'text':'binary',data:isSpuTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(disposed||token!==operation)return[];await code?.flush?.();if(disposed||token!==operation)return[];
    const candidate=createSpuCodeProject({snapshot:project.snapshot()}),paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath);
    setBusy(true);try{
      if(replaceActive){if(await code.workspaceReplaced()===false||disposed||token!==operation)return[];}
      if(disposed||token!==operation)return[];
      project.restore(candidate.snapshot());showText(project.selectedPath);
      if(replaceActive)await code.restoreState(project.getCodeState());
      render();await persistCode();say(`Added ${paths.length} file(s). Code was not run.`);return paths;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importProject(bytes){
    await api.ready;if(disposed||busy)return false;const token=++operation;
    const candidate=await project.prepareImport(bytes);if(disposed||token!==operation)return false;
    await code?.flush?.();if(disposed||token!==operation)return false;setBusy(true);
    try{
      if(await code?.workspaceReplaced?.()===false||disposed||token!==operation)return false;
      await onBeforeWorkspaceReplace();if(disposed||token!==operation)return false;
      restoring=true;try{project.restore(candidate);identity=workspaceId();textPath=null;editor.hidden=true;}finally{restoring=false;}
      await code?.restoreState?.(project.getCodeState());await persistCode();say('SPU project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();return project.exportProject();}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true);
    try{
      const movedCodePath=inside(code?.activePath,source)?destination+code.activePath.slice(source.length):null;
      if(!copy&&movedCodePath&&!isSpuCodePath(movedCodePath))if(await code?.workspaceReplaced?.()===false||disposed||token!==operation)return false;
      if(disposed||token!==operation)return false;transferVirtualFiles(project.fs,source,destination,{copy});
      if(!copy){if(inside(project.selectedPath,source))project.select(destination+project.selectedPath.slice(source.length));code?.pathChanged?.(source,destination);}
      showText(project.selectedPath);render();await persistCode();return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function remove(path){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;path=allowed(path);setBusy(true);
    try{if(inside(code?.activePath,path))await code.stop();if(disposed||token!==operation)return false;
      if(inside(project.selectedPath,path))project.select(null);
      project.fs.remove(path,{recursive:true});code?.pathChanged?.(path,null);showText(null);render();await persistCode();return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function createFile(path){
    if(disposed||busy)return false;const directory=String(path).endsWith('/');path=allowed(path);
    if(project.fs.has(path)||project.fs.listDirectories().includes(path))throw Error('That path already exists.');
    if(directory){project.fs.mkdir(path,{recursive:true});project.select(path);showText(path);}else project.fs.writeText(path,'');render();await persistCode();if(!directory)await selectFile(path);return true;
  }
  async function saveSound(){
    if(disposed||busy)return false;const token=++operation;setBusy(true);
    try{
      const sound=readSpuProjectSound(await getInstrument());if(!sound)throw Error('Expected an SPU instrument.');
      if(disposed||token!==operation)return false;
      const path=newSoundPath(project,sound.name);
      // importFiles validates its candidate before touching this workspace.
      // Name / size failures must keep both existing files and selection.
      project.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);
      project.select(path);expanded.set('/presets',true);setVisible(true);showText(path);render();
      const persisted=await persistCode();
      say('Current SPU instrument and sample saved to '+path+(persisted===false?' in Files. Local save unavailable; export the project to keep it.':''));return path;
    }finally{if(!disposed)setBusy(false);}
  }
  function download(bytes,filename,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action){dialogAction=action;label.textContent=action==='delete'?'Delete this project path?':action==='rename'?'New file path':'File path (end with / for a folder)';nameInput.value=action==='new'?((project.selectedPath?dirname(project.selectedPath):'/').replace(/\/$/,'')+'/untitled.js'):(project.selectedPath??'');nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();}
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);showText(path);render();schedule();});
  listen(editor,'input',()=>{if(!textPath||busy)return;try{project.fs.writeText(textPath,editor.value);schedule();}catch(error){report(error);}});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value;dialog.close();void(action==='new'?createFile(value):action==='rename'?move(project.selectedPath,value):remove(project.selectedPath)).catch(report);});
  listen(cancel,'click',()=>dialog.close());
  for(const[id,fn]of [['spuFileNewButton',()=>ask('new')],['spuFileRenameButton',()=>ask('rename')],['spuFileDeleteButton',()=>ask('delete')],['spuFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['spuProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['spuFileSaveSoundButton',()=>void saveSound().catch(report)],['spuProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['spuFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();void(code?.flush?.()??persistCode()).catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importProject,exportProject,createFile,move,remove,saveSound,
    markSoundDirty(){editRevision++;if(disposed||busy||restoring)return;schedule();},
    async dispose(){if(disposed)return;operation++;await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  api.ready=Promise.resolve().then(async()=>{
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createSpuCodeProject({snapshot:saved});
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed){setBusy(false);showText(project.selectedPath);}}
  });if(main)main.inert=true;render();return api;
}
