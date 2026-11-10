import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {definitionSource, sourcePosition, sourceChip, globalDefinition, runtimeImport} from './playground_monaco_definitions.js';

test('actual Playground declarations navigate to the factory and YM2612 implementation', async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
  for (const [symbol, file] of [['useSoundChip', 'playground_runtime.js'], ['setBpm', 'playground_runtime.js'], ['createTimeline', 'playground_runtime.js'], ['encodeBrr', 'snes_brr_encoder.js'], ['encodeAdpcmA', 'adpcm_a_sample.js'], ['encodePs1Adpcm', 'ps1_adpcm_encoder.js'], ['setFrequency', 'ym2612synth.js']]) {
    const lines = declarations.split('\n');
    const line = lines.findIndex(text => new RegExp(`\\b${symbol}[<(]`).test(text));
    assert.ok(line >= 0);
    const target = definitionSource(declarations, {startLineNumber:line + 1, startColumn:lines[line].indexOf(symbol) + 1});
    assert.deepEqual(target, {file, symbol});
    const source = await readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    const position = sourcePosition(source, symbol);
    assert.match(source.split('\n')[position.lineNumber - 1], new RegExp(`\\b${symbol}\\s*[( :]`));
  }
});

test('ADPCM-A encoder global and pg lookup keep their own implementation',()=>{
  const declarations='declare function encodeAdpcmA(pcm:Float32Array):unknown;';
  const library={uri:'file:///globals.d.ts',getValue:()=>declarations,getPositionAt:offset=>({lineNumber:1,column:offset+1})};
  for(const code of ['encodeAdpcmA(pcm)','pg.encodeAdpcmA(pcm)','other.encodeAdpcmA(pcm)']){
    const startColumn=code.indexOf('encodeAdpcmA')+1;
    const model={getWordAtPosition:()=>({word:'encodeAdpcmA',startColumn}),getLineContent:()=>code};
    const target=globalDefinition(model,{lineNumber:1,column:startColumn},new Map([['library',library]]));
    if(code.startsWith('other.'))assert.equal(target,null);
    else assert.deepEqual(definitionSource(declarations,target.range),{file:'adpcm_a_sample.js',symbol:'encodeAdpcmA'});
  }
});

test('BRR encoder global and pg fallback resolve the actual encoder declaration and implementation', async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
  const library = {
    uri:'file:///tetorica-playground-globals.d.ts', getValue:() => declarations,
    getPositionAt:offset => ({lineNumber:declarations.slice(0, offset).split('\n').length, column:offset - declarations.lastIndexOf('\n', offset - 1)}),
  };
  for (const code of ['encodeBrr(pcm)', 'pg.encodeBrr(pcm)', 'other.encodeBrr(pcm)']) {
    const startColumn = code.indexOf('encodeBrr') + 1;
    const model = {getWordAtPosition:() => ({word:'encodeBrr', startColumn}), getLineContent:() => code};
    const target = globalDefinition(model, {lineNumber:1, column:startColumn}, new Map([['library', library]]));
    if (code.startsWith('other.')) assert.equal(target, null);
    else {
      assert.equal(target?.uri, library.uri);
      const line = declarations.split('\n')[target.range.startLineNumber - 1];
      assert.match(line, /^declare function encodeBrr\(/);
      assert.deepEqual(definitionSource(declarations, target.range), {file:'snes_brr_encoder.js', symbol:'encodeBrr'});
    }
  }
});

test('global fallback finds setBpm and pg.setBpm without matching unrelated members', () => {
  const declarations='/** Tempo */\ndeclare function setBpm(bpm: number): void;';
  const library={uri:'file:///globals.d.ts',getValue:()=>declarations,getPositionAt:offset=>({lineNumber:2,column:offset-declarations.indexOf('\n')})};
  for(const code of ['setBpm(120)', 'pg.setBpm(120)', 'other.setBpm(120)']){
    const startColumn=code.indexOf('setBpm')+1;
    const model={getWordAtPosition:()=>({word:'setBpm',startColumn}),getLineContent:()=>code};
    const result=globalDefinition(model,{lineNumber:1,column:startColumn+2},new Map([['library',library]]));
    if(code.startsWith('other.'))assert.equal(result,null);
    else assert.deepEqual(result,{uri:library.uri,range:{startLineNumber:2,startColumn:18,endLineNumber:2,endColumn:24}});
  }
});

