// Compact SPU Files adapter for the shared Synth Code editor.
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
export function setupSpuCodeFiles({project=createSpuCodeProject(),getInstrument=async()=>{throw Error("Enable audio before saving a sound.");},applyInstrument=async()=>{},
  applyVabTone=async()=>{throw Error('VAB preset loading is unavailable.');},
  onBeforeWorkspaceReplace=async()=>{},setStatus=()=>{},store=createSpuProjectStore(),document:doc=globalThis.document}={}){
  const panel=doc.getElementById('spuFilesPanel'),toggle=doc.getElementById('spuFilesToggle'),workspace=doc.getElementById('synthWorkspace');
  const presetSelect=doc.getElementById('spuPresetSelect'),presetCache=new Map();let presetSignature='',deferPersistence=0,appliedPreset=null,presetOptions=new Map();
  if(!panel||!toggle||!workspace)throw Error('SPU Files mount is missing.');
  const win=doc.defaultView??globalThis,main=doc.querySelector?.('.spu-main'),listeners=[],expanded=new Map([['/presets',true],['/lib',true],['/data',true]]);
  let code=null,busy=true,disposed=false,restoring=false,persistenceReady=false,operation=0,editRevision=0,saveTimer=null,identity=workspaceId(),visibilityTouched=false;
  const make=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text!==undefined)node.textContent=text;return node;};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const heading=make('div');heading.className='spu-files-heading';
  const title=make('h2',null,'FILES');
  const toolbar=make('div');toolbar.className='spu-files-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Create project files');
  heading.append(title,toolbar);
  const actions=make('div');actions.className='spu-files-actions';actions.setAttribute('role','group');actions.setAttribute('aria-label','Selected file actions');
  const buttons=new Map();
  for(const[id,label]of [['spuFileNewButton','New JS'],['spuFileSaveSoundButton','Save sound'],['spuFileRenameButton','Rename…'],['spuFileDeleteButton','Delete…'],['spuFileImportButton','Add files…'],['spuFileExportButton','Export file'],['spuProjectExportButton','Export project'],['spuProjectImportButton','Import project…']]){
    const button=make('button',id,label);button.type='button';
    (id==='spuFileNewButton'||id==='spuFileSaveSoundButton'?toolbar:actions).append(button);buttons.set(id,button);
    if(id==='spuFileNewButton')button.title='New JavaScript file; end the path with / to create a folder';
    const destination={spuProjectImportButton:['spuMenuProjectImport','Project · ZIP…'],spuProjectExportButton:['spuMenuProjectExport','Project · ZIP'],spuFileImportButton:['spuMenuFilesImport','Project files…'],spuFileExportButton:['spuMenuFileExport','Selected file']}[id];
    const mount=destination&&doc.getElementById(destination[0]);
    if(mount){button.textContent=destination[1];button.setAttribute('data-close-synth-menu','');mount.append(button);}
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();if(id!=='spuFileSaveSoundButton'||!code?.isCodeMode?.())doc.activeElement?.blur?.();}});
  }
  const selected=make('p','spuFilesSelected','');selected.className='spu-files-path spu-sr-only';selected.setAttribute('role','status');
  const tree=make('div','spuFilesTree');tree.setAttribute('aria-label','SPU project files');
  const info=make('p','spuFilesStatus','Code and text edits save locally. Importing a project never runs it.');info.className='spu-files-status';info.setAttribute('role','status');
  const fileInput=make('input','spuFilesInput');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const projectInput=make('input','spuProjectFileInput');projectInput.type='file';projectInput.accept='.zip,application/zip';projectInput.hidden=true;
  const dialog=make('dialog','spuFileNameDialog'),form=make('form'),label=make('label','spuFileNameLabel','File path'),nameInput=make('input','spuFileNameInput');
  label.htmlFor=nameInput.id;const confirm=make('button','spuFileNameConfirm','Create'),cancel=make('button','spuFileNameCancel','Cancel');confirm.type='submit';cancel.type='button';form.append(label,nameInput,confirm,cancel);dialog.append(form);
  panel.append(heading,tree,actions,selected,info,fileInput,projectInput,dialog);
  let dialogAction=null,dialogPath=null;
  const say=message=>{if(!disposed){info.textContent=message;setStatus(message);}};
  const report=error=>{if(error?.name!=='AbortError')say(`Files: ${error?.message??error}`);};
  const allowed=path=>{path=normalizeVirtualPath(path);if(path==='/'||path===SPU_PROJECT_MANIFEST||isCheckpointPath(path))throw Error('That path is reserved.');return path;};
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
    for(const[id,button]of buttons)button.disabled=busy||(['spuFileExportButton','spuFileRenameButton','spuFileDeleteButton'].includes(id)&&!project.selectedPath);
    code?.setBusy?.(busy);
    for(const button of tree.querySelectorAll('button'))button.disabled=busy;
  }
  function setBusy(value,{lockMain=true}={}){busy=value;if(main)main.inert=Boolean(value&&lockMain);render();}
  async function persistCode({force=false}={}){
    if(disposed||!persistenceReady||restoring||deferPersistence&&!force)return false;
    try{return await store.write({...project.snapshot(),workspaceId:identity,filesVisible:!panel.hidden});}
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
    await code?.flush?.();if(disposed||token!==operation)return false;
    path=normalizeVirtualPath(path);const file=project.fs.get(path);if(!file)throw Error('Choose a file.');
    if(isSpuCodePath(path)){project.select(path);render();return await openInCurrentMode(path);}
    let sound=null,soundError=null;
    if(file.type==='text'&&/\.json$/i.test(path)){try{sound=readSpuProjectSound(file.data);}catch(error){soundError=error;}}
    if(sound){setBusy(true);try{if(disposed||token!==operation)return false;if(await applyInstrument(sound,{isCurrent:()=>!disposed&&token===operation})===false)return false;if(disposed||token!==operation)return false;}finally{if(!disposed)setBusy(false);}}
    if(sound)appliedPreset={kind:'json',path,data:file.data};
    project.select(path);render();schedule();
    if(file.type==='text')await openInCurrentMode(path);
    if(disposed||token!==operation)return false;
    say(sound?'SPU sound loaded. Edit its JSON in Code; select it again to apply changes.':soundError?`JSON was not applied; current sound kept. Edit it in Code: ${soundError.message}`:file.type==='text'?'Text edits save to Files from Code; select a SPU sound JSON again to apply it.':/\.vab$/i.test(path)?'VAB bank selected. Choose a Program / Tone from Preset to load it; banks outside /presets can be moved there.':`Binary file · ${file.data.byteLength} bytes. Export it to use it elsewhere.`);return true;
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
      appliedPreset={kind:'vab',path,data:saved.data,toneNumber};project.select(path);render();schedule();
      say(`Loaded ${basename(path)} · Program ${tone.program} · Tone ${tone.index}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function importFiles(files){
    await api.ready;if(disposed||busy)return[];const token=++operation;
    const entries=[];for(const file of files){if(file.size>16*1024*1024)throw Error('A project file exceeds 16 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());entries.push({path:'/'+basename(file.name),type:isSpuTextPath(file.name)?'text':'binary',data:isSpuTextPath(file.name)?decoder.decode(bytes):bytes});}
    if(disposed||token!==operation)return[];await code?.flush?.();if(disposed||token!==operation)return[];
    const candidate=createSpuCodeProject({snapshot:project.snapshot()}),paths=candidate.importFiles(entries),replaceActive=paths.includes(code?.activePath),replaceExecution=paths.includes(executionPath());
    setBusy(true);try{
      if(replaceExecution){if(await code.workspaceReplaced()===false||disposed||token!==operation)return[];}
      if(disposed||token!==operation)return[];
      for(const path of paths)if(/\.vab$/i.test(path))presetCache.delete(path);
      project.restore(candidate.snapshot());
      if(replaceActive||replaceExecution)await code.restoreState(project.getCodeState());
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
      restoring=true;try{appliedPreset=null;presetCache.clear();project.restore(candidate);identity=workspaceId();}finally{restoring=false;}
      await code?.restoreState?.(project.getCodeState());await persistCode();say('SPU project imported. Code was not run.');return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function exportProject(){await api.ready;await code?.flush?.();return project.exportProject();}
  async function move(source,destination,copy=false){
    if(disposed||busy)return false;const token=++operation;await code?.flush?.();if(disposed||token!==operation)return false;source=allowed(source);destination=allowed(destination);setBusy(true,{lockMain:!copy});
    try{
      if(occupied(project,destination)&&(copy||foldedPath(source)!==foldedPath(destination)))throw Error('That path already exists.');
      for(const file of project.fs.list())if(inside(file.path,source)&&isSpuCodePath(destination+file.path.slice(source.length))&&(file.type!=='text'||file.data.length>SPU_PROJECT_CODE_LENGTH))throw Error('JavaScript files must be UTF-8 text no larger than 2 MiB.');
      let copied=null;
      if(copy){const candidate=createSpuCodeProject({snapshot:project.snapshot()});transferVirtualFiles(candidate.fs,source,destination,{copy:true});candidate.restore(candidate.snapshot());copied=candidate.fs.snapshot();}
      const runningPath=executionPath(),movedCodePath=inside(runningPath,source)?destination+runningPath.slice(source.length):null;
      if(!copy&&movedCodePath&&!isSpuCodePath(movedCodePath))if(await code?.stop?.()===false||disposed||token!==operation)return false;
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
      const candidate=createSpuCodeProject({snapshot:project.snapshot()});if(directory)candidate.fs.mkdir(path,{recursive:true});else candidate.importFiles([{path,type:'text',data:''}]);
      candidate.restore(candidate.snapshot());project.fs.restore(candidate.fs.snapshot());project.select(path);reveal(path);if(directory)expanded.set(path,true);render();
      if(!directory)await openInCurrentMode(path);if(disposed||token!==operation)return false;
      await persistCode();say(`Created ${path}.`);return true;
    }finally{if(!disposed)setBusy(false);}
  }
  async function saveSound({path:requestedPath}={}){
    if(disposed||busy)return false;const token=++operation;setBusy(true,{lockMain:false});
    try{
      if(requestedPath!==undefined){requestedPath=allowed(requestedPath);if(!/\.spu\.json$/i.test(requestedPath))throw Error('Use a .spu.json instrument file name.');if(occupied(project,requestedPath))throw Error('That path already exists.');}
      const sound=readSpuProjectSound(await getInstrument());if(!sound)throw Error('Expected an SPU instrument.');
      if(disposed||token!==operation)return false;
      const path=requestedPath??newSoundPath(project,sound.name);
      if(occupied(project,path))throw Error('That path already exists.');
      if(requestedPath!==undefined){sound.name=basename(path).replace(/\.spu\.json$/i,'');readSpuProjectSound(sound);}
      // importFiles validates its candidate before touching this workspace.
      // Name / size failures must keep both existing files and selection.
      project.importFiles([{path,type:'text',data:JSON.stringify(sound,null,2)+'\n'}]);
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
      project.importFiles([...entries.map(({name,...entry})=>entry),...binaryEntries]);
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
  listen(presetSelect,'change',()=>{const choice=presetOptions.get(presetSelect.value);presetSelect.blur();if(choice)void(choice.kind==='vab'?selectVabTone(choice.path,choice.toneNumber):selectFile(choice.path)).catch(report);});
  for(const[id,fn]of [['spuFileNewButton',()=>ask('new')],['spuFileRenameButton',()=>ask('rename')],['spuFileDeleteButton',()=>ask('delete')],['spuFileImportButton',()=>{setVisible(true);fileInput.value='';fileInput.click();}],['spuProjectImportButton',()=>{setVisible(true);projectInput.value='';projectInput.click();}],['spuFileSaveSoundButton',()=>void saveSound().catch(report)],['spuProjectExportButton',()=>void exportProject().then(bytes=>download(bytes,project.cassetteName+'.cassette.zip','application/zip')).catch(report)],['spuFileExportButton',()=>{const file=project.fs.get(project.selectedPath);if(file)download(file.data,basename(file.path),file.type==='text'?'text/plain;charset=utf-8':undefined);} ]])listen(buttons.get(id),'click',fn);
  listen(fileInput,'change',()=>{const files=[...fileInput.files];fileInput.value='';void importFiles(files).catch(report);});
  listen(projectInput,'change',()=>{const[file]=projectInput.files;projectInput.value='';if(file)void file.arrayBuffer().then(importProject).catch(report);});
  listen(doc,'keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();void(code?.flush?.()??persistCode()).catch(report);}},true);
  listen(win,'pagehide',()=>{void code?.flush?.();void persistCode();});
  const unwatch=project.onDidChange(()=>{render();schedule();});
  const api={project,get workspaceId(){return identity;},setVisible,setCodeControls(value){code=value;render();},
    rememberCodeState(value){if(!disposed)project.setCodeState(value);},getCodeState:()=>project.getCodeState(),persistCode,selectFile,selectVabTone,importFiles,importProject,exportProject,createFile,move,duplicate,remove,saveSound,saveInstruments,
    markSoundDirty(){editRevision++;appliedPreset=null;if(presetSelect)presetSelect.value='';if(disposed||busy||restoring)return;schedule();},
    async dispose(){if(disposed)return;operation++;contextMenu.dispose();await code?.flush?.();await persistCode();disposed=true;if(main)main.inert=false;clearTimeout(saveTimer);unwatch();for(const cleanup of listeners)cleanup();await store.close?.();},
  };
  api.ready=Promise.resolve().then(async()=>{
    try{const saved=await store.read();if(disposed)return;if(saved){const candidate=createSpuCodeProject({snapshot:saved});
      restoring=true;try{await onBeforeWorkspaceReplace();if(disposed)return;presetCache.clear();appliedPreset=null;project.restore(candidate.snapshot());identity=typeof saved.workspaceId==='string'?saved.workspaceId:identity;if(!visibilityTouched)setVisible(Boolean(saved.filesVisible));}finally{restoring=false;}}persistenceReady=true;}
    catch(error){report(Error('Local project restore failed; current files kept. '+error.message));}
    finally{if(!disposed)setBusy(false);}
  });if(main)main.inert=true;render();return api;
}
