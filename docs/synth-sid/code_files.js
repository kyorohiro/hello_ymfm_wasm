// Compact SID Files adapter for the shared Synth Code editor.
import {renderFileTree} from '../playground/playground_file_tree.js';
import {transferVirtualFiles,isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createSidCodeProject,createSidProjectStore,readSidProjectSound,isSidCodePath,isSidTextPath,SID_PROJECT_MANIFEST} from './code_project.js';

const inside=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const basename=path=>path.split('/').pop(),dirname=path=>path.slice(0,path.lastIndexOf('/'))||'/';
const workspaceId=()=>globalThis.crypto?.randomUUID?.()??`sid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export function setupSidCodeFiles({project=createSidCodeProject(),getSettings=()=>project.settings,applySettings=async()=>{},
  onBeforeWorkspaceReplace=async()=>{},onBeforeSoundApply=async()=>{},setStatus=()=>{},store=createSidProjectStore(),document:doc=globalThis.document}={}){
  const panel=doc.getElementById('sidFilesPanel'),toggle=doc.getElementById('sidFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  if(!panel||!toggle||!workspace)throw Error('SID Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.sid-main'),listeners=[],expanded=new Map([['/presets',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,restoring=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),textPath=null,visibilityTouched=false;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const toolbar=make('div');toolbar.className='sid-files-toolbar';
  const buttons=new Map();
  for(const[id,label]of [['sidFileNewButton','New…'],['sidFileImportButton','Add files…'],['sidFileExportButton','Export file'],['sidFileRenameButton','Rename…'],['sidFileDeleteButton','Delete…'],['sidFileSaveSoundButton','Save sound'],['sidProjectExportButton','Export project'],['sidProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';toolbar.append(button);buttons.set(id,button);
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();doc.activeElement?.blur?.();}});
  }
  const selected=make('p','sidFilesSelected','Project /');selected.className='sid-files-path';
  const tree=make('div','sidFilesTree');tree.setAttribute('aria-label','SID project files');
  const editor=make('textarea','sidFileTextEditor');editor.hidden=true;editor.spellcheck=false;editor.setAttribute('aria-label','Selected text file; edits save automatically');
  const info=make('p','sidFilesStatus','Code and text edits save locally. Importing a project never runs it.');info.className='sid-files-status';info.setAttribute('role','status');
  const fileInput=make('input','sidFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','sidProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','sidFileNameDialog'),form=make('form'),label=make('label','sidFileNameLabel','File path'),nameInput=make('input','sidFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','sidFileNameConfirm','Create'),cancel=make('button','sidFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(toolbar,selected,tree,editor,info,fileInput,projectInput,dialog);
  let dialogAction=null;
  const say=message=>{if(!disposed){info.textContent=message;setStatus(message);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===SID_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
  function render(){
    if(disposed)return;selected.textContent=project.selectedPath??'Project /';
    renderFileTree(tree,[...project.fs.list().filter(file=>!isCheckpointPath(file.path)),...project.fs.listDirectories().filter(path=>path!=='/'&&!isCheckpointPath(path)).map(path=>({path,type:'directory'}))],{
      selectedPath:project.selectedPath,expanded,onOpen:path=>void selectFile(path).catch(report),
      onImport:files=>void importFiles(files).catch(report),onTransfer:(source,destination,copy)=>void move(source,destination,copy).catch(report)});
    for(const[id,button]of buttons)button.disabled=busy||(['sidFileExportButton','sidFileRenameButton','sidFileDeleteButton'].includes(id)&&!project.selectedPath);
    editor.readOnly=busy;code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value){busy=value;if(main)main.inert=Boolean(value);render();}
  async function persistCode(){
    if(disposed)return false;
    if(!busy&&!restoring)project.setSettings(getSettings());
    try{return await store.write({...project.snapshot(),workspaceId:identity,filesVisible:!panel.hidden});}
    catch(error){report(Error(`Local save failed: ${error.message}. Export project to keep your files.`));return false;}
  }
  function schedule(){if(disposed||restoring)return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>void persistCode(),120);}
  function setVisible(value){visibilityTouched=true;panel.hidden=!value;workspace.classList.toggle('has-files',Boolean(value));toggle.setAttribute('aria-expanded',String(Boolean(value)));}
  function showText(path){const file=path?project.fs.get(path):null;textPath=file?.type==='text'&&!isSidCodePath(path)?path:null;editor.hidden=!textPath;if(textPath)editor.value=file.data;}
  async function selectFile(path){
    await api.ready;if(disposed||busy)return false;const token=++operation;
    await code?.flush?.();if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isSidCodePath(path)){project.select(path);showText(path);render();return await code?.openFile?.(path);}
    let sound=null,soundError=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readSidProjectSound(file.data,getSettings());}catch(error){soundError=error;}}
    if(sound){setBusy(true);try{await onBeforeSoundApply();if(disposed||token!==operation)return false;if(await applySettings(sound,{isCurrent:()=>!disposed&&token===operation})===false||disposed||token!==operation)return false;project.setSettings(sound);}finally{if(!disposed){setBusy(false);project.setSettings(getSettings());schedule();}}}
    project.select(path);showText(path);render();schedule();
    say(sound?'SID sound loaded. Its JSON stays editable in Files.':soundError?`JSON was not applied; current sound kept. Edit this text to finish it: ${soundError.message}`:file.type==='text'?'Text edits save to Files; select a SID sound JSON again to apply it.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
  }
  async function importFiles(files){
    await api.ready;if(disposed||busy)return[];const token=++operation;
    const entries=[];for(const file of files){if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());entries.push({path:'/'+basename(file.name),type:isSidTextPath(file.name)?'text':'binary',data:isSidTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(disposed||token!==operation)return[];await code?.flush?.();if(disposed||token!==operation)return[];
    const candidate=createSidCodeProject({snapshot:project.snapshot()}),paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath);
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
      await applySettings(candidate.settings,{isCurrent:()=>!disposed&&token===operation});if(disposed||token!==operation)return false;
      restoring=true;try{project.restore(candidate);identity=workspaceId();textPath=null;editor.hidden=true;}finally{restoring=false;}
      await code?.restoreState?.(project.getCodeState());await persistCode();say('SID project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();project.setSettings(getSettings());return project.exportProject();}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true);
    try{
      const movedCodePath=inside(code?.activePath,source)?destination+code.activePath.slice(source.length):null;
      if(!copy&&movedCodePath&&!isSidCodePath(movedCodePath))if(await code?.workspaceReplaced?.()===false||disposed||token!==operation)return false;
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
    if(disposed||busy)return false;project.setSettings(getSettings());
    const path='/presets/current.sid-channels.json';project.fs.writeText(path,JSON.stringify(project.settings,null,2)+'\n');project.select(path);showText(path);render();await persistCode();say('Current three-channel setup saved to '+path);return path;
  }
  function download(bytes,filename,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),link=make('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function ask(action){dialogAction=action;label.textContent=action==='delete'?'Delete this project path?':action==='rename'?'New file path':'File path (end with / for a folder)';nameInput.value=action==='new'?((project.selectedPath?dirname(project.selectedPath):'/').replace(/\/$/,'')+'/untitled.js'):(project.selectedPath??'');nameInput.readOnly=action==='delete';confirm.textContent=action==='delete'?'Delete':action==='rename'?'Rename':'Create';dialog.showModal();nameInput.focus();nameInput.select?.();}
  listen(toggle,'click',()=>setVisible(panel.hidden));listen(panel,'keydown',event=>event.stopPropagation());
  listen(tree,'click',event=>{const summary=event.target?.closest?.('summary[data-file-path]');if(!summary||busy)return;event.preventDefault();const path=summary.getAttribute('data-file-path');expanded.set(path,!summary.parentNode.open);project.select(path);showText(path);render();schedule();});
  listen(editor,'input',()=>{if(!textPath||busy)return;try{project.fs.writeText(textPath,editor.value);schedule();}catch(error){report(error);}});
  listen(form,'submit',event=>{event.preventDefault();const action=dialogAction,value=nameInput.value;dialog.close();void(action==='new'?createFile(value):action==='rename'?move(project.selectedPath,value):remove(project.selectedPath)).catch(report);});
  listen(cancel,'click',()=>dialog.close());
  for(const[id,fn]of [['sidFileNewButton',()=>ask('new')],['sidFileRenameButton',()=>ask('rename')],['sidFileDeleteButton',()=>ask('delete')],['sidFileImportButton',()=>{fileInput.value='';fileInput.click();}],['sidProjectImportButton',()=>{projectInput.value='';projectInput.click();}],['sidFileSaveSoundButton',()=>void saveSound().catch(report)],['sidProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['sidFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();void(code?.flush?.()??persistCode()).catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,importFiles,importProject,exportProject,createFile,move,remove,saveSound,
    markSoundDirty(){editRevision++;if(disposed||busy||restoring)return;project.setSettings(getSettings());schedule();},
    async dispose(){if(disposed)return;operation++;await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  api.ready=Promise.resolve().then(async()=>{
    const before=editRevision;
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createSidCodeProject({snapshot:saved});if(before!==editRevision)candidate.setSettings(getSettings());
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;if(before!==editRevision)candidate.setSettings(getSettings());await applySettings(candidate.settings,{isCurrent:()=>!disposed});if(disposed)return;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed){setBusy(false);showText(project.selectedPath);}}
  });if(main)main.inert=true;render();return api;
}