test('implementation lookup skips call sites and unsupported declarations', () => {
  const source = '// setFrequency()\nthis.setFrequency(0);\n  setFrequency(channel) {}';
  assert.deepEqual(sourcePosition(source, 'setFrequency'), {lineNumber:3, column:3});
  assert.equal(definitionSource('interface Unknown {\n  method(): void;\n}', {lineNumber:2, column:3}), null);
});

test('runtime imports resolve named aliases, multiline bindings and cache versions', async () => {
  const source=await readFile(new URL('../js/playground_runtime.js',import.meta.url),'utf8');
  assert.deepEqual(runtimeImport(source,'createPlaygroundNoiseApi'),{specifier:'./playground_noise.js',symbol:'createPlaygroundNoiseApi'});
  assert.deepEqual(runtimeImport('import {\n original as local, other\n} from "./module.js?v=1";','local'),{specifier:'./module.js?v=1',symbol:'original'});
  assert.deepEqual(runtimeImport('import Default, {helper} from "./module.js";','Default'),{specifier:'./module.js',symbol:'default'});
  assert.equal(runtimeImport('import {helper} from "https://example.com/module.js";','helper'),null);
  assert.equal(runtimeImport('import {helper} from "./module.js";','unrelated'),null);
  assert.deepEqual(sourcePosition('export const helper = () => {};','helper'),{lineNumber:1,column:14});
});

test('explicit instance chip overrides the selected Playground chip', () => {
  const code = 'const fm = await useSoundChip("ym2612");\nfm.setFrequency(0, 4, 553);';
  const editor = {
    getModel: () => ({getValue: () => code, getLineContent: line => code.split('\n')[line - 1]}),
    getPosition: () => ({lineNumber:2, column:10}),
  };
  assert.equal(sourceChip(editor, 'ym2608'), 'ym2612');
  assert.deepEqual(definitionSource('interface FMApi {\n  setFrequency(): void;\n}', {lineNumber:2, column:3}, 'ym2608'), {file:'opn_fm_synth.js', symbol:'setFrequency'});
});

test('DX7 declarations navigate to the independent DX7 client', async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
  const lines = declarations.split('\n');
  const start = lines.findIndex(line => /^interface PlaygroundDx7 \{/.test(line));
  const line = lines.findIndex((text, index) => index > start && /loadSysex\(/.test(text));
  assert.ok(line > start);
  assert.deepEqual(definitionSource(declarations, {lineNumber:line + 1, column:lines[line].indexOf('loadSysex') + 1}), {
    file:'playground_dx7.js', symbol:'loadSysex',
  });
});

test('OPL declarations navigate to the shared Synth, original presets and native client',async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8');
  const lines = declarations.split('\n');
  const base = lines.findIndex(line => /^interface PlaygroundOplBase</.test(line)); assert(base >= 0);
  const checks = ['setOperator','setPreset','setAlgo','setPan','setNote','setFrequency','setPitch','keyOn','keyOff','noteOn','noteOff','allNotesOff','setLFO','setRhythm'];
  const source = await readFile(new URL('../js/opl_synth.js',import.meta.url),'utf8');
  for (const symbol of checks) {
    const line = lines.findIndex((text,index) => index > base && new RegExp(`^  ${symbol}\\(`).test(text)); assert(line > base,symbol);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf(symbol) + 1}),{file:'opl_synth.js',symbol});
    const point = sourcePosition(source,symbol); assert.match(source.split('\n')[point.lineNumber - 1],new RegExp(`\\b${symbol}\\(`));
  }
  for (const [symbol,file,targetSymbol] of [['opl','playground_opl.js','createOplClient'],['OPL_PRESETS','opl_synth.js','OPL_PRESETS']]) {
    const line = lines.findIndex(text => text.startsWith(`declare const ${symbol}:`)); assert(line >= 0,symbol);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf(symbol) + 1}),{file,symbol:targetSymbol});
    const runtime = await readFile(new URL(`../js/${file}`,import.meta.url),'utf8'); const point = sourcePosition(runtime,targetSymbol); assert(point.lineNumber > 1,symbol);
  }
  for (const name of ['PlaygroundOplBase','PlaygroundOpl','PlaygroundPrimaryOpl']) {
    const text = `type ${name}<K> = {};`;
    assert.deepEqual(definitionSource(text,{lineNumber:1,column:6}),{file:'opl_synth.js',symbol:'OPLSynth'});
  }
  const pairLine = lines.findIndex(text => /setFourOp\(channel:/.test(text)); assert(pairLine >= 0);
  assert.deepEqual(definitionSource(declarations,{lineNumber:pairLine + 1,column:lines[pairLine].indexOf('setFourOp') + 1}),{file:'opl_synth.js',symbol:'setFourOp'});
});

