import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundChipTabs, createPlaygroundAdditionalChipTabAvailability, frequencyNote, rfSamplePosition, pwmRoutingControl} from './playground_chip_tabs.js';

// Small DOM substitute for lifecycle tests. Rendering and input focus also receive browser coverage.
class Element {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.classList = {add() {},toggle() {}}; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] ?? []).filter(fn=>fn!==callback); }
  async fire(name, extra = {}) { await Promise.all((this.listeners[name] ?? []).map(fn => fn({type:name,target:this,preventDefault(){},...extra}))); await flush(); }
  setCustomValidity(value) { this.validityMessage = value; }
  reportValidity() {}
  getContext() { return null; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const walk = node => [node, ...node.children.flatMap(walk)];
const control = (root, name) => walk(root).find(node => node.dataset.chipControl === name);
function fixture(inspector, options = {}) {
  const listeners = new Map();
  const doc = {activeElement: null, hidden: false, createElement: tag => new Element(doc, tag),
    defaultView:{setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}},
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
    fire(name) { for (const callback of listeners.get(name) ?? []) callback(); },
    listenerCount(name) { return listeners.get(name)?.size ?? 0; },
  };
  const roots = Object.fromEntries(['segapsg', 'rf5c164', 'pwm','gameboy','nes','snes','ym2151','okim6258','wonderswan','pokey','huc6280','ym3812','ym3526','y8950','ymf262','ym2413','ay8910'].map(kind => [kind, new Element(doc, 'div')]));
  const tabs = createPlaygroundChipTabs({roots, getInspector: () => inspector, pollMs: 100000, ...options});
  return {doc, roots, tabs};
}
const psgState = frequency => ({kind: 'segapsg', clock: 3579545, channels: [0, 1, 2].map(channel => ({channel, frequency, period: 254, attenuation: 4, active: true})), noise: {type: 'white', rate: 'tone3', attenuation: 7, active: true}});
const snesState = (timeline={loaded:false}) => ({kind:'snes',samples:[{id:0,startAddress:1024,byteLength:9,frames:16,rootFrequencyHz:440,basePitch:4096,loop:true}],
  channels:Array.from({length:8},(_,channel)=>({channel,sample:0,pitch:4096,adsr1:0,adsr2:0,gain:100,volumeLeft:80,volumeRight:90,active:channel===1})),timeline});
const pokeyState=(frequency=440)=>({kind:'pokey',clock:1789790,audctl:0,skctl:3,running:true,registers:Array.from({length:16},(_,index)=>index===15?3:0),
  channels:Array.from({length:4},(_,channel)=>({channel,frequency,period:72,volume:0,configuredVolume:channel?8:0,distortion:5,volumeOnly:false,joined:false,helper:false,highClock:false,active:false,type:'Tone',reason:'Pure tone'}))});
const chipAction=(root,name)=>walk(root).find(node=>node.dataset.chipAction===name);
const chipChannel=(root,index)=>walk(root).find(node=>node.dataset.chipChannel===String(index));

test('SNES applied voice editor selects physical voice and sends only the edited parameter',async()=>{
  const calls=[];let reads=0;
  const inspector={list:()=>[{id:'brr-a',kind:'snes',additional:true}],read:async()=>{reads++;return snesState();},invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{eventDrivenAdditionalKinds:['snes']});tabs.setVisible('snes');await flush();
  assert.equal(control(roots.snes,'snes-pitch').value,'4096');assert.equal(control(roots.snes,'snes-sample').value,'0');assert.deepEqual(calls,[]);
  await walk(roots.snes).find(n=>n.dataset.chipChannel==='7').fire('click');
  const gain=control(roots.snes,'snes-gain');gain.value='73';await gain.fire('change');
  assert.deepEqual(calls,[['brr-a','setPreset',[7,{gain:73}]]]);
  const before=reads;tabs.setVisible(null);await tabs.refresh();assert.equal(reads,before);tabs.dispose();
});

test('SNES preview is released on instance change and stale Keyboard targets cannot start a new voice',async()=>{
  const calls=[],targets=[];
  const inspector={list:()=>[{id:'brr-a',kind:'snes'},{id:'brr-b',kind:'snes'}],read:async()=>snesState(),invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{onKeyboardTargetChange:value=>targets.push(value)});tabs.setVisible('snes');await flush();
  await walk(roots.snes).find(n=>n.dataset.chipAction==='snes-keyboard').fire('click');
  const target=targets.at(-1);target.noteOn({id:'key-a',midi:60});await flush();
  assert.equal(calls[0][1],'auditionOn');assert.equal(calls[0][0],'brr-a');
  const instance=control(roots.snes,'instance');instance.value='brr-b';await instance.fire('change');
  assert.equal(calls[1][1],'auditionOff');assert.equal(calls[1][0],'brr-a');
  const count=calls.length;target.noteOn({id:'stale',midi:64});await flush();assert.equal(calls.length,count);tabs.dispose();
});

test('SNES timeline snapshots disable instrument editing without starting audio or an observer loop',async()=>{
  const calls=[];
  const inspector={list:()=>[{id:'trace',kind:'snes',additional:true}],read:async()=>snesState({loaded:true,playing:true,totalFrames:32000,positionFrames:100}),invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{eventDrivenAdditionalKinds:['snes']});tabs.setVisible('snes');await flush();
  assert.match(walk(roots.snes).find(n=>n.dataset.chipOutput==='snes-timeline').textContent,/Timeline.*Playing/);
  const fieldsets=walk(roots.snes).filter(n=>n.tagName==='fieldset');assert(fieldsets.some(n=>n.disabled));
  await tabs.refresh();assert.deepEqual(calls,[]);tabs.dispose();
});

