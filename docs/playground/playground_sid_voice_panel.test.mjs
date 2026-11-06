import test from 'node:test';
import assert from 'node:assert/strict';
import {SidSynth} from '../../tetorica_src/runtime/sidsynth.js';
import {createPlaygroundSidVoicePanel} from './playground_sid_voice_panel.js';

class Element {
  constructor(ownerDocument,tagName) {Object.assign(this,{ownerDocument,tagName,children:[],dataset:{},attributes:{},textContent:''});}
  appendChild(node) {this.children.push(node);return node;}
  setAttribute(key,value) {this.attributes[key] = String(value);}
}
const all = node => [node,...node.children.flatMap(all)];
const output = (root,name) => all(root).find(node => node.dataset.chipOutput === `sid-${name}`).textContent;

test('SID inspector reads all voices and shared filter without audio writes or audition controls', () => {
  const doc = {createElement:tag => new Element(doc,tag)}, root = new Element(doc,'div'), writes = [];
  const sid = new SidSynth({transport:{reset(){},writeRegister(register,value){writes.push([register,value]);}}});
  sid.initialize(); sid.noteOn(0,'A4'); sid.setVoice(1,{waveform:'pulse',pulseWidth:1024,sync:true});
  sid.setFilter({mode:'bandpass',cutoff:1000,resonance:9,routing:5,volume:8,voice3off:true});
  const panel = createPlaygroundSidVoicePanel({root,invoke(){throw new Error('Inspector cannot invoke audio');}});
  const before = writes.length;
  panel.setConnected(true); panel.setVisible(true); panel.update(sid._getState());
  assert.equal(all(root).filter(node => node.dataset.sidVoice !== undefined).length,3);
  assert.match(output(root,'0-gate'),/^On/); assert.match(output(root,'1-gate'),/^Off/);
  assert.match(output(root,'0-frequency'),/440/); assert.equal(output(root,'1-waveform'),'pulse');
  assert.equal(output(root,'1-pulse'),'1,024'); assert.match(output(root,'1-modulation'),/Sync on/);
  assert.equal(output(root,'filter-mode'),'bandpass'); assert.equal(output(root,'filter-cutoff'),'1,000');
  assert.equal(output(root,'filter-resonance'),'9'); assert.match(output(root,'filter-routing'),/^1, 3 · mask 5$/);
  assert.match(output(root,'filter-voice3off'),/filtered path remains available/);
  assert.match(output(root,'registers'),/^\$00: /); assert.equal(output(root,'registers').split('\n').length,4);
  assert.equal(all(root).some(node => ['button','input','select','textarea'].includes(node.tagName)),false);
  assert.equal(panel.getSelectedChannel(),0); assert.equal(panel.getAuditionAvailability(),false);
  panel.releaseAll(); panel.setKeyboardActive(true); panel.setConnected(false); panel.dispose();
  assert.equal(writes.length,before,'opening, polling and closing never writes');
  sid.dispose();
});

test('raw combined or absent waveforms and combined filter bits retain their meaning', () => {
  const doc = {createElement:tag => new Element(doc,tag)}, root = new Element(doc,'div');
  const sid = new SidSynth({transport:{reset(){},writeRegister(){}}}); sid.initialize();
  sid.writeRegister(4,0x31); sid.writeRegister(11,0); sid.writeRegister(24,0x38);
  const panel = createPlaygroundSidVoicePanel({root}); panel.setConnected(true); panel.update(sid._getState());
  assert.equal(output(root,'0-waveform'),'Combined: triangle + saw');
  assert.equal(output(root,'1-waveform'),'off');
  assert.equal(output(root,'filter-mode'),'Combined · mode bits 0x3');
  const previous = output(root,'0-waveform'); panel.dispose(); sid.setVoice(0,{waveform:'noise'}); panel.update(sid._getState());
  assert.equal(output(root,'0-waveform'),previous,'disposed panels ignore late snapshots'); sid.dispose();
});
