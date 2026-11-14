// Compact Code input for Synth. The editor and runtime remain independent so
// a CDN/editor failure cannot prevent editing or running a local Cassette.
import {initializePlaygroundMonaco} from '../playground/playground_monaco.js?v=synth-code-types-1&huc-source=2';
import {selectSynthCodeDeclarations} from './synth_code_declarations.js?v=shared-pcm-notes-1';
const JOURNAL_KEY='tetorica-fm2612-synth-pending-code';
const MAX_CODE_LENGTH=2*1024*1024;
const editorPath=path=>typeof path==='string'&&path.startsWith('/')&&!path.split('/').some(part=>['..','.git','.tet.ss'].includes(part));
const codePath=path=>editorPath(path)&&/\.m?js$/i.test(path);
const within=(path,directory)=>path===directory||path?.startsWith(directory+'/');
const DEFAULT_CODE=`const fm = await useSoundChip("ym2612");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("E1", "minorPentatonic", 3);
  fm.noteOn(CH1, choose(notes));
  await beat(0.2);
  fm.noteOff(CH1);
  await beat(0.025);
});
`;

function textFile(project,path,allowTextFiles=false) {
  const file=project.fs.get(path);
  if(!file||!codePath(path)&&!(allowTextFiles&&editorPath(path)&&file.type==='text'))throw Error(allowTextFiles?'Choose a text or JavaScript file in Files.':'Choose a JavaScript file in Files.');
  return typeof file.data==='string'?file.data:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(file.data);
}