test('pitch labels include standard A4 and negative octaves', () => {
  assert.equal(frequencyNote(440), 'A4'); assert.equal(frequencyNote(261.625565), 'C4');
  assert.equal(frequencyNote(8.175799), 'C-1'); assert.equal(frequencyNote(0), '—'); assert.equal(frequencyNote(NaN), '—');
});

test('RF sample marker editing aligns start but preserves exact loop samples', () => {
  const sample = {valid: true, address: 512, frames: 900};
  assert.equal(rfSamplePosition(sample, 389, {start: true}), 768);
  assert.equal(rfSamplePosition(sample, 389), 901);
  assert.equal(rfSamplePosition(sample, -9), 512);
  assert.equal(rfSamplePosition(sample, 9999), 1411);
  assert.throws(() => rfSamplePosition({...sample, valid: false}, 0), /unknown/);
  assert.throws(() => rfSamplePosition(sample, Infinity), /finite/);
});

test('PWM routing preserves unrelated interrupt and routing bits', () => {
  assert.equal(pwmRoutingControl(0x0a55, 'left', 2), 0x0a56);
  assert.equal(pwmRoutingControl(0x0a55, 'right', 2), 0x0a59);
  assert.throws(() => pwmRoutingControl(0, 'middle', 1), /routing/);
  assert.throws(() => pwmRoutingControl(0, 'left', 4), /routing/);
});

test('hidden tabs never read or create chips; hiding releases lifecycle subscription', async () => {
  let reads = 0, subscriptions = 0, unsubscribed = 0;
  const inspector = {list: () => [{id: 'segapsg', kind: 'segapsg', connected: true}], read: async () => { reads++; return psgState(440); }, subscribe() { subscriptions++; return () => unsubscribed++; }};
  const {tabs} = fixture(inspector);
  await flush(); assert.equal(reads, 0); assert.equal(subscriptions, 0);
  tabs.setVisible('segapsg'); await flush(); assert.equal(reads, 1); assert.equal(subscriptions, 1);
  tabs.setVisible(null); await tabs.refresh(); assert.equal(reads, 1); assert.equal(unsubscribed, 1);
  tabs.dispose();
});

test('background document stops reads and subscriptions, rejects late state, and resumes the selected editor', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let reads = 0, subscriptions = 0, unsubscribed = 0, finishFirst;
  const inspector = {list: () => [{id: 'segapsg', kind: 'segapsg'}], read: () => {
    reads++; return reads === 1 ? new Promise(resolve => {finishFirst = resolve;}) : Promise.resolve(psgState(880));
  }, subscribe() { subscriptions++; return () => unsubscribed++; }};
  const {tabs, roots, doc} = fixture(inspector, {pollMs: 10});
  tabs.setVisible('segapsg'); assert.equal(reads, 1);
  doc.hidden = true; doc.fire('visibilitychange'); assert.equal(unsubscribed, 1);
  finishFirst(psgState(220)); await flush();
  assert.equal(control(roots.segapsg, 'tone-0-note').value, '');
  t.mock.timers.tick(1000); await tabs.refresh(); await flush(); assert.equal(reads, 1);
  doc.hidden = false; doc.fire('visibilitychange'); await flush();
  assert.equal(reads, 2); assert.equal(subscriptions, 2);
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A5');
  t.mock.timers.tick(10); await flush(); assert.equal(reads, 3);
  tabs.dispose(); assert.equal(unsubscribed, 2); assert.equal(doc.listenerCount('visibilitychange'), 0);
  doc.hidden = true; doc.fire('visibilitychange'); doc.hidden = false; doc.fire('visibilitychange');
  t.mock.timers.tick(1000); await flush(); assert.equal(reads, 3);
});

test('PSG renders applied state without resending noise and preserves focused edits', async () => {
  const calls = [];
  const inspector = {list: () => [{id: 'psg-1', kind: 'segapsg'}], read: async () => psgState(440), invoke: async (...args) => calls.push(args)};
  const {tabs, roots, doc} = fixture(inspector); tabs.setVisible('segapsg'); await flush();
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A4'); assert.deepEqual(calls, []);
  const input = control(roots.segapsg, 'tone-0-frequency'); input.value = '123.456'; doc.activeElement = input;
  await tabs.refresh(); assert.equal(input.value, '123.456');
  doc.activeElement = null; await input.fire('change');
  assert.deepEqual(calls[0], ['psg-1', 'setFrequency', [0, 123.456]]);
  const noise = control(roots.segapsg, 'noise-rate'); noise.value = 'low'; await noise.fire('change');
  assert.deepEqual(calls[1], ['psg-1', 'setNoise', [{type: 'white', rate: 'low'}]]);
  tabs.dispose();
});

test('tab audition metadata follows PSG channel and instance without playing or polling extra audio',async () => {
  let connected=false;const calls=[],selections=[];
  const inspector={list:()=>connected?[{id:'psg-a',kind:'segapsg'},{id:'psg-b',kind:'segapsg'}]:[],read:async()=>psgState(440),invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{onAuditionTargetChange:value=>selections.push(value)});
  tabs.setVisible('segapsg');await flush();
  assert.deepEqual(selections.at(-1),{kind:'segapsg',id:'',channel:0},'primary metadata can prepare the first key without Run');
  connected=true;await tabs.refresh();
  assert.deepEqual(selections.at(-1),{kind:'segapsg',id:'psg-a',channel:0});
  await walk(roots.segapsg).find(node=>node.dataset.chipKeyboardChannel==='3').fire('click');
  assert.deepEqual(selections.at(-1),{kind:'segapsg',id:'psg-a',channel:3});
  const count=selections.length;await tabs.refresh();assert.equal(selections.length,count,'unchanged snapshots keep a held target stable');
  const instance=control(roots.segapsg,'instance');instance.value='psg-b';await instance.fire('change');
  assert.deepEqual(selections.at(-1),{kind:'segapsg',id:'psg-b',channel:3});
  tabs.setVisible('pwm');assert.equal(selections.at(-1),null,'a stream has no pitched audition target');
  tabs.setVisible(null);assert.equal(selections.at(-1),null);
  assert.deepEqual(calls,[],'selection and readback never trigger sound');tabs.dispose();
});

