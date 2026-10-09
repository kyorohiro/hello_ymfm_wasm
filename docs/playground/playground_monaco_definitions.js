/** Read-only definition/source viewer. Library files never enter the project or cassette. */
const nativeFetch = globalThis.fetch?.bind(globalThis);

export function definitionSource(text, position, chip = 'ym2612') {
  const lines = text.split('\n');
  const line = lines[position?.startLineNumber ? position.startLineNumber - 1 : (position?.lineNumber ?? 1) - 1] ?? '';
  const column = position?.startColumn ?? position?.column ?? 1;
  const symbol = /[\w$]+/.exec(line.slice(column - 1))?.[0] ?? '';
  const prefix = lines.slice(0, position?.startLineNumber ?? position?.lineNumber ?? 1).join('\n');
  const owners = [...prefix.matchAll(/^(?:declare\s+)?(?:interface|type)\s+(\w+)/gm)];
  const owner = owners.at(-1)?.[1] ?? '';
  if (['useSoundChip', 'createSoundChip', 'setBpm', 'beat', 'nextBeat', 'sleep', 'sleepSamples', 'tween'].includes(symbol)) return {file:'playground_runtime.js', symbol};
  if (['hzToBlockFnum', 'createPitchFromMidi'].includes(symbol)) return {file:'pitch.js', symbol};
  if (['noteToBlockFnum', 'play', 'scale', 'chord', 'noteLerp'].includes(symbol)) return {file:'playground_music.js', symbol};
  if (/^PlaygroundNes$/.test(owner)) return {file:'nesapusynth.js', symbol};
  if (/^PlaygroundGameboy$/.test(owner)) return {file:'gameboysynth.js', symbol};
  if (/^PlaygroundYm2151$/.test(owner)) return {file:'playground_ym2151.js', symbol};
  if (/^PlaygroundYm2608$/.test(owner)) return {file:'ym2608synth.js', symbol};
  if (/^PlaygroundRf5c164$/.test(owner)) return {file:'rf5c164synth.js', symbol};
  if (/^PlaygroundSegaPsg$/.test(owner)) return {file:'segapsgsynth.js', symbol};
  if (/^PlaygroundPWM32X$/.test(owner)) return {file:'pwm32x_playback.js', symbol};
  if (['FMApi','PlaygroundCreatedFm','PlaygroundCreatedYm2203','PlaygroundCreatedYm2610'].includes(owner)) {
    return {file:chip === 'ym2612' ? 'ym2612synth.js' : 'opn_fm_synth.js', symbol};
  }
  return null;
}

export function sourcePosition(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\s*(?:(?:export\\s+)?(?:default\\s+)?(?:(?:async\\s+)?function\\s+|(?:const|let|var|class)\\s+))?(?:async\\s+)?${escaped}\\s*(?:\\(|:|=|\\{)`, 'm');
  const match = pattern.exec(text);
  if (!match) return {lineNumber:1, column:1};
  const index = match.index + match[0].indexOf(symbol);
  const prefix = text.slice(0,index);
  return {lineNumber:prefix.split('\n').length, column:index - prefix.lastIndexOf('\n')};
}

/** Locate the module needed to resolve an imported identifier without loading the whole runtime. */
export function runtimeImport(text, symbol) {
  const imports=/^\s*import\s+([\w$\s{},*]+?)\s+from\s*['"]([^'"]+)['"]/gm;
  for(const match of text.matchAll(imports)){
    const [,bindings,specifier]=match;
    if(!specifier.startsWith('./')&&!specifier.startsWith('../'))continue;
    const named=/\{([^}]+)\}/.exec(bindings)?.[1];
    for(const entry of (named??'').split(',')){
      const [imported,local=imported]=entry.trim().split(/\s+as\s+/);
      if(local===symbol)return {specifier,symbol:imported};
    }
    const defaultName=/^\s*([\w$]+)/.exec(bindings)?.[1];
    if(defaultName===symbol)return {specifier,symbol:'default'};
  }
  return null;
}

export function sourceChip(editor, fallback) {
  const model=editor.getModel(), position=editor.getPosition();
  if(!model||!position)return fallback;
  const prefix=model.getLineContent(position.lineNumber).slice(0,position.column-1);
  const variable=/([\w$]+)\.\w*$/.exec(prefix)?.[1];
  if(!variable)return fallback;
  const escaped=variable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matches=[...model.getValue().matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*await\\s+(?:pg\\.)?(?:useSoundChip|createSoundChip)\\(\\s*['"]([^'"]+)['"]`,'g'))];
  return matches.at(-1)?.[1]??fallback;
}