export function setupSynthCodeControls({project,files,getRuntime,onBeforeRun=async()=>{},onModeChange=()=>{},setStatus=()=>{},getStarterCode=()=>DEFAULT_CODE,
  editorChip='ym2612',transformDeclarations=selectSynthCodeDeclarations,journalKey=JOURNAL_KEY,definitionRuntimeFile='playground_code_runtime.js',
  allowTextFiles=false,keepRunningOnKeyboard=false,maxTextLength=MAX_CODE_LENGTH,writeText=(path,source)=>project.fs.writeText(path,source),
  loadEditor=async()=>({initializePlaygroundMonaco})}={}) {
  if(!project?.fs||typeof getRuntime!=='function')throw TypeError('Code input needs a project and runtime factory.');
  if(typeof editorChip!=='string'||!editorChip||typeof journalKey!=='string'||!journalKey||
    typeof definitionRuntimeFile!=='string'||!definitionRuntimeFile||typeof transformDeclarations!=='function')throw TypeError('Code input needs editor and recovery settings.');
  if(typeof allowTextFiles!=='boolean'||typeof keepRunningOnKeyboard!=='boolean'||!Number.isSafeInteger(maxTextLength)||maxTextLength<1||typeof writeText!=='function')throw TypeError('Code input needs valid text editing settings.');
  const byId=id=>document.getElementById(id),section=byId('synthInputSection');
  const keyboardTab=byId('synthInputKeyboardTab'),codeTab=byId('synthInputCodeTab');
  const keyboardPanel=byId('synthKeyboardPanel'),codePanel=byId('synthCodePanel');
  const textarea=byId('synthCodeEditor'),editorHost=byId('synthCodeEditorHost'),note=byId('synthCodeEditorNote');
  const runButton=byId('synthCodeRunButton'),applyButton=byId('synthCodeApplyButton'),stopButton=byId('synthCodeStopButton');
  // These hosts treat the tabs as views of one performance. Keep the existing
  // transport (and its event bindings) reachable while the keyboard is shown.
  const transport=runButton.parentNode;
  if(keepRunningOnKeyboard&&transport&&keyboardPanel.parentNode){
    transport.dataset.codeTransport='shared';
    keyboardPanel.parentNode.insertBefore(transport,keyboardPanel);
  }
  const stateLabel=byId('synthCodeState'),errorLog=byId('synthCodeError'),log=byId('synthCodeLog');
  const workspace=byId('synthWorkspace'),expandedSlot=byId('synthExpandedCodeSlot');
  const expandButton=byId('synthCodeExpandButton'),expandIcon=byId('synthCodeExpandIcon');
  const homeAnchor=document.createComment('Synth performance input');
  section.parentNode.insertBefore(homeAnchor,section);
  const listeners=[];
  let mode='keyboard',activePath=null,disposed=false,changing=false,fileBusy=false,pending=false,operation=0,expanded=false,workspaceOperation=0;
  let opening=null;
  let runtime=null,runtimeLoading=null,monacoLoading=null,monacoEditor=null,monacoApi=null,executionPath=null;
  let runtimeState={state:'idle',loopNames:[]};
  let adapter={kind:'textarea',getValue:()=>textarea.value,setValue:value=>{textarea.value=value;},focus:()=>textarea.focus(),setReadOnly:value=>{textarea.readOnly=value;}};
  const listen=(node,type,fn,options)=>{node?.addEventListener(type,fn,options);listeners.push(()=>node?.removeEventListener(type,fn,options));};
  const captureState=()=>({mode,path:activePath});
  const appendLog=(line,kind='log')=>{
    if(disposed)return;
    if(kind==='error'){errorLog.textContent=String(line);return;}
    const lines=(log.textContent+'\n'+String(line)).trimStart().split('\n');
    log.textContent=lines.slice(-100).join('\n').slice(-12000);log.scrollTop=log.scrollHeight;
  };
  function report(error) {
    const message=error?.message??String(error),stack=typeof error?.stack==='string'?error.stack:'';
    appendLog(stack?(stack.includes(message)?stack:`${message}\n${stack}`):message,'error');setStatus(`Code: ${message}`);
  }
  function update() {
    const state=runtimeState.state??runtimeState.playback??'idle';
    const runnable=!activePath||codePath(activePath);
    codePanel.dataset.editorKind=activePath?(runnable?'javascript':'text'):'none';codePanel.dataset.runnable=String(runnable);
    runButton.disabled=fileBusy||pending||Boolean(opening)||!runnable;applyButton.disabled=fileBusy||pending||Boolean(opening)||!runtime||!runnable;
    runButton.title=applyButton.title=runnable?'':'Text files are edited and saved here; only JavaScript files can run.';
    stopButton.disabled=!pending&&!runtime&&!runtimeState.running&&!runtimeState.busy;
    stateLabel.textContent=(runnable?'':'Text · ')+(pending?'Preparing…':state==='running'?(runtimeState.loopNames?.length?`Playing · ${runtimeState.loopNames.length} loop(s)`:'Running'):state.charAt(0).toUpperCase()+state.slice(1));
    adapter.setReadOnly?.(fileBusy||!activePath);textarea.readOnly=fileBusy||!activePath;
  }
  function rememberState() {files?.rememberCodeState?.(captureState());}
  function showExpanded(value) {
    expanded=Boolean(value)&&mode==='code';
    if(expanded)expandedSlot.append(section);
    else homeAnchor.parentNode.insertBefore(section,homeAnchor.nextSibling);
    expandedSlot.hidden=!expanded;
    workspace.classList.toggle('is-code-expanded',expanded);
    expandButton.setAttribute('aria-pressed',String(expanded));
    expandButton.setAttribute('aria-label',expanded?'Restore Code':'Maximize Code');
    expandButton.title=expanded?'Restore Code below the Synth':'Maximize Code beside Files';
    expandIcon.setAttribute('d',expanded?'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5':'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
    monacoEditor?.layout();
  }
  async function setExpanded(value) {
    if(disposed)return false;
    if(value&&mode!=='code')await setMode('code');
    if(disposed)return false;
    if(value)files?.setVisible?.(true);
    showExpanded(value);adapter.focus();return expanded;
  }
  function showMode(next) {
    if(!['keyboard','code'].includes(next))throw TypeError('Unknown input mode.');
    const changed=mode!==next;mode=next;
    keyboardTab.setAttribute('aria-selected',String(next==='keyboard'));keyboardTab.tabIndex=next==='keyboard'?0:-1;
    codeTab.setAttribute('aria-selected',String(next==='code'));codeTab.tabIndex=next==='code'?0:-1;
    keyboardPanel.hidden=next!=='keyboard';codePanel.hidden=next!=='code';
    expandButton.hidden=next!=='code';
    if(next!=='code'&&expanded)showExpanded(false);
    section.dataset.inputMode=next;
    if(changed)Promise.resolve(onModeChange(next)).catch(report);
    rememberState();update();
    if(next==='code')monacoEditor?.layout();
  }
  function writeCurrent() {
    if(disposed||changing||!activePath)return;
    const source=adapter.getValue();
    validateSource(activePath,source);
    if(textFile(project,activePath,allowTextFiles)!==source)writeText(activePath,source);
    try {localStorage.setItem(journalKey,JSON.stringify({workspaceId:files?.workspaceId,path:activePath,source}));}
    catch(error){setStatus(`Code recovery unavailable: ${error.message}. Export Cassette to keep your work.`);}
  }
  function validateSource(path,source) {
    if(source.length>(codePath(path)?MAX_CODE_LENGTH:maxTextLength))throw Error(codePath(path)?'JavaScript file exceeds 2 MiB.':'Text file exceeds the editor size limit.');
  }
  function setEditorSource(path,source) {
    changing=true;
    try {
      if(adapter.openVirtualFile)adapter.openVirtualFile(path,source);else adapter.setValue(source);
      const model=monacoEditor?.getModel?.();
      if(model)monacoApi?.editor?.setModelLanguage?.(model,codePath(path)?'javascript':/\.json$/i.test(path)?'json':'plaintext');
    }finally{changing=false;}
  }
  async function flush() {
    if(disposed)return false;
    writeCurrent();
    const receipt={workspaceId:files?.workspaceId,path:activePath,source:activePath?adapter.getValue():null};
    const saved=await files?.persistCode?.();
    if(saved&&!disposed&&receipt.path&&receipt.workspaceId===files?.workspaceId&&receipt.path===activePath&&receipt.source===adapter.getValue()) {
      try {
        const entry=JSON.parse(localStorage.getItem(journalKey)||'null');
        if(entry?.workspaceId===receipt.workspaceId&&entry.path===receipt.path&&entry.source===receipt.source)localStorage.removeItem(journalKey);
      }catch{}
    }
    return true;
  }
  function changeSource() {try{writeCurrent();}catch(error){report(error);}}
  function cancelPendingExecution() {
    if(disposed||!pending)return false;
    operation++;pending=false;update();return true;
  }
  async function loadMonaco() {
    if(monacoLoading||disposed)return monacoLoading;
    monacoLoading=Promise.resolve().then(()=>loadEditor()).then(({initializePlaygroundMonaco})=>{
      if(disposed)return;
      return initializePlaygroundMonaco({chip:editorChip,editor:textarea,editorHost,
        declarationFiles:['tetorica-playground-globals'],transformDeclarations,
        definitionRuntimeFile,
        getEditorValue:()=>adapter.getValue(),getActiveVirtualPath:()=>activePath??'/index.js',
        listVirtualFiles:()=>project.fs.list().filter(file=>!file.path.startsWith('/.tet.ss/')),
        openVirtualFile:path=>files?.selectFile?.(path),
        setEditorNote:value=>{if(!disposed)note.textContent=value;},
        setEditorAdapter(next){if(disposed)return;adapter=next;update();},
        onMonacoEditorReady({monaco,monacoEditor:editor}) {
          if(disposed){editor.dispose();return;}
          monacoEditor=editor;monacoApi=monaco;
          // Monaco 0.52's word-occurrence Delayer can reject unhandled when
          // mixed JS/text models switch. Disable this optional feature once,
          // before focus/model edits, only for hosts opting into text files.
          if(allowTextFiles)editor.updateOptions?.({occurrencesHighlight:'off'});
          editor.onDidChangeModelContent(changeSource);
          // Let the Code toolbar own execution shortcuts before Monaco treats
          // Ctrl/Cmd+Enter as an editor action such as inserting a new line.
          editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter,()=>void execute(false));
          editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyMod.Shift|monaco.KeyCode.Enter,()=>void execute(true));
          if(activePath)setEditorSource(activePath,textFile(project,activePath,allowTextFiles));
        },
      });
    }).catch(error=>{if(!disposed){note.textContent='Code editor unavailable. Plain text editing remains active.';appendLog(error.message);}});
    return monacoLoading;
  }
  async function openPath(path,{show=true}={},initializing=false) {
    if(typeof show!=='boolean')throw TypeError('File visibility must be boolean.');
    if(disposed)return false;
    const request=++workspaceOperation;
    if(!initializing) {
      // Selection intent fences an older Run before either operation waits
      // on storage. A slow JSON flush must not let old JS stop the song first.
      if(activePath!==path||!codePath(path))cancelPendingExecution();
      opening=request;update();
    }
    try {
      await files?.ready;
      if(disposed||request!==workspaceOperation)return false;
      await flush();if(disposed||request!==workspaceOperation)return false;
      const source=textFile(project,path,allowTextFiles);validateSource(path,source);
      if(activePath&&activePath!==path){operation++;pending=false;}
      activePath=path;setEditorSource(path,source);
      if(show){showMode('code');adapter.focus();void loadMonaco();}
      else {rememberState();update();}
      return true;
    }finally{if(opening===request){opening=null;if(!disposed)update();}}
  }
  const openFile=(path,options)=>openPath(path,options);
  async function ensureFile(isCurrent=()=>true,{show=true}={}) {
    const request=workspaceOperation;
    await files?.ready;
    if(disposed||request!==workspaceOperation||!isCurrent())return null;
    if(activePath&&project.fs.has(activePath))return activePath;
    const path='/index.js';
    if(!project.fs.has(path)) {
      const source=getStarterCode();if(typeof source!=='string')throw TypeError('Starter code must be text.');
      validateSource(path,source);writeText(path,source);
    }
    return await openPath(path,{show},true)?path:null;
  }
  async function obtainRuntime() {
    if(runtime)return runtime;
    if(!runtimeLoading)runtimeLoading=Promise.resolve().then(()=>getRuntime());
    try {runtime=await runtimeLoading;return runtime;}
    finally {runtimeLoading=null;}
  }
  async function execute(apply=false) {
    if(disposed||fileBusy||pending||opening||activePath&&!codePath(activePath))return;
    const epoch=++operation;pending=true;errorLog.textContent='';update();
    try {
      if(!await ensureFile(()=>epoch===operation))return;
      await flush();
      if(epoch!==operation||disposed||!codePath(activePath))return;
      const source=adapter.getValue(),path=activePath;
      await onBeforeRun({apply});if(epoch!==operation||disposed||activePath!==path||!codePath(path))return;
      const host=await obtainRuntime();if(epoch!==operation||disposed||activePath!==path||!codePath(path))return;
      executionPath=path;
      await host[apply?'apply':'run'](source,{path});
      if(epoch===operation&&!disposed){runtimeState=host.getState();setStatus(apply?'Code applied.':'Code running.');}
    }catch(error){if(epoch===operation&&!disposed)report(error);}
    finally{if(epoch===operation&&!disposed){pending=false;update();}}
  }
  async function stop() {
    const epoch=++operation;pending=false;runtimeState={state:'stopped',loopNames:[]};update();
    let stopped=true;
    if(runtime){try{await runtime.stop();}catch(error){stopped=false;if(epoch===operation)report(error);}}
    else runtimeLoading?.then(host=>{if(epoch===operation&&!disposed)return host.stop();}).catch(error=>{if(epoch===operation&&!disposed)report(error);});
    if(epoch===operation&&!disposed){if(stopped){executionPath=null;setStatus('Code stopped.');}update();}
    return stopped&&epoch===operation&&!disposed;
  }
  async function setMode(next,{focusEditor=true}={}) {
    if(typeof focusEditor!=='boolean')throw TypeError('Editor focus must be boolean.');
    if(disposed)return false;
    const request=++workspaceOperation;
    if(next==='code'){if(!await ensureFile(undefined,{show:false}))return false;showMode('code');if(focusEditor)adapter.focus();void loadMonaco();}
    else {
      await flush();if(disposed||request!==workspaceOperation)return false;
      if(!keepRunningOnKeyboard&&(!await stop()||disposed||request!==workspaceOperation))return false;
      showMode('keyboard');
    }
    return true;
  }
  async function workspaceReplaced() {
    if(disposed)return false;
    const request=++workspaceOperation;
    // Keep Code ownership until the output fade and chip cleanup have finished.
    // A later file/mode request or disposal must not be reset by this old reply.
    if(!await stop()||disposed||request!==workspaceOperation)return false;
    activePath=null;changing=true;try{adapter.setValue('');}finally{changing=false;}
    try{localStorage.removeItem(journalKey);}catch{}
    showMode('keyboard');
    return true;
  }
  async function restoreState(state) {
    if(disposed)return false;
    workspaceOperation++;
    if(state?.path&&(codePath(state.path)||allowTextFiles&&editorPath(state.path)&&project.fs.get(state.path)?.type==='text')&&project.fs.has(state.path)) {
      const source=textFile(project,state.path,allowTextFiles);validateSource(state.path,source);
      if(activePath&&activePath!==state.path){operation++;pending=false;}
      activePath=state.path;setEditorSource(activePath,source);
      showMode(state.mode==='code'?'code':'keyboard');if(state.mode==='code')void loadMonaco();
    }else if(state?.mode==='code')await setMode('code');
  }
  function pathChanged(source,destination) {
    const executing=within(executionPath,source);let stopExecution=false;
    if(executing) {
      const next=destination?destination+executionPath.slice(source.length):null;
      if(next&&codePath(next))executionPath=next;else stopExecution=true;
    }
    if(!within(activePath,source)){if(stopExecution)void stop();return;}
    workspaceOperation++;operation++;pending=false;
    if(destination){
      activePath=destination+activePath.slice(source.length);
      try{setEditorSource(activePath,textFile(project,activePath,allowTextFiles));}
      catch(error){activePath=null;changing=true;try{adapter.setValue('');}finally{changing=false;}report(error);}
      rememberState();update();
    }
    else {
      if(!executionPath&&codePath(activePath)&&!executing)stopExecution=true;
      activePath=null;changing=true;try{adapter.setValue('');}finally{changing=false;}rememberState();update();
    }
    // Start the physical Stop after updating editor ownership so the path
    // change itself cannot invalidate that cleanup's completion token.
    if(stopExecution)void stop();
  }
  const controls={openFile,flush,stop,cancelPendingExecution,setMode,setExpanded,restoreState,workspaceReplaced,pathChanged,captureState,appendLog,
    isCodeMode:()=>mode==='code',get activePath(){return activePath;},get executionPath(){return executionPath;},
    isExpanded:()=>expanded,
    setBusy(value){fileBusy=Boolean(value);update();},
    setRuntimeState(value){if(disposed)return;runtimeState={...value};update();},
    updateRuntimeState(value){controls.setRuntimeState(value);},
    dispose(){if(disposed)return;void flush().catch(()=>{});void stop();showExpanded(false);homeAnchor.remove();disposed=true;operation++;workspaceOperation++;for(const unlisten of listeners)unlisten();unwatch();monacoEditor?.dispose();},
  };
  listen(keyboardTab,'click',()=>{keyboardTab.focus();void setMode('keyboard').catch(report);});
  // Switching views keeps performance focus on the tab. Clicking an actual
  // file or expanding Code still focuses the editor for deliberate typing.
  listen(codeTab,'click',()=>{codeTab.focus();void setMode('code',{focusEditor:false}).catch(report);});
  listen(expandButton,'pointerdown',event=>event.preventDefault());
  listen(expandButton,'click',()=>void setExpanded(!expanded).catch(report));
  for(const tab of [keyboardTab,codeTab])listen(tab,'keydown',event=>{
    if(event.key===' '||event.key==='Enter'){event.stopPropagation();return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const next=event.key==='Home'?'keyboard':event.key==='End'?'code':mode==='code'?'keyboard':'code';
    void setMode(next,{focusEditor:false}).then(()=>byId(next==='code'?'synthInputCodeTab':'synthInputKeyboardTab').focus()).catch(report);
  });
  // Safari does not consistently focus a clicked button. An explicit toolbar
  // click leaves typing focus; editor execution shortcuts keep it for editing.
  listen(runButton,'click',()=>{runButton.focus();void execute(false);});
  listen(applyButton,'click',()=>{applyButton.focus();void execute(true);});
  listen(stopButton,'click',()=>{stopButton.focus();void stop();});
  listen(textarea,'input',changeSource);
  const executionShortcut=event=>{
    if(mode==='code'&&(event.ctrlKey||event.metaKey)&&!event.altKey&&(event.key==='Enter'||event.code==='Enter')) {
      event.preventDefault();event.stopImmediatePropagation();void execute(event.shiftKey);
    }
  };
  listen(section,'keydown',executionShortcut,true);
  // Expanded Code is moved beside Files, outside the input section.
  listen(codePanel,'keydown',executionShortcut,true);
  listen(codePanel,'keydown',event=>{
    if(event.target?.closest?.('input,textarea,select,[contenteditable],dialog[open],.monaco-editor,#synthCodeEditorHost')||
      [' ','Enter'].includes(event.key)&&event.target?.closest?.('button,a,summary,[role="button"]'))event.stopPropagation();
  });
  const unwatch=project.onDidChange(()=>{adapter.syncVirtualFiles?.(project.fs.list().filter(file=>!file.path.startsWith('/.tet.ss/')));});
  files?.setCodeControls?.(controls);update();
  controls.ready=Promise.resolve(files?.ready).then(async()=>{
    if(disposed)return;
    try {
      const entry=JSON.parse(localStorage.getItem(journalKey)||'null');
      if(entry?.workspaceId===files?.workspaceId&&(codePath(entry.path)||allowTextFiles&&editorPath(entry.path)&&project.fs.get(entry.path)?.type==='text')&&typeof entry.source==='string') {
        validateSource(entry.path,entry.source);writeText(entry.path,entry.source);
      }
    }catch(error){setStatus(`Could not recover the last code edit: ${error.message}`);}
    await restoreState(files?.getCodeState?.());
  }).catch(report);
  return controls;
}
