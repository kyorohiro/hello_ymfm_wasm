import test from 'node:test';
import assert from 'node:assert/strict';
import {createMixerUi} from './mixer_ui.js';
import {createAudioPreferences, AUDIO_PREFERENCES_KEY, effectDefaults} from './audio_preferences.js';
import {mixerDefaults} from './mixer_defaults.js';
import {YM2608_SOURCE_LABELS, Ym2608SourceMixer} from './ym2608_source_mix.js';

// Exercise real handlers with the same native source controller used in playback.
class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.handlers = {}; this.dataset = {}; this.attributes = {};
    this.className = ''; this.textContent = ''; this.replacements = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, on) => {
        const names = new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      },
    };
  }
  set value(value) {this._value = String(value);}
  get value() {return this._value ?? '';}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children; this.replacements++;}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name];}
  addEventListener(name, fn) {this.handlers[name] = fn;}
  fire(name) {this.handlers[name]();}
}
const descendants = node => node.children.flatMap(child => child instanceof Element ? [child, ...descendants(child)] : []);
const find = (node, predicate) => descendants(node).find(predicate);
const sourceNode = (container, part) => find(container, node => node.dataset.source === part);
const input = node => find(node, child => child.tag === 'input');
const button = node => find(node, child => child.tag === 'button');
const output = node => find(node, child => child.tag === 'output');
const config = {kind:'ym2608',chips:[{id:'ym2608'}]};
function setup(run) {
  const previous = globalThis.document;
  globalThis.document = {createElement: tag => new Element(tag)};
  const data = new Map(),storage = {getItem:key => data.get(key) ?? null,setItem:(key,value) => data.set(key,value)};
  const preferences = createAudioPreferences(storage),container = new Element(),resetButton = new Element('button');
  const events = {changes:0,resets:0,errors:[]};
  const ui = createMixerUi({container,resetButton,preferences,onChange(){events.changes++;},onReset(){events.resets++;},onError:error => events.errors.push(error)});
  try {run({ui,container,resetButton,preferences,storage,events});} finally {globalThis.document = previous;}
}
function playback({reject = () => false, onNative = () => {}} = {}) {
  const calls = [],native = {setSourceGains(gains) {
    calls.push(['native', {...gains}]); onNative(gains);
    if (reject(gains)) throw new Error('native source rejected');
    this.gains = {...gains};
  }};
  const controller = new Ym2608SourceMixer(native),parent = new Map();
  return {calls,native,controller,strips:new Map([['ym2608',{}],['ay8910',{}]]),sourceMixers:new Map([['ym2608',controller]]),
    set(id, values){calls.push(['parent',id,{...values}]);parent.set(id,{...values});},
    get:id => parent.get(id),reset(){calls.push(['reset']);},
  };
}

test('OPNA sources appear only for YM2608 and preserve the calibrated parent controls',()=>setup(({ui,container})=>{
  assert.equal(descendants(container).some(node => node.dataset.source),false);
  ui.load({kind:'ay8910',chips:[{id:'ay8910'}]});
  assert.equal(descendants(container).some(node => node.dataset.source),false);
  for (const configuration of [config,{kind:'mixed',chips:[{id:'ym2608'},{id:'ay8910'}]}]) {
    ui.load(configuration);
    const parent = container.children.find(node => node.dataset.chip === 'ym2608');
    assert.equal(parent.children.filter(node => node.tag === 'label').length,2);
    assert.equal(parent.children[1].children[1].value,String(Math.round(mixerDefaults('ym2608').gain*100)));
    assert.equal(parent.children[2].children[1].getAttribute('aria-label'),'YM2608 pan');
    for (const [part,label] of Object.entries(YM2608_SOURCE_LABELS)) {
      const source = sourceNode(parent,part),range = input(source);
      assert.equal(range.min,0);assert.equal(range.max,380);assert.equal(range.step,1);assert.equal(range.value,'100');
      assert.equal(range.getAttribute('aria-label'),`YM2608 ${label} volume`);
      assert.equal(descendants(source).filter(node => node.tag === 'input').length,1);
      assert.equal(button(source).getAttribute('aria-pressed'),'false');assert.equal(output(source).textContent,'100%');
    }
    assert.equal(descendants(parent).filter(node => node.dataset.source).length,4);
  }
}));

