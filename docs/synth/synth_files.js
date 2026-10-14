import {renderFileTree} from '../playground/playground_file_tree.js';
import {isSynthTonePath} from './synth_project.js';

const basename = path => path.split('/').pop();
const dirname = path => path.slice(0, path.lastIndexOf('/')) || '/';
const inside = (path, directory) => path === directory || path?.startsWith(directory + '/');

// Structured snapshots keep binary files binary; no base64/JSON round trip.
async function openDraftStore() {
  if (!globalThis.indexedDB) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tetorica-fm2612-synth-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function setupSynthFiles({project, getPreset, getPresetId, applyPreset, applySnapshot, onSaved, onListChanged, stopAllNotes, setStatus}) {
  const byId = id => document.getElementById(id);
  const panel = byId('synthFilesPanel'), tree = byId('synthFilesTree');
  const toggle = byId('synthFilesToggle'), workspace = byId('synthWorkspace');
  const nameDialog = byId('synthFileNameDialog'), nameInput = byId('synthFileNameInput');
  const dirtyDialog = byId('synthFileDirtyDialog');
  const menu = byId('synthFileContextMenu');
  const expanded = new Map([['/presets', true]]);
  const history = [];
  let activeTonePath = null, selectedPath = null, dirty = false;
  let busy = true, importGeneration = 0, visibilityTouched = false, draftLoaded = false;
  let basePresetId = getPresetId(), basePreset = structuredClone(getPreset());
  let draftStore = null, saveTimer = null, restoring = false;

  function writeDraft() {
    return new Promise((resolve,reject) => {
      try {
        const transaction = draftStore.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put({project:project.snapshot(), activeTonePath, filesVisible:!panel.hidden}, 'current');
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || Error('Draft save aborted.'));
      } catch (error) {reject(error);}
    });
  }
  function remember(immediate=false) {
    if (restoring || !draftLoaded || !draftStore) return Promise.resolve(false);
    clearTimeout(saveTimer);
    if(immediate){saveTimer=null;return writeDraft();}
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void writeDraft().catch(error=>setStatus(`Could not save the local draft: ${error.message}. Export Cassette to keep this project.`));
    }, 500);
    return Promise.resolve(true);
  }

  function capture() {
    return {project:project.snapshot(), activeTonePath, selectedPath, preset:structuredClone(getPreset()), presetId:getPresetId(), basePresetId, basePreset:structuredClone(basePreset), dirty};
  }
  function pushUndo(snapshot = capture()) {
    history.push(snapshot);
    if (history.length > 20) history.shift();
    const size = item => item.project.files.reduce((sum,file)=>sum+(typeof file.data==='string'?file.data.length*2:file.data.byteLength),0);
    while(history.length>1&&history.reduce((sum,item)=>sum+size(item),0)>32*1024*1024)history.shift();
  }
  function setBaseline() {basePresetId=getPresetId();basePreset=structuredClone(getPreset());}
  function reveal(path) {
    let directory = dirname(path);
    while (directory !== '/') {expanded.set(directory, true); directory = dirname(directory);}
  }
  function report(error) {setStatus(`File operation failed: ${error.message}`);}
  function closeMenu() {menu.hidden = true;}
  function updateButtons() {
    byId('synthFileSaveButton').disabled = busy || (!dirty && Boolean(activeTonePath));
    byId('synthFileDirty').textContent = dirty ? 'Unsaved' : '';
    byId('synthActiveFilePath').textContent = activeTonePath || (dirty ? 'Custom instrument' : 'Built-in instrument');
    byId('synthFileUndoButton').disabled = busy || (!history.length && !dirty);
    for (const id of ['synthFileDuplicateButton','synthFileRenameButton','synthFileDeleteButton']) {
      byId(id).disabled = busy || !selectedPath || selectedPath === '/';
    }
    byId('synthFileNewButton').disabled = busy;
    byId('synthFileNewFolderButton').disabled = busy;
    byId('importPresetButton').disabled=busy;
    byId('importCassetteButton').disabled=busy;
    byId('exportCassetteButton').disabled=busy;
    byId('presetSelect').disabled=busy;
  }
  function render() {
    document.body.classList.toggle('synth-files-open',!panel.hidden);
    if (selectedPath && !project.fs.has(selectedPath) && !project.fs.listDirectories().includes(selectedPath)) selectedPath = activeTonePath;
    renderFileTree(tree, [...project.fs.list(), ...project.fs.listDirectories().filter(path => path !== '/').map(path => ({path, type:'directory'}))], {
      selectedPath, expanded,
      onOpen: path => void selectFile(path),
      onTransfer: (source, destination, copy) => void transfer(source, destination, copy),
      onImport: (files, directory) => {
        if(files.length===1&&/\.cassette\.zip$/i.test(files[0].name))void importCassette(files[0]);
        else void importInstruments(files,directory||'/');
      },
    });
    byId('synthCassetteName').textContent = project.cassetteName + '.cassette.zip';
    updateButtons();
    onListChanged();
  }

  function askName(title, initial, validate) {
    stopAllNotes();
    byId('synthFileNameTitle').textContent = title;
    byId('synthFileNameError').textContent = '';
    nameInput.value = initial;
    nameDialog.returnValue = '';
    nameDialog.showModal();
    nameInput.focus();
    nameInput.select();
    return new Promise(resolve => {
      const finish = value => {nameDialog.close(); cleanup(); document.activeElement?.blur?.(); resolve(value);};
      const cancel = () => finish(null);
      const confirm = () => {
        const value = nameInput.value.trim();
        try {validate?.(value); finish(value);}
        catch (error) {byId('synthFileNameError').textContent = error.message; nameInput.focus();}
      };
      const key = event => {if (event.key === 'Enter') {event.preventDefault(); confirm();}};
      const escape = event => {event.preventDefault(); cancel();};
      const cleanup = () => {
        nameDialog.querySelector('[data-file-name-confirm]').removeEventListener('click', confirm);
        nameDialog.querySelector('[data-file-name-cancel]').removeEventListener('click', cancel);
        nameInput.removeEventListener('keydown', key);
        nameDialog.removeEventListener('cancel', escape);
      };
      nameDialog.querySelector('[data-file-name-confirm]').addEventListener('click', confirm);
      nameDialog.querySelector('[data-file-name-cancel]').addEventListener('click', cancel);
      nameInput.addEventListener('keydown', key);
      nameDialog.addEventListener('cancel', escape);
    });
  }
  function validName(value) {
    if (!value || value === '.' || value === '..' || /[\\/\x00-\x1f:*?"<>|]/.test(value)) throw Error('Enter a name without a folder path or reserved characters.');
  }
  function validateDestination(directory, value) {
    validName(value);
    const path = `${directory === '/' ? '' : directory}/${value}`;
    if (project.fs.has(path) || project.fs.listDirectories().includes(path)) throw Error('That name already exists in this folder.');
    return path;
  }
  function askDirty() {
    stopAllNotes();
    dirtyDialog.returnValue = '';
    dirtyDialog.showModal();
    return new Promise(resolve => {
      const finish = value => {dirtyDialog.close(); cleanup(); document.activeElement?.blur?.(); resolve(value);};
      const click = event => {const action = event.target.closest('[data-dirty-action]'); if (action) finish(action.dataset.dirtyAction);};
      const cancel = event => {event.preventDefault(); finish('cancel');};
      const cleanup = () => {dirtyDialog.removeEventListener('click', click); dirtyDialog.removeEventListener('cancel', cancel);};
      dirtyDialog.addEventListener('click', click);
      dirtyDialog.addEventListener('cancel', cancel);
    });
  }
  async function resolveDirty() {
    if (!dirty) return true;
    const answer = await askDirty();
    if (answer === 'cancel') return false;
    if (answer === 'save') return saveTone();
    dirty = false;
    if (activeTonePath) applyPreset('vfs:' + activeTonePath);
    else applySnapshot(basePreset,basePresetId);
    updateButtons();
    return true;
  }

  async function saveTone() {
    try {
      let path = activeTonePath;
      if (!path) {
        const filename = await askName('Save instrument', 'Untitled.vgi', value => {
          validateDestination('/presets', value);
          if (!isSynthTonePath(value)) throw Error('Use a .tfi or .vgi file name.');
        });
        if (!filename) return false;
        path = '/presets/' + filename;
      }
      pushUndo();
      project.writeTone(path, getPreset());
      activeTonePath = selectedPath = path;
      dirty = false;
      reveal(path);
      onSaved(path);
      setBaseline();
      render(); await remember(true);
      setStatus(`Saved ${path}.`);
      return true;
    } catch (error) {report(error); return false;}
  }
  async function selectFile(path) {
    if (busy) return false;
    busy=true;updateButtons();
    try {
      // Parse before asking about edits, so a bad file never changes the sound.
      const tone = isSynthTonePath(path) ? project.readTone(path) : null;
      if (tone && path !== activeTonePath && !await resolveDirty()) return false;
      selectedPath = path;
      project.select(path);
      if (tone && path !== activeTonePath) {
        stopAllNotes();
        activeTonePath = path;
        dirty = false;
        applyPreset('vfs:' + path);
        setBaseline();
      }
      reveal(path); render(); remember();
      byId('synthFileSelectionInfo').textContent = tone ? path : `${path} · kept in Cassette`;
      return true;
    } catch (error) {report(error); return false;}
    finally {busy=false;updateButtons();}
  }
  async function selectPreset(id) {
    if (id.startsWith('vfs:')) return selectFile(id.slice(4));
    if (id === 'custom') return true;
    if (busy) return false;
    busy=true;updateButtons();
    try {
      if (!await resolveDirty()) return false;
      activeTonePath = null; dirty = false;
      stopAllNotes(); applyPreset(id);setBaseline();render();remember();return true;
    } finally {busy=false;updateButtons();}
  }
  async function perform(action, path = selectedPath) {
    if (busy) return;
    busy=true;updateButtons();
    closeMenu();
    try {
      if (action === 'save') {await saveTone(); return;}
      if (action === 'undo') {
        if (dirty) {if (activeTonePath) applyPreset('vfs:' + activeTonePath); else applySnapshot(basePreset,basePresetId); dirty = false;}
        else if (history.length) {
          const previous = history.pop();
          project.restore(previous.project);
          activeTonePath = previous.activeTonePath; selectedPath = previous.selectedPath; dirty = previous.dirty;
          basePresetId=previous.basePresetId;basePreset=previous.basePreset;
          stopAllNotes(); applySnapshot(previous.preset, previous.presetId);
        }
        render(); remember(); setStatus('Undid file operation.'); return;
      }
      if (!await resolveDirty()) return;
      if (action === 'new') {
        const directory = path?.startsWith('/presets') ? (project.fs.listDirectories().includes(path)?path:dirname(path)) : '/presets';
        const filename = await askName('New instrument', 'Untitled.vgi', value => {
          validateDestination(directory,value);if(!isSynthTonePath(value))throw Error('Use a .tfi or .vgi file name.');
        });
        if (!filename) return;
        pushUndo();
        const next = `${directory}/${filename}`;
        project.writeTone(next, getPreset(), {overwrite:false});
        activeTonePath = selectedPath = next; dirty = false; onSaved(next);setBaseline();reveal(next);
      } else if (action === 'folder') {
        const directory = path && project.fs.listDirectories().includes(path) ? path : path ? dirname(path) : '/presets';
        const name = await askName('New folder', 'New Set', value => validateDestination(directory,value));
        if (!name) return;
        pushUndo(); const next = `${directory === '/' ? '' : directory}/${name}`; project.mkdir(next); selectedPath = next; expanded.set(next,true);
      } else if (action === 'duplicate') {
        pushUndo(); const next = project.duplicate(path); selectedPath = next; reveal(next);
        if (isSynthTonePath(next)) {activeTonePath=next;dirty=false;applyPreset('vfs:'+next);setBaseline();}
      } else if (action === 'rename') {
        const nextName = await askName('Rename', basename(path), value => {
          validName(value); if(value!==basename(path))validateDestination(dirname(path),value);
          if(isSynthTonePath(path)&&value.match(/\.(tfi|vgi)$/i)?.[0].toLowerCase()!==path.match(/\.(tfi|vgi)$/i)[0].toLowerCase())throw Error('Keep the current instrument file extension.');
        });
        if (!nextName || nextName === basename(path)) return;
        pushUndo(); const previous = activeTonePath; const next = project.rename(path,nextName);
        selectedPath = next;
        if (inside(previous,path)) {activeTonePath=next+previous.slice(path.length);onSaved(activeTonePath);setBaseline();}
        reveal(next);
      } else if (action === 'delete') {
        pushUndo(); project.delete(path,{recursive:true});
        if (inside(activeTonePath,path)) {activeTonePath=null;dirty=false;stopAllNotes();applyPreset('one-op-basic');setBaseline();}
        selectedPath = null;
      }
      render(); await remember(true); setStatus(`${action === 'delete' ? 'Deleted' : 'Updated'} ${selectedPath || path || 'Cassette'}.`);
    } catch (error) {report(error);}
    finally {busy=false;updateButtons();}
  }
  async function transfer(source,destination,copy) {
    if (busy || source === destination) return;
    busy=true;updateButtons();
    try {
      if(!await resolveDirty())return;
      pushUndo();
      if(copy)destination=project.duplicate(source,project.uniquePath(destination));
      else project.move(source,destination);
      if(!copy&&inside(activeTonePath,source)){activeTonePath=destination+activeTonePath.slice(source.length);onSaved(activeTonePath);setBaseline();}
      selectedPath=destination;reveal(destination);render();await remember(true);setStatus(`${copy?'Copied':'Moved'} ${destination}.`);
    }catch(error){report(error);}finally{busy=false;updateButtons();}
  }
  async function importInstruments(files, directory) {
    const selection=Array.from(files || []); if(!selection.length||busy)return;
    busy=true;updateButtons();
    const generation=++importGeneration;let previous;
    const importError=byId('presetImportError'), notice=byId('presetImportNotice');
    importError.hidden=true;notice.hidden=true;setStatus('Loading instruments…');
    try{
      if(!await resolveDirty())return;
      previous=capture();
      const result=await project.importInstrumentFiles(selection,{...(directory?{directory}:{}),isCurrent:()=>generation===importGeneration});
      if(result.cancelled)return;
      if(result.paths.length){pushUndo(previous);activeTonePath=selectedPath=result.paths[0];dirty=false;stopAllNotes();applyPreset('vfs:'+activeTonePath);setBaseline();reveal(activeTonePath);panel.hidden=false;workspace.classList.add('has-files');toggle.setAttribute('aria-expanded','true');toggle.classList.add('is-selected');}
      if(result.failures.length){importError.textContent=`Could not load some files:\n${result.failures.join('\n')}${result.paths.length?'':' Previous presets were kept.'}`;importError.hidden=false;}
      notice.textContent=result.notices.join('\n');notice.hidden=!result.notices.length;
      setStatus(`Loaded ${result.paths.length} instrument(s).${result.failures.length?' Some files could not be loaded.':''}`);
      render();await remember(true);
    }catch(error){report(error);}finally{busy=false;updateButtons();document.activeElement?.blur?.();}
  }
  async function importCassette(file) {
    if(!file||busy)return;
    busy=true;updateButtons();
    let previous;const generation=++importGeneration;
    try{
      if(!await resolveDirty())return;
      previous=capture();
      const result=await project.importCassette(new Uint8Array(await file.arrayBuffer()),{name:file.name,isCurrent:()=>generation===importGeneration});
      if(result.cancelled)return;
      pushUndo(previous);dirty=false;selectedPath=project.selectedPath;activeTonePath=isSynthTonePath(selectedPath)?selectedPath:null;
      stopAllNotes();if(activeTonePath){applyPreset('vfs:'+activeTonePath);reveal(activeTonePath);}else applyPreset('one-op-basic');setBaseline();
      panel.hidden=false;workspace.classList.add('has-files');toggle.setAttribute('aria-expanded','true');toggle.classList.add('is-selected');
      render();await remember(true);setStatus(`Imported ${file.name}.`);
    }catch(error){setStatus(`Failed to import Cassette: ${error.message}`);}finally{busy=false;updateButtons();document.activeElement?.blur?.();}
  }
  async function exportCassette() {
    if(busy)return;
    busy=true;updateButtons();
    try{
      if(!await resolveDirty())return;
      const bytes=project.exportCassette();
      const filename=project.cassetteName.replace(/\.cassette\.zip$/i,'')+'.cassette.zip';
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
      const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setStatus(`Exported ${filename}.`);
    }catch(error){setStatus(`Failed to export Cassette: ${error.message}`);}finally{busy=false;updateButtons();}
  }

  toggle.addEventListener('pointerdown',event=>event.preventDefault());
  toggle.addEventListener('click',()=>{visibilityTouched=true;panel.hidden=!panel.hidden;workspace.classList.toggle('has-files',!panel.hidden);document.body.classList.toggle('synth-files-open',!panel.hidden);toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.classList.toggle('is-selected',!panel.hidden);remember();});
  panel.addEventListener('pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
  panel.addEventListener('click',event=>{const item=event.target.closest('summary[data-file-path],.file-tree-root[data-file-path]');if(item){selectedPath=item.dataset.filePath;updateButtons();}});
  panel.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Enter','Home','End','ContextMenu'].includes(event.key))event.stopPropagation();});
  const actions={synthFileSaveButton:'save',synthFileNewButton:'new',synthFileDuplicateButton:'duplicate',synthFileRenameButton:'rename',synthFileDeleteButton:'delete',synthFileUndoButton:'undo',synthFileNewFolderButton:'folder'};
  for(const [id,action]of Object.entries(actions)){
    byId(id).addEventListener('pointerdown',event=>event.preventDefault());
    byId(id).addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
    byId(id).addEventListener('click',()=>void perform(action));
  }
  toggle.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
  tree.addEventListener('contextmenu',event=>{
    event.preventDefault();event.stopPropagation();const anchor=event.target.closest('[data-file-path]');selectedPath=anchor?.dataset.filePath||'/';
    updateButtons();menu.hidden=false;for(const button of menu.querySelectorAll('[data-file-action]'))button.disabled=selectedPath==='/'&&['rename','delete','duplicate'].includes(button.dataset.fileAction);
    menu.style.left=`${Math.max(4,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-4))}px`;
    menu.style.top=`${Math.max(4,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-4))}px`;
  });
  menu.addEventListener('pointerdown',event=>event.preventDefault());
  menu.addEventListener('keydown',event=>event.stopPropagation());
  menu.addEventListener('click',event=>{const button=event.target.closest('[data-file-action]');if(button)void perform(button.dataset.fileAction);});
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))closeMenu();});
  window.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
  const cassetteInput=byId('cassetteImportInput');
  byId('importCassetteButton').addEventListener('click',()=>{cassetteInput.value='';cassetteInput.click();});
  cassetteInput.addEventListener('change',()=>void importCassette(cassetteInput.files?.[0]));
  byId('exportCassetteButton').addEventListener('click',()=>void exportCassette());
  const instrumentInput=byId('tfiFile');
  instrumentInput.addEventListener('change',()=>{const files=Array.from(instrumentInput.files||[]);instrumentInput.value='';void importInstruments(files);});
  document.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();});
  document.addEventListener('drop',event=>{if(event.defaultPrevented)return;const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;event.preventDefault();if(files.length===1&&/\.cassette\.zip$/i.test(files[0].name))void importCassette(files[0]);else void importInstruments(files);});
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  project.onDidChange(()=>{render();remember();});
  render();

  const ready=(async()=>{
    try{
      draftStore=await openDraftStore();if(!draftStore)return;
      const saved=await new Promise((resolve,reject)=>{const request=draftStore.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      if(saved?.project){
        restoring=true;project.restore(saved.project);
        // Files are restored even if a user already tried a knob. In that case
        // retain the unsaved sound rather than replacing it with the old tone.
        activeTonePath=!dirty&&saved.activeTonePath&&project.fs.has(saved.activeTonePath)?saved.activeTonePath:null;
        selectedPath=activeTonePath||project.selectedPath;
        if(activeTonePath){project.readTone(activeTonePath);applyPreset('vfs:'+activeTonePath);setBaseline();reveal(activeTonePath);}
        if(!visibilityTouched)panel.hidden=saved.filesVisible===false;
        workspace.classList.toggle('has-files',!panel.hidden);toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.classList.toggle('is-selected',!panel.hidden);
        restoring=false;render();setStatus('Restored local Cassette draft.');
      }
    }catch(error){restoring=false;setStatus(`Local draft unavailable: ${error.message}. Cassette import/export is still available.`);}
    finally{draftLoaded=true;busy=false;updateButtons();remember();}
  })();
  return {ready, selectFile, selectPreset, importInstruments, get activeTonePath(){return activeTonePath;}, get dirty(){return dirty;}, markDirty(){dirty=true;updateButtons();}, refresh:render};
}
