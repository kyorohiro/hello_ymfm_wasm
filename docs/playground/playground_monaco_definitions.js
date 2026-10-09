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
  const pattern = new RegExp(`^\\s*(?:(?:export\\s+)?(?:async\\s+)?function\\s+)?(?:async\\s+)?${escaped}\\s*(?:\\(|:)`, 'm');
  const match = pattern.exec(text);
  if (!match) return {lineNumber:1, column:1};
  const index = match.index + match[0].indexOf(symbol);
  const prefix = text.slice(0,index);
  return {lineNumber:prefix.split('\n').length, column:index - prefix.lastIndexOf('\n')};
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
  const sources=new Map();
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
    if(!viewer)viewer=monaco.editor.create(host,{model,readOnly:true,domReadOnly:true,theme:'vs-dark',automaticLayout:true,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,renderValidationDecorations:'off'});
    else viewer.setModel(model);
    title.textContent=model.uri.path.split('/').at(-1)+' (read-only)';
    message.textContent='';
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
      let model=sources.get(uri.toString());
      if(!model){
        const response=await nativeFetch(new URL(`../js/${selected.file}`,import.meta.url),{cache:'no-cache'});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const text=await response.text();
        if(disposed||token!==revision)return;
        model=monaco.editor.createModel(text,'javascript',uri);sources.set(uri.toString(),model);
      }
      if(disposed||token!==revision)return;
      show(model,sourcePosition(model.getValue(),selected.symbol));
    }catch(error){if(!disposed&&token===revision){message.textContent=`Could not load implementation: ${error.message}`;implementation.disabled=false;}}
  });
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{revision++;mainEditor.focus();});
  return {dispose(){disposed=true;revision++;globals.dispose();opener.dispose();viewer?.dispose();for(const model of sources.values())model.dispose();dialog.remove();}};
}
