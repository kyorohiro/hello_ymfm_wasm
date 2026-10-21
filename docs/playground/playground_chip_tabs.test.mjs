import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPlaygroundChipTabs, frequencyNote, rfSamplePosition, pwmRoutingControl} from './playground_chip_tabs.js';

// Small DOM substitute for lifecycle tests. Rendering and input focus also receive browser coverage.
class Element {
  constructor(doc, tag) { this.ownerDocument = doc; this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.classList = {add() {},toggle() {}}; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
  removeEventListener(name, callback) { this.listeners[name] = (this.listeners[name] ?? []).filter(fn=>fn!==callback); }
  async fire(name, extra = {}) { await Promise.all((this.listeners[name] ?? []).map(fn => fn({target: this, ...extra}))); await flush(); }
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
  const roots = Object.fromEntries(['segapsg', 'rf5c164', 'pwm','gameboy','nes','ym2151','okim6258','huc6280','ym3812','ym3526','y8950','ymf262','ym2413','ay8910'].map(kind => [kind, new Element(doc, 'div')]));
  const tabs = createPlaygroundChipTabs({roots, getInspector: () => inspector, pollMs: 100000, ...options});
  return {doc, roots, tabs};
}
const psgState = frequency => ({kind: 'segapsg', clock: 3579545, channels: [0, 1, 2].map(channel => ({channel, frequency, period: 254, attenuation: 4, active: true})), noise: {type: 'white', rate: 'tone3', attenuation: 7, active: true}});

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
