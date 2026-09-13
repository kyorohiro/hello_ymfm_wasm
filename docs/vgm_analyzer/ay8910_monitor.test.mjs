import test from 'node:test';
import assert from 'node:assert/strict';
import {describeAy8910,mountAy8910Monitor} from './ay8910_monitor.js';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('AY pitch uses tone period and suppresses noise-only and zero-volume notes',()=>{
  const regs=new Uint8Array(16);regs[0]=100;regs[7]=0x3e;regs[8]=15;
  let ch=describeAy8910(regs,1600000)[0];assert.equal(ch.frequency,1000);assert.notEqual(ch.midi,null);
  assert.equal(describeAy8910(regs,1600000,16,17)[0].frequency,500);
  regs[7]=0x37;ch=describeAy8910(regs,1600000)[0];assert.equal(ch.noise,true);assert.equal(ch.midi,null);
  regs[7]=0x3e;regs[8]=0;assert.equal(describeAy8910(regs,1600000)[0].midi,null);
});
test('AY monitor shows written registers and restores mute controls on file changes',()=>{
  const element=()=>({children:[],checked:false,hidden:false,events:{},append(...x){this.children.push(...x);},addEventListener(n,f){this.events[n]=f;},blur(){}});
  const before=globalThis.document;globalThis.document={createElement:element};
  try{
    const root=element(),events=[];const monitor=mountAy8910Monitor(root,(...x)=>events.push(x));
    monitor.load({ay8910Clock:1789773,ym2413Clock:3579545});
    monitor.write(0,100);monitor.write(7,62);monitor.write(8,15);monitor.render();
    assert.match(root.children[2].children[1].textContent,/Tone: On/);
    const checkbox=root.children[2].children[0].children[0];checkbox.checked=true;checkbox.events.change();
    assert.deepEqual(events,[[0,true]]);
    monitor.reset();assert.equal(checkbox.checked,true);
    monitor.load({ay8910Clock:1789773,ay8910Type:16});assert.equal(checkbox.checked,false);
    assert.equal(root.children[0].textContent,'YM2149');assert.equal(root.children.at(-1).hidden,true);
  }finally{globalThis.document=before;}
});
test('Analyzer AY mode enables its monitor, disables FM exports and restores OPN',()=>{
  const text=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
  const start=text.indexOf('function updateChipSupport('),end=text.indexOf('\n}',start)+2;
  const names=['operatorInfoTab','noteishTab','tfiInfoTab','sampleTab','parsedOutputTab','exportMidiButton','exportMmlButton','exportSnapshotTfiButton','exportSnapshotVgiButton','exportSnapshotButton','exportAllTfiButton','exportAllVgiButton'];
  const notice={},context={currentChipKind:'ay8910',opnMonitorRoot:{},ayMonitorRoot:{},document:{getElementById:()=>notice},selected:null,setOutputTab(name){context.selected=name;}};
  for(const name of names)context[name]={disabled:false,getAttribute:()=> 'false'};
  vm.createContext(context);vm.runInContext(text.slice(start,end),context);context.updateChipSupport();
  assert.equal(context.operatorInfoTab.disabled,false);assert.equal(context.exportMidiButton.disabled,true);
  assert.equal(context.noteishTab.disabled,true);assert.equal(context.selected,'operator-info');
  assert.equal(context.opnMonitorRoot.hidden,true);assert.equal(context.ayMonitorRoot.hidden,false);
  context.currentChipKind='ym2612';context.updateChipSupport();assert.equal(context.noteishTab.disabled,false);
  assert.equal(context.opnMonitorRoot.hidden,false);assert.equal(context.ayMonitorRoot.hidden,true);
});