test('OPLL definitions identify the shared YM2413 patch instead of the OPL implementation',async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8'), lines = declarations.split('\n');
  const start = lines.findIndex(line => /^interface PlaygroundYm2413 \{/.test(line)); assert(start >= 0);
  const source = await readFile(new URL('../../tetorica_src/runtime/ym2413synth.js',import.meta.url),'utf8');
  for (const symbol of ['setVoice','setUserPatch','setUserOperator','setRhythmLevel','noteOn','keyOff']) {
    const line = lines.findIndex((text,index) => index > start && new RegExp(`^  ${symbol}\\(`).test(text)); assert(line > start);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf(symbol) + 1}),{file:'ym2413synth.js',symbol});
    const point = sourcePosition(source,symbol); assert.match(source.split('\n')[point.lineNumber - 1],new RegExp(`\\b${symbol}\\(`));
  }
  for (const [symbol,file,targetSymbol] of [['opll','playground_ym2413.js','createYm2413Client'],['OPLL_INSTRUMENTS','ym2413synth.js','YM2413_INSTRUMENTS'],['OPLL_USER_PRESETS','ym2413synth.js','YM2413_USER_PRESETS']]) {
    const line = lines.findIndex(text => text.startsWith(`declare const ${symbol}:`)); assert(line >= 0,symbol);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf(symbol) + 1}),{file,symbol:targetSymbol});
  }
  assert.deepEqual(definitionSource('interface PlaygroundOpll {\n  setUserPatch():void;\n}',{lineNumber:2,column:3}),{file:'ym2413synth.js',symbol:'setUserPatch'});
});

test('MSX AY definitions navigate to their own Synth and primary client',async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8'), lines = declarations.split('\n');
  const start = lines.findIndex(line => /^interface PlaygroundAy8910 \{/.test(line)); assert(start >= 0);
  const source = await readFile(new URL('../../tetorica_src/runtime/ay8910synth.js',import.meta.url),'utf8');
  for (const symbol of ['setVoice','setMixer','setEnvelope','setNoisePeriod','setTonePeriod','noteOn','keyOff']) {
    const line = lines.findIndex((text,index) => index > start && new RegExp(`^  ${symbol}\\(`).test(text)); assert(line > start,symbol);
    assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf(symbol) + 1}),{file:'ay8910synth.js',symbol});
    const point = sourcePosition(source,symbol); assert.match(source.split('\n')[point.lineNumber - 1],new RegExp(`\\b${symbol}\\(`));
  }
  const line = lines.findIndex(text => text.startsWith('declare const ay:')); assert(line >= 0);
  assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf('ay:') + 1}),{file:'playground_ay8910.js',symbol:'createAy8910Client'});
});

test('SID definitions navigate to hardware authoring or ordered asynchronous client methods', async () => {
  const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8');
  const lines = declarations.split('\n'), start = lines.findIndex(line => /^interface PlaygroundSid \{/.test(line));
  assert(start >= 0);
  const synth = await readFile(new URL('../../tetorica_src/runtime/sidsynth.js',import.meta.url),'utf8');
  const client = await readFile(new URL('../../tetorica_src/runtime/playground_sid.js',import.meta.url),'utf8');
  for (const symbol of ['initialize','reset','writeRegister','setVoice','setFilter','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','getState','readRegister','setClock']) {
    const line = lines.findIndex((text,index) => index > start && new RegExp(`^  ${symbol}\\(`).test(text)); assert(line > start,symbol);
    const ordered = ['getState','readRegister','setClock'].includes(symbol), target = ordered ? 'createSidRegisterClient' : symbol;
    assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf(symbol) + 1}),{file:ordered?'playground_sid.js':'sidsynth.js',symbol:target});
    const source = ordered ? client : synth, point = sourcePosition(source,target);
    assert.match(source.split('\n')[point.lineNumber - 1],new RegExp(`\\b${target}\\(`));
  }
  const line = lines.findIndex(text => text.startsWith('declare const sid:')); assert(line >= 0);
  assert.deepEqual(definitionSource(declarations,{lineNumber:line + 1,column:lines[line].indexOf('sid:') + 1}),{file:'playground_sid.js',symbol:'createSidClient'});
});