/** Index runtime globals independently of the language worker's lazy synchronization. */
export function globalDefinition(model, position, libraryModels) {
  const word=model.getWordAtPosition(position);
  if(!word)return null;
  const prefix=model.getLineContent(position.lineNumber).slice(0,word.startColumn-1);
  // Only a bare global or pg.helper is a Playground helper, not an arbitrary member.
  if(/\.\s*$/.test(prefix)&&!/(?:^|[^\w$.])pg\.\s*$/.test(prefix))return null;
  const escaped=word.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const library of libraryModels.values()){
    const match=new RegExp(`^declare (?:function|const) (${escaped})(?=[\\s(<:;])`,'m').exec(library.getValue());
    if(!match)continue;
    const offset=match.index+match[0].lastIndexOf(word.word);
    const start=library.getPositionAt(offset),end=library.getPositionAt(offset+word.word.length);
    return {uri:library.uri,range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column}};
  }
  return null;
}

export function createDefinitionViewer(monaco, mainEditor, libraryModels, options = {}) {
  const dialog=document.createElement('dialog'); dialog.dataset.monacoDefinition='true';
  Object.assign(dialog.style,{width:'min(1100px, 94vw)',maxWidth:'94vw',padding:'16px',background:'#111827',color:'#e5e7eb',border:'1px solid #475569',borderRadius:'10px'});
  const header=document.createElement('div');Object.assign(header.style,{display:'flex',gap:'12px',alignItems:'center',marginBottom:'12px'});
  const title=document.createElement('strong');title.style.flex='1';
  const implementation=document.createElement('button');implementation.type='button';implementation.textContent='View implementation';
  const close=document.createElement('button');close.type='button';close.textContent='Close';
  const message=document.createElement('p');message.setAttribute('role','status');message.style.margin='0 0 8px';
  const host=document.createElement('div');host.style.height='min(65vh, 620px)';host.style.width='100%';
  header.append(title,implementation,close);dialog.append(header,message,host);document.body.append(dialog);
  let viewer=null, target=null, revision=0, ownerChip=options.chip??'ym2612', disposed=false;
  const contextMenu=document.createElement('div');contextMenu.setAttribute('role','menu');contextMenu.hidden=true;
  Object.assign(contextMenu.style,{position:'absolute',zIndex:'10',padding:'6px',background:'#1e293b',border:'1px solid #475569',borderRadius:'6px'});
  const goDefinition=document.createElement('button');goDefinition.type='button';goDefinition.textContent='Go to Definition';goDefinition.setAttribute('role','menuitem');
  contextMenu.append(goDefinition);dialog.append(contextMenu);
  goDefinition.addEventListener('mousedown',event=>event.preventDefault());
  goDefinition.addEventListener('click',()=>{contextMenu.hidden=true;viewer?.focus();viewer?.trigger('runtime-context-menu','editor.action.revealDefinition',{});});
  dialog.addEventListener('mousedown',event=>{if(!contextMenu.contains(event.target))contextMenu.hidden=true;});
  dialog.addEventListener('cancel',event=>{if(!contextMenu.hidden){event.preventDefault();contextMenu.hidden=true;viewer?.focus();}});
  const sources=new Map();
  const pendingSources=new Map();
  async function loadSource(uri){
    const existing=sources.get(uri.toString());
    if(existing)return existing;
    if(uri.scheme!=='file'||!uri.path.startsWith('/tetorica-runtime/')||!uri.path.endsWith('.js'))return null;
    const key=uri.toString();
    if(!pendingSources.has(key))pendingSources.set(key,(async()=>{
      const file=uri.path.slice('/tetorica-runtime/'.length);
      const response=await nativeFetch(new URL(`../js/${file}`,import.meta.url),{cache:'no-cache'});
      if(!response.ok)throw new Error(`HTTP ${response.status}: ${file}`);
      const text=await response.text();
      if(disposed)return null;
      const model=monaco.editor.getModel(uri)??monaco.editor.createModel(text,'javascript',uri);
      sources.set(key,model);return model;
    })().finally(()=>pendingSources.delete(key)));
    return pendingSources.get(key);
  }
  // Avoid the built-in provider returning a stale, unresolved import alias in parallel.
  const runtimeDefinitions=monaco.languages.registerDefinitionProvider({language:'javascript',scheme:'file',pattern:'**/tetorica-runtime/**',exclusive:true},{
    async provideDefinition(model,position,token){
      if(!sources.has(model.uri.toString()))return null;
      const word=model.getWordAtPosition(position);
      if(!word)return null;
      const imported=runtimeImport(model.getValue(),word.word);
      try{
        // Query strings are cache versions, not part of the source model's identity.
        let importedModel=null;
        if(imported){
          const url=new URL(imported.specifier,model.uri.toString());url.search='';url.hash='';
          importedModel=await loadSource(monaco.Uri.parse(url.href));
          if(!importedModel)return null;
        }
        if(token.isCancellationRequested||disposed)return null;
        const getWorker=await monaco.languages.typescript.getJavaScriptWorker();
        const worker=await getWorker(...[model.uri,importedModel?.uri].filter(Boolean));
        const definitions=await worker.getDefinitionAtPosition(model.uri.toString(),model.getOffsetAt(position));
        if(token.isCancellationRequested||disposed)return null;
        const resolved=definitions?.flatMap(definition=>{
          const uri=monaco.Uri.parse(definition.fileName),target=monaco.editor.getModel(uri);
          if(!target)return [];
          // An unresolved import alias still points at its own import statement.
          if(definition.kind==='alias'&&uri.toString()===model.uri.toString())return [];
          const start=target.getPositionAt(definition.textSpan.start),end=target.getPositionAt(definition.textSpan.start+definition.textSpan.length);
          return [{uri,range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column}}];
        });
        if(resolved?.length)return resolved;
        if(!importedModel)return null;
        const point=sourcePosition(importedModel.getValue(),imported.symbol);
        return {uri:importedModel.uri,range:{startLineNumber:point.lineNumber,startColumn:point.column,endLineNumber:point.lineNumber,endColumn:point.column}};
      }catch(error){if(!disposed&&!token.isCancellationRequested)message.textContent=`Could not load definition: ${error.message}`;return null;}
    },
  });
  const globals=monaco.languages.registerDefinitionProvider('javascript',{
    async provideDefinition(model,position,token){
      if(!model.uri.path.startsWith('/project/'))return null;
      const fallback=globalDefinition(model,position,libraryModels);
      if(!fallback)return null;
      try{
        const getWorker=await monaco.languages.typescript.getJavaScriptWorker();
        const worker=await getWorker(model.uri);
        const definitions=await worker.getDefinitionAtPosition(model.uri.toString(),model.getOffsetAt(position));
        if(token.isCancellationRequested)return null;
        // Respect local bindings; also explicitly expose known models when the built-in adapter misses them.
        if(definitions?.length)return definitions.flatMap(definition=>{
          const uri=monaco.Uri.parse(definition.fileName),target=monaco.editor.getModel(uri);
          if(!target)return [];
          const start=target.getPositionAt(definition.textSpan.start),end=target.getPositionAt(definition.textSpan.start+definition.textSpan.length);
          return [{uri,range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column}}];
        });
      }catch{if(token.isCancellationRequested)return null;}
      return fallback;
    },
  });
  function show(model, position) {
    if(disposed)return;
    if(!dialog.open)dialog.showModal();
    if(!viewer){
      viewer=monaco.editor.create(host,{model,readOnly:true,domReadOnly:true,theme:'vs-dark',automaticLayout:true,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,renderValidationDecorations:'off',contextmenu:false});
      viewer.onContextMenu(event=>{
        event.event.preventDefault();
        if(event.target.position)viewer.setPosition(event.target.position);
        const rect=dialog.getBoundingClientRect(),mouse=event.event.browserEvent;
        contextMenu.style.left=Math.max(0,Math.min(rect.width-180,mouse.clientX-rect.left))+'px';
        contextMenu.style.top=Math.max(0,Math.min(rect.height-50,mouse.clientY-rect.top))+'px';
        contextMenu.hidden=false;
      });
    }
    else viewer.setModel(model);
    title.textContent=model.uri.path.split('/').at(-1)+' (read-only)';
    message.textContent='';contextMenu.hidden=true;
    if(model.uri.path.endsWith('.d.ts'))target=definitionSource(model.getValue(),position,ownerChip);
    else target=null;
    implementation.hidden=!target;implementation.disabled=false;
    const point=position?.startLineNumber ? {lineNumber:position.startLineNumber,column:position.startColumn} : position??{lineNumber:1,column:1};
    viewer.setPosition(point);viewer.revealLineInCenter(point.lineNumber);viewer.focus();
  }
  const opener=monaco.editor.registerEditorOpener({
    async openCodeEditor(source,resource,position) {
      if(source!==mainEditor&&source!==viewer)return false;
      const model=libraryModels.get(resource.toString())??sources.get(resource.toString());
      if(model){ownerChip=sourceChip(source,ownerChip);revision++;show(model,position);return true;}
      if(resource.scheme==='file'&&resource.path.startsWith('/project/')&&options.openVirtualFile){
        options.openVirtualFile(resource.path.slice('/project'.length));
        if(position?.startLineNumber){mainEditor.setSelection(position);mainEditor.revealLineInCenter(position.startLineNumber);}
        else if(position){mainEditor.setPosition(position);mainEditor.revealLineInCenter(position.lineNumber);}
        if(dialog.open)dialog.close();mainEditor.focus();return true;
      }
      return false;
    },
  });
  implementation.addEventListener('click',async()=>{
    const selected=target, token=++revision;if(!selected)return;
    implementation.disabled=true;message.textContent='Loading implementation…';
    try{
      const uri=monaco.Uri.parse(`file:///tetorica-runtime/${selected.file}`);
      const model=await loadSource(uri);
      if(!model||disposed||token!==revision)return;
      show(model,sourcePosition(model.getValue(),selected.symbol));
    }catch(error){if(!disposed&&token===revision){message.textContent=`Could not load implementation: ${error.message}`;implementation.disabled=false;}}
  });
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{revision++;contextMenu.hidden=true;mainEditor.focus();});
  return {dispose(){disposed=true;revision++;runtimeDefinitions.dispose();globals.dispose();opener.dispose();viewer?.dispose();for(const model of sources.values())model.dispose();dialog.remove();}};
}