test('native editor audition selection follows its channel without taking over a script Keyboard binding',async () => {
  const calls=[],selections=[],manual=[];
  const inspector={list:()=>[{id:'nes',kind:'nes'}],read:async()=>({kind:'nes',clock:1789773,fdsEnabled:true,channels:[],registers:[]}),invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{onAuditionTargetChange:value=>selections.push(value),onKeyboardTargetChange:value=>manual.push(value)});
  tabs.setVisible('nes');await flush();
  assert.deepEqual(selections.at(-1),{kind:'nes',id:'nes',channel:0});
  await walk(roots.nes).find(node=>node.dataset.nesChannel==='5').fire('click');
  // This DOM substitute has no event propagation; dispatch the bubbled click.
  await roots.nes.children.find(node=>node.tagName==='fieldset').fire('click');
  assert.deepEqual(selections.at(-1),{kind:'nes',id:'nes',channel:5});
  assert.deepEqual(manual,[]);assert.deepEqual(calls,[]);
  tabs.setVisible(null);assert.equal(selections.at(-1),null);tabs.dispose();
});

test('late snapshot after changing instance cannot overwrite selected instance', async () => {
  let resolveFirst;
  const inspector = {list: () => [{id: 'a', kind: 'segapsg'}, {id: 'b', kind: 'segapsg'}], read: id => id === 'a' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(psgState(880))};
  const {tabs, roots} = fixture(inspector); tabs.setVisible('segapsg'); await flush();
  const instance = control(roots.segapsg, 'instance'); instance.value = 'b'; await instance.fire('change');
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A5');
  resolveFirst(psgState(220)); await flush();
  assert.equal(control(roots.segapsg, 'tone-0-note').value, 'A5'); tabs.dispose();
});

test('RF loading passes file bytes to safe backend allocator and assigns the selected channel', async () => {
  const calls = [], loads = [];
  const sample = {valid: true, name: '/tone.wav', address: 512, end: 1415, frames: 900, loopStart: 1413, step: 2048, waveform: [0, 1, -1, 0]};
  const inspector = {
    list: () => [{id: 'rf', kind: 'rf5c164'}],
    read: async () => ({kind: 'rf5c164', clock: 12500000, channels: Array.from({length: 8}, (_, channel) => ({channel, start: 512, loopStart: 1413, step: 2048, volume: 255, pan: {left: 15, right: 15}, active: false})), samples: [sample]}),
    loadSample: async (...args) => { loads.push(args); return sample; }, invoke: async (...args) => calls.push(args),
  };
  const {tabs, roots} = fixture(inspector, {listFiles: () => [{path: '/tone.wav'}, {path: '/code.js'}], readFile: async () => ({data: new Uint8Array([1, 2, 3])})});
  tabs.setVisible('rf5c164'); await flush();
  const file = control(roots.rf5c164, 'rf-file'); assert.equal(file.children.length, 1); file.value = '/tone.wav';
  await walk(roots.rf5c164).find(node => node.textContent === 'Load audio file').fire('click');
  assert.equal(loads.length, 1); assert.equal(loads[0][0], 'rf'); assert.deepEqual(loads[0][2], {name: '/tone.wav'});
  assert.deepEqual(calls[0], ['rf', 'setChannel', [0, {start: 512, loopStart: 1413, step: 2048}]]);
  const assigned = control(roots.rf5c164, 'rf-sample'); assigned.value = '512'; await assigned.fire('change');
  assert.deepEqual(calls[1], ['rf', 'setChannel', [0, {start: 512, loopStart: 1413, step: 2048}]]);
  const start = control(roots.rf5c164, 'rf-start-offset'); start.value = '389'; await start.fire('change');
  assert.deepEqual(calls[2], ['rf', 'setChannel', [0, {start: 768}]]); tabs.dispose();
});

test('RF first load into address zero initializes an unconfigured channel for audible preview', async () => {
  const calls = [];
  const sample = {valid: true, address: 0, end: 903, frames: 900, step: 2048, loopStart: 901};
  const inspector = {list: () => [{id: 'rf', kind: 'rf5c164'}], read: async () => ({kind: 'rf5c164', channels: Array.from({length: 8}, (_, channel) => ({channel, start: 0, loopStart: 0, step: 0, volume: 0, pan: {left: 0, right: 0}})), samples: [sample]}), loadSample: async () => sample, invoke: async (...args) => calls.push(args)};
  const {tabs, roots} = fixture(inspector, {listFiles: () => ['/tone.wav'], readFile: () => new Uint8Array([1])});
  tabs.setVisible('rf5c164'); await flush();
  await walk(roots.rf5c164).find(node => node.textContent === 'Load audio file').fire('click');
  assert.deepEqual(calls, [['rf', 'setChannel', [0, {start: 0, loopStart: 901, step: 2048, volume: 255, pan: {left: 15, right: 15}}]]]);
  assert.ok(walk(roots.rf5c164).some(node => node.textContent === 'Sample loaded and assigned to CH1. Press On to preview.')); tabs.dispose();
});

