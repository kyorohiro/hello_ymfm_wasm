import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./playground.js',import.meta.url),'utf8');
function setup(prepare, gameboyMode = 'readable') {
  const nodes=new Map(), imports=[],statuses=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'/test.js',checked:false,disabled:false,hidden:false,events:{},addEventListener(name,fn){this.events[name]=fn;},setCustomValidity(v){this.validity=v;},reportValidity(){},showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}});return nodes.get(id);};
  const c=vm.createContext({prepareVgmImport:prepare,document:{getElementById:node,querySelector:q=>q.includes('gameboy')?{value:gameboyMode}:{value:'high'}},setStatus:s=>statuses.push(s),normalizeVirtualPath:p=>p,isSystemVirtualPath:p=>p.startsWith('/sys/'),virtualFiles:{get(){}},importVgmFile:async(f,o)=>imports.push({f,o}),mainMenu:{open:true},syncDacBase64Option(){},runButton:{focus(){}}});
  for(const id of ['vgmImportInput','vgmImportDialog','vgmImportTarget','vgmImportFilename','convertVgmButton','cancelVgmImportButton','includeDacInput','dacBase64Input']) c[id]=node(id);
  vm.runInContext('let pendingVgmImportFile=null;let pendingVgmImport=null;let vgmImportRequest=0;',c);
  const change=source.slice(source.indexOf("  vgmImportInput.addEventListener('change'"),source.indexOf('\n}\n\nfunction bootPlayground'));
  const convert=source.slice(source.indexOf('  convertVgmButton?.addEventListener('),source.indexOf('\n  function syncDacBase64Option()'));
  const cancel=source.slice(source.indexOf('  cancelVgmImportButton?.addEventListener('),source.indexOf('\n  tfiImportInput.addEventListener('));
  const close=source.slice(source.indexOf('  vgmImportDialog.addEventListener("close"'),source.indexOf('  vgmImportDialog.addEventListener("close"')+source.slice(source.indexOf('  vgmImportDialog.addEventListener("close"')).indexOf('\n  });')+6);
  vm.runInContext(change+'\n'+convert+'\n'+cancel+'\n'+close,c);
  return {node,imports,statuses,choose:async name=>{node('vgmImportInput').files=[{name}];return node('vgmImportInput').events.change();}};
}
const prepared=family=>({detection:{family,supported:true,chips:[family],message:'test options'}});
test('analysis precedes dialog; chip-specific options and explicit conversion use the cached input',async()=>{
  const gb=prepared('gameboy'),ui=setup(async()=>gb);
  await ui.choose('song.vgz');assert.equal(ui.node('vgmImportDialog').open,true);
  assert.equal(ui.node('opnImportOptions').hidden,true);assert.equal(ui.node('gameboyImportOptions').hidden,false);
  assert.equal(ui.imports.length,0);
  ui.node('convertVgmButton').events.click();assert.equal(ui.imports.length,1);
  assert.equal(ui.imports[0].o.prepared,gb);assert.equal(ui.imports[0].o.gameboyMode,'readable');assert.equal(ui.imports[0].o.targetPath,'/song.js');
  const opn=setup(async()=>prepared('opn'));await opn.choose('song.s98');
  assert.equal(opn.node('opnImportOptions').hidden,false);assert.equal(opn.node('gameboyImportOptions').hidden,true);
  opn.node('convertVgmButton').events.click();assert.equal(opn.imports[0].o.mode,'high');
});
test('cancel, unsupported input, invalid destination and failed analysis do not convert',async()=>{
  const ui=setup(async()=>prepared('gameboy'));await ui.choose('test.vgm');
  ui.node('cancelVgmImportButton').events.click();ui.node('convertVgmButton').events.click();assert.equal(ui.imports.length,0);
  await ui.choose('test.vgm');ui.node('vgmImportTarget').value='/sys/test.js';ui.node('convertVgmButton').events.click();assert.equal(ui.imports.length,0);
  const unsupported=setup(async()=>({detection:{chips:['nes'],supported:false,message:'not supported'}}));await unsupported.choose('test.vgm');
  assert.equal(unsupported.node('convertVgmButton').disabled,true);unsupported.node('convertVgmButton').events.click();assert.equal(unsupported.imports.length,0);
  const bad=setup(async()=>{throw new Error('invalid');});await bad.choose('bad.vgm');assert.equal(bad.node('vgmImportDialog').open,undefined);assert.match(bad.statuses.at(-1),/invalid/);
});
test('late analysis results cannot replace a newer selection',async()=>{
  let finish;
  const ui=setup(f=>f.name==='old.vgm'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(prepared('opn')));
  const old=ui.choose('old.vgm');await ui.choose('new.vgm');finish(prepared('gameboy'));await old;
  assert.equal(ui.node('vgmImportFilename').textContent,'new.vgm');assert.equal(ui.node('gameboyImportOptions').hidden,true);
});

test('High-level API selection is passed to conversion without replacing the raw option',async()=>{
  const ui=setup(async()=>prepared('gameboy'),'high');await ui.choose('test.vgm');
  ui.node('convertVgmButton').events.click();assert.equal(ui.imports[0].o.gameboyMode,'high');
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  for(const mode of ['raw','readable','high']) assert.ok(html.includes(`name="gameboyImportMode" value="${mode}"`));
});

test('RF5C164 selection keeps all modes, channel splitting and DAC options enabled',()=>{
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
  const radios=['schedule','write','high'].map(value=>({value,checked:value==='high'}));
  node('includeRf5c164Input').checked=true;
  const context=vm.createContext({pendingVgmImport:{detection:{rf5c164:true}},document:{getElementById:node,querySelectorAll:()=>radios,querySelector:()=>radios.find(r=>r.checked)},dacBase64Input:{},dacBase64Label:{}});
  const start=source.indexOf('  function syncDacBase64Option()');
  vm.runInContext(source.slice(start,source.indexOf('\n  document.querySelectorAll',start))+'\nsyncDacBase64Option();',context);
  assert.equal(radios.find(r=>r.checked).value,'high');assert.deepEqual(radios.map(r=>r.disabled),[false,false,false]);
  assert.equal(node('splitVgmChannelsInput').disabled,false);
  assert.equal(context.dacBase64Input.disabled,false);
  node('includeRf5c164Input').checked=false;vm.runInContext('syncDacBase64Option()',context);
  assert.ok(radios.every(r=>!r.disabled));assert.equal(node('splitVgmChannelsInput').disabled,false);
});