test('read-only source navigation avoids pending occurrence highlights and does not reopen a closed async lookup',async()=>{
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.listeners=new Map();this.open=false;}
    append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
    addEventListener(type,callback){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(callback);}
    async fire(type){await Promise.all((this.listeners.get(type)??[]).map(callback=>callback({target:this})));}
    setAttribute(){}
    showModal(){this.open=true;}
    close(){this.open=false;void this.fire('close');}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  }
  const originalDocument=globalThis.document,originalFetch=globalThis.fetch;
  const doc={body:new Element('body'),createElement:tag=>new Element(tag)};
  const uri=value=>{const url=new URL(value);return{scheme:url.protocol.slice(0,-1),path:url.pathname,toString:()=>value};};
  const model=(text,resource)=>({uri:resource,getValue:()=>text,getLineContent:line=>text.split('\n')[line-1],dispose(){this.disposed=true;}});
  const library=model('declare function useSoundChip(name:string):unknown;',uri('file:///globals.d.ts'));
  const mainModel=model("const fm = await useSoundChip('ym2612');",uri('file:///project/index.js'));
  const models=new Map([[library.uri.toString(),library]]),editors=[],registrations=[];
  const mainEditor={getModel:()=>mainModel,getPosition:()=>({lineNumber:1,column:20}),focus(){this.focusCount=(this.focusCount??0)+1;}};
  let opener,resolveFetch,fetches=0,disposedRegistrations=0;
  const registration=()=>{registrations.push(true);return{dispose(){disposedRegistrations++;}};};
  const monaco={Uri:{parse:uri},languages:{registerDefinitionProvider(){return registration();}},editor:{
    registerEditorOpener(value){opener=value;return registration();},getModel:resource=>models.get(resource.toString()),
    createModel(text,_language,resource){const value=model(text,resource);models.set(resource.toString(),value);return value;},
    create(host,options){const editor={host,options,model:options.model,swaps:[],position:null,
      onContextMenu(){},setModel(value){this.model=value;this.swaps.push(value.uri.path);},setPosition(value){this.position=value;},
      revealLineInCenter(){},focus(){},dispose(){this.disposed=true;}};editors.push(editor);return editor;},
  }};
  let viewer;
  try {
    globalThis.document=doc;
    globalThis.fetch=async()=>{fetches++;return new Promise(resolve=>{resolveFetch=resolve;});};
    // Capture the injected trusted fetch in this isolated module instance.
    const {createDefinitionViewer}=await import('./playground_monaco_definitions.js?viewer-lifecycle-test');
    viewer=createDefinitionViewer(monaco,mainEditor,new Map([[library.uri.toString(),library]]),{
      chip:'ym2612',runtimeFile:'playground_code_runtime.js',
    });
    const dialog=doc.body.children[0],header=dialog.children[0],implementation=header.children[1],close=header.children[2];
    const position={startLineNumber:1,startColumn:18};
    assert(await opener.openCodeEditor(mainEditor,library.uri,position));
    assert(dialog.open);assert.equal(editors.length,1);assert.equal(fetches,0,'opening a declaration does not fetch source');
    assert.equal(editors[0].options.readOnly,true);assert.equal(editors[0].options.domReadOnly,true);
    assert.equal(editors[0].options.occurrencesHighlight,'off','read-only model swaps never start the cancellable Monaco word-highlight delay');
    assert.equal(implementation.hidden,false,'implementation navigation remains available');

    const loading=implementation.fire('click');
    assert.equal(fetches,1);assert.equal(implementation.disabled,true);
    await close.fire('click');assert.equal(dialog.open,false);
    resolveFetch({ok:true,text:async()=> '// Runtime implementation\nexport function useSoundChip(name) { return name; }\n'});
    await loading;
    assert.equal(dialog.open,false,'a late source reply cannot reopen the dismissed dialog');
    assert.equal(editors[0].model,library,'a closed lookup cannot replace the declaration model');

    assert(await opener.openCodeEditor(mainEditor,library.uri,position));
    await implementation.fire('click');
    assert.equal(fetches,1,'the previously loaded source is reused');
    assert.equal(editors[0].model.uri.path,'/tetorica-runtime/playground_code_runtime.js');
    assert.deepEqual(editors[0].position,{lineNumber:2,column:17});
    assert.equal(implementation.hidden,true,'the implementation opens as source, not another declaration');
    assert.equal(header.children[0].textContent,'playground_code_runtime.js (read-only)');
    assert.equal(editors[0].options.occurrencesHighlight,'off');
    viewer.dispose();viewer=null;
    assert(editors[0].disposed);assert.equal(disposedRegistrations,registrations.length);
    assert.equal(doc.body.children.length,0);
  }finally{viewer?.dispose();globalThis.document=originalDocument;globalThis.fetch=originalFetch;}
});