test('RF selection changed during loading keeps material but does not assign another channel', async () => {
  const calls = []; let finishLoad;
  const sample = {valid: true, address: 0, end: 903, frames: 900, step: 2048, loopStart: 901};
  const inspector = {list: () => [{id: 'rf', kind: 'rf5c164'}], read: async () => ({kind: 'rf5c164', channels: Array.from({length: 8}, (_, channel) => ({channel, start: 0, loopStart: 0, step: 0, volume: 0, pan: {left: 0, right: 0}})), samples: []}), loadSample: () => new Promise(resolve => {finishLoad = resolve;}), invoke: async (...args) => calls.push(args)};
  const {tabs, roots} = fixture(inspector, {listFiles: () => ['/tone.wav'], readFile: () => new Uint8Array([1])});
  tabs.setVisible('rf5c164'); await flush();
  const loadButton = walk(roots.rf5c164).find(node => node.textContent === 'Load audio file');
  const loading = loadButton.fire('click'); await flush(); await tabs.refresh(); assert.equal(loadButton.disabled, true);
  await walk(roots.rf5c164).find(node => node.dataset.chipChannel === '1').fire('click');
  await walk(roots.rf5c164).find(node => node.dataset.chipChannel === '0').fire('click');
  finishLoad(sample); await loading;
  assert.deepEqual(calls, []);
  assert.ok(walk(roots.rf5c164).some(node => node.textContent.includes('Selection changed;'))); tabs.dispose();
});

test('PWM route editing preserves clock/interrupt controls and never submits samples', async () => {
  const calls = [];
  const inspector = {list: () => [{id: 'pwm', kind: 'pwm'}], read: async () => ({kind: 'pwm', control: 0xa55, cycle: 567, clock: 23011360, sampleRate: 44100, queuedWrites: 20, currentFrame: 70, fifo: {left: {empty: true, full: false}, right: {empty: false, full: true}}, registers: [0xa55, 567, 0x4000, 0x8000, 0]}), invoke: async (...args) => calls.push(args)};
  const {tabs, roots} = fixture(inspector); tabs.setVisible('pwm'); await flush();
  const route = control(roots.pwm, 'pwm-left-route'); route.value = '2'; await route.fire('change');
  assert.deepEqual(calls, [['pwm', 'writeRegister', [0, 0xa56]]]); tabs.dispose();
});

test('native editors prepare explicitly, render without writing and retire a selected instance', async () => {
  let prepared = false, reads = 0;
  const calls = [], targets = [];
  const snapshot = {kind:'gameboy',clock:4194304,channels:Array.from({length:4},(_,channel)=>({channel,frequency:440,volume:10,duty:.5,envelope:{direction:'down',period:0},waveform:Array(32).fill(8),pan:{left:true,right:true}}))};
  const inspector = {
    list:()=>prepared ? [{id:'gameboy',kind:'gameboy'},{id:'other',kind:'gameboy'}] : [],
    read:async()=>{reads++;return snapshot;},
    invoke:async(...args)=>calls.push(args),
  };
  const {tabs,roots}=fixture(inspector,{ensureAudioReady:async()=>{prepared=true;},onKeyboardTargetChange:target=>targets.push(target)});
  tabs.setVisible('gameboy');await flush();
  assert.equal(prepared,false);assert.equal(reads,0,'opening an editor keeps audio closed');
  await walk(roots.gameboy).find(node=>node.dataset.chipAction==='prepare').fire('click');
  assert(reads>0);assert.deepEqual(calls,[],'readback and rendering never send audio commands');
  const volume=control(roots.gameboy,'gb-volume');volume.value='7';await volume.fire('input');
  assert.deepEqual(calls[0],['gameboy','setVoice',[0,{volume:7}]]);
  await walk(roots.gameboy).find(node=>node.dataset.chipAction==='gb-keyboard').fire('click');
  const target=targets.at(-1);assert(target?.name.includes('Game Boy'));
  tabs.setVisible(null);target.noteOn({id:'press',midi:69,velocity:100});await flush();
  assert(calls.some(([,method])=>method==='auditionOn'),'Keyboard target survives hiding the editor');
  tabs.setVisible('gameboy');await flush();
  const instance=control(roots.gameboy,'instance');instance.value='other';await instance.fire('change');
  assert.equal(targets.at(-1),null,'switching instance retires the previous Keyboard target');
  const before=calls.length;target.noteOn({id:'stale',midi:69});await flush();
  assert.equal(calls.length,before,'a retired target cannot play the replacement device');tabs.dispose();
});

test('Run target handoff prevents native channel selection taking Keyboard back', async () => {
  const targets=[];
  const inspector={list:()=>[{id:'nes',kind:'nes'}],read:async()=>({kind:'nes',clock:1789773,fdsEnabled:true,channels:[],registers:[]}),invoke:async()=>{}};
  const {tabs,roots}=fixture(inspector,{onKeyboardTargetChange:target=>targets.push(target)});
  tabs.setVisible('nes');await flush();
  await walk(roots.nes).find(node=>node.dataset.nesAction==='keyboard').fire('click');assert(targets.at(-1));
  tabs.clearKeyboardTarget();const count=targets.length;
  await walk(roots.nes).find(node=>node.dataset.nesChannel==='1').fire('click');
  assert.equal(targets.length,count,'a later channel edit respects the script binding');tabs.dispose();
});