test('pre-play edits persist, keep control focus, and attach to every new mixer before reset',()=>setup(({ui,container,preferences,events})=>{
  ui.load(config);
  const fm=sourceNode(container,'fm'),range=input(fm),replacements=container.replacements;
  range.value=235;range.fire('input');button(fm).fire('click');
  assert.deepEqual(preferences.getSource('ym2608','fm'),{gain:2.35,muted:true});
  assert.equal(events.changes,2);assert.equal(container.replacements,replacements);assert.equal(input(fm),range);
  assert.equal(output(fm).textContent,'235%');assert.equal(output(fm).classList.contains('is-boosted'),true);
  assert.equal(button(fm).getAttribute('aria-pressed'),'true');
  for (let index=0;index<2;index++) {
    const mixer=playback();ui.attach(mixer);
    assert.deepEqual(mixer.controller.get('fm'),{gain:2.35,muted:true});
    assert.deepEqual(mixer.native.gains,{fm:0,ssg:1,rhythm:1,adpcm:1});
    assert.equal(mixer.calls.at(-1)[0],'reset');
    assert.deepEqual(mixer.get('ym2608'),mixerDefaults('ym2608'));
  }
  ui.load({kind:'ay8910',chips:[{id:'ay8910'}]});
  assert.equal(sourceNode(container,'fm'),undefined);
  ui.load({kind:'mixed',chips:[{id:'ay8910'},{id:'ym2608'}]});
  assert.equal(input(sourceNode(container,'fm')).value,'235');
  const next=playback();ui.attach(next);assert.equal(next.controller.get('fm').muted,true);
}));

test('live source edits apply native output before persistence and rejected edits restore controls',()=>setup(({ui,container,preferences,events})=>{
  ui.load(config);let fail=false,observe=false;
  const mixer=playback({reject:()=>fail,onNative(gains){
    if (observe) {assert.equal(gains.fm,.5);assert.equal(preferences.getSource('ym2608','fm').gain,1);assert.equal(events.changes,0);}
  }});
  ui.attach(mixer);
  const fm=sourceNode(container,'fm'),range=input(fm),replacements=container.replacements;
  observe=true;range.value=50;range.fire('input');observe=false;
  assert.deepEqual(mixer.controller.get('fm'),{gain:.5,muted:false});
  assert.equal(preferences.getSource('ym2608','fm').gain,.5);assert.equal(events.changes,1);
  fail=true;range.value=380;range.fire('input');
  assert.equal(range.value,'50');assert.equal(output(fm).textContent,'50%');assert.equal(fm.classList.contains('is-boosted'),false);
  button(fm).fire('click');assert.equal(button(fm).getAttribute('aria-pressed'),'false');
  assert.deepEqual(preferences.getSource('ym2608','fm'),{gain:.5,muted:false});
  assert.deepEqual(mixer.controller.get('fm'),{gain:.5,muted:false});
  assert.equal(events.errors.length,2);assert.equal(events.changes,1);assert.equal(container.replacements,replacements);
  fail=false;range.value=100;range.fire('input');assert.equal(fm.classList.contains('is-boosted'),false);
  range.value=101;range.fire('input');assert.equal(fm.classList.contains('is-boosted'),true);
}));

