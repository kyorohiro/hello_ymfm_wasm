import {renderFileTree} from '../playground/playground_file_tree.js';
import {isSynthTonePath, isSynthStatePath} from './synth_project.js';
import {isCheckpointPath} from '../js/tetorica_virtual_files/filesystem.js';
import {createToneRecovery, parseToneRecovery} from './synth_recovery.js';

const basename = path => path.split('/').pop();
const dirname = path => path.slice(0, path.lastIndexOf('/')) || '/';
const inside = (path, directory) => path === directory || path?.startsWith(directory + '/');
const RECOVERY_KEY = 'tetorica-fm2612-synth-pending-tone';
const newWorkspaceId = () => globalThis.crypto?.randomUUID?.() || `synth-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
  const syncButton = byId('synthFileSaveButton'), revertButton = byId('synthFileRevertButton');
  const announcement = byId('synthSyncAnnouncement');
  const menu = byId('synthFileContextMenu');
  const expanded = new Map([['/presets', true]]);
  const history = [];
  let activeTonePath = null, selectedPath = null, dirty = false;
  let busy = true, importGeneration = 0, visibilityTouched = false, draftLoaded = false;
  let basePresetId = getPresetId(), basePreset = structuredClone(getPreset());
  let draftStore = null, saveTimer = null, restoring = false;
  let renderedFiles = null;
  let syncFeedback = null, syncFeedbackTimer = null;
  let workspaceId = newWorkspaceId(), generation = 0, pendingTone = null;
  let unprotectedChanges = false, recoveryWarningShown = false;

  // The full Cassette stays in IndexedDB. Only the edited tone and its original
  // checkpoint go into a small synchronous journal, protecting the last knob
  // movement even when navigation aborts an IndexedDB transaction.
  function protectCurrentTone() {
    generation++;
    unprotectedChanges = true;
    try {
      pendingTone = createToneRecovery(project, activeTonePath, workspaceId, generation);
      localStorage.setItem(RECOVERY_KEY, pendingTone);
      unprotectedChanges = false;
    } catch (error) {
      if (!recoveryWarningShown) {
        recoveryWarningShown = true;
        setStatus(`Immediate recovery unavailable: ${error.message}. Keep this page open until the local draft is recorded, or Export Cassette.`);
      }
      void remember(true).catch(report);
    }
  }

  function writeDraft() {
    return new Promise((resolve,reject) => {
      try {
        const savedWorkspace = workspaceId, savedGeneration = generation, savedPending = pendingTone;
        const transaction = draftStore.transaction('projects', 'readwrite');
        transaction.objectStore('projects').put({project:project.snapshot(), activeTonePath, filesVisible:!panel.hidden, workspaceId:savedWorkspace, generation:savedGeneration}, 'current');
        transaction.oncomplete = () => {
          if (workspaceId === savedWorkspace && generation === savedGeneration && pendingTone === savedPending) {
            unprotectedChanges = false;
            if (savedPending) {
              try {if (localStorage.getItem(RECOVERY_KEY) === savedPending) localStorage.removeItem(RECOVERY_KEY);} catch {}
              pendingTone = null;
            }
            updateButtons();
          }
          resolve(true);
        };
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
  function clearSyncFeedback() {
    clearTimeout(syncFeedbackTimer); syncFeedbackTimer = null; syncFeedback = null;
    syncButton.textContent = 'Sync'; delete syncButton.dataset.feedback;
  }
  function showSyncFeedback(path) {
    clearSyncFeedback(); syncFeedback = path;
    syncButton.textContent = '✓ Synced'; syncButton.dataset.feedback = 'success';
    announcement.textContent = `Synced ${path}.`;
    syncFeedbackTimer = setTimeout(clearSyncFeedback, 1800);
  }
  function updateButtons() {
    const modified = Boolean(activeTonePath && project.isToneModified(activeTonePath));
    if (syncFeedback && (syncFeedback !== activeTonePath || dirty || modified)) clearSyncFeedback();
    syncButton.disabled = busy;
    revertButton.disabled = busy || !activeTonePath || !modified;
    byId('synthFileDirty').textContent = dirty ? 'Not recorded' : unprotectedChanges ? 'Recording…' : modified ? 'Modified' :
      activeTonePath ? (project.fs.checkpoints.has(activeTonePath) ? 'Synced' : 'Current') : '';
    byId('synthActiveFilePath').textContent = !draftLoaded ? 'Restoring local project…' : activeTonePath || 'Built-in instrument';
    byId('synthFileUndoButton').disabled = busy || !history.length;
    document.querySelector('.synth-editor').setAttribute('aria-busy', String(busy));
    for (const id of ['commonControls','operatorControls','channel3SpecialControls']) byId(id).inert = busy;
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
    const entries=project.listEntries().filter(entry=>entry.path!=='/'&&!entry.path.split('/').includes('.git')&&!isCheckpointPath(entry.path)&&!isSynthStatePath(entry.path));
    // Knob edits change contents, not file names. Keep the tree and preset
    // options intact while dragging; rebuild only for structural changes.
    const revision=JSON.stringify(entries.map(entry=>[entry.path,entry.type]));
    if(revision!==renderedFiles){
      renderFileTree(tree, entries, {
      selectedPath, expanded,
      onOpen: path => void selectFile(path),
      onTransfer: (source, destination, copy) => void transfer(source, destination, copy),
      onImport: (files, directory) => {
        if(files.length===1&&/\.cassette\.zip$/i.test(files[0].name))void importCassette(files[0]);
        else void importInstruments(files,directory||'/');
      },
      });
      renderedFiles=revision;
      onListChanged();
    }else{
      for(const item of tree.querySelectorAll('[data-file-path]')){
        item.setAttribute('aria-current',String(item.dataset.filePath===selectedPath));
        if(item.tagName==='SUMMARY'&&expanded.has(item.dataset.filePath))item.parentElement.open=expanded.get(item.dataset.filePath);
      }
    }
    byId('synthCassetteName').textContent = project.cassetteName + '.cassette.zip';
    updateButtons();
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
    if(value==='.git')throw Error('That name is reserved for Git data.');
  }
  function validateDestination(directory, value) {
    validName(value);
    if(directory==='/'&&value==='.tet.ss')throw Error('That name is reserved for file checkpoints.');
    if(directory==='/'&&['metadata.json','cassette.metadata.js'].includes(value))throw Error('That name is reserved for Cassette metadata.');
    const path = `${directory === '/' ? '' : directory}/${value}`;
    if (project.fs.has(path) || project.fs.listDirectories().includes(path)) throw Error('That name already exists in this folder.');
    return path;
  }
  function ensureTonePath() {
    if (activeTonePath) return activeTonePath;
    const name = String(basePresetId || 'Instrument').replace(/^vfs:/, '').split('/').pop()
      .replace(/\.(?:tfi|vgi)$/i, '').replace(/[^\p{L}\p{N}._ -]/gu, '_') || 'Instrument';
    const path = project.uniquePath('/presets/' + name + '.vgi');
    project.writeTone(path, basePreset, {overwrite:false, baselinePreset:basePreset});
    activeTonePath = selectedPath = path;
    onSaved(path); reveal(path);
    return path;
  }
  function persistCurrentTone() {
    if (!dirty) return true;
    try {
      const path = ensureTonePath();
      project.writeTone(path, getPreset(), {baselinePreset:basePreset});
      dirty = false; selectedPath = path; onSaved(path);
      protectCurrentTone();
      render(); remember();
      return true;
    } catch (error) {report(error); updateButtons(); return false;}
  }
  async function flushEdits() {
    if (!persistCurrentTone()) return false;
    // Do not replace tone A's recovery journal with tone B until A is durable.
    if ((pendingTone || unprotectedChanges) && !await remember(true)) {
      throw Error('Local draft storage is unavailable. Export Cassette before leaving the current instrument.');
    }
    return true;
  }

  async function syncCurrentTone() {
    clearSyncFeedback();
    try {
      if (!persistCurrentTone()) return false;
      pushUndo();
      const path = ensureTonePath();
      project.writeTone(path, getPreset(), {baselinePreset:basePreset});
      project.syncTone(path);
      activeTonePath = selectedPath = path;
      dirty = false;
      reveal(path);
      onSaved(path);
      setBaseline();
      protectCurrentTone();
      render(); showSyncFeedback(path); await remember(true);
      setStatus(`Synced ${path}.`);
      return true;
    } catch (error) {report(error); return false;}
  }
  async function revertTone() {
    if (!activeTonePath || !project.isToneModified(activeTonePath)) return;
    clearSyncFeedback();
    if (!persistCurrentTone()) return;
    const previous = capture();
    const tone = project.revertTone(activeTonePath);
    pushUndo(previous); dirty = false;
    stopAllNotes(); applySnapshot(tone.preset, 'vfs:' + activeTonePath);
    onSaved(activeTonePath); setBaseline(); protectCurrentTone(); render(); await remember(true);
    setStatus(`Reverted ${activeTonePath} to the last synced version.`);
  }
  async function selectFile(path) {
    if (busy) return false;
    busy=true;updateButtons();
    try {
      // Validate before switching, so a bad file never changes the sound.
      const tone = isSynthTonePath(path) ? project.readTone(path) : null;
      if (tone && path !== activeTonePath && !await flushEdits()) return false;
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
      if (!await flushEdits()) return false;
      activeTonePath = null; dirty = false;
      stopAllNotes(); applyPreset(id);setBaseline();render();remember();return true;
    } catch (error) {report(error);return false;}
    finally {busy=false;updateButtons();}
  }
  async function perform(action, path = selectedPath) {
    if (busy) return;
    busy=true;updateButtons();
    closeMenu();
    try {
      if (action === 'sync') {await syncCurrentTone(); return;}
      if (action === 'revert') {await revertTone(); return;}
      if (action === 'undo') {
        if (!await flushEdits()) return;
        clearSyncFeedback();
        if (history.length) {
          const previous = history.pop();
          project.restore(previous.project);
          workspaceId = newWorkspaceId(); generation = 0;
          activeTonePath = previous.activeTonePath; selectedPath = previous.selectedPath; dirty = previous.dirty;
          basePresetId=previous.basePresetId;basePreset=previous.basePreset;
          stopAllNotes(); applySnapshot(previous.preset, previous.presetId);
        }
        render(); await remember(true); setStatus('Undid file operation.'); return;
      }
      if (!await flushEdits()) return;
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
      if(!await flushEdits())return;
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
    const requestGeneration=++importGeneration;let previous;
    const importError=byId('presetImportError'), notice=byId('presetImportNotice');
    importError.hidden=true;notice.hidden=true;setStatus('Loading instruments…');
    try{
      if(!await flushEdits())return;
      previous=capture();
      const result=await project.importInstrumentFiles(selection,{...(directory?{directory}:{}),isCurrent:()=>requestGeneration===importGeneration});
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
    let previous;const requestGeneration=++importGeneration;
    try{
      if(!await flushEdits())return;
      previous=capture();
      const result=await project.importCassette(new Uint8Array(await file.arrayBuffer()),{name:file.name,isCurrent:()=>requestGeneration===importGeneration});
      if(result.cancelled)return;
      workspaceId=newWorkspaceId();generation=0;
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
      if(!persistCurrentTone())return;
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
  const actions={synthFileSaveButton:'sync',synthFileRevertButton:'revert',synthFileNewButton:'new',synthFileDuplicateButton:'duplicate',synthFileRenameButton:'rename',synthFileDeleteButton:'delete',synthFileUndoButton:'undo',synthFileNewFolderButton:'folder'};
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
  document.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.altKey||event.shiftKey||event.isComposing||
      (event.code!=='KeyS'&&event.key?.toLowerCase()!=='s')||document.querySelector('dialog[open]'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(!event.repeat&&!busy)void perform('sync');
  },true);
  document.addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();});
  document.addEventListener('drop',event=>{if(event.defaultPrevented)return;const files=Array.from(event.dataTransfer?.files||[]);if(!files.length)return;event.preventDefault();if(files.length===1&&/\.cassette\.zip$/i.test(files[0].name))void importCassette(files[0]);else void importInstruments(files);});
  const flushDraft = () => {if(saveTimer!==null)void remember(true).catch(report);};
  window.addEventListener('pagehide',flushDraft);
  window.addEventListener('beforeunload',event=>{flushDraft();if(dirty||unprotectedChanges){event.preventDefault();event.returnValue='';}});
  project.onDidChange(()=>{render();remember();});
  render();

  const ready=(async()=>{
    try{
      draftStore=await openDraftStore();
      const saved=draftStore?await new Promise((resolve,reject)=>{const request=draftStore.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}):null;
      workspaceId=saved?.workspaceId||newWorkspaceId();generation=Number.isSafeInteger(saved?.generation)?saved.generation:0;
      restoring=true;
      if(saved?.project){
        project.restore(saved.project);
        // Files are restored even if a user already tried a knob. In that case
        // retain the unsaved sound rather than replacing it with the old tone.
        activeTonePath=!dirty&&saved.activeTonePath&&project.fs.has(saved.activeTonePath)?saved.activeTonePath:null;
        if(!visibilityTouched)panel.hidden=saved.filesVisible===false;
      }
      let recovered=false;
      try {
        const raw=localStorage.getItem(RECOVERY_KEY);
        if(raw){
          const recovery=parseToneRecovery(raw);
          if((!saved?.project||recovery.workspaceId===workspaceId)&&recovery.generation>generation){
            project.fs.writeFiles(recovery.entries,{checkpointChanges:false});
            workspaceId=recovery.workspaceId;generation=recovery.generation;pendingTone=raw;
            if(!dirty)activeTonePath=recovery.activeTonePath;
            recovered=true;
          }
        }
      }catch(error){setStatus(`Could not restore the last tone edit: ${error.message}. The local Cassette draft is still available.`);}
      selectedPath=activeTonePath||project.selectedPath;
      if(activeTonePath){project.readTone(activeTonePath);applyPreset('vfs:'+activeTonePath);setBaseline();reveal(activeTonePath);}
      workspace.classList.toggle('has-files',!panel.hidden);toggle.setAttribute('aria-expanded',String(!panel.hidden));toggle.classList.toggle('is-selected',!panel.hidden);
      restoring=false;render();
      // Persist an identity before enabling controls, so a subsequent journal
      // cannot be mistaken for an unrelated imported Cassette after a crash.
      if(draftStore)await writeDraft();
      if(recovered)setStatus('Recovered the last instrument edit.');
      else if(saved?.project)setStatus('Restored local Cassette draft.');
      else if(!draftStore)setStatus('Local draft storage is unavailable. Export Cassette to keep your project.');
    }catch(error){restoring=false;setStatus(`Local draft unavailable: ${error.message}. Cassette import/export is still available.`);}
    finally{draftLoaded=true;busy=false;if(dirty)persistCurrentTone();render();remember();}
  })();
  return {ready, selectFile, selectPreset, importInstruments, get activeTonePath(){return activeTonePath;},
    get dirty(){return dirty||Boolean(activeTonePath&&project.isToneModified(activeTonePath));},
    markDirty(){dirty=true;clearSyncFeedback();if(draftLoaded&&!busy)persistCurrentTone();else updateButtons();}, refresh:render};
}