for (const kind of ['ym3812','ym3526','y8950','ymf262']) test(`${kind} native tab prepares only its primary chip and shares edited voice with Keyboard`,async () => {
  let prepared = false; const calls = [], targets = [];
  const snapshot = {kind,clock:kind === 'ymf262' ? 14318180 : 3579545,channels:Array.from({length:kind === 'ymf262' ? 18 : 9},(_,channel) => ({channel,available:true,pairedWith:null,frequency:440,algorithm:0,feedback:0,pan:{left:true,right:true},operators:Array.from({length:2},() => ({multi:1,tl:30,ksl:0,ar:15,dr:0,sl:0,rr:12,waveform:0,egt:true}))})),registers:[]};
  const inspector = {list:() => prepared ? [{id:kind,kind}] : [],read:async id => {assert.equal(id,kind); return snapshot;},invoke:async (...args) => calls.push(args)};
  const {tabs,roots} = fixture(inspector,{ensureAudioReady:async () => {prepared = true;},onKeyboardTargetChange:target => targets.push(target)});
  tabs.setVisible(kind); await flush(); assert.equal(prepared,false); assert.deepEqual(calls,[]);
  await walk(roots[kind]).find(node => node.dataset.chipAction === 'prepare').fire('click'); assert.equal(control(roots[kind],'opl-frequency').value,'440'); assert.deepEqual(calls,[]);
  control(roots[kind],'opl-op-0-tl').value = '26'; await control(roots[kind],'opl-op-0-tl').fire('change'); assert.deepEqual(calls[0],[kind,'setOperator',[0,0,{tl:26}]]);
  await walk(roots[kind]).find(node => node.dataset.chipChannel === '1').fire('click'); await walk(roots[kind]).find(node => node.dataset.chipAction === 'opl-keyboard').fire('click');
  tabs.setVisible(null); const target = targets.at(-1); target.noteOn({id:'key',midi:69}); await flush(); assert.deepEqual(calls.at(-1).slice(0,2),[kind,'auditionOn']); assert.equal(calls.at(-1)[2][0],1);
  target.noteOff({id:'key'}); await flush(); assert.equal(calls.at(-1)[1],'auditionOff'); tabs.dispose();
});

test('YM2413 editor borrows the Master System OPLL beside PSG and keeps User edits global',async () => {
  let prepared = false; const calls = [], targets = [];
  const state = {kind:'ym2413',clock:3579545,channels:Array.from({length:9},(_,channel) => ({channel,available:true,instrument:3,attenuation:5,sustain:false,frequency:440})),
    userPatch:{feedback:0,operators:[{multi:1,tl:63,ksl:0,ar:15,dr:0,sl:0,rr:12,waveform:0},{multi:1,ksl:0,ar:15,dr:0,sl:0,rr:12,waveform:0}]},rhythm:{enabled:false,levels:{}},registers:[]};
  const inspector = {list:() => prepared ? [{id:'segapsg',kind:'segapsg'},{id:'ym2413',kind:'ym2413'}] : [],read:async id => {assert.equal(id,'ym2413'); return state;},invoke:async (...args) => calls.push(args)};
  const {tabs,roots} = fixture(inspector,{ensureAudioReady:async () => {prepared = true;},onKeyboardTargetChange:target => targets.push(target)});
  tabs.setVisible('ym2413'); await flush(); assert.equal(prepared,false); await walk(roots.ym2413).find(node => node.dataset.chipAction === 'prepare').fire('click'); assert.deepEqual(calls,[],'inspection never initializes or changes either chip');
  const tl = control(roots.ym2413,'opll-user-op-0-tl'); tl.value = '31'; await tl.fire('change'); assert.deepEqual(calls[0],['ym2413','setUserOperator',[0,{tl:31}]]);
  await walk(roots.ym2413).find(node => node.dataset.chipChannel === '2').fire('click'); await walk(roots.ym2413).find(node => node.dataset.chipAction === 'opll-keyboard').fire('click');
  tabs.setVisible(null); const target = targets.at(-1); target.noteOn({id:'key',midi:69}); await flush(); assert.deepEqual(calls.at(-1).slice(0,2),['ym2413','auditionOn']); assert.equal(calls.at(-1)[2][0],2);
  target.noteOff({id:'key'}); await flush(); assert.equal(calls.at(-1)[1],'auditionOff'); tabs.dispose();
});

test('MSX AY editor prepares the shared environment and routes audition to its physical PSG instance',async () => {
  let prepared = false; const calls = [], targets = [];
  const snapshot = {kind:'ay8910',clock:1789773,channels:Array.from({length:3},(_,channel) => ({channel,active:false,toneEnabled:true,noiseEnabled:false,volume:0,configuredVolume:9,configuredEnvelope:false,envelope:false,period:254,frequency:440})),noise:{period:16,frequency:6991.3},envelope:{period:1500,shape:10},registers:[]};
  const inspector = {list:() => prepared ? [{id:'ay8910',kind:'ay8910'},{id:'ym2413',kind:'ym2413'},{id:'y8950',kind:'y8950'}] : [],read:async id => {assert.equal(id,'ay8910'); return snapshot;},invoke:async (...args) => calls.push(args)};
  const {tabs,roots} = fixture(inspector,{ensureAudioReady:async () => {prepared = true;},onKeyboardTargetChange:target => targets.push(target)});
  tabs.setVisible('ay8910'); await flush(); assert.equal(prepared,false);
  await walk(roots.ay8910).find(node => node.dataset.chipAction === 'prepare').fire('click'); assert.deepEqual(calls,[],'opening and readback do not program a shared generator');
  const period = control(roots.ay8910,'ay-envelope-period'); period.value = '2200'; await period.fire('change'); assert.deepEqual(calls[0],['ay8910','setEnvelope',[{period:2200}]]);
  await walk(roots.ay8910).find(node => node.dataset.chipChannel === '2').fire('click'); await walk(roots.ay8910).find(node => node.dataset.chipAction === 'ay-keyboard').fire('click');
  tabs.setVisible(null); const target = targets.at(-1); target.noteOn({id:'key',midi:69}); await flush(); assert.deepEqual(calls.at(-1).slice(0,2),['ay8910','auditionOn']); assert.equal(calls.at(-1)[2][0],2);
  target.noteOff({id:'key'}); await flush(); assert.equal(calls.at(-1)[1],'auditionOff'); tabs.dispose();
});