test('a failed attach remains retryable with the same mixer instance',()=>setup(({ui,preferences})=>{
  preferences.setSource('ym2608','fm',{gain:.4});ui.load(config);
  let fail=false;const mixer=playback({reject:()=>fail});fail=true;
  assert.throws(()=>ui.attach(mixer),/native source rejected/);
  fail=false;ui.attach(mixer);
  assert.deepEqual(mixer.controller.get('fm'),{gain:.4,muted:false});
  assert.equal(mixer.calls.at(-1)[0],'reset');
}));

test('a missing native source controller rejects attach and live edits without persisting success',()=>setup(({ui,container,preferences,storage,events})=>{
  preferences.setSource('ym2608','fm',{gain:.6});ui.load(config);
  const missing=playback();missing.sourceMixers.clear();
  assert.throws(()=>ui.attach(missing),/source gains are unavailable; reload/);
  const mixer=playback();ui.attach(mixer);mixer.sourceMixers.clear();
  const fm=sourceNode(container,'fm'),range=input(fm),saved=storage.getItem(AUDIO_PREFERENCES_KEY);
  range.value=225;range.fire('input');button(fm).fire('click');
  assert.equal(range.value,'60');assert.equal(output(fm).textContent,'60%');
  assert.equal(button(fm).getAttribute('aria-pressed'),'false');
  assert.deepEqual(preferences.getSource('ym2608','fm'),{gain:.6,muted:false});
  assert.equal(storage.getItem(AUDIO_PREFERENCES_KEY),saved);assert.equal(events.changes,0);
  assert.equal(events.errors.length,2);assert.match(events.errors[0].message,/reload/);
}));

test('Reset clears saved source edits and active native gains while retaining effects',()=>setup(({ui,container,resetButton,preferences,storage,events})=>{
  preferences.setEffect({...effectDefaults(),enabled:true,reverb:25});preferences.setMaster(.5);
  preferences.setChip('ym2608',{gain:.3,pan:.4,muted:true});
  for(const part of Object.keys(YM2608_SOURCE_LABELS))preferences.setSource('ym2608',part,{gain:2,muted:true});
  ui.load(config);const mixer=playback();ui.attach(mixer);resetButton.fire('click');
  assert.deepEqual(mixer.native.gains,{fm:1,ssg:1,rhythm:1,adpcm:1});
  assert.deepEqual(mixer.get('ym2608'),mixerDefaults('ym2608'));
  for(const part of Object.keys(YM2608_SOURCE_LABELS)) {
    assert.deepEqual(preferences.getSource('ym2608',part),{gain:1,muted:false});
    const source=sourceNode(container,part);assert.equal(input(source).value,'100');assert.equal(button(source).getAttribute('aria-pressed'),'false');
  }
  assert.equal(preferences.getMaster(),1);assert.equal(preferences.getEffect().enabled,true);assert.equal(preferences.getEffect().reverb,25);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(AUDIO_PREFERENCES_KEY)),'sourceMixes'),false);
  assert.equal(events.changes,1);assert.equal(events.resets,1);assert.equal(events.errors.length,0);
}));

test('a rejected Reset restores earlier sources and leaves saved preferences and UI intact',()=>setup(({ui,container,resetButton,preferences,storage,events})=>{
  preferences.setSource('ym2608','fm',{gain:.5});preferences.setSource('ym2608','ssg',{gain:.25});
  ui.load(config);let rejectReset=false;
  const mixer=playback({reject:gains=>rejectReset && gains.fm===1 && gains.ssg===1});ui.attach(mixer);
  const saved=storage.getItem(AUDIO_PREFERENCES_KEY),fm=sourceNode(container,'fm'),replacements=container.replacements;
  rejectReset=true;resetButton.fire('click');
  assert.deepEqual(mixer.native.gains,{fm:.5,ssg:.25,rhythm:1,adpcm:1});
  assert.equal(storage.getItem(AUDIO_PREFERENCES_KEY),saved);assert.equal(input(fm).value,'50');
  assert.equal(container.replacements,replacements);assert.equal(events.changes,0);assert.equal(events.resets,0);assert.equal(events.errors.length,1);
}));