test('additional chip tab availability observes metadata only, preserves mode tabs and releases subscriptions',async()=>{
  const listeners=new Set(),calls=[];let entries=[],reads=0,unsubscribed=0;
  const inspector={list:()=>entries,read(){reads++;},subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn);unsubscribed++;};}};
  const watcher=createPlaygroundAdditionalChipTabAvailability({getInspector:()=>inspector,kinds:['ym2151','okim6258'],primaryKinds:['okim6258'],onAvailability:(...args)=>calls.push(args)});
  assert.deepEqual(calls,[['ym2151',false],['okim6258',true]]);entries=[{id:'opm',kind:'ym2151',additional:true,connected:true}];for(const fn of listeners)fn();assert.deepEqual(calls.at(-1),['ym2151',true]);
  for(const fn of listeners)fn();assert.equal(calls.length,3);entries=[{id:'retired',kind:'ym2151',additional:true,connected:false}];for(const fn of listeners)fn();assert.deepEqual(calls.at(-1),['ym2151',false]);assert.equal(reads,0);
  watcher.dispose();assert.equal(unsubscribed,1);entries=[];watcher.refresh();assert.equal(calls.length,4);
});

test('additional YM2151 panels fence same-ID replacements and refresh from events without polling',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const listeners=new Set(),calls=[];let token=1,reads=0,pending;
  const state=level=>({kind:'ym2151',clock:3579545,registers:Array(256).fill(0),channels:Array.from({length:8},(_,channel)=>({channel,frequency:440,algorithm:7,operators:Array.from({length:4},()=>({tl:level}))})),lfo:{},noise:{}});
  const inspector={list:()=>[{id:'same',kind:'ym2151',additional:true}],getConnectionToken:()=>token,read:()=>{reads++;return pending?new Promise(resolve=>{pending=resolve;}):Promise.resolve(state(11));},invoke:async(...args)=>calls.push(args),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const {tabs,roots}=fixture(inspector,{pollMs:10,eventDrivenAdditionalKinds:['ym2151']});tabs.setVisible('ym2151');await flush();const old=control(roots.ym2151,'ym2151-op-0-tl');assert.equal(old.value,'11');assert.equal(reads,1);
  t.mock.timers.tick(1000);await flush();assert.equal(reads,1,'additional Native OPM adds no periodic status reads');
  token=2;for(const fn of listeners)fn();await flush();const next=control(roots.ym2151,'ym2151-op-0-tl');assert.notEqual(next,old);old.value='7';await old.fire('change');assert.deepEqual(calls,[]);next.value='23';await next.fire('change');assert.equal(calls.at(-1)[0],'same');assert.equal(calls.at(-1)[1],'setOperator');
  pending=true;const reading=tabs.refresh();await flush();const finish=pending;token=3;pending=null;for(const fn of listeners)fn();await flush();finish(state(99));await reading;assert.equal(control(roots.ym2151,'ym2151-op-0-tl').value,'11','late old snapshot cannot replace new-instance values');tabs.dispose();
});


test('WonderSwan tab prepares only its primary chip and shares the selected physical voice with Keyboard',async()=>{
  let prepared=false,reads=0;const calls=[],targets=[];
  const snapshot={kind:'wonderswan',clock:3072000,voiceMode:false,sweep:{enabled:false,step:0,time:0},noise:{enabled:false,type:0},registers:[],channels:Array.from({length:4},(_,channel)=>({channel,frequency:440,frequencyRegister:1830,pan:{left:10,right:10},waveform:Array(32).fill(8),waveformKnown:true}))};
  const inspector={list:()=>prepared?[{id:'wonderswan',kind:'wonderswan'}]:[],read:async()=>{reads++;return snapshot;},invoke:async(...args)=>calls.push(args)};
  const{tabs,roots}=fixture(inspector,{ensureAudioReady:async()=>{prepared=true;},onKeyboardTargetChange:target=>targets.push(target)});
  tabs.setVisible('wonderswan');await flush();assert.equal(reads,0);assert.equal(prepared,false);
  await walk(roots.wonderswan).find(node=>node.dataset.chipAction==='prepare').fire('click');assert(reads>0);assert.deepEqual(calls,[]);
  await walk(roots.wonderswan).find(node=>node.dataset.chipChannel==='3').fire('click');
  await walk(roots.wonderswan).find(node=>node.dataset.chipAction==='ws-keyboard').fire('click');
  tabs.setVisible(null);const target=targets.at(-1);target.noteOn({id:'press',midi:69});await flush();assert.deepEqual(calls.at(-1).slice(0,2),['wonderswan','auditionOn']);assert.equal(calls.at(-1)[2][0],3);
  target.noteOff({id:'press'});await flush();assert.equal(calls.at(-1)[1],'auditionOff');tabs.dispose();
});

test('POKEY dual primary tabs route physical edits, held Keyboard leases and copied code to the selected instance',async()=>{
  let prepared=false,preparations=0;const calls=[],reads=[],targets=[];
  const inspector={list:()=>prepared?[{id:'pokey',kind:'pokey'},{id:'pokey:2',kind:'pokey'}]:[],read:async id=>{reads.push(id);return pokeyState(id==='pokey'?440:880);},invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{voiceApiNames:{pokey:'pokey','pokey:2':'pokey2'},ensureAudioReady:async()=>{prepared=true;preparations++;},onKeyboardTargetChange:target=>targets.push(target)});
  try{
    tabs.setVisible('pokey');await flush();assert.equal(preparations,0);assert.deepEqual(reads,[]);assert.deepEqual(calls,[],'opening a POKEY editor never creates or programs audio');
    await chipAction(roots.pokey,'prepare').fire('click');assert.equal(preparations,1);assert.deepEqual(reads,['pokey']);assert.deepEqual(calls,[]);
    assert.equal(walk(roots.pokey).filter(node=>node.dataset.chipChannel!==undefined).length,4);assert.equal(control(roots.pokey,'pokey-volume').value,'0');assert.match(control(roots.pokey,'pokey-code').value,/pokey\.setVolume\(0, 0\)/);
    await tabs.refresh();assert.deepEqual(calls,[],'explicit refresh only reads applied state');
    await chipChannel(roots.pokey,1).fire('click');const frequency=control(roots.pokey,'pokey-frequency');frequency.value='523.25';await frequency.fire('change');assert.deepEqual(calls[0],['pokey','setFrequency',[1,523.25]]);
    await chipAction(roots.pokey,'pokey-keyboard').fire('click');const first=targets.at(-1);first.noteOn({id:'same-key',midi:60});await flush();const firstPress=calls.at(-1)[2][2];assert.deepEqual(calls.at(-1),['pokey','auditionOn',[1,60,firstPress]]);
    const instance=control(roots.pokey,'instance');instance.value='pokey:2';await instance.fire('change');assert.ok(calls.some(([id,method,args])=>id==='pokey'&&method==='auditionOff'&&args[0]===1&&args[1]===firstPress));assert.equal(targets.at(-1),null,'instance switching retires the previous Keyboard binding');
    assert.match(control(roots.pokey,'pokey-code').value,/pokey2\.setVolume\(0, 0\)/);assert.doesNotMatch(control(roots.pokey,'pokey-code').value,/^pokey\./m);
    await chipChannel(roots.pokey,3).fire('click');const distortion=control(roots.pokey,'pokey-distortion');distortion.value='7';await distortion.fire('change');assert.deepEqual(calls.at(-1),['pokey:2','setDistortion',[3,7]]);assert.match(control(roots.pokey,'pokey-code').value,/pokey2\.setVolume\(3, 8\)/);
    await chipAction(roots.pokey,'pokey-keyboard').fire('click');const second=targets.at(-1);assert.equal(second.name,'POKEY2 · CH4');second.noteOn({id:'same-key',midi:67});await flush();const secondPress=calls.at(-1)[2][2];assert.notEqual(secondPress,firstPress);assert.deepEqual(calls.at(-1),['pokey:2','auditionOn',[3,67,secondPress]]);
    const before=calls.length;first.noteOff({id:'same-key'});first.allNotesOff();first.noteOn({id:'late',midi:65});await flush();assert.equal(calls.length,before,'retired targets cannot start or release the other chip');
    tabs.setVisible(null);second.noteOff({id:'same-key'});await flush();assert.deepEqual(calls.at(-1),['pokey:2','auditionOff',[3,secondPress]],'hiding keeps the active Keyboard lease releasable');
  }finally{tabs.dispose();}
});

test('POKEY editor audition selection reports helper and timeline availability without issuing failed invokes',async()=>{
  let state=pokeyState();const selections=[],calls=[];
  const inspector={list:()=>[{id:'pokey',kind:'pokey'}],read:async()=>state,invoke:async(...args)=>{calls.push(args);throw new Error('selection must not audition hardware');}};
  const {tabs,roots}=fixture(inspector,{voiceApiNames:{pokey:'pokey'},onAuditionTargetChange:selection=>selections.push(selection)});
  try{
    tabs.setVisible('pokey');await flush();assert.deepEqual(selections.at(-1),{kind:'pokey',id:'pokey',channel:0});const before=selections.length;await tabs.refresh();assert.equal(selections.length,before,'unchanged ready snapshots keep the editor target stable');
    state=pokeyState();state.audctl=state.registers[8]=16;state.channels[0].helper=state.channels[0].joined=true;await tabs.refresh();assert.deepEqual(selections.at(-1),{kind:'pokey',id:'pokey',channel:0,playable:false});
    await chipAction(roots.pokey,'pokey-play').fire('click');await chipAction(roots.pokey,'pokey-keyboard').fire('click');assert.deepEqual(calls,[],'helper actions are suppressed before reaching the inspector');
    await chipChannel(roots.pokey,1).fire('click');await roots.pokey.children.find(node=>node.tagName==='fieldset').fire('click');assert.deepEqual(selections.at(-1),{kind:'pokey',id:'pokey',channel:1});
    for(const timeline of [{playing:true},{preparing:true},{pendingTimelines:1}]){
      state={...pokeyState(),timeline};await tabs.refresh();assert.deepEqual(selections.at(-1),{kind:'pokey',id:'pokey',channel:1,playable:false});
      await chipAction(roots.pokey,'pokey-play').fire('click');await chipAction(roots.pokey,'pokey-keyboard').fire('click');assert.deepEqual(calls,[],'busy actions are suppressed before reaching the inspector');
      state={...pokeyState(),timeline:{loaded:true}};await tabs.refresh();assert.deepEqual(selections.at(-1),{kind:'pokey',id:'pokey',channel:1},'ready removes only the optional unavailable marker');
    }
    assert.deepEqual(calls,[],'readback and channel selection never send sound commands');
  }finally{tabs.dispose();}
});

test('custom additional POKEY copied code binds the exact escaped identity without looking up a primary',async()=>{
  const id='custom\nchip.reset();\u2028other',calls=[];
  const inspector={list:()=>[{id,kind:'pokey',additional:true}],read:async selected=>{assert.equal(selected,id);return pokeyState();},invoke:async(...args)=>calls.push(args)};
  const {tabs,roots}=fixture(inspector,{eventDrivenAdditionalKinds:['pokey'],voiceApiNames:{pokey:'pokey','pokey:2':'pokey2'}});
  try{
    tabs.setVisible('pokey');await flush();await tabs.refresh();assert.deepEqual(calls,[]);
    const code=control(roots.pokey,'pokey-code').value;assert.match(code,/Bind chip to the selected POKEY instance "custom\\nchip\.reset\(\);\\u2028other"/);assert.match(code,/^chip\.setVolume\(0, 0\)/m);assert.doesNotMatch(code,/^pokey(?:2)?\.|useSoundChip|createSoundChip/m);
    const volume=control(roots.pokey,'pokey-volume');volume.value='4';await volume.fire('change');assert.deepEqual(calls,[[id,'setVolume',[0,4]]]);
  }finally{tabs.dispose();}
});

test('Native additional POKEY availability is metadata-only and editor reads follow visible events without polling',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const listeners=new Set(),availability=[],calls=[];let entries=[],reads=0,preparations=0;
  const inspector={list:()=>entries,read:async()=>{reads++;return pokeyState();},invoke:async(...args)=>calls.push(args),subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const watcher=createPlaygroundAdditionalChipTabAvailability({getInspector:()=>inspector,kinds:['pokey'],onAvailability:(...args)=>availability.push(args)});
  const {tabs,roots}=fixture(inspector,{eventDrivenAdditionalKinds:['pokey'],pollMs:10,ensureAudioReady:async()=>{preparations++;}});
  const emit=()=>{for(const listener of [...listeners])listener();};
  try{
    assert.deepEqual(availability,[['pokey',false]]);assert.equal(reads,0);
    entries=[{id:'native-extra-pokey',kind:'pokey',additional:true,connected:true}];emit();assert.deepEqual(availability.at(-1),['pokey',true]);assert.equal(reads,0,'availability never reads chip state');
    tabs.setVisible('pokey');await flush();assert.equal(reads,1);assert.equal(preparations,0);assert.match(control(roots.pokey,'pokey-code').value,/selected POKEY instance "native-extra-pokey"/);
    t.mock.timers.tick(10000);await flush();assert.equal(reads,1,'the Native additional panel adds no polling timer');
    emit();await flush();assert.equal(reads,2,'a connection event refreshes the visible panel once');
    tabs.setVisible(null);const before=reads;emit();await tabs.refresh();t.mock.timers.tick(10000);await flush();assert.equal(reads,before,'hidden editor receives no state reads');
    entries=[{id:'native-extra-pokey',kind:'pokey',additional:true,connected:false}];emit();assert.deepEqual(availability.at(-1),['pokey',false]);assert.equal(reads,before);assert.deepEqual(calls,[]);
  }finally{tabs.dispose();watcher.dispose();}
  assert.equal(listeners.size,0);assert.equal(preparations,0);
});

test('same-ID POKEY connection replacement fences stale controls, held targets and late edit ACKs',async()=>{
  let token=1,finishOldEdit;const calls=[],targets=[],listeners=new Set();
  const inspector={list:()=>[{id:'pokey:2',kind:'pokey',additional:true}],getConnectionToken:()=>token,read:async()=>pokeyState(token===1?440:880),
    invoke:(...args)=>{calls.push({token,args});if(token===1&&args[1]==='setVolume')return new Promise(resolve=>{finishOldEdit=resolve;});return Promise.resolve();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
  const {tabs,roots}=fixture(inspector,{eventDrivenAdditionalKinds:['pokey'],voiceApiNames:{'pokey:2':'pokey2'},onKeyboardTargetChange:target=>targets.push(target)});
  try{
    tabs.setVisible('pokey');await flush();const oldVolume=control(roots.pokey,'pokey-volume');await chipChannel(roots.pokey,2).fire('click');await chipAction(roots.pokey,'pokey-keyboard').fire('click');const oldTarget=targets.at(-1);oldTarget.noteOn({id:'same',midi:60});await flush();oldVolume.value='5';await oldVolume.fire('change');assert.ok(finishOldEdit);
    token=2;for(const listener of [...listeners])listener();await flush();const nextVolume=control(roots.pokey,'pokey-volume');assert.notEqual(nextVolume,oldVolume);assert.equal(targets.at(-1),null);assert.equal(control(roots.pokey,'pokey-frequency').value,'880');
    assert.equal(calls.filter(call=>call.token===2&&call.args[1]==='auditionOff').length,0,'retiring the old connection must not send its release to the replacement');
    const before=calls.length;oldVolume.value='2';await oldVolume.fire('change');oldTarget.noteOn({id:'late',midi:67});oldTarget.noteOff({id:'same'});oldTarget.allNotesOff();await flush();assert.equal(calls.length,before);
    await chipAction(roots.pokey,'pokey-keyboard').fire('click');const nextTarget=targets.at(-1);nextTarget.noteOn({id:'same',midi:69});await flush();const newPress=calls.at(-1).args[2][2];assert.deepEqual(calls.at(-1),{token:2,args:['pokey:2','auditionOn',[0,69,newPress]]});
    finishOldEdit();await flush();assert.equal(control(roots.pokey,'pokey-frequency').value,'880');assert.match(control(roots.pokey,'pokey-code').value,/pokey2\.setVolume\(0, 0\)/);
    const count=calls.length;oldTarget.noteOff({id:'same'});assert.equal(calls.length,count);nextTarget.noteOff({id:'same'});await flush();assert.deepEqual(calls.at(-1),{token:2,args:['pokey:2','auditionOff',[0,newPress]]});
    nextVolume.value='9';await nextVolume.fire('change');assert.deepEqual(calls.at(-1),{token:2,args:['pokey:2','setVolume',[0,9]]});
  }finally{tabs.dispose();}
});
